FROM oven/bun:1 AS build

WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN bun install --frozen-lockfile
RUN cd apps/web && ../../node_modules/.bin/ng build

FROM nginx:alpine
COPY --from=build /workspace/dist/web/browser /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
