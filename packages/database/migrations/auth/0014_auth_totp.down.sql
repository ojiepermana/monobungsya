ALTER TABLE "auth"."auth_rate_limits"
  DROP CONSTRAINT IF EXISTS auth_rate_limits_key_type_check;

DELETE FROM "auth"."auth_rate_limits"
WHERE key_type IN ('totp_ip', 'totp_user');

ALTER TABLE "auth"."auth_rate_limits"
  ADD CONSTRAINT auth_rate_limits_key_type_check
    CHECK (key_type IN ('email', 'ip', 'passkey_ip'));

DROP TABLE IF EXISTS "auth"."mfa_challenges";
DROP TABLE IF EXISTS "auth"."totp_recovery_codes";
DROP TABLE IF EXISTS "auth"."totp_credentials";
