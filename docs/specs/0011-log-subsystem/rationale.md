# 0001. Log subsystem, decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index only. This file is for people reviewing the decision later.

## Context

> ⚠️ Premise note: `/api/v1/auth/session` must not be nested inside or merged into the `/api/v1/users` row. They are separate public requests and each is independently relevant to security. The right framing is to relate their separate rows with one trace identifier, then add a safe endpoint summary only to the session row.

The production access writer now records every completed public API request. When Angular opens `/users`, its guard first calls `/api/v1/auth/session`, then the page calls `/api/v1/users`. Both calls receive different server request and trace identifiers, so the viewer cannot show that they belong to one navigation.

The access table already has indexed `trace_id` and JSONB `metadata`. The gateway currently stores only duration and capability in metadata. Its generic session proxy forwards the auth response without adding verified actor, session, or a safe summary to the public session access row. The logs service and Angular viewer also omit trace and metadata from their read contract.

Endpoint details touch authentication data. Raw body capture would turn the access table into an uncontrolled copy of session and credential fields. Client route context is also forgeable. The design therefore needs a closed server owned detail contract, a stable public response, and an explicit label that navigation data is only a diagnostic hint.

## Current state evidence

* `packages/elysia/src/access-log.plugin.ts` writes one row in a global `onAfterResponse` hook and owns mutable request context.
* `apps/gateway/erp/src/routes/proxy.route.ts` forwards public session requests and performs a separate internal session lookup for protected users requests.
* `apps/services/auth/src/modules/auth/auth.service.ts` returns the safe public session shape, while `findSession` currently collapses every invalid state to null.
* `packages/logger/src/activity-log.ts` already sanitizes and stores access metadata plus `trace_id`.
* `apps/web/src/app/auth/auth.guard.ts` calls the public session endpoint during navigation, and the users page calls the users endpoint after activation.
* `apps/services/logs/src/modules/logs/logs.repository.ts` omits metadata, session id, and trace id from access rows.
* `apps/web/src/app/pages/logs/access/access-logs.page.ts` cannot display or filter a related request flow.

## Options considered

### Option 1: Enrich the existing access rows in place

Keep one row per public request. Reuse `trace_id` for Angular navigation correlation and store one versioned, endpoint owned detail union in the existing metadata column. Project only safe typed fields through the logs API.

**Pros**:

* Needs no table or historical data migration.
* Preserves the current writer, permissions, partitions, and viewer.
* Keeps request evidence separate while making related rows easy to find.

**Cons**:

* JSONB needs a defensive parser and version policy.
* Client navigation correlation remains forgeable diagnostic context.

### Option 2: Add a journey stream beside access logs

Write separate client journey events beside access logs, relate both stores, then move flow analysis to the new stream after it is proven.

**Pros**:

* Separates product navigation from security access evidence.
* Supports richer future interaction analytics.

**Cons**:

* Adds a second writer, read model, and reconciliation problem for one current page flow.
* Still needs access metadata for the safe session summary.

### Option 3: Add dedicated access columns directly

Add client route and each session summary field as columns on `logs.access_logs`, backfill nulls, and update every reader and writer together.

**Pros**:

* Gives strong database types and straightforward SQL filters.
* Makes the current session fields obvious to ad hoc queries.

**Cons**:

* Couples the shared access table to one endpoint and repeats migrations for every future detail kind.
* Changes every yearly partition and adds coordination risk for nullable information.

## Rationale

Option 1 fits because the required storage and correlation fields already exist. A versioned union gives endpoint details a strict shape without turning the access table into an auth specific schema. Reusing `trace_id` also preserves existing propagation through gateway and services instead of introducing another identity for the same flow.

Option 3 is the runner up. Dedicated columns become appropriate if several stable endpoint fields need indexed filtering at measured volume. That condition does not exist yet, so changing every partition now would create schema coupling without a proven query benefit.

The gateway remains the authoritative public access boundary, but it must not inspect response bodies generically. The auth service can produce a typed internal observation. The session gateway handler then maps the unchanged public body explicitly and enriches request context before the global Elysia completion hook writes the row. This respects plugin order, global lifecycle scope, and one write per public request.

Angular supplies the navigation correlation because only the client knows that two public calls belong to the same route transition. That value helps diagnosis but does not prove intent. Authentication, actor, session, status, and invalid reason continue to come from server controlled sources.
