# Stage 1: Build
FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS builder

WORKDIR /app

# Install the repository-pinned package manager.
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

# Install build dependencies
RUN apk add --no-cache python3 build-base chromium

# Set Python environment
ENV PYTHON=/usr/bin/python3

# Copy package files for dependency installation
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml lerna.json ./
COPY --chown=node:node scripts/prepare.mjs ./scripts/prepare.mjs
COPY --chown=node:node packages/server/package.json ./packages/server/
COPY --chown=node:node shared ./shared

# Install all dependencies (including devDependencies for build)
RUN HUSKY=0 pnpm install --frozen-lockfile --network-concurrency=8 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=60000

# Copy source code
COPY --chown=node:node ./packages/server ./packages/server

# Build NestJS application
RUN pnpm run build:server --skip-nx-cache

# Stage 2: Production
FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS production

WORKDIR /app

# Install the repository-pinned package manager.
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install build dependencies for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 build-base

# Set Python environment
ENV PYTHON=/usr/bin/python3

# Copy package files for production dependency installation
COPY --chown=nodejs:nodejs package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=nodejs:nodejs scripts/prepare.mjs ./scripts/prepare.mjs
COPY --chown=nodejs:nodejs packages/server/package.json ./packages/server/
COPY --chown=nodejs:nodejs shared ./shared

# Install only production dependencies
RUN HUSKY=0 pnpm install --prod --frozen-lockfile --network-concurrency=8 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=60000 && \
    # Remove build dependencies to reduce image size
    apk del python3 build-base

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/packages/server/dist ./packages/server/dist

# Copy static assets (i18n, public, static directories)
COPY --from=builder --chown=nodejs:nodejs /app/packages/server/src/i18n ./packages/server/dist/i18n
COPY --from=builder --chown=nodejs:nodejs /app/packages/server/public ./packages/server/public
COPY --from=builder --chown=nodejs:nodejs /app/packages/server/static ./packages/server/static

# Copy database migration files (needed for running migrations)
COPY --from=builder --chown=nodejs:nodejs /app/packages/server/src/database ./packages/server/src/database

# Copy all shared packages from builder so newly added shared packages are included automatically
COPY --from=builder --chown=nodejs:nodejs /app/shared ./shared

# Set runtime environment variables (these should be provided at runtime via docker-compose or k8s)
ENV NODE_ENV=production
ENV NEW_RELIC_NO_CONFIG_FILE=true
ENV PORT=3000

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check - uses /api/system_db ping endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/system_db', (r) => {process.exit(r.statusCode >= 200 && r.statusCode < 300 ? 0 : 1)}).on('error', () => process.exit(1))"

# Start the application
CMD [ "node", "packages/server/dist/main.js" ]
