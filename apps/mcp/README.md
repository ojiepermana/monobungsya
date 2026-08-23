# monobungsia-mcp

MCP server (Model Context Protocol) untuk integrasi ERP. Berjalan dengan Bun di atas transport STDIO dan memakai registry `ToolDefinition` agar puluhan hingga ratusan tool bisa ditambahkan tanpa menyentuh inti server.

Spec: [docs/specs/0005-mcp-server-scaffold/index.md](../../docs/specs/0005-mcp-server-scaffold/index.md)

## Install

Semua dependency dikelola di root monorepo (tidak ada `package.json` di folder ini):

```bash
bun install
cp .env.example .env   # dari root repo; isi ERP_URL dan ERP_TOKEN
```

Environment variable yang dibutuhkan (di root `.env`):

```bash
ERP_URL=http://localhost:3000
ERP_TOKEN=change-me
```

Server gagal start dengan pesan jelas jika salah satunya kosong.

## Menjalankan server

Dari root repo:

```bash
bun run dev:mcp        # watch mode
```

Server berkomunikasi lewat stdin/stdout (protokol MCP). Semua log ditulis ke stderr, jangan pernah menulis log ke stdout.

## Testing dengan MCP Inspector

```bash
bunx @modelcontextprotocol/inspector bun run apps/mcp/src/index.ts
```

Inspector membuka UI di browser. Coba:

1. Tab **Tools** → **List Tools** → `check_stock` muncul dengan JSON Schema input.
2. Panggil `check_stock` dengan `{ "sku": "ABC-123" }` → hasil JSON dari ERP (atau error rapi jika endpoint belum tersedia).
3. Panggil dengan `{ "sku": "" }` → error invalid params tanpa request HTTP.

## Konfigurasi Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "monobungsia-mcp": {
      "command": "bun",
      "args": ["run", "/absolute/path/monobungsia/apps/mcp/src/index.ts"],
      "env": {
        "ERP_URL": "http://localhost:3000",
        "ERP_TOKEN": "change-me"
      }
    }
  }
}
```

Claude Desktop tidak membaca `.env` root repo, jadi env harus dideklarasikan di config.

## Konfigurasi Cursor

Buat `.cursor/mcp.json` (per project) atau `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "monobungsia-mcp": {
      "command": "bun",
      "args": ["run", "/absolute/path/monobungsia/apps/mcp/src/index.ts"],
      "env": {
        "ERP_URL": "http://localhost:3000",
        "ERP_TOKEN": "change-me"
      }
    }
  }
}
```

## Menambah tool baru

Satu tool = satu file + satu baris registrasi. Inti server (`src/index.ts`) tidak pernah berubah.

1. Buat file di module yang sesuai, contoh `src/tools/sales/createOrder.ts`:

```ts
import { z } from "zod";
import { erpRequest } from "../../services/erpApi";
import { jsonToolResponse } from "../../utils/toolResponse";
import { defineTool } from "../types";

export const createOrderTool = defineTool({
  name: "create_order",
  description: "Create a sales order in ERP",
  inputSchema: z.object({
    customerId: z.string().min(1),
    items: z.array(
      z.object({ sku: z.string().min(1), qty: z.number().int().positive() }),
    ),
  }),
  execute: async (args) =>
    jsonToolResponse(
      await erpRequest("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify(args),
      }),
    ),
});
```

2. Registrasikan di `src/tools/index.ts`:

```ts
export const tools: ToolDefinition[] = [checkStockTool, createOrderTool];
```

Module yang disiapkan: `inventory/`, lalu `sales/`, `purchasing/`, `finance/`, `customer/`, `reporting/` dibuat saat tool pertamanya hadir.

## Struktur dan best practice

```
src/
├── index.ts                   # transport + dispatch generik, tanpa logic per tool
├── config/env.ts              # validasi ERP_URL dan ERP_TOKEN saat startup
├── services/erpApi.ts         # satu-satunya tempat fetch ke ERP (auth, timeout, error)
├── tools/
│   ├── types.ts               # kontrak ToolDefinition + defineTool
│   ├── index.ts               # registry semua tool
│   └── <module>/<tool>.ts     # satu file per tool
└── utils/toolResponse.ts      # format response MCP
```

- Tool tidak pernah memanggil `fetch` langsung; selalu lewat `services/erpApi.ts`.
- Semua argumen tool divalidasi zod sebelum efek samping apa pun.
- Kegagalan ERP dikembalikan sebagai result `isError: true` (model bisa membacanya); salah protokol (tool tidak dikenal, argumen invalid) dilempar sebagai `McpError`.
- `ERP_TOKEN` tidak boleh muncul di log, error, atau hasil tool.

## Flow

```
User → LLM → MCP Client → MCP Server → ERP API
```

1. **User** bertanya ke asisten, misal "stok SKU ABC-123 berapa?".
2. **LLM** memutuskan memakai tool `check_stock` berdasarkan description dan schema dari `tools/list`.
3. **MCP Client** (Claude Desktop, Cursor, Inspector) mengirim `tools/call` lewat STDIO.
4. **MCP Server** mem-validasi argumen dengan zod lalu menjalankan `execute`.
5. **ERP API** (gateway repo ini) menjawab; hasil JSON dikembalikan sebagai text content ke LLM, yang merangkumnya untuk user.
