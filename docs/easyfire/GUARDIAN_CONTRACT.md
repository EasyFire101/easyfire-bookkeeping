# EasyFire Bookkeeping Guardian contract

Guardian is a small, versioned TypeScript reconciler owned by this repository.
It runs as a systemd one-shot service on a timer; it is not an AI agent, an
open-ended daemon, or a replacement for backups.

## Recovery boundary

Guardian may issue exactly one Docker Engine operation:

```text
POST /containers/<pinned-container-id>/start
```

That operation is permitted only for one stopped, identity-matching stateless
container with role `envoy`, `webapp`, `server`, or `gotenberg`, after three
matching failed observations. Guardian never issues restart, stop, create,
recreate, pull, build, Compose, migration, SQL, restore, volume, image, prune,
or deletion operations.

MariaDB and Redis are observe-only. A missing, stopped, or unhealthy data
service immediately produces `escalated` state and no recovery action. A
running-but-unhealthy stateless service also escalates; Guardian does not
restart it.

## Identity and state

`/etc/easyfire-bookkeeping/runtime-manifest.json` pins the exact container ID,
image ID, container name, role, and recovery mode for each of the six
long-running services. Any mismatch fails closed.

The bundled `runtime-manifest-generator.js` is the only supported writer for
that file and its separate sanitized
`/etc/easyfire-bookkeeping/runtime-identity-evidence.json` receipt. It reads
the schema-2 release manifest and the local Docker Unix socket directly; it
does not invoke a shell, Docker CLI, or Compose. Generation requires exactly
the six named long-running containers to be running and Docker-healthy, and
refuses to replace either output if it already exists. Both outputs use
write-fsync-rename publication with mode `0600`.

Every schema-2 image entry must separately name `ociIndexDigest`,
`linuxAmd64ManifestDigest`, and `engineImageId`; the ambiguous legacy
`imageId` field is rejected. The generator compares every local image object
and container `.Image` with `engineImageId`. For the four release-built images
(`server`, `webapp`, `mysql`, and `redis`), it also requires the exact
`git-<releaseCommit>` tag. For Envoy and Gotenberg it additionally proves the
exact configured tag-plus-OCI-index digest against the local image object's
`RepoDigests`. The Guardian manifest therefore always records the running
container inspect `.Image` config digest, never the OCI index or platform
manifest digest. All three release authority digests are retained in the
sanitized evidence. The one-shot migration image is required in release
authority but is excluded from Guardian runtime authority.

Before systemd starts existing containers, use the generator's
`--verify-existing` mode. It revalidates the current-release symlink, release
manifest, both existing runtime documents, exact container identities, and
local image objects. This mode permits exact containers in `created` or
stopped (`exited`) state, performs only Docker Engine `GET` requests, and
writes nothing.

The state machine is:

```text
healthy -> suspect -> recovering -> cooldown
                  \-> escalated
```

- Failure confirmation: 3 observations.
- Failure confirmation is keyed by a deterministic failing target set. A
  different failed service/probe resets the count to one; healthy or immediate
  fail-closed observations clear it.
- Timer interval: 30 seconds.
- Cooldown after a recovery action: 15 minutes.
- Recovery budget: 2 actions per rolling hour.
- Initial deployment mode: `shadowMode=true`.
- Persistent state and sanitized current status:
  `/var/lib/easyfire-bookkeeping-guardian/`.

State and status use write-fsync-rename atomic replacement with mode `0600`.
They contain health metadata only—never credentials, HTTP bodies, environment
values, accounting rows, or Docker inspect payloads.

## Ownership model

Every Bookkeeping container permanently uses Docker restart `no`. systemd owns
the only boot/start gate and re-verifies the immutable deployment chain before
starting existing containers. The Guardian timer requires that stack gate, so
it can safely reactivate it after a Docker daemon restart. Guardian then handles
only the narrow gap where one exact stateless container remains stopped after
three observations; MySQL and Redis remain observe-only and escalate instead
of being restarted automatically.

Command Center may later read the sanitized status file, but it does not own
or mutate Guardian policy. Bookkeeping source, deployment topology, and
recovery policy ship together in this repository.

## Rehearsal and enablement

Guardian qualification runs on the isolated
`easyfire-bookkeeping-rehearsal-newsec` VM through the release-bound
`linux-rehearsal-evidence.mjs` controller. The controller rejects a rehearsal
machine identity equal to production, verifies the exact release manifest and
rehearsal deployment, requires no Serve/Funnel/public listener, and records
zero production-data mutations. Its receipt deliberately does not bind a
future production checkpoint or deployment ID.

The proof is split across real state transitions rather than operator-authored
pass/fail files:

1. The rollback controller arms the isolated deployment, verifies a later boot
   while the lock is still effective, and durably creates `locked-reboot.json`.
   Rearm is allowed only from that exact later-boot receipt. This proves the
   locked-reboot behavior independently from ordinary recovery.
2. `linux-rehearsal-evidence.mjs --exercise` validates identity, performs three
   shadow observations, proves one allowlisted stateless start and cooldown,
   and proves Redis, MariaDB, and identity-mismatch refusal. It also rehearses
   Docker-service restart, Docker-daemon failure, and invalid deployment
   authority while restoring the original receipt byte-for-byte.
3. The controller writes a create-new normal-reboot marker. After a separate
   ordinary reboot, run the native-authentication collector and then
   `linux-rehearsal-evidence.mjs --collect`. Collection proves the boot ID
   changed and the immutable stack authority passed. It then waits boundedly
   for a completed current-boot Guardian timer invocation, binds the stable
   systemd invocation to exactly one same-boot journal status, requires that
   status to match the secure status file byte-for-object, and requires every
   service identity and HTTP probe to be healthy. The normal-reboot proof is
   timestamped after the authentication receipt and remains distinct from the
   locked-reboot receipt.
4. The collector consumes that release-bound native-authentication receipt. The
   receipt is created only through an interactive owner login, binds the
   authenticated account and organization responses to the signed-in
   principal, and validates the database/Redis invariants server-side. The
   owner confirmation authorizes the sole-owner assertion and that one sign-in
   at the credential boundary; the receipt stores only hashes and counts and
   records that no credential or session secret was persisted.
5. The final root-owned `0600` rehearsal receipt hashes every subordinate
   machine-produced proof and is published create-new. Production Guardian
   promotion accepts only that exact-release receipt, then separately verifies
   the current production cutover plan, deployment, machine identity, and
   config before materializing active mode. The rehearsal deployment and
   machine must differ from production.

Active mode is enabled only after the production backup, rollback,
single-writer, activation, and live-readback gates also pass. Passing the
isolated rehearsal alone never authorizes migration, route activation, or a
production write.

Disable only the timer to suspend Guardian:

```bash
sudo systemctl disable --now easyfire-bookkeeping-guardian.timer
```

Disabling Guardian does not stop the Bookkeeping stack. Removal or cleanup is
a separate destructive scope.
