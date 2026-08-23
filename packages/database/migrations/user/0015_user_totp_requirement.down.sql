ALTER TABLE "user"."users"
  DROP COLUMN IF EXISTS totp_required_at;
