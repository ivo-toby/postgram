import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getOAuthClient,
  getOAuthResource,
  getOAuthProtectedResourceMetadataUrl,
  normalizePublicBaseUrl,
  OAuthHttpError,
  OAUTH_SCOPES,
  refreshOAuthToken,
  registerOAuthClient,
  revokeOAuthToken,
  toOAuthClientRegistrationResponse
} from '../auth/oauth-service.js';
import { AppError, ErrorCode, toErrorResponse, toHttpStatus } from '../util/errors.js';

type OAuthApp = Hono<{ Variables: { auth: AuthContext } }>;

export type OAuthRouteOptions = {
  publicBaseUrl: string;
};

function oauthErrorResponse(error: OAuthHttpError) {
  return {
    error: error.oauthError,
    error_description: error.message
  };
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

function getRequiredString(
  value: unknown,
  name: string
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthHttpError(400, 'invalid_request', `${name} is required`);
  }

  return value;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }

  return undefined;
}

async function parseJsonBody(c: Context) {
  try {
    return await c.req.json<Record<string, unknown>>();
  } catch {
    throw new OAuthHttpError(400, 'invalid_request', 'Expected JSON request body');
  }
}

async function parseFormBody(c: Context) {
  const body = await c.req.parseBody();
  return body as Record<string, unknown>;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAuthorizePage(input: {
  clientName: string;
  params: Record<string, string>;
  error?: string;
}): string {
  const hiddenFields = Object.entries(input.params)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}">`
    )
    .join('\n');
  const error = input.error
    ? `<p role="alert" style="color:#b00020">${htmlEscape(input.error)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize Postgram</title>
    <style>
      body {
        color: #1f2933;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 32px;
      }
      main {
        margin: 0 auto;
        max-width: 520px;
      }
      label {
        display: block;
        font-weight: 600;
        margin: 24px 0 8px;
      }
      input[type="password"] {
        box-sizing: border-box;
        font: inherit;
        padding: 10px 12px;
        width: 100%;
      }
      button {
        font: inherit;
        margin-top: 16px;
        padding: 10px 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize Postgram</h1>
      <p>${htmlEscape(input.clientName)} is requesting access to Postgram.</p>
      ${error}
      <form method="post" action="/oauth/authorize">
        ${hiddenFields}
        <label for="api_key">Postgram API key</label>
        <input id="api_key" name="api_key" type="password" autocomplete="off" required>
        <button type="submit">Authorize</button>
      </form>
    </main>
  </body>
</html>`;
}

function handleOAuthError(
  c: Context,
  error: unknown
) {
  if (error instanceof OAuthHttpError) {
    return withNoStore(
      c.json(
        oauthErrorResponse(error),
        error.status as ContentfulStatusCode
      )
    );
  }

  const appError =
    error instanceof AppError
      ? error
      : new AppError(ErrorCode.INTERNAL, 'OAuth request failed');
  return c.json(
    toErrorResponse(appError),
    toHttpStatus(appError.code) as ContentfulStatusCode
  );
}

export function registerOAuthRoutes(
  app: OAuthApp,
  pool: Pool,
  options: OAuthRouteOptions
): void {
  const publicBaseUrl = normalizePublicBaseUrl(options.publicBaseUrl);
  const resource = getOAuthResource(publicBaseUrl);

  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: publicBaseUrl,
      authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${publicBaseUrl}/oauth/token`,
      registration_endpoint: `${publicBaseUrl}/oauth/register`,
      revocation_endpoint: `${publicBaseUrl}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: OAUTH_SCOPES
    })
  );

  app.get('/.well-known/oauth-protected-resource/mcp', (c) =>
    c.json({
      resource,
      authorization_servers: [publicBaseUrl],
      scopes_supported: OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Postgram MCP'
    })
  );

  app.post('/oauth/register', async (c) => {
    try {
      const body = await parseJsonBody(c);
      const client = await registerOAuthClient(pool, {
        client_name: getOptionalString(body.client_name),
        redirect_uris: toStringArray(body.redirect_uris),
        grant_types: toStringArray(body.grant_types),
        response_types: toStringArray(body.response_types),
        token_endpoint_auth_method: getOptionalString(
          body.token_endpoint_auth_method
        ),
        scope: getOptionalString(body.scope),
        client_uri: getOptionalString(body.client_uri),
        logo_uri: getOptionalString(body.logo_uri),
        contacts: toStringArray(body.contacts)
      });

      return withNoStore(
        c.json(toOAuthClientRegistrationResponse(client), 201)
      );
    } catch (error) {
      return handleOAuthError(c, error);
    }
  });

  app.get('/oauth/authorize', async (c) => {
    const params = c.req.query();
    const clientId = params.client_id;
    const client = clientId ? await getOAuthClient(pool, clientId) : null;

    if (!client) {
      return withNoStore(
        c.html(
          renderAuthorizePage({
            clientName: 'Unknown OAuth client',
            params,
            error: 'OAuth client is not registered.'
          }),
          401
        )
      );
    }

    return withNoStore(
      c.html(
        renderAuthorizePage({
          clientName: client.clientName ?? client.clientId,
          params
        })
      )
    );
  });

  app.post('/oauth/authorize', async (c) => {
    const body = await parseFormBody(c);
    const redirectUri = getRequiredString(body.redirect_uri, 'redirect_uri');
    const state = getOptionalString(body.state);

    try {
      const code = await createAuthorizationCode(pool, {
        publicBaseUrl,
        responseType: getRequiredString(body.response_type, 'response_type'),
        clientId: getRequiredString(body.client_id, 'client_id'),
        redirectUri,
        codeChallenge: getRequiredString(body.code_challenge, 'code_challenge'),
        codeChallengeMethod: getRequiredString(
          body.code_challenge_method,
          'code_challenge_method'
        ),
        resource: getOptionalString(body.resource),
        apiKey: getRequiredString(body.api_key, 'api_key')
      });
      const redirect = new URL(redirectUri);
      redirect.searchParams.set('code', code);
      if (state) {
        redirect.searchParams.set('state', state);
      }

      return withNoStore(c.redirect(redirect.toString(), 302));
    } catch (error) {
      if (error instanceof OAuthHttpError && error.oauthError === 'access_denied') {
        const clientId = getOptionalString(body.client_id);
        const client = clientId ? await getOAuthClient(pool, clientId) : null;
        return withNoStore(
          c.html(
            renderAuthorizePage({
              clientName: client?.clientName ?? client?.clientId ?? 'OAuth client',
              params: Object.fromEntries(
                Object.entries(body)
                  .filter(([key]) => key !== 'api_key')
                  .map(([key, value]) => [key, String(value)])
              ),
              error: error.message
            }),
            401
          )
        );
      }

      return handleOAuthError(c, error);
    }
  });

  app.post('/oauth/token', async (c) => {
    try {
      const body = await parseFormBody(c);
      const grantType = getRequiredString(body.grant_type, 'grant_type');
      const clientId = getRequiredString(body.client_id, 'client_id');

      if (grantType === 'authorization_code') {
        return withNoStore(
          c.json(
            await exchangeAuthorizationCode(pool, {
              publicBaseUrl,
              clientId,
              code: getRequiredString(body.code, 'code'),
              redirectUri: getRequiredString(body.redirect_uri, 'redirect_uri'),
              codeVerifier: getRequiredString(
                body.code_verifier,
                'code_verifier'
              ),
              resource: getOptionalString(body.resource)
            })
          )
        );
      }

      if (grantType === 'refresh_token') {
        return withNoStore(
          c.json(
            await refreshOAuthToken(pool, {
              publicBaseUrl,
              clientId,
              refreshToken: getRequiredString(body.refresh_token, 'refresh_token'),
              resource: getOptionalString(body.resource)
            })
          )
        );
      }

      throw new OAuthHttpError(
        400,
        'unsupported_grant_type',
        'Only authorization_code and refresh_token are supported'
      );
    } catch (error) {
      return handleOAuthError(c, error);
    }
  });

  app.post('/oauth/revoke', async (c) => {
    try {
      const body = await parseFormBody(c);
      await revokeOAuthToken(pool, {
        clientId: getRequiredString(body.client_id, 'client_id'),
        token: getRequiredString(body.token, 'token')
      });

      return withNoStore(c.body(null, 200));
    } catch (error) {
      return handleOAuthError(c, error);
    }
  });
}

export function getConfiguredOAuthResourceMetadataUrl(
  publicBaseUrl: string | undefined
): string | undefined {
  return publicBaseUrl
    ? getOAuthProtectedResourceMetadataUrl(publicBaseUrl)
    : undefined;
}
