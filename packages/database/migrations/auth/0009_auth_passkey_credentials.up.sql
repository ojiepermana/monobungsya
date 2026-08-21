CREATE TABLE IF NOT EXISTS "auth"."passkey_credentials" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES "user"."users"(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NULL,
  aaguid uuid NULL,
  label text NOT NULL,
  backup_eligible boolean NOT NULL DEFAULT false,
  backup_state boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  CONSTRAINT auth_passkey_credentials_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT auth_passkey_credentials_counter_check
    CHECK (counter >= 0),
  CONSTRAINT auth_passkey_credentials_label_check
    CHECK (char_length(btrim(label)) BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS "auth"."webauthn_challenges" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  type varchar(20) NOT NULL,
  user_id uuid NULL REFERENCES "user"."users"(id) ON DELETE CASCADE,
  challenge text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_webauthn_challenges_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
  CONSTRAINT auth_webauthn_challenges_type_check
    CHECK (type IN ('registration', 'authentication')),
  CONSTRAINT auth_webauthn_challenges_registration_user_check
    CHECK (type <> 'registration' OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS auth_passkey_credentials_user_id_idx
  ON "auth"."passkey_credentials" (user_id);
CREATE INDEX IF NOT EXISTS auth_webauthn_challenges_active_idx
  ON "auth"."webauthn_challenges" (challenge, expires_at)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_webauthn_challenges_cleanup_idx
  ON "auth"."webauthn_challenges" (expires_at, used_at);

ALTER TABLE "auth"."auth_rate_limits"
  DROP CONSTRAINT IF EXISTS auth_rate_limits_key_type_check;

ALTER TABLE "auth"."auth_rate_limits"
  ADD CONSTRAINT auth_rate_limits_key_type_check
    CHECK (key_type IN ('email', 'ip', 'passkey_ip'));

-- Roles are provisioned outside migrations; grant only when the runtime role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_auth_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "auth"."passkey_credentials", "auth"."webauthn_challenges"
      TO "project_auth_runtime";
  END IF;
END
$$;
