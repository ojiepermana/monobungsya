CREATE SCHEMA IF NOT EXISTS "auth";

CREATE TABLE IF NOT EXISTS "auth"."users" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  role varchar(50) NOT NULL DEFAULT 'bi',
  name varchar(255) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  email_verified_at timestamptz NULL,
  suspended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NULL,
  CONSTRAINT auth_users_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT auth_users_role_check
    CHECK (role IN ('admin', 'manager', 'bi', 'staff', 'legacy'))
);

CREATE TABLE IF NOT EXISTS "auth"."login_tokens" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES "auth"."users"(id) ON DELETE CASCADE,
  token varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NULL,
  CONSTRAINT auth_login_tokens_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE TABLE IF NOT EXISTS "auth"."sessions" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  session_key varchar(128) NOT NULL UNIQUE,
  user_id uuid NULL REFERENCES "auth"."users"(id) ON DELETE CASCADE,
  ip_address varchar(45) NULL,
  user_agent text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE TABLE IF NOT EXISTS "auth"."auth_rate_limits" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key_hash char(64) NOT NULL UNIQUE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_rate_limits_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
  ON "auth"."sessions" (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_last_activity_idx
  ON "auth"."sessions" (last_activity);
CREATE INDEX IF NOT EXISTS auth_login_tokens_user_expiry_idx
  ON "auth"."login_tokens" (user_id, expires_at)
  WHERE used_at IS NULL;
