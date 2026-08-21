DROP TABLE IF EXISTS "auth"."webauthn_challenges";
DROP TABLE IF EXISTS "auth"."passkey_credentials";

ALTER TABLE "auth"."auth_rate_limits"
  DROP CONSTRAINT IF EXISTS auth_rate_limits_key_type_check;

DELETE FROM "auth"."auth_rate_limits"
WHERE key_type NOT IN ('email', 'ip');

ALTER TABLE "auth"."auth_rate_limits"
  ADD CONSTRAINT auth_rate_limits_key_type_check
    CHECK (key_type IN ('email', 'ip'));
