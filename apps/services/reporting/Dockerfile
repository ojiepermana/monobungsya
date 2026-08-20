FROM oven/bun:1

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/reporting ./apps/services/reporting
RUN bun install --frozen-lockfile --production

WORKDIR /workspace/apps/services/reporting
EXPOSE 3105
CMD ["bun", "run", "src/main.ts"]
