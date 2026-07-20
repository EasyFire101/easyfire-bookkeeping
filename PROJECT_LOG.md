# EasyFire Bookkeeping Project Log

## Foundation - 2026-07-19

- Local root: use the current checkout; machine-specific paths stay outside
  published source.
- Foundation version: 1.7.0.
- Project type: hosted production website/service.
- Audience: one owner behind Cloudflare Access and native authentication.
- Data risk: sensitive financial, identity, attachment, and credential data.
- Stack: Bigcapital AGPL-3.0 monorepo; React/Vite webapp; NestJS server;
  MariaDB; Redis; Envoy; Gotenberg; pnpm/Lerna; Docker Compose.
- Upstream base: Bigcapital commit
  8c90ca328ec59dd772de3b385531eb386de11ac8.
- Runtime: Newsec Windows, Docker Compose project
  easyfire-bookkeeping-prod, loopback Envoy, Cloudflare Tunnel and Access.
- Accepted-source plan: Forgejo main as primary; public GitHub mirror for AGPL
  corresponding source; origin remains upstream-only.
- Recovery: verified pre-takeover full filesystem checkpoint recorded in
  HANDOFF.md.
- Foundation checks: node scripts/project-foundation-check.mjs and
  node scripts/source-size-guard.mjs --changed.

## Open-source/editability notes

Bigcapital and the EasyFire modifications remain AGPL-3.0 corresponding source,
with full upstream history and locally editable TypeScript, PowerShell, Docker,
and configuration. Cloudflare is the only hosted edge dependency in the
candidate contract; it handles request routing and access identity but receives
no direct database or backup authority from the controller. The controller is
verify-only for that provider. A future owner-private tunnel or VPN edge is a
separable replacement because the application ingress remains loopback Envoy;
changing the edge requires its own design and approval.

The pnpm dependency graph is inherited substantially from upstream. The first
complete production audit report recorded in this takeover showed 260 findings,
including 116 high-severity findings. The final dependency repair superseded
that snapshot with 45 production advisories: 9 low, 36 moderate, 0 high, and 0
critical. Remaining findings stay disclosed for future dependency refreshes.

- Alternatives considered: replacing Bigcapital with a new accounting core or
  a hosted bookkeeping SaaS was rejected because it would add data-migration,
  auditability, editability, and recurring provider risk without solving the
  current release-control problem. Replacing the pre-existing Cloudflare edge
  during source repair was also rejected because edge mutation is independent
  of application recovery.
- replacement path if this choice ages badly: keep EasyFire changes separable and preserve upstream
  history so the accounting foundation can be upgraded or replaced through an
  explicit data migration. The loopback Envoy boundary allows Cloudflare to be
  replaced later by an owner-private tunnel or VPN without changing database
  authority. Dependency replacements or upgrades must retain focused
  application and disposable recovery proof.

## Runtime source of truth and drift check

The local checkout, historical Agent Foundry runs, and a URL redirect are not
runtime truth. Runtime truth is an exact completed schema-2 action journal plus
successful Postcheck on Newsec. Drift comparison includes archive and release
seal, both four-file controller authorities, built image IDs, exact
container/mount/network/volume/port/foreign-consumer identity, task definition,
metadata-backed backup receipts, and verify-only edge connector identity.

## Artifact/log retention

Keep journals, releases, credentials, databases, backups, restore scratch,
provider payloads, and diagnostic logs outside Git. Treat each dump, adjacent
SHA-256 sidecar, and adjacent metadata file as one recovery unit. Preserve
release directories and every observed action-derived durable-volume subset
through rollback. Rotate bulky diagnostics without deleting runtime authority.

## Impact map

- Docs or source disclosure: release-readiness Node test.
- Webapp/server/dependency changes: format, lint, typecheck, build, and focused
  tests.
- Production script or Compose changes: PowerShell parse, static validator,
  Compose config, disposable Docker, backup, and restore proof.
- Runtime-affecting changes: completed journal comparison plus authenticated
  postcheck; local source is never sufficient runtime proof.
- Real data or provider changes: separate explicit scope and approval.

## Decisions

### Preserve Bigcapital as the open-source foundation

Bigcapital already provides the accounting domain model and is licensed under
AGPL-3.0. EasyFire preserves its full history, attribution, package scopes, and
license. Replacement would be disproportionately risky and is unnecessary.

### Use Windows/Newsec plus Cloudflare, not the old Caddy/Linux proposal

The candidate runtime contract targets Docker Desktop on Newsec with Envoy
bound to loopback and pre-existing Cloudflare Tunnel/Access at the edge.
Application containers use Compose `restart: unless-stopped`; the candidate
allows no production startup scheduled task. Later read-only reconciliation
found a healthy older runtime whose legacy task/journal and existing-volume
state do not match this contract; the Caddy/systemd proposal remains historical
provenance.

### Keep production journals outside Git as runtime authority

A completed journal binds the archive hash, image tag, containers, external
resources, services, and tasks. It can contain operational identifiers and is
therefore private. HANDOFF.md records only sanitized release identity.

### Publish complete corresponding source

Forgejo is the accepted-source primary and GitHub is the anonymously readable
AGPL mirror. The application exposes one shared source URL across every
network-user surface. Secrets, databases, backups, journals, and user data are
not corresponding-source artifacts and remain private.

### Require fake and disposable proof before live mutation

Synthetic E2E and an isolated Compose project exercise application persistence,
migration, backup, and restore without touching production. Live work begins
with read-only reconciliation. A production Action is eligible only for a
proven-empty destination; an existing MariaDB volume routes to a separate
blue/green logical migration project.

### Bypass Agent Foundry for direct EasyFire ownership

Agent Foundry is historical provenance, not the execution or approval plane for
this takeover. The EasyFire repository, its project profile, current-state
record, final validation evidence, and accepted-source publication own the work.
This removes recurring provider/claim gates without weakening production or
durable-data boundaries.

### Replace the legacy controller with a fresh-install state machine

The production controller accepts only a canonical action ID and a proven-empty
data tier. Preflight blocks historical names such as `bigcapital_prod_mysql`
and `bigcapital_prod_redis`, all project-labeled/action-derived volumes, and
prior database authority for a new ActionId. Only an interrupted Action may
resume with the exact two volumes already bound to its same compatible schema-2
journal. Preflight binds a 15-minute schema-2 receipt to the controller, archive,
archive manifest, inventory, credential file, target tag, action-derived volume
names, and verified edge. Action seals the extracted release, creates new
volumes, migrates the empty database, and requires a full baseline backup plus
isolated network-disabled restore proof before application completion.
Mandatory Postcheck refuses identity drift. An existing MariaDB volume or prior
action authority stops with `DATABASE_ENGINE_MIGRATION_REQUIRED`; the old data
directory is never mounted under the candidate engine.

### Treat Cloudflare and cloudflared as verify-only infrastructure

The controller reads and verifies the pre-existing Cloudflare Access app and
policy, Tunnel, DNS record, tunnel health, cloudflared binary hash, LocalSystem
service configuration, and running process. It does not create, update, delete,
install, replace, or rotate those resources. Edge repair is a separate scope.

### Retire automated owner bootstrap

The legacy automated owner bootstrap state machine could strand partial
identity/configuration state. Its script is a non-mutating retirement marker in
this candidate. Manual onboarding or recovery is not part of the release and
requires a separate approved design and proof.

### Preserve durable recovery artifacts on rollback

Journal-bound rollback removes only the exact daily backup task when recorded
as created by that ActionId, plus the action's Compose containers/network. It preserves MariaDB and Redis
volumes, releases, backups, journals, and the external edge. If the application
tier ever started, rollback first creates and isolated-restore-verifies an
emergency backup.

### Use Docker restart policy instead of a startup scheduled task

An independently reviewed startup task could bypass the release controller's
journal and seal checks. `deploy/windows/start-stack.ps1` is therefore retired
to fail closed. Production containers use Compose `restart: unless-stopped`,
and the controller manages only one exact daily backup scheduled task.

## Current release status - 2026-07-19

- Direct source repair is local and still under final proof.
- Node.js 22.23.1 and pnpm 10.34.5 supersede historical Node 18 instructions.
- No EasyFire commit, Forgejo/GitHub publication, Newsec reconciliation,
  authenticated live acceptance, production action, or external-state mutation
  has occurred in this takeover.
- Do not convert historical live observations into a current readiness claim.

## Direct takeover recovery hardening - 2026-07-19

### Bind controller and runtime identity before every mutation

The repaired controller now treats its executable surface as two exact
four-file authorities: the deployment controller bundle used for
Preflight/Action/Postcheck/Rollback and the byte-identical sealed installed
bundle used by unattended backup. It journals exact built image IDs, a
hash-bound environment candidate, an exact durable-volume plan, container port
bindings, foreign volume consumers, task definition, and the verify-only
Cloudflare service/process/connector identity. Mutable tags, a source checkout,
and friendly resource names are not sufficient authority.

### Make migration and rollback crash-recoverable

Migration has a journaled `migration_preparing` boundary, binds the exact
created one-shot container, records start authorization before starting it,
never starts it a second time during resume, and waits with a bounded timeout.
Rollback preserves the exact observed subset of action-derived durable volumes
even if interruption occurs before both volumes exist. Focused crash-window
matrix coverage was added for these controller boundaries; the final combined
release run remains the promotion authority.

### Route every backup through the controller

The daily task invokes the fifth `ScheduledBackup` stage from the sealed
installed controller using canonical Windows PowerShell. Baseline, emergency,
and scheduled backups use unique journaled operation IDs and publish one crash-resumable
recovery unit: compressed SQL dump, SHA-256 sidecar, and authority-bound
metadata that identifies the action, role, phase/inventory, container, image,
volume, destination, and backup hash. Each unit must pass complete gzip/hash
validation and isolated network-disabled restore before its receipt is valid.

## Direct takeover validation snapshot - 2026-07-19

- Frozen pnpm install and the full application build passed on the current
  local candidate.
- The first complete production dependency audit report in this takeover showed
  260 findings, including 116 high-severity findings inherited from the
  upstream dependency graph. Later registry-call failures produced no
  superseding complete result. Treat this as unresolved live-deploy risk
  pending triage, not as repaired.
- No disposable Docker proof is recorded in this snapshot. Do not promote
  focused controller tests or the green application build into that claim.
- No commit, Forgejo/GitHub publication, Newsec reconciliation, live
  acceptance, deployment, Cloudflare mutation, scheduled-task mutation, or
  production-data mutation has occurred during the direct takeover.
- A fresh database has no supported first-owner onboarding path while signup
  is locked. Resolve and prove owner onboarding before treating a truly fresh
  production deployment as login-ready.

## Direct takeover release closeout - 2026-07-20

This entry supersedes the dated 2026-07-19 validation snapshot for current
release decisions without rewriting that historical record.

### Close the dependency and application proof gap

The release candidate now uses a reproducible pnpm 10.34.5 lock with patched
runtime dependency floors, moves build-only tools out of production dependency
sets, and preserves compatibility for XLSX/CSV, Multer, static serving,
multi-parameter Express routes, Plaid request construction, bcrypt, and
Nodemailer. The complete production audit reports 45 advisories: 9 low, 36
moderate, 0 high, and 0 critical. The frozen offline install, server typecheck,
dependency compatibility suite, and full six-project build pass.

### Bind unattended backup to the deployment owner

Interactive Preflight/Action binds the canonical deployment-owner SID into the
schema-2 receipt and journal. The daily task still runs as SYSTEM, but its exact
command passes that bound SID back to `ScheduledBackup`; ACL authority remains
SYSTEM, Administrators, and the same deployment owner. A missing, changed, or
noncanonical SID fails before backup work.

### Record final local proof without claiming runtime state

- Complete project-level suite: 69/69 passed.
- Static validator: 101/101 passed.
- Disposable Docker proof: `b37426f03a8841d9923b853db5f40a08` with passed built
  authentication, backup/restore, and exact cleanup evidence.
- Independent review: source publication GO after two read-only reviews found no
  remaining P1/P2; live deployment remains separately gated by owner onboarding
  and Newsec/runtime reconciliation.
- Exact Forgejo and anonymous GitHub readback, rather than this containing
  commit, establish source publication.
- Newsec journal/runtime/edge reconciliation, authenticated live acceptance,
  owner onboarding, deployment, and real bookkeeping-data setup remain separate
  operational boundaries.

## Source correction and hosted reconciliation - 2026-07-20

- The initial accepted-source commit was published and matched across private
  Forgejo main and the anonymous public GitHub main branch.
- A clean-tree audit found that four required root inputs had remained untracked
  even though committed checks consumed them: `.editorconfig`,
  `.env.production.example`, `AGENTS.md`, and the historical Agent Foundry
  handoff. The corrective release tracks those exact inputs and reruns their
  focused checks before final publication readback.
- Read-only Newsec reconciliation found healthy containers on an older release,
  existing durable MariaDB/Redis volumes, incompatible legacy journals, a
  failing daily-backup task, and the retired startup task still registered.
- The existing cloudflared service exposes a tunnel credential through its
  command line. The value is not recorded; rotation belongs to a separate edge
  scope.
- Cloudflare Access protects the public hostname, but the tested primary
  signed-in identity was denied. Native application authentication was not
  reached, no database content was queried, and no host or edge state changed.
- The remaining endpoint is a separately approved backup/edge repair and
  blue/green logical migration project, followed by native authenticated
  synthetic acceptance. The fresh-install controller must not run against the
  existing volumes.
