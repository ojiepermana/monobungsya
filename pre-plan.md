# Task: Scaffold Enterprise Monorepo — Bun + Elysia + Angular

Buat scaffold project monorepo untuk aplikasi enterprise yang menggunakan:

- Bun sebagai runtime dan package manager
- TypeScript
- ElysiaJS sebagai HTTP framework
- Angular sebagai frontend
- NATS sebagai internal messaging/event bus
- PostgreSQL sebagai transactional database
- OpenAPI sebagai HTTP API contract
- Bun Test sebagai testing framework

Tujuan utama:

1. Saat ini seluruh project menggunakan satu monorepo.
2. Struktur harus modular dan mudah dipahami developer baru.
3. Setiap service harus mempunyai boundary yang jelas.
4. Business logic harus terpisah dari HTTP layer.
5. API harus API-first dan menghasilkan OpenAPI specification.
6. Angular menggunakan generated SDK berdasarkan OpenAPI.
7. Service-to-service communication menggunakan messaging abstraction/NATS.
8. Shared code hanya ditempatkan di packages jika memang benar-benar reusable.
9. Setiap service harus dapat dikembangkan dan di-deploy secara independen.
10. Jika project semakin besar, setiap service harus dapat dipisahkan menjadi repository terpisah dengan perubahan minimal.
11. Jangan membuat custom framework.
12. Jangan membuat abstraction yang belum dibutuhkan.

============================================================
1. TARGET MONOREPO STRUCTURE
============================================================

Buat struktur awal:

project/
│
├── apps/
│   ├── web/
│   │   └── Angular application
│   │
│   ├── api-gateway/
│   │   └── Bun + Elysia API Gateway
│   │
│   └── services/
│       ├── auth/
│       ├── user/
│       ├── employee/
│       ├── payroll/
│       └── reporting/
│
├── packages/
│   ├── contracts/
│   │   ├── openapi/
│   │   │   ├── fragments/
│   │   │   └── generated/
│   │   │
│   │   └── events/
│   │
│   ├── database/
│   ├── messaging/
│   ├── config/
│   ├── logger/
│   └── errors/
│
├── package.json
├── bun.lock
├── tsconfig.json
└── README.md

Jangan membuat repository terpisah untuk setiap service sekarang.

Gunakan Bun workspace.

============================================================
2. BUN WORKSPACE
============================================================

Root package.json harus menggunakan Bun workspaces.

Workspace:

- apps/*
- apps/services/*
- packages/*

Gunakan package naming:

@project/web
@project/api-gateway
@project/auth
@project/user
@project/employee
@project/payroll
@project/reporting

Shared packages:

@project/contracts
@project/database
@project/messaging
@project/config
@project/logger
@project/errors

Gunakan placeholder nama project yang mudah diganti.

Jangan menggunakan npm/pnpm/yarn sebagai package manager.

============================================================
3. SERVICE STRUCTURE
============================================================

Setiap service Bun harus mempunyai struktur dasar:

apps/services/<service>/
│
├── src/
│   ├── main.ts
│   ├── app.ts
│   │
│   ├── config/
│   │   ├── env.ts
│   │   └── database.ts
│   │
│   ├── shared/
│   │   ├── errors/
│   │   │   ├── app-error.ts
│   │   │   └── error-handler.ts
│   │   │
│   │   ├── utils/
│   │   ├── types/
│   │   └── plugins/
│   │       ├── logger.plugin.ts
│   │       ├── openapi.plugin.ts
│   │       └── request-id.plugin.ts
│   │
│   ├── modules/
│   │
│   ├── database/
│   │   ├── client.ts
│   │   ├── migrations/
│   │   └── seeds/
│   │
│   ├── jobs/
│   │   ├── workers/
│   │   └── schedules/
│   │
│   └── tests/
│
├── openapi.yaml
├── package.json
└── tsconfig.json

API Gateway menggunakan struktur yang sama, tetapi tidak membutuhkan
repository/database domain seperti business services kecuali memang diperlukan.

============================================================
4. MODULE ARCHITECTURE
============================================================

Business feature harus berada di:

src/modules/

Contoh:

src/modules/users/

    users.route.ts
    users.schema.ts
    users.service.ts

    repository/
        users.repository.ts
        queries/
        filters/
        mappers/
        types/

Untuk module sederhana, jangan membuat semua subfolder jika belum diperlukan.

Contoh module sederhana cukup:

users/
    users.route.ts
    users.schema.ts
    users.service.ts
    users.repository.ts

Ketika module menjadi kompleks, struktur dapat diperluas.

============================================================
5. DEPENDENCY FLOW
============================================================

Terapkan dependency flow:

HTTP Request
    ↓
Route
    ↓
Schema Validation
    ↓
Service
    ↓
Repository
    ↓
Database

Response:

Database
    ↓
Repository
    ↓
Service
    ↓
Route
    ↓
HTTP Response

Rules:

Route:
- boleh memanggil Service
- tidak boleh memanggil Repository
- tidak boleh mengakses Database
- tidak boleh berisi business logic

Schema:
- hanya validation dan API schema
- tidak boleh memanggil Service
- tidak boleh memanggil Repository

Service:
- seluruh business logic
- workflow
- business validation
- transaction boundary
- external API integration
- messaging integration

Repository:
- hanya data access
- SQL
- database operation
- query
- filtering
- sorting
- pagination
- transaction helper jika diperlukan

Repository tidak boleh mengetahui HTTP.

============================================================
6. NO GENERIC REPOSITORY
============================================================

Jangan membuat:

BaseRepository
GenericRepository
CrudRepository
GenericService
GenericQueryBuilder

Jangan membuat abstraction hanya untuk menghilangkan sedikit duplikasi.

Repository harus domain-specific.

============================================================
7. DATABASE
============================================================

Buat:

packages/database/

untuk infrastructure database yang benar-benar reusable.

Contoh:

- database connection abstraction
- transaction helper
- common database utilities

Tetapi business repository tetap berada di service:

apps/services/user/src/modules/users/repository/

Jangan menaruh:

UserRepository
EmployeeRepository
PayrollRepository

di packages/database.

Database package tidak boleh mengetahui business domain.

Migration dan seed tetap menjadi tanggung jawab masing-masing service jika
service memiliki database/schema sendiri.

============================================================
8. TRANSACTION
============================================================

Transaction boundary harus mengikuti business operation.

Contoh:

Service
    ↓
BEGIN
    ↓
Repository A
    ↓
Repository B
    ↓
COMMIT

Jangan membuat transaction tersembunyi di setiap repository method jika
transaction boundary sebenarnya berada pada Service.

============================================================
9. ERROR HANDLING
============================================================

Buat shared error abstraction.

Minimal:

AppError
ValidationError
NotFoundError
UnauthorizedError
ForbiddenError
ConflictError
InternalServerError

Gunakan global Elysia error handler.

Jangan mengembalikan database error mentah ke client.

HTTP error response harus konsisten.

============================================================
10. CONFIGURATION
============================================================

Environment configuration harus typed dan tervalidasi.

Buat:

config/env.ts

Minimal configuration:

NODE_ENV
PORT
DATABASE_URL
NATS_URL
LOG_LEVEL

Jangan membaca process.env secara acak di seluruh aplikasi.

Gunakan centralized configuration.

============================================================
11. ELYSIA
============================================================

Gunakan ElysiaJS.

Buat:

src/app.ts

sebagai tempat composition root.

Urutan:

Configuration
    ↓
Plugins
    ↓
Middleware
    ↓
OpenAPI
    ↓
Routes
    ↓
Error Handler

main.ts hanya bertugas:

- load configuration
- create app
- start HTTP server
- graceful shutdown

main.ts tidak boleh memiliki:

- SQL
- business logic
- routes
- validation logic

============================================================
12. OPENAPI
============================================================

OpenAPI harus menjadi HTTP contract.

Gunakan schema Elysia sebagai source of truth jika memungkinkan.

Jangan mendefinisikan DTO dan OpenAPI schema secara terpisah jika dapat
dihindari.

Setiap service harus dapat menghasilkan:

openapi.yaml

Contoh:

apps/services/user/openapi.yaml
apps/services/employee/openapi.yaml
apps/services/payroll/openapi.yaml

API Gateway mempunyai public OpenAPI specification.

Public OpenAPI harus merepresentasikan API yang benar-benar dapat digunakan
oleh external client.

Internal service API tidak otomatis menjadi public API.

============================================================
13. OPENAPI CONTRACT PIPELINE
============================================================

Buat mekanisme:

Service
    ↓
OpenAPI specification
    ↓
OpenAPI fragment / generated specification
    ↓
API Gateway public OpenAPI
    ↓
Angular SDK

Sediakan script:

bun run openapi:generate

yang dapat menghasilkan OpenAPI specification.

Jika memungkinkan, sediakan:

bun run openapi:validate

untuk validasi specification.

Jangan membuat proses generation yang terlalu kompleks pada tahap scaffold.

============================================================
14. ANGULAR SDK
============================================================

Angular harus menggunakan generated SDK berdasarkan API Gateway OpenAPI.

Buat:

packages/contracts/openapi/generated/

untuk generated OpenAPI artifacts.

Boleh membuat:

packages/angular-sdk/

jika generator menghasilkan Angular-specific client code.

Generated code harus dipisahkan dari source code manual.

Jangan menulis API client manual di Angular jika endpoint tersebut sudah
tersedia melalui generated SDK.

Angular:

apps/web
    ↓
@project/angular-sdk
    ↓
API Gateway

Jangan:

Angular
    ↓
langsung ke user-service
Angular
    ↓
langsung ke payroll-service

External API access hanya melalui API Gateway.

============================================================
15. NATS / MESSAGING
============================================================

Buat:

packages/messaging/

sebagai abstraction untuk NATS.

Minimal konsep:

Publisher
Subscriber
Request/Response

Service tidak boleh mengetahui detail implementasi connection NATS di seluruh
business logic.

Contoh:

Service
    ↓
Messaging abstraction
    ↓
NATS

============================================================
16. EVENT CONTRACT
============================================================

Buat:

packages/contracts/events/

untuk event contract.

Contoh:

events/
├── user/
│   ├── user-created.ts
│   ├── user-updated.ts
│   └── user-deleted.ts
│
├── employee/
└── payroll/

Event contract harus dipisahkan dari event handler implementation.

Contract:

packages/contracts/events/

Implementation:

apps/services/<service>/src/modules/<module>/events/

============================================================
17. SERVICE BOUNDARY
============================================================

Service tidak boleh mengakses source code internal service lain.

Dilarang:

import UserRepository from "../../user/..."
import PayrollService from "../../payroll/..."

Service-to-service communication harus melalui:

1. NATS
2. Internal HTTP API jika memang diperlukan

Prefer NATS untuk asynchronous event-driven communication.

============================================================
18. API GATEWAY
============================================================

API Gateway adalah satu-satunya external entry point.

External clients:

Angular
Mobile
Third-party API clients

harus mengakses:

API Gateway

Bukan langsung:

auth-service
user-service
employee-service
payroll-service
reporting-service

API Gateway bertanggung jawab terhadap:

- routing
- authentication
- authorization
- rate limiting
- CORS
- request ID
- security headers
- API versioning
- public OpenAPI
- request/response boundary

Jangan menaruh business logic domain di API Gateway.

============================================================
19. API VERSIONING
============================================================

Gunakan versioning:

/api/v1/...

Contoh:

/api/v1/users
/api/v1/employees
/api/v1/payroll

Versioning harus berada pada public API boundary.

============================================================
20. JOBS
============================================================

Buat:

jobs/
├── workers/
└── schedules/

Worker digunakan untuk:

- background processing
- cleanup
- import
- export
- synchronization
- notification

Route tidak boleh memanggil worker implementation secara langsung.

Gunakan abstraction/service jika service perlu menjadwalkan pekerjaan.

============================================================
21. TESTING
============================================================

Gunakan Bun Test.

Tests mengikuti module.

Contoh:

tests/
├── users.test.ts
├── auth.test.ts
└── employees.test.ts

Test harus dapat berkembang untuk mencakup:

- service
- repository
- API
- integration
- messaging

Tidak perlu membuat semua test pada scaffold.

Buat minimal smoke test untuk setiap service.

============================================================
22. SHARED PACKAGES
============================================================

packages/ hanya boleh berisi sesuatu yang benar-benar reusable.

contracts/
    HTTP/OpenAPI contract
    Event contract

database/
    database infrastructure

messaging/
    NATS infrastructure

config/
    shared configuration utilities

logger/
    logging infrastructure

errors/
    common error types

Jangan menaruh business logic domain ke packages.

Jangan membuat:

packages/users
packages/payroll
packages/employees

Business domain harus tetap berada di service masing-masing.

============================================================
23. SHARED VS LOCAL
============================================================

Setiap service boleh mempunyai:

src/shared/

untuk helper yang hanya relevan terhadap service tersebut.

Jika sesuatu benar-benar reusable lintas service, baru dipindahkan ke:

packages/

Jangan memindahkan kode ke packages hanya karena terlihat reusable.

============================================================
24. NAMING CONVENTION
============================================================

Gunakan lowercase kebab-case untuk filename.

Benar:

users.route.ts
users.schema.ts
users.service.ts
users.repository.ts
user-created.ts

Salah:

UsersService.ts
UserRepository.ts
myFile.ts

============================================================
25. SECURITY
============================================================

Semua SQL harus menggunakan parameter binding.

Dilarang:

string concatenation SQL dari user input.

Filtering:
- whitelist field
- whitelist sorting
- parameterized query

Jangan membuat generic dynamic query framework.

CORS hanya di API Gateway untuk public API.

Service internal tidak perlu menjadi public internet endpoint.

============================================================
26. GRACEFUL SHUTDOWN
============================================================

Setiap service harus menangani graceful shutdown.

Shutdown harus menangani minimal:

HTTP server
Database connection
NATS connection
Background workers

Jangan meninggalkan connection aktif ketika process dihentikan.

============================================================
27. OBSERVABILITY
============================================================

Logger harus mempunyai:

- timestamp
- level
- service name
- request ID
- correlation ID jika tersedia

Request ID harus dapat diteruskan antar-service.

Jangan membuat distributed tracing implementation yang kompleks pada scaffold.
Siapkan extension point saja.

============================================================
28. DOCKER
============================================================

Setiap deployable application harus dapat dibuat menjadi Docker image secara
independen.

Minimal:

apps/api-gateway/Dockerfile
apps/services/auth/Dockerfile
apps/services/user/Dockerfile
apps/services/employee/Dockerfile
apps/services/payroll/Dockerfile
apps/services/reporting/Dockerfile
apps/web/Dockerfile

Jangan membuat satu Docker image untuk seluruh monorepo.

Tujuan akhirnya:

docker build user-service
docker build payroll-service

dapat dilakukan secara independen.

============================================================
29. FUTURE REPOSITORY SPLIT
============================================================

Struktur harus memungkinkan:

apps/services/user

suatu hari dipindahkan menjadi:

user-service repository

dengan dependency:

@project/contracts
@project/database
@project/messaging
@project/logger

tanpa harus mengubah business architecture.

Jangan membuat source code antar-service saling bergantung.

============================================================
30. DEVELOPMENT EXPERIENCE
============================================================

Root harus mempunyai script yang mudah digunakan.

Minimal:

bun run dev
bun run test
bun run lint
bun run typecheck
bun run build

Sediakan juga:

bun run dev:web
bun run dev:gateway
bun run dev:auth
bun run dev:user
bun run dev:employee
bun run dev:payroll
bun run dev:reporting

Sediakan:

bun run openapi:generate
bun run openapi:validate

Jika memungkinkan gunakan script orchestration sederhana dan jangan
menambahkan tool orchestration berat hanya untuk development.

============================================================
31. INITIAL SERVICES
============================================================

Buat service berikut sebagai scaffold:

auth
user
employee
payroll
reporting

Tetapi jangan membuat business implementation lengkap.

Setiap service cukup mempunyai:

- health endpoint
- basic module example
- configuration
- logger
- OpenAPI
- database abstraction
- NATS abstraction
- error handler
- test
- graceful shutdown

Contoh health:

GET /health

Response:

{
  "status": "ok",
  "service": "<service-name>"
}

============================================================
32. API GATEWAY ROUTING
============================================================

API Gateway harus mempunyai route boundary:

/api/v1/auth/*
/api/v1/users/*
/api/v1/employees/*
/api/v1/payroll/*
/api/v1/reports/*

Tetapi jangan mengimplementasikan business logic di gateway.

Gateway hanya meneruskan request ke service yang sesuai.

============================================================
33. ARCHITECTURE DOCUMENTATION
============================================================

Buat README.md yang menjelaskan:

1. Monorepo architecture
2. apps vs packages
3. Service boundary
4. Dependency flow
5. API Gateway
6. OpenAPI workflow
7. Angular SDK workflow
8. NATS/event workflow
9. Database boundary
10. Testing
11. Docker
12. Cara menjalankan development
13. Cara menambahkan service baru
14. Cara menambahkan module baru
15. Aturan dependency antar service
16. Cara memisahkan service menjadi repository sendiri di masa depan

Tambahkan diagram architecture menggunakan Mermaid.

============================================================
34. IMPORTANT ARCHITECTURE RULES
============================================================

Jangan:

- membuat custom framework
- membuat generic repository
- membuat generic service
- menaruh business logic di route
- menaruh business logic di repository
- menaruh business logic di shared packages
- membuat service saling import source code
- expose database ke external client
- expose NATS ke internet
- expose internal service langsung ke internet
- membuat Angular mengakses service secara langsung
- membuat OpenAPI manual jika dapat dihasilkan dari schema
- membuat generated SDK bercampur dengan source Angular
- membuat abstraction sebelum benar-benar diperlukan

Prioritaskan:

- simple
- explicit
- domain-oriented
- type-safe
- testable
- API-first
- event-driven
- independently deployable
- easy to split later

============================================================
35. DELIVERABLE
============================================================

Implementasikan scaffold project tersebut.

Jangan hanya memberikan contoh struktur.

Buat actual files dan configuration yang diperlukan.

Setelah selesai:

1. install dependencies
2. jalankan typecheck
3. jalankan test
4. jalankan lint jika tersedia
5. generate OpenAPI
6. validate OpenAPI
7. build setiap application
8. pastikan tidak ada dependency cycle antar package/service

Jika ada dependency atau library yang tidak diperlukan, jangan menambahkannya.

Gunakan dependency seminimal mungkin.

============================================================
36. FINAL CHECK
============================================================

Sebelum selesai, periksa:

[ ] Bun workspace berjalan
[ ] Angular application berjalan
[ ] API Gateway berjalan
[ ] Semua service dapat dijalankan secara independen
[ ] Semua service memiliki /health
[ ] OpenAPI dapat dihasilkan
[ ] OpenAPI valid
[ ] Angular SDK pipeline tersedia
[ ] NATS abstraction tersedia
[ ] Database abstraction tersedia
[ ] Error handling tersedia
[ ] Logger tersedia
[ ] Graceful shutdown tersedia
[ ] Bun Test berjalan
[ ] Tidak ada cross-service source import
[ ] Tidak ada generic repository
[ ] Tidak ada business logic di route
[ ] Tidak ada business logic di repository
[ ] Dockerfile setiap deployable application tersedia
[ ] README menjelaskan architecture
[ ] Struktur siap dipisahkan menjadi repository terpisah di masa depan

Jangan menambahkan fitur bisnis yang belum diminta.
Fokus pada scaffold, architecture boundary, developer experience, dan
future scalability.