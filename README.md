# Monobungsia

Monobungsia adalah scaffold monorepo enterprise berbasis Bun. Satu repository berisi Angular sebagai web client, API Gateway berbasis Elysia, dan lima service domain yang dapat dikembangkan serta dibuat image Docker secara independen.

## Arsitektur

```mermaid
flowchart LR
  web[Angular web]
  gateway[API Gateway\nElysia + OpenAPI]
  auth[Auth service]
  user[User service]
  employee[Employee service]
  payroll[Payroll service]
  reporting[Reporting service]
  postgres[(PostgreSQL)]
  nats[(NATS)]

  web -->|Generated SDK| gateway
  gateway --> auth
  gateway --> user
  gateway --> employee
  gateway --> payroll
  gateway --> reporting
  auth --> postgres
  user --> postgres
  employee --> postgres
  payroll --> postgres
  reporting --> postgres
  auth --> nats
  user --> nats
  employee --> nats
  payroll --> nats
  reporting --> nats
```

API Gateway adalah public entry point. Angular tidak memanggil service domain secara langsung. Service tidak mengimpor source service lain.

## Struktur

`apps/web` berisi Angular 22 dan hanya memakai client yang dihasilkan dari kontrak gateway.

`apps/api-gateway` berisi routing public, CORS, request ID, OpenAPI public, dan forwarding ke service internal. Gateway tidak memiliki business logic domain.

`apps/services/*` berisi auth, user, employee, payroll, dan reporting. Setiap service memiliki composition root, config typed, plugin lokal, module domain, repository domain, database boundary, jobs, test, dan Dockerfile.

`packages/contracts` berisi HTTP artifacts OpenAPI dan event contracts. `packages/database` hanya berisi Bun SQL native untuk PostgreSQL. `packages/messaging` hanya berisi abstraction NATS. `packages/config`, `packages/logger`, dan `packages/errors` berisi infrastructure lintas service yang benar benar reusable.

Root `package.json` adalah sumber dependency versioning, import map `#project/*`, dan scripts untuk seluruh app. Bun membuat satu physical `node_modules` di root. Tidak ada `package.json` atau `node_modules` di bawah `apps` dan `packages`; semua source dijalankan langsung dari root.

Tidak ada `BaseRepository`, `GenericRepository`, `GenericService`, atau query builder generik. Repository tetap domain specific dan berada di service pemilik domain.

## Dependency flow

```text
HTTP request
  -> route
  -> Elysia schema validation
  -> service
  -> domain repository
  -> database package
  -> PostgreSQL
```

Route tidak memanggil repository langsung. Repository tidak mengetahui HTTP. Transaction boundary berada di service dan dapat memakai `withTransaction` dari package database.

## Service ports

| App         | Port | Public path                |
| ----------- | ---: | -------------------------- |
| web         | 4200 | Angular development server |
| api gateway | 3000 | `/api/v1/*`                |
| auth        | 3101 | internal only              |
| user        | 3102 | internal only              |
| employee    | 3103 | internal only              |
| payroll     | 3104 | internal only              |
| reporting   | 3105 | internal only              |

Setiap app memiliki `GET /health`. Service module smoke endpoint berada pada `/internal/<module>/status` dan hanya menjadi contoh boundary awal.

## Menjalankan development

Prasyarat: Bun 1.3 atau lebih baru dan Node.js untuk Angular CLI tooling. Dependency dikelola hanya dengan Bun.

```bash
bun install
cp .env.example .env
bun run dev:gateway
bun run dev:user
bun run dev:web
```

`bun run dev` menjalankan seluruh app secara paralel. Untuk development lokal tanpa PostgreSQL dan NATS, biarkan `ENABLE_INFRASTRUCTURE=false`. Koneksi Bun SQL dan NATS dibuat oleh `main.ts` hanya ketika flag tersebut diaktifkan.

Script utama:

```bash
bun run dev
bun run test
bun run test:web
bun run lint
bun run typecheck
bun run build
bun run openapi:generate
bun run openapi:validate
bun run check:dependencies
bun run db:migrate
bun run db:seed
bun run db:reset --confirm --seed
```

## OpenAPI dan Angular SDK

Schema Elysia adalah source of truth. `scripts/openapi-generate.ts` membuat spec dengan memanggil `/openapi/json` pada app composition root, tanpa perlu menyalakan server.

Hasilnya ditulis ke `openapi.yaml` pada gateway dan setiap service. Public gateway spec juga disalin ke `packages/contracts/openapi/generated/public-api.openapi.yaml`.

`bun run openapi:generate` lalu menjalankan `@hey-api/openapi-ts` dan menulis generated SDK ke `packages/angular-sdk/src/generated`. Folder generated tidak diedit manual. Angular mengimpor `#project/angular-sdk` dari root import map dan mengonfigurasi generated client pada composition root aplikasi.

`bun run openapi:validate` memeriksa OpenAPI 3, `info`, dan `paths` pada seluruh spec.

## NATS dan event

`packages/messaging` menyediakan publisher, subscriber, request response, dan lifecycle connection untuk NATS. Business service memakai abstraction ini, bukan detail connection di seluruh business logic.

Event contract ada di `packages/contracts/src/events`. Event handler implementation tetap berada di module service pemilik event. Event contract awal yang tersedia adalah user created, user updated, user deleted, employee created, dan payroll run completed.

## Database

`packages/database` menyediakan native Bun SQL client untuk PostgreSQL, transaction helper, close helper, dan runner database internal. Migration serta seed canonical berada di `packages/database/migrations` dan `packages/database/seeds`, bukan di dalam service deployable.

PostgreSQL 18 menjadi prasyarat. Semua primary key application table memakai `uuid` dengan default native `uuidv7()`. Database memakai multischema dengan ownership berikut:

| Scope     | Schema      |
| --------- | ----------- |
| auth      | `auth`      |
| user      | `user`      |
| employee  | `employee`  |
| payroll   | `payroll`   |
| reporting | `reporting` |
| logs      | `logs`      |

Gunakan `DATABASE_MIGRATION_URL` untuk role migration. `DATABASE_RESET_ALLOWED=true` hanya boleh dipakai pada development atau test.

Role PostgreSQL dibuat oleh DBA atau infrastructure automation, bukan oleh migration runner. Nama role canonical adalah `project_migrator`, `project_auth_runtime`, `project_user_runtime`, `project_employee_runtime`, `project_payroll_runtime`, `project_reporting_runtime`, dan `project_logs_writer`. Password serta atribut login harus disimpan di secret manager. Auth email links use `PUBLIC_API_URL`, then redirect to `WEB_APP_URL` after verification.

```bash
bun run db:migrate
bun run db:seed
bun run db:reset --confirm --seed
bun run db:migrate:down --steps 1
bun run db:seed:reset --service auth
```

`db:migrate` dan `db:seed` menerima `--service <name>` serta `--dry-run` yang sesuai. Reset hanya menghapus schema allowlist dan tracking table, tidak menghapus database.

Semua query baru harus menggunakan parameter binding. Filtering dan sorting harus memakai field whitelist di repository domain. Jangan membuat dynamic SQL framework generik.

## Error, logging, dan shutdown

`packages/errors` menyediakan `AppError` serta error HTTP umum. Setiap Elysia app memiliki global error mapping yang tidak mengembalikan error database mentah.

`packages/logger` menulis JSON structured log dengan timestamp, level, service, request ID, dan correlation ID jika tersedia.

`main.ts` hanya memuat config, membuat app, memulai HTTP server, dan menangani graceful shutdown. Service menutup HTTP server, NATS connection, database connection, dan worker lifecycle yang kelak ditambahkan.

## Menambah service baru

1. Buat folder service baru di `apps/services/<service>`.
2. Salin struktur service yang paling dekat, lalu ganti module, port, OpenAPI info, dan Dockerfile.
3. Tambahkan dependency baru hanya di root `package.json`.
4. Tambahkan `dev`, `test`, `typecheck`, dan `build` script ke root.
5. Tambahkan service URL dan route boundary pada gateway bila service public.
6. Tambahkan service ke script OpenAPI dan smoke test.
7. Jalankan typecheck, test, OpenAPI validate, dependency check, dan build.

## Menambah module baru

Module berada di `src/modules/<module>`. Mulai dari route, schema, service, dan repository yang eksplisit. Route hanya menangani HTTP. Schema hanya validasi dan API schema. Service menangani business logic, workflow, transaction boundary, integration, dan messaging. Repository hanya menangani data access.

Jangan memindahkan domain code ke `packages` hanya karena terlihat dapat dipakai ulang. Pindahkan hanya setelah kebutuhan reuse lintas service nyata dan kontraknya stabil.

## Docker

Setiap deployable app memiliki satu Dockerfile canonical di `infra/docker`. Build dijalankan dari root agar workspace dependency dapat dipasang:

Gateway dan service backend dibundle dengan `bun build --minify` pada tahap build. Image final hanya memuat `main.js` hasil build dan Bun slim, lalu menjalankan artifact tersebut sebagai user non root.

```bash
docker build -f infra/docker/web/Dockerfile --build-arg WEB_API_URL=https://api.example.com .
docker build -f infra/docker/gateway/Dockerfile .
docker build -f infra/docker/services/auth/Dockerfile .
docker build -f infra/docker/services/user/Dockerfile .
docker build -f infra/docker/services/employee/Dockerfile .
docker build -f infra/docker/services/payroll/Dockerfile .
docker build -f infra/docker/services/reporting/Dockerfile .
```

The web image listens on container port 8080 as a non root Nginx process. Map public port 80 to container port 8080 in the deployment. The gateway listens on 3000, while auth, user, employee, payroll, and reporting listen on 3101 through 3105. PostgreSQL, NATS, SMTP, and database migration remain outside application images.

Untuk menjalankan seluruh stack secara lokal, gunakan Docker Compose dari root repository:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

Buka web di `http://localhost:4200` dan Mailpit di `http://localhost:8025`. Compose menjalankan PostgreSQL, NATS, Mailpit, migration database, gateway, lima service domain, dan web. Untuk menghentikan stack serta menghapus volume database lokal, gunakan `docker compose -f infra/docker/docker-compose.yml down -v`.

## Aturan dependency antar service

Service boleh mengimpor shared package dan kontrak event. Service tidak boleh mengimpor package atau source internal service lain. Komunikasi antar service memakai NATS untuk event dan asynchronous workflow, atau internal HTTP melalui gateway atau client yang disepakati saat kebutuhan nyata muncul.

Aturan ini membuat `apps/services/user` dapat dipindahkan ke repository sendiri dengan membuat root `package.json` baru untuk service tersebut dan mempertahankan dependency package yang sama.

## Repository split di masa depan

Saat ownership atau deployment benar benar membutuhkan pemisahan, pindahkan satu folder service bersama `tsconfig.json`, source, test, migrations, seeds, jobs, dan Dockerfile. Buat root `package.json` baru untuk service tersebut, lalu pertahankan dependency pada package contracts, database, messaging, config, logger, dan errors. Jangan membawa source service lain. Public contract tetap berasal dari API Gateway dan package contracts.

## Status scaffold

Scaffold ini tidak mengimplementasikan login, user CRUD, employee workflow, payroll calculation, reporting query, authorization policy, migration bisnis, atau event handler produksi. Endpoint status hanya membuktikan composition root, health, OpenAPI, dan boundary dasar. Keputusan auth, tenant isolation, dan domain model perlu dibuat sebelum fitur bisnis pertama dibangun.
