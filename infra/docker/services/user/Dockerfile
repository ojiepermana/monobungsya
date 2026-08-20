FROM oven/bun:1.3.14 AS build

WORKDIR /workspace

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/user ./apps/services/user

RUN bun install --frozen-lockfile --production

RUN bun build apps/services/user/src/main.ts --outfile dist/user/main.js --target=bun --minify

FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY --from=build /workspace/dist/user/main.js ./main.js

ENV NODE_ENV=production PORT=3102

USER bun

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["bun", "-e", "fetch('http://127.0.0.1:3102/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "main.js"]