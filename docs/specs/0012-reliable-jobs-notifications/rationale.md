# Rationale

## Context

The repository already has NATS core for low latency messaging, PostgreSQL for service data, auth and permission boundaries, strict audit logging, an Angular shell, and SMTP through Nodemailer. Current NATS publication can be skipped or lost when the broker is unavailable. The auth cleanup worker also relies on a process timer. These behaviors are acceptable for best effort signals but not for invitation delivery, notification delivery, scheduled maintenance, or operator recovery.

The services must share job type and schedule metadata without importing one another. Producers need validation before their source transaction commits, the jobs service needs schedule metadata without target handlers, and target services need local handlers with readiness checks. The database role boundary also requires scheduled work to be created by the jobs service rather than by a target service role.

## Rationale

Use PostgreSQL as the durable queue source of truth, NATS core only as a wake signal, and target service workers for handler ownership. Add separate jobs and notification services because they own distinct data, permissions, APIs, retention, and operational responsibilities.

This design fits the existing stack, allows enqueue in the source business transaction, and avoids introducing another operational dependency. At least once delivery is explicit. Idempotency remains a required domain responsibility rather than an implied exactly once promise.

Use a shared declarative contract registry in `#project/jobs`. It is the single source for type, version, source, target, validation, idempotency, retry, redaction, and schedule metadata. Producers use the contract without a handler, target services bind handlers locally, and the jobs service uses only the schedule metadata. Scheduled system contracts use `sourceService: jobs`, which preserves the least privilege database boundary while still allowing a target service to own execution.

Use `completed` for the terminal success state. The current database constraint, stored functions, TypeScript contract, attempt outcome, timestamp, and worker completion operation already share that vocabulary. Keeping one value avoids translation and compatibility code across storage, API, telemetry, and UI.

## Options considered

### PostgreSQL queue with polling and NATS wake signal

Chosen. It provides transactional enqueue, clear ownership, simple recovery, and acceptable capacity for the expected 100,000 jobs per day.

Cost: database contention and table maintenance must be observed. Claim indexes, bounded cleanup, and queue age metrics are required.

### NATS JetStream

Runner up. It provides durable streams and stronger messaging primitives, but source mutation and publish still need an outbox or another consistency mechanism. It also adds deployment and recovery work not currently present.

### Redis with BullMQ

Not chosen. It offers a mature worker model but adds Redis, splits source transaction durability from queue durability, and does not match the current Bun and PostgreSQL first architecture as closely.

### NATS core only

Rejected for durable work. It remains suitable for wake signals and cache invalidation where temporary loss is acceptable.

### Shared declarative contract registry

Chosen. Producers, the jobs scheduler, and target workers need one stable contract, while target handlers must remain local to preserve service extraction and the repository rule against cross service imports.

Cost: contract changes become a shared package release concern, and a missing local handler must fail readiness rather than being discovered only when work is claimed.

### Startup registration handshake

Runner up. Services could register handlers and schedules with the jobs service at startup, which would allow runtime discovery.

Cost: readiness would depend on an internal registration call, deployments would need coordination between service versions, and scheduler state would be harder to reproduce from source code.

### Jobs service importing target handlers

Rejected. It would make the queue service depend on target service source and violate the repository extraction boundary.

Cost: none beyond the direct coupling it introduces, which is the reason it is not acceptable.

### Success state `completed`

Chosen. It matches the implemented storage and runtime contract and keeps one value across every machine facing surface.

Cost: in ordinary prose, completed can describe any terminal result. The state machine removes that ambiguity because `failed` is a separate terminal state.

### Success state `succeeded`

Runner up. It pairs clearly with `failed` and states the positive outcome directly.

Cost: adopting it would rename the existing database, TypeScript, stored function, attempt, filter, telemetry, UI, and test contracts, or require an alias. Either path adds drift without adding behavior.

## Migration approaches considered

### Fix in place

Not chosen. Making every existing NATS producer durable in place would mix old and new semantics and create unclear rollback behavior.

### Direct replacement

Not chosen. Switching all producers, workers, APIs, and UI in one release creates unnecessary blast radius.

### Strangler rollout

Chosen. Build and validate the runtime first, cut invitation delivery without dual publish, then enroll notification event types one category at a time. Deployment flags control producer and UI exposure during rollout.

## Service boundary decision

A single combined service was considered. It would reduce process count, but it would mix operator queue permissions with user self service data and couple short job retention to longer notification retention. Separate services create a clearer security and data ownership boundary while still sharing the job package.

## Consequences

1. PostgreSQL becomes an operational queue and needs queue specific monitoring, indexes, vacuum awareness, and bounded retention cleanup.
2. Handler authors must provide idempotency logic and safe error classification.
3. SMTP and webhooks can still duplicate after an ambiguous provider response.
4. Runtime roles and stored functions require careful migration and authorization tests.
5. Notification templates are versioned immutable snapshots, so later template edits do not rewrite history.
6. Per user locale, native push, user managed schedules, and queue partitioning remain deliberate future work.

## Recommended defaults

1. Five worker slots per process.
2. Sixty second lease and twenty second heartbeat.
3. Five second polling fallback.
4. Five attempts with exponential backoff, bounded at fifteen minutes, plus jitter.
5. Ninety day job retention and 365 day notification retention.
6. Fixed API page size of 25.
7. Indonesian notification templates and deployment timezone rendering for version one.
8. Scheduled system jobs use `sourceService: jobs`; target services remain responsible for local handler binding and domain idempotency.
