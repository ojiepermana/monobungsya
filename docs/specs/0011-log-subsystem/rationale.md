# 0001. Log subsystem, decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index only. This file is for people reviewing the decision later.

## Context

> ⚠️ Premise note: The conflict is not a fresh choice between roles and permissions. Spec 0008 already makes permission names authoritative and removes roles from live identity. Keeping role in the session summary would recreate a second authorization vocabulary. The remaining decision is which component can truthfully source the diagnostic permission count.

The production access writer records every completed public API request. When Angular opens `/users`, its guard first calls `/api/v1/auth/session`, then the page calls `/api/v1/users`. These calls must remain separate security records, but one trace identifier lets the viewer show that they belong to one navigation.

The access table has indexed `trace_id` and JSONB `metadata`. Current code writes `requiredPermission` rather than the old capability name. Its session detail and viewer are already role free. However, auth still returns `permissionCount` in its internal observation even though auth no longer owns permission data, and every auth repository result sets that value to zero. The gateway then resolves the real effective permission list for the public session but copies the unrelated auth count into access metadata.

Endpoint details touch authentication data. Raw body capture would turn the access table into an uncontrolled copy of session and credential fields. Client route context is also forgeable. The design therefore needs a closed server owned detail contract, a stable public response, and an explicit label that navigation data is only a diagnostic hint.

The existing version 1 reader is defensive. It selects known fields and ignores extras, so old rows that contain `role` can remain stored without exposing that field. No table rewrite or metadata version bump is needed for this subtractive change.

## Current state evidence

* Spec 0008 defines the access service as the source of truth for effective permissions and requires the gateway to fill the public session permission array from that lookup.
* `apps/services/auth/src/modules/auth/auth.types.ts` gives `SessionObservation` a permission count even though auth has no permission lookup.
* `apps/services/auth/src/modules/auth/auth.repository.ts` sets that count to zero for authenticated, anonymous, and invalid results.
* `apps/gateway/erp/src/routes/proxy.route.ts` loads the real permission list for an authenticated public session, then writes the auth supplied count into `AuthSessionDetail`.
* `packages/logger/src/activity-log.ts` and the logs API already define the role free summary `{ state, reason, permissionCount }`.
* `apps/services/logs/src/modules/logs/logs.repository.ts` projects known version 1 fields and ignores an old role field.
* `apps/web/src/app/pages/logs/access/access-logs.page.ts` displays state, permission count, and reason without a role.

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

## Permission reconciliation options

### Option A: Keep the permission count in auth

Auth would continue returning a complete session observation, and the gateway would copy it without adding authorization context.

**Pros**:

* Keeps the observation self contained.
* Requires the smallest type change.

**Cons**:

* Auth has no permission source after spec 0008, so the count is always zero or requires a second access lookup.
* A second lookup can disagree with the list the gateway returns to the browser.

### Option B: Derive the count at the gateway

Auth returns only state and reason. For an authenticated session, the gateway resolves effective permissions once, uses that list in the public response, and stores its length in the access detail.

**Pros**:

* Gives every value one truthful owner.
* Makes the public permission list and diagnostic count one request snapshot.
* Reuses the access lookup already required by spec 0008.

**Cons**:

* Session enrichment still depends on access service availability.
* The count can reflect the bounded gateway cache window.

### Option C: Remove the permission count

The session detail would contain only state and reason.

**Pros**:

* Produces the smallest and least sensitive summary.
* Removes all authorization data from session diagnostics.

**Cons**:

* Removes an existing operator signal and changes the logs API plus viewer contract.
* Makes it harder to spot an authenticated user with no grants without exposing permission names.

## Rationale

Option 1 fits because the required storage and correlation fields already exist. A versioned union gives endpoint details a strict shape without turning the access table into an auth specific schema. Reusing `trace_id` also preserves existing propagation through gateway and services instead of introducing another identity for the same flow.

Option 3 is the runner up. Dedicated columns become appropriate if several stable endpoint fields need indexed filtering at measured volume. That condition does not exist yet, so changing every partition now would create schema coupling without a proven query benefit.

The gateway remains the authoritative public access boundary, but it must not inspect response bodies generically. The auth service can produce a typed internal observation. The session gateway handler then maps the unchanged public body explicitly and enriches request context before the global Elysia completion hook writes the row. This respects plugin order, global lifecycle scope, and one write per public request.

Angular supplies the navigation correlation because only the client knows that two public calls belong to the same route transition. That value helps diagnosis but does not prove intent. Authentication, actor, session, status, and invalid reason continue to come from server controlled sources.

Option B is the right reconciliation. Auth can truthfully classify a session, while only the gateway has the effective permission snapshot used for the public response and later route checks. Deriving `permissionCount` from that same normalized, distinct list prevents two values on one response from disagreeing. The count remains diagnostic only. Authorization still checks permission names through `hasAnyRequiredPermission`.

Option C is the runner up. It is simpler and exposes less authorization context, but it removes a useful signal from an API and viewer that already support it. Keeping the count costs no extra lookup because spec 0008 already requires the gateway to resolve the list for the public session response.

Keeping metadata version 1 is safe because the change removes a field and the reader already ignores unknown fields. Older rows can retain `role` in JSONB, while new rows never write or expose it. A version bump would add compatibility code without changing the meaning of the remaining fields.
