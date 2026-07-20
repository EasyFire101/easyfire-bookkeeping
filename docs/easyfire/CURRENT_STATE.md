# EasyFire Bookkeeping Current State

**Owner:** EasyFire

**Updated:** 2026-07-20

**Status:** Direct Codex takeover release candidate with local source, build,
and dependency-security validation complete. Publication is established only
by exact EasyFire remote readback. The runtime remains unreconciled,
undeployed by this takeover, and not accepted through the authenticated live
site.

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

The only allowed pre-existing volumes are the exact two volumes already bound
to the same current ActionId and valid schema-2 journal during an interrupted
resume, and only in a compatible phase. The controller cannot adopt any other
volume.

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
| Focused controller/static validation              | Passed: 31/31 focused production tests and 101/101 static checks                                                                                                                          |
| Production dependency audit                       | Complete: 45 advisories (9 low, 36 moderate, 0 high, 0 critical)                                                                                                                          |
| Rebuilt web bundle                                | No JavaScript Cookie 2.2.1 marker or locked transitive dependency                                                                                                                         |
| Complete project-level test suite                 | 69/69 passed                                                                                                                                                                              |
| Disposable Docker and backup/restore proof        | `b37426f03a8841d9923b853db5f40a08`: `proofPassed=true`, `builtServerAuthPassed=true`, `cleanupPassed=true`, unchanged empty production inventory, and zero resources after exact teardown |
| Independent release review                        | Source publication GO after two read-only reviews found no remaining P1/P2; live deployment remains separately gated by owner onboarding and Newsec/runtime reconciliation.               |
| Accepted Forgejo source                           | Established only by exact `easyfire-forgejo/main` readback of the released commit                                                                                                         |
| Public GitHub corresponding source                | Established only by anonymous readback of that same released commit                                                                                                                       |
| Newsec journal/runtime reconciliation             | Required after publication; no current runtime claim is made by this source record                                                                                                        |
| Authenticated live acceptance                     | Required against the reconciled hosted revision                                                                                                                                           |
| Production deployment                             | Eligible only after fresh-volume and first-owner boundaries are resolved; no deployment claim is made by this record                                                                      |

Historical observations about a Cloudflare redirect or earlier local boot are
not proof of the current candidate, deployed revision, database compatibility,
or authenticated application behavior.

## Promotion order

1. Complete and record the final combined test run and disposable Docker
   recovery proof on the exact candidate.
2. Obtain independent read-only review of the final candidate and evidence.
3. Commit and publish the same accepted commit to Forgejo and the public GitHub
   mirror; verify anonymous corresponding-source access.
4. Perform read-only Newsec journal and runtime reconciliation.
5. Perform authenticated live acceptance without real financial data.
6. Consider a production action only if it is still needed, the destination
   has no historical, project-labeled, or action-derived MariaDB/Redis volumes,
   and a supported first-owner onboarding path has been separately approved and
   proven. Otherwise stop and plan the onboarding, migration, or recovery path.

## Data boundary

- Repository tests use synthetic fixtures only.
- Secrets, credentials, production journals, databases, backups, attachments,
  and real financial records stay outside Git.
- Real LLC, tax, bank, customer, vendor, and opening-balance setup is not part
  of source publication or controller validation.
- Live persistence proof, if later authorized and still needed, is limited to
  one uniquely labeled synthetic record. Its exact identity must be inventoried
  before creation and again before removing only that record.
