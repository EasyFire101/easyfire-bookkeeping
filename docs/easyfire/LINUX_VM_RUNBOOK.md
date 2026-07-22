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

## One-time Compose deployment

Use both Compose files with project `easyfire-bookkeeping-prod`:

```bash
sudo docker compose \
  --project-name easyfire-bookkeeping-prod \
  --file /opt/easyfire-bookkeeping/current/docker-compose.prod.yml \
  --file /opt/easyfire-bookkeeping/current/deploy/linux/docker-compose.vm.yml \
  --env-file /etc/easyfire-bookkeeping/production.env \
  config --quiet
```

Creation, migration, and restore are explicit attended release operations.
Routine boot uses only `docker compose start` through
`easyfire-bookkeeping-stack.service`; it never runs `up`, `down`, `build`,
`pull`, or the migration service.

## Private Tailscale route

After the guest is enrolled interactively and the local candidate is healthy:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

Do not use `tailscale funnel`. The route must remain tailnet-only. Enrollment
or identity approval is a human credential/MFA boundary.

## Backup and restore

Backups are new timestamped directories with no retention deletion. Each unit
contains the compressed logical MariaDB dump, optional Redis snapshot,
sanitized invariants, image/source/runtime identifiers, SHA-256 manifest, and
`RESTORE.md`. Verification always restores into a new network-isolated volume
and preserves the stopped proof container and volume.

Never test restore against the active volume. Never treat Redis as accounting
authority.

## Rollback

Rollback is route-first and fail-closed:

1. Block writes to the VM candidate.
2. Confirm the VM database has no writes beyond the last source checkpoint, or
   create and validate a rollback dump if it does.
3. Move the private route to the preserved Windows endpoint.
4. Start only the exact recorded Windows source containers if needed.
5. Verify native login and authenticated pages.
6. Keep the VM, volumes, release, journals, and backups preserved for review.

Do not delete, prune, recreate, or reuse either side during rollback.
