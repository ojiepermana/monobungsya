FROM oven/bun:1

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/services/payroll ./apps/services/payroll
RUN bun install --frozen-lockfile --production

WORKDIR /workspace/apps/services/payroll
EXPOSE 3104
CMD ["bun", "run", "src/main.ts"]
