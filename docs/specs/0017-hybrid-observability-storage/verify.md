# 0017. Verification plan

Run verification against the exact ClickHouse patch and production hardware profile recorded by the implementation. Do not use Docker or Docker Compose.

## Static and contract checks

* [ ] Run repository typecheck, lint, dependency, observability, OpenAPI, generated SDK, and progress checks. Prove producers only depend on the four method `ObservabilitySignalStore` interface and Audit Trail does not import it. Covers **AC-1**, **AC-3**, **AC-4**, and **AC-23**.
* [ ] Run the same adapter contract suite against fake, PostgreSQL, and ClickHouse adapters. Prove accepted or dropped results, bounded flush, bounded shutdown, diagnostics, retry identity, and unchanged business exceptions. Covers **AC-4**, **AC-8**, and **AC-9**.
* [ ] Run carried telemetry, propagation, sampling, metric aggregation, Elysia lifecycle, benchmark, baseline, ingestion, alert, and permission suites. Compare benchmark overhead with the accepted gates. Covers **AC-1**, **AC-2**, and **AC-13**.

## Schema and migration checks

* [ ] Start the pinned native ClickHouse binary with the repo local script and a temporary data directory. Run migrations twice. Prove the second run is a no op, checksums match PostgreSQL history, and a changed applied file fails as drift. Covers **AC-20** and **AC-23**.
* [ ] Inspect all four canonical tables. Prove engine, version, UTC daily partition, sort key order, schema version, required fields, TTL, deduplication setting, role grants, and logical relationships match the spec. Covers **AC-3**, **AC-5**, **AC-6**, **AC-7**, **AC-18**, and **AC-20**.
* [ ] Advance logical time or use bounded fixtures around TTL. Prove query time guards hide expired rows immediately and background cleanup completes within four hours without cold archive. Covers **AC-6**.
* [ ] Present wrong binary, missing database, schema drift, and invalid async settings at startup. Prove Signal storage becomes disabled, business readiness stays ready, health shows Blind Spot, and deployment verification fails. Covers **AC-20**.

## Writer and failure checks

* [ ] Send Span, Metric Bucket, Application Log, and Access Log through real HTTP inserts with `async_insert=1` and `wait_for_async_insert=1`. Prove only disk flush ACK increments written count and a retry uses identical row content, write version, and insert token. Covers **AC-5**, **AC-8**, and **AC-9**.
* [ ] Fill item and byte queue caps independently. Prove 20 percent priority reserve retains error, slow, and access failure Signal before low priority data, no kind starves, memory stays bounded, and every drop reason is counted. Covers **AC-8**, **AC-9**, and **AC-10**.
* [ ] Inject network failure, timeout, 429, 5xx, authentication failure, schema failure, one poison row, and shutdown timeout. Prove three retries maximum, recursive isolation, sanitized diagnostic, accurate Blind Spot start, and unchanged request, transaction, message, job, and process result. Covers **AC-7**, **AC-9**, and **AC-18**.
* [ ] Send expired, future skewed, malformed, and over 4 KiB Signal. Prove they are rejected before network write with stable diagnostic and monotonic duration remains unchanged by wall clock skew. Covers **AC-7**.

## Read and control checks

* [ ] Query every allowed time preset and maximum custom range. Prove Span rejects over seven days, other Signal rejects over 30 days, options use the same scope, and missing Metric Bucket renders a gap. Covers **AC-11** and **AC-13**.
* [ ] Traverse at least three pages forward and two backward for Trace, Application Log, and Access Log. Prove stable row order, page sizes, null boundary cursors, no exact total, filter fingerprint rejection, and expired cursor 422. Prove Audit Trail paging and exact totals remain unchanged. Covers **AC-12**, **AC-13**, and **AC-14**.
* [ ] Saturate eight query slots and exceed both hard deadlines. Prove immediate 429 with `Retry-After`, bounded ClickHouse cancellation, allowlisted fields, parameter binding, and no healthy empty response. Covers **AC-14** and **AC-15**.
* [ ] Stop ClickHouse. Prove Signal list returns 200 with empty data plus `blind_spot`, Signal detail returns 503, expired detail returns 404 when storage is available, and PostgreSQL Control routes retain their own 503 semantics. Covers **AC-14**.
* [ ] Call storage health with no identity, wrong permission, one valid observability permission, and through the gateway. Prove 401, 403, sanitized success, and no gateway route respectively. Covers **AC-16** and **AC-18**.
* [ ] Fail two 30 second health probes and recover three. Prove PostgreSQL availability alert pending, firing, then resolved, one idempotent notification per transition, ordinary metric alerts unknown during failure, and disk thresholds at 70, 80, and 90 percent. Covers **AC-17**.
* [ ] Attempt writer SELECT, reader INSERT, runtime DDL, plaintext production connection, and sensitive fixture ingestion. Prove each is denied or sanitized and query log access is operator only with seven day retention. Covers **AC-18**.

## Capacity checks

* [ ] Seed full retention data and run the versioned mixed and per entity fixtures on the production hardware profile. Run 60 minutes steady, 15 minutes 10 times burst, and 30 minutes recovery with concurrent query mix. Covers **AC-10**, **AC-11**, **AC-15**, and **AC-19**.
* [ ] Verify at least 99.9 percent batch acceptance, freshness `p95` at most five seconds, query `p95` at most two or five seconds by range, bounded queue, recovered merge debt, no crash, and instrumentation overhead gates. Covers **AC-2**, **AC-8**, **AC-10**, and **AC-11**.
* [ ] Verify retained compressed bytes plus 30 percent merge headroom use at most 80 percent of disk and leave at least 20 percent free. Covers **AC-17** and **AC-19**.

## Migration and recovery checks

* [ ] Run writer states `postgres`, `dual`, and `clickhouse` plus both valid reader transitions. Prove invalid combinations fail configuration and dual results are recorded independently. Covers **AC-21**.
* [ ] Backfill multiple daily ranges oldest first, interrupt every page boundary, and resume. Prove no lost or duplicated latest identity, committed cursor behavior, 30 percent resource limit, and auto pause on every guard. Covers **AC-21**.
* [ ] Prove full source and target counts match, deterministic sample checksums match 100 percent, fixed query parity passes, seven shadow days are represented, and promotion cannot proceed when one gate fails. Prove immutable Control activation starts at `postgres/postgres`, requires each exact prior mode, binds the configured report once, and records rollback explicitly. Covers **AC-21** and **AC-22**.
* [ ] Cut reader to ClickHouse, roll back without deployment during the seven day shadow period, cut writer, then run `observability:postgres:legacy-write-policy --action lock` with the exact active activation confirmation. Authenticate every URL as the configured migration login and prove it must `SET LOCAL ROLE project_migrator`; a runtime login, missing membership, unexpected session user, or concurrent activation must fail before policy DDL. Prove all four PostgreSQL Signal relation trees reject runtime write privilege, only Signal log ownership moves to `project_migrator`, `logs.audit_trails` remains writable, strict Audit Trail exists, `readOnlyUntil` is 30 days from cutover, and drop still requires a separate migration. Covers **AC-21** and **AC-22**.
* [ ] Record a writer rollback with its Blind Spot, run the same policy command with `--action unlock`, and only then deploy `dual/postgres`. Prove the old writer is never reopened without the exact rollback activation, configured migration login, actor, reason, and Audit Trail. Covers **AC-22**.
* [ ] Stop the node for planned maintenance and destroy a disposable capacity node. Prove applications continue, loss becomes Blind Spot, availability alert remains in PostgreSQL, pinned empty rebuild succeeds, and no Signal backup is assumed. Covers **AC-17**, **AC-19**, and **AC-20**.
