FROM oven/bun:1.3.14 AS build

WORKDIR /workspace

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN bun install --frozen-lockfile

ARG WEB_API_URL
ENV WEB_API_URL=${WEB_API_URL}

RUN test -n "$WEB_API_URL" && bun -e 'const value = Bun.env.WEB_API_URL; try { new URL(value); } catch { throw new Error("WEB_API_URL must be a valid absolute URL"); } if (value.includes("localhost")) throw new Error("WEB_API_URL must not point to localhost in a production image"); await Bun.write("apps/web/src/app/runtime-config.ts", `export const WEB_API_URL = ${JSON.stringify(value)};\n`);'

FROM node:24.15.0-bookworm-slim AS angular-build

WORKDIR /workspace

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/apps/web ./apps/web

RUN cd apps/web && ../../node_modules/.bin/ng build --configuration production

FROM nginxinc/nginx-unprivileged:alpine

COPY infra/docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=angular-build /workspace/dist/web/browser /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget --spider --quiet http://127.0.0.1:8080/ || exit 1

USER nginx

CMD ["nginx", "-g", "daemon off;"]