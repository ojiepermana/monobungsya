# 0014. Bun observability and benchmarking decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index and child specs. This file is for people reviewing the decision later.

## Context

> ⚠️ Premise note: Bun 1.4 does not provide a complete application observability pipeline. Its release adds useful runtime and memory signals, while its published performance numbers describe Bun release workloads rather than this application. The correct framing is to build an application measurement standard that uses Bun probes, then establish Monobungsia baselines from controlled scenarios. (basis: [Bun 1.4 release](https://bun.com/blog/bun-v1.4), [Bun benchmarking documentation](https://bun.com/docs/project/benchmarking))

Monobungsia already records structured application, audit, and public access logs in PostgreSQL. The gateway has request and client navigation correlation. Jobs and scheduler expose structured events. SQL, NATS, outbound `fetch`, SMTP, filesystem, and subprocess calls do not share a timing or resource contract.

The requested standard must cover every Bun backend process, compare builds in controlled CI, retain sampled production evidence, and keep production overhead within 5 percent for latency `p95` and CPU plus 10 percent for RSS. It must not change business outcomes when telemetry storage fails.

The engineer chose existing PostgreSQL rather than new telemetry infrastructure. This reduces operating surface, but it gives telemetry the same database failure domain and makes full distributed tail sampling impractical. The design must state those limits instead of claiming complete traces.

## Current state evidence

* `packages/elysia/src/access-log.plugin.ts` measures public request duration and writes one access row, but its `traceId` is client navigation correlation.
* `packages/logger/src/activity-log.ts` has a process local best effort queue for application and access logs plus awaited audit writes.
* `packages/database/src/index.ts` exposes Bun SQL directly. Repositories use tagged SQL and `.unsafe()` without a query instrumentation seam.
* `packages/messaging/src/index.ts` wraps NATS publish, subscribe, and request but carries no telemetry headers or timing.
* `packages/jobs/src/index.ts` stores correlation ID and emits runtime events, but stores no W3C trace parent.
* Gateway, permission cache, MCP, and mailers call `fetch` or Nodemailer directly.
* Composition roots flush ActivityLog, but shutdown ordering differs and no metric store or exporter exists.

## Options considered

### Option 1: Typed telemetry with PostgreSQL storage

Create one typed runtime API, aggregate metric in process, sample spans, write through a dedicated PostgreSQL role, and keep benchmark sources in Git and CI. (basis: existing Bun, PostgreSQL, shared package, log, jobs, and notification architecture)

**Pros**:

* Reuses technology the repository already operates.
* Keeps logs, trace links, benchmark results, permission, and operator UI within the existing product boundary.
* Avoids runtime uncertainty from Node oriented auto instrumentation.

**Cons**:

* The team owns trace storage, histogram query, sampling, alerting, retention, and viewer behavior.
* PostgreSQL outage hides application and telemetry evidence together.
* Unsampled distributed error traces can be incomplete.

### Option 2: Manual OpenTelemetry with Collector, Tempo, and Prometheus

Emit manual OpenTelemetry data over OTLP HTTP to Collector, keep trace in Tempo, metric in Prometheus, and use Grafana for analysis. Official OpenTelemetry JS documentation does not list Bun as a supported runtime, so compatibility would need proof. (basis: [OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/), [exporters](https://opentelemetry.io/docs/languages/js/exporters/), [Collector](https://opentelemetry.io/docs/collector/), [libraries](https://opentelemetry.io/docs/languages/js/libraries/))

**Pros**:

* Uses standard telemetry protocols and mature purpose built query systems.
* Collector can perform tail sampling, filtering, batching, and retry outside application processes.
* Tempo and Prometheus separate observability from the application database failure domain. (basis: [Prometheus overview](https://prometheus.io/docs/introduction/overview/), [Tempo architecture](https://grafana.com/docs/tempo/latest/introduction/architecture/))

**Cons**:

* Adds Collector, trace storage, metric storage, dashboards, deployment, backup, and operating knowledge.
* Bun compatibility for the JS SDK, auto instrumentation, and some exporters is not officially guaranteed.
* It does not reuse the existing operator viewer without additional integration.

### Option 3: Store raw measurements as application logs

Reuse `Logger` and `ActivityLog` for every query, request, message, and job measurement. (basis: [spec 0011](../0011-log-subsystem/index.md), `packages/logger`)

**Pros**:

* Requires the fewest new abstractions and tables.
* Existing sanitization, partitioning, and viewer are immediately available.

**Cons**:

* One log row per operation creates high write volume and mixes diagnostics with numeric aggregation.
* SQL telemetry can measure its own log insert and form a recursion loop.
* Percentile, mergeable histogram, cardinality, and alert query contracts remain undefined.

### Option 4: CI benchmark artifacts only

Measure controlled scenarios and keep JSON reports without production traces, metrics, or alerts. (basis: [Bun benchmarking documentation](https://bun.com/docs/project/benchmarking))

**Pros**:

* Smallest production overhead and no runtime storage migration.
* Regression reports remain deterministic and reviewable.

**Cons**:

* CI cannot explain production only behavior or resource pressure.
* Trace links and persistent production alerts cannot be delivered.
* Benchmark fixtures can drift away from real workloads without a production comparison.

## Rationale

Option 1 is the chosen standard because the engineer prefers to reuse PostgreSQL and avoid new infrastructure. The application already has shared Bun packages, least privilege database roles, a logs service, an Angular operator surface, durable jobs, and notification fanout. A typed package and dedicated schema fit those boundaries better than putting numeric telemetry into the existing logger. The Elysia integration remains a named global plugin registered before routes, which matches the framework lifecycle contract. (basis: `AGENTS.md`, `CLAUDE.md`, `elysiajs` skill, [Elysia documentation index](https://elysiajs.com/llms.txt))

Option 2 is the technical runner up. It gives better failure isolation and true tail sampling, but it adds three operational systems while Bun support in OpenTelemetry JS remains uncommitted. The spec keeps W3C trace context so a later exporter migration does not require changing application semantics.

PostgreSQL storage is only credible with aggregation before write, bounded queues, separate roles, daily partition retention, low cardinality names, and explicit blind spot behavior. Raw logger events would violate the overhead target and blur spec 0011 security evidence with performance observations.

The benchmark must belong to this application rather than copy Bun release numbers. Scenario, runner, fixture, Bun version, commit, and instrumentation schema form the comparison context. Reviewed baseline promotion prevents a regression from silently becoming normal.

## References

**Project sources**:

* `AGENTS.md` and `CLAUDE.md`, repository workflow, Bun monorepo, Elysia boundaries, logging contract, PostgreSQL, jobs, and notification conventions
* [Spec 0011](../0011-log-subsystem/index.md), application, audit, access, correlation, sanitization, partitioning, and graceful shutdown contract
* [Spec 0012](../0012-reliable-jobs-notifications/index.md), durable jobs, telemetry event, alert fanout, and notification contract
* `packages/elysia`, `packages/logger`, `packages/database`, `packages/messaging`, and `packages/jobs`, current instrumentation seams
* `elysiajs` community skill, plugin scope, naming, lifecycle order, and schema validation conventions

**Practices and standards**:

* W3C Trace Context vocabulary
* Deterministic head sampling with honest incomplete trace markers
* Mergeable histogram aggregation
* Least privilege database roles
* Idempotent ingestion with body checksum and replay prevention
* Versioned benchmark fixtures and reviewed baseline promotion

**Links**:

* Bun 1.4 release: https://bun.com/blog/bun-v1.4
* Bun benchmarking: https://bun.com/docs/project/benchmarking
* OpenTelemetry JavaScript: https://opentelemetry.io/docs/languages/js/
* OpenTelemetry exporters: https://opentelemetry.io/docs/languages/js/exporters/
* OpenTelemetry Collector: https://opentelemetry.io/docs/collector/
* OpenTelemetry libraries: https://opentelemetry.io/docs/languages/js/libraries/
* Prometheus overview: https://prometheus.io/docs/introduction/overview/
* Grafana Tempo architecture: https://grafana.com/docs/tempo/latest/introduction/architecture/
* Elysia documentation index: https://elysiajs.com/llms.txt
