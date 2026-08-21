FROM oven/bun:1.4.0 AS build

WORKDIR /workspace

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/gateway/erp ./apps/gateway/erp

RUN bun install --frozen-lockfile --production

RUN bun build apps/gateway/erp/src/main.ts --outfile dist/gateway/main.js --target=bun --minify

FROM oven/bun:1.4.0-slim

WORKDIR /app

COPY --from=build /workspace/dist/gateway/main.js ./main.js

ENV NODE_ENV=production PORT=3000

USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "main.js"]