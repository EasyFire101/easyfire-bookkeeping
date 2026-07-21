# EasyFire Bookkeeping Handoff

**Updated:** 2026-07-20

**Owner:** Direct Codex takeover for EasyFire

**State:** Published base plus an uncommitted, locally validated Direct-Codex
recovery patch. Exact Forgejo and anonymous GitHub readback, not this document,
are publication authority. Newsec SSH works, the exact cloudflared service is
running automatically, a verified live-runtime checkpoint exists, and a current
`MigrationSource` recovery unit passed isolated restore. The older production
runtime remains live. No candidate rehearsal, native login, cutover, or
publication of this recovery patch has occurred.

## Source state

- Local branch: `codex/easyfire-bookkeeping-autonomy-recovery-20260718`.
- Upstream base (not the candidate HEAD):
  `8c90ca328ec59dd772de3b385531eb386de11ac8`.
- Upstream-only remote: `origin` (Bigcapital); never push EasyFire changes
  there.
- Accepted-source destination: `easyfire-forgejo/main`.
- Public AGPL mirror:
  `https://github.com/EasyFire101/easyfire-bookkeeping`.
- Initial accepted-source publication commit:
  `0f31d192195def0f8fe58a1532282b88609eb822`.
- A follow-up source correction tracks the four root inputs that the committed
  validators already consumed: `.editorconfig`, `.env.production.example`,
  `AGENTS.md`, and the historical Agent Foundry handoff. Exact final remote
  readback remains authoritative.
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
- Replaced the planning-only migration gate with a journaled blue/green
  controller that executes `Plan`, `Rehearse`, `AcceptAuthentication`,
  `Cutover`, and `Rollback` through candidate-only resources. It binds a full
  ten-file executable bundle, all seven exact image identities, complete
  mount/port authority, TTL-safe Redis continuity, crash-resumable backup and
  rollback, and task replacement/retirement only at gated Cutover.

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
- Final migration/recovery combined tests: 76/76 passed after the containment
  repair, including the added negative case; the action-plus-recovery subset is
  12/12.
- Repository-wide tests: 135/135 passed, including the 15,000-file
  materialization benchmark that had previously failed only under concurrent
  machine load.
- Static no-deploy validator: 101/101 passed.
- Focused release-readiness suite: 14/14 passed.
- PowerShell 5.1 parser: 7/7 relevant scripts passed; project foundation: 4/4;
  source-size guard: 0 blockers.
- Repository-wide inherited debt is disclosed, not rewritten: 3,023 formatting
  findings; 645 web lint findings (81 errors, 564 warnings); and 43 web type
  errors in 26 files. None of the web type errors overlap the 7 changed web
  source files; server typecheck and the full production build pass.
- Disposable Docker proof: `b37426f03a8841d9923b853db5f40a08` with
  `proofPassed=true`, `builtServerAuthPassed=true`, `cleanupPassed=true`,
  unchanged empty production inventory, and zero containers, volumes, or
  networks after exact teardown.
- Independent read-only review: two final reviewers returned GO, including
  targeted containment proof at 2/2. Live migration remains separately gated by
  rehearsal, owner native authentication, and the controller's backup/rollback
  proof.
- Release-input audit: the initial publication accidentally omitted four
  required root files that remained untracked in the validation worktree. The
  follow-up correction tracks those exact files so a clean checkout contains
  every input used by the foundation, readiness, security, and production
  validation checks.

## Production applicability

- The production controller is **fresh-install-only**.
- Any historical, project-labeled, or action-derived MariaDB/Redis volume,
  including `bigcapital_prod_mysql` and `bigcapital_prod_redis`, is a hard stop.
  A supplied `PriorActionId` or prior database authority also stops with
  `DATABASE_ENGINE_MIGRATION_REQUIRED`.
- The only volume exception is an interrupted current Action: a resume may see
  the exact two ActionId-derived volumes already bound to the same valid
  schema-2 journal at a compatible phase. It cannot adopt any other volume.
- Existing MariaDB data uses the separate `MigrationSource` backup role and
  `migration-action.ps1` Plan/Rehearse/Cutover/Rollback authority. The tool
  derives candidate-only resources; binds the target release, full ten-file
  controller bundle, seven exact image identities, mount/port authority, and
  task-recovery XML; executes journaled `Plan`, `Rehearse`,
  `AcceptAuthentication`, `Cutover`, and `Rollback`; and preserves exact
  rollback operations. Cutover remains fail-closed until live backup,
  rollback, authentication, and migration proof all pass. Never mount the old
  data directory under the candidate MariaDB image.
- The production controller verifies but never mutates Cloudflare, Access,
  Tunnel, DNS, the cloudflared binary, or the Windows cloudflared service.
- Automated owner creation/recovery is unavailable.
- The candidate does not use a startup task; Compose
  `restart: unless-stopped` owns unattended container restart. The legacy
  startup task remains registered until gated Cutover retires it, and the
  legacy daily backup task remains until Cutover replaces it.
- Action ends pending Postcheck; only a successful exact-identity Postcheck can
  mark its schema-2 journal completed.

## Runtime drift status

- Newsec SSH works. Six long-running `easyfire-bookkeeping-prod` containers are
  healthy on the older Agent Foundry-origin release, and its one-shot migration
  container exited successfully with result 0.
- Existing MariaDB and Redis volumes contain durable production authority and
  were created before this candidate. The old action journals are not compatible
  with the schema-2 controller. A fresh Action would stop and must not replace,
  mount, or adopt those volumes.
- Both legacy scheduled tasks remain enabled and Ready with
  `LastTaskResult=1`. Their checkpoint XML hashes are preserved; replacement of
  the daily backup task and retirement of the startup task occur only at gated
  Cutover.
- Read-only API proof shows the protected credential file's sole owner email
  already matches the one exact allow policy. The earlier denial used a
  different Google identity; the correct policy was not rewritten.
- Tunnel ingress, DNS, Access policy, and token identity match the exact tunnel.
  `EasyFireBookkeepingCloudflared` is Running with Automatic start, and its
  binary/process/connector identity is proven without exposing the token.
- The verified live-runtime checkpoint manifest SHA-256 is
  `0AEE8A2D577B102ECA6E61B8D4063363C7420845D27BDB957BDCA4DCC66525BE`.
  The current `MigrationSource` backup SHA-256 is
  `229ED021892F495AF84219596713C24C6B30676856601B0F3AC19F7E175FB54D`,
  and its isolated network-disabled restore passed.
- Every original volume, journal, release, and backup is preserved. No
  accounting record was inspected or changed. No live candidate rehearsal,
  native login, or cutover has run.

## State mutations or approvals

- Direct takeover owns local source and documentation repair; Agent Foundry is
  provenance only.
- Recovery work changed only the approved cloudflared service state and created
  private recovery evidence. It did not rewrite Access, Tunnel, DNS, or the
  matching token, and no token value is stored here.
- The current backup and isolated restore proof did not inspect or change an
  accounting record. All original production data authority remains preserved.
- Source-control publication has not yet occurred for this recovery patch. It
  may change only the two EasyFire repositories and is established by exact
  remote readback outside this self-referential source record.

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
  of the same final correction commit.
- The healthy hosted revision is older than this candidate and uses incompatible
  journals and existing durable volumes. The current recovery unit is proven,
  but both legacy tasks still report `LastTaskResult=1` and remain unchanged
  until gated Cutover.
- Access, Tunnel, DNS, token identity, and cloudflared runtime are proven. Native
  application authentication and candidate behavior remain unproven live.
- This exact recovery patch is locally validated but not committed or published
  to the EasyFire remotes.

## Next safe action

Commit and publish only the exact verified recovery source to
`easyfire-forgejo/main` and `easyfire-github/main`, then build the immutable
release and seven pinned images on Newsec. Create a new migration `Plan`, run the
candidate-only `Rehearse`, and request only the owner's native
password/MFA/CAPTCHA if the login flow prompts for it. Run
`AcceptAuthentication` to prove the source recovery drill. Run `Cutover` only
if backup, rollback, authentication, and migration proof all pass; then verify
the replacement backup task, absence of the legacy startup task, runtime/edge
health, and a new current backup with isolated restore. Do not run the
fresh-install Action against the existing volumes.
