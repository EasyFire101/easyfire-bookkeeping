# EasyFire Bookkeeping Feature Readiness

**Updated:** 2026-07-20

**Foundation:** 1.7.0

**Readiness level:** Full

**Current status:** Locally validated Direct-Codex recovery patch on top of the
published candidate. Newsec runtime, edge, checkpoint, and current backup
authority are reconciled, but this patch is not yet committed or published and
no candidate rehearsal, native login, or cutover has run.

## Outcome and scope

The target outcome is a recoverable, single-owner bookkeeping site whose
verified source is EasyFire-owned, publicly available under AGPL-3.0, and
reconciled to the authenticated hosted runtime. Source publication and runtime
acceptance are proven independently; neither is inferred from this document.

In scope:

- direct EasyFire/Codex repair of the existing EasyFire/Bigcapital candidate;
- deterministic source, image, archive, journal, backup, and restore controls;
- static, build, synthetic E2E, disposable Docker, backup, and restore proof;
- accepted-source and public-mirror publication after proof;
- read-only runtime reconciliation and authenticated live acceptance after
  publication;
- a fresh installation only if later required and proven to have no existing
  MariaDB volume;
- at most one uniquely labeled synthetic persistence record, with removal of
  only its exact identifier, if live persistence proof remains necessary.

Out of scope:

- Agent Foundry execution or ownership;
- real LLC, tax, bank, customer, vendor, or opening-balance entry;
- automated production owner bootstrap or owner recovery;
- adoption or in-place upgrade of any historical, project-labeled, or
  action-derived MariaDB/Redis volume;
- implicit or in-place migration of existing data outside the separate
  `MigrationSource` and blue/green authority boundary;
- Cloudflare application, Tunnel, DNS, token, or binary replacement; their exact
  identities are already proven and the pinned cloudflared service is running;
- broad cleanup or deletion;
- Bigcapital upstream mutation.

## Data And Persistence

- The local repair touches source and sanitized synthetic fixtures only.
- Production MariaDB and Redis volumes, attachments, credentials, journals,
  releases, and recovery units remain outside Git. Recovery copied the exact
  database authority into a private backup without inspecting or changing any
  accounting record.
- Action-derived volumes are durable authority, never cleanup artifacts.
  Rollback preserves the exact observed subset even after partial creation.
- Existing-data import is authorized only through the separate blue/green
  controller. A current exact `MigrationSource` recovery unit passed isolated
  restore. The implementation binds candidate-only resources, but no live
  rehearsal, import, or cutover has run.
- Each backup recovery unit is its compressed dump, adjacent SHA-256 sidecar,
  and adjacent authority-bound metadata; retention must keep them together.

## Security And Privacy

- The intended edge is pre-existing Cloudflare Access and Tunnel restricted to
  one owner identity. Read-only API proof shows the sole owner policy, ingress,
  DNS, and tunnel token are exact. The pinned cloudflared service is Running
  with Automatic start and exact binary/process/connector identity; no token
  value is exposed here.
- Native application authentication remains required. Production signup is
  disabled and both signup allowlists must be empty.
- Newsec and its Docker runtime are owner-controlled trusted compute, but trust
  does not substitute for journal, inventory, archive, or backup proof.
- MariaDB/Redis volumes contain durable production state and are never release
  cleanup targets.
- Credentials, journals, backups, attachments, and real financial data stay
  outside Git.
- All user-controlled inputs retain server-side validation and authorization.

## Production action contract

- Preflight performs read-only environment/provider checks and writes a
  short-lived local schema-2 receipt bound to the controller, archive, archive
  manifest, exact four-file deployment controller bundle, target image
  references, credential file, inventory, action-derived volumes, and edge
  identity.
- Action requires an exact confirmation ID and current receipt. It extracts and
  seals the archive, journals a hash-bound environment candidate before atomic
  publication, builds and records exact image IDs, creates fresh action-derived
  volumes, and binds a one-shot migration container before recording its
  single start authorization. Migration has a bounded timeout. Action then
  creates and isolated-restore-verifies a metadata-backed baseline recovery
  unit, starts the app tier, and records exact immutable inventory.
- Action is not complete until mandatory Postcheck proves the sealed release,
  exact controller/container/image/mount/network/port/foreign-consumer
  identity, the daily backup task, local health, signup restrictions, verified
  baseline recovery unit, and unchanged verify-only edge connector identity.
- Rollback preserves volumes, releases, backups, journals, and edge resources.
  It removes only the exact daily backup task when recorded as created by that
  ActionId, plus its Compose containers and network. If the app ever started,
  it first creates and isolated-restore-verifies an emergency backup.
- Any historical, project-labeled, or action-derived MariaDB/Redis volume,
  including `bigcapital_prod_mysql` and `bigcapital_prod_redis`, stops before
  Action. Prior action/database authority stops with
  `DATABASE_ENGINE_MIGRATION_REQUIRED`.
- A resumable interrupted Action is the only exception: exactly the two volumes
  already bound to that ActionId and compatible schema-2 journal phase may be
  present. No historical or foreign volume can be adopted.
- Unattended startup uses Compose `restart: unless-stopped`. The retired startup
  helper cannot register a task; the daily backup task is the controller's only
  scheduled-task mutation. It invokes the fifth `ScheduledBackup` stage from
  the exact sealed installed four-file controller bundle through canonical
  Windows PowerShell and passes the exact deployment-owner SID bound into the
  schema-2 journal. It never invokes `backup.ps1` directly, and a missing,
  changed, or noncanonical owner SID fails closed.
- Baseline, emergency, and scheduled backups publish one crash-resumable recovery unit:
  compressed dump, SHA-256 sidecar, and authority-bound metadata under a unique
  journaled operation ID. Hash/gzip and isolated network-disabled restore proof
  are required before the receipt is valid.

The separate existing-data migration controller executes journaled `Plan`,
`Rehearse`, `AcceptAuthentication`, `Cutover`, and `Rollback` stages. It binds a
full ten-file executable bundle, the target release, all seven exact image
identities, complete mount/port identity, and task recovery XML. Candidate
MariaDB and Redis continuity is fail-closed, including TTL-safe Redis evidence;
backup and rollback are crash-resumable. It may replace the daily backup task
and retire the legacy startup task only during gated Cutover after backup,
rollback, authentication, and migration proof pass.

## Provider And Dependency Decisions

- Bigcapital remains the locally editable AGPL-3.0 accounting foundation;
  replacing its domain model would add disproportionate migration risk.
- Cloudflare Access/Tunnel/DNS/cloudflared is pre-existing hosted edge
  infrastructure. The controller uses read-only verification and exposes no
  direct database or backup authority to it. Edge replacement is separable
  behind loopback Envoy and requires its own approval.
- Node.js 22.23.1, pnpm 10.34.5, the workspace lockfile, and pinned production
  images are the current toolchain contract.
- The complete production dependency audit reports 45 advisories: 9 low, 36
  moderate, 0 high, and 0 critical. Build-only packages were moved out of
  production dependencies, and patched runtime transitives are enforced by the
  workspace lock and regression tests.

## Impact And Runtime

- Documentation/source-disclosure changes use the focused release-readiness
  test. Application/dependency changes require frozen install, typecheck, build,
  focused tests, and synthetic E2E. Controller/Compose changes additionally
  require parsing, static validation, crash matrix, disposable Docker,
  migration, recovery-unit restore, Postcheck, and rollback proof.
- Runtime truth is the exact completed Newsec schema-2 journal plus successful
  Postcheck, never this checkout or historical Agent Foundry evidence.
- Publication, provider mutation, deploy/restart/rollback, migration/restore,
  scheduled-task changes, owner onboarding, and real financial-data mutation
  remain separate state-changing boundaries.
- Runtime artifacts and provider payloads stay outside Git.

## Proof required for promotion

- Focused release-readiness regression test.
- Frozen pnpm install with committed lockfile and Node.js `22.23.1` / pnpm
  `10.34.5` toolchain contract.
- Format, lint, typecheck, webapp/server/shared builds, and focused tests.
- Secret/privacy scan that reports classifications without printing values.
- Production dependency-audit disposition: complete at 45 advisories (9 low,
  36 moderate, 0 high, 0 critical).
- Production static validator and PowerShell parsing.
- Docker Compose config using synthetic fixture values.
- Disposable isolated boot, migration, health, backup, integrity, restore,
  postcheck, and rollback proof.
- Final disposable proof ID: `b37426f03a8841d9923b853db5f40a08`; the record
  shows passed application/auth/recovery proof, unchanged empty production
  inventory, and exact zero-resource teardown.
- Independent read-only release review.
- Final recovery-controller proof: 76/76 combined tests after the final
  containment fix (75 prior plus one negative case), including 12/12
  action-plus-recovery tests; static validator 101/101; release-readiness 14/14;
  repository-wide tests 135/135; PowerShell parser 7/7; foundation 4/4;
  source-size guard 0 blockers.
- Two independent final read-only reviews returned GO, including targeted
  containment proof at 2/2. Live Cutover remains separately gated by rehearsal,
  owner native authentication, and live backup/rollback proof.
- Same accepted commit on Forgejo and public GitHub.
- Anonymous corresponding-source readback.
- Newsec SSH, journal/runtime reconciliation, Access/Tunnel/DNS/token identity,
  and the pinned Running/Automatic cloudflared service are proven. Six legacy
  runtime containers are healthy and the migration container exited 0. Both
  legacy tasks remain enabled/Ready with `LastTaskResult=1`.
- The live-runtime checkpoint manifest SHA-256 is
  `0AEE8A2D577B102ECA6E61B8D4063363C7420845D27BDB957BDCA4DCC66525BE`.
  The current `MigrationSource` backup SHA-256 is
  `229ED021892F495AF84219596713C24C6B30676856601B0F3AC19F7E175FB54D`,
  and isolated restore passed.
- Authenticated live candidate acceptance still requires the owner to enter a
  native password/MFA/CAPTCHA only if prompted after Rehearse.
- A fresh-install production Postcheck only if a later production Action is
  actually necessary and compatible.
- A separately designed and proven first-owner onboarding path before any truly
  fresh installation can be called usable or login-ready.

## Recovery Notes

Recovery changed only the approved cloudflared service state and created private
checkpoint/backup evidence. It did not inspect or change any accounting record,
rewrite the correct Access/Tunnel/DNS/token authority, or discard an original
volume, journal, release, or backup. Source publication of this patch has not yet
occurred; when performed, it changes only the two EasyFire repositories and
does not itself turn the candidate into a deployed runtime.

Recovery starts with the verified full filesystem checkpoint in `HANDOFF.md`.
Fresh-install production recovery uses the schema-2 action journal, sealed
release manifest, verified backup receipts, and bounded rollback. The true next
path is to publish the exact patch to the two EasyFire remotes, build an
immutable Newsec release and seven pinned images, create a new migration Plan,
Rehearse, complete owner native login if prompted, run the
`AcceptAuthentication` source recovery drill, and Cutover only after every gate
passes. Post-cutover proof must cover the replacement backup task, absence of
the legacy startup task, runtime/edge health, and a new current backup with
isolated restore.
