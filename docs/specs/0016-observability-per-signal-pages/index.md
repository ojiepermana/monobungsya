# 0016. Observability terpecah jadi enam halaman dengan permission per sinyal

**Date**: 2026-08-26
**Status**: In Progress

## Summary

Halaman `/observability` yang sekarang satu komponen dengan empat tab dipecah menjadi enam halaman berdiri sendiri, masing masing punya alamatnya sendiri dan memakai kerangka yang sama dengan halaman logs, yaitu header, filter yang bisa dibuka tutup, isi, dan footer. Satu permission `observability:telemetry:read` yang selama ini menjaga semuanya dipensiunkan dan diganti empat permission per sinyal, sehingga akses seseorang bisa dibatasi ke alert saja tanpa ikut membuka benchmark. API menyesuaikan di tiga hal: gerbang permission per endpoint, cursor yang bisa mundur lewat `prevCursor`, dan blok `options` untuk mengisi dropdown filter seperti yang sudah dilakukan endpoint logs. Grant `admin@local.app` ikut terbawa otomatis, karena seed bootstrap memberi email itu seluruh isi tabel permission, dan migrasinya juga menyalin grant lama supaya database yang sudah berjalan tidak kehilangan akses.

## Requirements

**User stories**:

- Sebagai operator, saya ingin tiap sinyal punya alamatnya sendiri sehingga saya bisa menandai halaman metric dan langsung membukanya saat sedang menangani insiden.
- Sebagai operator, saya ingin menempel tautan ke satu trace tertentu ke rekan kerja sehingga dia melihat persis apa yang saya lihat, bukan daftar yang harus dia telusuri sendiri.
- Sebagai admin, saya ingin memberi seseorang akses ke alert tanpa ikut membuka evidence benchmark sehingga akses mengikuti pekerjaannya.
- Sebagai operator, saya ingin filter dan posisi halaman bertahan setelah reload sehingga saya tidak kehilangan tempat saat berpindah ke jendela lain dan kembali.
- Sebagai operator, saya ingin ember metric yang tidak punya data terlihat sebagai celah, bukan sebagai nilai nol, sehingga saya tidak salah menyimpulkan bahwa beban turun padahal telemetrinya yang hilang.

**Acceptance criteria** (kontraknya, tiap butir ber-ID dan bisa diperiksa sendiri):

- **AC-1**: Migrasi `0038_access_observability_signal_permissions` di `packages/database/migrations/access` menyisipkan empat permission `observability:trace:read`, `observability:metric:read`, `observability:benchmark:read`, dan `observability:alert:read` memakai bentuk `ON CONFLICT (name) DO UPDATE` yang sama dengan `0021_access_jobs_permissions`. Dalam migrasi yang sama, setiap baris `access.permission_user` yang menunjuk `observability:telemetry:read` disalin menjadi empat grant baru untuk `user_id` yang sama, penyalinan terjadi sebelum penghapusan, lalu baris permission `observability:telemetry:read` dihapus. `bun run db:migrate` dijalankan dua kali berturut turut berhasil, dan `bun run db:migrate:down --steps 1` mengembalikan permission lama beserta grantnya dan menghapus keempat permission baru beserta grantnya.
- **AC-2**: `packages/acl` mengekspor keempat nama baru di `PERMISSIONS`, `PERMISSION_CATALOG`, dan peta `descriptions`, dan tidak lagi mengekspor `observabilityTelemetryRead`. Unit test yang ada membuktikan katalog tetap sejalan dengan konstanta, dan `bun run typecheck` gagal di setiap pemakaian nama lama yang tertinggal.
- **AC-3**: Migrasi `0039_telemetry_baseline_cursor` di `packages/database/migrations/logs` membuat index yang melayani urutan cursor `telemetry.benchmark_baselines`, yaitu `(promoted_at DESC, baseline_id)`, dan file turunnya menghapus index itu. Migrasi dijalankan dua kali berturut turut berhasil.
- **AC-4**: Kedelapan endpoint observability di `apps/gateway/erp/src/routes/proxy.route.ts` dijaga permission sesuai sinyalnya, bukan lagi satu permission bersama. Pemetaan di `apps/services/logs/src/app.ts` berubah dari satu prefix `/internal/observability/` menjadi pemetaan per path, dan endpoint ingestion benchmark tetap tanpa permission seperti sekarang. Sebuah sesi yang hanya memegang `observability:alert:read` mendapat 200 dari `/api/v1/observability/alerts` dan 403 dari `/api/v1/observability/traces`.
- **AC-5**: `tracesResponse`, `benchmarkRunsResponse`, `alertsResponse`, dan `benchmarkBaselinesResponse` masing masing membawa `prevCursor` yang bernilai null di halaman pertama dan berisi cursor yang valid di halaman mana pun sesudahnya. Query `benchmarkBaselinesQuery` menerima `cursor`, dan responsenya membawa `nextCursor`. Membuka halaman ketiga lalu menekan Previous dua kali mengembalikan isi halaman pertama yang sama persis dengan pemuatan awal.
- **AC-6**: Kelima endpoint list membawa blok `options` berisi nilai yang benar benar ada di data dalam jendela filter yang sama: `traces` memberi `services`, `resourceKinds`, `resourceNames`; `metrics` memberi `metrics`, `services`, `resourceKinds`; `benchmarks/runs` memberi `scenarioIds`, `statuses`, `bunVersions`; `benchmarks/baselines` memberi `scenarioIds`, `environments`, `fixtureVersions`; `alerts` memberi `ruleIds`, `services`. Bentuknya mengikuti `options` di `apps/services/logs/src/modules/logs/logs.schema.ts`. Enum tetap seperti status trace, severity alert, dan statistic tidak masuk `options` dan ditulis di UI.
- **AC-7**: Sembilan route berdiri di `apps/web/src/app/shell/app.routes.ts` sesuai tabel di `## Feature design`, masing masing dijaga `authGuard` plus gerbang permissionnya. Route detail memakai permission yang sama dengan route daftarnya. `/observability` dijaga gerbang baru `anyPermissionGuard` yang meloloskan pemegang salah satu dari keempat permission, memakai `hasAnyRequiredPermission` yang sudah ada di `packages/acl`.
- **AC-8**: `apps/web/src/app/shell/app.nav.ts` menghasilkan grup datar `Observability` berisi enam item, yaitu Overview, Traces, Metrics, Benchmarks, Baselines, dan Alerts. Tiap item hanya muncul kalau permissionnya dimiliki, item Baselines mengikuti `observability:benchmark:read`, dan seluruh grup hilang kalau tidak ada satu pun item yang lolos.
- **AC-9**: Keenam halaman daftar memakai kerangka yang sama dengan halaman logs: `PageHeader` berisi judul dan tombol Refresh, `PageFilterToggle` yang membuka `PageFilter` yang tersembunyi secara default, `PageContent` yang bisa digulir, dan `PageFooter`. Setiap filter panel punya tombol Clear Filters yang nonaktif saat tidak ada filter yang terpasang.
- **AC-10**: Footer Traces, Benchmarks, Baselines, dan Alerts berisi Previous dan Next yang digerakkan `prevCursor` dan `nextCursor`, plus jumlah baris di halaman ini. Tidak ada nomor halaman dan tidak ada tombol First atau Last. Footer Metrics tidak punya tombol paginasi dan hanya menampilkan jumlah ember plus angka `coverage`. Footer Overview hanya menampilkan waktu pemuatan terakhir.
- **AC-11**: Setiap nilai filter dan cursor halaman ditulis ke query string, dan memuat ulang halaman dengan query string itu menghasilkan tampilan yang sama persis. Menempel URL sebuah halaman ke sesi lain yang punya permission sama menghasilkan isi yang sama.
- **AC-12**: Cursor yang tidak valid atau sudah kedaluwarsa di query string membuat API menolak dengan 422, halaman menampilkan satu baris pesan bahwa tautan itu sudah kedaluwarsa, membuang parameter cursor dari URL, lalu memuat halaman pertama dengan filter yang tetap utuh.
- **AC-13**: Filter waktu di Traces dan Metrics default ke 24 jam terakhir, menyediakan pilihan cepat 15 menit, 1 jam, 6 jam, dan 24 jam, plus pemilih rentang khusus. Rentang yang melewati batas 24 jam ditolak di UI sebelum request dikirim, dengan pesan yang menyebut batas itu, sehingga 422 dari service jadi jaring pengaman terakhir bukan jalur normal.
- **AC-14**: `/observability/traces/:traceId` menggambar waterfall berskala waktu. Tiap span jadi satu bar yang posisi dan lebarnya proporsional terhadap `startedAt` dan `durationMs` relatif rentang seluruh trace, kedalaman indentasinya dihitung dari rantai `parentSpanId`, dan span dengan `orphan` bernilai true digambar di kedalaman nol dengan penanda tersendiri. Trace yang `completeness` bernilai `partial` menampilkan penanda bahwa pohonnya tidak lengkap. Trace yang sudah lewat retensi mengembalikan 404 dan halaman menampilkan pesan kedaluwarsa, bukan halaman kosong.
- **AC-15**: `/observability/metrics` menampilkan grafik garis dari `@ojiepermana/angular/chart/line` di atas tabel. Jumlah garisnya mengikuti selector `group` di filter, yaitu satu garis per nilai group saat group dipilih dan satu garis agregat saat group kosong. Ember yang hilang membuat garis benar benar terputus dan rentangnya diberi pita abu abu berlabel data tidak tersedia. Ember yang hilang dihitung dengan membandingkan seluruh `bucketStart` yang diharapkan, yang diturunkan dari `from`, `to`, dan `stepSeconds`, terhadap `bucketStart` yang benar benar ada di `data`. Tidak ada ember hilang yang pernah digambar sebagai nilai nol.
- **AC-16**: `/observability` menampilkan empat kartu ringkasan yang masing masing menaut ke halamannya: jumlah trace berstatus error dalam jendela, jumlah alert berstatus firing, cakupan metric berupa tersimpan lawan diharapkan lawan hilang, dan status benchmark run terakhir. Sebuah kartu hanya dirender kalau permission sinyalnya dimiliki, dan tidak ada request yang dikirim untuk sinyal yang permissionnya tidak dimiliki. Tidak ada endpoint agregat baru.
- **AC-17**: Pembedaan hasil sepi dan titik buta dari spec 0014 tetap utuh di keenam halaman. `storageStatus` bernilai `blind_spot` memunculkan peringatan bahwa penyimpanan telemetry tidak tersedia sehingga tampilan ini titik buta bukan hasil nol, dan itu berbeda dari pesan daftar kosong yang muncul saat penyimpanan sehat tapi tidak ada barisnya.
- **AC-18**: Respon 403 dari sebuah endpoint menampilkan pesan yang menyebut permission spesifik yang kurang untuk halaman itu, dan 401 tetap mengarahkan ke alur masuk ulang seperti sekarang.
- **AC-19**: `apps/web/src/app/pages/observability/observability.page.ts` dan testnya dihapus. Setiap assertion di `observability.page.test.ts` yang masih relevan dipindahkan ke test halaman penggantinya. Spesifikasi OpenAPI gateway dan klien di `apps/web/src/api/generated-client` diregenerasi lewat alur spec 0013, dan `e2e/observability.spec.ts` diperluas menutup kesembilan route.
- **AC-20**: Keenam halaman daftar dan ketiga halaman detail lolos AXE tanpa pelanggaran critical maupun serious, memenuhi WCAG AA. Waterfall dan grafik garis punya padanan teks yang bisa dibaca pembaca layar, karena keduanya menyampaikan informasi yang tidak ada di tempat lain pada halaman itu.

## Decision

**Chosen option**: Option 2: Enam halaman berdiri sendiri dengan permission per sinyal.

Halaman `/observability` dipecah menjadi enam route daftar dan tiga route detail di atas kerangka halaman logs, dan `observability:telemetry:read` dipensiunkan menjadi empat permission per resource lewat satu migrasi yang menyalin grant lama sebelum menghapus permission lama.

## Feature design

**Perubahan data model**: tidak ada tabel baru dan tidak ada kolom baru di skema `telemetry` mana pun. Yang berubah hanya isi katalog permission, grant yang menunjuknya, dan satu index.

| Objek | Skema | Perubahan |
| --- | --- | --- |
| `access.permission` | access | Empat baris masuk. Baris `observability:telemetry:read` keluar. |
| `access.permission_user` | access | Setiap grant permission lama disalin jadi empat grant baru untuk `user_id` yang sama, lalu grant lama ikut terhapus lewat `ON DELETE CASCADE` saat baris permissionnya dihapus. Batasan unik `(permission_id, user_id)` membuat penyalinan aman diulang. |
| `telemetry.benchmark_baselines` | logs | Satu index baru `(promoted_at DESC, baseline_id)` untuk menopang cursor. Tidak ada perubahan kolom. |

**Katalog permission baru** (kode diturunkan dari nama, seperti fungsi `codeFor` di `packages/acl`):

| Nama | Kode | Menjaga |
| --- | --- | --- |
| `observability:trace:read` | `OBSERVABILITY_TRACE_READ` | Daftar trace dan detail trace |
| `observability:metric:read` | `OBSERVABILITY_METRIC_READ` | Ember metric dan cakupannya |
| `observability:benchmark:read` | `OBSERVABILITY_BENCHMARK_READ` | Benchmark run, detail run, dan baseline |
| `observability:alert:read` | `OBSERVABILITY_ALERT_READ` | State alert dan detail per rule |

**Route dan gerbangnya**:

| Route | Permission | Halaman |
| --- | --- | --- |
| `/observability` | salah satu dari keempat, lewat `anyPermissionGuard` | Overview, empat kartu yang menaut |
| `/observability/traces` | `observability:trace:read` | Daftar trace |
| `/observability/traces/:traceId` | `observability:trace:read` | Waterfall span |
| `/observability/metrics` | `observability:metric:read` | Grafik garis plus tabel ember |
| `/observability/benchmarks` | `observability:benchmark:read` | Daftar benchmark run |
| `/observability/benchmarks/:runId` | `observability:benchmark:read` | Detail run dan perbandingannya |
| `/observability/baselines` | `observability:benchmark:read` | Daftar baseline aktif dan historis |
| `/observability/alerts` | `observability:alert:read` | State alert |
| `/observability/alerts/:ruleId` | `observability:alert:read` | State alert satu rule, menerima `seriesFingerprint` opsional |

**API surface** (kedelapan endpoint gateway sudah ada; kolom Perubahan menyebut apa yang berubah):

| Endpoint | Method | Permission baru | Perubahan |
| --- | --- | --- | --- |
| `/api/v1/observability/traces` | GET | `observability:trace:read` | Tambah `prevCursor` dan `options` di response |
| `/api/v1/observability/traces/:traceId` | GET | `observability:trace:read` | Tidak berubah |
| `/api/v1/observability/metrics` | GET | `observability:metric:read` | Tambah `options` di response, tanpa cursor |
| `/api/v1/observability/benchmarks/runs` | GET | `observability:benchmark:read` | Tambah `prevCursor` dan `options` |
| `/api/v1/observability/benchmarks/runs/:runId` | GET | `observability:benchmark:read` | Tidak berubah |
| `/api/v1/observability/benchmarks/baselines` | GET | `observability:benchmark:read` | Tambah `cursor` di query, `nextCursor`, `prevCursor`, dan `options` di response |
| `/api/v1/observability/alerts` | GET | `observability:alert:read` | Tambah `prevCursor` dan `options` |
| `/api/v1/observability/alerts/:ruleId` | GET | `observability:alert:read` | Tidak berubah |
| `/internal/observability/benchmark-ingestions` | POST | tetap tanpa permission | Tidak berubah |

Kode error tetap seperti 0014: 401, 403, 422, 503, dan 404 untuk trace yang tidak ada atau sudah lewat retensi. Batas jendela 24 jam, allowlist field untuk `group`, batas `maxSeries`, dan statement timeout `OBSERVABILITY_QUERY_TIMEOUT_MS` semuanya tetap berlaku apa adanya.

**Value sourcing** (setiap nilai yang harus dihasilkan atau ditampilkan, dan dari mana asalnya):

| Aksi | Nilai yang ditampilkan | Sumber |
| --- | --- | --- |
| Buka halaman daftar mana pun | Isi dropdown filter yang dinamis | Blok `options` di response, dari `SELECT DISTINCT` atas jendela filter yang sama, AC-6 |
| Buka halaman daftar mana pun | Isi dropdown filter yang enum tetap | Ditulis di UI dari `observability.schema.ts`: status trace `ok`, `error`, `unset`; severity alert `warning`, `critical`; statistic `count`, `sum`, `min`, `max`; group `service`, `resourceKind`, `resourceName`, `status` |
| Footer halaman ber-cursor | Tombol Previous aktif atau tidak | `prevCursor` di response, null berarti halaman pertama, AC-5 |
| Footer halaman ber-cursor | Jumlah baris di halaman ini | Panjang array `data` di response, bukan hitungan total, karena tidak ada `COUNT` |
| Footer Metrics | Jumlah ember dan angka cakupan | Panjang `data` plus blok `coverage` yang sudah ada di `metricsResponse` |
| Muat ulang halaman | Filter dan posisi cursor yang dipulihkan | Query string, AC-11 |
| Traces dan Metrics saat pertama dibuka | Nilai `from` dan `to` | Dihitung di klien sebagai sekarang dikurangi 24 jam sampai sekarang, AC-13 |
| Waterfall trace | Posisi dan lebar tiap bar | Diturunkan dari `startedAt` dan `durationMs` tiap span relatif `startedAt` paling awal dan `finishedAt` paling akhir di array `spans` |
| Waterfall trace | Kedalaman indentasi tiap span | Diturunkan dengan menelusuri `parentSpanId` sampai akar, span dengan `orphan` true dipaksa ke kedalaman nol |
| Grafik metric | Ember yang hilang | Diturunkan dengan membandingkan deret `bucketStart` yang diharapkan, dihitung dari `from`, `to`, dan `stepSeconds`, terhadap `bucketStart` yang ada di `data`, AC-15 |
| Grafik metric | Jumlah garis yang digambar | Nilai selector `group` di filter, satu garis per nilai group, satu garis agregat saat group kosong |
| Kartu Overview trace error | Angka jumlah | Panggilan `traces` dengan `status=error` pada jendela 24 jam. Angka ditampilkan persis saat `nextCursor` bernilai null, dan ditampilkan sebagai angka diikuti tanda tambah saat `nextCursor` terisi, karena tidak ada `COUNT` yang boleh dijalankan |
| Kartu Overview alert firing | Angka jumlah | Panggilan `alerts` dengan `status=firing`, aturan angka dan tanda tambah sama seperti di atas |
| Kartu Overview cakupan metric | Tersimpan, diharapkan, hilang | Blok `coverage` di `metricsResponse`, sudah eksak, tanpa tanda tambah |
| Kartu Overview benchmark terakhir | Status run terakhir | Item pertama `benchmarks/runs` yang sudah terurut `created_at DESC` |
| Kartu Overview mana pun | Apakah kartunya dirender | `hasResolvedPermission` atas permission sinyal itu terhadap `permissions` milik user di `AuthService`, AC-16 |

**Invarian kunci**:

- Ember metric yang hilang tidak pernah digambar sebagai nilai nol, di tabel maupun di grafik. Ini aturan yang diwarisi dari spec 0014 dan tidak boleh dilonggarkan oleh keputusan tampilan mana pun.
- Hasil sepi dan titik buta selalu dua pesan yang berbeda. `storageStatus` bernilai `blind_spot` tidak pernah dirender sebagai daftar kosong biasa.
- Tidak ada `COUNT(*)` atas tabel `telemetry` mana pun di jalur permintaan halaman, termasuk di kartu Overview.
- Penyalinan grant di migrasi `0038` selalu terjadi sebelum penghapusan baris permission lama, karena `access.permission_user` memakai `ON DELETE CASCADE` sehingga urutan terbalik akan menghapus grant sebelum sempat disalin.
- Route detail tidak pernah punya permission yang lebih longgar dari route daftarnya.

**Security model**: keempat permission bersifat baca saja dan tidak memberi kemampuan menulis apa pun. Halaman observability tidak menampilkan data pribadi pengguna; yang ditampilkan adalah nama service, nama resource, durasi, status, dan pengenal korelasi. Atribut span dirender apa adanya seperti sekarang, jadi kewajiban tidak menaruh data sensitif ke dalam atribut telemetry tetap ada di sisi penulisnya, sama seperti sebelum spec ini. Helper `managePermissionFor` di `packages/acl` tetap berlaku wajar untuk keempat nama baru, karena masing masing punya resourcenya sendiri, sehingga `observability:trace:manage` kelak bisa ditambahkan tanpa kode tambahan. Tidak ada cakupan kepatuhan baru yang tersentuh.

**Configuration required**: tidak ada variabel lingkungan baru. `ACCESS_BOOTSTRAP_ADMIN_EMAILS` yang sudah berisi `admin@local.app` di `.env.example` sudah cukup, karena seed `0004_access.bootstrap_grants.sql` memberi email di daftar itu seluruh isi tabel `access.permission` lewat `CROSS JOIN`, sehingga keempat permission baru ikut terbawa tanpa perubahan seed.

**Skenario test kritis**:

- Jalur bahagia: operator membuka `/observability/traces`, menyempitkan filter ke satu service, maju dua halaman, menyalin URL, membukanya di jendela baru, dan melihat halaman yang sama persis, memverifikasi **AC-9**, **AC-10**, **AC-11**.
- Kegagalan: URL dengan cursor yang sudah kedaluwarsa dibuka, API menolak 422, halaman menampilkan pesan kedaluwarsa dan memuat halaman pertama dengan filter yang tetap utuh, memverifikasi **AC-12**.
- Kegagalan: penyimpanan telemetry tidak tersedia sehingga `storageStatus` bernilai `blind_spot`, dan keenam halaman menampilkan peringatan titik buta, bukan pesan daftar kosong, memverifikasi **AC-17**.
- Permission: sesi yang hanya memegang `observability:alert:read` melihat grup Observability berisi Overview dan Alerts saja, mendapat 200 dari endpoint alerts, mendapat 403 dari endpoint traces, dan diarahkan pergi saat mengetik `/observability/traces` langsung, memverifikasi **AC-4**, **AC-7**, **AC-8**, **AC-18**.
- Migrasi: database dengan tiga user yang memegang `observability:telemetry:read` dimigrasi, ketiganya berakhir memegang keempat permission baru, migrasi turun mengembalikan keadaan semula, dan migrasi naik dijalankan dua kali berturut turut tetap berhasil, memverifikasi **AC-1**.
- Data: metric dengan lubang di tengah jendela menghasilkan garis yang terputus dan pita abu abu, dan tidak ada titik bernilai nol yang muncul di posisi ember yang hilang, memverifikasi **AC-15**.

## Migration plan

**Strategy**: big bang untuk cutover permission, bertahap untuk halaman.

Cutover permission tidak bisa bertahap. `access.permission_user` memakai `ON DELETE CASCADE` ke `access.permission`, jadi menghapus baris permission lama sekaligus menghapus setiap grantnya, dan itu terjadi untuk seluruh delapan endpoint sekaligus. Karena itu pemindahan gerbang di gateway dan di service logs harus dikirim di rilis yang sama dengan migrasi `0038`. Halaman UI sebaliknya bisa dibangun ulang satu per satu, karena halaman lama memanggil keempat endpoint dan pemegang permission lama tetap memegang keempat permission barunya setelah migrasi.

**Phases**:

1. Migrasi `0038`, `packages/acl`, gerbang gateway, dan pemetaan service logs dikirim bersama, disertai halaman Traces yang baru. Setelah migrasi selesai, cache permission gateway dikosongkan secara eksplisit lewat restart gateway, karena `permissionCache.invalidate(userId)` hanya dipicu event `access.permission.changed` dari perubahan grant lewat API, dan SQL mentah tidak memicunya.
2. Lima halaman daftar sisanya plus migrasi `0039`, dikirim bertahap. Route `/observability` sementara mengarahkan ke `/observability/traces` sampai halaman Overview ada.
3. Tiga route detail.
4. Overview dan grafik metric. Route `/observability` berhenti mengarahkan dan mulai menampilkan Overview.
5. Pembersihan: halaman lama dihapus, klien diregenerasi, e2e diperluas.

**Rollback**: `bun run db:migrate:down --steps 1` atas `0038` mengembalikan `observability:telemetry:read` beserta grant untuk setiap user yang saat itu memegang keempat permission baru, lalu menghapus keempatnya. File turunnya harus mengembalikan grant sebelum menghapus permission barunya, dengan alasan `ON DELETE CASCADE` yang sama. Kode gateway dikembalikan dengan mengembalikan commitnya, dan gateway direstart lagi supaya cache permission bersih.

**Risks**: risiko terbesar adalah cache permission gateway yang masih memegang daftar permission lama setelah migrasi selesai, sehingga sesi yang sedang berjalan mendapat 403 di seluruh observability sampai cachenya kedaluwarsa. Itulah alasan restart gateway ditulis sebagai langkah eksplisit dalam fase 1, bukan diasumsikan. Risiko kedua adalah migrasi turun yang ditulis asal, yang akan menghapus permission baru lebih dulu dan ikut membuang grant sebelum sempat dikembalikan; skenario test migrasi di atas ada khusus untuk menangkap ini.

## Build plan

Diiris mengikuti Tracer Bullet, yaitu benang tipis yang menembus seluruh lapisan lebih dulu, lalu ditebalkan. Irisan pertama sengaja membawa seluruh cutover permission meskipun hanya satu halaman yang dibangun ulang, karena cutover itu memang tidak bisa dibelah.

1. **Benang tipis, cutover permission plus Traces dari database sampai layar.** Migrasi `0038` dengan urutan salin lalu hapus dan file turunnya; konstanta, deskripsi, dan katalog di `packages/acl` beserta unit testnya; pemindahan gerbang kedelapan endpoint di `apps/gateway/erp/src/routes/proxy.route.ts`; pemetaan per path menggantikan pemetaan prefix di `apps/services/logs/src/app.ts`; `prevCursor` dan blok `options` untuk traces di `observability.schema.ts`, `observability.repository.ts`, dan `observability.service.ts`; `anyPermissionGuard` baru di `apps/web/src/app/auth/auth.guard.ts`; halaman `apps/web/src/app/pages/observability/traces/traces.page.ts` di atas kerangka halaman logs lengkap dengan filter, state URL, dan footer cursor; grup navigasi datar dengan item Traces; regenerasi OpenAPI dan klien. `/observability` sementara mengarahkan ke `/observability/traces`. Memenuhi **AC-1**, **AC-2**, **AC-4**, **AC-7** sebagian, **AC-8** sebagian, **AC-9** sebagian, **AC-10** sebagian, **AC-11**, **AC-12**, **AC-13** sebagian, **AC-17** sebagian, **AC-18**.
2. **Empat halaman daftar sisanya.** Migrasi `0039` untuk index cursor baseline; `prevCursor` dan `options` untuk benchmarks dan alerts, `cursor` penuh plus `options` untuk baselines, `options` untuk metrics; halaman Metrics, Benchmarks, Baselines, dan Alerts di atas kerangka yang sama; item navigasinya; regenerasi klien. Memenuhi **AC-3**, **AC-5**, **AC-6**, dan melengkapi **AC-8**, **AC-9**, **AC-10**, **AC-13**, **AC-17**.
3. **Tiga route detail.** Waterfall di `/observability/traces/:traceId` dengan kedalaman dari `parentSpanId`, penanganan span orphan, dan penanda trace tidak lengkap; detail run di `/observability/benchmarks/:runId`; detail rule di `/observability/alerts/:ruleId` dengan `seriesFingerprint` opsional. Melengkapi **AC-7**, memenuhi **AC-14**.
4. **Overview dan grafik metric.** Halaman Overview di `/observability` dengan empat kartu yang digerbangi permission per kartu dan aturan angka diikuti tanda tambah; `/observability` berhenti mengarahkan; grafik garis di halaman Metrics memakai `@ojiepermana/angular/chart/line` dengan garis terputus dan pita abu abu untuk ember yang hilang. Memenuhi **AC-15**, **AC-16**.
5. **Pembersihan dan bukti.** `observability.page.ts` dan testnya dihapus, assertion yang masih relevan dipindahkan; `e2e/observability.spec.ts` diperluas menutup kesembilan route; sapuan AXE atas kesembilan halaman termasuk padanan teks untuk waterfall dan grafik; `bun run progress:generate` dan `bun run progress:check` dijalankan. Memenuhi **AC-19**, **AC-20**.

## Consequences

**Positif**:

- Setiap sinyal punya alamat, sehingga bisa ditandai, bisa ditempel ke rekan kerja, dan tombol back peramban berarti sesuatu.
- Akses mengikuti pekerjaan. Seseorang bisa diberi alert tanpa ikut membuka seluruh evidence benchmark.
- Biaya per kunjungan turun jauh. Halaman lama selalu menembak empat endpoint sekaligus lewat `forkJoin`; halaman baru hanya memanggil endpointnya sendiri.
- Satu kerangka halaman untuk seluruh aplikasi. Perbaikan pada kerangka logs kelak ikut menyentuh observability tanpa pekerjaan tambahan.
- `prevCursor` menutup celah yang ada sejak 0014, dan menutupnya di API sehingga siapa pun yang memakai endpoint itu ikut menikmati, bukan hanya halaman web.

**Negatif dan tradeoff**:

- Cutover permission tidak bisa dibatalkan dengan mengembalikan satu commit. Butuh migrasi turun yang benar dan restart gateway yang eksplisit, dan salah urutan di file turun akan membuang grant.
- Footer tidak akan pernah sama persis dengan footer logs. Tidak ada nomor halaman, tidak ada tombol First dan Last, dan tidak ada jumlah total baris. Ini konsekuensi sadar dari mempertahankan cursor.
- Enam komponen menggantikan satu, jadi kerangka header filter footer terduplikasi enam kali. Kalau duplikasinya kelak terasa mahal, jawabannya adalah komponen kerangka bersama, dan itu keputusan tersendiri.
- `observability.repository.ts` yang sudah 875 baris bertambah lagi oleh keyset dua arah dan query `SELECT DISTINCT` untuk `options`.
- Blok `options` menambah satu query per request di setiap halaman daftar. Biayanya terikat jendela filter dan statement timeout, tapi tetap biaya baru yang sebelumnya tidak ada.
- Grup Observability jadi grup terpanjang di navigasi dengan enam item datar, karena bentuk `collapsible` tidak dipilih.

**Netral**:

- Nomor migrasi `0038` dan `0039` mengasumsikan `0037_access_groups` dari spec [0015](../0015-permission-group-template/index.md) tetap di tempatnya. File `0037` sudah ada di disk meskipun fiturnya belum dibangun, jadi nomor itu memang sudah terpakai.
- Grant `admin@local.app` tidak butuh penanganan khusus. Seed `0004_access.bootstrap_grants.sql` memberi email di `ACCESS_BOOTSTRAP_ADMIN_EMAILS` seluruh isi tabel permission lewat `CROSS JOIN`, jadi keempat permission baru ikut terbawa saat seed dijalankan ulang, dan penyalinan grant di migrasi `0038` menutupi database yang sudah berjalan tanpa seed ulang.
- Grafik garis adalah pola baru di aplikasi ini. `@ojiepermana/angular/chart/line` tersedia lewat umbrella yang sudah terpasang, jadi tidak ada dependensi baru, tapi tetap permukaan yang belum pernah dipakai di repo ini.

## Follow-up

- [ ] Endpoint `/api/v1/observability/benchmarks/runs` diurutkan `created_at DESC` secara global, sedangkan index yang ada dipimpin `scenario_id`, jadi daftar tanpa filter skenario tidak terlayani index. `prevCursor` menambah beban di jalur yang sama. Ukur dulu di data nyata, lalu putuskan apakah index pendukung `(created_at DESC, run_id)` perlu ditambahkan.
- [ ] Kerangka header filter footer terduplikasi di enam halaman observability dan tiga halaman logs. Kalau halaman berikutnya menambah duplikasi lagi, pertimbangkan komponen kerangka daftar bersama sebagai keputusan tersendiri.
- [ ] Grafik deret waktu di halaman Metrics sengaja dibatasi satu garis per nilai `group`. Kalau kelak dibutuhkan perbandingan lintas metric atau lintas rentang waktu, itu fitur tersendiri yang layak specnya sendiri.
- [ ] Spec [0014](../0014-bun-observability-benchmarking/index.md) menyebut satu permission dan satu halaman operator di beberapa tempat. Setelah fitur ini selesai, jalankan `/sync` supaya bagian yang sudah tidak benar di 0014 ditandai stale, bukan dibiarkan menyesatkan pembaca berikutnya.

## Rationale

Alasan lengkap, opsi yang ditimbang, dan catatan premis ada di [rationale.md](rationale.md).
