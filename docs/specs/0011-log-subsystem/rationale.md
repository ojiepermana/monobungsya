# Rationale

Audit Trail remains in PostgreSQL because business mutations need a strict write that participates in the existing transaction boundary.

Application Log and Access Log were removed from this feature. Keeping their writers and readers would preserve storage and behavior that the current product no longer needs. Removing them also keeps the logger contract small and prevents callers from assuming that diagnostic or request traffic is durable.

The retained design uses the existing `ActivityLog.writeAudit` API, yearly PostgreSQL partitions, the logs service read boundary, and the existing Angular page pattern. This avoids a new provider, storage system, or authorization model.
