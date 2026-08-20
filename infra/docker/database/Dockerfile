FROM oven/bun:1.3.14 AS build

WORKDIR /workspace

COPY packages/database ./packages/database

RUN mkdir -p /artifact \
  && cp -R packages/database/src /artifact/src \
  && cp -R packages/database/migrations /artifact/migrations \
  && cp -R packages/database/seeds /artifact/seeds

FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY --from=build /artifact/src ./src
COPY --from=build /artifact/migrations ./migrations
COPY --from=build /artifact/seeds ./seeds

ENV NODE_ENV=production \
  DATABASE_MIGRATIONS_DIR=/app/migrations \
  DATABASE_SEEDS_DIR=/app/seeds

USER bun

ENTRYPOINT ["bun", "run", "src/cli.ts"]
