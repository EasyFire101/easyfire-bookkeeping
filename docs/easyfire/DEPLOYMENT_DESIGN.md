# EasyFire Bookkeeping -- Deployment Design

> **Superseded historical proposal -- do not execute.** This 2026-07-09
> Caddy/Linux design was never the current Windows production contract. Use
> [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md) and
> [CURRENT_STATE.md](./CURRENT_STATE.md).

## Current direct-takeover design (authoritative)

**Status:** Locally validated release candidate. The frozen offline install,
server typecheck, dependency compatibility suite, full application build, and
0-high/0-critical production audit pass. Source publication is established only
by exact EasyFire remote readback; runtime reconciliation and authenticated
live acceptance remain separate.

Agent Foundry is provenance only. Direct EasyFire/Codex takeover owns this
candidate. The current topology is Newsec Windows plus Docker Compose project
`easyfire-bookkeeping-prod`, Envoy bound only to `127.0.0.1:80`, and
pre-existing Cloudflare Access/Tunnel/DNS/cloudflared infrastructure. The
controller verifies the edge and its one active connector but cannot mutate it.
Caddy, Linux, systemd, host port 443, and cron in the historical proposal below
are not part of the current contract.

### Authority model

The fresh-install-only schema-2 controller binds four exact executable files:

1. `deploy/windows/production-action.ps1`;
2. `deploy/windows/production-io.psm1`;
3. `deploy/windows/production-state.psm1`; and
4. `scripts/production/backup-integrity.psm1`.

Interactive stages use the exact deployment bundle. The unattended daily task
uses a byte-identical bundle inside the sealed installed release. Each path and
SHA-256 is journal authority. The controller also binds the immutable archive
and release manifest, exact built image IDs, container/mount/network/volume
identity, Envoy's one loopback binding and zero other host bindings, absence of
foreign volume consumers, exact scheduled-task definition, and the
service/process/connector identity of the verify-only Cloudflare edge. The
interactive deployment-owner SID is sealed into the Preflight receipt, action
journal, and task command so unattended SYSTEM backup retains the same bounded
ACL authority rather than deriving a new identity.

### Crash and resume model

- A generated `.env` is first written as a hash-bound candidate. The journal is
  durable before atomic publication, so an unjournaled or changed candidate or
  target fails closed.
- The migration state machine enters `migration_preparing`, creates and binds
  one exact migration container, records start authorization before starting
  it, and starts it at most once. Resume observes that exact container and a
  bounded timeout prevents an indefinite wait.
- Durable volume identity is recorded as an exact observed subset before and
  after data-tier creation. Rollback preserves that subset even if interruption
  happens after only one volume appears.
- A repeated rollback re-proves container/network/task absence and preserved
  recovery authority; a `rolled_back` label alone is not success.
- Focused crash-window matrix coverage is part of the candidate. Final combined
  release validation remains required before promotion.

### Backup model

The fifth controller stage is `ScheduledBackup`. The one exact daily Windows
task invokes that stage from the sealed installed controller through canonical
Windows PowerShell and passes the exact journal-bound deployment-owner SID; it
cannot execute a working-tree helper, substitute another SID, or call
`backup.ps1` directly. Baseline, emergency, and scheduled backups each use a
unique journaled operation ID and publish one crash-resumable recovery unit:

- compressed SQL dump;
- adjacent SHA-256 sidecar; and
- adjacent authority-bound metadata identifying the action, invocation role,
  operation ID, backup mode, phase/inventory, exact MySQL
  container/image/volume, destination, file path, and dump SHA-256.

A receipt is valid only after metadata/hash/gzip verification and an isolated
network-disabled restore. Retention and recovery must keep the three adjacent
files together.

### Deployment blockers and separate projects

- The controller cannot adopt or upgrade existing MariaDB/Redis state. Any
  historical, project-labeled, or prior-action data authority requires a
  separate blue/green logical migration. Never mount an old MariaDB data
  directory under the candidate engine.
- Automated owner bootstrap is retired. A truly fresh database has no supported
  first-owner login, so owner onboarding must be separately designed and proven
  before a fresh deployment is usable.
- The complete production audit reports 45 advisories: 9 low, 36 moderate, 0
  high, and 0 critical. Remaining moderate/low findings stay disclosed for
  future dependency refreshes.
- Disposable Docker proof `b37426f03a8841d9923b853db5f40a08` and two independent
  read-only reviews found no remaining P1/P2 for source publication. Live
  deployment remains separately gated by owner onboarding and Newsec/runtime
  reconciliation.
- This source record makes no claim of Newsec reconciliation, Cloudflare
  mutation, production action, scheduled-task mutation, or real
  bookkeeping-data mutation. Source publication is proven externally by exact
  remote readback.

## Historical 2026-07-09 proposal (non-authoritative)

**Status:** Proposed
**Date:** 2026-07-09
**Workspace:** `easyfire-bookkeeping/af-bk-full-01`
**Source:** BigCapital (AGPL v3) -- measured topology, not assumed
**Target domain:** `bookkeeping.easyfire.fyi`

---

## 1. Measured Service Topology (from docker-compose.prod.yml)

The deployment topology reflects the existing production compose file, verified by inspection of the workspace. No assumptions; all service interactions below are derived from the actual source files.

| Service              | Image                                          | Internal Port | Exposed Port                                                       | Purpose                                                    | Depends On     |
| -------------------- | ---------------------------------------------- | ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- | -------------- |
| `proxy`              | `envoyproxy/envoy:v1.30-latest`                | 80, 443       | `${PUBLIC_PROXY_PORT:-80}:80`, `${PUBLIC_PROXY_SSL_PORT:-443}:443` | Reverse proxy -- routes `/api/*` to server, `/*` to webapp | server, webapp |
| `webapp`             | `bigcapitalhq/webapp:latest`                   | 80            | (internal)                                                         | React SPA served by nginx                                  | proxy          |
| `server`             | `bigcapitalhq/server:latest`                   | 3000          | (internal)                                                         | NestJS API server                                          | mysql, redis   |
| `database_migration` | custom (`docker/migration/Dockerfile`)         | --            | (one-shot, exits)                                                  | Runs system + tenant migrations via wait-for-it + CLI      | mysql          |
| `mysql`              | custom (`docker/mariadb`, `FROM mariadb:11`)   | 3306          | (internal)                                                         | MariaDB 11 -- system DB + per-tenant DBs                   | --             |
| `redis`              | custom (`docker/redis`, `FROM redis:7-alpine`) | 6379          | (internal)                                                         | Redis 7 -- caching, Bull/BullMQ queues, sessions           | --             |
| `gotenberg`          | `gotenberg/gotenberg:7`                        | 9000          | (internal)                                                         | PDF generation                                             | --             |

**Network:** All services on a single bridge network (`bigcapital_network`).
**Volumes:** `bigcapital_prod_mysql` (MariaDB data), `bigcapital_prod_redis` (Redis data -- RDB snapshots).

### Service Interaction Diagram

```
                          Internet
                             │
                    ┌────────▼────────┐
                    │   Caddy (TLS)    │  ← ADDED: terminates TLS, auto Let's Encrypt
                    │   port 443/80    │
                    └────────┬────────┘
                             │ HTTP (internal)
                    ┌────────▼────────┐
                    │  Envoy Proxy     │
                    │  port 80         │
                    └──┬───────────┬──┘
             /api/*   │           │  /*
          ┌───────────▼─┐     ┌──▼──────────┐
          │   Server     │     │    Webapp    │
          │  (NestJS)    │     │  (nginx)     │
          │  port 3000   │     │  port 80     │
          └──┬───┬───┬──┘     └──────────────┘
             │   │   │
   ┌─────────▼┐  │   └──────────┐
   │  MySQL    │  │              │
   │ (MariaDB) │  │   ┌──────────▼──────┐
   │ port 3306 │  │   │     Redis        │
   └───────────┘  │   │    port 6379     │
                  │   └──────────────────┘
          ┌───────▼────────┐
          │   Gotenberg     │
          │   port 9000     │
          └────────────────┘
```

**Key finding:** The existing `envoy.yaml` defines only an HTTP listener on port 80. Port 443 is exposed in `docker-compose.prod.yml` (`${PUBLIC_PROXY_SSL_PORT:-443}:443`) but has **no corresponding TLS listener or certificate configuration** in Envoy. TLS termination is currently missing and must be added for production use.

---

## 2. Docker Hosting Option Comparison

### Option A: Newsec (Preferred)

Newsec is the current Docker worker environment used for local development and is treated as the preferred host unless evidence rejects it.

| Criterion             | Assessment                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Privacy**           | Single-tenant physical host; database never leaves the host's volumes. No multi-tenant data commingling.                                         |
| **Backup capability** | Host filesystem access enables direct volume backups (mysqldump + tar). Cron jobs on the host can automate backup rotation.                      |
| **Recovery**          | Full volume restore from backup archive; Docker Compose down/up cycle restores service.                                                          |
| **TLS**               | Caddy running as an additional Docker service or on the host terminates TLS with automatic Let's Encrypt renewal for `bookkeeping.easyfire.fyi`. |
| **Restart policy**    | `restart: on-failure` (existing compose) plus host-level systemd unit to ensure Docker daemon and compose stack survive reboots.                 |
| **Update path**       | `docker compose pull` new images, `docker compose up -d` with zero-downtime via container recreation.                                            |
| **Rollback**          | Pin previous image digest in `.env` or compose override, `docker compose up -d`.                                                                 |
| **Cost**              | Existing Newsec infrastructure; incremental cost limited to storage (backup archives) and bandwidth.                                             |
| **Monitoring**        | Container health checks + host-level log forwarding. Optional Uptime Kuma or Healthchecks.io for external reachability.                          |

**Verdict:** Newsec meets all privacy, backup, and recovery requirements. No evidence rejects it.

### Option B: Cloud VM (AWS EC2 / DigitalOcean Droplet)

| Criterion    | Assessment                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Privacy**  | Acceptable with encrypted EBS/block storage. Data at rest encryption is standard.                                      |
| **Backup**   | Volume snapshots are native and reliable. Additional mysqldump to S3/Spaces for logical backups.                       |
| **Recovery** | Snapshot restore is fast. Logical restore via documented procedure.                                                    |
| **Cost**     | ~$20-40/month for a t3.small or equivalent (2 vCPU, 4 GB RAM). Additional for backups (S3 storage + snapshot storage). |
| **TLS**      | Caddy or cloud load balancer with ACM (AWS Certificate Manager).                                                       |

**Verdict:** Viable but rejected -- Newsec provides equivalent capability at lower marginal cost with existing infrastructure. Cloud VM would duplicate hosting already available.

### Option C: Docker Swarm / Kubernetes

| Criterion   | Assessment                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| **Privacy** | Acceptable but adds orchestration complexity for a single-node workload.                             |
| **Backup**  | Requires CSI snapshot controller or external backup tooling.                                         |
| **Cost**    | Increases operational overhead; single-node Bigcapital does not benefit from orchestration features. |

**Verdict:** Rejected -- the Bigcapital topology is single-node by design (single MySQL instance, single Redis, no horizontal scaling). Orchestration adds complexity without benefit.

### Selected: Option A -- Newsec Docker Host

The existing Newsec host runs the Docker Compose stack directly. Caddy is added as a lightweight TLS termination layer in front of the Envoy proxy.

---

## 3. TLS / HTTPS Routing for bookkeeping.easyfire.fyi

### Architecture

```
Client (HTTPS) --> Caddy (:443) --> Envoy (:80) --> [server:3000 | webapp:80]
```

### Caddy Configuration

Caddy is added as a service in `docker-compose.prod.yml` or as a standalone container on the host network, binding ports 80 and 443. It handles:

1. **Automatic Let's Encrypt certificate provisioning** for `bookkeeping.easyfire.fyi`
2. **HTTP-to-HTTPS redirect** (port 80 -> 443)
3. **Reverse proxy to Envoy** on the internal network

Example Caddyfile (to be placed at `./docker/caddy/Caddyfile`):

```
bookkeeping.easyfire.fyi {
    reverse_proxy proxy:80
    encode gzip
    header {
        X-Forwarded-Proto https
        X-Content-Type-Options nosniff
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    }
}
```

### Envoy Changes

The existing Envoy listener on port 80 (HTTP only) is preserved. Caddy terminates TLS externally and forwards cleartext HTTP to Envoy over the internal Docker network. This avoids modifying the Envoy configuration and keeps TLS logic in a purpose-built tool (Caddy) with automatic certificate renewal.

### DNS Requirement

An A/AAAA record for `bookkeeping.easyfire.fyi` must point to the Newsec host's public IP. This is a DNS change **outside the scope of this workspace** and requires separate approval.

---

## 4. Secret Storage

### Current State (measured)

The `docker-compose.prod.yml` reads all secrets from a `.env` file via variable substitution (`${VAR_NAME}`). The `.env` file contains:

- Database credentials (`DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`)
- JWT signing key (`APP_JWT_SECRET`)
- Third-party API keys (Plaid, Stripe, LemonSqueezy, S3, PostHog, New Relic, Open Exchange Rate)
- SMTP credentials
- Base URL

### Recommended Approach

1. **`.env` file on host**, outside the workspace repository, with restrictive permissions (`chmod 600`, owned by the Docker runtime user).
2. **No `.env` in version control.** The `.gitignore` already excludes `.env`. Never commit secrets.
3. **JWT secret:** Generate via `openssl rand -base64 64` at deploy time. Rotate on a scheduled interval (quarterly).
4. **Database credentials:** Use strong random passwords generated at deploy time. Store in `.env` and a secure off-host backup (password manager or encrypted vault).
5. **Third-party API keys:** Stored in `.env`. Rotate per each provider's recommended schedule.

### What is NOT recommended

- Docker Swarm secrets (unnecessary complexity for a single-node host)
- HashiCorp Vault (operational overhead disproportionate to a single-node deployment)
- `.env` encryption at rest on the host filesystem (the host itself is the trust boundary; separate encrypted backup covers disaster recovery)

### Secret Generation

At deploy time:

```sh
# Generate secure random secrets
openssl rand -base64 64  # APP_JWT_SECRET
openssl rand -base64 32  # DB_PASSWORD
openssl rand -base64 32  # DB_ROOT_PASSWORD
```

---

## 5. Restart Policy

### Docker-level

The existing `docker-compose.prod.yml` uses `restart: on-failure` for most services. This is adequate but should be upgraded to `restart: unless-stopped` for production to ensure services survive Docker daemon restarts and are only stopped by explicit `docker compose stop`.

| Service            | Current      | Recommended            | Rationale                                          |
| ------------------ | ------------ | ---------------------- | -------------------------------------------------- |
| proxy (Envoy)      | `on-failure` | `unless-stopped`       | Edge proxy must always restart                     |
| webapp             | `on-failure` | `unless-stopped`       | Frontend must be always available                  |
| server             | `on-failure` | `unless-stopped`       | API must be always available                       |
| mysql              | `on-failure` | `unless-stopped`       | Database must survive daemon restarts              |
| redis              | `on-failure` | `unless-stopped`       | Cache/queue must survive daemon restarts           |
| database_migration | (one-shot)   | (one-shot, no restart) | Runs once, exits                                   |
| gotenberg          | (none)       | `unless-stopped`       | PDF service optional but should restart if enabled |
| caddy (new)        | (new)        | `unless-stopped`       | TLS termination must always restart                |

### Host-level

A `systemd` unit file ensures the Docker Compose stack starts on host boot and restarts if the Docker daemon is restarted:

```ini
# /etc/systemd/system/easyfire-bookkeeping.service
[Unit]
Description=EasyFire Bookkeeping (Bigcapital Docker Compose)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/easyfire-bookkeeping
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml --env-file .env up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
ExecReload=/usr/bin/docker compose -f docker-compose.prod.yml restart

[Install]
WantedBy=multi-user.target
```

Enable with: `systemctl enable easyfire-bookkeeping`

---

## 6. Monitoring

### Health Checks

Container health checks are currently missing from `docker-compose.prod.yml` (only the server Dockerfile has a HEALTHCHECK instruction). Recommended additions:

| Service       | Health Check                             | Interval | Timeout | Retries |
| ------------- | ---------------------------------------- | -------- | ------- | ------- |
| mysql         | `mariadb-admin ping -h localhost`        | 30s      | 10s     | 3       |
| redis         | `redis-cli PING`                         | 30s      | 10s     | 3       |
| server        | HTTP GET `http://localhost:3000/swagger` | 30s      | 10s     | 3       |
| webapp        | HTTP GET `http://localhost:80`           | 30s      | 10s     | 3       |
| proxy (Envoy) | HTTP GET `http://localhost:80`           | 30s      | 10s     | 3       |
| caddy         | HTTP GET `http://localhost:2019/metrics` | 30s      | 10s     | 3       |
| gotenberg     | HTTP GET `http://localhost:9000/health`  | 60s      | 10s     | 3       |

### External Monitoring

- **Healthchecks.io** (free tier: 20 checks) or **Uptime Kuma** (self-hosted, separate host) pings `https://bookkeeping.easyfire.fyi/api/health` at 5-minute intervals. Alerts via email/Slack on failure.
- **Docker log driver:** Configure `json-file` with `max-size: 10m` and `max-file: 3` to prevent log disk exhaustion.
- **Disk space:** Host-level cron monitors volume disk usage. Alert at 80% capacity.

### New Relic (Optional)

The server already supports New Relic APM via environment variables (`NEW_RELIC_LICENSE_KEY`, `NEW_RELIC_APP_NAME`, etc.). If a New Relic license is available, enable these variables for application-level performance monitoring.

---

## 7. Backup

### Backup Scope

| Data                    | Location                       | Backup Method                                                    | Frequency              |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------- | ---------------------- |
| MariaDB (all databases) | `bigcapital_prod_mysql` volume | `mariadb-dump --all-databases --single-transaction`              | Daily, 02:00 UTC       |
| Redis RDB               | `bigcapital_prod_redis` volume | Copy `dump.rdb` via `docker compose exec redis redis-cli BGSAVE` | Daily, after DB backup |
| Envoy config            | `./docker/envoy/envoy.yaml`    | Git repository (version controlled)                              | On change              |
| Caddy config            | `./docker/caddy/Caddyfile`     | Git repository (version controlled)                              | On change              |
| Caddy certificates      | `caddy_data` volume            | Caddy auto-renews; backup volume                                 | Weekly                 |
| `.env` secrets          | Host filesystem                | Encrypted copy to backup destination                             | On change              |

### Backup Script (host-level cron)

```sh
#!/bin/bash
# /opt/easyfire-bookkeeping/scripts/backup.sh
set -euo pipefail

BACKUP_DIR="/opt/backups/easyfire-bookkeeping"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
RETENTION_DAYS=30
COMPOSE_DIR="/opt/easyfire-bookkeeping"

mkdir -p "$BACKUP_DIR"

# 1. Database dump
docker compose -f "$COMPOSE_DIR/docker-compose.prod.yml" exec -T mysql \
  sh -c 'mariadb-dump --all-databases --single-transaction -u root -p"$MYSQL_ROOT_PASSWORD"' \
  > "$BACKUP_DIR/mysql-$TIMESTAMP.sql"

# 2. Compress
gzip "$BACKUP_DIR/mysql-$TIMESTAMP.sql"

# 3. Cleanup old backups
find "$BACKUP_DIR" -name "mysql-*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup complete: mysql-$TIMESTAMP.sql.gz"
```

### Backup Destination

Backup archives are stored:

1. **Local:** `/opt/backups/easyfire-bookkeeping/` on the Newsec host (30-day rotation)
2. **Remote (recommended):** Sync to Cloudflare R2, Backblaze B2, or an S3-compatible bucket via `rclone` or `aws s3 sync` after each local backup completes. Remote retention: 90 days of daily backups, 12 monthly backups.

### Backup Verification

A weekly cron job restores the latest backup to a temporary MariaDB container and runs `mariadb-check` to verify integrity:

```sh
# Verify latest backup
LATEST_BACKUP=$(ls -t /opt/backups/easyfire-bookkeeping/mysql-*.sql.gz | head -1)
gunzip -c "$LATEST_BACKUP" | docker run --rm -i --network bigcapital_network \
  mariadb:11 mariadb -h temp-mysql -u root -p"$TEMP_PASSWORD" --execute "SELECT 1;"
```

---

## 8. Restore Procedure

### Scenario 1: Database Corruption / Accidental Data Loss

1. Stop the application services (keep MySQL running):
   ```sh
   docker compose -f docker-compose.prod.yml stop server webapp proxy caddy
   ```
2. Restore the database from the latest verified backup:
   ```sh
   gunzip -c /opt/backups/easyfire-bookkeeping/mysql-YYYYMMDD-HHMMSS.sql.gz | \
     docker compose -f docker-compose.prod.yml exec -T mysql \
     sh -c 'mariadb -u root -p"$MYSQL_ROOT_PASSWORD"'
   ```
3. Run migrations to ensure schema is current:
   ```sh
   docker compose -f docker-compose.prod.yml up -d database_migration
   ```
4. Start all services:
   ```sh
   docker compose -f docker-compose.prod.yml up -d
   ```
5. Verify: `curl -f https://bookkeeping.easyfire.fyi/api/health`

### Scenario 2: Full Host Failure

1. Provision a new Newsec host (or restore existing host)
2. Install Docker and clone the workspace repository
3. Restore `.env` from secure off-host backup
4. Restore database volume from backup archive:
   ```sh
   gunzip -c /path/to/restored/mysql-YYYYMMDD-HHMMSS.sql.gz | \
     docker compose -f docker-compose.prod.yml exec -T mysql \
     sh -c 'mariadb -u root -p"$MYSQL_ROOT_PASSWORD"'
   ```
5. Run `docker compose -f docker-compose.prod.yml up -d`
6. Verify TLS certificate issuance (Caddy will auto-provision)
7. Update DNS A/AAAA record if the host IP changed

### Scenario 3: Caddy Certificate Loss

Caddy automatically re-provisions Let's Encrypt certificates on startup. No manual intervention is required. If the `caddy_data` volume is lost, Caddy will request new certificates. Rate limits: Let's Encrypt allows 5 duplicate certificates per week per domain. This is sufficient for recovery.

---

## 9. Update Path

### Routine Update (patch/minor releases)

1. Check for new upstream images:
   ```sh
   docker compose -f docker-compose.prod.yml pull
   ```
2. Review changelog for breaking changes
3. Apply updates with container recreation:
   ```sh
   docker compose -f docker-compose.prod.yml up -d
   ```
   Docker Compose recreates only changed containers. The database migration container runs on each `up` and exits if migrations are current.
4. Verify: `docker compose -f docker-compose.prod.yml ps` shows all services healthy

### Major Version Update

1. Pin current image digests in `.env` for rollback reference:
   ```sh
   # Record current digests
   docker inspect bigcapitalhq/server:latest --format='{{index .RepoDigests 0}}'
   docker inspect bigcapitalhq/webapp:latest --format='{{index .RepoDigests 0}}'
   ```
2. Stop services: `docker compose -f docker-compose.prod.yml down`
3. Update `.env` with new image tags if needed
4. Pull new images: `docker compose -f docker-compose.prod.yml pull`
5. Start: `docker compose -f docker-compose.prod.yml up -d`
6. Monitor migration logs: `docker compose -f docker-compose.prod.yml logs database_migration`
7. Verify application functionality

### Custom Image Builds (from workspace source)

If running custom-built images (not upstream `bigcapitalhq/*`):

```sh
# Build locally
docker compose -f docker-compose.prod.yml build server webapp

# Tag with date
docker tag bigcapitalhq/server:latest registry.internal/easyfire/server:YYYYMMDD
docker tag bigcapitalhq/webapp:latest registry.internal/easyfire/webapp:YYYYMMDD
```

---

## 10. Rollback

### Immediate Rollback (same host, same volumes)

1. Stop services:
   ```sh
   docker compose -f docker-compose.prod.yml down
   ```
2. Revert `.env` image tag pins to previous version
3. Start:
   ```sh
   docker compose -f docker-compose.prod.yml up -d
   ```
4. Run migrations for the previous version if needed

### Rollback with Database Restore

If the update included destructive migrations:

1. Follow the **Restore Procedure** (Section 8, Scenario 1) to restore the pre-update database backup
2. Pin `.env` to the pre-update image tags
3. Start services and verify

### Rollback Decision Gates

| Condition                                    | Action                                                |
| -------------------------------------------- | ----------------------------------------------------- |
| Migration completed successfully, app errors | Roll back images only (no DB restore)                 |
| Migration failed or produced errors          | Restore DB from pre-update backup + roll back images  |
| Data corruption detected                     | Full restore from backup (skip migration step)        |
| TLS certificate issues                       | Caddy auto-renews; check DNS and port 80 reachability |

---

## 11. Recurring Cost

### Infrastructure (Newsec)

| Item               | Monthly Cost            | Notes                                                                                                                                                                                  |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Newsec Docker host | Existing infrastructure | No incremental cost; already provisioned                                                                                                                                               |
| Bandwidth          | Existing infrastructure | Bookkeeping traffic is low; within existing allocation                                                                                                                                 |
| Storage (backups)  | ~$1-5/month             | Depends on database size; 30 days local + 90 days remote. Estimate: 10 GB database = ~$0.50/month on Backblaze B2 ($0.005/GB/month) or ~$1.50/month on Cloudflare R2 ($0.015/GB/month) |

### Third-Party Services (Optional)

These are only relevant if the corresponding features are enabled:

| Service            | Monthly Cost                                         | Purpose                                               |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Plaid              | Pay-as-you-go (per connection)                       | Bank feed integration                                 |
| Stripe             | 2.9% + $0.30 per transaction                         | Payment processing                                    |
| LemonSqueezy       | 5% + $0.50 per transaction                           | Subscription billing (if self-hosted billing is used) |
| PostHog            | Free tier (1M events/month)                          | Product analytics                                     |
| New Relic          | Free tier (100 GB/month)                             | APM monitoring                                        |
| Healthchecks.io    | Free tier (20 checks)                                | External health monitoring                            |
| Open Exchange Rate | Free tier (1,000 req/month)                          | Currency exchange rates                               |
| Mail (SMTP)        | ~$5-10/month (SendGrid/Mailgun free tiers may cover) | Transactional email                                   |

### Total Estimated Monthly

- **Minimum (core bookkeeping only):** ~$0-5/month (backup storage only; Newsec already provisioned)
- **With all optional integrations:** ~$15-50/month (SMTP, monitoring, Plaid if used)

---

## 12. Rejected Alternatives

### TLS at Envoy Layer

**Decision:** Use Caddy as external TLS terminator instead of configuring TLS in Envoy.

**Rationale:**

- Caddy provides automatic Let's Encrypt certificate provisioning and renewal with zero configuration beyond the domain name.
- Envoy requires manual certificate file management, separate certbot/cert-manager tooling, and hot-reload configuration for certificate rotation.
- Adding Caddy as a thin layer avoids modifying the existing Envoy configuration and separates concerns: Caddy handles TLS, Envoy handles application routing.
- Caddy's auto-HTTPS and HTTP->HTTPS redirect are built-in; Envoy would require additional listener and filter configuration.

### Docker Swarm Secrets

**Rejected** because:

- Single-node deployment does not benefit from Swarm's orchestration features.
- Swarm adds complexity (manager node, overlay network, service replication) without improving security for a single host.
- `.env` with restrictive file permissions (`chmod 600`) provides equivalent security on a single-tenant host.

### Automated Database Migration on Container Start

**Rejected** in favor of one-shot `database_migration` container:

- The existing `database_migration` container runs once and exits. This is the measured behavior from `docker-compose.prod.yml`.
- Running migrations automatically on server start risks concurrent migration execution if multiple server replicas are ever added.
- The one-shot pattern ensures migrations run exactly once per deploy and the exit code signals success or failure before dependent services start.

### Cloud Load Balancer with ACM

**Rejected** in favor of Caddy on the same host:

- A cloud load balancer (AWS ALB, DigitalOcean LB) adds $15-25/month in recurring cost.
- The single-node Bigcapital topology does not need load balancing across multiple instances.
- Caddy on the same host provides TLS termination at no additional cost.

### Separate Backup Host

**Rejected** in favor of local backup + remote sync:

- A dedicated backup host adds cost and complexity disproportionate to the data volume.
- 30-day local retention + 90-day remote retention via `rclone sync` to R2/B2 provides sufficient disaster recovery coverage.
- Database dumps are compressed; a full Bigcapital database is expected to be < 1 GB compressed for most SMB deployments.

---

## 13. Security Considerations

1. **TLS everywhere:** All client traffic is HTTPS via Caddy. Internal Docker network traffic is cleartext HTTP (trusted network boundary).
2. **Database:** Not exposed to the host network (internal only, `expose` not `ports`). Only accessible from within `bigcapital_network`.
3. **Redis:** Not exposed externally. No password set (internal network trust); add `requirepass` in `redis.conf` if the network boundary is not trusted.
4. **Firewall:** Host firewall restricts inbound traffic to ports 80 and 443 only. SSH access is restricted to trusted IPs.
5. **Secrets:** `.env` file permissions `600`, owned by the user running Docker. Never committed to version control.
6. **AGPL obligations:** The full source code must be made available to all users under AGPL v3. The source repository link must be accessible from the deployed application.

---

## 14. Files Affected by This Design

| File                                                      | Change Type            | Description                                                                         |
| --------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `docker/caddy/Caddyfile`                                  | New                    | Caddy reverse proxy configuration with TLS for `bookkeeping.easyfire.fyi`           |
| `docker-compose.prod.yml`                                 | Modified               | Add `caddy` service, update restart policies to `unless-stopped`, add health checks |
| `.env`                                                    | Modified (deploy-time) | Add `CADDY_ACME_EMAIL` for Let's Encrypt notifications                              |
| (host) `/etc/systemd/system/easyfire-bookkeeping.service` | New                    | systemd unit for automatic startup                                                  |
| (host) `/opt/backups/easyfire-bookkeeping/`               | New                    | Backup directory                                                                    |
| (host) `/opt/easyfire-bookkeeping/scripts/backup.sh`      | New                    | Automated backup script                                                             |
| (host) cron                                               | New                    | Scheduled backup and verification jobs                                              |

**No DNS changes, live service mutations, or secret modifications are performed by this design document.**

---

## 15. Implementation Sequence

1. **Pre-deploy (this phase):** Design approved. No infrastructure changes.
2. **Deploy phase 1:** Add Caddy service to `docker-compose.prod.yml`, configure TLS, test on staging subdomain.
3. **Deploy phase 2:** Set up backup script, cron job, and remote sync destination.
4. **Deploy phase 3:** Configure systemd unit, enable monitoring (health checks, Healthchecks.io).
5. **Deploy phase 4:** Point `bookkeeping.easyfire.fyi` DNS to Newsec host. Caddy provisions certificate automatically.
6. **Post-deploy:** Verify backup restore procedure on a test host. Document any deviations.

---

## Appendix A: Measured File References

All topology statements in this document are based on measured workspace evidence, not assumptions.

| Claim                                                             | Evidence File                                                                  | Line(s)                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Envoy routes `/api` to server:3000                                | `docker/envoy/envoy.yaml`                                                      | 20-23                                                              |
| Envoy routes `/` to webapp:80                                     | `docker/envoy/envoy.yaml`                                                      | 24-27                                                              |
| Envoy has no TLS listener (HTTP only on 80)                       | `docker/envoy/envoy.yaml`                                                      | 3-8                                                                |
| Port 443 exposed in compose but unused by Envoy                   | `docker-compose.prod.yml:13`, `docker/envoy/envoy.yaml` (no port 443 listener) | --                                                                 |
| Server depends on mysql and redis via `links` and `depends_on`    | `docker-compose.prod.yml`                                                      | 33-38                                                              |
| Database migration is a one-shot container                        | `docker/migration/Dockerfile`                                                  | 38 (`CMD ... system:migrate:latest && ... tenants:migrate:latest`) |
| MariaDB uses custom Dockerfile with MariaDB 11                    | `docker/mariadb/Dockerfile`                                                    | `FROM mariadb:11`                                                  |
| Redis uses RDB snapshots (no AOF)                                 | `docker/redis/redis.conf`                                                      | 10-12, 23                                                          |
| Volumes named `bigcapital_prod_mysql` and `bigcapital_prod_redis` | `docker-compose.prod.yml`                                                      | 188-193                                                            |
| Restart policy is `on-failure`                                    | `docker-compose.prod.yml`                                                      | 17, 24, 39, 151, 168                                               |
| All services on `bigcapital_network` bridge                       | `docker-compose.prod.yml`                                                      | 18-19, 25-26, 40-41, 146-147, 163-164, 175-176, 182-183            |
| No health checks in production compose                            | `docker-compose.prod.yml` (full file)                                          | None defined                                                       |
| No backup scripts exist                                           | Workspace search                                                               | No results for `backup*` or `restore*`                             |
| `.env.example` defines all required secrets                       | `.env.example`                                                                 | 1-111                                                              |
| Gotenberg port is 9000:3000 in dev, 9000 internal in prod         | `docker-compose.yml:20`, `docker-compose.prod.yml:181`                         | --                                                                 |
