-- Roles are provisioned outside migrations by DBA or infrastructure automation.
-- This migration only applies least privilege grants to existing roles.

GRANT USAGE ON SCHEMA "auth" TO "project_auth_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "auth" TO "project_auth_runtime";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "auth" TO "project_auth_runtime";

GRANT USAGE ON SCHEMA "user" TO "project_user_runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "user" TO "project_user_runtime";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "user" TO "project_user_runtime";

GRANT USAGE ON SCHEMA "logs" TO "project_logs_writer";
GRANT INSERT, SELECT ON "logs"."audit_trails" TO "project_logs_writer";

ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "auth"
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "project_auth_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "user"
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "project_user_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "logs"
	GRANT SELECT, INSERT ON TABLES TO "project_logs_writer";
