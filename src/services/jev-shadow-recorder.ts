/**
 * Durable sink for Jev shadow judgments.
 *
 * The `jev.shadow` log event deliberately carries only digests, which is not
 * enough to label relevance offline: that needs the query and the judged
 * text. When JEV_SHADOW_FILE is set, each judged search is appended to it as
 * one JSON line holding plaintext query, judged chunk text, ranker scores and
 * Jev's answers. The file is for the operator's own analysis and lives
 * outside the database; anyone who can read it can read the queries.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loadConfig } from '../config.js';
import type { JevCandidateObservation } from './jev-retrieval-judge.js';

export type JevShadowRecordCandidate = JevCandidateObservation & {
  /** 1-based position in the returned search results. */
  rank: number;
  entityType: string;
  tags: string[];
  /** The exact (capped) chunk text that was sent to Jev. */
  chunkText: string;
};

export type JevShadowRecord = {
  recordedAt: string;
  searchId: string;
  clientId: string | null;
  query: string;
  queryHash: string;
  /** Wall time of the whole judging pass, off the search's critical path. */
  jevMs: number;
  candidates: JevShadowRecordCandidate[];
};

export type JevShadowRecorder = (record: JevShadowRecord) => Promise<void>;

export function createJevShadowFileRecorder(
  filePath: string
): JevShadowRecorder {
  // Appends are chained so concurrent searches never interleave partial
  // lines; a failed append rejects its own caller without blocking the next.
  let tail: Promise<void> = Promise.resolve();
  return (record) => {
    const line = `${JSON.stringify(record)}\n`;
    const write = tail.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, line, 'utf8');
    });
    tail = write.catch(() => undefined);
    return write;
  };
}

let cachedEnvRecorder:
  | { filePath: string; recorder: JevShadowRecorder | undefined }
  | undefined;

/**
 * Recorder for the search path, resolved from JEV_SHADOW_FILE. Returns
 * undefined when the variable is unset or the environment does not parse.
 * Memoized per path so all searches share one append chain.
 */
export function resolveEnvJevRecorder(): JevShadowRecorder | undefined {
  const filePath = process.env['JEV_SHADOW_FILE'] ?? '';
  if (cachedEnvRecorder && cachedEnvRecorder.filePath === filePath) {
    return cachedEnvRecorder.recorder;
  }

  let recorder: JevShadowRecorder | undefined;
  try {
    const configured = loadConfig(process.env).JEV_SHADOW_FILE;
    recorder = configured ? createJevShadowFileRecorder(configured) : undefined;
  } catch {
    // Unparseable environment (unit tests without DATABASE_URL): no recorder.
  }
  cachedEnvRecorder = { filePath, recorder };
  return recorder;
}
