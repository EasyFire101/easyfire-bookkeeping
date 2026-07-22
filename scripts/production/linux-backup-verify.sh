#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/easyfire-bookkeeping}"
ENV_FILE="${ENV_FILE:-/etc/easyfire-bookkeeping/production.env}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-easyfire-bookkeeping-mysql}"
REDIS_CONTAINER="${REDIS_CONTAINER:-easyfire-bookkeeping-redis}"
SYSTEM_DATABASE="${SYSTEM_DATABASE:-easyfire_system}"
TENANT_DATABASE_PREFIX="${TENANT_DATABASE_PREFIX:-easyfire_tenant_}"
EXPECTED_SYSTEM_TABLES="${EXPECTED_SYSTEM_TABLES:-17}"
EXPECTED_TENANT_TABLES="${EXPECTED_TENANT_TABLES:-70}"
EXPECTED_IDENTITY_COUNTS="${EXPECTED_IDENTITY_COUNTS:-$'1\t1\t1\t1'}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

[[ "${EUID}" -eq 0 ]] || fail 'Run this backup as root.'
[[ "${BACKUP_ROOT}" == /* ]] || fail 'BACKUP_ROOT must be an absolute path.'
[[ -f "${ENV_FILE}" ]] || fail "Environment file is missing: ${ENV_FILE}"
[[ "$(stat -c '%a' "${ENV_FILE}")" == '600' ]] || fail 'Environment file must have mode 0600.'

for command_name in docker gzip sha256sum sort stat /usr/local/bin/node; do
  require_command "${command_name}"
done

for container_name in "${MYSQL_CONTAINER}" "${REDIS_CONTAINER}"; do
  [[ "$(docker inspect --format '{{.State.Running}}' "${container_name}")" == 'true' ]] ||
    fail "Required container is not running: ${container_name}"
done

STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "${STAMP}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'BACKUP_STAMP has an invalid format.'
UNIT="${BACKUP_ROOT}/${STAMP}"
[[ ! -e "${UNIT}" ]] || fail "Backup unit already exists: ${UNIT}"
install -d -m 0700 "${UNIT}" "${UNIT}/database" "${UNIT}/redis" "${UNIT}/proof"

SOURCE_RELEASE="$(readlink -f /opt/easyfire-bookkeeping/current)"
[[ "${SOURCE_RELEASE}" == /opt/easyfire-bookkeeping/releases/* ]] ||
  fail 'Current source release is outside the immutable release root.'
SOURCE_COMMIT="$(basename "${SOURCE_RELEASE}")"

MYSQL_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' "${MYSQL_CONTAINER}")"
MYSQL_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${MYSQL_IMAGE_REF}")"
REDIS_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' "${REDIS_CONTAINER}")"
REDIS_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${REDIS_IMAGE_REF}")"

database_output="$({
  docker exec "${MYSQL_CONTAINER}" sh -ceu \
    'mariadb -u root -p"$MYSQL_ROOT_PASSWORD" -N -e "SHOW DATABASES;"'
})" || fail 'Unable to enumerate application databases.'

mapfile -t application_databases < <(
  printf '%s\n' "${database_output}" |
    awk -v system="${SYSTEM_DATABASE}" -v prefix="${TENANT_DATABASE_PREFIX}" \
      '$0 == system || index($0, prefix) == 1' |
    sort -u
)

[[ "${#application_databases[@]}" -eq 2 ]] ||
  fail "Ambiguous application database count: ${#application_databases[@]}"
[[ "${application_databases[0]}" == "${SYSTEM_DATABASE}" ]] ||
  fail 'The system database was not the expected database.'
[[ "${application_databases[1]}" == "${TENANT_DATABASE_PREFIX}"* ]] ||
  fail 'The tenant database did not match the configured prefix.'
for database_name in "${application_databases[@]}"; do
  [[ "${database_name}" =~ ^[A-Za-z0-9_]+$ ]] || fail 'Unsafe database name returned by MariaDB.'
done

CONTAINER_BASE="/tmp/easyfire-bookkeeping-backup-${STAMP}"
DATABASE_ARGUMENTS="${application_databases[*]}"
docker exec "${MYSQL_CONTAINER}" sh -ceu \
  "mariadb-dump --single-transaction --routines --triggers --events --hex-blob --add-drop-database --databases ${DATABASE_ARGUMENTS} -u root -p\"\$MYSQL_ROOT_PASSWORD\" > '${CONTAINER_BASE}.sql' && gzip -c '${CONTAINER_BASE}.sql' > '${CONTAINER_BASE}.sql.gz'"

DATABASE_BACKUP="${UNIT}/database/easyfire-app-${STAMP}.sql.gz"
docker cp "${MYSQL_CONTAINER}:${CONTAINER_BASE}.sql.gz" "${DATABASE_BACKUP}" >/dev/null
[[ -s "${DATABASE_BACKUP}" ]] || fail 'MariaDB backup is empty.'

[[ "$(docker exec "${REDIS_CONTAINER}" redis-cli SAVE | tr -d '\r')" == 'OK' ]] ||
  fail 'Redis SAVE failed.'
REDIS_BACKUP="${UNIT}/redis/easyfire-redis-${STAMP}.rdb"
docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${REDIS_BACKUP}" >/dev/null
[[ -s "${REDIS_BACKUP}" ]] || fail 'Redis snapshot is empty.'

RESTORE_SUFFIX="$(printf '%s' "${STAMP}" | tr '[:upper:]' '[:lower:]')"
RESTORE_VOLUME="easyfire_bookkeeping_backup_restore_${RESTORE_SUFFIX}"
RESTORE_CONTAINER="easyfire-bookkeeping-backup-restore-${RESTORE_SUFFIX}"
if docker volume inspect "${RESTORE_VOLUME}" >/dev/null 2>&1; then
  fail "Restore proof volume already exists: ${RESTORE_VOLUME}"
fi
if docker container inspect "${RESTORE_CONTAINER}" >/dev/null 2>&1; then
  fail "Restore proof container already exists: ${RESTORE_CONTAINER}"
fi

mapfile -t mysql_runtime_environment < <(
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${MYSQL_CONTAINER}"
)
for required_key in MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD MYSQL_ROOT_PASSWORD; do
  matching_entry=''
  matching_count=0
  for environment_entry in "${mysql_runtime_environment[@]}"; do
    if [[ "${environment_entry}" == "${required_key}="* ]]; then
      matching_entry="${environment_entry}"
      matching_count=$((matching_count + 1))
    fi
  done
  [[ "${matching_count}" -eq 1 ]] ||
    fail "Active MariaDB has an ambiguous ${required_key} environment contract."
  [[ -n "${matching_entry#*=}" ]] || fail "Active MariaDB has an empty ${required_key}."
  export "${matching_entry}"
done

docker volume create "${RESTORE_VOLUME}" >/dev/null
docker create \
  --name "${RESTORE_CONTAINER}" \
  --network none \
  --env MYSQL_DATABASE \
  --env MYSQL_USER \
  --env MYSQL_PASSWORD \
  --env MYSQL_ROOT_PASSWORD \
  --volume "${RESTORE_VOLUME}:/var/lib/mysql" \
  "${MYSQL_IMAGE_REF}" >/dev/null

restore_started=0
stop_failed_restore() {
  local exit_code=$?
  if [[ "${exit_code}" -ne 0 && "${restore_started}" -eq 1 ]]; then
    docker stop --time 30 "${RESTORE_CONTAINER}" >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}
trap stop_failed_restore EXIT

docker start "${RESTORE_CONTAINER}" >/dev/null
restore_started=1
restore_ready=0
for _ in $(seq 1 90); do
  if docker exec "${RESTORE_CONTAINER}" sh -ceu \
    'mariadb-admin ping -h localhost -u root -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1; then
    restore_ready=1
    break
  fi
  sleep 2
done
[[ "${restore_ready}" -eq 1 ]] || fail 'Isolated MariaDB restore container did not become ready.'

docker cp "${DATABASE_BACKUP}" "${RESTORE_CONTAINER}:/tmp/restore.sql.gz" >/dev/null
docker exec "${RESTORE_CONTAINER}" sh -ceu \
  'gzip -dc /tmp/restore.sql.gz | mariadb -u root -p"$MYSQL_ROOT_PASSWORD"'
docker exec "${RESTORE_CONTAINER}" sh -ceu \
  'mariadb-check -u root -p"$MYSQL_ROOT_PASSWORD" --all-databases --check' \
  >"${UNIT}/proof/mariadb-check.txt"

system_table_count="$(
  docker exec "${RESTORE_CONTAINER}" sh -ceu \
    "mariadb -u root -p\"\$MYSQL_ROOT_PASSWORD\" -D '${SYSTEM_DATABASE}' -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();'"
)"
tenant_table_count="$(
  docker exec "${RESTORE_CONTAINER}" sh -ceu \
    "mariadb -u root -p\"\$MYSQL_ROOT_PASSWORD\" -D '${application_databases[1]}' -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();'"
)"
identity_counts="$(
  docker exec "${RESTORE_CONTAINER}" sh -ceu \
    "mariadb -u root -p\"\$MYSQL_ROOT_PASSWORD\" -D '${SYSTEM_DATABASE}' -N -e 'SELECT (SELECT COUNT(*) FROM USERS),(SELECT COUNT(*) FROM TENANTS),(SELECT COUNT(*) FROM TENANTS_METADATA),(SELECT COUNT(*) FROM USER_TENANTS);'"
)"

[[ "${system_table_count}" == "${EXPECTED_SYSTEM_TABLES}" ]] ||
  fail "Unexpected restored system table count: ${system_table_count}"
[[ "${tenant_table_count}" == "${EXPECTED_TENANT_TABLES}" ]] ||
  fail "Unexpected restored tenant table count: ${tenant_table_count}"
[[ "${identity_counts}" == "${EXPECTED_IDENTITY_COUNTS}" ]] ||
  fail 'Restored identity invariants did not match the expected counts.'

printf '%s\t%s\n' "${SYSTEM_DATABASE}" "${system_table_count}" \
  >"${UNIT}/proof/schema-table-counts.tsv"
printf '%s\t%s\n' "${application_databases[1]}" "${tenant_table_count}" \
  >>"${UNIT}/proof/schema-table-counts.tsv"
printf 'users\ttenants\ttenant_metadata\tuser_tenants\n%s\n' "${identity_counts}" \
  >"${UNIT}/proof/identity-invariants.tsv"

docker stop --time 30 "${RESTORE_CONTAINER}" >/dev/null
restore_started=0
[[ "$(docker inspect --format '{{.State.Status}}' "${RESTORE_CONTAINER}")" == 'exited' ]] ||
  fail 'Restore proof container was not preserved in the stopped state.'

DATABASE_SHA256="$(sha256sum "${DATABASE_BACKUP}" | awk '{print $1}')"
REDIS_SHA256="$(sha256sum "${REDIS_BACKUP}" | awk '{print $1}')"
export STAMP SOURCE_COMMIT MYSQL_CONTAINER MYSQL_IMAGE_REF MYSQL_IMAGE_ID
export REDIS_CONTAINER REDIS_IMAGE_REF REDIS_IMAGE_ID
export DATABASE_SHA256 REDIS_SHA256 RESTORE_CONTAINER RESTORE_VOLUME
export SYSTEM_DATABASE TENANT_DATABASE="${application_databases[1]}"
export SYSTEM_TABLE_COUNT="${system_table_count}" TENANT_TABLE_COUNT="${tenant_table_count}"

/usr/local/bin/node - "${UNIT}/backup-receipt.json" <<'NODE'
const fs = require('node:fs');

const receiptPath = process.argv[2];
const receipt = {
  schemaVersion: 1,
  status: 'passed',
  createdAt: new Date().toISOString(),
  backupStamp: process.env.STAMP,
  sourceCommit: process.env.SOURCE_COMMIT,
  sourceContainers: {
    mysql: process.env.MYSQL_CONTAINER,
    redis: process.env.REDIS_CONTAINER,
  },
  sourceImages: {
    mysql: { reference: process.env.MYSQL_IMAGE_REF, id: process.env.MYSQL_IMAGE_ID },
    redis: { reference: process.env.REDIS_IMAGE_REF, id: process.env.REDIS_IMAGE_ID },
  },
  databases: [process.env.SYSTEM_DATABASE, process.env.TENANT_DATABASE],
  databaseSha256: process.env.DATABASE_SHA256,
  redisSha256: process.env.REDIS_SHA256,
  schemaTableCounts: {
    system: Number(process.env.SYSTEM_TABLE_COUNT),
    tenant: Number(process.env.TENANT_TABLE_COUNT),
  },
  identityInvariants: 'users=1;tenants=1;tenant_metadata=1;user_tenants=1',
  restoreContainer: process.env.RESTORE_CONTAINER,
  restoreVolume: process.env.RESTORE_VOLUME,
  restoreNetwork: 'none',
  restoreState: 'stopped-preserved',
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
NODE

cat >"${UNIT}/RESTORE.md" <<EOF
# EasyFire Bookkeeping backup ${STAMP}

Status: verified by an isolated restore.

- Source release: ${SOURCE_COMMIT}
- Database archive: database/$(basename "${DATABASE_BACKUP}")
- Redis snapshot: redis/$(basename "${REDIS_BACKUP}")
- Preserved proof container: ${RESTORE_CONTAINER}
- Preserved proof volume: ${RESTORE_VOLUME}
- Proof network: none

Never restore this archive into an active volume. Create another uniquely named
volume and network-isolated proof container, verify SHA256SUMS, restore the SQL,
run mariadb-check, and revalidate the recorded schema and identity counts. Redis
is cache state and is never the accounting authority. Never allow the Windows
and VM databases to receive user writes simultaneously.
EOF

(
  cd "${UNIT}"
  sha256sum \
    "database/$(basename "${DATABASE_BACKUP}")" \
    "redis/$(basename "${REDIS_BACKUP}")" \
    proof/mariadb-check.txt \
    proof/schema-table-counts.tsv \
    proof/identity-invariants.tsv \
    backup-receipt.json \
    RESTORE.md \
    >SHA256SUMS
  sha256sum --check SHA256SUMS >verification.txt
)

printf 'BACKUP_STATUS=passed\nBACKUP_UNIT=%s\nRESTORE_CONTAINER=%s\nRESTORE_VOLUME=%s\n' \
  "${UNIT}" "${RESTORE_CONTAINER}" "${RESTORE_VOLUME}"
