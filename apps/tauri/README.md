# Monobungsia Desktop

The desktop app is a Tauri shell around the Angular app in `apps/web`. It uses
the root Bun workspace and does not have its own `package.json`.

## Development

From the repository root:

```bash
bun install
bun run dev:tauri
```

`dev:tauri` starts the Angular development server and opens the Tauri window at
`http://localhost:4200`.

## Build and checks

```bash
bun run typecheck:tauri
bun run build:tauri
```

The production build uses the Angular output at `dist/web/browser`.
