FROM oven/bun:1.3.14 AS build

WORKDIR /workspace

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/reporting ./apps/services/reporting

RUN bun install --frozen-lockfile --production

RUN bun build apps/services/reporting/src/main.ts --outfile dist/reporting/main.js --target=bun --minify

FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY --from=build /workspace/dist/reporting/main.js ./main.js

ENV NODE_ENV=production PORT=3105

USER bun

EXPOSE 3105

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["bun", "-e", "fetch('http://127.0.0.1:3105/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "main.js"]