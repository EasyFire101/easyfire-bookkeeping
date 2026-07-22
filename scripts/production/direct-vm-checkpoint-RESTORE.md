# EasyFire Bookkeeping direct-to-VM recovery checkpoint

This recovery unit preserves the pre-migration application data, runtime
identities, images, overlays, task definitions, and rollback inputs.

## Fail-closed restore order

1. Do not restore into `easyfire_prod_mysql` or `easyfire_prod_redis`.
2. Create a fresh, uniquely named MariaDB volume and container on an isolated
   network.
3. Use the exact MariaDB image recorded in
   `runtime/container-identities.json`.
4. Import the `database/easyfire-app-*.sql.gz` dump into the fresh volume.
5. Run `mariadb-check --all-databases --check`.
6. Require exactly 17 tables in `easyfire_system` and 70 tables in the sole
   `easyfire_tenant_*` schema.
7. Require `USERS=1`, `TENANTS=1`, `TENANTS_METADATA=1`, and
   `USER_TENANTS=1`.
8. Keep the restore container network-isolated and stop it after proof. Do not
   delete the container or volume.
9. Redis is non-authoritative. Restore `database/easyfire-redis-*.rdb` only
   when session or queue continuity is explicitly required.
10. Before any route cutover, prove native owner login, authenticated pages,
    single-writer state, rollback, VM reboot, and Guardian recovery.

## Existing isolated proof

`restore-proof/isolated-restore-proof.json` identifies the passed preserved
restore container and volume, and records the schema and identity invariants.

## Rollback boundary

The authoritative rollback is the preserved Windows runtime. Move the private
route back to the Windows endpoint and start only the exact preserved source
containers if rollback is required. Never allow the Windows and VM databases
to accept writes simultaneously.
