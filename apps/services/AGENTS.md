# Backend service conventions

When changing an Elysia backend service, keep plugin registration before the routes that use its context, and preserve chained Elysia construction so type inference remains intact.

Each module owns its route, request and response schema, service logic, and repository. Routes validate transport input and map declared errors. Services hold behavior. Repositories hold storage queries.

Use the shared error handler and existing typed errors for expected failures. New internal routes must use the existing signed identity plugin unless their contract explicitly defines a distinct authenticated caller.
