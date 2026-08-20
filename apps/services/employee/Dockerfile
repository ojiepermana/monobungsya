FROM oven/bun:1

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/employee ./apps/services/employee
RUN bun install --frozen-lockfile --production

WORKDIR /workspace/apps/services/employee
EXPOSE 3103
CMD ["bun", "run", "src/main.ts"]
