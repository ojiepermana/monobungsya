# ClickHouse migrator bootstrap

`project_observability_migrator` is intentionally a schema-only role. It can
create the `observability` database and tables, modify only table comments in
that database, and read the bounded catalog used by migration readiness. The
four canonical Signal tables carry the immutable schema marker in their table
comments. The role has no Signal-table `SELECT` or `INSERT`, no `GRANT OPTION`,
and no access-management privilege.

Both the migrator and readiness roles receive only the catalog `SELECT` and
schema-visibility `SHOW DATABASES`, `SHOW TABLES`, and `SHOW COLUMNS` grants
needed for the readiness query to see the canonical objects. Those metadata
grants do not grant Signal-table data reads or writes.

The first migration run must use a separately controlled ClickHouse bootstrap
administrator. That account is needed because the immutable baseline creates
roles and grants privileges; granting those rights to the runtime migrator would
let it change users, roles, or application data access. Record the bootstrap
run in `telemetry.signal_schema_migrations` through the normal migration runner.

Migration history is scoped by ClickHouse `serverUUID()`, which is persisted in
the node data directory. A rebuilt node therefore receives a new history and
replays the idempotent schema migrations even when PostgreSQL retains the
immutable history of a lost node. Pre target scoped rows stay in
`telemetry.signal_schema_migration_history_legacy` as audit history and are
never used to skip a target migration.

For a native proof, use the same PostgreSQL Control database for two separate
temporary server runs:

```sh
bun run observability:clickhouse:local --migrate-twice
bun run observability:clickhouse:local --migrate-twice
```

Within each run, the first migration pass applies the pending files and the
second pass is a no op for the same target UUID. The second temporary server
has a different target UUID, so its first pass applies the files again.

After the baseline has applied, an access administrator creates the service
identity in the deployment secret manager, assigns the role, and makes it the
default role:

```sql
CREATE USER IF NOT EXISTS observability_migrator IDENTIFIED WITH sha256_password BY '<managed-secret>';
GRANT project_observability_migrator TO observability_migrator;
ALTER USER observability_migrator DEFAULT ROLE project_observability_migrator;
```

Configure that identity only as `CLICKHOUSE_MIGRATOR_USERNAME` and
`CLICKHOUSE_MIGRATOR_PASSWORD`. Do not reuse it for writer, readiness, reader,
or operator credentials.

Install `../../clickhouse-config/20-query-log.xml` as a root owned
`/etc/clickhouse-server/config.d/20-query-log.xml` file before starting the
production service. It enables `system.query_log` and its seven day TTL. On a
new node, restart ClickHouse, run `SYSTEM FLUSH LOGS`, and verify `SHOW CREATE
TABLE system.query_log` includes the seven day `event_date` TTL. ClickHouse may
render the configured `INTERVAL 7 DAY DELETE` as `toIntervalDay(7)`. The file
is a server configuration artifact, not a runtime migration, so its presence
remains independently auditable.

The `0030` through `0036` immutable migrations grant the runtime migrator only
the DDL and catalog access listed above. Any future migration that changes
roles, users, or grants must be applied by the controlled bootstrap account (or
with a temporary, explicitly scoped elevation) and must not broaden the runtime
migrator role.
