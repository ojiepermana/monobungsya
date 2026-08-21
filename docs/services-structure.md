# Backend Project Structure Guideline

## Bun + ElysiaJS

Dokumen ini menggunakan `apps/services/user` sebagai reference implementation.
Aturan yang sama berlaku untuk service lain di bawah `apps/services/<service>`;
nama module, dependency, dan route mengikuti bounded context masing-masing.

Tujuan struktur ini adalah:

- Mudah dipahami oleh developer baru.
- Mudah dipelihara dalam jangka panjang.
- Mudah dipecah menjadi microservice apabila suatu saat diperlukan.
- Seluruh business logic terpisah dari HTTP layer.
- Mendukung API First, OpenAPI, Testing, Background Job, dan Dependency Injection.
- Tidak bergantung pada ORM tertentu.

────────────────────────────────────────────────────────────

packages/
├── config/       # konfigurasi environment lintas aplikasi
├── contracts/    # HTTP, event, dan auth identity contracts
├── database/     # PostgreSQL client, transaction, migration, dan seed tooling
├── elysia/       # adapter Elysia lintas gateway dan service
├── errors/       # error model dan response mapping
├── logger/       # logger dan URL redaction
└── messaging/    # abstraksi NATS

Kode di `packages/` boleh digunakan oleh gateway, service, dan aplikasi lain.
Package tidak boleh mengimpor kode dari `apps/` atau berisi business logic
domain milik service tertentu.

apps/services/user/src/
│
├── main.ts
├── app.ts
│
├── config/
│   └── env.ts
│
├── shared/
│   ├── plugins/
│   │   └── auth-identity.plugin.ts
│   ├── types/
│   └── utils/
│
├── modules/
│   └── users/
│       ├── users.route.ts
│       ├── users.schema.ts
│       ├── users.service.ts
│       └── repository/
│           ├── users.repository.ts
│           ├── queries/
│           ├── filters/
│           ├── mappers/
│           └── types/
│
├── database/
│   ├── migrations/
│   └── seeds/
│
├── jobs/
│   ├── workers/
│   └── schedules/
│
└── tests/
    └── users.test.ts

────────────────────────────────────────────────────────────
main.ts
────────────────────────────────────────────────────────────

Entry point aplikasi.

Tanggung jawab:

- Load environment melalui `src/config/env.ts`.
- Membuat dependency infrastructure secara kondisional ketika
    `ENABLE_INFRASTRUCTURE=true`.
- Membuat app dari `src/app.ts` dan menjalankan HTTP server.
- Menutup server, messaging, dan database saat `SIGINT` atau `SIGTERM`.

JANGAN berisi:

- Route
- Business Logic
- SQL
- Validasi

────────────────────────────────────────────────────────────
app.ts
────────────────────────────────────────────────────────────

Tempat merakit aplikasi user service tanpa menjalankan server.

Berisi:

- `requestIdPlugin`, logger plugin, OpenAPI factory, dan error handler dari
    `#project/elysia`.
- Health route.
- Auth identity plugin lokal untuk route internal.
- `createUsersRoute` untuk module users.
- Error response mapping dari `#project/errors`.

Urutan aktual di `src/app.ts`:

Request ID

↓

Logger

↓

OpenAPI

↓

Health dan auth identity

↓

Users route dan error handler

────────────────────────────────────────────────────────────
config/
────────────────────────────────────────────────────────────

Berisi seluruh konfigurasi aplikasi.

env.ts

- membaca .env
- validasi environment
- export typed config

Database client bersama berada di `#project/database`, bukan di `config/` atau
module service. `main.ts` membuat client dengan `createDatabaseClient` hanya
ketika `ENABLE_INFRASTRUCTURE=true`. Configuration package menyediakan typed
environment config; wrapper lokal hanya boleh ditambahkan bila service memiliki
configuration khusus.

Folder ini TIDAK BOLEH memiliki business logic.

────────────────────────────────────────────────────────────
shared/ pada service
────────────────────────────────────────────────────────────

Folder `shared/` bersifat opsional dan hanya untuk helper yang reusable di
dalam satu service. Kode yang dipakai oleh lebih dari satu aplikasi harus
berada di `packages/`, bukan diduplikasi di setiap service.

Pada service user, `auth-identity.plugin.ts` tetap lokal karena membawa policy
akses service. Plugin request ID, logger, OpenAPI, dan error handler berada di
`packages/elysia`.

────────────────────────────────────────────────────────────
packages/errors/
────────────────────────────────────────────────────────────

Berisi error model yang netral terhadap domain service.

Contoh:

ValidationError

NotFoundError

UnauthorizedError

ForbiddenError

ConflictError

InternalServerError

`toErrorResponse` memetakan error menjadi response API yang konsisten. Adapter
Elysia `createErrorHandler` berada di `packages/elysia` dan seluruh aplikasi
menggunakannya.

────────────────────────────────────────────────────────────
shared/utils/ dan packages/
────────────────────────────────────────────────────────────

Utility yang hanya dipakai satu service tetap berada di `shared/utils/`.
Utility yang benar-benar dipakai lintas aplikasi dipindahkan ke package dengan
ownership yang jelas; jangan membuat package `shared` generik.

Contoh:

Date

UUID

Slug

Hash

Crypto

Random

Formatter

Parser

Jangan memindahkan util ke package hanya karena kemungkinan akan dipakai nanti.

────────────────────────────────────────────────────────────
shared/types/ dan packages/contracts/
────────────────────────────────────────────────────────────

Tipe lokal service berada di `shared/types/`. Tipe yang menjadi kontrak lintas
service berada di `packages/contracts`.

Contoh:

Pagination

ApiResponse

JWTPayload

RequestContext

────────────────────────────────────────────────────────────
packages/elysia/
────────────────────────────────────────────────────────────

Adapter Elysia yang reusable lintas gateway dan service.

API bersama:

- `requestIdPlugin`
- `createLoggerPlugin(logger, name?)`
- `createOpenApiPlugin(documentation)`
- `createErrorHandler(name?)`

Metadata OpenAPI tetap diberikan oleh masing-masing aplikasi. Policy
authentication dan authorization yang domain-specific tidak boleh masuk ke
package ini.

────────────────────────────────────────────────────────────
modules/
────────────────────────────────────────────────────────────

Semua fitur aplikasi berada di folder ini.

Setiap folder merupakan satu bounded context kecil.

Contoh:

auth

users

customers

inventory

sales

invoice

payment

employee

dan seterusnya.

Masing-masing module memiliki dependency sendiri.

Jangan saling mengakses Repository module lain.

Komunikasi antar module dilakukan melalui Service.

────────────────────────────────────────────────────────────
module structure
────────────────────────────────────────────────────────────

Module dengan data access menggunakan facade repository domain-specific:

```text
modules/<module>/
├── <module>.route.ts
├── <module>.schema.ts
├── <module>.service.ts
└── repository/
    ├── <module>.repository.ts
    ├── queries/
    ├── filters/
    ├── mappers/
    └── types/
```

Reference module yang ada di repo ini:

```text
apps/services/user/src/modules/users/
├── users.route.ts
├── users.schema.ts
├── users.service.ts
└── repository/
    ├── users.repository.ts       # facade domain-specific
    ├── queries/                  # query SQL per use-case
    ├── filters/                  # filter dan sort typed
    ├── mappers/                  # mapping DB row ke model aplikasi
    └── types/
        └── repository.types.ts
```

Pada repo ini, module yang memiliki repository wajib memakai boundary tersebut.
Folder `queries`, `filters`, dan `mappers` boleh belum berisi implementasi saat
module masih sederhana, tetapi query, filter, mapper, dan tipe repository baru
harus ditambahkan di folder masing-masing ketika kebutuhan domain muncul.
Module tanpa data access, seperti health route yang dirakit langsung di
`app.ts`, boleh tidak memiliki repository.

### Baseline project dan reference implementation

Hasil inspection repository saat ini:

- Database utama adalah PostgreSQL dan akses database dibungkus oleh
    `#project/database`.
- Service user membuat client melalui `createDatabaseClient` dari
    `#project/database` di composition root. Service tidak membuat koneksi
    database sendiri di module.
- ORM/query builder tidak digunakan; bila query dibutuhkan, gunakan tagged
    template Bun dan parameter binding.
- Module yang tersedia pada service user adalah `users` dengan endpoint
    `/internal/users/status`.
- `UsersRepository` saat ini hanya menyediakan `getModuleStatus()` dan belum
    memiliki operasi persistence.
- `UsersService` membuat dan memanggil `UsersRepository`; route tidak
    mengetahui repository.
- Test service berada di `src/tests/users.test.ts` dan menggunakan
    `app.handle(new Request(...))`.
- Migrations, seeds, jobs, service-local types, dan service-local utils pada
    service user
    saat ini masih berupa boundary/documentation placeholder. Migrations dan
    seeds canonical berada di `packages/database`.
- Soft delete, filter, pagination, sorting, mapper, dan transaction belum
    menjadi behavior module users. Jangan menambahkannya hanya untuk memenuhi
    struktur folder.

BEFORE pada service user:

```text
modules/users/users.repository.ts
```

AFTER yang wajib dipakai repo ini:

```text
modules/users/repository/
├── users.repository.ts
├── queries/
├── filters/
├── mappers/
└── types/
        └── repository.types.ts
```

`users.repository.ts` adalah facade domain-specific dan satu-satunya public
data-access API untuk module users. Query file, filter, mapper, dan tipe
repository tidak boleh diimpor langsung oleh route atau service.

────────────────────────────────────────────────────────────
route
────────────────────────────────────────────────────────────

Hanya bertugas:

- menerima HTTP request
- memakai schema untuk validasi body, query, params, dan headers
- memanggil service
- memilih response dan HTTP status
- mengintegrasikan authentication/authorization plugin

Tidak boleh:

- membuat SQL atau memanggil database langsung
- menentukan business rule
- menentukan soft delete atau hard delete
- melakukan perhitungan atau manipulasi domain

────────────────────────────────────────────────────────────
schema
────────────────────────────────────────────────────────────

Berisi:

- schema body, query, params, headers, cookies, dan response
- constraint format dan tipe request
- type inference untuk service/route

Gunakan schema Elysia `t` yang sudah dipakai project dan type inference dari
schema. Schema tidak memanggil service atau repository dan tidak menduplikasi
validasi database.

────────────────────────────────────────────────────────────
service
────────────────────────────────────────────────────────────

Tempat seluruh Business Logic.

Contoh:

- business validation dan authorization rule
- perhitungan dan workflow
- integrasi service/module lain
- external API dan background workflow bila diperlukan
- menentukan `softDelete()` atau `hardDelete()` sesuai business policy
- transaction orchestration untuk use-case lintas repository

Repository hanya dipanggil dari Service.
Service tidak menulis SQL dan tidak mengetahui detail query file.

────────────────────────────────────────────────────────────
repository
────────────────────────────────────────────────────────────

Repository adalah data-access API yang spesifik terhadap bounded context. Ia
menjadi facade untuk query database dan tidak mengetahui HTTP.

Tanggung jawab repository:

- SELECT, INSERT, UPDATE, dan operasi delete yang memang didukung tabel.
- Menerjemahkan filter typed menjadi SQL dan parameter binding.
- Mengembalikan application model melalui mapper bila representation database
    berbeda dari model aplikasi.
- Menjalankan unit-of-work atau menerima transaction context dari service.
- Menjaga query tetap kecil, terlokalisasi, dan mudah diuji.

Repository tidak boleh berisi:

- HTTP request/response.
- Business rule atau keputusan authorization.
- Validasi request yang seharusnya berada di schema/service.
- Generic `BaseRepository<T>`, `GenericRepository<T>`,
    `CrudRepository<T>`, atau repository factory hanya untuk mengurangi
    duplikasi.

### Struktur berdasarkan complexity

Module tanpa data access, seperti health route, boleh hanya memiliki route,
schema, dan service bila memang dibutuhkan. Namun setiap module yang memiliki
repository tetap wajib memakai facade `repository/<module>.repository.ts`;
complexity hanya menentukan isi subfoldernya.

```text
modules/health/
├── health.route.ts
├── health.schema.ts
└── health.service.ts
```

Module users pada service ini mengikuti struktur berikut sejak awal:

```text
modules/users/
├── users.route.ts
├── users.schema.ts
├── users.service.ts
└── repository/
        ├── users.repository.ts       # Facade domain-specific
        ├── queries/
        │   ├── find-by-id.ts
        │   ├── find-by-email.ts
        │   ├── search.ts
        │   ├── insert.ts
        │   ├── update.ts
        │   ├── soft-delete.ts
        │   ├── hard-delete.ts
        │   ├── restore.ts
        │   └── upsert.ts              # jika domain membutuhkannya
        ├── filters/
        │   ├── user.filter.ts
        │   └── user.sort.ts
        ├── mappers/
        │   └── user.mapper.ts
        └── types/
                └── repository.types.ts
```

Jangan memecah query sederhana menjadi banyak file tanpa alasan, tetapi jangan
memindahkan facade kembali ke module root. `users.repository.ts` tetap menjadi
facade yang dipanggil service; service tidak mengimpor query file secara
langsung.

### Repository API

Gunakan nama operasi yang konsisten dan intent-nya jelas bila module
memilikinya:

```text
findById(id, options?)
findByEmail(email, options?)
findOne(filter, options?)
search(filter)
list(filter)
count(filter)
exists(filter)

insert(data)
update(id, data)
softDelete(id)
hardDelete(id)
restore(id)
upsert(data)                 # hanya jika domain membutuhkannya
```

Untuk baseline service user, API repository yang tersedia adalah:

```text
getModuleStatus()
```

Jangan menambahkan CRUD, filter, soft delete, atau upsert ke module users
sebelum ada use-case dan schema database yang membutuhkannya.

Pilih `insert` atau `create` untuk satu module dan pertahankan convention itu.
Jangan mencampur `create`, `insert`, `add`, dan `save` tanpa alasan domain yang
jelas. Data untuk `insert` dan `update` harus berupa input model yang typed,
bukan object database row mentah.

Jangan mengubah nama method existing hanya demi guideline bila hal itu
memutuskan compatibility. Saat module disentuh, gunakan facade atau
compatibility wrapper yang tipis, lalu gunakan convention baru untuk operasi
yang ditambahkan.

`update` mendukung partial update bila API menggunakan PATCH. Field yang boleh
diubah harus di-whitelist. Jika tidak ada field yang diubah, jangan menjalankan
`UPDATE` kosong; kembalikan hasil yang disepakati atau lempar error domain.
Optimistic locking hanya ditambahkan pada tabel/use-case yang memang
membutuhkannya, misalnya dengan query seperti berikut:

```sql
UPDATE users
SET name = $1, version = version + 1
WHERE id = $2 AND version = $3
```

Affected rows `0` dapat dipetakan menjadi conflict bila business rule
mengharuskannya. Jangan menambahkan optimistic locking ke semua tabel.

### Filter, sorting, dan pagination

Filter adalah object kondisi, bukan SQL. Contoh bentuk domain:

```ts
interface UserFilter {
    search?: string;
    email?: string;
    status?: UserStatus;
    roleId?: string;
    createdAt?: { from?: Date; to?: Date };
    includeDeleted?: boolean;
    pagination?: { page: number; limit: number };
    sort?: { field: UserSortField; direction: 'asc' | 'desc' };
}
```

Schema memvalidasi tipe, page, dan limit; service dapat menerapkan batas
business yang sesuai. Repository menerjemahkan filter tersebut menjadi SQL
dan parameter binding.

Identifier SQL yang dinamis tidak boleh berasal langsung dari request. Sorting
wajib memakai whitelist:

```ts
const USER_SORT_COLUMNS = {
    name: 'name',
    email: 'email',
    createdAt: 'created_at',
} as const;
```

`field` hanya menerima key whitelist dan `direction` hanya `asc` atau `desc`.
Value seperti search, email, tanggal, page, limit, dan offset selalu dibind
sebagai parameter. Escape wildcard `%`, `_`, dan backslash bila search memakai
`ILIKE`.

Dengan Bun SQL, gunakan tagged template untuk value:

```ts
await db()`
    SELECT id, name, email
    FROM "user"."users"
    WHERE email = ${email}
    LIMIT ${limit} OFFSET ${offset}
`;
```

`unsafe` hanya boleh digunakan untuk SQL yang sepenuhnya trusted dan statis,
seperti isi migration atau nama kolom yang sudah dipilih dari whitelist. Ia
tidak boleh menerima SQL, nama tabel, nama kolom, atau potongan `ORDER BY` dari
HTTP/user input.

Mulai dari Filter object dan query file yang spesifik terhadap domain. Jangan
membuat generic query builder besar sebelum ada pola berulang yang terukur.
Jika pengulangan nyata muncul, abstraction kecil hanya boleh menangani
`WHERE`, parameter list, whitelist `ORDER BY`, atau pagination. Jangan memakai
Specification Pattern sebelum ada kebutuhan nested AND/OR, reusable complex
criteria, atau filter composition lintas use-case.

### Soft delete, hard delete, restore, dan upsert

Jika tabel memiliki `deleted_at`, query normal wajib menambahkan
`deleted_at IS NULL`. Record terhapus hanya boleh terlihat melalui opsi
explicit seperti `includeDeleted: true` atau method administratif yang jelas.

Operasi delete memiliki intent yang berbeda:

```text
softDelete(id)  -> UPDATE ... SET deleted_at = CURRENT_TIMESTAMP
hardDelete(id) -> DELETE ... WHERE id = $1
restore(id)    -> UPDATE ... SET deleted_at = NULL
```

`softDelete` harus idempotent sesuai kebutuhan domain dan tidak mengubah record
yang sudah deleted secara diam-diam. `restore` bukan alias `update`; ia adalah
operasi domain tersendiri. Keputusan apakah sebuah use-case boleh melakukan
soft atau hard delete berada di service. Jangan membuat `delete(id)` yang
terkadang berarti soft delete dan terkadang hard delete.

Jika conflict key memerlukan UPSERT, sediakan method `upsert` dan query
`upsert.ts` secara eksplisit. Gunakan PostgreSQL `ON CONFLICT` yang atomic,
bukan pola SELECT lalu UPDATE/INSERT yang rentan race condition. Bulk operation
(`insertMany`, `updateMany`, `softDeleteMany`, atau `hardDeleteMany`) hanya
ditambahkan bila ada kebutuhan nyata dan harus tetap parameterized.

### Transaction context

Transaction boundary berada di service/use-case bila satu operasi melibatkan
lebih dari satu repository atau lebih dari satu perubahan yang harus atomic:

```text
service.createCustomer()
└── db().begin(async (tx) =>
        ├── customerRepository.insert(tx, data)
        ├── profileRepository.insert(tx, profile)
        └── addressRepository.insert(tx, address)
        )
```

Repository boleh menerima context database/transaction yang kompatibel dengan
Bun SQL, atau dibuat dengan transaction context, sesuai kebutuhan module.
Jangan membuka transaction baru di setiap method repository bila service
memerlukan atomicity lintas repository. Atomic operation yang benar-benar
menjadi satu unit persistence, seperti lock ordering atau token consumption,
boleh mempertahankan transaction lokal bila alasannya didokumentasikan dan
tidak menyembunyikan boundary lintas use-case.

Repository tidak mengubah error menjadi HTTP response. Gunakan error type yang
sudah ada di `#project/errors`; unique violation dapat dipetakan menjadi
conflict dan kegagalan persistence menjadi database error pada boundary yang
sesuai.
Database error mentah tidak boleh bocor ke response API.

Mapper hanya dibuat bila ada masalah representation, misalnya
`created_at -> createdAt`, alias kolom, parsing timestamp/JSONB, atau pemisahan
DB row dari application model. Jangan membuat mapper yang hanya menyalin
property identik tanpa manfaat.

────────────────────────────────────────────────────────────
database/
────────────────────────────────────────────────────────────

`packages/database` adalah pemilik client PostgreSQL, transaction helper, dan
lifecycle database. `main.ts` pada setiap aplikasi membuat client hanya ketika
`ENABLE_INFRASTRUCTURE=true`, lalu menutupnya saat graceful shutdown.
Repository menerima dependency database bila use-case persistence sudah ada;
module tidak membuat koneksi sendiri.

Database lifecycle project berada di `packages/database`:

- `migrations/` untuk perubahan schema yang versioned.
- `seeds/` untuk data awal/idempotent.
- CLI untuk apply, rollback, seed, dan reset secara explicit.

Folder `apps/services/user/src/database/migrations` dan `seeds` hanya menjadi
boundary lokal untuk service dan belum berisi migration atau seed aktif.

Migration dan seed boleh memakai `unsafe` hanya untuk file SQL trusted yang
dibaca dari source tree. Input HTTP tidak boleh mengalir ke path tersebut.

Kolom audit yang sudah ada harus dipertahankan. Saat ini schema menggunakan
`created_at` dan pada beberapa tabel `updated_at`; `"user"."users"` juga memiliki
`suspended_at`. Jangan menambahkan `deleted_at`, audit actor, atau migration
baru hanya untuk memenuhi guideline ini. Tambahkan hanya bila kebutuhan domain
dan perubahan schema memang disetujui.

Folder ini tidak mengetahui business logic.

────────────────────────────────────────────────────────────
jobs/
────────────────────────────────────────────────────────────

Background Process.

Contoh:

Scheduler

Cron

Email Queue

Notification

Import

Export

Cleanup

Sync

Worker

Job tidak boleh dipanggil langsung oleh Route.

────────────────────────────────────────────────────────────
tests/
────────────────────────────────────────────────────────────

Berisi seluruh test.

Disarankan struktur mengikuti module.

Contoh:

```text
apps/services/user/src/tests/
└── users.test.ts
```

Gunakan Bun Test.

Baseline test `users.test.ts` memverifikasi health endpoint, users module
status endpoint, dan penolakan request internal tanpa signed identity saat
signing diaktifkan. Test route menggunakan `app.handle(new Request(...))`.

Test repository/service harus mengikuti risk dan operasi yang benar-benar
dimiliki module. Jika users nanti memiliki persistence, tambahkan coverage
berikut sesuai use-case:

READ

- `findById`, `findByEmail`, `findOne`, `search`/`list`, `count`, dan `exists`.
- Pencarian tanpa filter, dengan filter, dengan pagination, dan dengan sorting.
- Query default tidak menampilkan record soft-deleted.
- `includeDeleted` atau method administratif hanya digunakan secara explicit.

CREATE dan UPDATE

- `insert` valid, duplicate/conflict, validation error, dan database error.
- Update satu field, beberapa field, tanpa field, dan record yang tidak ada.
- Optimistic-lock conflict hanya bila module memang menggunakannya.
- Field yang tidak di-whitelist tidak pernah menjadi identifier SQL.

DELETE dan RESTORE

- `softDelete` record aktif dan record yang sudah deleted.
- `restore` record deleted dan record yang belum deleted.
- `hardDelete` record ada/tidak ada dan verifikasi record benar-benar hilang.

UPSERT DAN TRANSACTION

- `upsert` insert saat belum ada dan update saat conflict bila digunakan.
- Alur multi-repository berhasil melakukan COMMIT.
- Kegagalan di salah satu langkah melakukan ROLLBACK.

SECURITY

- Search dan filter yang berisi payload SQL tidak mengubah query.
- Sorting hanya menerima key whitelist; tidak ada raw `ORDER BY` dari request.
- Pagination tidak dapat menyuntikkan SQL dan memiliki batas yang wajar.

Gunakan `app.handle(new Request(...))` untuk test route dan dependency injection
atau database test context untuk test repository. Jangan mengharuskan database
real untuk unit test yang hanya menguji filter/query translation; gunakan test
integration untuk memastikan SQL dan transaction behavior terhadap PostgreSQL.

────────────────────────────────────────────────────────────
Dependency Flow
────────────────────────────────────────────────────────────

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

↓

Repository

↓

Service

↓

HTTP Response

────────────────────────────────────────────────────────────
Dependency Rules
────────────────────────────────────────────────────────────

Route
    boleh memanggil
        Service

Service
    boleh memanggil
        Repository
        `packages/*`
        service-local `shared/`

Repository
    boleh memanggil
        `packages/database`

Repository
    TIDAK boleh memanggil
        Service

Route
    TIDAK boleh memanggil
        Repository

Route
    TIDAK boleh memanggil
        Database

Schema
    TIDAK boleh memanggil
        Service

Schema
    TIDAK boleh memanggil
        Repository

`packages/*`
    TIDAK boleh bergantung pada `apps/*` atau module domain.

service-local `shared/`
    boleh memanggil `packages/*`, tetapi tidak boleh menjadi tempat kontrak
    lintas service atau repository module lain.

────────────────────────────────────────────────────────────
Expected Data Flow
────────────────────────────────────────────────────────────

READ

Route
↓
Schema
↓
Service
↓
Domain filter
↓
Repository facade
↓
Query file
↓
Database
↓
Mapper
↓
Service
↓
Response

WRITE

Route
↓
Schema
↓
Service business rule
↓
Transaction boundary bila diperlukan
↓
Repository operation (`insert`, `update`, `softDelete`, `hardDelete`,
`restore`, atau `upsert`)
↓
Query file
↓
Database
↓
Mapper
↓
Response

Route tidak membuat filter SQL. Service tidak menulis SQL. Repository tidak
menentukan authorization atau apakah request delete boleh menjadi hard delete.

────────────────────────────────────────────────────────────
Naming Convention
────────────────────────────────────────────────────────────

Semua nama file menggunakan lowercase dan kebab-case.

Contoh:

customer.route.ts

customer.service.ts

customer.repository.ts

customer.schema.ts

Hindari:

CustomerService.ts

CustomerRepository.ts

myFile.ts

────────────────────────────────────────────────────────────
Scalability
────────────────────────────────────────────────────────────

Repository module selalu dimulai dari facade di dalam folder `repository/`.
Saat module memiliki query atau workflow yang kompleks, pecah hanya bagian
yang membutuhkan organisasi tambahan:

```text
users/
├── users.route.ts
├── users.schema.ts
├── users.service.ts
└── repository/
    ├── users.repository.ts
    ├── queries/
    ├── filters/
    ├── mappers/
    └── types/
```

Module lain yang memiliki repository mengikuti boundary yang sama sejak awal;
complexity hanya menentukan file yang diisi di dalam subfolder tersebut.
Komunikasi lintas module tetap melalui service, bukan repository module lain.

Dengan pendekatan ini setiap module dapat berkembang secara independen tanpa
memengaruhi keseluruhan project. Repository module lain tidak boleh diimpor;
komunikasi lintas module tetap melalui service atau kontrak antar-service.

────────────────────────────────────────────────────────────
Migration Strategy
────────────────────────────────────────────────────────────

Penyesuaian dilakukan incremental, tetapi boundary repository pada repo ini
tidak boleh kembali ke file flat di module root.

PHASE 1 - INSPECT

- Baca `package.json`, database client, migration, seed, repository, service,
    route, schema, dan test module yang akan disentuh.
- Catat database, driver, ORM/query builder, audit field, soft delete,
    transaction, filter, dan abstraction yang sudah ada.
- Jangan mengubah file pada tahap ini.

PHASE 2 - ANALYZE

- Pilih module dengan risk dan manfaat refactor yang jelas.
- Pastikan perubahan dapat mempertahankan API contract dan behavior existing.
- Pisahkan kebutuhan domain yang nyata dari abstraction yang belum diperlukan.

PHASE 3 - PROPOSE

Tulis keputusan lokal sebelum implementasi:

```text
BEFORE
modules/users/
└── users.repository.ts

AFTER
modules/users/
└── repository/
    ├── users.repository.ts
    ├── queries/
    ├── filters/
    ├── mappers/
    └── types/
        └── repository.types.ts
```

Jelaskan mengapa query perlu dipecah, operasi apa yang didukung, transaction
boundary-nya, dan bagaimana compatibility dengan service existing dijaga.

PHASE 4 - IMPLEMENT

- Pertahankan database driver, schema database, public service API, dan API
    contract kecuali perubahan memang diperlukan.
- Pindahkan query secara bertahap ke facade/query file yang typed.
- Tambahkan whitelist sorting, parameter binding, mapping, dan operation
    naming yang konsisten.
- Jangan membuat migration hanya karena struktur repository berubah.

PHASE 5 - TEST

- Jalankan existing test lebih dahulu, lalu test repository/service untuk slice
    yang diubah.
- Verifikasi SQL injection, filtering, pagination, delete policy, dan
    transaction rollback sesuai kemampuan module.
- Regenerate OpenAPI/SDK bila perubahan backend menyentuh API contract.

PHASE 6 - REVIEW

- Pastikan route tidak memanggil database, service tidak berisi SQL, dan query
    tidak mengetahui HTTP.
- Pastikan repository bukan God Object dan tidak ada generic repository baru.
- Tinjau diff dan dokumentasikan gap yang sengaja belum diubah.

────────────────────────────────────────────────────────────
Architecture Principle
────────────────────────────────────────────────────────────

Presentation Layer
    Route

↓

Validation Layer
    Schema

↓

Business Layer
    Service

↓

Persistence Layer
    Repository

↓

Database

Setiap layer hanya mengetahui layer tepat di bawahnya (one-way dependency).

Tujuan akhirnya adalah menghasilkan backend yang modular, mudah diuji, mudah dipelihara, dan siap berkembang dari aplikasi kecil hingga sistem enterprise berskala besar.

────────────────────────────────────────────────────────────
Definition of Done
────────────────────────────────────────────────────────────

Refactor repository dianggap selesai bila:

- Application tetap dapat dijalankan dan TypeScript typecheck berhasil.
- Lint dan existing test berhasil bila command tersedia.
- Test baru untuk operasi dan risk yang relevan berhasil.
- CRUD yang dimiliki module tetap berjalan tanpa mengubah API contract.
- Soft delete, hard delete, restore, dan upsert hanya tersedia bila domain
    membutuhkannya dan memiliki intent yang explicit.
- Filtering, sorting, dan pagination aman terhadap SQL injection.
- Transaction success melakukan COMMIT dan failure melakukan ROLLBACK bila
    use-case membutuhkan atomicity.
- SQL mudah ditemukan, dibaca, dan tidak menerima raw SQL dari user.
- Repository tetap domain-specific, modular, dan tidak menjadi God Object.
- Tidak ada database migration atau improvement unrelated yang ditambahkan
    hanya demi architecture guideline.