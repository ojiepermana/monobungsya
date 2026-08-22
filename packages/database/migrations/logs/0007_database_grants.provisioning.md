# Database role provisioning

Create these PostgreSQL roles outside the migration runner, using DBA or infrastructure automation. Passwords and login attributes must come from the deployment secret manager.

| Role                        | Purpose                   | Database access                                                               |
| --------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `project_migrator`          | Runs database commands    | DDL and explicit grants on the application schemas and public tracking tables |
| `project_auth_runtime`      | Auth service runtime      | Full data access in `auth` only                                               |
| `project_user_runtime`      | User service runtime      | Full data access in `user` only                                               |
| `project_employee_runtime`  | Employee service runtime  | Full data access in `employee` only                                           |
| `project_payroll_runtime`   | Payroll service runtime   | Full data access in `payroll` only                                            |
| `project_reporting_runtime` | Reporting service runtime | Full data access in `reporting` only                                          |
| `project_logs_writer`       | Cross service logging     | Select and insert on the three `logs` tables, plus create on schema `partition` |

The migration `0007_database_grants` assumes these roles already exist. It does not create roles, set passwords, or grant login attributes.

Run the migration with `project_migrator` as the object owner. This ensures the default privileges in the migration apply to future tables created by the migration role.

Since `0010_logs_partitioned_tables`, the three log tables are yearly range partitioned parents owned by `project_logs_writer`, and children live in schema `partition`. Two extra provisioning steps apply:

- Grant `project_logs_writer` to `project_migrator` before running migrations (`GRANT project_logs_writer TO project_migrator;`), so the migration can transfer parent table ownership.
- Grant `project_logs_writer` to every service runtime role that writes or reads logs (for example `GRANT project_logs_writer TO project_auth_runtime;`). Membership gives the role insert and select through the parents and lets the shared `ensureLogPartition` helper create a missing yearly child at runtime.
