# EasyFire Bookkeeping Current State

**Owner:** EasyFire

**Updated:** 2026-07-20

**Status:** Direct-Codex recovery source now includes an executable, fail-closed
blue/green migration controller. Newsec SSH works; the older hosted installation
is healthy; the exact cloudflared service is running automatically; and both a
verified live-runtime checkpoint and current isolated-restorable
`MigrationSource` backup exist. The recovery patch is locally validated but not
yet committed or published. No candidate rehearsal, native login, or cutover has
occurred.

This file is the source of truth for current ownership, release, and runtime
state. Agent Foundry is bypassed and is historical provenance only. Older Agent
Foundry instructions and the Caddy/Linux deployment proposal are not execution
authority.

## Source ownership

- Upstream foundation: Bigcapital, AGPL-3.0, base commit
  `8c90ca328ec59dd772de3b385531eb386de11ac8`.
- Local candidate branch:
  `codex/easyfire-bookkeeping-autonomy-recovery-20260718`.
- Accepted-source destination: `easyfire-forgejo/main` in the private
  owner-controlled Forgejo repository `jonny-admin/easyfire-bookkeeping`.
- Public AGPL mirror:
  `https://github.com/EasyFire101/easyfire-bookkeeping`.
- The existing `origin` remote is Bigcapital upstream only. EasyFire commits
  must never be pushed there.
- Forgejo is accepted-source authority only when exact remote readback confirms
  the released commit. GitHub is corresponding-source authority only when
  anonymous readback confirms that same commit.
- Initial publication commit:
  `0f31d192195def0f8fe58a1532282b88609eb822`. A corrective publication tracks
  four root inputs accidentally omitted from that commit even though its tests
  and validators consumed them: `.editorconfig`, `.env.production.example`,
  `AGENTS.md`, and `AGENT_FOUNDRY_EASYFIRE_HANDOFF.md`.

## Observed hosted runtime

Reconciliation and approved recovery work on 2026-07-20 established the
following without inspecting or changing an accounting record:

- Six long-running `easyfire-bookkeeping-prod` application containers are
  healthy on an older Agent Foundry-origin release; its one-shot migration
  container exited successfully with result 0.
- Existing MariaDB and Redis volumes and pre-schema-2 journals are durable
  production authority. They are incompatible with this candidate's
  fresh-install-only controller and make a new Action a hard stop.
- Both legacy scheduled tasks remain enabled and Ready with
  `LastTaskResult=1`. Their exact checkpoint XML hashes are preserved. The
  retired startup task remains registered until gated Cutover, and the backup
  task is not replaced before that same gate.
- The protected Cloudflare credential file contains one well-formed owner email,
  and read-only API proof shows the one Access policy already allows exactly
  that address. The earlier denial used a different signed-in Google identity.
- Tunnel ingress, DNS, Access policy, and the service token identity match the
  exact tunnel. `EasyFireBookkeepingCloudflared` is Running with Automatic start
  and exact binary/process/connector identity; its token was not exposed.
- Newsec SSH works. The verified live-runtime checkpoint manifest SHA-256 is
  `0AEE8A2D577B102ECA6E61B8D4063363C7420845D27BDB957BDCA4DCC66525BE`.
- The current `MigrationSource` backup SHA-256 is
  `229ED021892F495AF84219596713C24C6B30676856601B0F3AC19F7E175FB54D`,
  and isolated network-disabled restore passed. Every original volume, journal,
  release, and backup remains preserved.

## Candidate production contract

The repaired `deploy/windows/production-action.ps1` is a fresh-install-only
controller. It does not adopt, upgrade, or mount any historical,
project-labeled, or action-derived MariaDB/Redis volume.

- A canonical action ID derives the release journal, release directory, and
  new MariaDB and Redis volume names.
- Preflight verifies the archive, archive hash and contents, current inventory,
  credentials, exact four-file deployment controller bundle, and pre-existing
  edge. It writes only a 15-minute local schema-2 preflight receipt; it performs
  no provider or runtime mutation.
- Action requires the matching confirmation ID and unexpired receipt. It seals
  the extracted release with a full manifest, creates a schema-2 journal,
  journals a hash-bound runtime environment candidate before atomic
  publication, builds immutable images and records their exact image IDs,
  starts new action-derived data volumes, and records the exact observed volume
  subset before and after creation. It creates and binds the one-shot migration
  container, journals start authorization before starting it at most once, and
  waits with a bounded timeout. It then proves a metadata-backed baseline
  recovery unit with an isolated network-disabled restore before completing the
  application tier.
- Action stops at `action_completed_pending_postcheck`. Postcheck is mandatory.
  It refuses controller bundle, container, built image ID, mount, network,
  exact port binding, foreign volume consumer, task, release, backup, signup,
  health, or verify-only edge connector identity drift before marking the
  journal `completed`.
- Rollback removes only the exact daily backup task when recorded as created by
  that ActionId, plus the action's Compose containers/network. It preserves the
  exact observed subset of durable volumes even when interruption happened
  before both volumes existed, plus releases, backups, journals, and all edge
  infrastructure. If the application tier ever started, rollback first creates
  and isolated-restore-verifies a metadata-backed emergency recovery unit.

Any pre-existing project-labeled or historical MariaDB/Redis volume, including
`bigcapital_prod_mysql`, `bigcapital_prod_redis`, and volumes derived from prior
action IDs, is a hard stop. Prior database authority produces
`DATABASE_ENGINE_MIGRATION_REQUIRED`. Moving an existing database to the new
MariaDB release requires a separately designed, approved, and proven blue/green
logical migration. Never attach an existing MariaDB data directory to the new
engine image.

The only allowed pre-existing volumes for the fresh-install controller are the exact two volumes already bound
to the same current ActionId and valid schema-2 journal during an interrupted
resume, and only in a compatible phase. The controller cannot adopt any other
volume.

## Existing-data migration contract

The separate existing-data controller is no longer a planning-only gate.
`migration-action.ps1` executes journaled `Plan`, `Rehearse`,
`AcceptAuthentication`, `Cutover`, and `Rollback` stages using only
migration-derived candidate resources. It binds the target release, a full
ten-file executable bundle, all seven exact image identities, complete
mount/port identity, and the preserved task XML authority. Redis continuity is
TTL-safe; backup and rollback are crash-resumable; partial or foreign container,
mount, port, image, bundle, journal, task, or recovery drift fails closed.

Rehearse must prove the candidate and its rollback boundary without replacing
the live runtime. `AcceptAuthentication` runs the source recovery drill after
the owner proves native login. Cutover is allowed only after backup, rollback,
authentication, and migration proof all pass. Only gated Cutover may replace the
daily backup task and retire the legacy startup task. No original volume,
journal, release, or backup is cleanup authority.

Unattended application restart relies on Compose `restart: unless-stopped`.
`deploy/windows/start-stack.ps1` is retired and must fail closed; no production
startup scheduled task is allowed. The controller manages only the exact daily
backup task. That task invokes the fifth `ScheduledBackup` stage from the
sealed installed four-file controller bundle through canonical Windows
PowerShell and passes the exact deployment-owner SID bound into the schema-2
journal. SYSTEM, Administrators, and that bound owner SID are the stable ACL
authority; a missing, changed, or noncanonical SID fails closed. Baseline,
emergency, and scheduled backups are crash-resumable recovery units consisting
of a compressed dump, SHA-256 sidecar, and authority-bound metadata under a
unique journaled operation ID.

## External edge contract

The intended hostname is `https://bookkeeping.easyfire.fyi` on the
owner-controlled Newsec Windows host, using Compose project
`easyfire-bookkeeping-prod`, loopback Envoy, and pre-existing Cloudflare Access,
Tunnel, DNS, cloudflared binary, and Windows service resources.

The production controller is verify-only for this edge. It uses Cloudflare GET
operations and local readback to confirm exact identity and health. It cannot
create, update, delete, install, replace, rotate, or repair Access, Tunnel, DNS,
the cloudflared binary, or the service. Edge drift is a hard stop requiring a
separate scope.

Automated production owner bootstrap is retired and unavailable. The current
release cannot create or recover the first owner account, so a truly fresh
database is intentionally not login-ready. Any future onboarding or recovery
procedure needs a separate design, approval, backup boundary, and proof before
a fresh production Action can be called usable.

## Evidence status

| Evidence                                          | Current result                                                                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery checkpoint                               | Verified before direct takeover repairs                                                                                                                                                   |
| Frozen offline install and full application build | Passed on the current candidate                                                                                                                                                           |
| Dependency compatibility and server typecheck     | Passed: 6/6 compatibility tests; server typecheck clean                                                                                                                                   |
| Recovery controller/static validation             | Passed: 76/76 combined tests after the final containment negative case; action plus recovery 12/12; static validator 101/101; release readiness 14/14; parser 7/7; foundation 4/4; source-size 0 blockers. |
| Production dependency audit                       | Complete: 45 advisories (9 low, 36 moderate, 0 high, 0 critical)                                                                                                                          |
| Rebuilt web bundle                                | No JavaScript Cookie 2.2.1 marker or locked transitive dependency                                                                                                                         |
| Complete project-level test suite                 | 135/135 passed after the final containment repair, including the 15,000-file materialization benchmark.                                                                                   |
| Disposable Docker and backup/restore proof        | `b37426f03a8841d9923b853db5f40a08`: `proofPassed=true`, `builtServerAuthPassed=true`, `cleanupPassed=true`, unchanged empty production inventory, and zero resources after exact teardown |
| Migration recovery source                         | Current backup SHA-256 `229ED021892F495AF84219596713C24C6B30676856601B0F3AC19F7E175FB54D`; isolated network-disabled restore passed.                                                       |
| Independent release review                        | Two final GO reviews, including targeted containment proof 2/2. Live Cutover remains gated by rehearsal, native authentication, and live backup/rollback/migration proof.                    |
| Accepted Forgejo source                           | Initial commit `0f31d192195def0f8fe58a1532282b88609eb822` verified; final corrective commit requires exact matching readback                                                               |
| Public GitHub corresponding source                | Initial commit anonymously verified; final corrective commit requires anonymous matching readback                                                                                         |
| Newsec journal/runtime reconciliation             | SSH works; six old production containers healthy; migration container exited 0; both legacy tasks enabled/Ready with `LastTaskResult=1`; checkpoint manifest SHA-256 `0AEE8A2D577B102ECA6E61B8D4063363C7420845D27BDB957BDCA4DCC66525BE`. |
| Authenticated live acceptance                     | Exact Access policy is correct; the prior browser used a different Google identity. Native application authentication still requires the owner to select the allowlisted identity and enter the native password. |
| Production deployment                             | Older runtime remains live. Access/Tunnel/DNS/token and Running/Automatic cloudflared are exact. Recovery patch is unpublished; no candidate rehearsal, native login, or cutover has run.     |

Historical observations about a Cloudflare redirect or earlier local boot are
not proof of the current candidate, deployed revision, database compatibility,
or authenticated application behavior.

## Remaining completion path

The runtime checkpoint, current recovery unit, edge identity, controller
implementation, focused proof, and independent review are complete. The
remaining endpoint is operational migration, not another fresh deployment:

1. Commit and publish the exact verified patch only to `easyfire-forgejo/main`
   and `easyfire-github/main`, confirming matching remote readback.
2. Build an immutable release and all seven pinned images on Newsec, then create
   a new migration `Plan` bound to those exact identities.
3. Run candidate-only `Rehearse` and prove its rollback boundary without
   replacing the old runtime.
4. Complete native login; the owner enters a password, MFA, or CAPTCHA only if
   prompted.
5. Run `AcceptAuthentication` to execute and verify the source recovery drill.
6. Run `Cutover` only if backup, rollback, authentication, and migration proof
   all pass.
7. Verify the replacement backup task, absence of the retired startup task,
   candidate runtime/edge health, and a new current backup with isolated restore.

Do not run the candidate's fresh-install Action against the existing volumes.

## Data boundary

- Repository tests use synthetic fixtures only.
- Secrets, credentials, production journals, databases, backups, attachments,
  and real financial records stay outside Git.
- Real LLC, tax, bank, customer, vendor, and opening-balance setup is not part
  of source publication or controller validation.
- Recovery proof did not inspect or change an accounting record.
- Live persistence proof, if later authorized and still needed, is limited to
  one uniquely labeled synthetic record. Its exact identity must be inventoried
  before creation and again before removing only that record.
