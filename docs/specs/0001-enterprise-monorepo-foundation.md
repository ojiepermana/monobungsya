# 0001. Adopt a Bun monorepo with explicit Elysia service boundaries

**Date**: 2026-08-20
**Status**: Accepted

## Summary

Project ini memakai satu Bun workspace untuk web client, API Gateway, dan service domain. Angular menggunakan client yang dihasilkan dari public OpenAPI Gateway, sementara service memakai Bun SQL native untuk PostgreSQL dan NATS melalui package infrastructure yang kecil. Root `package.json` menjadi sumber dependency dan Bun memakai satu physical `node_modules`. Setiap service tetap memiliki boundary source, test, dan konfigurasi sendiri, sedangkan Dockerfile canonical untuk semua deployable app dikelola di `infra/docker`.

## Context

> ⚠️ Premise note: Memusatkan Dockerfile di `infra/docker` membuat deployment lebih mudah dicari, tetapi mengurangi sifat mandiri folder service saat service dipindahkan ke repository lain. Keputusan ini menerima tradeoff tersebut dan mempertahankan root build context, nama image per aplikasi, serta mapping satu file ke satu app supaya kehilangan kemandirian tetap terbatas pada file build.

Project dimulai dari workspace kosong dan perlu memberi developer baru struktur yang dapat dipahami. Sistem membutuhkan HTTP API, event bus internal, database transactional, generated frontend client, typed configuration, observability dasar, serta deployability per service.

Beberapa service domain sudah dipilih sejak awal, yaitu auth, user, employee, payroll, dan reporting. Kontrak antar service harus mencegah import source internal, sedangkan shared package harus tetap bebas dari business domain agar pemisahan repository di masa depan tidak menjadi rewrite.

Kontrak container perlu mendukung satu build context root karena semua aplikasi memakai dependency workspace bersama. Image harus dapat dibangun untuk production dan diperiksa oleh CI tanpa memasukkan credential, database, NATS, SMTP, atau reverse proxy ke dalam image aplikasi. Web client juga harus dapat menunjuk ke gateway yang berbeda per environment, sedangkan server backend mempertahankan port dan endpoint health yang sudah dipakai oleh aplikasi.

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

### Container image ownership options

#### Keep Dockerfiles inside each app

Setiap app menyimpan Dockerfile di folder source masing masing, lalu build tetap dijalankan dengan root sebagai context.

**Pros**:

* Service tetap mudah dipindahkan sebagai unit mandiri.
* Path build dekat dengan source dan sesuai aturan foundation awal.

**Cons**:

* Aturan deployment tersebar di tujuh folder.
* Folder `infra/docker` tidak menjadi tempat yang berguna untuk operasi container.

#### Centralize canonical Dockerfiles in `infra/docker`

Satu Dockerfile per deployable app dikelola di folder deployment terpusat, sementara source app tetap berada di `apps`.

**Pros**:

* Semua image, port, health check, dan build context dapat dicari dari satu tempat.
* CI dapat membangun image dengan mapping path yang konsisten.
* Tidak ada dua Dockerfile yang dapat berbeda tanpa terdeteksi.

**Cons**:

* Service yang diekstrak ke repository lain harus membawa Dockerfile yang sesuai secara eksplisit.
* Perubahan pada source app dan file deployment berada di folder berbeda.

#### Keep both paths as independent Dockerfiles

Dockerfile di `apps` dan `infra/docker` dipelihara sebagai dua definisi yang dapat dibangun.

**Pros**:

* Path lama dan path baru tetap tersedia.
* Tim dapat mencoba pola deployment baru tanpa langsung menghapus pola lama.

**Cons**:

* Isi file dapat tidak sinkron dan menghasilkan image berbeda dari source yang sama.
* CI perlu pemeriksaan tambahan untuk mencegah drift.

## Decision

**Chosen option**: Option 2: Explicit service applications in one monorepo

Gunakan root Bun project dengan Angular app, Elysia API Gateway, lima Bun service domain, dan shared package infrastructure yang minimal. Hanya `packages/*` menjadi workspace package bernama, sedangkan semua app dijalankan langsung dari source path oleh root scripts. Elysia TypeBox schema menjadi source of truth untuk OpenAPI. Gateway adalah satu satunya public entry point pada `/api/v1/*`; komunikasi domain memakai NATS abstraction atau internal HTTP saat memang diperlukan.

**Container image option**: Centralize canonical Dockerfiles in `infra/docker`.

Setiap deployable app memiliki satu Dockerfile di folder deployment terpusat. Build tetap memakai root workspace sebagai context, sedangkan source aplikasi tetap berada di folder `apps`.

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
* Setiap deployable app memiliki satu Dockerfile canonical di `infra/docker` dan dibangun dengan root workspace sebagai context.

### Container image contract

* Image memiliki satu Dockerfile untuk setiap target berikut: `web`, `gateway`, `services/auth`, `services/user`, `services/employee`, `services/payroll`, dan `services/reporting`.
* Build dijalankan dari root dengan bentuk `docker build -f infra/docker/<target>/Dockerfile .` dan memakai `bun.lock` melalui `bun install --frozen-lockfile`.
* Base image backend memakai `oven/bun:1.3.14`. Backend memakai tahap dependency production dan menjalankan source dengan Bun. Image final tidak membawa dependency development.
* Image web membangun Angular dalam tahap Bun lalu menyajikan asset dengan image Nginx unprivileged. Nginx mendengar pada port 8080 sehingga proses runtime tetap non root. Deployment dapat memetakan port publik 80 ke port container 8080.
* Angular menerima `WEB_API_URL` sebagai nilai konfigurasi build. Artifact production tidak boleh memakai URL gateway localhost sebagai nilai tetap.
* Port backend tetap mengikuti kontrak aplikasi: gateway 3000, auth 3101, user 3102, employee 3103, payroll 3104, dan reporting 3105. Port publik ditentukan oleh deployment.
* Backend memiliki health check HTTP ke `/health`. Web memiliki health check HTTP ke `/` dan mengharapkan status 200. Health hanya membuktikan proses HTTP hidup, bukan kesehatan PostgreSQL, NATS, atau SMTP.
* Runtime menerima environment dari deployment. Secret seperti `DATABASE_URL`, `NATS_URL`, credential SMTP, dan `INTERNAL_AUTH_SIGNING_SECRET` tidak ditulis ke Dockerfile, build argument, atau image layer.
* Runtime berjalan sebagai user non root dengan hak Linux minimum. Log tetap dikirim ke stdout atau stderr. Container menjalankan satu proses utama dan meneruskan SIGTERM untuk graceful shutdown.
* Image ditargetkan untuk `linux/amd64` dan `linux/arm64`. CI memberi nama image per aplikasi dan tag commit serta release yang dapat dilacak.
* PostgreSQL, NATS, SMTP, reverse proxy, dan database migration tetap berada di luar image aplikasi. Migration dijalankan sebagai job atau command CI terpisah.
* Dockerfile lama di bawah `apps` dihapus setelah path baru dipakai oleh README dan CI. Folder `infra/docker/fullstacks` tetap tersedia untuk keputusan orchestration berikutnya, tetapi tidak menjadi image aplikasi dalam keputusan ini.

## Rationale

Option 2 mempertahankan struktur monorepo yang diminta tanpa menghapus batas domain. Service lokal tetap eksplisit dan dapat diuji atau dibuat image secara independen, sedangkan package shared tetap kecil sehingga pemisahan repository tidak membawa business coupling.

Centralisasi Dockerfile dipilih karena kebutuhan utama saat ini adalah menemukan dan memeriksa seluruh image deployment dari satu lokasi. Keputusan ini tidak membuat Dockerfile generik karena setiap app memiliki port, konfigurasi, health check, dan runtime yang berbeda. Tradeoff terhadap ekstraksi service diterima, dengan syarat path build, mapping image, dan langkah pemindahan Dockerfile dicatat dalam dokumentasi.

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
| Deployment | Satu Dockerfile canonical per deployable app di `infra/docker` | Image dan lifecycle dapat dirilis per application, dengan kontrak build yang terpusat. |

## Consequences

**Positive**:

* Dependency flow dapat dipahami dari folder dan import.
* Public API contract dan generated SDK mempunyai pipeline yang dapat diulang.
* Service dapat dikembangkan dan diuji secara independen.
* PostgreSQL transaction helper dan NATS lifecycle tidak diduplikasi di setiap service.
* Semua target image, port, health check, dan aturan build dapat ditemukan dari satu folder deployment.

**Negative / tradeoffs**:

* Lima service berarti lebih banyak process, environment, log, dan failure mode saat development.
* Gateway forwarding memerlukan service URL configuration dan contract testing yang lebih kuat ketika endpoint bisnis ditambahkan.
* Generated SDK harus selalu dihasilkan ulang setelah public schema berubah.
* Auth, authorization, tenant isolation, migrations bisnis, dan retry policy belum diselesaikan oleh scaffold.
* Pemindahan Dockerfile dari folder app mengurangi kemampuan ekstraksi service secara langsung dan memerlukan langkah pemindahan tambahan.
* Web image memakai port internal 8080, sehingga deployment perlu memetakan port publik 80 secara eksplisit.

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
* [ ] Tambahkan CI build matrix untuk tujuh image, target `linux/amd64` dan `linux/arm64`, health check, serta tag commit dan release.
* [ ] Perbarui README dan workflow build agar memakai path `infra/docker`, lalu hapus Dockerfile lama di bawah `apps` dalam satu perubahan terkoordinasi.
* [ ] Saat service dipindahkan ke repository sendiri, pindahkan Dockerfile yang sesuai bersama source app dan sesuaikan root build context.

## Migration plan

**Strategy**: Direct replacement

**Phases**:

1. Tambahkan tujuh Dockerfile baru di `infra/docker` dan pastikan setiap image dapat dibangun dari root memakai lockfile.
2. Tambahkan pemeriksaan CI untuk build image, target platform, health check, dan secret scan.
3. Perbarui README dan workflow yang masih menunjuk ke Dockerfile di `apps`, lalu hapus tujuh Dockerfile lama setelah path baru lulus pemeriksaan.

**Rollback**: Kembalikan perubahan dokumentasi dan CI, lalu pulihkan Dockerfile lama di folder `apps` dari commit sebelumnya. Image yang sudah dipublikasikan tetap dapat dipakai berdasarkan tag commit.

**Risks**: Path build yang salah dapat membuat package workspace tidak tersalin, konfigurasi URL Angular dapat tetap menunjuk ke localhost, atau image web non root dapat gagal jika deployment belum memetakan port 80 ke 8080.

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
