ALTER TABLE "user"."users"
  ADD COLUMN IF NOT EXISTS totp_required_at timestamptz NULL;
