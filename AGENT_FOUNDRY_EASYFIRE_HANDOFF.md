# Agent Foundry -- EasyFire Bookkeeping Handoff

> **Historical Agent Foundry provenance only.** Agent Foundry is no longer the
> project owner or execution path; the project is under direct EasyFire/Codex
> ownership. At the time captured below, the source candidate had not been
> published, deployed, reconciled, or live-accepted. Do not use the commands,
> blockers, or authority claims below as current instructions. In particular,
> automated owner bootstrap is retired, production is fresh-install-only,
> existing MariaDB data requires a separate blue/green logical migration, and
> the Cloudflare edge is verify-only. Current state is maintained only in
> [HANDOFF.md](./HANDOFF.md),
> [PROJECT_PROFILE.json](./PROJECT_PROFILE.json), and
> [docs/easyfire/CURRENT_STATE.md](./docs/easyfire/CURRENT_STATE.md).

> **Direct-takeover snapshot (2026-07-19):** the frozen install and full
> application build are green. The repaired controller now binds exact
> four-file deployment and sealed installed bundles, built image IDs, a
> hash-journaled environment candidate, single-start bounded migration,
> partial-volume-preserving rollback, exact task/edge/port/foreign-consumer
> identity, and a fifth `ScheduledBackup` stage invoked from the sealed release
> through canonical Windows PowerShell. Backups publish crash-resumable metadata-backed
> recovery units and focused crash-window coverage has been added. None of this
> candidate is published, reconciled, deployed, or live-accepted yet;
> disposable Docker proof is not recorded. The first complete production
> dependency audit report showed 260 findings / 116 high inherited from
> upstream; later registry-call failures did not supersede it, so triage is
> still required. A fresh database has no supported first-owner login.

**Workspace:** `easyfire-bookkeeping/af-bk-full-01`
**Source:** BigCapital (AGPL v3) -- https://github.com/bigcapitalhq/bigcapital
**Adapter:** OpenCode CLI (DeepSeek)
**Date:** 2026-07-09

---

## 1. Local Ports

| Service             | Port | URL                           |
| ------------------- | ---- | ----------------------------- |
| API Server (NestJS) | 3000 | http://localhost:3000         |
| API Swagger Docs    | 3000 | http://localhost:3000/swagger |
| Webapp (Vite dev)   | 4000 | http://localhost:4000         |
| MariaDB             | 3306 | localhost:3306                |
| Redis               | 6379 | localhost:6379                |
| Gotenberg (PDF)     | 9000 | http://localhost:9000         |

---

## 2. Local Dev Bootstrap (executable)

The boot script **executes** all steps automatically -- it no longer just prints commands:

```powershell
.\scripts\agent-foundry-dev-boot.ps1
```

Steps performed:

1. **Prerequisites check** -- verify Node.js, pnpm, Docker are available and Docker daemon is running
2. **Environment file** -- creates `.env` from `.env.example` if missing (uses fake/dev defaults)
3. **`pnpm install`** -- installs all monorepo dependencies
4. **`docker compose up -d`** -- starts MariaDB and Redis containers (Gotenberg/PDF optional, enable via `--profile pdf`)
5. **Container readiness wait** -- polls MariaDB (`mariadb-admin ping`), Redis (`PING`) for up to 120s; Gotenberg not required for core readiness
6. **Post-readiness dev grant** -- idempotent grant step run inside MariaDB container using container env vars (no secret logging); ensures configured MYSQL_USER has dev privileges even if a prior boot initialized the volume before the custom grant script completed
7. **`pnpm run build:server`** -- builds the NestJS server and shared packages
8. **`pnpm run system:migrate:latest`** -- runs disposable system database migration (skipped gracefully if already current)
9. **API server background start** -- `pnpm run server:start` launched via `Start-Process -WindowStyle Hidden` with stdout/stderr redirected to `logs/api-*.log` and PID captured for unattended Agent Foundry runs
10. **Webapp background start** -- `pnpm run dev:webapp` launched via `Start-Process -WindowStyle Hidden` with stdout/stderr redirected to `logs/webapp-*.log` and PID captured for unattended Agent Foundry runs
11. **PID file written** -- `logs/.pids` records process IDs for health checks

### Boot abort conditions

- Missing prerequisites (Node.js, pnpm, Docker) -> exit 1 with blocker messages
- Failed `pnpm install` -> exit 1
- Container readiness timeout (120s) -> exit 1 with details on which service failed
- Failed `build:server` -> exit 1 (containers remain running for inspection)

---

## 3. Local Dev Health Check

```powershell
.\scripts\agent-foundry-dev-health.ps1
```

Checks performed:

- **Docker containers** -- verifies mariadb and redis are running via `docker compose ps` (gotenberg is optional)
- **MariaDB ping** -- credentialed `mariadb-admin ping` via `sh -lc` with container env vars (no secret logging)
- **Redis ping** -- `redis-cli PING` health check
- **Gotenberg** -- HTTP GET on port 9000 (warn only; optional PDF service)
- **API server** -- HTTP GET on `http://localhost:3000/swagger`
- **Webapp** -- HTTP GET on `http://localhost:4000` (warn only, not required)
- **Boot PID status** -- reads `logs/.pids`, verifies each process is still alive
- **Log files** -- reports available log files and sizes
- **Project files** -- verifies `.env`, `package.json`, `LICENSE` exist

Failures include actionable fix commands (e.g., `docker compose -f docker-compose.yml restart mariadb`, `pnpm run server:start`).

---

## 4. Logs and PIDs

All output is captured under `logs/` (gitignored):

| File                                  | Contents                                        |
| ------------------------------------- | ----------------------------------------------- |
| `logs/boot-YYYYMMDD-HHmmss.log`       | Full bootstrap timeline with all command output |
| `logs/api-YYYYMMDD-HHmmss.log`        | API server stdout                               |
| `logs/api-err-YYYYMMDD-HHmmss.log`    | API server stderr                               |
| `logs/webapp-YYYYMMDD-HHmmss.log`     | Webapp dev server stdout                        |
| `logs/webapp-err-YYYYMMDD-HHmmss.log` | Webapp dev server stderr                        |
| `logs/.pids`                          | `key=pid` file recording background process IDs |

---

## 5. Fake Credentials & Placeholders

All credentials are **fake/dev-only** and must NEVER be used in production:

| Variable                    | Value                                                   | Notes                     |
| --------------------------- | ------------------------------------------------------- | ------------------------- |
| `DB_USER`                   | `easyfire_dev`                                          | Local MariaDB user        |
| `DB_PASSWORD`               | `easyfire_dev_pass`                                     | Local MariaDB password    |
| `DB_ROOT_PASSWORD`          | `root_dev`                                              | Local MariaDB root        |
| `SYSTEM_DB_NAME`            | `easyfire_system`                                       | System database name      |
| `TENANT_DB_NAME_PERFIX`     | `easyfire_tenant_`                                      | Tenant DB prefix          |
| `JWT_SECRET`                | `dev_jwt_secret_easyfire_2026_do_not_use_in_production` | Dev-only                  |
| `BASE_URL`                  | `http://localhost:3000`                                 | Local dev URL             |
| `MAIL_HOST`                 | `localhost`                                             | Fake mail                 |
| `MAIL_PORT`                 | `1025`                                                  | Fake SMTP port            |
| `PLAID_CLIENT_ID`           | `placeholder_not_real`                                  | No real Plaid key         |
| `PLAID_SECRET`              | `placeholder_not_real`                                  | No real Plaid key         |
| `STRIPE_*`                  | `*_placeholder_not_real`                                | No real Stripe keys       |
| `LEMONSQUEEZY_*`            | `placeholder_not_real`                                  | No real LemonSqueezy keys |
| `S3_*`                      | `placeholder_not_real`                                  | No real S3 credentials    |
| `OPEN_EXCHANGE_RATE_APP_ID` | _(empty)_                                               | Disabled                  |
| `POSTHOG_API_KEY`           | _(empty)_                                               | Disabled                  |
| `BANK_FEED_ENABLED`         | `false`                                                 | Disabled                  |

---

## 6. AGPL v3 Obligations

- **LICENSE file preserved** at workspace root (AGPL v3)
- **Upstream attribution** maintained: https://github.com/bigcapitalhq/bigcapital
- All changes are reversible local configuration only
- No proprietary code added; workspace is a direct git clone
- **IMPORTANT**: If this is ever deployed beyond local dev, the full AGPL v3 source must be made available to all users

---

## 7. Files Changed (this workspace)

| File                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`                                                 | Created with fake/dev-only EasyFire configuration                                                                                                                                                                                                                                                                                                                                                          |
| `.gitignore`                                           | Added `logs/` entry for boot/health log exclusion                                                                                                                                                                                                                                                                                                                                                          |
| `scripts/agent-foundry-dev-boot.ps1`                   | Created -- executable bootstrap script (runs all steps)                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/agent-foundry-dev-health.ps1`                 | Created -- health check script with PID/process tracking                                                                                                                                                                                                                                                                                                                                                   |
| `packages/webapp/index.html`                           | Title/meta changed to "EasyFire Bookkeeping"                                                                                                                                                                                                                                                                                                                                                               |
| `packages/webapp/src/constants/app.tsx`                | `app_name` changed to "EasyFire Bookkeeping"                                                                                                                                                                                                                                                                                                                                                               |
| `packages/server/src/main.ts`                          | Swagger title changed to "EasyFire Bookkeeping"                                                                                                                                                                                                                                                                                                                                                            |
| `packages/server/src/common/config/system-database.ts` | Default port fixed: 5432 -> 3306                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/server/src/common/config/tenant-database.ts` | Default port fixed: 5432 -> 3306; default DB prefix: 'easyfire*tenant*'                                                                                                                                                                                                                                                                                                                                    |
| `docker/mariadb/Dockerfile`                            | Base image updated: `mariadb:10.2` -> `mariadb:11` (Newsec local compatibility); CMD changed: `["mysqld"]` -> `["mariadbd"]` for MariaDB 11 server binary                                                                                                                                                                                                                                                  |
| `docker/mariadb/docker-entrypoint.sh`                  | Changed `mysql` to `mariadb` for MariaDB 11 client compatibility (legacy `mysql` symlink absent in MariaDB 11 container)                                                                                                                                                                                                                                                                                   |
| `docker/redis/Dockerfile`                              | Base image updated: `redis:6.2.21` -> `redis:7-alpine` (Newsec local compatibility)                                                                                                                                                                                                                                                                                                                        |
| `docker-compose.yml`                                   | Gotenberg behind `pdf` profile (optional PDF service; no Docker Hub pull required for core)                                                                                                                                                                                                                                                                                                                |
| `scripts/agent-foundry-dev-boot.ps1`                   | Core readiness requires only mariadb + redis; Gotenberg is optional/warning; docker compose up now uses `--build` to rebuild images when Dockerfiles change. Added post-readiness dev grant step (idempotent, no secret logging). Changed `mysqladmin ping` to `mariadb-admin ping` for MariaDB 11. MariaDB readiness now uses credentialed ping via `sh -lc` with container env vars (no secret logging). |
| `scripts/agent-foundry-dev-health.ps1`                 | Core container check requires only mariadb + redis; Gotenberg is warning-only; fix-command suggestions include `--build`. Changed `mysqladmin ping` to `mariadb-admin ping` for MariaDB 11. MariaDB health check now uses credentialed ping via `sh -lc` with container env vars (no secret logging).                                                                                                      |
| `scripts/agent-foundry-dev-boot.ps1`                   | Added `Get-PnpmExecutable` function to resolve `pnpm.cmd` for `Start-Process` on Windows/SSH. Background API/web startup now uses resolved executable path instead of bare `"pnpm"` string, fixing `%1 is not a valid Win32 application` error.                                                                                                                                                            |

**Files NOT changed** (intentionally preserved):

- All `@bigcapital/*` package names and internal SDK imports
- Docker container/image names and network names
- License, README, CONTRIBUTING, CHANGELOG
- `.github/` workflows
- `.env.example` (template preserved as reference)
- `.env` (treated as opaque existing config; not read by adapter)

---

## 8. Known Issues & Blockers

### Fixed in this run (Newsec health/web detach repair):

- **SSH-safe background launch**: Boot script background services now launch via `cmd.exe /c` with internal stdout/stderr redirection instead of `Start-Process -RedirectStandardOutput/Error`. This avoids PowerShell named-pipe handles that can keep SSH sessions alive on Windows OpenSSH. The `Start-BackgroundService` helper uses `System.Diagnostics.ProcessStartInfo` with `UseShellExecute=$true` and `WindowStyle=Hidden`, ensuring clean detachment while preserving log files and PID capture.
- **Bounded prior PID cleanup**: Before starting new API/web services, `Stop-PriorServices` reads `logs/.pids` and kills only the EasyFire dev service PIDs recorded there. No broad process kills; only explicitly recorded EasyFire PIDs are stopped.
- **sdk-ts web readiness**: Root `dev:webapp` script now includes `--scope "@bigcapital/sdk-ts"` so `lerna run dev` runs sdk-ts's `dev` script (`npm run build -- --watch`, which builds CJS+ESM via tsup). This resolves the `Failed to resolve entry for package "@bigcapital/sdk-ts"` error in webapp stderr.
- **Health API probe**: Health script probes `http://localhost:3000/swagger` (HTTP 200) instead of `http://localhost:3000/api/` (HTTP 404).
- **PID variable renamed**: `$pid` shadowed PowerShell's read-only `$PID` automatic variable. Renamed to `$processId` in the health script's PID-file parsing loop.
- **Handoff updated**: API health check endpoint references changed from `/api/` to `/swagger` to match observed 200 response.

### Fixed in previous runs:

- **Windows/SSH pnpm Start-Process resolution**: Boot script now resolves `pnpm` to an executable-safe path (`pnpm.cmd`) via `Get-Command` before calling `Start-Process`. On Windows over SSH, the extensionless `pnpm` shim is not a valid Win32 application, causing `Start-Process` to fail with `%1 is not a valid Win32 application`. The new `Get-PnpmExecutable` function prefers `pnpm.cmd`, falls back to `pnpm` with extension check, and ultimately tries a sibling `pnpm.cmd` lookup. Both API and webapp background starts use the resolved path.
- **MariaDB 11 server command**: Dockerfile CMD changed from `["mysqld"]` to `["mariadbd"]` -- the MariaDB 11 server binary was renamed from `mysqld` to `mariadbd`. The previous CMD `["mysqld"]` caused `/usr/local/bin/docker-entrypoint.sh: line 105: mysqld: command not found` on container restart.
- **Docker compose rebuilds on Dockerfile change**: Boot script now runs `docker compose up -d --build` (was `up -d` without `--build`), so containers are rebuilt/recreated when Dockerfiles change without deleting volumes. Health script fix-command suggestions also include `--build`.
- **DB port mismatch**: Default fallback was 5432 (PostgreSQL); corrected to 3306 (MySQL/MariaDB) in both `system-database.ts` and `tenant-database.ts`
- **Tenant DB prefix**: Hardcoded fallback changed from `'bigcapital_tenant_'` to `'easyfire_tenant_'`
- **Newsec SSH Docker credential helper**: Boot and health scripts now create `logs/docker-config/config.json` (empty `{}`) and set `$env:DOCKER_CONFIG` to that directory, so Docker commands skip Docker Desktop's interactive credential helper, which fails over SSH with `A specified logon session does not exist`. The user's global Docker config is never read or modified.
- **Compose failure fast exit**: If `docker compose up -d` fails (nonzero exit code), the boot script writes blockers/PID file and exits immediately before the 120s readiness polling loop.
- **MariaDB base image**: Upgraded from `mariadb:10.2` (EOL) to `mariadb:11` for Newsec local compatibility (Docker Hub pull blocked over SSH).
- **Redis base image**: Upgraded from `redis:6.2.21` to `redis:7-alpine` for Newsec local compatibility.
- **Gotenberg/PDF optional**: Gotenberg placed behind compose profile `pdf` (`docker compose --profile pdf up -d`). Core boot starts and health-checks only mariadb + redis. Gotenberg is a warning-only check; PDF features disabled unless profile is explicitly enabled.
- **Newsec no-pull validation**: All base images now match Newsec-local tags (`mariadb:11`, `redis:7-alpine`). No Docker Hub pull is required for core validation runs.
- **MariaDB 11 client compatibility**: Boot and health scripts now use `mariadb-admin` (was `mysqladmin`) and the custom init script uses `mariadb` (was `mysql`). MariaDB 11 removed legacy `mysql`/`mysqladmin` symlinks; only `mariadb`/`mariadb-admin` exist in the container. This fixes the readiness loop where `mysqladmin ping` was absent and boot kept reporting MariaDB as not ready.
- **Post-readiness dev grant (MariaDB 11)**: Added idempotent grant step between readiness wait and build. Runs `docker compose exec -T mariadb bash -c "mariadb -u root ... GRANT ALL PRIVILEGES ..."` using container env vars (`$MYSQL_ROOT_PASSWORD`, `$MYSQL_USER`, `$MYSQL_PASSWORD`) without logging secret values to the boot log. Ensures the configured MYSQL_USER has dev privileges even if a previous boot initialized the volume before the custom init grant script completed.
- **MariaDB admin credential repair**: Boot readiness and health check `mariadb-admin ping` now runs via `docker compose exec -T mariadb sh -lc 'mariadb-admin ping -h localhost -u"$MYSQL_USER" -p"$MYSQL_PASSWORD"'` so container env vars expand inside the container. Uncredentialed `mariadb-admin ping` returns access denied in MariaDB 11 when `MARIADB_MYSQL_LOCALHOST_USER` is not set (legacy `mysqladmin ping` default user `root@localhost` was removed in MariaDB 11). Credentials are never logged.

### Historical remaining items at the end of that Agent Foundry run:

The following list is preserved as dated evidence, not as current work or
requirements. The current candidate pins Node.js 22.23.1 and pnpm 10.34.5; its
authoritative remaining work is recorded in `HANDOFF.md`.

1. **`node_modules` not installed**: `pnpm install` must be run first (boot script handles this)
2. **`docker/migration/Dockerfile`** references `bigcapitalhq/server:latest` -- this is a production concern only; dev uses direct `ts-node` CLI
3. **Historical Node.js requirement**: This run used `.nvmrc` at Node 18.16.1; it is superseded and must not be used as the current release contract.
4. **Third-party services**: Plaid, Stripe, LemonSqueezy, and S3 features will fail gracefully with placeholder keys (expected for local dev)
5. **Gotenberg optional**: PDF service behind `pdf` profile; enable with `docker compose --profile pdf up -d` if PDF export needed

---

## 9. Production Gates (HARD STOPS)

The following are **explicitly blocked** for this workspace run:

- Production deploy, DNS changes, live EasyFire website edits
- Real LLC/bank/Plaid/Stripe credentials
- Real financial data
- `git commit` / `git push` without explicit approval
- Mutations outside the workspace path
- Provider/api spend outside this bounded adapter call

---

## 10. Validation Evidence

### Commands to verify:

```powershell
git status --short --branch
git rev-parse HEAD
git diff --check
```

### Expected state after boot:

- Docker: `mariadb` and `redis` containers running (Gotenberg optional, behind `pdf` profile)
- API: HTTP 200 on `http://localhost:3000/swagger`
- Swagger: `http://localhost:3000/swagger` renders API docs
- Webapp: `http://localhost:4000` serves Vite dev server
- Logs: `logs/boot-*.log`, `logs/api-*.log`, `logs/webapp-*.log` contain service output
- PIDs: `logs/.pids` records background process IDs
