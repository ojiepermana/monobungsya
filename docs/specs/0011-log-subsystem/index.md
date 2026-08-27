# 0011. Audit Trail log subsystem

**Date**: 2026-08-27
**Status**: Accepted

## Summary

The log subsystem keeps one durable log type, Audit Trail. It stores immutable business change records in PostgreSQL yearly partitions, exposes a read only API through the gateway, and provides an Angular viewer for authorized operators.

Application Log and Access Log are outside this retained feature and are not stored, written, exposed, or rendered.

## Requirements

**User stories**:

* As an auditor, you want an immutable record of who changed what business entity, when, and why.
* As an operator, you want to browse, search, filter, and page Audit Trail rows without direct database access.
* As a maintainer, you want a failed Audit Trail write to fail the business operation visibly.

**Acceptance criteria**:

* **AC 1**: `ActivityLog.writeAudit` awaits its insert and propagates failures to its caller.
* **AC 2**: Every Audit Trail row lands in a yearly partition keyed by the Jakarta calendar year. A missing partition is created under a PostgreSQL advisory lock and the insert is retried once.
* **AC 3**: `GET /api/v1/logs/audit-trails` requires `logs:log:read` at the gateway and in the logs service. It returns filtered rows with page metadata and distinct filter options.
* **AC 4**: Search uses parameter binding and escapes `%` and `_` before `ILIKE` evaluation.
* **AC 5**: Timestamps are stored as UTC wall time and returned as ISO 8601 UTC strings.
* **AC 6**: Audit context is sanitized before JSON storage. Credentials, tokens, cookies, passwords, secrets, and authorization values are never stored.
* **AC 7**: The Angular Audit Trail page shows rows, search, filters, clear filters, and first, previous, next, and last paging. A filter change resets to page 1.

## Decision

Use the existing PostgreSQL database, yearly partition model, `ActivityLog.writeAudit`, read only logs service, gateway proxy, and Angular Audit Trail page. Do not add application log or access log storage or APIs.

## Feature design

The `logs.audit_trails` parent is partitioned by range on `audited_at`. Children use the name `partition.audit_trails_YYYY`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | UUIDv7 identifier, part of the composite primary key |
| `action` | varchar(50) | Business action |
| `module` | varchar(50) | Owning module |
| `entity_type` | varchar(100) | Changed entity type |
| `entity_id` | varchar(100) | Changed entity identifier |
| `entity_label` | varchar(150) | Optional display label |
| `actor_user_id` | uuid | Verified actor identifier |
| `reason` | text | Optional reason |
| `change_summary` | text | Optional summary |
| `before_state` | jsonb | Optional previous state |
| `after_state` | jsonb | Optional new state |
| `metadata` | jsonb | Optional sanitized metadata |
| `request_id` | varchar(100) | Request correlation |
| `trace_id` | varchar(100) | Trace correlation |
| `audited_at` | timestamp | UTC partition key |
| `created_at` | timestamp | UTC creation time |

All SQL values use parameter binding. Table and column identifiers used by partition helpers and search are allowlisted.

## API surface

| Endpoint | Method | Inputs | Output | Permission |
| --- | --- | --- | --- | --- |
| `/api/v1/logs/audit-trails` | GET | `search`, `module`, `action`, `actorUserId`, `page` | `data`, `meta`, `filters`, `options` | `logs:log:read` |

The response uses twenty five rows per page, newest first. The `actorUserId` input supports the user detail Audit Trail view.

## Build plan

1. Keep the partitioned Audit Trail migration, partition helpers, strict writer, logs service, gateway route, Angular page, and focused tests.
2. Remove application and access writer APIs, gateway lifecycle logging, routes, viewers, fixtures, and generated contracts.
3. Regenerate OpenAPI and the Angular SDK, then run repository validation.

## Key invariants

* Audit Trail writes are awaited and failures remain visible to the business operation.
* Audit Trail is the only retained log type in this feature.
* Every stored context is sanitized.
* Partition identifiers come only from the fixed Audit Trail allowlist.
* The gateway and logs service both enforce `logs:log:read`.
