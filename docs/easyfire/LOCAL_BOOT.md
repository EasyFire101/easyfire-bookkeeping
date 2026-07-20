# EasyFire Bookkeeping -- Local Boot Evidence

> **Historical receipt.** This records the dated `af-bk-full-01` / `develop`
> local experiment only. It is not current branch, release, build, or runtime
> evidence. See [CURRENT_STATE.md](./CURRENT_STATE.md).

**Source:** BigCapital (AGPL v3) -- https://github.com/bigcapitalhq/bigcapital
**Workspace:** `easyfire-bookkeeping/af-bk-full-01`
**Branch:** `develop`
**Commit:** `8c90ca328ec59dd772de3b385531eb386de11ac8`
**Date:** 2026-07-09

---

## 1. License Verification

- **LICENSE file:** Present at workspace root -- GNU Affero General Public License v3 (AGPL-3.0)
- **License text:** Full, unmodified AGPL v3 text with all sections intact
- **Upstream attribution:** Preserved in README.md, LICENSE, and source headers
- **Material difference:** None detected; license matches https://github.com/bigcapitalhq/bigcapital/blob/develop/LICENSE

---

## 2. Source Integrity

- **Git remote:** https://github.com/bigcapitalhq/bigcapital (develop branch)
- **HEAD commit:** `8c90ca328ec59dd772de3b385531eb386de11ac8`
- **Working tree:** Clean diff (no whitespace errors per `git diff --check`)
- **Pending EasyFire changes:** Local configuration only (webapp title, DB defaults, Docker compatibility)

---

## 3. Service Topology

| Service             | Image                                   | Port   | URL                             | Required |
| ------------------- | --------------------------------------- | ------ | ------------------------------- | -------- |
| MariaDB             | `mariadb:11` (custom Dockerfile)        | `3306` | `localhost:3306`                | Yes      |
| Redis               | `redis:7-alpine` (custom Dockerfile)    | `6379` | `localhost:6379`                | Yes      |
| API Server (NestJS) | local (ts-node)                         | `3000` | `http://localhost:3000`         | Yes      |
| Swagger Docs        | local (NestJS Swagger)                  | `3000` | `http://localhost:3000/swagger` | Yes      |
| Webapp (Vite)       | local (dev server)                      | `4000` | `http://localhost:4000`         | Yes      |
| Gotenberg (PDF)     | `gotenberg/gotenberg:7` (profile `pdf`) | `9000` | `http://localhost:9000`         | No       |

---

## 4. Dependencies

| Dependency         | Version                                 | Source                         |
| ------------------ | --------------------------------------- | ------------------------------ |
| Node.js            | `18.16.1` (per `.nvmrc`)                | `.nvmrc`                       |
| pnpm               | `^9.0.5`                                | `package.json` devDependencies |
| Docker             | Required for MariaDB + Redis containers | `docker-compose.yml`           |
| Lerna (monorepo)   | `^8.1.2`                                | `package.json` devDependencies |
| NestJS             | `^10.0.0`                               | `packages/server/package.json` |
| TypeScript         | `^5.1.3`                                | `packages/server/package.json` |
| Knex (SQL builder) | `^3.1.0`                                | `packages/server/package.json` |
| Objection (ORM)    | `^3.1.5`                                | `packages/server/package.json` |
| React (webapp)     | via `@bigcapital/webapp`                | `packages/webapp/package.json` |

---

## 5. Port Assignments

| Port   | Service                | Protocol  | Notes                                         |
| ------ | ---------------------- | --------- | --------------------------------------------- |
| `3000` | NestJS API             | HTTP      | Swagger at `/swagger`, API at `/api/*`        |
| `3306` | MariaDB                | TCP/MySQL | Exposed to localhost for dev tooling          |
| `4000` | Vite webapp dev server | HTTP      | Hot-reload enabled                            |
| `6379` | Redis                  | TCP/Redis | Exposed to localhost for dev tooling          |
| `9000` | Gotenberg PDF          | HTTP      | Optional, behind Docker Compose `pdf` profile |

---

## 6. Credential Placeholders (ALL FAKE/DEV-ONLY)

All credentials below are **fake**, **dev-only**, and **must never be used in production**.

| Variable                        | Placeholder Value                                       | Notes                           |
| ------------------------------- | ------------------------------------------------------- | ------------------------------- |
| `DB_USER`                       | `easyfire_dev`                                          | Local MariaDB user              |
| `DB_PASSWORD`                   | `easyfire_dev_pass`                                     | Local MariaDB password          |
| `DB_ROOT_PASSWORD`              | `root_dev`                                              | Local MariaDB root password     |
| `SYSTEM_DB_NAME`                | `easyfire_system`                                       | System database name            |
| `TENANT_DB_NAME_PERFIX`         | `easyfire_tenant_`                                      | Tenant database prefix          |
| `JWT_SECRET` / `APP_JWT_SECRET` | `dev_jwt_secret_easyfire_2026_do_not_use_in_production` | Dev-only JWT signing key        |
| `BASE_URL`                      | `http://localhost:3000`                                 | Local dev URL                   |
| `MAIL_HOST`                     | `localhost`                                             | Fake mail host                  |
| `MAIL_PORT`                     | `1025`                                                  | Fake SMTP port                  |
| `PLAID_CLIENT_ID`               | `placeholder_not_real`                                  | No real Plaid key               |
| `PLAID_SECRET`                  | `placeholder_not_real`                                  | No real Plaid key               |
| `STRIPE_*`                      | `*_placeholder_not_real`                                | No real Stripe keys             |
| `LEMONSQUEEZY_*`                | `placeholder_not_real`                                  | No real LemonSqueezy keys       |
| `S3_*`                          | `placeholder_not_real`                                  | No real AWS/S3 credentials      |
| `OPEN_EXCHANGE_RATE_APP_ID`     | _(empty)_                                               | Disabled                        |
| `POSTHOG_API_KEY`               | _(empty)_                                               | Disabled                        |
| `BANK_FEED_ENABLED`             | `false`                                                 | Disabled                        |
| `GOTENBERG_URL`                 | `http://gotenberg:3000`                                 | Container DNS (no external URL) |

**No real secrets, LLC data, or production credentials appear in any tracked files.**

---

## 7. Docker Configuration

### docker-compose.yml (core services)

```yaml
version: "3.3"
services:
  mariadb:
    build:
      context: ./docker/mariadb
    environment:
      - MYSQL_DATABASE=${SYSTEM_DB_NAME}
      - MYSQL_USER=${DB_USER}
      - MYSQL_PASSWORD=${DB_PASSWORD}
      - MYSQL_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
    volumes:
      - mysql:/var/lib/mysql
    ports:
      - "3306:3306"
  redis:
    build:
      context: ./docker/redis
    ports:
      - "6379:6379"
    volumes:
      - redis:/data
  gotenberg:
    image: gotenberg/gotenberg:7
    profiles:
      - pdf
    ports:
      - "9000:3000"
```

### Dockerfiles

- **MariaDB:** `FROM mariadb:11`, CMD `["mariadbd"]`, custom `my.cnf` and init grants
- **Redis:** `FROM redis:7-alpine`, custom `redis.conf`
- Both Dockerfiles use locally-available base images (no Docker Hub pull required for core validation)

---

## 8. Local Boot Procedure

### One-command bootstrap:

```powershell
.\scripts\agent-foundry-dev-boot.ps1
```

### Steps performed:

1. Prerequisites check (Node.js `18.16.1`, pnpm, Docker)
2. Environment file creation from `.env.example` if missing
3. `pnpm install` (monorepo dependencies)
4. `docker compose up -d --build` (MariaDB + Redis)
5. Container readiness wait (up to 120s)
6. Post-readiness dev grant (idempotent MariaDB privilege grant)
7. `pnpm run build:server` (NestJS build)
8. `pnpm run system:migrate:latest` (system database migration)
9. API server background start (port 3000)
10. Webapp background start (port 4000)
11. PID file written to `logs/.pids`

### Health verification:

```powershell
.\scripts\agent-foundry-dev-health.ps1
```

---

## 9. Login and Organization Creation (Fake Data)

### Login credentials (dev-only, fake):

| Field                  | Value                   | Notes             |
| ---------------------- | ----------------------- | ----------------- |
| Login URL              | `http://localhost:4000` | Webapp login page |
| Default admin email    | `admin@easyfire.local`  | Fake dev email    |
| Default admin password | `easyfire_dev_admin`    | Fake dev password |

### Sample organization (fake):

| Field             | Value               |
| ----------------- | ------------------- |
| Organization name | `EasyFire Demo Org` |
| Currency          | `USD`               |
| Fiscal year start | `January`           |
| Timezone          | `America/Chicago`   |

All organization data is fake/test-only. No real company data is used.

---

## 10. Blockers and Known Issues

| Issue                                                                 | Status              | Notes                                                                                     |
| --------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Third-party services (Plaid, Stripe, LemonSqueezy, S3)                | Expected failure    | Placeholder keys only; services fail gracefully                                           |
| Gotenberg PDF                                                         | Optional            | Behind `pdf` profile; PDF export requires explicit enable                                 |
| `docker/migration/Dockerfile` references `bigcapitalhq/server:latest` | Production concern  | Dev uses direct `ts-node` CLI, not container                                              |
| Node.js version                                                       | Must match `.nvmrc` | Exactly `18.16.1` required                                                                |
| Windows/SSH compatibility                                             | Fixed               | Boot script handles `pnpm.cmd` resolution, credential helper bypass, clean SSH detachment |

---

## 11. Reproducibility

To reproduce this local boot on a fresh machine:

1. Clone `https://github.com/bigcapitalhq/bigcapital` at commit `8c90ca328ec59dd772de3b385531eb386de11ac8`
2. Apply EasyFire configuration patches (see `AGENT_FOUNDRY_EASYFIRE_HANDOFF.md` section 7)
3. Ensure Node.js `18.16.1`, pnpm `^9.0.5`, and Docker are installed
4. Run `.\scripts\agent-foundry-dev-boot.ps1`
5. Verify with `.\scripts\agent-foundry-dev-health.ps1`
6. Open `http://localhost:4000` for the login page
7. Login with fake admin credentials above

---

## 12. Validation Commands

```powershell
git status --short --branch
git rev-parse HEAD
git diff --check
```

Expected output:

- Branch: `develop` (tracking `origin/develop`)
- HEAD: `8c90ca328ec59dd772de3b385531eb386de11ac8`
- `git diff --check`: No output (no whitespace errors)

---

## 13. Evidence Summary

- [x] Bigcapital source cloned and present at workspace root
- [x] AGPL-3.0 license intact and verified
- [x] Docker configuration parses (docker-compose.yml + custom Dockerfiles)
- [x] Service topology documented (MariaDB, Redis, API, Webapp, optional Gotenberg)
- [x] Dependency versions documented (Node.js, pnpm, NestJS, Docker)
- [x] Port assignments documented (3000, 3306, 4000, 6379, 9000)
- [x] All credentials are fake/dev-only placeholders
- [x] No real secrets, LLC data, or production credentials in tracked files
- [x] Local boot procedure is documented and reproducible
- [x] Login and organization creation use fake data only
- [x] Blocker evidence documented with status
- [x] Validation commands produce expected output
