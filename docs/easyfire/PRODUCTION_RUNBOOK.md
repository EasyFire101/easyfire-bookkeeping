# EasyFire Bookkeeping Production Runbook

**Owner:** EasyFire

**Updated:** 2026-07-20

**Status:** Locally validated candidate runbook. Source publication is
established only by exact EasyFire remote readback. This runbook does not claim
a reconciled Newsec deployment or authenticated live acceptance.

Read [CURRENT_STATE.md](./CURRENT_STATE.md) first. Agent Foundry is bypassed;
its handoff and the Caddy/Linux proposal are historical evidence only.

## 1. Hard boundaries

- The production controller is **fresh-install-only**. It cannot adopt, upgrade,
  or mount any historical, project-labeled, or action-derived MariaDB/Redis
  volume.
- Historical names including `bigcapital_prod_mysql` and
  `bigcapital_prod_redis`, all project-labeled/action-derived volumes, or a
  `PriorActionId` must stop before Action. Prior database authority reports
  `DATABASE_ENGINE_MIGRATION_REQUIRED`. Plan a separate blue/green logical
  migration; never attach an old MariaDB data directory to the candidate image.
- The only resume exception is the exact two ActionId-derived volumes already
  bound to the same valid schema-2 journal in a compatible interrupted phase.
  No other volume can be adopted.
- Cloudflare Access, Tunnel, DNS, the cloudflared binary, and the Windows
  cloudflared service are pre-existing, verify-only infrastructure. This
  controller never mutates them.
- Automated production owner bootstrap is retired and unavailable.
- A fresh database therefore has no supported first-owner login. Do not deploy
  a fresh target as usable production until a separate onboarding design is
  approved and proven.
- `deploy/windows/start-stack.ps1` is retired and must fail closed. Production
  startup relies on Compose `restart: unless-stopped`; no startup scheduled task
  is permitted.
- Never infer runtime state from a checkout, branch, historical redirect, or
  old Agent Foundry report. Use an exact schema-2 action journal and mandatory
  Postcheck.
- Never put `.env`, credentials, journals, backups, database dumps, or user
  records in Git.
- Real LLC, tax, bank, customer, vendor, and opening-balance setup is outside
  software release work.

## 2. Candidate architecture

| Boundary          | Candidate contract                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| User URL          | `https://bookkeeping.easyfire.fyi`                                                                                                        |
| Access edge       | Pre-existing Cloudflare Access restricted to the owner                                                                                    |
| Tunnel            | Pre-existing healthy Cloudflare Tunnel and pinned cloudflared LocalSystem service                                                         |
| Local ingress     | Envoy on `127.0.0.1:80`                                                                                                                   |
| Application       | server, webapp, Envoy, and Gotenberg containers                                                                                           |
| Data tier         | fresh action-derived MariaDB and Redis volumes on the private Compose network                                                             |
| Compose project   | `easyfire-bookkeeping-prod`                                                                                                               |
| Startup           | Compose `restart: unless-stopped`; no startup scheduled task                                                                              |
| Backup            | one exact daily task invoking the fifth `ScheduledBackup` stage from the sealed installed controller through canonical Windows PowerShell |
| Runtime authority | completed schema-2 action journal plus successful Postcheck                                                                               |

This topology is a candidate contract, not a claim that the current source is
running. Newsec and the external edge must be reconciled after publication.

## 3. Source and release identity

Release destinations:

- accepted source: `easyfire-forgejo/main` in private Forgejo repository
  `jonny-admin/easyfire-bookkeeping`;
- public AGPL mirror:
  `https://github.com/EasyFire101/easyfire-bookkeeping`;
- upstream-only source:
  `https://github.com/bigcapitalhq/bigcapital.git`.

The EasyFire destinations are not authoritative until one validated commit is
published and read back at both. Never push EasyFire changes to `origin`.

A production candidate uses a ZIP archive, exact SHA-256, non-`latest` image
tag, canonical GUID action ID, and release directory derived from the archive
hash. Action seals every extracted release file except the generated `.env`
into an action-bound manifest stored under the journal authority. Every later
script execution revalidates that seal.

The executable authority is an exact four-file bundle:

- `deploy/windows/production-action.ps1`;
- `deploy/windows/production-io.psm1`;
- `deploy/windows/production-state.psm1`; and
- `scripts/production/backup-integrity.psm1`.

Preflight and interactive stages bind the deployment bundle. The scheduled task
uses the byte-identical bundle inside the sealed installed release. Every file
path and SHA-256 must match the journal; a source checkout is not unattended
runtime authority.

## 4. Complete local proof before publication or production

Use synthetic inputs only and record exact results in `HANDOFF.md`:

```powershell
corepack pnpm install --frozen-lockfile
node --test .\tests\easyfire-release-readiness.test.mjs
corepack pnpm run format:check
corepack pnpm run lint:check
corepack pnpm run typecheck
corepack pnpm run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\production\validate.ps1
node .\scripts\project-foundation-check.mjs
node .\scripts\source-size-guard.mjs --changed
```

Also require focused server tests, synthetic E2E, PowerShell parsing, production
dependency-audit disposition, disposable Docker boot, migration, health,
baseline backup, exact sidecar/hash/gzip validation, isolated network-disabled
restore, Postcheck, and rollback proof. Partial earlier runs do not promote a
later source snapshot.

Current local evidence includes a frozen offline install, server typecheck,
6/6 dependency compatibility tests, the full six-project build, 31/31 focused
production tests, and 101/101 static checks. The complete production audit
reports 45 advisories: 9 low, 36 moderate, 0 high, and 0 critical. Final
disposable proof `b37426f03a8841d9923b853db5f40a08` and the two independent
read-only reviews found no remaining P1/P2 for source publication. Live
deployment remains separately gated by owner onboarding and Newsec/runtime
reconciliation. These results are authoritative only when their exact records
are present in `HANDOFF.md`.

## 5. Publish, then reconcile read-only

After complete local proof and independent review:

1. Publish the same accepted commit to Forgejo and public GitHub.
2. Verify the public corresponding source anonymously.
3. Inventory Newsec without mutation: exact production root, action journals,
   Compose project, containers, images, mounts, networks, volumes, scheduled
   tasks, release directories, and backup receipts.
4. Determine whether a valid schema-2 completed journal exists and whether its
   release identity matches accepted source.
5. Verify the pre-existing edge and perform authenticated read-only application
   acceptance.
6. If any historical, project-labeled, or action-derived MariaDB/Redis volume
   exists, stop. The fresh-install controller is not a migration or recovery
   path even when the deployed source is stale.
7. If no usable owner already exists and the target is otherwise fresh, stop.
   The controller has no first-owner onboarding capability.

## 6. Preflight

Use a new canonical GUID, exact ZIP path/hash, contained production root, and
verify-only Cloudflare credential file. The controller derives both immutable
image tags from the ZIP SHA-256:

```powershell
$ActionId = [guid]::NewGuid().ToString()
$Common = @{
  ReleaseArchive = 'C:\Production\incoming\easyfire-bookkeeping-<commit>.zip'
  ExpectedArchiveSha256 = '<64-character-sha256>'
  ProductionRoot = 'C:\Production'
  CloudflareCredentialFile = 'C:\Production\credentials\cloudflare.json'
  ActionId = $ActionId
}

.\deploy\windows\production-action.ps1 -Stage Preflight @Common
```

Preflight verifies Docker access, contained paths and non-reparse authority
chains, archive hash and ZIP content, exact four-file deployment controller
bundle, resource isolation, historical/project-labeled volume inventory,
current Compose inventory, exact port bindings and foreign volume consumers,
absence of the retired startup task, exact daily-backup-task state, credential
file identity, and exact Access/Tunnel/DNS/binary/service/process/active-
connector health. It uses read-only Cloudflare calls. Its only write is a
15-minute local schema-2 receipt binding the controller bundle, archive and
manifest, release directory, credential hash, target image references,
action-derived volume names, journal state, inventory fingerprint, and edge
identity.

Any changed input or expired receipt requires a new Preflight.

## 7. Action: fresh installation only

Action requires the same inputs and an exact confirmation ID:

```powershell
.\deploy\windows\production-action.ps1 -Stage Action @Common -ConfirmActionId $ActionId
```

The resumable schema-2 state machine:

1. creates the action journal and safely extracts the ZIP;
2. writes the action-bound sealed release manifest;
3. writes a restricted runtime environment candidate with new database/JWT
   secrets, production signup disabled, and empty signup allowlists; journals
   its path/hash before atomically publishing `.env`;
4. builds release-specific immutable images, records their exact image IDs,
   and rejects later tag-to-ID drift;
5. starts fresh action-derived MariaDB and Redis volumes while journaling the
   exact observed durable-volume subset before and after creation;
6. enters `migration_preparing`, creates and binds the exact one-shot migration
   container, journals start authorization before starting it at most once,
   then waits with a bounded timeout; resume observes that exact container
   instead of starting another migration;
7. creates a full baseline recovery unit and verifies its compressed dump,
   SHA-256 sidecar, authority-bound metadata, complete gzip stream, and isolated
   `--network none` import;
8. starts the application tier and records exact container IDs, built image IDs
   and references, mounts, network, volumes, port bindings, and foreign-volume
   consumer state;
9. proves the installed four-file controller bundle byte-identical to the
   deployment bundle and registers only the absent or exact journal-planned
   daily `ScheduledBackup` task; and
10. stops at `action_completed_pending_postcheck`.

Action never changes the verify-only edge and never rewrites approved inventory
to adopt drift.

## 8. Mandatory Postcheck

```powershell
.\deploy\windows\production-action.ps1 -Stage Postcheck @Common
```

Postcheck revalidates the journal, release seal, deployment and installed
four-file controller bundles, and exact built image IDs. It requires the exact
approved container, mount, network, volume, port-binding, and foreign-consumer
identity; proves the retired startup task absent; checks every field of the
exact daily backup task and local API/web health; proves
`SIGNUP_DISABLED=true` and empty allowlists inside the server; rechecks the
unchanged edge, active tunnel connector, and unauthenticated Access redirect;
and revalidates the baseline recovery unit and isolated restore receipt. Only
then may the journal become `completed`.

An Action pending Postcheck is not a completed deployment.

## 9. Scheduled backup

The one allowed daily task invokes the sealed installed controller, not
`backup.ps1` directly:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoProfile -WindowStyle Hidden `
  -File '<sealed-release>\deploy\windows\production-action.ps1' `
  -Stage ScheduledBackup -ReleaseArchive 'N/A' `
  -ExpectedArchiveSha256 'N/A' -ProductionRoot '<production-root>' `
  -CloudflareCredentialFile 'N/A' -ActionId '<journal-action-id>' `
  -AuthorityOwnerSid '<journal-bound-deployment-owner-sid>'
```

The `ScheduledBackup` stage acquires the same production mutex, requires the
exact completed journal and runtime/task authority, validates its installed
four-file bundle and the canonical deployment-owner SID sealed by interactive
Preflight/Action, creates a new journaled backup operation ID, and invokes the
bound backup implementation. The task runs as SYSTEM, while ACL authority is
limited to SYSTEM, Administrators, and that exact bound owner SID; identity
drift fails before backup work. Success publishes one crash-resumable recovery unit:

- `mysql-easyfire-bookkeeping-prod-full-<operation-id>.sql.gz`;
- the adjacent `.sha256` sidecar; and
- the adjacent `.metadata.json` binding the action, invocation role, operation
  ID, backup mode, phase/inventory, exact MySQL container/image/volume,
  destination, file path, and dump SHA-256.

The controller accepts the receipt only after exact metadata/hash/gzip checks
and an isolated network-disabled restore. Retention and cleanup must treat all
three files as one recovery unit.

## 10. Rollback

Use the same action authority and exact confirmation ID:

```powershell
.\deploy\windows\production-action.ps1 -Stage Rollback @Common -ConfirmActionId $ActionId
```

Rollback is retryable through `rollback_in_progress` and bounded to exact
journal authority.

- If the application tier ever started, rollback first creates a full emergency
  backup and proves its exact hash/gzip pair with isolated network-disabled
  import. A valid journaled receipt may be reused after an interrupted retry.
- It removes only the exact daily backup task when recorded as created by that
  ActionId.
- It runs Compose teardown without `-v`, removing the action's containers and
  network while preserving the exact observed action-derived volume subset,
  even if the interruption occurred before both volumes existed.
- It preserves release directories, backups, journals, credentials, and every
  Cloudflare/cloudflared resource.
- A repeated rollback re-proves task/container/network absence, preserved
  volume identity, and any required emergency recovery unit before returning
  success; `rolled_back` is not accepted as a label-only shortcut.
- Database restore is not part of controller rollback.

## 11. Existing database migration

The fresh-install controller still never adopts a historical/project-labeled
MariaDB or Redis volume. Existing data uses two separate fail-closed tools:

- `scripts/production/backup.ps1 -InvocationRole MigrationSource` requires a
  canonical migration ID plus exact caller-bound release, Compose, environment,
  project, container, image, volume, and destination identities. It will only
  dump the exact running healthy source and pins that recovery unit against
  retention. `restore-verify.ps1` restores it into a deterministic isolated
  migration namespace.
- `deploy/windows/migration-action.ps1` records Plan, caller planning rehearsal,
  and Rollback authority. It derives candidate-only projects and volumes,
  preserves every original release/volume/journal/backup, binds the exact target
  release/images and task XML recovery units, and rejects every Cutover request
  with `LIVE_EXECUTOR_PROOF_REQUIRED`.

`migration-action.ps1` is an authority/planning gate, not a trusted live Docker
or Scheduled Tasks executor. A future executor must create identity-bound live
receipts before Cutover can be implemented; caller-authored booleans are not
proof. Never manufacture an evidence receipt from process exit alone, and never
run the fresh-install Action against legacy volumes.

## 12. Owner onboarding

`scripts/production/bootstrap-owner.ps1` is a non-mutating retirement marker.
Do not call it as a release step and do not temporarily enable public signup to
work around it. Manual owner onboarding or recovery is an unresolved separate
capability requiring backup, authorization, audit, and rollback design.
A truly fresh database therefore cannot be called usable production until this
capability is resolved and the first owner can sign in with signup remaining
locked.

## 13. Synthetic live acceptance

After publication, reconciliation, and authenticated read-only acceptance,
create at most one uniquely labeled synthetic record only if persistence proof
is still needed and authorized.

- Record its exact organization, type, label, and identifier before creation.
- Use no real company, bank, tax, customer, vendor, or opening-balance data.
- Verify reload/readback.
- Re-inventory the exact identifier before removing only that record.
- Never use broad database cleanup or wildcard deletion.

## 14. Incident response

Preserve journals and evidence first. Classify the failure as edge, service,
Compose, application, database, or storage. Prefer read-only Postcheck and exact
inventory. Do not restart, rebuild, repair edge resources, attach an old volume
to a new engine, or restore data until the affected authority and recovery path
are proven and separately approved.

## 15. AGPL source availability

Every network user must have a visible Source code (AGPL-3.0) link to the public
EasyFire repository. Verify it on authentication, setup, signed-in shell, and
payment-portal surfaces after publication. Verify the public repository
anonymously and bind the exact deployed revision to an immutable commit.

See [AGPL_COMPLIANCE.md](./AGPL_COMPLIANCE.md) for the corresponding-source
boundary.
