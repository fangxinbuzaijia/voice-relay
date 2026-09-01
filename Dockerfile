# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm build \
    && pnpm --filter @voice-relay/server deploy --prod --legacy /prod/server \
    && mkdir -p /prod/server/dist \
    && cp -R apps/server/dist/. /prod/server/dist/ \
    && rm -rf /prod/server/node_modules/@voice-relay/protocol \
    && mkdir -p /prod/server/node_modules/@voice-relay/protocol/dist \
    && cp packages/protocol/package.json /prod/server/node_modules/@voice-relay/protocol/package.json \
    && cp -R packages/protocol/dist/. /prod/server/node_modules/@voice-relay/protocol/dist/

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/voice-relay.db \
    WEB_ROOT=/app/apps/web/dist
COPY --from=build /prod/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
