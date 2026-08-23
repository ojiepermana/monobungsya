CREATE TABLE IF NOT EXISTS "auth"."totp_credentials" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL UNIQUE REFERENCES "user"."users"(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  confirmed_at timestamptz NULL,
  last_used_step bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_totp_credentials_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT auth_totp_credentials_last_used_step_check
    CHECK (last_used_step IS NULL OR last_used_step >= 0)
);

CREATE TABLE IF NOT EXISTS "auth"."totp_recovery_codes" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES "user"."users"(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_totp_recovery_codes_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT auth_totp_recovery_codes_hash_check
    CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_totp_recovery_codes_user_hash_unique
    UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS "auth"."mfa_challenges" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES "user"."users"(id) ON DELETE CASCADE,
  purpose varchar(20) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_mfa_challenges_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT auth_mfa_challenges_purpose_check
    CHECK (purpose IN ('login', 'enroll')),
  CONSTRAINT auth_mfa_challenges_attempts_check
    CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS auth_totp_recovery_codes_user_idx
  ON "auth"."totp_recovery_codes" (user_id, used_at);
CREATE INDEX IF NOT EXISTS auth_mfa_challenges_cleanup_idx
  ON "auth"."mfa_challenges" (expires_at, used_at);

ALTER TABLE "auth"."auth_rate_limits"
  DROP CONSTRAINT IF EXISTS auth_rate_limits_key_type_check;

ALTER TABLE "auth"."auth_rate_limits"
  ADD CONSTRAINT auth_rate_limits_key_type_check
    CHECK (key_type IN ('email', 'ip', 'passkey_ip', 'totp_ip', 'totp_user'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_auth_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "auth"."totp_credentials", "auth"."totp_recovery_codes", "auth"."mfa_challenges"
      TO "project_auth_runtime";
  END IF;
END
$$;
