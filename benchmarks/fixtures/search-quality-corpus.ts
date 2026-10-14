import type { QualityGrade } from '../search-quality-metrics.js';

export const SEARCH_QUALITY_DIMENSIONS = 1536;
export const SEARCH_QUALITY_DISTRACTOR_COUNT = 620;
export const SEARCH_QUALITY_BASE_FIXTURE_COUNT = 10;
export const SEARCH_QUALITY_COMMON_TERM_DISTRACTORS_PER_TERM = 220;
export const SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT = 5;
export const SEARCH_QUALITY_COMMON_TERMS = [
  'postgram',
  'search',
  'ranking'
] as const;
export const SEARCH_QUALITY_COMMON_TERM_QUERY =
  SEARCH_QUALITY_COMMON_TERMS.join(' ');

export type SearchQualityCategory =
  | 'exact_identifier'
  | 'concise_answer'
  | 'iso_date'
  | 'long_keyword_list'
  | 'dutch'
  | 'semantic_control'
  | 'common_terms'
  | 'private';

export type SearchQualityFixture = {
  id: string;
  type: 'memory' | 'document';
  content: string;
  embedding: number[];
};

export type SearchQualityQuery = {
  query: string;
  category: SearchQualityCategory;
  grades: Readonly<Record<string, QualityGrade>>;
  expectedTop3Id?: string | undefined;
  expectedAbove?:
    | {
        winnerId: string;
        loserId: string;
      }
    | undefined;
};

export type SearchQualityCorpus = {
  fixtures: readonly SearchQualityFixture[];
  queries: readonly SearchQualityQuery[];
};

type EmbeddingBasis =
  | 'vector_candidates'
  | 'identifier_target'
  | 'answer'
  | 'date_target'
  | 'keyword_target'
  | 'dutch_target'
  | 'semantic'
  | 'common_terms';

const FIXTURE_IDS = {
  ticketTarget: '00000000-0000-0000-0000-000000900001',
  orderTarget: '00000000-0000-0000-0000-000000900002',
  configTarget: '00000000-0000-0000-0000-000000900003',
  conciseAnswer: '00000000-0000-0000-0000-000000900101',
  mentioningDocument: '00000000-0000-0000-0000-000000900102',
  dateTarget: '00000000-0000-0000-0000-000000900201',
  keywordTarget: '00000000-0000-0000-0000-000000900301',
  dutchTarget: '00000000-0000-0000-0000-000000900401',
  semanticTarget: '00000000-0000-0000-0000-000000900501',
  semanticDistractor: '00000000-0000-0000-0000-000000900502'
} as const;

function basisVector(basis: EmbeddingBasis): number[] {
  const vector = new Array<number>(SEARCH_QUALITY_DIMENSIONS).fill(0);
  const indexByBasis: Record<EmbeddingBasis, number> = {
    vector_candidates: 0,
    identifier_target: 1,
    answer: 2,
    date_target: 3,
    keyword_target: 4,
    dutch_target: 5,
    semantic: 6,
    common_terms: 1200
  };
  if (basis === 'semantic') {
    // A dense semantic control gives HNSW a clear distance margin over the
    // one-hot distractors. The lexical cases deliberately keep orthogonal
    // vectors so the baseline demonstrates the missing keyword branch.
    for (let index = 6; index < 106; index += 1) {
      vector[index] = 1;
    }
  } else {
    vector[indexByBasis[basis]] = 1;
  }
  return vector;
}

const VECTOR_CANDIDATE_EMBEDDING = basisVector('vector_candidates');
const IDENTIFIER_TARGET_EMBEDDING = basisVector('identifier_target');
const ANSWER_EMBEDDING = basisVector('answer');
const DATE_TARGET_EMBEDDING = basisVector('date_target');
const KEYWORD_TARGET_EMBEDDING = basisVector('keyword_target');
const DUTCH_TARGET_EMBEDDING = basisVector('dutch_target');
const SEMANTIC_EMBEDDING = basisVector('semantic');
const COMMON_TERM_EMBEDDING = basisVector('common_terms');

function ticketDistractorId(index: number): string {
  return `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
}

function ticketNumber(index: number): number {
  const candidate = 1000 + index;
  return candidate === 1234 ? 2000 : candidate;
}

function makeTicketDistractors(): SearchQualityFixture[] {
  return Array.from({ length: SEARCH_QUALITY_DISTRACTOR_COUNT }, (_, index) => {
    const number = ticketNumber(index);
    return {
      id: ticketDistractorId(index),
      type: 'document',
      content:
        `Atlas project ticket ABC-${number} records a routine status update ` +
        'without the requested identifier or answer.',
      embedding: VECTOR_CANDIDATE_EMBEDDING
    };
  });
}

const conciseAnswer =
  'Answer: the deployment window is Tuesday 2026-04-21 at 09:30 UTC, after the migration check.';

const mentioningDocument = Array.from(
  { length: 48 },
  () =>
    'The planning archive mentions a possible deployment window on Tuesday 2026-04-21 at 09:30 UTC while comparing several rollout scenarios.'
).join(' ');

const primaryFixtures: SearchQualityFixture[] = [
  {
    id: FIXTURE_IDS.ticketTarget,
    type: 'memory',
    content:
      'Incident memory: ticket ABC-1234 is assigned to the billing migration team and needs a focused review.',
    embedding: IDENTIFIER_TARGET_EMBEDDING
  },
  {
    id: FIXTURE_IDS.orderTarget,
    type: 'document',
    content:
      'Order reconciliation reference: ORD-2026-04-17-998877665544332211. Keep this identifier with the finance export.',
    embedding: IDENTIFIER_TARGET_EMBEDDING
  },
  {
    id: FIXTURE_IDS.configTarget,
    type: 'document',
    content:
      'Configuration reference: EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE controls the per-type extraction floor.',
    embedding: IDENTIFIER_TARGET_EMBEDDING
  },
  {
    id: FIXTURE_IDS.conciseAnswer,
    type: 'memory',
    content: conciseAnswer,
    embedding: ANSWER_EMBEDDING
  },
  {
    id: FIXTURE_IDS.mentioningDocument,
    type: 'document',
    content: mentioningDocument,
    embedding: ANSWER_EMBEDDING
  },
  {
    id: FIXTURE_IDS.dateTarget,
    type: 'document',
    content:
      'Release note: migration completed on 2025-10-31T14:45:00Z after the final verification pass.',
    embedding: DATE_TARGET_EMBEDDING
  },
  {
    id: FIXTURE_IDS.keywordTarget,
    type: 'memory',
    content:
      'Runbook: cache stampede mitigation, vector index rebuild, rollback procedure, HNSW tuning, and authorization checks.',
    embedding: KEYWORD_TARGET_EMBEDDING
  },
  {
    id: FIXTURE_IDS.dutchTarget,
    type: 'memory',
    content:
      'Notitie: de vergadering over de nieuwe zoekindex is volgende dinsdag om tien uur.',
    embedding: DUTCH_TARGET_EMBEDDING
  },
  {
    id: FIXTURE_IDS.semanticTarget,
    type: 'memory',
    content:
      'A crisp factual reply should lead the result list when someone asks about retrieval behavior.',
    embedding: SEMANTIC_EMBEDDING
  },
  {
    id: FIXTURE_IDS.semanticDistractor,
    type: 'document',
    content:
      'The archive discusses gardening supplies, weather observations, and unrelated travel plans.',
    embedding: VECTOR_CANDIDATE_EMBEDDING
  }
];

function commonTermDistractorId(termIndex: number, fixtureIndex: number): string {
  const suffix = 910_000_000_000 + termIndex * 1_000 + fixtureIndex + 1;
  return `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
}

function commonTermTargetId(targetIndex: number): string {
  const suffix = 920_000_000_000 + targetIndex + 1;
  return `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
}

const commonTermDistractors: SearchQualityFixture[] =
  SEARCH_QUALITY_COMMON_TERMS.flatMap((term, termIndex) =>
    Array.from(
      { length: SEARCH_QUALITY_COMMON_TERM_DISTRACTORS_PER_TERM },
      (_, fixtureIndex) => ({
        id: commonTermDistractorId(termIndex, fixtureIndex),
        type: 'document' as const,
        content: `Crowded ${term} sample ${fixtureIndex} for the candidate probe.`,
        embedding: COMMON_TERM_EMBEDDING
      })
    )
  );

export const SEARCH_QUALITY_COMMON_TERM_TARGET_IDS = Array.from(
  { length: SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT },
  (_, targetIndex) => commonTermTargetId(targetIndex)
);

const commonTermTargets: SearchQualityFixture[] =
  SEARCH_QUALITY_COMMON_TERM_TARGET_IDS.map((id, targetIndex) => ({
    id,
    type: 'memory',
    content:
      targetIndex === 0
        ? 'Postgram search ranking.'
        : `Postgram search ranking target ${targetIndex} contains all three terms.`,
    embedding: COMMON_TERM_EMBEDDING
  }));

export const SEARCH_QUALITY_FIXTURES: readonly SearchQualityFixture[] = [
  ...primaryFixtures,
  ...makeTicketDistractors(),
  ...commonTermDistractors,
  ...commonTermTargets
];

const gradesByQuery: ReadonlyArray<{
  query: string;
  category: SearchQualityCategory;
  relevant: Readonly<Record<string, QualityGrade>>;
  expectedTop3Id?: string | undefined;
  expectedAbove?:
    | {
        winnerId: string;
        loserId: string;
      }
    | undefined;
}> = [
  {
    query: 'ABC-1234',
    category: 'exact_identifier',
    relevant: { [FIXTURE_IDS.ticketTarget]: 2 },
    expectedTop3Id: FIXTURE_IDS.ticketTarget
  },
  {
    query: 'ORD-2026-04-17-998877665544332211',
    category: 'exact_identifier',
    relevant: { [FIXTURE_IDS.orderTarget]: 2 },
    expectedTop3Id: FIXTURE_IDS.orderTarget
  },
  {
    query: 'EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE',
    category: 'exact_identifier',
    relevant: { [FIXTURE_IDS.configTarget]: 2 },
    expectedTop3Id: FIXTURE_IDS.configTarget
  },
  {
    query: 'deployment window Tuesday 2026-04-21',
    category: 'concise_answer',
    relevant: {
      [FIXTURE_IDS.conciseAnswer]: 2,
      [FIXTURE_IDS.mentioningDocument]: 1
    },
    expectedAbove: {
      winnerId: FIXTURE_IDS.conciseAnswer,
      loserId: FIXTURE_IDS.mentioningDocument
    }
  },
  {
    query: '2025-10-31T14:45:00Z',
    category: 'iso_date',
    relevant: { [FIXTURE_IDS.dateTarget]: 2 },
    expectedTop3Id: FIXTURE_IDS.dateTarget
  },
  {
    query:
      'cache stampede mitigation vector index rebuild rollback procedure hnsw pgvector candidate branch authorization scope recency lexical',
    category: 'long_keyword_list',
    relevant: { [FIXTURE_IDS.keywordTarget]: 2 },
    expectedTop3Id: FIXTURE_IDS.keywordTarget
  },
  {
    query: 'vergadering nieuwe zoekindex volgende dinsdag',
    category: 'dutch',
    relevant: { [FIXTURE_IDS.dutchTarget]: 2 },
    expectedTop3Id: FIXTURE_IDS.dutchTarget
  },
  {
    query: SEARCH_QUALITY_COMMON_TERM_QUERY,
    category: 'common_terms',
    relevant: SEARCH_QUALITY_COMMON_TERM_TARGET_IDS.reduce<
      Record<string, QualityGrade>
    >(
      (grades, id, targetIndex) => ({
        ...grades,
        [id]: targetIndex === 0 ? 2 : 1
      }),
      {}
    ),
    expectedTop3Id: SEARCH_QUALITY_COMMON_TERM_TARGET_IDS[0]
  },
  {
    query: 'where should a short factual answer appear in retrieval results',
    category: 'semantic_control',
    relevant: { [FIXTURE_IDS.semanticTarget]: 2 }
  },
  {
    query: 'how can related ideas be found by meaning',
    category: 'semantic_control',
    relevant: { [FIXTURE_IDS.semanticTarget]: 2 }
  }
];

function gradeMap(
  relevant: Readonly<Record<string, QualityGrade>>
): Record<string, QualityGrade> {
  const grades: Record<string, QualityGrade> = {};
  for (const fixture of SEARCH_QUALITY_FIXTURES) {
    grades[fixture.id] = relevant[fixture.id] ?? 0;
  }
  return grades;
}

export const SEARCH_QUALITY_QUERIES: readonly SearchQualityQuery[] =
  gradesByQuery.map((query) => ({
    query: query.query,
    category: query.category,
    grades: gradeMap(query.relevant),
    ...(query.expectedTop3Id ? { expectedTop3Id: query.expectedTop3Id } : {}),
    ...(query.expectedAbove ? { expectedAbove: query.expectedAbove } : {})
  }));

export const SEARCH_QUALITY_CORPUS: SearchQualityCorpus = {
  fixtures: SEARCH_QUALITY_FIXTURES,
  queries: SEARCH_QUALITY_QUERIES
};

export const SEARCH_QUALITY_QUERY_EMBEDDINGS: Readonly<
  Record<string, number[]>
> = {
  'ABC-1234': VECTOR_CANDIDATE_EMBEDDING,
  'ORD-2026-04-17-998877665544332211': VECTOR_CANDIDATE_EMBEDDING,
  EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE: VECTOR_CANDIDATE_EMBEDDING,
  'deployment window Tuesday 2026-04-21': ANSWER_EMBEDDING,
  '2025-10-31T14:45:00Z': VECTOR_CANDIDATE_EMBEDDING,
  'cache stampede mitigation vector index rebuild rollback procedure hnsw pgvector candidate branch authorization scope recency lexical':
    VECTOR_CANDIDATE_EMBEDDING,
  'vergadering nieuwe zoekindex volgende dinsdag': VECTOR_CANDIDATE_EMBEDDING,
  [SEARCH_QUALITY_COMMON_TERM_QUERY]: VECTOR_CANDIDATE_EMBEDDING,
  'where should a short factual answer appear in retrieval results':
    SEMANTIC_EMBEDDING,
  'how can related ideas be found by meaning': SEMANTIC_EMBEDDING
};

export const SEARCH_QUALITY_ACCEPTANCE = {
  identifierTargetIds: SEARCH_QUALITY_QUERIES.flatMap((query) =>
    query.expectedTop3Id ? [query.expectedTop3Id] : []
  ),
  conciseAnswerId: FIXTURE_IDS.conciseAnswer,
  mentioningDocumentId: FIXTURE_IDS.mentioningDocument
} as const;

export function fixtureEmbeddingByContent(): ReadonlyMap<string, number[]> {
  return new Map(
    SEARCH_QUALITY_FIXTURES.map((fixture) => [
      fixture.content,
      fixture.embedding
    ])
  );
}
