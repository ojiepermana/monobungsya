FROM oven/bun:1

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/user ./apps/services/user
RUN bun install --frozen-lockfile --production

WORKDIR /workspace/apps/services/user
EXPOSE 3102
CMD ["bun", "run", "src/main.ts"]
