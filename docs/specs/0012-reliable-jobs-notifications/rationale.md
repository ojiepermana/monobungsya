# Rationale

## Context

The repository already has NATS core for low latency messaging, PostgreSQL for service data, auth and permission boundaries, strict audit logging, an Angular shell, and SMTP through Nodemailer. Current NATS publication can be skipped or lost when the broker is unavailable. The auth cleanup worker also relies on a process timer. These behaviors are acceptable for best effort signals but not for invitation delivery, notification delivery, scheduled maintenance, or operator recovery.

## Rationale

Use PostgreSQL as the durable queue source of truth, NATS core only as a wake signal, and target service workers for handler ownership. Add separate jobs and notification services because they own distinct data, permissions, APIs, retention, and operational responsibilities.

This design fits the existing stack, allows enqueue in the source business transaction, and avoids introducing another operational dependency. At least once delivery is explicit. Idempotency remains a required domain responsibility rather than an implied exactly once promise.

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
