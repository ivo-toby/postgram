export type QualityGrade = 0 | 1 | 2;

export type QualityMetrics = {
  ndcg_at_5: number;
  mrr: number;
  recall_at_10: number;
};

export type QualityQueryResult = {
  query: string;
  category: string;
  rankedEntityIds: string[];
  grades: Readonly<Record<string, QualityGrade>>;
  metrics: QualityMetrics;
};

export type QualityCategoryMetrics = QualityMetrics & {
  query_count: number;
};

export type QualityReportMetrics = Record<string, QualityCategoryMetrics>;

function gain(grade: QualityGrade): number {
  return grade === 0 ? 0 : 2 ** grade - 1;
}

function dcg(grades: QualityGrade[], cutoff: number): number {
  return grades
    .slice(0, cutoff)
    .reduce<number>(
      (total, grade, index) => total + gain(grade) / Math.log2(index + 2),
      0
    );
}

function metricRound(value: number): number {
  return Number(value.toFixed(6));
}

function gradeFor(
  entityId: string,
  grades: Readonly<Record<string, QualityGrade>>
): QualityGrade {
  return grades[entityId] ?? 0;
}

export function calculateQualityMetrics(
  rankedEntityIds: readonly string[],
  grades: Readonly<Record<string, QualityGrade>>
): QualityMetrics {
  const rankedGrades = rankedEntityIds.map((entityId) =>
    gradeFor(entityId, grades)
  );
  const idealGrades = Object.values(grades).sort((left, right) => right - left);
  const idealDcg = dcg(idealGrades, 5);
  const observedDcg = dcg(rankedGrades, 5);

  const firstRelevantIndex = rankedGrades.findIndex((grade) => grade > 0);
  const relevantCount = Object.values(grades).filter(
    (grade) => grade > 0
  ).length;
  const foundRelevantCount = rankedGrades
    .slice(0, 10)
    .filter((grade) => grade > 0).length;

  return {
    ndcg_at_5: metricRound(idealDcg === 0 ? 0 : observedDcg / idealDcg),
    mrr: metricRound(firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1)),
    recall_at_10: metricRound(
      relevantCount === 0 ? 0 : foundRelevantCount / relevantCount
    )
  };
}

export function aggregateQualityMetrics(
  results: readonly QualityQueryResult[]
): QualityReportMetrics {
  const byCategory = new Map<string, QualityQueryResult[]>();
  for (const result of results) {
    const categoryResults = byCategory.get(result.category) ?? [];
    categoryResults.push(result);
    byCategory.set(result.category, categoryResults);
  }

  const report: QualityReportMetrics = {};
  for (const [category, categoryResults] of byCategory) {
    const count = categoryResults.length;
    report[category] = {
      query_count: count,
      ndcg_at_5: metricRound(
        categoryResults.reduce(
          (total, result) => total + result.metrics.ndcg_at_5,
          0
        ) / count
      ),
      mrr: metricRound(
        categoryResults.reduce(
          (total, result) => total + result.metrics.mrr,
          0
        ) / count
      ),
      recall_at_10: metricRound(
        categoryResults.reduce(
          (total, result) => total + result.metrics.recall_at_10,
          0
        ) / count
      )
    };
  }

  return report;
}

function isQualityGrade(value: unknown): value is QualityGrade {
  return value === 0 || value === 1 || value === 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type QualityLabel = {
  query: string;
  grades: Record<string, QualityGrade>;
};

export function parseQualityLabels(lines: readonly string[]): QualityLabel[] {
  const labels: QualityLabel[] = [];
  const queries = new Set<string>();

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Invalid SEARCH_QUALITY_LABELS JSON on line ${lineIndex + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (
      !isRecord(parsed) ||
      typeof parsed.query !== 'string' ||
      !parsed.query.trim()
    ) {
      throw new Error(
        `SEARCH_QUALITY_LABELS line ${lineIndex + 1} must contain a non-empty query`
      );
    }
    if (!isRecord(parsed.grades)) {
      throw new Error(
        `SEARCH_QUALITY_LABELS line ${lineIndex + 1} must contain a grades object`
      );
    }

    const query = parsed.query.trim();
    if (queries.has(query)) {
      throw new Error(`Duplicate SEARCH_QUALITY_LABELS query: ${query}`);
    }
    queries.add(query);

    const grades: Record<string, QualityGrade> = {};
    for (const [entityId, grade] of Object.entries(parsed.grades)) {
      if (!isQualityGrade(grade)) {
        throw new Error(
          `SEARCH_QUALITY_LABELS line ${lineIndex + 1} has invalid grade for ${entityId}`
        );
      }
      grades[entityId] = grade;
    }
    if (Object.keys(grades).length === 0) {
      throw new Error(
        `SEARCH_QUALITY_LABELS line ${lineIndex + 1} must contain at least one grade`
      );
    }

    labels.push({ query, grades });
  }

  if (labels.length === 0) {
    throw new Error('SEARCH_QUALITY_LABELS did not contain any JSONL labels');
  }

  return labels;
}
