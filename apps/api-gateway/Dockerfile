FROM oven/bun:1

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/api-gateway ./apps/api-gateway
RUN bun install --frozen-lockfile --production

WORKDIR /workspace/apps/api-gateway
EXPOSE 3000
CMD ["bun", "run", "src/main.ts"]
