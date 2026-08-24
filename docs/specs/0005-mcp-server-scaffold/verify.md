# Verify: MCP server for ERP tool access · spec 0005 · updated 2026-08-24

_These completed checks preserve the scaffold contract. The real stock endpoint and machine authentication remain separate Deferred features._

## Commands and protocol

- [x] Start the MCP app over STDIO, initialize it, list tools, call `check_stock`, and receive formatted mocked ERP data → AC-1, AC-2, AC-3, AC-8
- [x] Call `check_stock` with invalid input and an unknown tool and confirm no ERP request is made → AC-4, AC-5
- [x] Return an ERP failure, then make another call and confirm the server reports a tool error and keeps serving → AC-7
- [x] Start without each required environment value and confirm startup fails with the missing key name → AC-6
- [x] `bun run test:mcp` → the STDIO protocol, registry, validation, headers, error recovery, and environment tests pass → AC-1 to AC-8
- [x] `bun run typecheck:mcp && bun run build:mcp && bun run lint` → the app compiles, bundles, and passes repository policy → AC-9

## Acceptance criteria coverage

AC-1 through AC-9 are covered by the completed protocol and command checks. `/api/v1/stock` and gateway machine authentication are intentionally outside this scaffold and remain listed under Deferred in the scope.
