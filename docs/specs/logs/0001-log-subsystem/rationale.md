# 0001. Log subsystem, decision record

This file holds the reasoning behind [index.md](index.md). Builds read the index only; this is for humans and future decision reviews.

## Context

ETOS Payroll handles money and personnel data, so three distinct trails matter: diagnostics for developers, an immutable audit of business changes for accountability, and access events for security review. The team runs a single PostgreSQL instance beside the Bun and Elysia backend and an Angular SPA, and prefers self contained infrastructure over extra services. Log data grows without bound, so time based partitioning had to be part of the storage design from day one, and Indonesian operations mean the business day follows Jakarta time (UTC+7) even though storage is UTC.

Without a decision, logging would scatter across console output and ad hoc tables, audits would be unqueryable, and there would be no operator visibility without direct database access.

## Options considered

Options considered were not documented at decision time. The engineer went straight to this design; no external log service (such as a hosted log platform) or file based logging was evaluated.

## Rationale

The engineer's stated reason: queries and audits are easy because logs live in the same database as the application. One Postgres serves both app and logs, so an auditor can join an audit row to the entity it describes, and no extra service must be deployed, secured, or paid for. Yearly range partitions keep that choice sustainable: old years can be detached or dropped without rewriting the table, and the Jakarta year boundary keeps partitions aligned with the business calendar rather than the UTC one.

The write path split follows the risk profile: diagnostics are best effort (a lost debug line must never fail a payroll request), while audit trails are awaited and throw, because an unrecorded business change is worse than a failed request. Accepted tradeoffs: log volume shares capacity with application data, ILIKE search will slow on large partitions, and fire and forget writes can be lost on a crash.
