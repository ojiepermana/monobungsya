DROP INDEX IF EXISTS "auth".auth_login_tokens_invitation_active_idx;

ALTER TABLE "auth"."login_tokens"
  DROP CONSTRAINT IF EXISTS auth_login_tokens_purpose_check,
  DROP COLUMN IF EXISTS purpose;
