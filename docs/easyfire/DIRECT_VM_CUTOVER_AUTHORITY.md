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
  The rehearsal and native-auth collectors, evidence collector, Guardian
  promoter, and route activator independently prove their real path and exact
  release-manifest artifact before commands, locks, proof publication,
  configuration promotion, or route activation.
- `/etc/easyfire-bookkeeping/cutover-evidence.json` may be created only by the
  root-only release-bound collector. Existing output is never replaced.

## One-shot sequence

1. Create and hash the protected cutover plan with `PreparePlan`. This stage is
   read-only toward the application runtime.
2. Produce the initial schema-2 checkpoint while Windows remains the only
   writer. Verify both copies, logical database restore, Redis payload, and the
   recorded source identities.
3. Qualify the exact release on the separate
   `easyfire-bookkeeping-rehearsal-newsec` VM. Its machine identity and
   deployment ID must differ from production, and Serve, Funnel, public
   listeners, and production-data mutation must remain absent. The rollback
   controller produces distinct arm, later-boot locked, and rearm receipts;
   `--verify-locked` durably creates the locked-reboot receipt instead of merely
   printing a successful check.
4. Run the release-bound rehearsal controller's exercise phase. It obtains
   machine-produced Guardian shadow/active/refusal proof, Docker service and
   daemon recovery proof, invalid-authority refusal proof, and a create-new
   normal-reboot marker. Reboot normally, use the native-auth collector at the
   credential boundary, and then run the rehearsal collection phase. Collection
   proves the changed boot ID, stack authority, and active/enabled Guardian
   timer. Locked-reboot and normal-reboot/recovery are separate gates.
5. At that native-auth boundary, the owner enters
   the password interactively and explicitly confirms the sole-owner assertion
   and that one sign-in; the collector binds authenticated account and
   organization responses to the signed-in principal, validates exact
   server-side database/Redis invariants, persists no password/token/session,
   and publishes only hashes, counts, and pass/fail structure. The final
   rehearsal receipt hashes each subordinate proof and is
   bound to the exact release and rehearsal deployment, not to a future
   production checkpoint or deployment.
6. Run `Quiesce`, then `VerifyQuiesced`. Only the six exact Windows stateless
   containers stop; MariaDB and Redis remain healthy but prove zero external
   writers, the two exact tasks and Cloudflare service remain disabled, and the
   old private launcher stops. Nothing is removed.
7. Produce the final schema-2 checkpoint in stopped-writer mode and run
   `BindFinalCheckpoint`. The checkpoint must be newer than quiescence and bind
   the source receipt, snapshot, writer proof, SQL payload, and Redis payload.
8. Deploy and validate the production Linux candidate from that final
   checkpoint with the exact qualified release. Keep Tailscale Serve, Funnel,
   port 443, and all public routes absent. Produce the guest-native backup and
   isolated-restore proof and a new native-auth proof bound to this production
   deployment, checkpoint, and deployment receipt.
9. Promote Guardian policy only with the exact-release rehearsal receipt. The
   promoter independently proves the current production cutover/deployment,
   production machine identity, distinct rehearsal machine/deployment, and an
   inactive timer. It preserves the exact shadow config as
   `guardian.shadow.json`, atomically installs only the verified
   `shadowMode: false` config as root-owned `0600`, and publishes a create-new
   promotion receipt. The rehearsal receipt qualifies the release; it is not a
   substitute for the production checkpoint, backup, or live readbacks.
10. Copy the fixed root-owned collection plan and all named proof files to their
   canonical guest paths. Run the release-bound activation-evidence collector.
    It consumes the exact-release rehearsal receipt plus the separate current
    production checkpoint, deployment, backup/restore, Guardian-promotion, and
    native-auth receipts. It semantically validates and cross-binds them, reruns
    fixed-plan deployment verification, reads systemd/Tailscale/listener state,
    re-hashes the exact `SHA256SUMS` file set, payloads, and proof TSVs from the
    root-owned backup directory, and confirms the isolated restore container is
    still stopped/networkless with its exact proof volume preserved,
    and exclusively creates `cutover-evidence.json`. Hand-authored reboot,
    recovery, Guardian, or authentication booleans are not accepted. The
    collector rejects reordered or future-dated production proofs, a
    source-quiescence proof window over 24 hours, or a collection plan older
    than 15 minutes; the earlier rehearsal is allowed to predate that window.
11. Run `AuthorizeActivation` with the exact collector output path and SHA-256.
   Authorization is once-only, expires after 900 seconds, and names exactly one
   tailnet-only HTTPS route. The activation evidence itself must be no more than
   900 seconds old when authorization is built and when the route activator
   validates it; issuing a fresh authorization never revives stale evidence.
12. Run the immutable route activator. It verifies Tailscale `1.98.9`, checks
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
