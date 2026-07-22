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

The state machine is:

```text
healthy -> suspect -> recovering -> cooldown
                  \-> escalated
```

- Failure confirmation: 3 observations.
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

Docker restart policies handle an ordinary process exit. systemd owns Docker,
boot ordering, Guardian scheduling, overlap prevention, time limits, and
journald. Guardian handles only the narrow gap where one exact stateless
container remains stopped after three observations.

Command Center may later read the sanitized status file, but it does not own
or mutate Guardian policy. Bookkeeping source, deployment topology, and
recovery policy ship together in this repository.

## Rehearsal and enablement

1. Validate config and runtime-manifest identity.
2. Run healthy observations in shadow mode.
3. Rehearse failures against disposable, non-production containers.
4. Prove data-role and identity-mismatch refusal.
5. Prove one allowed stateless start and the cooldown/budget behavior.
6. Enable active mode only after the VM backup, rollback, reboot, and
   single-writer gates pass.

Disable only the timer to suspend Guardian:

```bash
sudo systemctl disable --now easyfire-bookkeeping-guardian.timer
```

Disabling Guardian does not stop the Bookkeeping stack. Removal or cleanup is
a separate destructive scope.
