import type { ResultAsync } from 'neverthrow';

import type { AppError } from '../util/errors.js';

export type ServiceResult<T> = ResultAsync<T, AppError>;

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
