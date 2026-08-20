# 0002. Adopt central multischema database tooling

**Date**: 2026-08-20
**Status**: Accepted

## Summary

Project ini memakai satu runner database internal di `packages/database` dengan command yang terasa seperti Laravel, yaitu `db:migrate`, `db:seed`, dan `db:reset`. PostgreSQL 18 menjadi sumber primary key UUIDv7, sedangkan setiap service memiliki schema sendiri dalam satu database. Migration dan seed tetap berupa file SQL atau CSV yang dapat direview, bukan custom framework atau ORM.

## Context

Monorepo memiliki beberapa service Bun yang berbagi PostgreSQL, tetapi belum memiliki aturan tunggal untuk ownership schema, lifecycle migration, seed, reset, dan privilege. Contoh di `contekan/database` sudah membuktikan runner dasar dengan Bun SQL, tracking terpisah, pasangan file up dan down, serta seed CSV. Contoh itu masih memakai nama schema yang tidak sesuai dengan boundary service yang baru dan belum menjadi contract package shared.

Semua service perlu dapat berkembang dalam satu database tanpa menghapus ownership domain. Database juga harus memiliki primary key yang terurut berdasarkan waktu melalui UUIDv7 native PostgreSQL 18. Command database dapat mengubah DDL dan data dalam jumlah besar, sehingga retry, dua runner yang berjalan bersamaan, credential, reset destructive, dan perubahan file migration harus memiliki perilaku yang pasti.

> Premise note: Reset dengan drop database penuh memiliki risiko lebih besar daripada drop schema. Jika dipakai pada database development bersama, reset dapat menghapus data developer lain dan object non aplikasi. Karena tujuan reset hanya membersihkan object aplikasi, reset memakai drop schema allowlist dan tidak memiliki kemampuan menghapus database.

## Options considered

### Option 1: Central SQL runner in `packages/database`

Satu package menyediakan client dan runner generic. Source migration dan seed berada di `packages/database/migrations` serta `packages/database/seeds`, lalu root script mengekspos command database.

**Pros**:

- Satu aturan untuk semua service dan satu histori database.
- SQL tetap mudah direview dan tidak membuat service deployable membawa tooling operasional.
- Cocok dengan client Bun SQL yang sudah dipakai oleh service.

**Cons**:

- Perubahan schema domain harus melewati package pusat.
- Runner perlu mapping scope dan schema agar file service tidak dapat terselip.

### Option 2: Runner dan migration dimiliki setiap service

Setiap service memiliki client, command, tracking, migration, dan seed sendiri. Root dapat menyediakan command untuk memanggil semua service.

**Pros**:

- Ownership file dekat dengan pemilik business domain.
- Service lebih mudah dipindahkan ke repository terpisah.

**Cons**:

- Urutan migration lintas schema dan dependency antar domain menjadi sulit dijamin.
- Tracking, locking, reset, dan aturan UUID akan terduplikasi.
- Satu invocation root harus mengoordinasikan banyak process dan failure state.

### Option 3: ORM atau migration framework penuh

Project menggunakan ORM atau framework migration yang memiliki model, generator, dan lifecycle sendiri.

**Pros**:

- Beberapa metadata, diff schema, dan helper dapat tersedia dari library.
- Tim dapat mengikuti convention tool yang sudah dikenal.

**Cons**:

- Tidak ada kebutuhan ORM pada stack Bun SQL saat ini.
- SQL PostgreSQL khusus seperti partition dan grant dapat menjadi escape hatch yang sulit dilacak.
- Menambah dependency dan abstraction yang bertentangan dengan prinsip shared package minimal.

## Decision

**Chosen option**: Option 1: Central SQL runner in `packages/database`

Gunakan runner generic terpusat yang menjalankan migration secara serial berdasarkan nomor global, melacak schema dan seed secara terpisah, serta mengekspos command root `db:migrate`, `db:seed`, `db:reset`, dan `db:migrate:down`. `contekan/database` tetap menjadi referensi transisi sampai logic dan file canonical dipindahkan ke `packages/database`.

**Implementation skills**: none detected

## Rationale

Monorepo sudah memiliki `packages/database` sebagai pemilik client PostgreSQL yang dipakai semua service. Menempatkan runner dan source database di area yang sama menghindari duplikasi, tetapi migration tetap file SQL sehingga business domain tidak masuk ke generic package. Nomor global dan eksekusi serial cukup untuk ukuran database saat ini serta menjaga dependency lintas schema terlihat.

Pilihan drop schema allowlist diterima karena kebutuhan local dan test yang bersih tanpa memberi runner kemampuan menghapus database. Batas environment, `DATABASE_RESET_ALLOWED`, `--confirm`, advisory lock, dan larangan production adalah bagian wajib dari keputusan, bukan detail opsional. Checksum, transaksi per file, dan idempotensi seed menjaga retry dapat dipahami ketika command gagal.

## Standard definition

**Canonical pattern**:

```text
packages/database/
  migrations/
    auth/0001_auth_foundation.up.sql
    auth/0001_auth_foundation.down.sql
    user/0002_user_foundation.up.sql
    user/0002_user_foundation.down.sql
    logs/0003_logs_foundation.up.sql
  seeds/
    reference/auth/0001_users.users.sql
    reference/user/0002_user.users.csv
    fixtures/user/9001_test_users.users.csv
  src/
    client.ts
    runner.ts
    cli.ts

-- Every new application table follows this shape.
CREATE TABLE "user"."users" (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_users_id_uuidv7_check
    CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7)
);
```

### Schema ownership

| Scope       | PostgreSQL schema | Owner                | Notes                                                                                                |
| ----------- | ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `auth`      | `auth`            | Auth service         | Auth is the identity infrastructure scope. The schema name avoids confusion with the `user` service. |
| `user`      | `user`            | User service         | All user domain tables use this schema.                                                              |
| `employee`  | `employee`        | Employee service     | All employee domain tables use this schema.                                                          |
| `payroll`   | `payroll`         | Payroll service      | All payroll domain tables use this schema.                                                           |
| `reporting` | `reporting`       | Reporting service    | Reporting tables use this schema.                                                                    |
| `logs`      | `logs`            | Infrastructure scope | Logging and audit partitions stay in this schema.                                                    |

The runner has an explicit allowlist for these six scopes. It scans every directory under the configured migration and seed roots and rejects an unknown directory. An unknown scope or schema fails closed. Migration SQL must qualify every application object with its schema and table name. The runner must not rely on `search_path`. The old `users`, `log`, and separate `partition` schemas are not canonical. Partitioned tables and their partitions belong under `logs`.

Foreign keys may point to another table in the same owned schema. A service must not create a foreign key to another service schema. Cross service references store UUID values and are checked through the service or messaging boundary. Auth user identifiers are therefore UUID references without database foreign keys in other service schemas.

### Migration source and tracking

Migration files use `NNNN_name.up.sql` and a matching `NNNN_name.down.sql`. The numeric prefix and full migration name are globally unique across all scope directories. Files are discovered by scanning configured directory convention, sorted by full name, and executed serially. An unknown directory or duplicate name is an error before the first file runs.

Each up migration runs in its own transaction. The entire file is sent to PostgreSQL as SQL text. The runner never splits SQL by semicolon. A failed transaction leaves no tracking row and stops the command. A migration that has been applied cannot have its contents changed. The runner stores a SHA 256 hexadecimal checksum of the UTF 8 file contents and fails if it changes.

The runner owns these metadata tables in `public`:

| Table                      | Required columns                                                                                     | Constraints                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `public.schema_migrations` | `id uuid`, `name text`, `scope text`, `checksum char(64)`, `batch integer`, `applied_at timestamptz` | `id` is UUIDv7 primary key, `name` is globally unique, `batch` is positive, checksum is valid SHA 256 text. |
| `public.seed_migrations`   | `id uuid`, `name text`, `scope text`, `checksum char(64)`, `batch integer`, `applied_at timestamptz` | Same UUIDv7, uniqueness, batch, and checksum rules as schema tracking.                                      |

Every application table, including these metadata tables, must have an `id uuid` primary key with `DEFAULT uuidv7()` and a database check that the UUID version nibble is 7. Natural keys such as email, token, or migration name remain separate unique constraints and are not primary keys. Session identifiers must be migrated away from a string primary key when the auth schema is brought under this standard. The `logs` tables remain ordinary nonpartitioned tables until a measured volume or retention requirement justifies a separate partition decision.

The `batch` value is allocated per command invocation that applies at least one file. Schema tracking and seed tracking remain separate and have no foreign key relationship. A down command rolls back the latest applied migration files in reverse order. `--steps` counts migration files, not batches, while the batch column remains available for displaying deployment groups. The command fails before changing a file when a matching `.down.sql` is missing.

### Seed source and tracking

Seeds support SQL files and CSV files. The seed path contains an explicit set, normally `reference` or `fixtures`, followed by the scope. Production accepts only `reference` seeds. Fixture seeds are local and test data and must be rejected for production.

SQL seed statements and CSV inserts must both be idempotent. SQL seed files must use an explicit `ON CONFLICT DO NOTHING`, `ON CONFLICT DO UPDATE`, or an existence check inside a controlled block. CSV files use the target format `NNNN_schema.table.csv`, an RFC 4180 header, empty cells as `NULL`, and batches of 1000 rows per INSERT statement inside one transaction per file. `db:seed` fails with a clear message when schema migration is incomplete. It does not call `db:migrate` implicitly.

Schema rollback does not guess which seed rows were removed. `db:migrate:down` leaves seed tracking unchanged. After rolling back a schema that removed seeded data, the operator must run `db:seed:reset --service <name>` to clear seed tracking for that scope before replaying `db:seed`. The seed reset command removes tracking rows only and never deletes business rows.

### Command contract

| Command                                  | Contract                                                                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run db:migrate`                     | Uses `DATABASE_MIGRATION_URL`. Apply all unapplied migrations. `--service <name>` limits scope. `--dry-run` prints status, scope, name, and checksum without changing the database.                                                                |
| `bun run db:seed`                        | Uses `DATABASE_MIGRATION_URL`. Apply reference seeds after migration. `--service <name>` limits scope, `--set reference\|fixtures` selects a set, and `--dry-run` prints status, scope, name, and checksum.                                        |
| `bun run db:reset --confirm`             | Uses `DATABASE_MIGRATION_URL`. Development and test only. Drop every allowlisted application schema and both public tracking tables, then run all migrations. `--seed` also applies reference seeds. A service filter is invalid.                  |
| `bun run db:migrate:down`                | Uses `DATABASE_MIGRATION_URL`. Nonproduction recovery command. Roll back the latest migration files in reverse order, with optional `--steps <positive integer>` and optional `--service <name>`. It is not the normal production deployment path. |
| `bun run db:seed:reset --service <name>` | Uses `DATABASE_MIGRATION_URL`. Clear seed tracking for one scope so its idempotent seed files can be replayed. It does not delete business rows.                                                                                                   |

The `--service` value is an ownership name, not a PostgreSQL schema name. The mapping is one to one for `auth`, `user`, `employee`, `payroll`, `reporting`, and `logs`. A filtered command applies only matching files and never runs files from another scope automatically. Since migration order is globally serial, before applying a filtered file the runner verifies that every lower numbered migration in every scope is already tracked. Those earlier files are the implicit dependency model. If any is missing, the command fails and reports the missing names.

The runner checks PostgreSQL `server_version_num` before a command that connects to the database and fails unless the server major version is exactly 18. Before any migration or reset, it runs `SELECT uuidv7()` as a startup probe and fails with an actionable error if the native function is unavailable. Time columns use `timestamptz`, which stores an unambiguous instant. The application and reporting layer render instants in `Asia/Jakarta`; writers use `now()` and do not depend on a host local timezone.

### Reset and concurrency

The reset command requires all of the following:

- `NODE_ENV` is `development` or `test`.
- `DATABASE_RESET_ALLOWED=true` is present in the environment.
- `--confirm` is present.

Reset is never available in production and does not accept `--service`. It drops only the fixed schema names from the allowlist and the fixed public tracking table names. Schema and table identifiers come only from trusted runner constants and are safely quoted. It never drops or recreates the database and never acts on an identifier supplied directly by the command line.

All mutating commands take a PostgreSQL advisory lock on the target database through `DATABASE_MIGRATION_URL`, with a bounded timeout. The lock key is shared by migrate, seed, down, seed reset, and reset for the same target database. The reserved connection that owns the session lock must also execute the protected DDL, tracking, catalog validation, and seed operations. A lock timeout produces a nonzero exit code and a clear error.

### Roles and grants

The migration role from `DATABASE_MIGRATION_URL` may create and alter the allowlisted application schemas, metadata tables, indexes, and explicit grants. It is the role used by migration, seed, down, and reset commands. Runtime roles from `DATABASE_URL` are separate and cannot perform DDL.

The provisioning contract uses these fixed role names: `project_migrator`, `project_auth_runtime`, `project_user_runtime`, `project_employee_runtime`, `project_payroll_runtime`, `project_reporting_runtime`, and `project_logs_writer`. DBA or infrastructure automation creates these roles and manages their credentials outside the repository. Migration `0007_database_grants` only applies grants and never creates roles, passwords, or login attributes.

Each service runtime role receives usage and data privileges only on its owned schema. The logs scope grants `project_logs_writer` select and insert access to the three logging tables. No service runtime role receives unrestricted read or write access to another service schema. Grants are explicit in migration SQL or the controlled provisioning step and are not inferred from folder names. Default privileges for objects created by `project_migrator` must preserve the same scope grants for future tables.

### Enforcement

The TypeScript runner and CI checks enforce file naming, global name uniqueness, matching down files, scope allowlist, checksum stability, PostgreSQL version, the `uuidv7()` startup probe, advisory locking, and environment restrictions. After migration and reset, a catalog validation step checks every application table for an `id uuid` primary key, `uuidv7()` default, and version 7 check constraint. No other application table exemption exists. Dry run prints `[status, scope, name, checksum]` for each discovered file, where status is `pending`, `applied`, or `checksum-mismatch`, and exits nonzero for a checksum mismatch. The validator also checks the schema ownership map and rejects the old `users`, `log`, or `partition` schema.

Tests must cover a fresh reset, a second idempotent migrate, a failed migration transaction, checksum drift, filtered scope dependency failure, seed replay, production fixture rejection, lock timeout, missing down file, and reset refusal without every required safety condition. Command output contains file name, scope, duration, and row summary only. SQL text, credentials, and seed values must not be printed. Errors go to stderr and all failures use a nonzero exit code.

**Configuration**:

- `DATABASE_URL`: runtime connection with service specific privileges.
- `DATABASE_MIGRATION_URL`: migration role connection used by all database commands.
- `DATABASE_RESET_ALLOWED`: explicit nonproduction gate for destructive schema reset.
- `NODE_ENV`: must be `development` or `test` for reset.
- `DATABASE_TIMEZONE`: fixed to `Asia/Jakarta` for display and reporting conventions. Storage uses `timestamptz`.

**Rollout**:

- New migration and seed source uses this standard immediately.
- Move the working runner from `contekan/database` into `packages/database` without changing domain data in the same change.
- Add bootstrap migrations that create `auth`, `user`, `employee`, `payroll`, `reporting`, and `logs`.
- Rename the old `users` schema to `auth`, and replace old `log` and `partition` references with `logs` qualified names.
- Migrate existing natural or non UUIDv7 primary keys through explicit mapping utilities before enforcing the catalog validation on those tables.
- Add root scripts and CI checks, then remove duplicate operational logic from `contekan` after the package runner is verified.

**Exceptions**:

- No new application table may use a non UUIDv7 `id` primary key.
- Legacy import rows may not preserve a non v7 primary key. The import utility must generate a new UUIDv7 and persist a mapping for external references.
- PostgreSQL system schemas and system tables are outside the application catalog validation.
- A session table may retain a separate token or session key as a unique column, but its primary key still follows the UUIDv7 rule.

## Consequences

**Positive**:

- Service boundaries become visible in PostgreSQL names and privileges.
- Migration and seed behavior is deterministic, reviewable, and similar to Laravel without adopting Laravel or an ORM.
- UUIDv7 ordering is enforced by the database rather than caller discipline.
- A failed file can be retried without silently changing migration history.

**Negative / tradeoffs**:

- A central package must coordinate schema changes and global migration numbers.
- `timestamptz` requires reporting and presentation code to convert instants to Asia Jakarta when local wall time is needed.
- UUID remapping makes legacy imports more involved and requires downstream identifier mapping.
- Reset removes all allowlisted application schemas and needs a migration role with destructive DDL privilege in nonproduction.
- Catalog validation and explicit grants add implementation and CI work before the standard is fully enforced.

**Neutral**:

- Services continue to use the existing Bun SQL client API and do not import migration source as business code.
- `logs` is an infrastructure scope rather than a new deployable service.
- Production deployment may run migrate and safe reference seed, but never reset.

## Follow-up

- [x] Add root `db:migrate`, `db:seed`, `db:reset`, and `db:migrate:down` scripts that invoke `packages/database`.
- [x] Move and adapt the `contekan/database` runner and migration files into the canonical package location.
- [x] Add `DATABASE_MIGRATION_URL` and `DATABASE_RESET_ALLOWED` to environment documentation and deployment configuration.
- [x] Apply the UUIDv7 primary key rule to the canonical auth session model and all current application tables.
- [x] Add the catalog validator and command tests, including checksum drift coverage.
- [x] Keep `logs.logging`, `logs.audit_trails`, and `logs.access_logs` nonpartitioned until measured volume or retention requirements justify a separate architecture decision.
- [x] Define fixed PostgreSQL role names and apply explicit runtime grants through migration `0007_database_grants`; role creation and credentials remain outside the repository.

## References

**Project sources**:

- `docs/specs/0001-enterprise-monorepo-foundation.md`, shared database package and service boundary decisions.
- `packages/database/src/index.ts`, existing Bun SQL client and transaction helper.
- `contekan/database/README.md`, pointer preserved after the working runner moved to the canonical package.
- `packages/database/migrations/auth` and `packages/database/migrations/logs`, canonical UUIDv7 and schema implementation.
- `docs/specs/0001-enterprise-monorepo-foundation.md`, monorepo boundary and minimal shared package constraints.

**Practices & standards**:

- Database migrations as immutable, ordered, reviewable source files.
- One transaction per migration file and idempotent seed data.
- PostgreSQL advisory locks for cross process migration serialization.
- Least privilege for runtime database roles.
- Explicit identifier mapping during legacy primary key migration.
