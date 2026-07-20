# EasyFire Bookkeeping Handoff

**Updated:** 2026-07-20

**Owner:** Direct Codex takeover for EasyFire

**State:** Locally validated release candidate. Publication authority is exact
remote readback, not this document. The hosted runtime remains unreconciled,
undeployed by this takeover, and not live-accepted.

## Source state

- Local branch: `codex/easyfire-bookkeeping-autonomy-recovery-20260718`.
- Upstream base (not the candidate HEAD):
  `8c90ca328ec59dd772de3b385531eb386de11ac8`.
- Upstream-only remote: `origin` (Bigcapital); never push EasyFire changes
  there.
- Accepted-source destination: `easyfire-forgejo/main`.
- Public AGPL mirror:
  `https://github.com/EasyFire101/easyfire-bookkeeping`.
- Use `git status --short` and the final release manifest for the exact release
  inventory. Do not rely on older path counts.
- Agent Foundry is bypassed. Its handoff is retained only as dated provenance.

## Recovery checkpoint

A verified full filesystem checkpoint was created before direct repairs:

- Path: private local recovery storage outside this published repository. The
  operator handoff records the exact machine-local path.
- Manifest: `manifest.json`.
- Restore instructions: `RESTORE.md`.
- Hash list: `hashes.sha256`.
- Source and backup: 13,758 files each, 26,497,504 bytes each.
- Verification passed; junctions were excluded.

Restore uses a mirror operation and can remove destination-only files. Inventory
the exact destination and apply destructive-action review before using it.

## Completed direct-takeover repairs

- Replaced stale Agent Foundry ownership with direct EasyFire source and
  runtime authority.
- Added project-foundation, release-readiness, source-disclosure, and
  secret/artifact hygiene controls.
- Pinned the candidate toolchain to Node.js `22.23.1` and pnpm `10.34.5`; Node
  18 is not the current candidate contract.
- Hardened production JWT configuration around `APP_JWT_SECRET`, a minimum
  64-byte decoded production secret, HS384 verification, and production signup
  disabled by default.
- Repaired backup publication and restore validation to require exact SHA-256
  sidecars, complete gzip reads, unique partial files, and isolated restore
  proof.
- Retired the legacy standalone rollback helper in favor of the journal-bound
  controller rollback.
- Retired automated production owner bootstrap. It is unavailable in this
  candidate and must not be treated as a release step.
- Retired the production startup scheduled-task helper. Unattended container
  recovery relies on Compose `restart: unless-stopped`; the only
  controller-managed task is the exact daily backup task.
- Replaced the legacy production controller with a schema-2, sealed-release,
  fresh-install-only state machine using action-derived MariaDB and Redis
  volumes.
- Bound the complete executable controller surface as exact four-file bundles:
  the deployment bundle for interactive stages and a byte-identical sealed
  installed bundle for unattended scheduled backup. Every stage fails closed
  if a path or SHA-256 changes.
- Replaced mutable-tag trust with journaled built image IDs and exact container
  image identity; added exact Envoy loopback port, zero-other-port, foreign
  volume consumer, scheduled-task, and Cloudflare service/process/connector
  identity checks.
- Made runtime environment publication crash-safe through a journaled,
  hash-bound candidate written before atomic publication.
- Added a journaled `migration_preparing` boundary that creates and binds the
  one-shot migration container before recording start authorization, starts it
  at most once, resumes by exact container state, and enforces a bounded
  timeout.
- Made rollback preserve the exact observed subset of action-derived durable
  volumes, including interruption before both volumes exist, and require a
  fresh readback even for a previously `rolled_back` journal.
- Made Cloudflare Access, Tunnel, DNS, cloudflared binary, and Windows service
  verify-only pre-existing infrastructure. The controller contains no edge
  create/update/delete/install path.
- Bound Action to a short-lived Preflight receipt, exact action confirmation,
  immutable archive identity, exact inventory, and a verified post-migration
  baseline backup.
- Made Postcheck mandatory before completion and made rollback preserve
  volumes, releases, backups, journals, and the external edge. Rollback creates
  and isolated-restore-verifies an emergency backup if the app ever started.
- Added the fifth `ScheduledBackup` controller stage. The one allowed daily
  task invokes the sealed installed controller through canonical Windows
  PowerShell; it cannot run a checkout helper or call the backup script
  directly.
- Bound the exact interactive deployment-owner SID into the Preflight receipt,
  action journal, and scheduled-task command. The SYSTEM task retains SYSTEM and
  Administrators authority but must pass that same canonical owner SID; a
  different, missing, or malformed SID fails before backup work.
- Made every baseline, emergency, and scheduled backup a crash-resumable recovery unit
  with a unique operation ID, compressed dump, SHA-256 sidecar,
  authority-bound metadata, complete gzip/hash validation, and isolated
  network-disabled restore receipt.
- Added focused controller crash-window matrix coverage for resumable and
  fail-closed boundaries. The final combined run remains required before
  promotion.

## Validation

The current dependency and application snapshot has these recorded results:

- `corepack pnpm install --offline --frozen-lockfile --ignore-scripts`: passed.
- Production dependency audit: 45 advisories total, consisting of 9 low, 36
  moderate, 0 high, and 0 critical.
- Dependency compatibility: 6/6 passed, covering XLSX/CSV, Multer failure
  recovery, static assets, multi-parameter Express routing, offline Plaid,
  bcrypt, and offline Nodemailer behavior.
- Server typecheck: passed.
- Full six-project monorepo build: passed.
- Rebuilt web bundle scan: no JavaScript Cookie 2.2.1 marker; the lock has no
  `js-cookie@2.2.1` entry.
- Focused production tests: 31/31 passed.
- Static no-deploy validator: 101/101 passed.
- Complete project-level test suite: 69/69 passed.
- Scoped Prettier: 71/71 changed/new supported files passed; scoped web lint:
  6/6 changed files passed; foundation: 4/4; source-size guard: complete with 0
  blockers and 2 advisory split candidates; `git diff --check`: clean;
  high-confidence secret scan: 0 hits.
- Repository-wide inherited debt is disclosed, not rewritten: 3,023 formatting
  findings; 645 web lint findings (81 errors, 564 warnings); and 43 web type
  errors in 26 files. None of the web type errors overlap the 7 changed web
  source files; server typecheck and the full production build pass.
- Disposable Docker proof: `b37426f03a8841d9923b853db5f40a08` with
  `proofPassed=true`, `builtServerAuthPassed=true`, `cleanupPassed=true`,
  unchanged empty production inventory, and zero containers, volumes, or
  networks after exact teardown.
- Independent read-only review: source publication GO after two reviews found no
  remaining P1/P2; live deployment remains separately gated by owner onboarding
  and Newsec/runtime reconciliation.

## Production applicability

- The production controller is **fresh-install-only**.
- Any historical, project-labeled, or action-derived MariaDB/Redis volume,
  including `bigcapital_prod_mysql` and `bigcapital_prod_redis`, is a hard stop.
  A supplied `PriorActionId` or prior database authority also stops with
  `DATABASE_ENGINE_MIGRATION_REQUIRED`.
- The only volume exception is an interrupted current Action: a resume may see
  the exact two ActionId-derived volumes already bound to the same valid
  schema-2 journal at a compatible phase. It cannot adopt any other volume.
- Existing MariaDB data needs a separate blue/green logical migration design,
  backup and restore proof, explicit approval, and rollback plan. Never mount
  the old data directory under the candidate MariaDB image.
- The production controller verifies but never mutates Cloudflare, Access,
  Tunnel, DNS, the cloudflared binary, or the Windows cloudflared service.
- Automated owner creation/recovery is unavailable.
- The startup task is unavailable; Compose `restart: unless-stopped` owns
  unattended container restart, and only the daily backup task is registered.
- Action ends pending Postcheck; only a successful exact-identity Postcheck can
  mark its schema-2 journal completed.

## Runtime drift status

- The actual Newsec runtime and its journal have not been read or reconciled in
  this takeover. This checkout is not runtime truth.

## State mutations or approvals

- Direct takeover owns local source and documentation repair; Agent Foundry is
  provenance only.
- No real LLC, tax, bank, customer, vendor, opening-balance, database, backup,
  credential, or provider data was read or changed during local repair.
- Local repair and proof do not mutate any production service, scheduled task,
  Cloudflare resource, DNS record, database, credential, or real bookkeeping
  record. Source-control publication changes only the two EasyFire repositories
  and is established by exact remote readback outside this self-referential
  source record.

## Known risks before promotion

- The production dependency graph has 36 moderate and 9 low advisories. It has
  no high or critical advisories, but the remaining findings stay disclosed and
  should be reviewed during future dependency refreshes.
- No existing production MariaDB data can be released through the fresh-only
  controller.
- Automated owner onboarding/recovery has no supported implementation. A truly
  fresh database cannot provide a usable first-owner login until a separate
  onboarding design is approved and proven.
- Source authority requires exact Forgejo readback and anonymous GitHub readback
  of the same released commit.
- The actual hosted revision, journal, edge identity, authentication behavior,
  and data state remain unreconciled.

## Next safe action

After final proof/review and exact publication readback, perform read-only
Newsec journal, runtime, and edge reconciliation, then authenticated acceptance.
Run no production Action unless a fresh empty target is proven and first-owner
onboarding has been resolved; route any existing database through a separately
approved blue/green logical migration project.
