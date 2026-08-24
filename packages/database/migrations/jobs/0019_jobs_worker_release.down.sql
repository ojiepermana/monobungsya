DO $$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'project_auth_runtime'::name,
    'project_access_runtime'::name,
    'project_user_runtime'::name,
    'project_jobs_runtime'::name
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION "jobs".release_job(uuid, varchar) FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS "jobs".release_job(uuid, varchar);
