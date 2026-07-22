# EasyFire Bookkeeping Linux VM runbook

## Authoritative topology

`easyfire-bookkeeping-newsec` is a dedicated Ubuntu 24.04 LTS Hyper-V guest on
Newsec. It uses an internal, outbound-NAT-only network for bootstrap and its own
Tailscale identity for normal administration and user access.

- Hyper-V VM: `easyfire-bookkeeping-newsec`
- Internal subnet: `172.30.160.0/24`
- Newsec gateway: `172.30.160.1`
- Guest bootstrap address: `172.30.160.10`
- Private hostname: `easyfire-bookkeeping-newsec.taild63e9b.ts.net`
- App listener: guest loopback `127.0.0.1:8080`
- User route: private Tailscale Serve HTTPS only
- Public DNS, router forwarding, inbound NAT, Funnel, and public tunnels: none

The preserved Windows runtime remains the rollback authority until the
cutover-observation window is explicitly closed. Never allow both databases to
accept writes.

## Host runtime contract

- Install Docker Engine and the Compose plugin from Docker's signed Ubuntu
  repository; do not use Docker Desktop or the convenience installer.
- Install the official Node.js `v22.23.1` Linux x64 release under
  `/opt/nodejs/node-v22.23.1` only after its entry in the upstream
  `SHASUMS256.txt` passes. Expose it as `/usr/local/bin/node`; the Guardian
  systemd unit deliberately does not depend on Ubuntu's older Node package.
- Install Tailscale from its signed stable Ubuntu repository, but do not enroll
  the guest or configure Serve until the credential and candidate-health gates.
- Record installed package versions, upstream checksums, service enablement,
  firewall rules, and swap configuration in the deployment evidence manifest.
- Runtime upgrades are attended releases: prove the Guardian suite and the
  backup/restore/rollback gates before changing pinned versions.

## Filesystem contract

```text
/opt/easyfire-bookkeeping/releases/<source-commit>/  immutable source release
/opt/easyfire-bookkeeping/current                    atomic release symlink
/opt/easyfire-bookkeeping/guardian/guardian.js       bundled Guardian artifact
/etc/easyfire-bookkeeping/production.env             root-only secrets (0600)
/etc/easyfire-bookkeeping/guardian.json               Guardian policy (0600)
/etc/easyfire-bookkeeping/runtime-manifest.json       pinned identities (0600)
/var/lib/easyfire-bookkeeping-guardian/               atomic state/status
/var/backups/easyfire-bookkeeping/                    append-only backup units
```

No secret, database dump, Redis snapshot, Docker export, runtime manifest with
live container IDs, or accounting data belongs in Git.

### Immutable operational executors

`release-manifest.json` version 2 is the byte and install-mode authority for
every executable used after `source.tar.gz` is created. In addition to the
deployment, backup, rollback, and Guardian files, it must contain these exact
mode-`0644` artifacts:

- `scripts/production/linux-source-archive-authority.mjs`
- `scripts/production/linux-checkpoint-authority-v2.mjs`
- `scripts/production/direct-vm-checkpoint-v2-contract.mjs`
- `scripts/production/direct-vm-cutover-contract.mjs`
- `scripts/production/direct-vm-source-abort-contract.mjs`
- `scripts/production/direct-vm-cutover-authority.ps1`
- `scripts/production/direct-vm-preflight-checkpoint.ps1`
- `scripts/production/linux-final-quiescence-contract.mjs`
- `scripts/production/linux-cli-entrypoint.mjs`
- `scripts/production/linux-oci-bundle-produce.mjs`
- `scripts/production/linux-target-engine-evidence-produce.mjs`
- `scripts/production/linux-native-auth-proof.mjs`
- `scripts/production/linux-rehearsal-evidence.mjs`
- `scripts/production/linux-activation-evidence-collect.mjs`
- `scripts/production/linux-guardian-promote-active.mjs`
- `scripts/production/linux-private-route-activate.mjs`

Construct the archive only from the exact accepted Git commit, with Git's
embedded commit header and deterministic install modes. Build the two ignored
Guardian bundles from that commit first, then run this exact archive command
from the repository root:

```bash
git -c tar.umask=0022 archive --format=tar.gz --output=source.tar.gz \
  --prefix=packages/guardian/dist/ \
  --add-file=packages/guardian/dist/guardian.js \
  --add-file=packages/guardian/dist/runtime-manifest-generator.js \
  --prefix= \
  '<releaseCommit>'
```

Extract that archive into a new empty release source root and run the manifest
producer against that extraction, never against the working checkout. The
producer streams both gzip and tar, requires the embedded Git commit to equal
`releaseCommit`, and requires every bound artifact's archive path, bytes, and
mode to equal the extracted source file. It rejects traversal, duplicate or
case-ambiguous names, links, unexpected tar types, malformed pax metadata,
nonzero padding, and gzip/tar truncation. The two `--add-file` options above are
required because Guardian build output is intentionally ignored by Git; the
paired `--prefix` values place those exact bytes at their release paths before
resetting tracked files to the archive root.

On Linux, extract only into the root-owned, non-group/world-writable
`/opt/easyfire-bookkeeping/releases/<releaseCommit>` directory and point
`current` at that exact release. Invoke the checkpoint authority and private
route activator only through `/usr/local/bin/node` at their exact `current`
paths. The checkpoint producer can publish only a create-new candidate
authority document; the initial deployment controller treats it as untrusted,
verifies the complete manifest-bound release first, and performs no Docker
action if either release or checkpoint proof fails. Immediately before private
route activation, run the fixed-plan `linux-deploy-candidate.mjs
--verify-existing` command shown below. That external gate verifies every
release artifact before the activator can alter route state. A missing file,
changed byte, wrong mode, symlink, owner drift, or release-path drift is a hard
stop. Never execute an operational executor from a Git checkout, staging
directory, home directory, temporary directory, or copied convenience path.

### Offline image bundle and target-engine authority

Build the five EasyFire images from the exact accepted release commit and retain
the two external images at their pinned digest references. Export exactly one
role into each OCI input archive. Transfer the seven archives into a new
root-owned staging directory on the rehearsal VM; every input must be a regular,
non-symlink mode-`0600` file and no existing path may be overwritten. The old
bundle remains preserved and must not be reused after source changes.

Run the release-owned deterministic bundle producer from the immutable extracted
release, load only its output into the isolated rehearsal engine, and then
produce target-engine evidence from that same engine:

```bash
RELEASE_COMMIT='<exact accepted 40-character commit>'
STAGING='/var/lib/easyfire-bookkeeping-staging'

sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-oci-bundle-produce.mjs \
  --release-commit "$RELEASE_COMMIT" \
  --envoy "$STAGING/oci/envoy.oci.tar" \
  --webapp "$STAGING/oci/webapp.oci.tar" \
  --server "$STAGING/oci/server.oci.tar" \
  --gotenberg "$STAGING/oci/gotenberg.oci.tar" \
  --mysql "$STAGING/oci/mysql.oci.tar" \
  --redis "$STAGING/oci/redis.oci.tar" \
  --migration "$STAGING/oci/migration.oci.tar" \
  --output "$STAGING/images.tar"

sudo /usr/bin/docker image load --input "$STAGING/images.tar"

sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-target-engine-evidence-produce.mjs \
  --release-commit "$RELEASE_COMMIT" \
  --image-bundle "$STAGING/images.tar" \
  --output "$STAGING/target-engine-evidence.json"
```

The producer accepts one runnable Linux/amd64 manifest per role, tolerates only
the expected multi-platform/attestation structure, and binds the pinned root OCI
digest. Target-engine evidence then requires Docker 29.6.2 and proves each loaded
image ID and permitted digest identity. Build `release-manifest.json` version 2
only after `source.tar.gz`, `images.tar`, and
`target-engine-evidence.json` exist and pass their release-owned validators.
Never substitute a hand-written bundle inventory, raw Docker inspection receipt,
mutable tag, or a working-tree executor.

On Windows, extract the same immutable source release into the protected,
non-reparse-point directory
`C:\ProgramData\AgentFoundry\easyfire-bookkeeping\releases\<releaseCommit>`.
Apply the cutover authority ACL described by the controller, then verify the
eight Windows-controlled release executor/module hashes against their matching
manifest artifacts: the contract, source controller, checkpoint controller,
checkpoint v2 contract, final-quiescence contract, activation-evidence
collector, Guardian promotion controller, and abort contract. The cutover plan
must bind each absolute installed path and exact SHA-256 value, including
`C:\ProgramData\AgentFoundry\easyfire-bookkeeping\releases\<releaseCommit>\scripts\production\direct-vm-cutover-authority.ps1`.
All seven sibling module/controller paths must remain under that same immutable
release. Invoke the source controller only at the plan-bound installed path;
it independently refuses a missing input, hash mismatch, reparse point, unsafe
ACL, or self-path mismatch. The mutable project checkout is never source
quiesce authority.

## Deployment gates

1. Verify source commit and image/archive SHA-256 values.
2. Build or load immutable images without mutable tags.
3. Create fresh uniquely named VM volumes.
4. Restore the logical database into those isolated volumes.
5. Require MariaDB integrity, 17 system tables, 70 tenant tables, and exact
   1/1/1/1 user/tenant/metadata/mapping invariants.
6. Start the candidate stack on loopback only; do not route users yet.
7. Prove native password login and authenticated application pages.
8. Create a guest-native backup and restore it into another fresh isolated
   volume.
9. Prove the Windows-route rollback without allowing two writers.
10. Reboot the VM and prove Docker, exact existing containers, systemd, and
    Guardian return healthy.
11. Rehearse Guardian in shadow mode with disposable containers.
12. Cut over the private Tailscale route only when every gate is green.

## One-time controller deployment

The controller validates the exact production, VM, and restart-`no` candidate
Compose model and proves its only published socket is `127.0.0.1:8080` before
creating anything. Before that validation, the attended deployment operator must materialize and
hash-record `/etc/easyfire-bookkeeping/candidate-with-legacy-jwt.env` as a
root-owned mode-`0600` environment that is Linux-ready in every respect except
for its legacy JWT key. The checkpoint's `JWT_SECRET` value must remain
untouched in that staged file. Convert it without shell evaluation or secret
rotation:

```bash
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-convert-production-env.mjs \
  --source /etc/easyfire-bookkeeping/candidate-with-legacy-jwt.env \
  --target /etc/easyfire-bookkeeping/production.env \
  --release-commit '<exact 40-character releaseCommit from deployment-plan.json>' \
  --mysql-volume '<exact easyfire_bookkeeping_vm_*_mysql name from deployment-plan.json>' \
  --redis-volume '<matching easyfire_bookkeeping_vm_*_redis name from deployment-plan.json>' \
  --base-url 'https://easyfire-bookkeeping-newsec.taild63e9b.ts.net'
```

The helper validates the existing production JWT policy, maps only
`JWT_SECRET` to `APP_JWT_SECRET`, omits the legacy key, and never prints a value.
The release commit and both isolated volume names must be copied exactly from
the already validated deployment plan; placeholders above are documentation,
not runnable values.
It refuses duplicate or ambiguous dotenv entries, symlinked or permissive
paths, and any pre-existing target whose bytes or mode differ. A byte-identical
root-owned mode-`0600` target is the only accepted rerun. Preserve both files
and bind their SHA-256 values into the deployment evidence.

Creation, restore, and migration are one attended transaction. The required
order is:

1. Verify the source, image bundle, checkpoint, and environment hashes; prove
   Compose publishes only `127.0.0.1:8080`.
2. Prove the target volume and container names do not exist. The controller
   creates all seven services with `--pull never`, `--no-build`, and the
   candidate override. The override leaves every restart policy permanently at
   `no`, so Docker can never bypass the systemd authority gate.
3. Copy the verified Redis RDB into the stopped Redis container's `/data` volume.
4. Start only MariaDB and Redis with `start --wait`; restore the verified logical
   SQL archive into MariaDB and revalidate the 17/70 and 1/1/1/1 invariants.
5. Attach to the already-created `easyfire-bookkeeping-migration` container and
   require exit code zero. Preserve the exited migration container as the
   migration receipt.
6. Start Gotenberg, server, webapp, and Envoy with `start --wait`; require all
   local health probes and exact container/image identity checks.
7. Generate the root-only runtime manifest from the running guest's actual
   container `.Id` and `.Image` values. Do not substitute an OCI index or repo
   digest for Docker's container image ID.
8. Publish the final activation receipt last, then install and enable the
   systemd stack unit and Guardian timer. All seven containers remain restart
   `no`. The stack unit re-verifies the complete immutable authority chain
   before each start and refuses to run while
   `/etc/easyfire-bookkeeping/rollback.lock` exists.

The release-owned deployment controller is the only creation, restore,
migration, runtime-document, and receipt authority. The staged plan must be a
root-owned mode-`0600` regular file at the exact fixed staging path. The bound
`source.tar.gz`, `images.tar`, and `target-engine-evidence.json` files in the
same staging directory must also be root-owned mode-`0600` regular files. The
`current` symlink plus Guardian generator must already match its pinned release:

```bash
cd /opt/easyfire-bookkeeping/current
sudo install -d -o root -g root -m 0755 /opt/easyfire-bookkeeping/guardian
sudo install -m 0644 packages/guardian/dist/guardian.js \
  /opt/easyfire-bookkeeping/guardian/guardian.js
sudo install -m 0644 packages/guardian/dist/runtime-manifest-generator.js \
  /opt/easyfire-bookkeeping/guardian/runtime-manifest-generator.js
sudo install -m 0644 deploy/linux/easyfire-bookkeeping-stack.service \
  /etc/systemd/system/easyfire-bookkeeping-stack.service
sudo install -m 0644 deploy/linux/easyfire-bookkeeping-guardian.service \
  /etc/systemd/system/easyfire-bookkeeping-guardian.service
sudo install -m 0644 deploy/linux/easyfire-bookkeeping-guardian.timer \
  /etc/systemd/system/easyfire-bookkeeping-guardian.timer

# These are inert byte copies only. Do not daemon-reload, enable, or start them
# until both controller calls below verify the complete manifest-bound release.
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs \
  --plan /var/lib/easyfire-bookkeeping-staging/deployment-plan.json

# Required readback before systemd installation or any route work:
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs \
  --verify-existing \
  --plan /etc/easyfire-bookkeeping/deployment-plan.json

# Installed-copy verification has passed. Activation is allowed only now.
sudo systemctl daemon-reload
sudo systemctl enable \
  easyfire-bookkeeping-stack.service easyfire-bookkeeping-guardian.timer
```

Both commands print one secret-free JSON result. A nonzero exit, missing final
receipt, incomplete journal, identity drift, or failed restore/migration proof
is a hard stop. Never substitute raw Compose, Docker migration, or receipt
creation commands for this controller.

Routine boot uses only `docker compose start` with the restart-`no` candidate
override through
`easyfire-bookkeeping-stack.service`; it never runs `up`, `down`, `build`,
`pull`, or the migration service.

## Private Tailscale route

After the guest is enrolled interactively, the local candidate is healthy, and
the exact cutover authorization and mutually bound proof documents are present,
perform one final external release verification and invoke only the
release-bound route activator:

```bash
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs \
  --verify-existing \
  --plan /etc/easyfire-bookkeeping/deployment-plan.json
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-private-route-activate.mjs \
  --activate \
  --authorization /etc/easyfire-bookkeeping/cutover-authorization.json
```

The activator alone may issue the exact `tailscale serve` mutation. It performs
another fixed-plan deployment preflight, proves Serve and Funnel are absent,
creates the one tailnet-only HTTPS route, and publishes a root-only activation
receipt after its postcheck. Do not run a raw `tailscale serve` or use
`tailscale funnel`. Enrollment or identity approval is a human credential/MFA
boundary.

## Backup and restore

Backups are new timestamped directories with no retention deletion. The backup
refuses to start unless the root-only checkpoint, migration, deployment,
runtime-manifest, and runtime-identity receipts all hash-bind the same current
release. It also binds the full live container IDs, actual engine image IDs,
Compose project/service labels, and exact named-volume mounts. Each unit
contains the streamed compressed MariaDB dump, Redis snapshot, copied authority
documents, sanitized invariants, SHA-256 manifest, and `RESTORE.md`.

Verification always restores into a new `--network none` volume using the
already-loaded MariaDB engine image with `--pull=never`. The proof uses freshly
random credentials delivered through ephemeral root-only files; it never copies
the production credentials. Those files are destroyed after validation while
the stopped proof container and volume are preserved.

Run the release-owned implementation as root:

```bash
sudo /opt/easyfire-bookkeeping/current/scripts/production/linux-backup-verify.sh
```

The command succeeds only after application-user `mariadb-check`, the 17/70
schema table counts, the 1/1/1/1 identity invariants, and numeric protected
accounting counts from the restored snapshot pass. It rechecks every artifact hash and
live authority, atomically publishes `backup-receipt.json`, and writes `COMPLETE`
last. A unit without both final files is incomplete. The command prints the
append-only backup path and preserved proof resource names; a collision or
partial proof fails closed and never reuses or removes a prior unit.

Never test restore against the active volume. Never treat Redis as accounting
authority.

## Rollback

Rollback is route-first and fail-closed:

1. Decide the data authority before touching either route. If the VM has never
   received a user write, prove the no-delta window against the cutover
   checkpoint. If it has received any write, create a VM backup, pass its
   isolated restore, restore it into a **fresh** Windows rollback volume, and
   validate that candidate before routing users back. Never route back to the
   older Windows volume while newer VM records exist.
2. Run the release-owned rollback-lock controller. It first re-verifies the
   complete deployment authority, changes all six long-running containers to
   restart `no`, proves that neutral restart policy, then atomically creates
   `/etc/easyfire-bookkeeping/rollback.lock` mode `0600`.
3. The controller stops the Guardian timer and service, disables and verifies
   both Tailscale Serve and Funnel, then stops the four stateless containers
   followed by Redis and MariaDB. It proves the restart policies remain `no`,
   port 8080 has no listener, every Bookkeeping container is stopped, the
   migration remains exited successfully, and all resources are preserved. The
   lock blocks the systemd and Guardian paths; the proven restart-`no` policies
   separately block Docker from resurrecting the writer. Verify both layers
   with one reboot under the lock and a release-owned `--verify-locked` run.
4. Route users to the exact validated Windows authority selected in step 1.
5. Verify native login, authenticated pages, and the accounting invariants.
6. Keep the rollback lock, VM, containers, volumes, release, journals, and every
   backup preserved for review. Removing the lock is a later attended recovery,
   never part of rollback cleanup.

Use rehearsal mode for the mandatory pre-cutover reboot proof. Only rehearsal
locks can be rearmed; rearm failure restores the live lock and re-quiesces the
runtime:

```bash
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-rollback-lock.mjs \
  --arm --reason rehearsal
sudo systemctl reboot
# After reconnecting:
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-rollback-lock.mjs \
  --verify-locked
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-rollback-lock.mjs \
  --rearm
```

The complete rehearsal is owned by the release-bound controller. Before
`--exercise`, install a root-owned mode-`0600`
`/etc/easyfire-bookkeeping/rehearsal-evidence-plan.json` that binds the exact
rehearsal deployment and release, the distinct production machine-ID hash, and
all subordinate proof locations. Serve, Funnel, public listeners, and production
machine identity must be absent. Run the exercise phase, reboot while locked,
verify and rearm the rehearsal-only lock, then complete a normal reboot and
Guardian recovery. At the credential boundary, run the native-auth collector in
an attached terminal and enter the owner password there; never pass or persist
the password through a command argument, file, chat, or log:

```bash
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-rehearsal-evidence.mjs \
  --exercise \
  --plan /etc/easyfire-bookkeeping/rehearsal-evidence-plan.json

# Perform the controller-requested locked reboot, verify/rearm, normal reboot,
# and Guardian recovery steps before collecting authentication evidence.
sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-native-auth-proof.mjs \
  --collect \
  --plan /etc/easyfire-bookkeeping/deployment-plan.json \
  --output /etc/easyfire-bookkeeping/activation-proof/authentication.json

sudo /usr/local/bin/node \
  /opt/easyfire-bookkeeping/current/scripts/production/linux-rehearsal-evidence.mjs \
  --collect \
  --plan /etc/easyfire-bookkeeping/rehearsal-evidence-plan.json \
  --output /etc/easyfire-bookkeeping/rehearsal-evidence.json
```

Collection revalidates chronology, machine and boot identities, the rollback
chain, native authenticated API/data invariants, Guardian recovery, route
absence, and every subordinate proof hash. The resulting rehearsal receipt
qualifies only that immutable release for later production consideration; it is
not a production checkpoint, deployment, authentication, backup, or cutover
receipt.

For an actual rollback, use `--arm --reason rollback`, then verify the locked
state after reboot. The controller permanently refuses `--rearm` for a real
rollback lock.

Do not delete, prune, recreate, or reuse either side during rollback.
