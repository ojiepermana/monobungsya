ALTER TABLE "auth"."login_tokens"
  ADD COLUMN token_hash char(64);

UPDATE "auth"."login_tokens"
SET token_hash = encode(sha256(token::bytea), 'hex')
WHERE token_hash IS NULL;

ALTER TABLE "auth"."login_tokens"
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE "auth"."login_tokens"
  DROP COLUMN token;

ALTER TABLE "auth"."login_tokens"
  ADD CONSTRAINT auth_login_tokens_token_hash_unique UNIQUE (token_hash),
  ADD CONSTRAINT auth_login_tokens_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE "auth"."sessions"
  ADD COLUMN session_token_hash char(64),
  ADD COLUMN idle_expires_at timestamptz NOT NULL DEFAULT (now() + interval '8 hours'),
  ADD COLUMN absolute_expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  ADD COLUMN revoked_at timestamptz NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE "auth"."sessions"
SET session_token_hash = encode(sha256(session_key::bytea), 'hex')
WHERE session_token_hash IS NULL;

ALTER TABLE "auth"."sessions"
  ALTER COLUMN session_token_hash SET NOT NULL;

ALTER TABLE "auth"."sessions"
  DROP COLUMN session_key;

ALTER TABLE "auth"."sessions"
  ADD CONSTRAINT auth_sessions_session_token_hash_unique UNIQUE (session_token_hash),
  ADD CONSTRAINT auth_sessions_session_token_hash_check
    CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT auth_sessions_expiry_order_check
    CHECK (absolute_expires_at > idle_expires_at);

ALTER TABLE "auth"."auth_rate_limits"
  ADD COLUMN key_type varchar(20) NOT NULL DEFAULT 'email';

ALTER TABLE "auth"."auth_rate_limits"
  DROP CONSTRAINT IF EXISTS auth_rate_limits_key_hash_key;

ALTER TABLE "auth"."auth_rate_limits"
  ADD CONSTRAINT auth_rate_limits_key_type_check
    CHECK (key_type IN ('email', 'ip')),
  ADD CONSTRAINT auth_rate_limits_key_type_hash_unique
    UNIQUE (key_type, key_hash);

CREATE INDEX IF NOT EXISTS auth_login_tokens_active_idx
  ON "auth"."login_tokens" (token_hash, expires_at)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx
  ON "auth"."sessions" (session_token_hash, idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_cleanup_idx
  ON "auth"."sessions" (idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx
  ON "auth"."auth_rate_limits" (updated_at);
