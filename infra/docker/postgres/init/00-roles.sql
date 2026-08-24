DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator') THEN
    CREATE ROLE project_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_auth_runtime') THEN
    CREATE ROLE project_auth_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_user_runtime') THEN
    CREATE ROLE project_user_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_access_runtime') THEN
    CREATE ROLE project_access_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_logs_writer') THEN
    CREATE ROLE project_logs_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_jobs_runtime') THEN
    CREATE ROLE project_jobs_runtime NOLOGIN;
  END IF;
END
$$;
