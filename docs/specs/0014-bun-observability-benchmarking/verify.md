# Verification plan

**Status**: Verified (2026-08-26)

**Parent**: [Bun observability and benchmarking standard](index.md)

## Verification scope

Langkah berikut adalah acceptance plan untuk seluruh standar 0014. Bukti pelaksanaan lengkap dicatat pada bagian Verification evidence di bawah.

1. Jalankan `bun run db:migrate -- --service logs` dan `bun run db:migrate -- --service access`. Expected: migration `0026_telemetry_foundation` dan `0027_observability_permission` terdeteksi sebagai applied atau skipped, tanpa duplicate migration atau checksum drift.
2. Verifikasi PostgreSQL memiliki schema `telemetry`, tabel `telemetry.spans`, `telemetry.metric_buckets`, `telemetry.benchmark_runs`, `telemetry.benchmark_baselines`, `telemetry.benchmark_comparisons`, `telemetry.alert_states`, dan kolom `runtime_trace_id` serta `runtime_span_id` pada tiga tabel log.
3. Jalankan `bun run check:observability`. Expected: seluruh composition root backend mendaftarkan plugin telemetry dan tidak ada writer telemetry di luar `packages/telemetry`.
4. Jalankan `bun run typecheck` dan `bun run test`. Expected: typecheck seluruh workspace berhasil dan seluruh test hijau, termasuk contract test W3C traceparent, sanitasi atribut, retry writer, plugin Elysia, authorization observability, serta query repository.
5. Dengan logs service tanpa database telemetry, panggil `/internal/observability/traces`, `/internal/observability/metrics`, `/internal/observability/benchmarks/runs`, `/internal/observability/benchmarks/baselines`, dan `/internal/observability/alerts`. Expected: response aman berupa projection kosong, bukan error bisnis atau angka metric palsu.
6. Panggil endpoint observability melalui gateway dengan session tanpa permission, `logs:log:read`, lalu `observability:telemetry:read`. Expected: 403 untuk dua kasus pertama dan request diteruskan hanya untuk permission observability; permission log tidak memberi akses telemetry.
7. Kirim `traceparent` yang valid, hilang, dan malformed ke route Elysia. Expected: parent valid membentuk child span, header hilang membuat root baru, dan context malformed membuat root baru serta menambah `telemetry.context.invalid_total` tanpa mengubah response bisnis.
8. Jalankan `bun run observability:benchmark -- --output /tmp/observability-run.json`, lalu ulangi dengan `--baseline /tmp/observability-run.json`. Expected: report canonical memiliki Bun version, commit SHA, scenario compatibility key, metric p50/p95/p99, checksum, dan baseline yang identik tidak gagal.
9. Jalankan `bun run openapi:generate` lalu `bun run openapi:validate`. Expected: route trace, metric, benchmark, baseline, dan alert tersedia di gateway OpenAPI serta Angular SDK tanpa diff regenerasi tak terduga.
10. Periksa `logs.logging`, `logs.access_logs`, dan `logs.audit_trails` setelah satu request gateway. Expected: `trace_id` lama tetap correlation ID, kolom runtime berisi trace/span W3C, dan access log tetap tepat satu row.

## Standard enforcement

1. Run `bun run check:observability` and prove a new direct SQL, `fetch`, NATS, SMTP, filesystem, or subprocess seam fails unless it uses the typed wrapper or an existing debt inventory entry.
2. Run `bun run check:dependencies` and prove application services cannot import another service or the telemetry implementation through an unapproved path.
3. Run `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:web`, `bun run openapi:generate`, and `bun run openapi:validate`.
4. Prove generated OpenAPI and Angular SDK artifacts have no unexpected diff.

## Runtime telemetry

1. Drive one session and users journey through Angular, gateway, auth, access, user, and SQL. Prove request ID, correlation ID, runtime trace ID, and span ID retain distinct meanings.
2. Send valid, missing, and invalid `traceparent` through HTTP, NATS, and a durable job. Prove valid parentage, safe new roots, and invalid context metric.
3. Prove access logging still writes exactly one public access row and that its existing `trace_id` remains client correlation.
4. Instrument representative SQL, NATS publish, NATS request, NATS consume, job enqueue, job execute, SMTP, filesystem, subprocess, and outbound HTTP calls. Prove safe resource names and unchanged business results.
5. Scan span attributes, metric labels, artifacts, logs, and notifications for SQL, parameters, bodies, headers, cookies, tokens, email, user ID, IP, NATS payload, and raw error message.
6. Generate a normal trace outside the deterministic sample and prove it is dropped. Generate error and slow operations on the same trace and prove local spans persist with an incomplete marker.
7. Exceed span, attribute, item, and queue limits. Prove priority retention, dropped counters, bounded memory, and no request failure.
8. Disconnect telemetry PostgreSQL. Prove application requests and jobs continue, console reports failure, backoff is bounded, and accumulated drop count persists after recovery.
9. Inject transient and permanent batch failures. Retry the same metric sequence, send a higher sequence, and retry the same span. Prove transient retry, poison isolation, cumulative metric replacement without double count, and no duplicate span.
10. Race partition creation under multiple writers, then run retention. Prove advisory lock safety and exact expiry for 7 day spans and 30 day metrics.
11. Emit memory pressure warning and critical events. Prove sampling and queue shrink without changing cache, worker, request, or job state.
12. Stop each backend process gracefully. Prove active span close, bounded telemetry flush, ActivityLog flush, database close, and no indefinite shutdown.

## Benchmark validity

1. Run each initial journey, microbenchmark, and throughput scenario from a separate driver against isolated staging.
2. Change scenario, fixture, runner, environment, or instrumentation version one at a time and prove compatibility rejects the comparison.
3. Change Bun version and commit while all other compatibility fields match and prove comparison remains valid and reports both values.
4. Produce 20 valid calibration runs, choose the medoid run, promote its immutable snapshot through a pull request, and prove only one active baseline per compatibility key.
5. Create latency regressions below and above both the 10 percent and 5 ms gates. Prove only the combined breach fails.
6. Create CPU, RSS, throughput, error, and operation count regressions. Prove each threshold and evidence link.
7. Force telemetry incompleteness, dropped data, runner fingerprint mismatch, coefficient of variation above 10 percent, driver CPU above 80 percent, and driver event loop lag above 10 ms. Prove each run becomes incomplete and cannot become baseline.
8. Remove or mismatch a baseline. Prove the run reports `not_comparable`, creates artifacts, and does not fail as a regression.
9. Repeat artifact generation and ingestion. Prove canonical JSON checksum, stable Markdown, idempotent retry, 409 checksum conflict, and atomic projection.
10. Compare instrumentation off and on for the `journey` and `throughput` scenarios. Prove latency `p95` and CPU overhead stay at or below 5 percent and RSS overhead stays at or below 10 percent. Keep raw microbenchmark overhead visible as diagnostic evidence.

## Operator and security

1. Call every operator endpoint without a session, without permission, and with `observability:telemetry:read`. Prove 401, 403, and allowed responses at gateway and logs service boundaries.
2. Query maximum and excessive time ranges, allowed and forbidden group fields, cursor boundaries, unknown metric, excessive series, and expired trace.
3. Render loading, empty, unauthorized, forbidden, query error, expired trace, incomplete trace, metric gap, stale projection, not comparable, and healthy states in Angular.
4. Sign ingestion with correct and incorrect body hash, expired timestamp, unknown key, same nonce and body, same nonce with changed body, changed nonce, and rotated active or previous key. Prove cached retry and replay rejection.
5. Force three breach windows, repeated evaluation, three recovery windows, missing buckets, and evaluator failure. Prove status values, monotonic transition sequence, atomic durable job enqueue, and one notification per transition.
6. Revoke `observability:telemetry:read`. Prove recipient projection stops new alert fanout and an old notification link cannot open the viewer.
7. Start a CPU profile with invalid duration, unsupported runtime, existing active profile, and valid local permission. Prove no HTTP surface, owner only file, partial cleanup, application events, and 24 hour deletion.

## Operational acceptance

1. Prove full telemetry PostgreSQL outage is reported as an explicit blind spot and never displayed as zero metric or resolved alert.
2. Prove daily and monthly partition maintenance is idempotent and does not lock current writes beyond the configured query timeout.
3. Prove a candidate environment is deleted after CI completion and cleanup also runs after benchmark failure.
4. Prove required pull request scenarios come from `benchmarks/impact-map.json`, while nightly and release run the full suite.
5. Run the Tracer Bullet session and users slice end to end before enabling enforcement for the remaining inventory.

## Verification evidence

Verification completed on 2026-08-26 with the following evidence:

- `bun run doctor` passed with no warnings. Local PostgreSQL, all seven migrated schemas, telemetry tables, 365 current-year span partitions, 365 metric partitions, the partition maintenance function, NATS, SMTP, and all development ports were healthy. Re-running migrations for logs, access, jobs, and notification produced only `skipped` results with no checksum drift.
- `bun run check:observability`, `bun run check:dependencies`, `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:web`, `bun run openapi:generate`, `bun run openapi:validate`, `bun run build`, and `git diff --check` passed. Backend tests passed at 272/272 across 38 files with 782 expectations; Angular tests passed at 123/123 across 21 files.
- `bunx playwright test e2e/observability.spec.ts --project=chromium` passed 4/4, including authorized operator navigation, unauthorized redirect, fixture setup, and cleanup.
- Runtime evidence covered HTTP, NATS, and durable-job traceparent propagation; permission separation; sanitized span, access-log, benchmark-ingestion, and notification boundaries; explicit storage blind spots; bounded query windows and series; profile lock/cleanup; alert firing/recovery; and notification suppression after observability permission revocation.
- Partition maintenance was called twice against local PostgreSQL without changing the span partition count (5124 before and after), proving idempotence.
- The managed full benchmark suite completed all three scenarios in isolated staging at `http://127.0.0.1:4344` and destroyed the staging process/state afterward. The core comparison was `pass` with CV 5.14%, telemetry complete, zero dropped telemetry, driver CPU 11.71%, and event-loop lag p95 5.48 ms. Journey overhead was latency 2.63%, CPU 3.92%, RSS -0.29%; throughput overhead was latency 0.85%, CPU 4.72%, RSS -1.40%; both required scenarios stayed within the 5%/10% policy. Core microbenchmark overhead remained visible as diagnostic evidence by policy.
- Calibration produced 39 valid reports and selected medoid `01a039a9-1c77-71e4-b910-d25a4755a08e`. The checked-in active baseline records isolated staging target, ownership, cleanup state, driver snapshot, and manifest checksum.

The observability acceptance is therefore **TIDAK FAIL**.
