# EasyFire Bookkeeping Handoff

**Updated:** 2026-07-23

**Owner:** Direct Codex takeover for EasyFire

**State:** The original Windows runtime remains live and is the sole writer and
rollback authority; no cutover has occurred. The production VM
`easyfire-bookkeeping-newsec` is off. The isolated v6 rehearsal accepted the
checkpoint restore, once-only migration, fixed deployment plan, six-container
health, and loopback HTTP gates. Fresh backup `20260723T075310Z` then passed a
network-disabled isolated restore with 87 tables, 1/1/1/1 identity counts, and
schema SHA-256
`24b5ab66959a6971e67a321f3f2583b896aebd091760a1880275f53bb55af853`.
Rollback lock/reboot/rearm and the bounded Guardian exercise also passed.

The required runtime-recovery gate did not pass. The immutable release's
`--verify-existing` path checked container health while Docker live-restore was
still reporting `starting`. A bounded compatibility continuation retried the
stack unit three times in two minutes, then timed out after 180 seconds while
Gotenberg was still settling. No deployment receipt was moved and no recovery,
normal-reboot, or final-rehearsal proof was published. The rehearsal is safely
stabilized with the stack service active, six healthy containers, HTTP 200, and
the original deployment receipt and Guardian proof unchanged. The same recovery
gate has now failed twice, so this run stopped without a third attempt.

## Source state

- Local branch: `codex/easyfire-bookkeeping-linux-vm-migration-20260721`.
- Backup compatibility checkpoint:
  `0d09f440ac018f6c738474fceedd4f3848689e26`.
- Manifest-mode and transient-health recovery checkpoint:
  `ef2d042ff3af570ed3a526eaca4a0de8da353e2f` (local and unpublished).
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

## Superseding direct-to-VM endpoint

- Production target: one dedicated Ubuntu 24.04 Hyper-V VM named
  `easyfire-bookkeeping-newsec` on the owner-controlled Newsec host.
- Installed base: Docker Engine 29.6.2, Compose 5.3.1, Node.js 22.23.1,
  systemd, Tailscale 1.98.9, and 2 GiB swap. The VM has an isolated internal
  network with outbound NAT and no inbound mapping.
- All seven Compose services use `restart: "no"`.
  `easyfire-bookkeeping-stack.service` is the sole boot/start authority and
  invokes the fixed-plan read-only verifier before starting existing
  containers. Raw Compose, Docker restart policy, and Windows Scheduled Tasks
  are not boot authority for the target.
- The systemd Guardian runs from a bounded timer. It may recover only the exact
  stateless Gotenberg, server, webapp, and Envoy containers. MariaDB and Redis
  are observe-only; any data-service fault stops automatic recovery.
- The only approved ingress is tailnet-only Tailscale Serve HTTPS for
  `easyfire-bookkeeping-newsec.taild63e9b.ts.net`, proxying to
  `http://127.0.0.1:8080`. Funnel, public listeners, Cloudflare cutover, and
  direct data-service exposure are prohibited.
- Destructive, rollback, reboot, and Guardian recovery rehearsal must run on the
  separate isolated VM `easyfire-bookkeeping-rehearsal-newsec`. Its machine ID,
  SSH host key, IP, MAC address, and recovery checkpoint are distinct from the
  production VM. The production VM is not the rehearsal VM.
- The complete Windows runtime, volumes, releases, journals, tasks, backups,
  and edge remain preserved. Windows remains live until backup/restore,
  release/checkpoint/cutover authority, native authentication, separate-VM
  rehearsal, rollback, reboot, Guardian recovery, final quiescence,
  single-writer, and private-route proofs all pass.

## Current direct-to-VM recovery authority

- Primary checkpoint:
  `direct-vm-preflight-20260721-193735`, held outside Git in the preserved
  Newsec recovery root and a second owner-controlled recovery location.
- The SQL payload is 17,752 bytes with SHA-256
  `CBC01039C4A779180244AF076B1DE45D5E3BCD10CA4039E49C4A3208B56ED18E`.
- The Redis RDB is 7,193 bytes with SHA-256
  `0D2DEA10EAC9C53EC377F6BBD9BDC8947F909A119E423332C8597C9A88745984`.
- The schema-v2 transfer producer verified all 16,434 file-manifest entries,
  exact payload bytes/hashes, source MySQL/Redis container/image/volume
  identity, dual-location evidence, and source preservation. The isolated
  network-disabled restore passed 17/70 tables and 1/1/1/1 identity counts.
- Release-manifest v2 separates OCI index, Linux/amd64 manifest, and Docker
  engine image identity and is checked against source, image bundle, Guardian,
  systemd, and target-engine evidence.
- The cutover contract is exclusive and hash-bound across Windows source
  quiescence, final checkpoint payloads, Linux deployment/backup/rollback/
  reboot/Guardian proof, native authentication, single-writer state, and
  private-route activation.
- The transfer producer preserves its byte-locked live-preflight behavior and
  now also has an explicit opt-in final-quiesced mode. Final mode requires the
  exclusive quiesce receipt, cutover plan, and post-quiesce source snapshot;
  proves MariaDB/Redis healthy on their original volumes; proves all six
  stateless/source-route writers stopped with restart `no`; and hash-binds the
  complete receipt/plan/snapshot chain. Focused checkpoint and cutover tests pass
  24/24.
- The identity-separated empty rehearsal VM export is preserved at
  `C:\Hyper-V\easyfire-bookkeeping-rehearsal-newsec\recovery\identity-separated-empty-export-20260722-073615`.
  Its manifest SHA-256 is
  `4041AD48E1F0D7348F3738F82C84EA467A29204FA65ACBDC2A7313EF5EF00594`;
  all 5 files (5,622,391,330 bytes) passed a second full hash replay. The bound
  identity evidence SHA-256 is
  `D904D17C71E8F39DE486B5C9FA98F588887221B5FF12B9FE5AD7DE90ACFB8494`.

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

## Historical Windows direct-takeover repairs

The following controls remain preserved as dated recovery provenance. They no
longer define the intended production endpoint.

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

The direct-to-VM source currently records:

- Current Linux/direct-plus-Guardian selected suite: 184/184 passed, including
  all 14 installed CLIs through the required `current` symlink and fail-closed
  path canonicalization.
- Guardian build/tests: 31/31 passed; Guardian TypeScript typecheck passed.
- Release-readiness suite: 25/25 passed, including the linked-worktree
  commit-message hook contract: use the repository-pinned commitlint, resolve
  its Lerna scope provider from the project root, and validate Git's exact `$1`
  message path. Static no-deploy validation: 101/101 passed. Production syntax,
  direct-to-VM PowerShell parsing, and project foundation checks passed.
- Full preserved-root replay: 16,434 manifest entries and approximately
  771 MiB rehashed successfully. A Windows SMB long-path `realpath` failure was
  found and corrected with cached no-reparse directory traversal checks.
- Release-manifest v2 closes 36 exact executable/imported artifacts, source
  archive provenance, OCI bytes, target-engine identity, Guardian/systemd bytes,
  and all Windows/Linux cutover helpers into one immutable authority.
- Source-size guard reports 0 blockers and 19 advisory candidates. Diff, shell,
  JSON, and focused syntax checks pass. No live provider or Docker mutation was
  used as source proof.
- Targeted independent Guardian review and re-review returned PASS after closing
  timer-causality and wall-clock-bound findings. Any later executable-byte drift
  invalidates that verdict and requires fingerprint revalidation.

The earlier Windows candidate dependency and application snapshot remains
recorded below as historical compatibility evidence:

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

### Superseding Linux VM contract

- The Linux VM controller consumes only a coherent immutable release, exact
  image bundle and target-engine evidence, root-owned production environment,
  schema-v2 transfer checkpoint, and fixed deployment plan.
- Candidate resources are new and deployment-ID-derived. The source Windows
  volumes are never mounted by the target and remain rollback authority.
- The once-only migration container must exit 0. Restore validation must prove
  17 system tables, 70 tenant tables, the four 1-count identity invariants, and
  the exact 37 protected accounting tables at their approved counts.
- Promotion first proves existing-container identity while restart remains
  `no`; systemd then becomes the only start authority. A completed deployment
  receipt is written only after activation proof.
- Guardian recovery is stateless-only. MariaDB/Redis remain observe-only.
- Rollback lock, reboot persistence, separate rehearsal VM, backup/isolated
  restore, native login, final source quiescence/checkpoint, single-writer
  evidence, and private Tailscale route activation are mandatory cutover gates.
- Tailscale Serve must be absent before activation and exact/tailnet-only after
  activation. Funnel and public host port 443 are forbidden.

### Historical Windows applicability

The following rules describe the preserved Windows candidate and rollback
history; they must not be used to construct the superseding endpoint.

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

- The original Windows runtime on Newsec remains live and is the only writer.
  Its containers, MariaDB/Redis volumes, releases, journals, tasks, backups,
  Cloudflare route, and private proxy remain preserved for rollback. These
  resources are not the intended long-term endpoint.
- The Ubuntu production VM `easyfire-bookkeeping-newsec` is off. It has not
  received production traffic, no production cutover occurred, and no Windows
  writer was quiesced.
- The current v6 rehearsal instance is running only on its isolated private
  switch. It has no public listener, Tailscale Serve, Funnel, or production
  route.
- Rehearsal v6 successfully restored the verified preflight checkpoint, ran the
  migration exactly once with exit zero, passed fixed-plan
  `--verify-existing`, and has six healthy long-running containers. Loopback
  returned HTTP 200 for `/`, `/api/system_db`, and `/api/auth/meta`. Its
  deployment-plan SHA-256 is
  `e4e4cac6ee8e56997a645b83a57689b73169b66b7053022ea91f9f7992907fc0`.
- Guest-native backup attempt `20260723T031624Z` created preserved database,
  Redis, source, and authority evidence. Its network-disabled isolated restore
  container exited one and no `COMPLETE` marker or `backup-receipt.json` was
  written, so the unit is incomplete and must never be promoted or reused.
- The exact failure is a compatibility conflict: the pinned MariaDB image
  supplies `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`, while
  `linux-backup-verify.sh` also supplies `MYSQL_PASSWORD_FILE` and
  `MYSQL_ROOT_PASSWORD_FILE` to the isolated proof container. This is not
  evidence of accounting-record corruption.
- The source compatibility repair clears the image-inherited direct password
  variables before supplying the file-based variants. Fresh backup
  `20260723T075310Z` is complete and its network-disabled isolated restore
  passed 87 tables, 1/1/1/1 identity counts, and schema SHA-256
  `24b5ab66959a6971e67a321f3f2583b896aebd091760a1880275f53bb55af853`.
- Rollback lock `4b9214a5-4b1f-4754-bd02-77bd56f13920`, locked reboot, and
  rearm passed. Guardian runtime proof passed with SHA-256
  `71954267a05641a5aa44f482618f5d72c4bed2edfef9ceebbead25f40121cf09`.
- Runtime recovery failed twice because the sealed release's fixed-plan
  verifier treats Docker's transient `health=starting` state as an immediate
  failure. The bounded continuation's three stack retries in two minutes
  exhausted before Gotenberg settled, and the continuation timed out at 180
  seconds. It stopped before receipt movement or invalid-authority testing.
- The rehearsal was returned to a clean state without rerunning recovery:
  `easyfire-bookkeeping-stack.service` and Docker are active, all six
  application containers are healthy, loopback `/` returns HTTP 200, deployment
  receipt SHA-256 remains
  `d8db2ce98169deb3ed5e46c6891a3189a561825beeab3fa0243beabb4a9ef3e2`,
  and recovery/normal-reboot/final proof outputs remain absent.
- Tailscale reports `NeedsLogin`, but enrollment has not been attempted because
  backup/recovery proof comes first. It consumed no material waiting time and
  is a pending gate rather than an active blocker.
- Do not reprovision a VM, rebuild the validated release, or repeat the passed
  restore, once-only migration, fixed-plan, container-health, or loopback HTTP
  gates unless an input governing that gate changes.
- The current preflight checkpoint and isolated restore are verified. A new
  final checkpoint must be captured only after the exclusive source-quiesce
  receipt proves MariaDB/Redis healthy and all Windows writers/routes stopped
  with restart `no`.
- Every original volume, journal, release, backup, and recovery artifact remains
  preserved. No accounting record was inspected or changed by this source/doc
  work.

## State mutations or approvals

- Direct takeover owns local source and documentation repair; Agent Foundry is
  provenance only.
- The approved direct-to-VM work provisioned both Ubuntu VMs. The production VM
  remains off with no production application route. The rehearsal VM contains
  only the private isolated candidate, restored checkpoint, proof resources,
  and preserved failed attempts described above.
- The approved rehearsal created backup/restore, rollback/reboot, Guardian, and
  failed-recovery evidence only on the isolated rehearsal VM. It did not stop
  the Windows writer, change Cloudflare, authorize Tailscale, or intentionally
  mutate an accounting record.
- Earlier Windows recovery work changed only the then-approved cloudflared
  service state and created private recovery evidence. It did not rewrite
  Access, Tunnel, DNS, or the matching token, and no token value is stored here.
- The current backup and isolated restore proof did not inspect or change an
  accounting record. All original production data authority remains preserved.
- Source-control publication has not yet occurred for this recovery patch. It
  may change only the two EasyFire repositories and is established by exact
  remote readback outside this self-referential source record.

## Known risks before promotion

- The production dependency graph has 36 moderate and 9 low advisories. It has
  no high or critical advisories, but the remaining findings stay disclosed and
  should be reviewed during future dependency refreshes.
- A prior commit-bound release reached deterministic bundle production and
  isolated engine load. The real engine then exposed the digest-inspection
  compatibility repair described below, so one final containing commit and
  immutable rebuild are required before fixed-plan, restore, migration, and
  systemd proof.
- The replacement release/proof implementation now closes the previously
  impossible reboot receipt, preflight/final-checkpoint conflation, missing
  OCI/engine/auth/rehearsal producers, backup-directory trust, and offline-image
  identity gaps. A real rehearsal invocation then exposed and closed a shared
  symlink-entrypoint bug across all 14 installed CLIs; the fail-closed helper is
  the final artifact in that historical 35-artifact closure. Current-byte proof
  for that closure passed 42/42 focused,
  120/120 Linux/direct,
  30/30 Guardian, 101/101 static-production, and 24/24 release-readiness checks;
  both final independent reviews passed and source-size has zero blockers.
- The first executable OCI run correctly rejected legacy `docker save` inputs.
  The producer now interoperates with standards-compliant Skopeo layouts while
  retaining exact pinned inner-index, platform, descriptor, blob, and canonical
  output authority; its producer/release matrix passes 43/43 and classic Docker
  `manifest.json` archives remain forbidden.
- The first commit-bound Buildx export exposed one additional standards-shaped
  annotation combination: Buildx records the full repository/tag in
  `io.containerd.image.name` and only the tag in
  `org.opencontainers.image.ref.name`. The producer now accepts that pair only
  when the full name exactly matches the expected role and the bare tag exactly
  matches its expected tag. Bare tags without a full-name authority and all
  mismatches still fail closed; the focused producer suite passes 13/13.
- Docker Engine 29.6.2's containerd image store lists a loaded OCI index under
  its exact tag but does not resolve `docker image inspect <tag>` for that
  index. It does resolve the bundle-proven root-index digest and returns the
  exact bound `RepoTags`/`RepoDigests`. Target-engine evidence now inspects each
  bundle-proven digest and still requires its returned ID, tag, and optional
  external digest authority to match exactly. The failed tag-based attempt
  wrote no evidence and created no container or volume.
- Release-manifest provenance then refused Git's case-ambiguous `EE`/`ee`
  directory prefixes. The physical Windows checkout and every application
  import already use `EE/Workspaces`; only Git's 20 recorded Workspaces paths
  retained lowercase `ee`. Those paths are normalized to `EE` with all 20 blob
  identities unchanged. The failed manifest attempt wrote no manifest and did
  not create a container or volume. The prefix-aware Git scan reports zero
  remaining collisions; the seven-project build and server typecheck pass.
  The repository-wide typecheck still reports the pre-existing webapp type
  backlog after all build dependencies exist; no server or Guardian typecheck
  fails.
- The resulting `45e2bc20946a65cbffbabac6a7b2fbf8e95d03af` release successfully
  produced and loaded its deterministic OCI bundle and published target-engine
  evidence plus a release manifest with no runtime containers or volumes. A
  pre-deployment readback then found a fail-closed contract contradiction: the
  deployment controller allowed only the production Docker hostname while the
  mandatory rehearsal evidence allowed only the separate rehearsal hostname.
  The repaired plan now binds an exact `target.role`/`target.hostname` pair;
  deploy and verify-existing enforce the same plan-bound hostname, while a
  target-less legacy plan remains production-only. The reboot order in the
  runbook is also corrected to arm, bind the plan, locked reboot, verify/rearm,
  exercise, normal reboot, authenticate, then collect. Current source proof is
  184/184 Linux/direct-plus-Guardian selected tests, 31/31 standalone Guardian
  tests plus typecheck, 101/101 static validation, 24/24 release readiness, and
  zero changed-file source-size blockers. The replacement immutable release must be
  rebuilt from the final containing commit; the `45e2bc20` release must not be
  used for rehearsal deployment.
- A repository-wide parallel run reported only the unchanged Windows 15,000-file
  timing guard above its 90-second ceiling under host contention. Its immediate
  isolated rerun passed all 14/14 production-I/O tests; no changed Linux release
  or Guardian test failed.
- The current v6 rehearsal instance, using guest hostname
  `easyfire-bookkeeping-rehearsal-newsec`, successfully restored the preserved
  checkpoint, ran the migration exactly once with exit zero, passed
  fixed-plan `--verify-existing`, started all six long-running containers
  healthy, and returned HTTP 200 for `/`, `/api/system_db`, and
  `/api/auth/meta` on `127.0.0.1:8080`. Its exact deployment-plan SHA-256 is
  `e4e4cac6ee8e56997a645b83a57689b73169b66b7053022ea91f9f7992907fc0`.
  These restore, once-only migration, plan, container-health, and loopback HTTP
  gates are accepted and must not be repeated unless their bound release, plan,
  checkpoint, environment, or authoritative state changes.
- Guest-native backup attempt `20260723T031624Z` created preserved database and
  Redis payloads, but its isolated restore container exited one before a
  `COMPLETE` marker or `backup-receipt.json` could be written. The exact failure
  was `Both MYSQL_PASSWORD and MYSQL_PASSWORD_FILE are set (but are exclusive)`:
  the pinned MariaDB image carries direct password variables while the proof
  container also supplied file-based password variables. The attempt and its
  proof volume remain preserved but are incomplete and untrusted; never reuse
  them as the fresh proof.
- Backup/isolated-restore, rollback-lock/rearm, and Guardian receipts passed.
  Runtime recovery remains failed; therefore normal-reboot proof, native owner
  authentication, production staging, final source quiescence, single-writer
  proof, private-route activation, and cutover remain pending. Tailscale
  `NeedsLogin` is not the cause of this stop and must not be attempted before
  the recovery gate passes.
- The durable source repair writes the final release manifest as `0644`, rejects
  any other installed manifest mode, and waits up to 120 seconds only for
  containers that are both running and transiently `health=starting`.
  Unhealthy, missing-health, and invalid states still fail immediately. Focused
  release/deployment tests passed 38/38, Guardian tests 16/16, adjacent tests
  31/31, syntax 4/4, diff check, and source-size with zero blockers. These bytes
  are not part of the immutable rehearsal release and cannot retroactively
  validate it.
- Source authority requires exact Forgejo readback and anonymous GitHub readback
  of the same final correction commit.
- The current direct-to-VM source is locally validated. Its final containing
  commit is established by Git rather than this self-referential document; no
  direct-to-VM commit has yet been published to the EasyFire remotes.
- Windows is intentionally still live and remains the sole writer. The
  production VM is off, the rehearsal instance has no Tailscale route, and no
  cutover occurred. Any accidental Linux route or production writer before the
  single-writer receipt would be a hard stop and rollback condition.

## Next safe action

Do not run a third recovery attempt against the current immutable rehearsal
release. Create one new immutable release that contains the tested manifest-mode
and transient-health source repair, bind a new fixed plan to that release, and
run one fresh isolated recovery-only rehearsal. Reuse accepted backup/restore,
rollback, and Guardian evidence only where the new authority contract explicitly
permits it; otherwise regenerate only the evidence invalidated by the changed
release input. If runtime recovery fails again, preserve the evidence and stop.

Only after recovery and normal-reboot proof pass may native authentication and
production staging begin. Production remains Windows until every required
receipt is green; quiesce Windows last, capture the final receipt-bound
checkpoint, prove one writer, and activate tailnet-only Serve only after every
production receipt passes. Stop for owner Tailscale/native-login credentials
when an actual prompt is reached. Preserve Windows stopped as rollback
authority; do not enable Funnel, expose a public port, delete an artifact, or
use the historical Windows fresh-install controller.
