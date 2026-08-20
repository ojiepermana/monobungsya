FROM oven/bun:1

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/auth ./apps/services/auth
RUN bun install --frozen-lockfile --production

WORKDIR /workspace/apps/services/auth
EXPOSE 3101
CMD ["bun", "run", "src/main.ts"]
