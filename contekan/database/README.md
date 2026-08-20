# Database tooling reference

The canonical database runner now lives in `packages/database`.

Use the root commands from the repository directory:

```bash
bun run db:migrate
bun run db:seed
bun run db:reset --confirm --seed
```

Migration and seed source files belong in `packages/database/migrations` and
`packages/database/seeds`. This folder remains only as a pointer for the
original database examples and must not contain a second runnable implementation.
