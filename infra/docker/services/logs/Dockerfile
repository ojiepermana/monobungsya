FROM oven/bun:1.4.0 AS build

WORKDIR /workspace

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/logs ./apps/services/logs

RUN bun install --frozen-lockfile --production

RUN bun build apps/services/logs/src/main.ts --outfile dist/logs/main.js --target=bun --minify

FROM oven/bun:1.4.0-slim

WORKDIR /app

COPY --from=build /workspace/dist/logs/main.js ./main.js

ENV NODE_ENV=production PORT=3103

USER bun

EXPOSE 3103

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["bun", "-e", "fetch('http://127.0.0.1:3103/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "main.js"]
