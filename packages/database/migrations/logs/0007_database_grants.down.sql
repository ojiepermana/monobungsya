REVOKE SELECT ON "logs"."logging", "logs"."audit_trails", "logs"."access_logs" FROM "project_logs_writer";
REVOKE INSERT ON "logs"."logging", "logs"."audit_trails", "logs"."access_logs" FROM "project_logs_writer";
REVOKE USAGE ON SCHEMA "logs" FROM "project_logs_writer";

ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "logs"
	REVOKE SELECT, INSERT ON TABLES FROM "project_logs_writer";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "user"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_user_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "auth"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_auth_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "user" FROM "project_user_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "user" FROM "project_user_runtime";
REVOKE USAGE ON SCHEMA "user" FROM "project_user_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "auth" FROM "project_auth_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "auth" FROM "project_auth_runtime";
REVOKE USAGE ON SCHEMA "auth" FROM "project_auth_runtime";
