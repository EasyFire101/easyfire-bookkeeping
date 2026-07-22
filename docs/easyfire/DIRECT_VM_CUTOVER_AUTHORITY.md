# Direct-VM cutover authority

This contract transfers EasyFire Bookkeeping production authority from the
preserved Windows runtime on `NEWSEC` to the private Linux VM
`easyfire-bookkeeping-newsec`. It is a one-shot, fail-closed operation. It does
not delete Windows containers, volumes, releases, journals, tasks, backups, or
Cloudflare material, and it never authorizes public exposure.

## Authority boundary

- Run the Windows controller only from
  `C:\ProgramData\AgentFoundry\easyfire-bookkeeping\releases\<releaseCommit>\scripts\production\direct-vm-cutover-authority.ps1`.
- The controller proves the release manifest plus every controlled executor's
  canonical path, owner/ACL boundary, mode declaration, byte count, and SHA-256
  before it creates the plan authority. A checkout, convenience copy, symlink,
  reparse point, changed artifact, or mixed release is refused.
- Run Linux executors only from
  `/opt/easyfire-bookkeeping/releases/<releaseCommit>/scripts/production/`.
  The evidence collector, Guardian promoter, and route activator independently
  prove their real path and exact release-manifest artifact before commands,
  locks, configuration promotion, or route activation.
- `/etc/easyfire-bookkeeping/cutover-evidence.json` may be created only by the
  root-only release-bound collector. Existing output is never replaced.

## One-shot sequence

1. Create and hash the protected cutover plan with `PreparePlan`. This stage is
   read-only toward the application runtime.
2. Produce the initial schema-2 checkpoint while Windows remains the only
   writer. Verify both copies, logical database restore, Redis payload, and the
   recorded source identities.
3. Deploy and validate the isolated Linux candidate. Keep Tailscale Serve,
   Funnel, port 443, and all public routes absent.
4. Prove the guest-native backup and isolated restore, rollback lock/rearm,
   reboot recovery, disposable Guardian recovery, native owner login, and
   accounting-data validation.
5. Run Guardian shadow rehearsal, then its active-policy rehearsal only against
   disposable containers. Keep the production timer inactive. The promoter
   preserves the exact shadow config as `guardian.shadow.json`, atomically
   installs only the verified `shadowMode: false` config as root-owned `0600`,
   and publishes a create-new promotion receipt.
6. Run `Quiesce`, then `VerifyQuiesced`. Only the six exact Windows stateless
   containers stop; MariaDB and Redis remain healthy but prove zero external
   writers, the two exact tasks and Cloudflare service remain disabled, and the
   old private launcher stops. Nothing is removed.
7. Produce the final schema-2 checkpoint in stopped-writer mode and run
   `BindFinalCheckpoint`. The checkpoint must be newer than quiescence and bind
   the source receipt, snapshot, writer proof, SQL payload, and Redis payload.
8. Copy the fixed root-owned collection plan and all named proof files to their
   canonical guest paths. Run the release-bound activation-evidence collector.
   It semantically validates every proof, cross-binds cutover/deployment/
   checkpoint identifiers and timestamps, reruns fixed-plan deployment
   verification, reads systemd/Tailscale/listener state, and exclusively creates
   `cutover-evidence.json`. The collector rejects reordered or future-dated
   proofs, a source-quiescence proof window over 24 hours, or a collection plan
   older than 15 minutes.
9. Run `AuthorizeActivation` with the exact collector output path and SHA-256.
   Authorization is once-only, expires after 900 seconds, and names exactly one
   tailnet-only HTTPS route. The activation evidence itself must be no more than
   900 seconds old when authorization is built and when the route activator
   validates it; issuing a fresh authorization never revives stale evidence.
10. Run the immutable route activator. It verifies Tailscale `1.98.9`, checks
    Serve and Funnel both before and after, rejects `--yes`, creates only the
    tailnet-private Serve proxy to `http://127.0.0.1:8080`, reruns deployment
    verification, and publishes a create-new activation receipt. After every
    pre-activation command and immediately before Serve, it revalidates both
    authorization expiry and activation-evidence freshness; a slow preflight
    therefore fails without creating the route.

## Rollback boundary

Before any guest user write and before activation, `AbortBeforeActivation` is
allowed only after the root-only, release-bound guest collector is run with
`--mode collect-guest-isolation`. That collector validates the fixed cutover,
source-quiescence, checkpoint-binding, deployment, runtime-manifest, and
rollback files; invokes the live rollback controller with `--verify-locked`;
and directly reads the seven exact container identities, restart policies,
systemd units, Tailscale `1.98.9` status, Serve, Funnel, and host listeners. It
then creates
`/etc/easyfire-bookkeeping/guest-pre-activation-isolation.json` as root-owned
`0600` with `O_EXCL` and never replaces it.

The abort path does not trust an operator-supplied "no writes" boolean. Its
conservative first-write boundary is the verified absence of all three
create-once activation artifacts: `cutover-authorization.json`,
`private-route-activation.lock`, and `private-route-activation.json`, together
with the live rollback lock, stopped runtime, inactive units, and absent route.
The route activator creates the activation lock before it executes any
activation command, so any activation attempt permanently forbids this Windows
source rearm path. When the collector proof passes, the Windows controller may
restart only the six exact Windows stateless containers and the hash-pinned
private launcher. The two tasks and Cloudflare service remain disabled.

Abort and activation also contend on the same root-owned create-new file,
`/etc/easyfire-bookkeeping/cutover-decision.json`. The guest collector claims
`abort`; the route activator claims `activate`. Both use the same atomic
`O_CREAT|O_EXCL` operation, so concurrent attempts cannot both win. The losing
path fails closed, and the winning claim is never removed or replaced. Every
later abort evidence/authority/receipt or activation lock/receipt records the
winning decision-claim hash. Before returning that hash, the writer securely
reopens the exact canonical path without following symlinks, rechecks
root/mode/type/size and unchanged file identity, parses the exact claim, and
hashes the on-disk bytes; downstream records bind only this reread winner.

After any guest user write, Windows is stale and automatic source reactivation
is permanently forbidden. Recovery then uses the verified Linux backup or the
explicit operator-reviewed migration/rollback procedure; it never creates two
writers.

## Guardian automation contract

- **Trigger:** the systemd timer runs 120 seconds after boot and then every 30
  seconds because absence-of-event health failure requires polling.
- **Preconditions:** fixed runtime manifest and active root-owned `0600`
  Guardian config; no rollback lock; exact stateless identities; MariaDB and
  Redis healthy and observe-only.
- **Mutations:** at most the allowlisted stateless recovery action within the
  configured threshold, cooldown, and two-attempt hourly budget.
- **Guardrails:** no migration, restore, pull, build, volume mutation, database
  or Redis restart, route change, cleanup, or deletion. Overlapping executions
  are refused by the service/runtime lock.
- **Observability:** structured state/status files and systemd journal record
  healthy observations, skips, attempts, cooldown, and failures.
- **Disable path:** stop and disable
  `easyfire-bookkeeping-guardian.timer`; a rollback lock also prevents runs.
- **Verification:** fixed-plan deployment readback, exact config/status files,
  service journal, timer active/enabled readback, and post-recovery health.

The cutover trigger itself remains an explicit one-shot operator action; the
Guardian timer is not deployment, migration, cutover, rollback, or cleanup
authority.
