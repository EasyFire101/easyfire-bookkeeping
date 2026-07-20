FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
RUN apk add --no-cache python3 build-base
ENV PYTHON=/usr/bin/python3

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml lerna.json ./
COPY --chown=node:node scripts/prepare.mjs ./scripts/prepare.mjs
COPY --chown=node:node packages/server/package.json ./packages/server/
COPY --chown=node:node shared ./shared

RUN HUSKY=0 pnpm install --frozen-lockfile --network-concurrency=8 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=60000

COPY --chown=node:node ./packages/server ./packages/server

RUN pnpm run build:server --skip-nx-cache

FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN apk add --no-cache python3 build-base bash wget
ENV PYTHON=/usr/bin/python3

COPY --chown=nodejs:nodejs package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=nodejs:nodejs scripts/prepare.mjs ./scripts/prepare.mjs
COPY --chown=nodejs:nodejs packages/server/package.json ./packages/server/
COPY --chown=nodejs:nodejs shared ./shared
RUN HUSKY=0 pnpm install --prod --frozen-lockfile --network-concurrency=8 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=60000 && apk del python3 build-base

COPY --from=builder --chown=nodejs:nodejs /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/server/src/database ./packages/server/src/database
COPY --from=builder --chown=nodejs:nodejs /app/shared ./shared

ARG WAIT_FOR_IT_COMMIT=81b1373f17855a4dc21156cfe1694c31d7d1792e
ARG WAIT_FOR_IT_SHA256=b7a04f38de1e51e7455ecf63151c8c7e405bd2d45a2d4e16f6419db737a125d6
RUN wget -q -O wait-for-it.sh "https://raw.githubusercontent.com/vishnubob/wait-for-it/${WAIT_FOR_IT_COMMIT}/wait-for-it.sh" && \
    echo "${WAIT_FOR_IT_SHA256}  wait-for-it.sh" | sha256sum -c - && \
    chmod +x wait-for-it.sh

ENV NODE_ENV=production
ENV NEW_RELIC_NO_CONFIG_FILE=true

WORKDIR /app/packages/server

USER nodejs

CMD ["/app/wait-for-it.sh", "mysql:3306", "--strict", "--timeout=60", "--", "sh", "-c", "node dist/cli.js system:migrate:latest && node dist/cli.js tenants:migrate:latest"]
