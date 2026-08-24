# 0005. MCP server scaffold for ERP tool access

**Date**: 2026-08-20
**Status**: Accepted

## Summary

We add a new app at `apps/mcp`: an MCP server (Model Context Protocol, the standard that lets AI clients such as Claude Desktop and Cursor call tools in your systems) written in TypeScript and run with Bun over STDIO (the client starts the server as a child process and talks over standard input and output). It ships one starter tool, `check_stock`, which calls this repo's own gateway over HTTP. The scaffold follows the repo's single root manifest rule and shared TypeScript base config, and uses a small tool registry pattern so dozens of future tools plug in with one file plus one registry line.

> ⚠️ Premise note: the tool this scaffold ships, `check_stock`, targets a gateway inventory endpoint that does not exist yet, and the gateway today authenticates browsers with a session cookie, not machine tokens. Neither gap blocks the scaffold (the tool will return a clean error until the endpoint ships), but both need their own specs before this server is useful in production. They are recorded as constraints here and as Follow-up items.

## Context

The engineer wants AI clients to reach ERP data in this monorepo through MCP. The repo already has a public HTTP surface (the Elysia gateway on port 3000, routes under `/api/v1/*`), and the engineer confirmed the "ERP" this server integrates with is that gateway, not an external system.

The monorepo enforces hard conventions that shape any new app: one root `package.json` and one `node_modules` (no manifests under `apps/`), one root `.env.example`, a shared `tsconfig.base.json` with Bundler module resolution (plain relative imports, no `.js` extensions), Biome lint, and root scripts per app (`dev:<name>`, `typecheck:<name>`, `build:<name>`). The engineer's original request asked for a standalone package layout (own `package.json`, NodeNext, own `.env.example`); in the design conversation they chose to follow the repo conventions instead on every point.

The forces at play: the server must be trivially runnable by MCP clients (STDIO, one command), must scale from one tool to hundreds without touching the server core, and must not leak the transport channel (STDIO servers that write logs to stdout corrupt the protocol stream). Not deciding a structure now means the first few tools would accrete ad hoc logic in the entry point, which is exactly what makes MCP servers unmaintainable past ten tools.

## Requirements

**User stories**:

- As an AI client user, I want to ask my assistant for stock levels so that I get ERP data without opening the app.
- As a backend engineer, I want a fixed tool interface so that adding tool number 50 is as cheap as adding tool number 2.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: `bun run dev:mcp` starts the server over STDIO and completes the MCP initialize handshake; nothing except protocol messages is ever written to stdout (logs go to stderr).
- **AC-2**: a `tools/list` request returns `check_stock` with its description and a JSON Schema input schema derived from the tool's zod schema.
- **AC-3**: a `tools/call` of `check_stock` with a valid `sku` issues `GET {ERP_URL}/api/v1/stock?sku=<url encoded sku>` with header `Authorization: Bearer {ERP_TOKEN}`, and returns the response body as formatted JSON text content.
- **AC-4**: a `tools/call` with a missing or empty `sku` is rejected with an MCP invalid params error and no HTTP request is sent.
- **AC-5**: a `tools/call` naming an unknown tool returns an MCP error; the server keeps serving.
- **AC-6**: when `ERP_URL` or `ERP_TOKEN` is missing or empty, startup fails immediately with an error naming the missing variable.
- **AC-7**: when the ERP responds with an error status or the request fails or times out, the tool returns an error result (`isError: true`) describing the failure; the server process stays alive.
- **AC-8**: adding a new tool requires exactly one new file under `apps/mcp/src/tools/<module>/` exporting a `ToolDefinition`, plus one entry in `apps/mcp/src/tools/index.ts`; the entry point contains no per tool logic.
- **AC-9**: repo checks pass: `bun run lint` and `bun run typecheck:mcp` succeed; there is no `package.json` or `.env.example` under `apps/mcp`; dependencies live in the root manifest.

## Options considered

### Option 1: Low level `Server` plus a declarative `ToolDefinition` registry

Use the SDK's low level `Server` class with explicit `ListToolsRequestSchema` and `CallToolRequestSchema` handlers that iterate a typed array of tool definitions. Each tool is a plain object (name, description, zod schema, execute function) in its own file.

**Pros**:

- One generic dispatch path; the entry point never grows as tools are added.
- The registry is plain data, easy to test, filter, group by module, or generate docs from.

**Cons**:

- More boilerplate than the high level API for the first tool; you write the list and call handlers yourself.

### Option 2: High level `McpServer` with `registerTool` calls

Use the SDK's `McpServer` convenience class and register each tool imperatively at startup.

**Pros**:

- Less code for the first tool; the SDK handles list and call dispatch and zod validation.

**Cons**:

- Registration is imperative, so consistent structure across hundreds of tools depends on discipline rather than a type; harder to treat the tool set as data (grouping, doc generation, per module toggles).

### Option 3: Standalone package layout (own manifest, NodeNext, `.js` import extensions)

Scaffold `apps/mcp` as an independent npm style package as originally requested.

**Pros**:

- Publishable to npm as is; runnable outside the monorepo.

**Cons**:

- Breaks the repo's single manifest rule, creates a second dependency tree and a second env file to keep in sync, and diverges from every other app's tsconfig style for no current need (nothing here is being published).

## Decision

**Chosen option**: Option 1: low level `Server` plus a declarative `ToolDefinition` registry, integrated the repo's way (root manifest, root env, shared tsconfig base).

A new `apps/mcp` app named `monobungsia-mcp` (version 1.0.0) serves MCP over STDIO with a typed tool registry; dependencies, scripts, and env vars live at the repo root like every other app.

## Rationale

The engineer's stated goal is "dozens to hundreds of tools across inventory, sales, purchasing, finance, and customer". That goal decides between options 1 and 2: a declarative registry makes the tool set data, which is what keeps a large catalog consistent, testable, and cheap to extend; the high level API is nicer for three tools and worse for a hundred. Option 3 lost on the repo's own rules: the engineer confirmed in the design conversation that the single root manifest, the shared tsconfig base, and the single root `.env.example` win over the standalone layout in the original request, and nothing here needs to be publishable.

Calls settled here with design context (each with the runner up): the stock path is `GET /api/v1/stock` (aligned with the gateway's public `/api/v1/*` prefix; runner up was the literal `/api/stock` from the request, which no route in this repo would ever match). ERP requests carry a 15 second timeout via `AbortSignal.timeout` (runner up: no timeout; a hung fetch inside a STDIO tool call freezes the client's conversation, so bounded failure wins). JSON Schema for `tools/list` comes from zod v4's built in `z.toJSONSchema` (runner up: the `zod-to-json-schema` package, an extra dependency zod v4 made unnecessary). ERP failures return `isError: true` tool results while protocol misuse (unknown tool, bad arguments) throws `McpError` (runner up: throwing for everything; the split keeps business failures visible to the model as content while protocol errors stay protocol errors). The server name is `monobungsia-mcp` per the engineer's pick over the requested `edsis-mcp-server`.

## Feature design

**Data model sketch**:
None. The server is stateless; it holds no database and persists nothing. All data flows through per call HTTP requests to the gateway.

**State transitions**: none.

**API surface** (the MCP tool surface plus the outbound HTTP call):

| Endpoint                       | Method | Key inputs                      | Key outputs                                  | Auth                                | Key errors                                                                                  |
| ------------------------------ | ------ | ------------------------------- | -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| MCP `tools/list`               | —      | none                            | tool name, description, JSON Schema per tool | local STDIO client                  | none                                                                                        |
| MCP `tools/call` `check_stock` | —      | `sku: string` (req, min 1)      | formatted JSON text of the stock payload     | local STDIO client                  | invalid params (empty sku), method not found (unknown tool), `isError` result (ERP failure) |
| `{ERP_URL}/api/v1/stock`       | GET    | `sku` query param (URL encoded) | stock payload JSON                           | `Authorization: Bearer {ERP_TOKEN}` | error status → thrown in `erpApi`, surfaced as `isError` result                             |

**File layout** (all imports plain relative, no `.js` extensions):

```
apps/mcp/
├── tsconfig.json                  # extends ../../tsconfig.base.json, types: ["bun"]
└── src/
    ├── index.ts                   # server wiring only: registry dispatch, transport connect
    ├── config/env.ts              # reads and validates ERP_URL, ERP_TOKEN
    ├── services/erpApi.ts         # erpRequest(path, options), getStock(sku)
    ├── tools/
    │   ├── types.ts               # ToolDefinition interface
    │   ├── index.ts               # export const tools: ToolDefinition[] = [...]
    │   └── inventory/checkStock.ts
    └── utils/toolResponse.ts      # jsonToolResponse(data)
```

Future modules (`sales/`, `purchasing/`, `finance/`, `customer/`) are sibling folders under `tools/`, created when their first tool lands.

**Root wiring** (no files under `apps/mcp` besides the above):

- root `package.json` dependencies: add `@modelcontextprotocol/sdk` (zod is already present).
- root scripts: `dev:mcp` (`bun --watch apps/mcp/src/index.ts`), `typecheck:mcp` (`tsc --noEmit -p apps/mcp/tsconfig.json`, added to the `typecheck` parallel list), `build:mcp` (`bun build apps/mcp/src/index.ts --outdir dist/mcp --target=bun`).
- root `.env.example`: a commented ERP section with `ERP_URL=http://localhost:3000` and `ERP_TOKEN=change-me`.

**`ToolDefinition` contract** (the one interface every tool implements):

- `name: string` (snake_case, verb first, e.g. `check_stock`)
- `description: string` (one sentence, written for the model)
- `inputSchema: z.ZodType` (zod object schema; `tools/list` serves `z.toJSONSchema(inputSchema)`)
- `execute(args): Promise<CallToolResult>` (receives zod parsed args, returns MCP content)

**Value sourcing** (every value each action produces or displays names its source):

| Action                   | Value produced / displayed        | Source                                                                |
| ------------------------ | --------------------------------- | --------------------------------------------------------------------- |
| startup                  | `ERP_URL`, `ERP_TOKEN`            | `process.env` via `config/env.ts`, validated non empty                |
| `tools/list`             | tool names, descriptions          | the `ToolDefinition` registry in `tools/index.ts`                     |
| `tools/list`             | JSON Schema per tool              | derived from each tool's zod schema via `z.toJSONSchema`              |
| `tools/call check_stock` | `sku`                             | tool call arguments, validated by the tool's zod schema               |
| `tools/call check_stock` | request URL                       | derived: `ERP_URL` + `/api/v1/stock?sku=` + `encodeURIComponent(sku)` |
| `tools/call check_stock` | bearer token header               | `ERP_TOKEN` from env                                                  |
| `tools/call check_stock` | stock payload text                | gateway response body, JSON, formatted with 2 space indent            |
| any failed ERP call      | error message in `isError` result | HTTP status plus response body snippet from `erpApi`'s thrown error   |

**Key invariants**:

- stdout carries only MCP protocol traffic; all logging uses `console.error` (stderr).
- `index.ts` contains zero tool specific logic; dispatch is generic over the registry.
- Every tool call's arguments pass zod validation before any side effect runs.
- `ERP_TOKEN` never appears in logs, error messages, or tool results.
- Layering mirrors the repo's services: tool (interface) → service (`erpApi`) → HTTP; tools never call `fetch` directly.

**Security model**:
The server runs locally with the invoking user's privileges; the STDIO client (Claude Desktop, Cursor, MCP Inspector) is trusted, which is the standard MCP local trust model. The only secret is `ERP_TOKEN`, read from env, sent only as a bearer header, never logged. `sku` is URL encoded before interpolation, so no query injection. Constraint to carry: the gateway currently authenticates via session cookie (spec 0003) and has no bearer token path, so until a machine auth scheme ships, the token is forward wiring only and protected gateway routes will reject this server (see Follow-up). No PII is stored; nothing is written to disk.

**Configuration required**:

- `ERP_URL`: base URL of the ERP API, this repo's gateway (`http://localhost:3000` in dev).
- `ERP_TOKEN`: bearer token for ERP requests; required non empty at startup.

**Critical test scenarios** (each maps to an acceptance criterion):

- Happy path: Inspector or a scripted client lists tools then calls `check_stock` with a valid sku against a stubbed gateway; the formatted JSON comes back, verifies **AC-2**, **AC-3**.
- Failure case: gateway stub returns status 500; the tool returns `isError: true` with the status, and a follow up call still works, verifies **AC-7**, **AC-5**.
- Validation: calling `check_stock` with `{}` or `{ "sku": "" }` yields an invalid params error and the stub records no request, verifies **AC-4**.
- Startup guard: launching with `ERP_TOKEN` unset exits with an error naming `ERP_TOKEN`, verifies **AC-6**.

## Build plan

Ordered as a Tracer Bullet: root wiring first, then one thin thread (env → service → tool → server → STDIO) proves the whole path with the single starter tool, then docs.

1. Root wiring: add `@modelcontextprotocol/sdk` to root dependencies; add `dev:mcp`, `typecheck:mcp`, `build:mcp` scripts (and `typecheck:mcp` to the parallel `typecheck` list); add the ERP section to root `.env.example`; create `apps/mcp/tsconfig.json` extending the base, satisfies **AC-9**, prerequisite for **AC-6**.
2. Config and ERP layer: `src/config/env.ts` (throw naming the missing var) and `src/services/erpApi.ts` (`erpRequest` with base URL, bearer header, JSON content type, 15 s timeout, throw on error status; `getStock(sku)` hitting `/api/v1/stock`), satisfies **AC-6**, groundwork for **AC-3**, **AC-7**.
3. Tool layer: `src/tools/types.ts` (`ToolDefinition`), `src/utils/toolResponse.ts` (`jsonToolResponse`), `src/tools/inventory/checkStock.ts`, and the registry `src/tools/index.ts`, satisfies **AC-8**, groundwork for **AC-2**, **AC-4**.
4. Server wiring: `src/index.ts` creates the `monobungsia-mcp` server, registers generic `tools/list` (registry → `z.toJSONSchema`) and `tools/call` handlers (lookup → zod parse → execute; `McpError` for unknown tool and invalid args; `isError` result for execute failures), connects `StdioServerTransport`, logs to stderr only, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-7**.
5. Docs and verification: `apps/mcp/README.md` (install, run, MCP Inspector testing, Claude Desktop and Cursor config, how to add a tool, layering rules, the User → LLM → MCP client → MCP server → ERP API flow); run `bun run lint` and `bun run typecheck:mcp`, satisfies **AC-9**, documents **AC-8**.

## Consequences

**Positive**:

- New tools cost one file plus one registry line; the server core never changes.
- The app obeys every repo rule (single manifest, root env, shared tsconfig, Biome), so `/sync`, CI, and future extraction stay uniform.
- Stateless design: nothing to migrate, nothing to back up, safe to kill and restart.

**Negative / tradeoffs**:

- `check_stock` cannot return real data until a gateway stock endpoint exists; until then every call ends in a clean error.
- Bearer auth is forward wiring; the gateway ignores it today, so there is no real machine authorization yet.
- The low level SDK API means we own list and call dispatch code the high level API would have provided.
- A flat registry file becomes a long import list at hundreds of tools; acceptable, and it can later be split per module without changing the pattern.

**Neutral**:

- First MCP dependency in the repo; the SDK lands in the single root lockfile.
- STDIO only for now; an HTTP transport would be a separate decision.

## Follow-up

- [ ] The gateway has no `/api/v1/stock` route; design and build the inventory endpoint (own spec) so `check_stock` returns real data.
- [ ] The gateway has no machine auth; decide a service token scheme (own spec) so `ERP_TOKEN` actually authorizes requests, and align it with the HMAC identity forwarding from spec 0003.
- [ ] Decide whether CI's typecheck job needs the new `typecheck:mcp` entry called out explicitly (it inherits via the parallel `typecheck` script).
