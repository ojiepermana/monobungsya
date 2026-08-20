REVOKE SELECT ON "logs"."logging", "logs"."audit_trails", "logs"."access_logs" FROM "project_logs_writer";
REVOKE INSERT ON "logs"."logging", "logs"."audit_trails", "logs"."access_logs" FROM "project_logs_writer";
REVOKE USAGE ON SCHEMA "logs" FROM "project_logs_writer";

ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "logs"
	REVOKE SELECT, INSERT ON TABLES FROM "project_logs_writer";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "reporting"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_reporting_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "payroll"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_payroll_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "employee"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_employee_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "user"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_user_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "project_migrator" IN SCHEMA "auth"
	REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "project_auth_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "reporting" FROM "project_reporting_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "reporting" FROM "project_reporting_runtime";
REVOKE USAGE ON SCHEMA "reporting" FROM "project_reporting_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "payroll" FROM "project_payroll_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "payroll" FROM "project_payroll_runtime";
REVOKE USAGE ON SCHEMA "payroll" FROM "project_payroll_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "employee" FROM "project_employee_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "employee" FROM "project_employee_runtime";
REVOKE USAGE ON SCHEMA "employee" FROM "project_employee_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "user" FROM "project_user_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "user" FROM "project_user_runtime";
REVOKE USAGE ON SCHEMA "user" FROM "project_user_runtime";

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "auth" FROM "project_auth_runtime";
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "auth" FROM "project_auth_runtime";
REVOKE USAGE ON SCHEMA "auth" FROM "project_auth_runtime";
