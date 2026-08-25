# Rationale: 0015 permission group as a reusable grant template

## Context

> ⚠️ Premise note: the template model does not actually remove the toil that spec 0008 recorded; it moves it. The first grant becomes one action, but nothing keeps a user in step with the group afterwards, and there is no view that shows who is behind. Six months in, a group named "warehouse operator" will describe access that half the warehouse operators do not have, and the only way to find out is to compare each user by hand. The framing that removes the toil for good is the assignment model, where a group keeps granting and the effective permission lookup unions direct grants with group grants. The engineer chose the template model knowingly, for a much smaller and safer slice that leaves the authorization path untouched. That is a legitimate call, and this spec builds it faithfully, but the drift is real and the successor decision is enrolled as the first follow up item.

Spec 0008 removed roles and replaced them with a pure per user access control list. It shipped, and it works, but it recorded its own cost plainly: onboarding a user is a manual multi grant every time, and multi select plus copy grants from another user only soften that. The scope's Deferred list carries the matching entry, "Permission grouping (bundles), defer until per user granting becomes operationally painful, from spec 0008". This spec is that deferral coming due.

The forces that shape the answer are mostly about blast radius. Every protected request in the system already depends on the access service being reachable and on the gateway's permission cache being correct. Spec 0008 made that path fail closed, with a signed identity header whose hash covers the permission list and a NATS event that invalidates the cache. Anything that changes how effective permissions are computed changes the most load bearing query in the product, and gets it wrong in the direction of either locking everyone out or letting someone in. Anything that only adds an admin surface, by contrast, can be wrong without hurting a single live request.

The second force is what already exists in the repository. There is a placeholder page at `/permission/group` with a route and a nav entry wired to it, a permission catalog page that established the stacked `Page` scaffold with a hidden collapsible filter and `xs` actions, a `user-access-panel.ts` that already does the multi select attach and per row detach against a namespace grouped catalog, and a copy grants from another user endpoint whose `{ granted, skipped }` shape is exactly what a bulk grant response should look like. A design that reuses these costs a fraction of one that invents its own patterns.

The third force is the ownership rule the repository enforces in CI: a service may not import another service's source, and inter service traffic goes through NATS events or the gateway. The access service does not own users and must not learn to. Any design that needs a list of users inside the access domain is fighting that rule.

Not deciding leaves the placeholder page in the product indefinitely, and leaves every new hire's access assembled by hand from a twenty item checklist.

## Options considered

### Option 1: Group as a one shot template, copied into direct grants at apply time

Two tables, `access.group` and `access.permission_group`. Applying a group reads its permissions and inserts the missing ones into `access.permission_user` through the existing idempotent grant path, then forgets the group ever existed. The group keeps no record of who received it.

**Pros**:

- The authorization path does not change at all. `lookupPermissions`, the gateway cache, the identity header, and the `access.permission.changed` contract keep their exact shape, so no live request can regress.
- Every write reuses machinery that already works: the idempotent grant insert, the invalidation event, the audit writer, the response shape of copy grants.
- The audit trail stays complete and per user, because an apply lands as ordinary grants on the user it affected.
- Rollback is genuinely cheap. Drop two tables and the grants that were handed out remain valid, because they were always real grants.

**Cons**:

- Group edits never reach anyone already applied, and nothing detects the drift. The group name slowly becomes a lie.
- No group shortcut for revoking, so removing a set of access stays as manual as it is today.
- `status` shrinks to a single meaning, blocking apply, which is a weak use of a column that operators will read as "suspend".

### Option 2: Group as an assignment, with a third table and a union in the lookup

Add `access.group_user`, and change the effective permission lookup to union direct grants with the permissions of every active group the user belongs to. A group edit reaches every member at the next cache expiry.

**Pros**:

- Actually solves the problem spec 0008 recorded. Access follows the group, forever, with no drift and no reconciliation view needed.
- `status = 'off'` becomes a real emergency switch that suspends a whole class of access without deleting anything.
- Revoking becomes as cheap as granting: remove the membership.

**Cons**:

- Touches the most load bearing query in the product. The lookup, the cache invalidation strategy, and the reasoning about who is affected by one edit all change together, and a mistake locks people out or lets them in.
- One group edit can invalidate thousands of cache entries. The current event payload carries a single optional `userId`, so this needs either a fan out of one event per member or a blunt whole cache drop, and both need a considered decision.
- The permission list in the identity header grows with group size, and spec 0008 already warns at 4KB.
- Considerably larger slice, and the riskiest part is the part with no UI to inspect it.

### Option 3: Group as a label only, no apply at all

The two tables the request named, a page to manage them, and nothing else. Groups document intended permission sets for humans to read while granting by hand.

**Pros**:

- Smallest possible change, and impossible to break anything.
- Establishes the schema now so a later decision can build either apply or assignment on top of it.

**Cons**:

- Solves nothing. The operator still grants by hand, now with a second screen to consult while doing it.
- A feature whose only function is documentation will not be maintained, and the groups will drift from practice within weeks.

## Rationale

Option 1 wins on the blast radius force above, and the engineer chose it directly when the three models were put side by side. The decisive point is that the authorization path in this product is the one place where a mistake is both invisible in testing and severe in production: it fails closed, so an error locks real people out of a working system, and it is cached, so the error persists past the fix. Option 2 changes that path; Option 1 provably cannot, because nothing it adds is ever read while a request is being authorized. For a first pass at grouping, buying that guarantee is worth the drift it costs.

The reuse argument reinforces it. Every write path in Option 1 is a path that already runs in production: the idempotent grant insert, the invalidation event, the awaited audit write, the `{ granted, skipped }` response. The new code is a repository, a service, two routes files, and two pages, all following shapes the repository already established. Option 2 would need a new invalidation strategy designed from scratch, and that design is the part with no screen to inspect it.

Option 3 was rejected because it does not repay the migration it costs. A group nobody can apply is a note, and notes drift.

Two smaller calls were mine to make rather than the engineer's. First, both apply pickers read from the list endpoint with an `appliable=true` filter rather than getting an endpoint of their own, because a second endpoint returning a subset of the first is a contract to keep in step forever for no gain. Second, the 50 user cap on bulk apply is a module constant rather than an environment variable; it is a guard against a request holding a connection too long, not an operational dial, and spec 0008 already carries seven access related environment variables. The runner up in both cases was the more configurable version, and it loses on the same ground: configuration that nobody will ever tune is a cost with no benefit.

One consequence of the engineer's own answers deserves naming here rather than only in the consequences list. Choosing the template model and choosing "off only hides the group from assign" together reduce `status` to one behaviour: an `off` group cannot be applied. That is coherent, and this spec enforces it exactly, but it means the column is close to a boolean whose name promises more than it does. If the assignment model is ever built, `off` should be revisited at the same time, and that pairing is in the follow up list.

The engineer also asked for both apply surfaces, on the user page and on the group page, in one go. That is more surface than a first slice needs, so the build plan sequences them: the single user apply lands in slice 4 and proves the whole mechanism through a UI that already exists, and the bulk apply lands in slice 5 on top of a path that is already working. Nothing was cut, only ordered.
