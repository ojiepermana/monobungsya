# 0001. Adopt a Bun monorepo with explicit Elysia service boundaries · rationale

Decision record for [index.md](index.md).

## Context

> ⚠️ Premise note: Memusatkan Dockerfile di `infra/docker` membuat deployment lebih mudah dicari, tetapi mengurangi sifat mandiri folder service saat service dipindahkan ke repository lain. Keputusan ini menerima tradeoff tersebut dan mempertahankan root build context, nama image per aplikasi, serta mapping satu file ke satu app supaya kehilangan kemandirian tetap terbatas pada file build.

Project dimulai dari workspace kosong dan perlu memberi developer baru struktur yang dapat dipahami. Sistem membutuhkan HTTP API, event bus internal, database transactional, generated frontend client, typed configuration, observability dasar, serta deployability per service.

Service auth dan user dipilih sebagai domain awal. Kontrak antar service harus mencegah import source internal, sedangkan shared package harus tetap bebas dari business domain agar pemisahan repository di masa depan tidak menjadi rewrite.

Kontrak container perlu mendukung satu build context root karena semua aplikasi memakai dependency workspace bersama. Image harus dapat dibangun untuk production dan diperiksa oleh CI tanpa memasukkan credential, database, NATS, SMTP, atau reverse proxy ke dalam image aplikasi. Web client juga harus dapat menunjuk ke gateway yang berbeda per environment, sedangkan server backend mempertahankan port dan endpoint health yang sudah dipakai oleh aplikasi.

## Options considered

### Option 1: One large application

Semua domain berada dalam satu aplikasi deployable dengan module internal.

**Pros**:

- Paling sederhana untuk operasi awal.
- Transaction dan local call mudah ditelusuri.

**Cons**:

- Boundary ownership dan deployability per service harus dibangun ulang ketika kebutuhan berubah.
- Kontrak service mudah menjadi implisit jika semua module dapat saling import.

### Option 2: Explicit service applications in one monorepo

Setiap domain memiliki Bun application sendiri, tetapi package infrastructure dan contract tetap berada di workspace yang sama.

**Pros**:

- Boundary, deployment, test, dan ownership terlihat sejak awal.
- Service dapat dipindahkan ke repository sendiri dengan perubahan kecil.
- Shared code tetap terbatas pada infrastructure dan contract yang benar benar reusable.

**Cons**:

- Developer menjalankan beberapa process dan harus memahami failure mode distributed system.
- Database, messaging, logging, dan contract pipeline perlu aturan operasional sejak hari pertama.

### Option 3: Full platform framework for all services

Membuat custom framework atau layer abstraksi generik yang memaksa semua service memakai lifecycle dan repository yang sama.

**Pros**:

- Beberapa boilerplate awal dapat berkurang.
- Cross cutting concern terlihat seragam.

**Cons**:

- Abstraksi menjadi coupling baru dan menyembunyikan ownership domain.
- Perubahan framework internal akan berdampak ke semua service.
- Generic repository dan service berisiko menghapus perbedaan business operation yang penting.

### Container image ownership options

#### Keep Dockerfiles inside each app

Setiap app menyimpan Dockerfile di folder source masing masing, lalu build tetap dijalankan dengan root sebagai context.

**Pros**:

- Service tetap mudah dipindahkan sebagai unit mandiri.
- Path build dekat dengan source dan sesuai aturan foundation awal.

**Cons**:

- Aturan deployment tersebar di tujuh folder.
- Folder `infra/docker` tidak menjadi tempat yang berguna untuk operasi container.

#### Centralize canonical Dockerfiles in `infra/docker`

Satu Dockerfile per deployable app dikelola di folder deployment terpusat, sementara source app tetap berada di `apps`.

**Pros**:

- Semua image, port, health check, dan build context dapat dicari dari satu tempat.
- CI dapat membangun image dengan mapping path yang konsisten.
- Tidak ada dua Dockerfile yang dapat berbeda tanpa terdeteksi.

**Cons**:

- Service yang diekstrak ke repository lain harus membawa Dockerfile yang sesuai secara eksplisit.
- Perubahan pada source app dan file deployment berada di folder berbeda.

#### Keep both paths as independent Dockerfiles

Dockerfile di `apps` dan `infra/docker` dipelihara sebagai dua definisi yang dapat dibangun.

**Pros**:

- Path lama dan path baru tetap tersedia.
- Tim dapat mencoba pola deployment baru tanpa langsung menghapus pola lama.

**Cons**:

- Isi file dapat tidak sinkron dan menghasilkan image berbeda dari source yang sama.
- CI perlu pemeriksaan tambahan untuk mencegah drift.

## Rationale

Option 2 mempertahankan struktur monorepo yang diminta tanpa menghapus batas domain. Service lokal tetap eksplisit dan dapat diuji atau dibuat image secara independen, sedangkan package shared tetap kecil sehingga pemisahan repository tidak membawa business coupling.

Centralisasi Dockerfile dipilih karena kebutuhan utama saat ini adalah menemukan dan memeriksa seluruh image deployment dari satu lokasi. Keputusan ini tidak membuat Dockerfile generik karena setiap app memiliki port, konfigurasi, health check, dan runtime yang berbeda. Tradeoff terhadap ekstraksi service diterima, dengan syarat path build, mapping image, dan langkah pemindahan Dockerfile dicatat dalam dokumentasi.

Premise pentingnya adalah bahwa scaffold ini belum membuktikan kebutuhan scale untuk microservices penuh. Biaya distributed system diterima hanya pada boundary yang sudah diminta, bukan dengan menambah orchestration, service mesh, generic framework, atau abstraction yang belum memiliki kebutuhan nyata.

## References

**Project sources**:

- Repository structure, dependency flow, and service boundary decisions are defined in this spec.
- `apps/web/AGENTS.md`, Angular 22 standalone, signals, accessibility, dan CLI conventions.
- `/Users/ojiepermana/.agents/skills/angular-developer/`, Angular implementation guidance.
- `/Users/ojiepermana/.agents/skills/angular-new-app/`, Angular CLI creation workflow.
- `/Users/ojiepermana/.agents/skills/elysiajs/`, Elysia feature based structure dan Bun first runtime.

**Practices & standards**:

- Layered dependency flow, route to service to repository to database.
- API first contract generation from schema.
- Domain ownership and bounded context separation.
- Structured logging and request correlation.
- Avoid premature generic abstractions.
