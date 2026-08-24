ALTER TABLE "auth"."login_tokens"
  ADD COLUMN IF NOT EXISTS purpose varchar(20) NOT NULL DEFAULT 'login';

ALTER TABLE "auth"."login_tokens"
  DROP CONSTRAINT IF EXISTS auth_login_tokens_purpose_check,
  ADD CONSTRAINT auth_login_tokens_purpose_check
    CHECK (purpose IN ('login', 'invitation'));

CREATE INDEX IF NOT EXISTS auth_login_tokens_invitation_active_idx
  ON "auth"."login_tokens" (user_id, expires_at)
  WHERE purpose = 'invitation' AND used_at IS NULL;
