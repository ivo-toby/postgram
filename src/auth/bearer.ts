import type { Pool } from 'pg';

import { AppError, ErrorCode } from '../util/errors.js';
import { validateKey } from './key-service.js';
import { validateOAuthAccessToken } from './oauth-service.js';
import type { AuthContext } from './types.js';

export async function validateBearerToken(
  pool: Pool,
  plaintextToken: string
): Promise<AuthContext> {
  const apiKeyResult = await validateKey(pool, plaintextToken);
  if (apiKeyResult.isOk()) {
    return apiKeyResult.value;
  }

  if (apiKeyResult.error.code !== ErrorCode.UNAUTHORIZED) {
    throw apiKeyResult.error;
  }

  const oauthAuth = await validateOAuthAccessToken(pool, plaintextToken);
  if (oauthAuth) {
    return oauthAuth;
  }

  throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid API key');
}
