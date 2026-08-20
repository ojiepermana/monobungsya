# 0001. Adopt a Bun monorepo with explicit Elysia service boundaries

**Date**: 2026-08-20
**Status**: Proposed

## Summary

Project ini memakai satu Bun workspace untuk web client, API Gateway, dan service domain. Angular menggunakan client yang dihasilkan dari public OpenAPI Gateway, sementara service memakai Bun SQL native untuk PostgreSQL dan NATS melalui package infrastructure yang kecil. Root `package.json` menjadi sumber dependency dan Bun memakai satu physical `node_modules`. Setiap service tetap memiliki boundary source, test, konfigurasi, dan Docker image sendiri sehingga dapat dipisahkan nanti tanpa mengubah business architecture.

## Context

Project dimulai dari workspace kosong dan perlu memberi developer baru struktur yang dapat dipahami. Sistem membutuhkan HTTP API, event bus internal, database transactional, generated frontend client, typed configuration, observability dasar, serta deployability per service.

Beberapa service domain sudah dipilih sejak awal, yaitu auth, user, employee, payroll, dan reporting. Kontrak antar service harus mencegah import source internal, sedangkan shared package harus tetap bebas dari business domain agar pemisahan repository di masa depan tidak menjadi rewrite.

## Options considered

### Option 1: One large application

Semua domain berada dalam satu aplikasi deployable dengan module internal.

**Pros**:

* Paling sederhana untuk operasi awal.
* Transaction dan local call mudah ditelusuri.

**Cons**:

* Boundary ownership dan deployability per service harus dibangun ulang ketika kebutuhan berubah.
* Kontrak service mudah menjadi implisit jika semua module dapat saling import.

### Option 2: Explicit service applications in one monorepo

Setiap domain memiliki Bun application sendiri, tetapi package infrastructure dan contract tetap berada di workspace yang sama.

**Pros**:

* Boundary, deployment, test, dan ownership terlihat sejak awal.
* Service dapat dipindahkan ke repository sendiri dengan perubahan kecil.
* Shared code tetap terbatas pada infrastructure dan contract yang benar benar reusable.

**Cons**:

* Developer menjalankan beberapa process dan harus memahami failure mode distributed system.
* Database, messaging, logging, dan contract pipeline perlu aturan operasional sejak hari pertama.

### Option 3: Full platform framework for all services

Membuat custom framework atau layer abstraksi generik yang memaksa semua service memakai lifecycle dan repository yang sama.

**Pros**:

* Beberapa boilerplate awal dapat berkurang.
* Cross cutting concern terlihat seragam.

**Cons**:

* Abstraksi menjadi coupling baru dan menyembunyikan ownership domain.
* Perubahan framework internal akan berdampak ke semua service.
* Generic repository dan service berisiko menghapus perbedaan business operation yang penting.

## Decision

**Chosen option**: Option 2: Explicit service applications in one monorepo

Gunakan root Bun project dengan Angular app, Elysia API Gateway, lima Bun service domain, dan shared package infrastructure yang minimal. Hanya `packages/*` menjadi workspace package bernama, sedangkan semua app dijalankan langsung dari source path oleh root scripts. Elysia TypeBox schema menjadi source of truth untuk OpenAPI. Gateway adalah satu satunya public entry point pada `/api/v1/*`; komunikasi domain memakai NATS abstraction atau internal HTTP saat memang diperlukan.

**Implementation skills**: `angular-developer` (`/Users/ojiepermana/.agents/skills/angular-developer/`) · `angular-new-app` (`/Users/ojiepermana/.agents/skills/angular-new-app/`) · `elysiajs` (`/Users/ojiepermana/.agents/skills/elysiajs/`)

### Scaffold contract

* Root package memakai Bun project dan import map untuk source package, lalu menjalankan semua app dari root scripts.
* Root `package.json` memiliki seluruh dependency versioning, scripts, dan app entrypoints.
* Root `package.json` menyediakan import map `#project/*` untuk source shared packages.
* Bun install menghasilkan satu physical `node_modules` di root.
* App source berada di `apps/web`, `apps/api-gateway`, `apps/services/auth`, `apps/services/user`, `apps/services/employee`, `apps/services/payroll`, dan `apps/services/reporting` tanpa manifest lokal.
* Shared package hanya berisi `contracts`, `angular-sdk`, `database`, `messaging`, `config`, `logger`, dan `errors`.
* Setiap app memiliki `GET /health`, typed env, logger, error handler, OpenAPI, Bun smoke test, dan graceful shutdown.
* Business module mengikuti `route -> schema -> service -> repository -> database`.
* Gateway memiliki boundary `/api/v1/auth/*`, `/api/v1/users/*`, `/api/v1/employees/*`, `/api/v1/payroll/*`, dan `/api/v1/reports/*`.
* Tidak ada generic repository, generic service, cross service source import, atau business logic di gateway.
* `bun run openapi:generate` menghasilkan spec service, public gateway spec, dan generated SDK.
* `bun run openapi:validate` memvalidasi semua spec dan `bun run check:dependencies` memeriksa cross service import.
* Setiap deployable app memiliki Dockerfile yang dibangun dengan root workspace sebagai context.

## Rationale

Option 2 mempertahankan struktur monorepo yang diminta tanpa menghapus batas domain. Service lokal tetap eksplisit dan dapat diuji atau dibuat image secara independen, sedangkan package shared tetap kecil sehingga pemisahan repository tidak membawa business coupling.

Premise pentingnya adalah bahwa scaffold ini belum membuktikan kebutuhan scale untuk microservices penuh. Biaya distributed system diterima hanya pada boundary yang sudah diminta, bukan dengan menambah orchestration, service mesh, generic framework, atau abstraction yang belum memiliki kebutuhan nyata.

## Proposed stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Workspace | Root Bun project dengan import map, Bun 1.3.14 | Satu package manager dan satu dependency directory untuk install, script, test, dan runtime. |
| Language | TypeScript strict mode | Menjaga contract dan boundary tetap terlihat saat code dipindahkan. |
| Web | Angular 22.1 line | Latest Angular scaffold yang tersedia saat dibuat, standalone component, signals, dan native control flow. |
| Backend | Elysia latest | Bun first HTTP framework dengan schema validation dan composition model yang ringkas. |
| HTTP contract | Elysia OpenAPI plugin | Schema route menjadi sumber OpenAPI sehingga DTO tidak diduplikasi. |
| Frontend SDK | `@hey-api/openapi-ts` latest | Client dan types dihasilkan dari public gateway OpenAPI, terpisah dari source Angular. |
| Database | Bun SQL native untuk PostgreSQL | Relational transactional store dengan tagged template parameter binding, pool, transaction, dan close helper tanpa driver npm tambahan. |
| Messaging | NATS melalui `nats` | Publisher, subscriber, dan request response untuk komunikasi internal. |
| Backend test | Bun Test | Test HTTP Elysia memakai Web Standard `Request` dan `app.handle`. |
| Frontend test | Angular CLI dan Vitest | Toolchain Angular 22 yang dibuat oleh Angular CLI. |
| Lint | Biome | Satu lint dan formatter ringan pada workspace. |
| Observability | JSON logger lokal | Timestamp, level, service, request ID, dan correlation ID tersedia tanpa tracing platform kompleks. |
| Deployment | Satu Dockerfile per deployable app | Image dan lifecycle dapat dirilis per application. |

## Consequences

**Positive**:

* Dependency flow dapat dipahami dari folder dan import.
* Public API contract dan generated SDK mempunyai pipeline yang dapat diulang.
* Service dapat dikembangkan dan diuji secara independen.
* PostgreSQL transaction helper dan NATS lifecycle tidak diduplikasi di setiap service.

**Negative / tradeoffs**:

* Lima service berarti lebih banyak process, environment, log, dan failure mode saat development.
* Gateway forwarding memerlukan service URL configuration dan contract testing yang lebih kuat ketika endpoint bisnis ditambahkan.
* Generated SDK harus selalu dihasilkan ulang setelah public schema berubah.
* Auth, authorization, tenant isolation, migrations bisnis, dan retry policy belum diselesaikan oleh scaffold.

**Neutral**:

* `ENABLE_INFRASTRUCTURE=false` memungkinkan health dan test berjalan tanpa PostgreSQL atau NATS lokal.
* Service internal mempunyai OpenAPI spec sendiri, tetapi hanya gateway spec yang menjadi public contract.
* Event contract tersedia tanpa memaksa event handler atau business workflow dibuat sekarang.

## Follow-up

* [x] Putuskan authentication dan authorization sebelum endpoint bisnis public ditambahkan, melalui spec 0003.
* [ ] Putuskan tenant isolation, audit log, dan retention untuk data enterprise sebelum migration domain pertama.
* [x] Tambahkan CI yang menjalankan install frozen, typecheck, test, lint, OpenAPI validation, SDK generation, dan build per app.
* [x] Tambahkan contract test untuk gateway forwarding dan service availability.
* [x] Tambahkan migration runner yang dipilih untuk kebutuhan domain saat database schema pertama dibuat.
* [ ] Evaluasi apakah service split benar benar diperlukan berdasarkan ownership dan bottleneck yang terukur.

## References

**Project sources**:

* `pre-plan.md`, target structure dan aturan dependency flow.
* `apps/web/AGENTS.md`, Angular 22 standalone, signals, accessibility, dan CLI conventions.
* `/Users/ojiepermana/.agents/skills/angular-developer/`, Angular implementation guidance.
* `/Users/ojiepermana/.agents/skills/angular-new-app/`, Angular CLI creation workflow.
* `/Users/ojiepermana/.agents/skills/elysiajs/`, Elysia feature based structure dan Bun first runtime.

**Practices & standards**:

* Layered dependency flow, route to service to repository to database.
* API first contract generation from schema.
* Domain ownership and bounded context separation.
* Structured logging and request correlation.
* Avoid premature generic abstractions.
