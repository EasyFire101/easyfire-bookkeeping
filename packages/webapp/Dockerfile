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
COPY --chown=node:node packages/webapp/package.json ./packages/webapp/
COPY --chown=node:node shared ./shared

# Install all dependencies (including devDependencies for build)
RUN HUSKY=0 pnpm install --frozen-lockfile --network-concurrency=8 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=60000

# Copy source code for webapp and dependencies
COPY --chown=node:node ./packages/webapp ./packages/webapp

# Build webapp package
RUN pnpm run build:webapp

# Stage 2: Nginx
FROM nginx:1.30.4-alpine3.24@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46

# Copy nginx configuration
COPY --chown=root:root ./packages/webapp/nginx/sites/default.conf /etc/nginx/conf.d/default.conf

# Copy built webapp assets from builder stage
COPY --from=builder --chown=nginx:nginx /app/packages/webapp/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

# Nginx runs as nginx user by default, which is good for security
# No CMD needed as nginx base image already has it
