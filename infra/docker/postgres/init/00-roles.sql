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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_employee_runtime') THEN
    CREATE ROLE project_employee_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_payroll_runtime') THEN
    CREATE ROLE project_payroll_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_reporting_runtime') THEN
    CREATE ROLE project_reporting_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_logs_writer') THEN
    CREATE ROLE project_logs_writer NOLOGIN;
  END IF;
END
$$;
