CREATE TABLE oauth_clients (
  client_id text PRIMARY KEY,
  client_name text,
  redirect_uris text[] NOT NULL,
  grant_types text[] NOT NULL DEFAULT '{authorization_code,refresh_token}',
  response_types text[] NOT NULL DEFAULT '{code}',
  token_endpoint_auth_method text NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method = 'none'),
  scope text,
  client_uri text,
  logo_uri text,
  contacts text[],
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_authorization_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256'
    CHECK (code_challenge_method = 'S256'),
  resource text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_authorization_codes_client_id
  ON oauth_authorization_codes (client_id);

CREATE INDEX idx_oauth_authorization_codes_api_key_id
  ON oauth_authorization_codes (api_key_id);

CREATE TABLE oauth_tokens (
  access_token_hash text PRIMARY KEY,
  refresh_token_hash text UNIQUE NOT NULL,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  scopes text[] NOT NULL,
  resource text,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_tokens_refresh_token_hash
  ON oauth_tokens (refresh_token_hash);

CREATE INDEX idx_oauth_tokens_client_id
  ON oauth_tokens (client_id);

CREATE INDEX idx_oauth_tokens_api_key_id
  ON oauth_tokens (api_key_id);
