# EasyFire Bookkeeping Project Log

Entries are preserved chronologically. The 2026-07-21 direct-to-VM decision at
the end of this log supersedes earlier Windows/Cloudflare endpoint decisions;
those older entries remain historical evidence only.

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
and configuration. Cloudflare was the hosted edge dependency in the historical
Windows candidate and remains preserve-only rollback infrastructure. The
superseding endpoint uses owner-private Tailscale Serve behind loopback Envoy;
Funnel and public listeners are forbidden. Neither edge receives direct
database or backup authority from the controller.

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
runtime truth. Before cutover, runtime truth is the preserved Windows runtime as
the sole writer. After cutover, runtime truth is the fixed Linux deployment plan
and immutable release plus completed checkpoint/deployment/cutover/backup/
rollback/private-route receipts, systemd readback, authenticated postcheck, and
single-writer proof. Friendly Docker names or source state alone are never
sufficient.

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
- Production script, Compose, systemd, Guardian, checkpoint, release, rollback,
  cutover, or private-route changes: Node/shell parse, focused authority tests,
  Compose config, disposable Docker, backup/restore, separate-VM rehearsal,
  reboot, and recovery proof.
- Runtime-affecting changes: fixed-plan verification plus exact receipt,
  systemd, authentication, single-writer, and private-route readback; local
  source is never sufficient runtime proof.
- Real data or provider changes: separate explicit scope and approval.

## Decisions

### Preserve Bigcapital as the open-source foundation

Bigcapital already provides the accounting domain model and is licensed under
AGPL-3.0. EasyFire preserves its full history, attribution, package scopes, and
license. Replacement would be disproportionately risky and is unnecessary.

### Historical: use Windows/Newsec plus Cloudflare (superseded 2026-07-21)

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

### Historical: treat Cloudflare and cloudflared as verify-only infrastructure

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

### Historical: use Docker restart policy instead of a startup scheduled task

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

- Complete project-level suite: 79/79 passed after the recovery patch.
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

## Direct recovery implementation and live stop - 2026-07-20

- Added a caller-bound `MigrationSource` full-backup role that verifies exact
  legacy Compose, environment, container, image, and volume identities without
  requiring a schema-2 deployment journal. Its metadata is accepted by the
  isolated restore verifier in a separate deterministic migration namespace,
  and migration-source recovery units are pinned against retention.
- Added a source-only blue/green authority controller with Plan, caller planning
  rehearsal, and Rollback states. It binds the target release/images and both
  task XML recovery units, emits only migration-ID-derived candidate writes and
  exact rollback operations, and does not execute Docker or Scheduled Tasks.
  Cutover is unconditionally blocked with `LIVE_EXECUTOR_PROOF_REQUIRED` until a
  trusted live executor can produce identity-bound receipts.
- Read-only Cloudflare API proof corrected the earlier edge diagnosis: the sole
  protected owner email already matches the exact Access policy, and tunnel
  ingress, DNS, and the service token are exact. The prior browser selected a
  different Google identity. The tunnel is down because the exact cloudflared
  service is stopped, not because the policy or token drifted.
- No live repair occurred. Newsec's Tailscale SSH service stopped accepting
  port 22 before the exact task/service checkpoint or current backup could be
  established. This is a real infrastructure blocker, so backup, rehearsal,
  task repair/retirement, service start, native login, and cutover remain
  fail-closed. Every original volume, journal, release, and backup was preserved.

## Direct recovery resumed and migration controller completed - 2026-07-20

This entry supersedes the current-state conclusions in the preceding “live
stop” entry without rewriting that historical record.

- Newsec SSH works. Six long-running containers on the older
  `easyfire-bookkeeping-prod` release are healthy, and its one-shot migration
  container exited successfully with result 0.
- The sole-owner Cloudflare Access policy, Tunnel, DNS, token identity, and the
  exact cloudflared binary/process/connector were proven without exposing the
  token. `EasyFireBookkeepingCloudflared` is Running with Automatic start.
- Both legacy scheduled tasks remain enabled and Ready with
  `LastTaskResult=1`. Their exact recovery XML hashes are preserved. They are
  not changed until gated Cutover replaces the backup task and retires the
  startup task.
- The verified live-runtime checkpoint manifest SHA-256 is
  `0AEE8A2D577B102ECA6E61B8D4063363C7420845D27BDB957BDCA4DCC66525BE`.
- A current caller-bound `MigrationSource` backup was created with SHA-256
  `229ED021892F495AF84219596713C24C6B30676856601B0F3AC19F7E175FB54D`;
  its isolated network-disabled restore passed.
- The migration controller now executes journaled `Plan`, `Rehearse`,
  `AcceptAuthentication`, `Cutover`, and `Rollback` using candidate-only
  resources. It binds the full ten-file executable bundle, all seven exact
  image identities, complete mount/port authority, TTL-safe Redis continuity,
  crash-resumable backup/rollback, and task replacement/retirement only at
  gated Cutover.
- Final local proof passed: 76/76 combined migration/recovery tests after the
  containment repair (75 prior plus the new negative case), 12/12
  action-plus-recovery tests, 101/101 static validator checks, 14/14 release
  readiness, 135/135 repository-wide tests, 7/7 PowerShell parsing, 4/4 project
  foundation, and 0 source-size blockers. Two independent final reviewers
  returned GO, including targeted
  containment proof at 2/2.
- Every original volume, journal, release, and backup remains preserved. No
  accounting record was inspected or changed.
- The recovery patch has not yet been committed or published. No live candidate
  rehearsal, native login, or cutover has run.
- The next path is exact-source publication to the two EasyFire remotes,
  immutable release and seven-image construction on Newsec, a new migration
  Plan, Rehearse, owner native login if prompted, the `AcceptAuthentication`
  source recovery drill, and Cutover only after every backup, rollback,
  authentication, and migration gate passes. Post-cutover proof must verify the
  replacement backup task, absence of the legacy startup task, runtime/edge
  health, and a new current backup with isolated restore.

## Dedicated Linux VM endpoint supersedes Windows/Cloudflare - 2026-07-21

This entry supersedes the current-endpoint conclusions in every preceding entry
without rewriting their historical evidence.

### Choose the clean long-term availability boundary

The intended production endpoint is the dedicated Ubuntu 24.04 Hyper-V VM
`easyfire-bookkeeping-newsec` on Newsec. Docker Engine and Compose run inside
the VM; systemd owns boot/start; Tailscale provides private tailnet ingress.
This removes Docker Desktop, Windows login, Scheduled Tasks, the PowerShell
proxy, cloudflared, and the Windows host from the target availability chain.
The original Windows runtime remains intact rollback authority, not the target.

### Make systemd the only start authority

All seven Compose services declare `restart: "no"`. The stack unit first runs
the fixed root-owned deployment verifier, then starts the exact existing data
services followed by the exact stateless services. Raw Compose, Docker restart
policies, and Windows tasks cannot independently resurrect the stack. A failed
authority check leaves the application stopped.

### Limit Guardian to safe automatic recovery

The systemd Guardian timer has exact runtime/release identity and bounded
retries. It may start or restart only Gotenberg, server, webapp, and Envoy.
MariaDB and Redis are observe-only: stopped, unhealthy, ambiguous, or
identity-drifted data services produce evidence and require operator action.
Guardian never builds, pulls, recreates, migrates, restores, or mutates a
durable volume.

### Use private Tailscale Serve, never public exposure

The only approved route is
`easyfire-bookkeeping-newsec.taild63e9b.ts.net:443` through tailnet-only
Tailscale Serve to `http://127.0.0.1:8080`. Activation is exclusive and
receipt-bound after deployment and cutover proof. Tailscale Funnel, a public
listener, and Cloudflare cutover are hard failures. The legacy Windows
Cloudflare route remains unchanged until Windows is safely quiesced.

### Separate rehearsal from production

Restore, once-only migration, native login, rollback lock/rearm, reboot, and
Guardian recovery must be proven on a separate isolated rehearsal VM. The
production VM cannot serve as both target and destructive rehearsal surface.
Only immutable artifacts and bound evidence proven in rehearsal may proceed to
the production VM.

### Bind every handoff between Windows and Linux

- Checkpoint-transfer v2 verifies all manifest bytes/hashes and binds the exact
  source checkpoint ID/timestamp, MySQL/Redis container/image/volume identity,
  SQL/RDB payloads, isolated restore, dual-location proof, and source
  preservation.
- Release-manifest v2 distinguishes OCI index, Linux/amd64 manifest, and Docker
  engine image identity and binds source, image bundle, Guardian, systemd, and
  target-engine evidence.
- Linux deployment uses new deployment-ID-derived volumes, a once-only
  migration, exact restore/accounting invariants, startup authorization, and a
  final receipt only after systemd activation proof.
- Cutover binds source quiescence, the final checkpoint, Linux backup/restore,
  rollback/reboot/Guardian proof, native authentication, one-writer evidence,
  and private-route authorization.

### Record current state without claiming cutover

- `easyfire-bookkeeping-newsec` is provisioned with Docker Engine 29.6.2,
  Compose 5.3.1, Node 22.23.1, systemd, Tailscale 1.98.9, isolated networking,
  outbound-only NAT, UFW deny-incoming/routed, and no application listeners.
- No Bookkeeping application container or volume has been deployed to the VM.
  Tailscale is logged out and Serve/Funnel are absent.
- The preserved direct-VM checkpoint passed complete 16,434-entry hash replay
  and isolated restore. Focused checkpoint and Linux compatibility tests pass.
- The preflight checkpoint producer still assumes a live source. Before final
  cutover it must add an explicit quiesce-receipt-bound mode that accepts only
  healthy original MariaDB/Redis plus exactly six stopped/restart-no Windows
  writers. Default live-preflight behavior must remain unchanged.
- Windows remains the only live writer. Every original volume, journal,
  release, backup, task, and edge resource is preserved. No production restore,
  migration, systemd enablement, Tailscale activation, or cutover has run.

## Direct-to-VM source and rehearsal foundation completed - 2026-07-22

This entry supersedes only the open source-contract and rehearsal-identity items
in the preceding direct-to-VM entry. It does not claim a deployment or cutover.

### Preserve live-preflight behavior and add explicit final authority

The schema-v2 checkpoint producer retains byte-identical normal preflight
output. Its explicit final-quiesced mode now requires all three bound inputs:
the exclusive Windows quiesce receipt, immutable cutover plan, and post-quiesce
source snapshot. It verifies healthy original MariaDB/Redis, all six exact
stateless/source-route writers stopped with restart `no`, zero alternate writer
authority including MariaDB event scheduling, and complete receipt chronology.
The combined checkpoint/cutover suite passes 24/24.

### Close every executed artifact into the immutable release

Release-manifest v2 binds 30 exact files and their executable modes, including
all imported helpers, eight Windows cutover executors/modules, Linux deployment
and rollback authorities, activation-evidence collector, Guardian active-mode
promoter, and private-route activator. Each mutating executor self-verifies its
immutable installed path and release-manifest identity. The source-archive
authority stream-verifies the Git archive, embedded 40-hex commit, artifact
bytes/modes, and rejects path, link, duplicate, truncation, padding, and archive
type attacks. Focused release tests pass 24/24, Guardian tests pass 28/28, and
the broad migration authority set passes 97/97.

### Separate the rehearsal VM identity before staging application bytes

The cloned rehearsal VM initially shared the production template's machine ID
and SSH host key. Only the empty rehearsal VM was repaired: its original
identity files were preserved, a unique machine ID and SSH host key were
generated, and a distinct known-hosts authority was recorded. The corrected
empty export at
`C:\Hyper-V\easyfire-bookkeeping-rehearsal-newsec\recovery\identity-separated-empty-export-20260722-073615`
contains 5 files totaling 5,622,391,330 bytes and passed a second full hash
replay. Manifest SHA-256:
`4041AD48E1F0D7348F3738F82C84EA467A29204FA65ACBDC2A7313EF5EF00594`.
Bound identity-evidence SHA-256:
`D904D17C71E8F39DE486B5C9FA98F588887221B5FF12B9FE5AD7DE90ACFB8494`.

### Hold runtime state at the safe boundary

Both Linux VMs still have zero Bookkeeping application containers and volumes,
no Tailscale Serve/Funnel configuration, and no public application listeners.
The Windows runtime remains healthy and the sole writer. Every original Windows
volume, release, journal, backup, task, and edge artifact remains preserved.
The next action is fresh independent review, one coherent source commit and
immutable release, then the complete isolated rehearsal chain before production
staging or Windows quiescence.

Fresh independent combined review subsequently returned GO on the frozen source
after all previously reported P0 findings were closed. The final local proof is
97/97 migration-authority tests, 28/28 Guardian tests, 24/24 release readiness,
101/101 static validation, and zero source-size blockers. No runtime mutation
was used to obtain that source verdict.

## Immutable release proof closure repaired - 2026-07-22

Pre-deployment review proved the earlier release could not honestly complete its
own rehearsal and activation chain. One receipt was required to represent both
the locked/inactive reboot and the later normal active recovery; rehearsal
evidence was incorrectly tied to a future production checkpoint; release-owned
OCI, target-engine, native-authentication, and rehearsal producers were absent;
and activation trusted backup-receipt hashes without reopening the preserved
backup directory. No VM application bytes were staged from that superseded
bundle.

The replacement source separates locked-reboot, normal-reboot, rehearsal, and
production authority. Release-manifest v2 then bound 35 executable artifacts. A
deterministic seven-role OCI producer validates real multi-platform and
attestation indexes while requiring exactly one runnable Linux/amd64 child per
role. Target-engine evidence binds the loaded Docker 29.6.2 image identities.
Native authentication uses an attached TTY, exact nested schemas, no persisted
secret/token material, and authenticated principal/tenant/organization plus
database/Redis invariants. Rehearsal is bound to a distinct machine and
deployment and cannot substitute for the later production checkpoint or proofs.

Activation now streams and re-hashes the exact 18-file backup manifest set,
cross-binds SQL, Redis, authority, proof, checksum, and verification bytes, and
requires the preserved isolated-restore container and volume to remain stopped
and networkless before either activation output is written. Negative tests cover
missing/corrupt backup artifacts, running restore containers, stale chronology,
wrong machine or plan, route/public exposure, secret injection, and output-path
reuse.

Final current-byte results are 42/42 focused evidence checks, 120/120 complete
Linux/direct checks, 30/30 Guardian tests plus typecheck, 101/101 static
production validation, 24/24 release readiness, clean syntax/diff checks, and
zero source-size blockers. Two independent current-byte reviews returned PASS.
The unchanged Windows 15,000-file performance test exceeded its timing ceiling
only during parallel host load and passed its isolated 14/14 rerun. Windows
remains healthy and the sole writer; both Linux VMs remain isolated with zero
Bookkeeping application containers or volumes.

The first real producer invocation through
`/opt/easyfire-bookkeeping/current` then exposed a shared CLI bootstrap defect:
Node canonicalized the loaded module while the main guard compared the unresolved
symlink argument, causing 14 installed CLIs to exit zero without executing. The
failed attempt created no bundle or runtime resource. A shared fail-closed
`linux-cli-entrypoint.mjs` helper now compares both canonical paths, refuses any
realpath failure, and remains inside the immutable release closure. The new
symlink/failure suite passes 16/16, the related release/controller matrix passes
144/144, Guardian passes 30/30 plus typecheck, static validation passes 101/101,
source-size has zero blockers, and independent re-review returned PASS.

The corrected CLI then rejected the initial seven image inputs before creating
the merged bundle because `docker save` had produced legacy `manifest.json`
archives rather than OCI image layouts. Real Skopeo 1.20 export also exposed an
interoperability error in the input parser: OCI permits the root index media type
to be omitted and Skopeo uses the standard
`org.opencontainers.image.ref.name` annotation, while the parser required an
explicit media type and only containerd's vendor annotation. The parser now
accepts the standards-compliant omitted-or-exact media type and either reference
annotation, rejects missing or conflicting references, and leaves every pinned
inner-index, platform, descriptor, blob, and canonical-output check unchanged.
Legacy Docker archives remain rejected. The producer/release matrix passes
43/43, Guardian passes 30/30 plus typecheck, static validation passes 101/101,
source-size has zero blockers, and the runbook now supplies distinct Buildx and
digest-preserving Skopeo export procedures.

The first commit-bound Buildx archive then exposed a distinct annotation
representation that the synthetic compatibility fixture had not covered:
Buildx emits a full `io.containerd.image.name` alongside a bare-tag
`org.opencontainers.image.ref.name`. The bundle producer now treats those as
the same authority only when the full repository/tag equals the pinned role and
the bare tag equals that role's exact expected tag. It continues to reject a
bare tag without a full-name annotation, wrong repositories, wrong tags,
digests in references, or any disagreement. The regression-first focused suite
fails on the prior implementation and passes 13/13 after the repair. The failed
rehearsal attempt created no image bundle, container, or volume.

After the corrected bundle loaded, Docker Engine 29.6.2 exposed another real
containerd-store behavior missing from the synthetic runner: `docker image ls`
showed every exact tag and root-index ID, while `docker image inspect <tag>`
returned `No such image` for the loaded OCI indexes. Inspection by the exact
bundle-proven root-index digest succeeded and returned the expected single
`RepoTags` entry and bounded `RepoDigests`. The target-engine producer now uses
that already verified digest as the lookup key, then independently requires the
returned ID, tag, external digest authority, Docker version, OS, and architecture
to match. Regression-first tests fail on the prior lookup and pass 13/13 after
the repair. The failed rehearsal attestation wrote no evidence and created no
container or volume.

Release-manifest source provenance next refused a case-ambiguous directory
prefix in the Git archive: AuditLogs was tracked under `modules/EE`, while 20
Workspaces files were tracked under `modules/ee`. This was stale index casing,
not two intentional module roots: the physical Windows checkout and every
application import already use `EE/Workspaces`. The 20 tracked paths are now
normalized to `EE/Workspaces` through a reversible two-step Git move; their blob
object identities are unchanged. The failed manifest attempt wrote no output
and created no container or volume. A prefix-aware scan of every tracked path
ancestor now reports zero collisions; the complete seven-project build and
server typecheck pass. The repository-wide typecheck continues to report the
pre-existing webapp type backlog after dependency-ordered build, while server,
SDK, and Guardian typechecks pass.

## Bind rehearsal and production deployment hosts - 2026-07-22

The first complete `45e2bc20946a65cbffbabac6a7b2fbf8e95d03af` target-engine
bundle and release-manifest run passed without creating a runtime container or
volume. The next pre-deployment audit found that the sole deployment controller
hard-coded the production Docker hostname, while the mandatory rehearsal
collector hard-refused anything except the distinct rehearsal hostname. That
made the immutable release unable to satisfy both authorities and stopped work
before restore, migration, or data mutation.

The deployment plan now optionally binds an exact target role and hostname.
New rehearsal plans must bind `rehearsal` to
`easyfire-bookkeeping-rehearsal-newsec`; new production plans must bind
`production` to `easyfire-bookkeeping-newsec`. The missing-target compatibility
path remains production-only. Both initial deployment and every
`--verify-existing` readback enforce the same plan-bound hostname, so the repair
does not widen host authority. The runbook also records the executable rollback
chronology: backup, arm, create plan, locked reboot, verify/rearm, Guardian
exercise, normal reboot, native authentication, and final collection.

Regression-first proof failed on the old contract and now passes. The current
Linux/direct-plus-Guardian selected suite passes 184/184, standalone Guardian
passes 31/31 plus typecheck, static no-deploy validation passes 101/101,
release readiness passes 24/24, and the changed-file source-size guard has zero blockers. The old release
and every staging/output artifact remain preserved; a new immutable release is
required before rehearsal deployment.

## Bind Guardian proof to the recovered boot - 2026-07-22

The normal-reboot rehearsal previously proved only that the Guardian timer was
enabled and active. It did not prove that the timer had actually completed a
healthy run after that boot. The new release-owned
`linux-guardian-boot-proof.mjs` waits within one shrinking wall-clock deadline,
requires a timer trigger and service start within ten seconds, requires service
exit before the next trigger, and binds a stable current-boot systemd invocation
to exactly one same-boot journal status matching the secure status artifact.
Only a zero-exit healthy/cooldown observation with every exact service identity
and HTTP probe healthy can qualify the reboot.

The module is the 36th exact release artifact and is present in every source,
runtime-generator, verifier, and test-fixture closure. Regression-first focused
proof passes 11/11. The selected Linux/direct-plus-Guardian suite passes
184/184, standalone Guardian passes 31/31 plus typecheck, release readiness
passes 24/24, static no-deploy validation passes 101/101, foundation checks pass
4/4, syntax and diff checks pass, and source-size reports zero blockers. A
targeted independent review and re-review returned PASS after closing manual-run
causality and inherited-timeout findings. No runtime, route, Docker resource, or
accounting-data mutation was used for this source proof.

## Establish the v6 rehearsal and stop at the backup proof - 2026-07-22

The current v6 rehearsal instance restored the preserved checkpoint, ran the
database migration exactly once with exit zero, passed fixed-plan
`--verify-existing`, brought all six long-running containers healthy, and
returned HTTP 200 for `/`, `/api/system_db`, and `/api/auth/meta` over
`127.0.0.1:8080`. The bound deployment-plan SHA-256 is
`e4e4cac6ee8e56997a645b83a57689b73169b66b7053022ea91f9f7992907fc0`.
Those restore, once-only migration, fixed-plan, container-health, and loopback
HTTP gates are accepted and must not be repeated unless a bound input or
authoritative state changes.

Guest-native backup attempt `20260723T031624Z` created preserved database and
Redis payloads, then stopped during its disposable isolated restore. The proof
container inherited direct `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` values
from the pinned MariaDB image while also receiving `MYSQL_PASSWORD_FILE` and
`MYSQL_ROOT_PASSWORD_FILE`; the image correctly refused the mutually exclusive
configuration and exited one. No `COMPLETE` marker or `backup-receipt.json`
exists, so the attempt and its preserved proof volume are diagnostic evidence,
not a trusted backup.

Windows remains healthy and the sole live writer. The production VM is off, the
rehearsal candidate has no Tailscale route, and no cutover occurred. Tailscale
`NeedsLogin` is a pending later enrollment gate rather than an active blocker.
The next safe action is only the focused compatibility repair in
`scripts/production/linux-backup-verify.sh`, followed by one newly timestamped
backup and isolated restore proof. Do not rebuild the release or VM, reuse the
incomplete attempt, or repeat accepted gates while their inputs remain
unchanged. If the repaired gate fails on its one rerun, preserve the evidence
and stop at a safe checkpoint.

## Fresh backup, rollback, and Guardian pass; bounded stop at runtime recovery - 2026-07-23

The one-file MariaDB backup compatibility repair produced fresh backup
`20260723T075310Z`. Its network-disabled isolated restore passed 17 system and
70 tenant tables, 1/1/1/1 identity counts, and exact schema SHA-256
`24b5ab66959a6971e67a321f3f2583b896aebd091760a1880275f53bb55af853`.
The earlier incomplete `20260723T031624Z` unit remains preserved and untrusted.

Rollback lock/reboot/rearm passed, followed by Guardian shadow, stateless
recovery, data-tier refusal, identity-mismatch refusal, and final-health proof.
Guardian proof SHA-256 is
`71954267a05641a5aa44f482618f5d72c4bed2edfef9ceebbead25f40121cf09`.

Runtime recovery then exposed a sealed-release race. Docker restart preserved
the containers but returned them through `health=starting`, while the installed
`--verify-existing` gate checked immediately. The initial recovery failed. A
bounded compatibility continuation retried the stack unit three times within
two minutes, but MariaDB and then Gotenberg were still transiently starting; the
continuation timed out after 180 seconds. It moved no deployment receipt and
published no recovery proof, normal-reboot marker, or final rehearsal receipt.
The same gate therefore failed twice and the rehearsal stopped without a third
attempt.

The rehearsal was safely stabilized with the stack active, all six application
containers healthy, and loopback HTTP 200. Windows remains the live sole writer,
the production Linux VM remains off, and no route or cutover occurred.

A six-file durable source repair makes release-manifest mode `0644` explicit and
gives `--verify-existing` a 120-second wait only for running containers whose
health is `starting`. Created or exited containers remain valid pre-start states
and are not waited on; unhealthy or missing-health running containers, invalid
states, and identity drift still fail immediately. Focused release/deployment
proof passed 39/39, Guardian proof 16/16, adjacent proof 31/31, syntax 4/4,
`git diff --check`, and the changed-file source-size guard with no blockers. The
next candidate must be a new immutable release containing that repair; the
failed sealed release must not receive another recovery attempt.
