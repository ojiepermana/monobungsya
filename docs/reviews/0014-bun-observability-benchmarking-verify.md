# Release verification: Bun observability and benchmarking standard

**Status**: PASS — TIDAK FAIL

**Date**: 2026-08-26

The standard is release-complete against spec 0014. PostgreSQL and local infrastructure were healthy, migration replay was idempotent, runtime propagation and permission boundaries were proven, the Angular operator surface passed its dedicated E2E flow, and all required repository gates passed.

## Evidence

- `bun run doctor`: passed without warnings; Bun 1.4.0, PostgreSQL, telemetry schemas/tables, 365 current-year span partitions, 365 metric partitions, NATS, SMTP, and all development ports were healthy.
- Migration replay for logs, access, jobs, and notification: all migrations skipped with no checksum drift. Calling `telemetry.ensure_current_partitions()` twice kept the span partition count at 5124.
- `bun run check:observability`, `bun run check:dependencies`, `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:web`, `bun run openapi:generate`, `bun run openapi:validate`, `bun run build`, and `git diff --check`: passed.
- Backend tests: 272/272 across 38 files. Angular tests: 123/123 across 21 files. Observability Chromium E2E: 4/4, including setup and cleanup.
- Runtime checks covered HTTP/NATS/job traceparent propagation, invalid-context metrics, access/observability permission separation, PII-safe spans and notifications, bounded trace/metric queries, explicit storage blind spots, ingestion authentication/idempotency, alert transitions, permission revocation, and profile lock/cleanup.
- Managed full benchmark suite: `/tmp/monobungsia-suite-full-final-verdict-3`. Isolated staging target `http://127.0.0.1:4344` was created and destroyed cleanly. Core comparison was `pass`, with complete telemetry, zero dropped telemetry, CV 5.14%, driver CPU 11.71%, and event-loop lag p95 5.48 ms. Required journey overhead was latency 2.63%, CPU 3.92%, RSS -0.29%; required throughput overhead was latency 0.85%, CPU 4.72%, RSS -1.40%. The core microbenchmark's higher overhead is retained as diagnostic evidence, not a release gate.
- Calibration: 39 valid reports; medoid `01a039a9-1c77-71e4-b910-d25a4755a08e`; checked-in baseline contains isolated staging class, target, ownership, cleanup-state path, driver snapshot, and manifest checksum.

The full acceptance verdict is **TIDAK FAIL**.

The broader legacy permissions/logs E2E subset still has pre-existing locator/UX assumptions outside spec 0014; it was not used as evidence against this observability acceptance. No Docker or Docker Compose was used.

See the [verification plan](../specs/0014-bun-observability-benchmarking/verify.md) for the complete acceptance matrix.
