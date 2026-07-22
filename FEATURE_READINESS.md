# EasyFire Bookkeeping Feature Readiness

**Updated:** 2026-07-22

**Foundation:** 1.7.0

**Readiness level:** Full

**Current status:** Locally validated direct-to-VM recovery patch. The isolated
Ubuntu production VM on Newsec is provisioned but has no Bookkeeping stack or
route. Windows remains the sole live writer and preserved rollback authority.
Checkpoint/release/deployment/cutover/private-route authorities exist in source,
and the final-quiesced checkpoint contract now passes its combined compatibility
suite. Immutable release construction, separate-VM rehearsal, native login,
production restore/migration, reboot, and cutover remain open gates.

## Outcome and scope

The target outcome is a recoverable, single-owner bookkeeping site on a
dedicated Ubuntu VM, privately reachable only through Tailscale Serve and
native authentication. Verified corresponding source remains EasyFire-owned
and publicly available under AGPL-3.0. Source publication and private runtime
acceptance are proven independently; neither is inferred from this document.

In scope:

- direct EasyFire/Codex repair of the existing EasyFire/Bigcapital candidate;
- deterministic source, image, archive, journal, backup, and restore controls;
- static, build, synthetic E2E, disposable Docker, backup, and restore proof;
- accepted-source and public-mirror publication after proof;
- immutable Linux release and image publication to an isolated production VM;
- separate-VM rehearsal of restore, migration, authentication, rollback,
  reboot, and Guardian behavior before production activation;
- authenticated private-runtime acceptance and single-writer cutover;
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
- Cloudflare application, Tunnel, DNS, token, or binary mutation; the legacy
  edge remains preserve-only rollback infrastructure and is not the endpoint;
- Tailscale Funnel, a public listener, or any public production route;
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
  transfer/cutover authority. The current schema-v2 checkpoint binds exact
  SQL/RDB payloads, source container/image/volume identity, dual-location
  evidence, and a passed isolated restore. No Linux production import or
  cutover has run.
- Each backup recovery unit is its compressed dump, adjacent SHA-256 sidecar,
  and adjacent authority-bound metadata; retention must keep them together.

## Security And Privacy

- The intended edge is exactly one tailnet-only Tailscale Serve HTTPS host,
  `easyfire-bookkeeping-newsec.taild63e9b.ts.net`, proxying to Envoy at
  `http://127.0.0.1:8080`. Serve activation is hash/receipt-gated. Funnel,
  public host listeners, Cloudflare cutover, and direct MariaDB/Redis exposure
  are prohibited.
- Native application authentication remains required. Production signup is
  disabled and both signup allowlists must be empty.
- Newsec is owner-controlled trusted compute, but production runs inside the
  isolated Ubuntu VM. A separate rehearsal VM owns destructive/reboot proof.
  Host trust does not substitute for receipts, inventory, immutable release,
  checkpoint, backup, or restore proof.
- MariaDB/Redis volumes contain durable production state and are never release
  cleanup targets.
- Credentials, journals, backups, attachments, and real financial data stay
  outside Git.
- All user-controlled inputs retain server-side validation and authorization.

## Superseding Linux VM production contract

- The target is `easyfire-bookkeeping-newsec`, an isolated Ubuntu 24.04 VM with
  pinned Docker Engine/Compose, systemd, Node, and Tailscale.
- Every Compose service declares `restart: "no"`.
  `easyfire-bookkeeping-stack.service` is the sole boot/start authority and
  must pass `linux-deploy-candidate.mjs --verify-existing` against the fixed
  root-owned plan before starting existing containers.
- Release-manifest v2 binds the source archive, image bundle, OCI index,
  Linux/amd64 manifest, engine image IDs, Guardian artifacts, systemd units,
  and target-engine evidence. Mutable tags or checkout paths are insufficient.
- Checkpoint-transfer v2 binds the exact Windows checkpoint ID/timestamp,
  source MySQL/Redis container/image/volume identity, SQL/RDB filenames,
  bytes/hashes, isolated restore, dual-location proof, and preserved source.
- The final checkpoint additionally requires an exclusive source-quiesce
  receipt. MariaDB/Redis stay running and healthy on their original volumes;
  the exact six stateless/source-route writers must be stopped with restart
  `no`. The live-preflight mode remains strict and unchanged.
- Deployment uses only new deployment-ID-derived Linux volumes, a once-only
  migration container, exact 17/70 and 1/1/1/1 restore invariants, and the
  approved 37 protected accounting-table counts. Completion follows systemd
  activation proof, not raw Compose success.
- Guardian is timer-owned, bounded, and stateless-only. It may recover exact
  Gotenberg/server/webapp/Envoy identities. MariaDB and Redis are observe-only;
  any data-service fault requires operator review.
- Rollback lock/rearm, backup/isolated restore, reboot persistence, Guardian
  recovery, and native authentication must pass on a separate rehearsal VM
  before production activation.
- Cutover requires exact Windows source quiescence, a bound final checkpoint,
  healthy Linux deployment, one writer, rollback proof, and tailnet-only route
  proof. The original Windows runtime remains preserved rollback authority.
- Tailscale Serve must be absent before activation and exact after activation.
  Funnel and an ordinary host listener on 443 are hard failures.

## Historical Windows production action contract

The Windows controller rules below are retained as dated recovery provenance.
They no longer define the intended production endpoint.

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
- Tailscale is the only target ingress dependency. Serve remains tailnet-only
  behind loopback Envoy; Funnel is forbidden. The preserved Windows Cloudflare
  stack is historical rollback infrastructure and receives no authority over
  the Linux target, database, backup, or cutover controller.
- Node.js 22.23.1, pnpm 10.34.5, the workspace lockfile, and pinned production
  images are the current toolchain contract.
- The complete production dependency audit reports 45 advisories: 9 low, 36
  moderate, 0 high, and 0 critical. Build-only packages were moved out of
  production dependencies, and patched runtime transitives are enforced by the
  workspace lock and regression tests.

## Impact And Runtime

- Documentation/source-disclosure changes use the focused release-readiness
  test. Application/dependency changes require frozen install, typecheck, build,
  focused tests, and synthetic E2E. Linux production, Compose, systemd,
  Guardian, checkpoint, release, or cutover changes additionally require
  Node/shell parsing, focused authority tests, disposable Docker,
  backup/restore, separate-VM rollback/reboot/Guardian proof, and private-route
  validation.
- Runtime truth is fixed-plan verify-existing plus exact deployment/cutover/
  backup/rollback/private-route receipts, systemd readback, authenticated
  postcheck, and single-writer evidence—never this checkout or historical Agent
  Foundry evidence.
- Publication, provider mutation, deploy/restart/rollback, migration/restore,
  scheduled-task changes, owner onboarding, and real financial-data mutation
  remain separate state-changing boundaries.
- Runtime artifacts and provider payloads stay outside Git.

## Proof required for promotion

The superseding Linux endpoint additionally requires:

- one coherent immutable release-manifest v2 and target-engine evidence chain;
- schema-v2 checkpoint transfer replay against the exact preserved root;
- explicit quiesce-receipt-bound final checkpoint mode;
- isolated restore and once-only migration on a separate rehearsal VM;
- native owner login against the rehearsal candidate;
- Guardian shadow/recovery proof with MariaDB/Redis observe-only;
- rollback lock/rearm and reboot proof on the rehearsal VM;
- production fixed-plan deployment, backup/isolated restore, and systemd boot
  proof;
- exclusive Windows quiescence, final checkpoint, and one-writer evidence;
- exact tailnet-only Tailscale Serve activation with Funnel/public listeners
  absent; and
- preservation/readback of the complete stopped Windows rollback runtime.

The following application and historical Windows evidence remains useful but
is not sufficient by itself for Linux promotion:

- Current direct-to-VM authority tests: 97/97 passed across checkpoint,
  cutover, backup, deployment, environment, release, and rollback contracts.
- Guardian build/tests: 28/28 passed; Guardian typecheck passed.
- Current release-readiness: 24/24; static no-deploy validation: 101/101;
  production Node syntax: 18/18; direct-to-VM PowerShell parsing: 2/2; project
  foundation: 4/4; source-size guard: 0 blockers and 15 advisory warnings.
- Release-manifest v2 closes 30 exact executable/imported artifacts into one
  immutable source/archive/OCI/engine/systemd/runtime authority.
- Fresh independent combined review returned GO with no remaining promotion
  blocker in the source contracts. Executable-byte drift requires re-review.

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
- Historical Newsec Windows journal/runtime and Cloudflare reconciliation is
  proven and remains rollback evidence; it is not target-route proof.
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

Recovery preserves the complete Windows runtime and created an isolated Ubuntu
production VM, a distinct identity-separated rehearsal VM, and private
checkpoint/backup evidence. The rehearsal VM's corrected empty export passed a
second complete 5-file hash replay; its manifest SHA-256 is
`4041AD48E1F0D7348F3738F82C84EA467A29204FA65ACBDC2A7313EF5EF00594`.
This work did not inspect or change an accounting record, discard an original
volume/journal/release/backup, activate Tailscale Serve/Funnel, or deploy an
application stack to either VM. Source
publication of this patch has not yet occurred; publication changes only the
two EasyFire repositories and does not itself create runtime authority.

Recovery starts with the verified full filesystem and direct-VM transfer
checkpoints in `HANDOFF.md`. The next path is fresh independent source review,
one coherent immutable Linux release, and proof on the identity-separated
rehearsal VM before the production VM is staged. Owner Tailscale/native-login
input is requested only when prompted. Windows may be quiesced only after every
backup, restore, release, migration, authentication, rollback, reboot, Guardian,
and checkpoint gate is green. Tailnet-only Serve activates last; Windows remains
preserved as stopped rollback authority.
