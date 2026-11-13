import type { Entity, LoadingStatus } from '../types/entities.js';

/** Document-loader columns as they appear on an `entities` row. */
export type LoadingFieldsRow = {
  mime_type?: string | null | undefined;
  loading_status?: LoadingStatus | null | undefined;
  loading_error?: string | null | undefined;
  loader_name?: string | null | undefined;
};

type LoadingFields = Pick<
  Entity,
  'mimeType' | 'loadingStatus' | 'loadingError' | 'loaderName'
>;

/** Row to entity fields; a null or missing column is left out entirely. */
export function mapLoadingFields(row: LoadingFieldsRow): LoadingFields {
  return {
    ...(row.mime_type != null ? { mimeType: row.mime_type } : {}),
    ...(row.loading_status != null
      ? { loadingStatus: row.loading_status }
      : {}),
    ...(row.loading_error != null ? { loadingError: row.loading_error } : {}),
    ...(row.loader_name != null ? { loaderName: row.loader_name } : {})
  };
}

/** Entity to API fields (snake_case); only the ones that are set. */
export function toLoadingResponseFields(entity: Entity): {
  mime_type?: string;
  loading_status?: LoadingStatus;
  loading_error?: string;
  loader_name?: string;
} {
  return {
    ...(entity.mimeType !== undefined ? { mime_type: entity.mimeType } : {}),
    ...(entity.loadingStatus !== undefined
      ? { loading_status: entity.loadingStatus }
      : {}),
    ...(entity.loadingError !== undefined
      ? { loading_error: entity.loadingError }
      : {}),
    ...(entity.loaderName !== undefined
      ? { loader_name: entity.loaderName }
      : {})
  };
}

/** A failed document is re-queued by a re-ingest once it used this many attempts. */
export const MAX_LOADING_ATTEMPTS = 3;
