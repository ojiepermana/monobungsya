# 0001. Log subsystem, decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index only. This file is for people reviewing the decision later.

## Context

> ⚠️ Premise note: an Angular route change is not reliable security evidence. The browser can cache, repeat, omit, or forge a `page_view` event. The authoritative event is the public API request that actually releases protected data. Opening `/users` therefore records `GET /api/v1/users`, while product analytics for client route views remains a separate concern.

The storage, partitioning, read service, gateway proxy, and Angular viewers are already built. The production write integration is not. `ActivityLog.writeAccess` and `ActivityLog.writeLog` have no production call sites, so normal use leaves Log Akses and Log Aplikasi empty even though their pages work.

The application already has a shared `Logger`, request identifiers, gateway session resolution, and one PostgreSQL log writer. A replacement platform would add infrastructure without fixing a storage limitation. The real decision is where public access becomes authoritative, how application events reach the existing writer, and how to avoid duplicates or credential leakage.

## Current state evidence

* `packages/logger/src/activity-log.ts` implements access, application, and audit writes.
* `apps/services/user/src/modules/users/users.service.ts` is the only production `ActivityLog` caller, and it writes audit rows only.
* `packages/logger/src/index.ts` sends `Logger` output to the console only.
* `packages/elysia/src/logger.plugin.ts` records request start before the final status and does not persist it.
* `apps/web/src/app/pages/users/list/users.page.ts` calls `GET /api/v1/users` when `/users` opens.
* `apps/gateway/erp/src/main.ts` has no log database configuration.
* `ActivityLog.flush()` owns one process local queue, so calling it in the logs service cannot drain gateway, auth, or user queues.

## Options considered

### Option 1: Fix the existing subsystem in place

Keep the current tables, writer, APIs, and viewers. Add one gateway completion hook for public access, bridge the shared `Logger` to application storage, add explicit auth events, and drain each local queue during shutdown.

**Pros**:

* Reuses code and operations the project already owns.
* Gives one authoritative request row without downstream duplicates.
* Needs no schema or historical data migration.

**Cons**:

* Gateway processes need a least privilege PostgreSQL logging connection.
* Request volume now consumes primary database capacity.
* Several applications must adopt the updated shared logger together.

### Option 2: Strangle direct writes through a logs ingestion service

Add an internal write API or NATS consumer beside current direct writes, move producers gradually, then retire direct database access.

**Pros**:

* Centralizes write policy and credentials.
* Can add batching and back pressure in one place later.

**Cons**:

* Adds a network or broker dependency to a best effort path.
* Creates retry, ordering, authentication, and self logging concerns that do not exist today.
* Keeps two write paths during migration.

### Option 3: Replace PostgreSQL logging directly

Send access and application events to an external log platform and retire the current write and read surfaces.

**Pros**:

* Purpose built search, retention, alerting, and high volume ingestion.
* Removes log traffic from the primary database.

**Cons**:

* Discards working partitions, APIs, permissions, and viewers.
* Adds service cost, deployment configuration, and another security boundary.
* Requires a coordinated replacement and historical data decision for a gap that is only missing integration.

## Rationale

Option 1 is the right fit because the existing subsystem is maintainable and already covers storage, partition recovery, authorization, querying, and display. The gateway is the only boundary that sees one public request, its verified identity, and its final result. Logging again in downstream services would duplicate the same access under one request id.

The shared `Logger` is already used for technical events. Connecting it once to `ActivityLog.writeLog` gives consistent application persistence without adding manual calls throughout the codebase. A failed request may create an access row and an application error row because those records answer different questions.

The Elysia lifecycle must be registered before route plugins with global scope. `onAfterResponse` is the appropriate point because the response has already been produced and logging cannot alter it. The rollout stays guarded because one row per API request changes database volume even though it does not change request success.
