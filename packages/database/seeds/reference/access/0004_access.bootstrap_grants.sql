DO $$
DECLARE
  configured_email text;
  matched_count integer;
BEGIN
  FOR configured_email IN
    SELECT lower(trim(value))
    FROM regexp_split_to_table(
      coalesce(current_setting('app.access_bootstrap_admin_emails', true), ''),
      ','
    ) AS value
    WHERE trim(value) <> ''
  LOOP
    SELECT count(*) INTO matched_count
    FROM "user"."users"
    WHERE lower(email) = configured_email;

    IF matched_count = 0 THEN
      RAISE WARNING 'ACCESS_BOOTSTRAP_ADMIN_EMAILS email has no matching user row: %', configured_email;
    END IF;
  END LOOP;
END
$$;

INSERT INTO "access"."permission_user" (permission_id, user_id)
SELECT permission.id, users.id
FROM "user"."users" AS users
JOIN regexp_split_to_table(
  coalesce(current_setting('app.access_bootstrap_admin_emails', true), ''),
  ','
) AS configured(value)
  ON lower(users.email) = lower(trim(configured.value))
CROSS JOIN "access"."permission" AS permission
WHERE trim(configured.value) <> ''
ON CONFLICT (permission_id, user_id) DO NOTHING;
