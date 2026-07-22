#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="/var/backups/easyfire-bookkeeping"
ENV_FILE="${ENV_FILE:-/etc/easyfire-bookkeeping/production.env}"
RUNTIME_MANIFEST="${RUNTIME_MANIFEST:-/etc/easyfire-bookkeeping/runtime-manifest.json}"
RUNTIME_IDENTITY_EVIDENCE="${RUNTIME_IDENTITY_EVIDENCE:-/etc/easyfire-bookkeeping/runtime-identity-evidence.json}"
MIGRATION_RECEIPT="${MIGRATION_RECEIPT:-/etc/easyfire-bookkeeping/migration-receipt.json}"
DEPLOYMENT_RECEIPT="${DEPLOYMENT_RECEIPT:-/etc/easyfire-bookkeeping/deployment-receipt.json}"
DEPLOYMENT_PLAN="/etc/easyfire-bookkeeping/deployment-plan.json"
CHECKPOINT_MANIFEST="${CHECKPOINT_MANIFEST:-/etc/easyfire-bookkeeping/checkpoint-manifest.json}"
LOCK_FILE="/run/lock/easyfire-bookkeeping/backup.lock"
CURRENT_RELEASE="/opt/easyfire-bookkeeping/current"
MYSQL_CONTAINER="easyfire-bookkeeping-mysql"
REDIS_CONTAINER="easyfire-bookkeeping-redis"
MIGRATION_CONTAINER="easyfire-bookkeeping-migration"
COMPOSE_PROJECT="easyfire-bookkeeping-prod"
SYSTEM_DATABASE="easyfire_system"
TENANT_DATABASE_PREFIX="easyfire_tenant_"
EXPECTED_SYSTEM_TABLES="17"
EXPECTED_TENANT_TABLES="70"
EXPECTED_IDENTITY_COUNTS=$'1\t1\t1\t1'
PROTECTED_ACCOUNTING_TABLES=(
  ACCOUNTS_TRANSACTIONS
  BILLS
  BILLS_PAYMENTS
  BILLS_PAYMENTS_ENTRIES
  BILL_LOCATED_COSTS
  BILL_LOCATED_COST_ENTRIES
  CASHFLOW_TRANSACTIONS
  CASHFLOW_TRANSACTION_LINES
  CREDIT_NOTES
  CREDIT_NOTE_APPLIED_INVOICE
  EXPENSES_TRANSACTIONS
  EXPENSE_TRANSACTION_CATEGORIES
  INVENTORY_ADJUSTMENTS
  INVENTORY_ADJUSTMENTS_ENTRIES
  INVENTORY_COST_LOT_TRACKER
  INVENTORY_TRANSACTIONS
  INVENTORY_TRANSACTION_META
  ITEMS_ENTRIES
  ITEMS_WAREHOUSES_QUANTITY
  MANUAL_JOURNALS
  MANUAL_JOURNALS_ENTRIES
  MATCHED_BANK_TRANSACTIONS
  PAYMENT_RECEIVES
  PAYMENT_RECEIVES_ENTRIES
  RECOGNIZED_BANK_TRANSACTIONS
  REFUND_CREDIT_NOTE_TRANSACTIONS
  REFUND_VENDOR_CREDIT_TRANSACTIONS
  SALES_ESTIMATES
  SALES_INVOICES
  SALES_RECEIPTS
  TAX_RATE_TRANSACTIONS
  TIMES
  UNCATEGORIZED_CASHFLOW_TRANSACTIONS
  VENDOR_CREDITS
  VENDOR_CREDIT_APPLIED_BILL
  WAREHOUSES_TRANSFERS
  WAREHOUSES_TRANSFERS_ENTRIES
)
readonly -a PROTECTED_ACCOUNTING_TABLES

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

require_root_file_0600() {
  local file_path="$1"
  local label="$2"
  [[ -f "${file_path}" && ! -L "${file_path}" ]] ||
    fail "${label} must be a regular non-symlink file: ${file_path}"
  [[ "$(stat -c '%u|%a' "${file_path}")" == '0|600' ]] ||
    fail "${label} must be owned by root with mode 0600: ${file_path}"
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

[[ "${EUID}" -eq 0 ]] || fail 'Run this backup as root.'
for absolute_path in \
  "${BACKUP_ROOT}" \
  "${ENV_FILE}" \
  "${RUNTIME_MANIFEST}" \
  "${RUNTIME_IDENTITY_EVIDENCE}" \
  "${MIGRATION_RECEIPT}" \
  "${DEPLOYMENT_RECEIPT}" \
  "${DEPLOYMENT_PLAN}" \
  "${CHECKPOINT_MANIFEST}" \
  "${LOCK_FILE}" \
  "${CURRENT_RELEASE}"; do
  [[ "${absolute_path}" == /* ]] || fail "A configured path is not absolute: ${absolute_path}"
done

for command_name in \
  awk basename cat chmod date dirname docker flock gzip install mkdir mktemp \
  mv openssl readlink rm rmdir seq sha256sum sleep sort stat sync tr /usr/local/bin/node; do
  require_command "${command_name}"
done

require_root_file_0600 "${ENV_FILE}" 'Production environment'
require_root_file_0600 "${RUNTIME_MANIFEST}" 'Runtime manifest'
require_root_file_0600 "${RUNTIME_IDENTITY_EVIDENCE}" 'Runtime identity evidence'
require_root_file_0600 "${MIGRATION_RECEIPT}" 'Migration receipt'
require_root_file_0600 "${DEPLOYMENT_RECEIPT}" 'Deployment receipt'
require_root_file_0600 "${DEPLOYMENT_PLAN}" 'Deployment plan'
require_root_file_0600 "${CHECKPOINT_MANIFEST}" 'Checkpoint manifest'

LOCK_DIRECTORY="$(dirname "${LOCK_FILE}")"
if [[ -e "${LOCK_DIRECTORY}" ]]; then
  [[ -d "${LOCK_DIRECTORY}" && ! -L "${LOCK_DIRECTORY}" ]] ||
    fail "Backup lock directory is unsafe: ${LOCK_DIRECTORY}"
else
  mkdir -m 0700 "${LOCK_DIRECTORY}"
fi
if [[ -e "${LOCK_FILE}" ]]; then
  [[ -f "${LOCK_FILE}" && ! -L "${LOCK_FILE}" ]] ||
    fail "Backup lock is not a regular non-symlink file: ${LOCK_FILE}"
fi
exec 9>"${LOCK_FILE}"
chmod 0600 "${LOCK_FILE}"
flock -n 9 || fail 'Another Bookkeeping backup already holds the runtime lock.'

[[ -L "${CURRENT_RELEASE}" ]] || fail 'Current release path must be a symbolic link.'
SOURCE_RELEASE="$(readlink -f "${CURRENT_RELEASE}")"
[[ "${SOURCE_RELEASE}" =~ ^/opt/easyfire-bookkeeping/releases/[a-f0-9]{40}$ ]] ||
  fail 'Current source release is not an exact releases/<40-character-commit> path.'
SOURCE_COMMIT="$(basename "${SOURCE_RELEASE}")"
RELEASE_MANIFEST="${SOURCE_RELEASE}/release-manifest.json"
[[ -f "${RELEASE_MANIFEST}" && ! -L "${RELEASE_MANIFEST}" ]] ||
  fail 'Release manifest must be a regular file owned by the resolved release.'
[[ "$(readlink -f "${RELEASE_MANIFEST}")" == "${RELEASE_MANIFEST}" ]] ||
  fail 'Release manifest resolution escaped the resolved release.'

DEPLOYMENT_CONTROLLER="${SOURCE_RELEASE}/scripts/production/linux-deploy-candidate.mjs"
[[ -f "${DEPLOYMENT_CONTROLLER}" && ! -L "${DEPLOYMENT_CONTROLLER}" ]] ||
  fail 'Release-owned deployment controller must be a regular non-symlink file.'
[[ "$(readlink -f "${DEPLOYMENT_CONTROLLER}")" == "${DEPLOYMENT_CONTROLLER}" ]] ||
  fail 'Deployment controller resolution escaped the resolved release.'
run_deployment_controller_verification() {
  /usr/local/bin/node "${DEPLOYMENT_CONTROLLER}" --verify-existing --plan "${DEPLOYMENT_PLAN}"
}
DEPLOYMENT_CONTROLLER_VERIFY_OUTPUT="$(run_deployment_controller_verification)" ||
  fail 'Release-owned deployment completion verification failed.'
DEPLOYMENT_CONTROLLER_VERIFY_OUTPUT="${DEPLOYMENT_CONTROLLER_VERIFY_OUTPUT}" \
SOURCE_COMMIT="${SOURCE_COMMIT}" /usr/local/bin/node -e '
const value = JSON.parse(process.env.DEPLOYMENT_CONTROLLER_VERIFY_OUTPUT ?? "");
const keys = Object.keys(value).sort();
const expected = ["deploymentId", "mode", "ok", "releaseCommit"];
if (
  keys.length !== expected.length ||
  keys.some((key, index) => key !== expected[index]) ||
  value.ok !== true ||
  value.mode !== "verify-existing" ||
  typeof value.deploymentId !== "string" ||
  !/^[A-Za-z0-9._:-]+$/.test(value.deploymentId) ||
  value.releaseCommit !== process.env.SOURCE_COMMIT
) process.exit(1);
' || fail 'Deployment completion verification output was invalid.'

STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "${STAMP}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'BACKUP_STAMP has an invalid format.'
if [[ -e "${BACKUP_ROOT}" ]]; then
  [[ -d "${BACKUP_ROOT}" && ! -L "${BACKUP_ROOT}" ]] ||
    fail "Backup root is unsafe: ${BACKUP_ROOT}"
else
  mkdir -m 0700 "${BACKUP_ROOT}"
fi
UNIT="${BACKUP_ROOT}/${STAMP}"
mkdir -m 0700 "${UNIT}" || fail "Backup unit already exists or cannot be created: ${UNIT}"
install -d -m 0700 \
  "${UNIT}/authority" \
  "${UNIT}/database" \
  "${UNIT}/proof" \
  "${UNIT}/redis"
printf '%s\n' "${DEPLOYMENT_CONTROLLER_VERIFY_OUTPUT}" \
  >"${UNIT}/proof/deployment-controller-verification.json"

RELEASE_MANIFEST_SHA256="$(sha256_file "${RELEASE_MANIFEST}")"
CHECKPOINT_MANIFEST_SHA256="$(sha256_file "${CHECKPOINT_MANIFEST}")"
ENVIRONMENT_SHA256="$(sha256_file "${ENV_FILE}")"
DEPLOYMENT_PLAN_SHA256="$(sha256_file "${DEPLOYMENT_PLAN}")"
MIGRATION_RECEIPT_SHA256="$(sha256_file "${MIGRATION_RECEIPT}")"
RUNTIME_MANIFEST_SHA256="$(sha256_file "${RUNTIME_MANIFEST}")"
RUNTIME_IDENTITY_EVIDENCE_SHA256="$(sha256_file "${RUNTIME_IDENTITY_EVIDENCE}")"
DEPLOYMENT_RECEIPT_SHA256="$(sha256_file "${DEPLOYMENT_RECEIPT}")"

run_authority_validator() {
  /usr/local/bin/node - \
    "${RELEASE_MANIFEST}" \
    "${RUNTIME_MANIFEST}" \
    "${RUNTIME_IDENTITY_EVIDENCE}" \
    "${MIGRATION_RECEIPT}" \
    "${DEPLOYMENT_RECEIPT}" \
    "${SOURCE_RELEASE}" \
    "${SOURCE_COMMIT}" \
    "${RELEASE_MANIFEST_SHA256}" \
    "${CHECKPOINT_MANIFEST_SHA256}" \
    "${ENVIRONMENT_SHA256}" \
    "${DEPLOYMENT_PLAN_SHA256}" \
    "${MIGRATION_RECEIPT_SHA256}" \
    "${RUNTIME_MANIFEST_SHA256}" \
    "${RUNTIME_IDENTITY_EVIDENCE_SHA256}" \
    "${EXPECTED_SYSTEM_TABLES}" \
    "${EXPECTED_TENANT_TABLES}" \
    "${EXPECTED_IDENTITY_COUNTS}" <<'NODE'
const fs = require('node:fs');

const [
  releaseManifestPath,
  runtimeManifestPath,
  runtimeEvidencePath,
  migrationReceiptPath,
  deploymentReceiptPath,
  sourceReleasePath,
  sourceCommit,
  releaseManifestSha256,
  checkpointManifestSha256,
  environmentSha256,
  deploymentPlanSha256,
  migrationReceiptSha256,
  runtimeManifestSha256,
  runtimeIdentityEvidenceSha256,
  expectedSystemTablesText,
  expectedTenantTablesText,
  expectedIdentityCountsText,
] = process.argv.slice(2);

const sha256 = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const containerId = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const safeText = /^[A-Za-z0-9._:-]+$/;
const maxJsonBytes = 1_000_000;

function refuse(message) {
  throw new Error(message);
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    refuse(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    refuse(`${label} has an unexpected field set.`);
  }
}

function readJson(filePath, label) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > maxJsonBytes) {
    refuse(`${label} must be a non-empty regular file no larger than 1 MB.`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  catch {
    refuse(`${label} is not valid JSON.`);
  }
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !sha256.test(value)) refuse(`${label} is not a SHA-256.`);
}

function requireImage(value, label) {
  if (typeof value !== 'string' || !imageId.test(value)) refuse(`${label} is not an image ID.`);
}

function requireContainer(value, label) {
  if (typeof value !== 'string' || !containerId.test(value)) refuse(`${label} is not a full container ID.`);
}

function requireTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    refuse(`${label} is not a timestamp.`);
  }
}

for (const [value, label] of [
  [releaseManifestSha256, 'Observed release manifest hash'],
  [checkpointManifestSha256, 'Observed checkpoint manifest hash'],
  [environmentSha256, 'Observed environment hash'],
  [deploymentPlanSha256, 'Observed deployment plan hash'],
  [migrationReceiptSha256, 'Observed migration receipt hash'],
  [runtimeManifestSha256, 'Observed runtime manifest hash'],
  [runtimeIdentityEvidenceSha256, 'Observed runtime identity evidence hash'],
]) requireSha(value, label);
if (!commit.test(sourceCommit)) refuse('Resolved source commit is invalid.');
if (sourceReleasePath !== `/opt/easyfire-bookkeeping/releases/${sourceCommit}`) {
  refuse('Resolved source release path is not commit-bound.');
}

const roleSpecs = [
  ['envoy', 'easyfire-bookkeeping-envoy', 'envoy', 'start-if-stopped'],
  ['webapp', 'easyfire-bookkeeping-webapp', 'webapp', 'start-if-stopped'],
  ['server', 'easyfire-bookkeeping-server', 'server', 'start-if-stopped'],
  ['gotenberg', 'easyfire-bookkeeping-gotenberg', 'gotenberg', 'start-if-stopped'],
  ['mysql', 'easyfire-bookkeeping-mysql', 'mysql', 'observe-only'],
  ['redis', 'easyfire-bookkeeping-redis', 'redis', 'observe-only'],
];
const releaseRoles = [...roleSpecs.map(([role]) => role), 'migration'];
const release = object(readJson(releaseManifestPath, 'Release manifest'), 'Release manifest');
if (release.manifestVersion !== 2 || release.releaseCommit !== sourceCommit) {
  refuse('Release manifest is not bound to the resolved commit.');
}
if (!Array.isArray(release.images) || release.images.length !== releaseRoles.length) {
  refuse('Release manifest must contain exactly seven images.');
}
const releaseImages = new Map();
for (const entry of release.images) {
  object(entry, 'Release image');
  if (!releaseRoles.includes(entry.role) || releaseImages.has(entry.role)) {
    refuse('Release manifest has an unexpected or duplicate image role.');
  }
  if (
    typeof entry.reference !== 'string' ||
    entry.reference.length < 3 ||
    entry.reference.length > 512 ||
    /[\s\0]/.test(entry.reference)
  ) refuse(`Release image reference for ${entry.role} is invalid.`);
  if ('imageId' in entry) refuse(`Release ${entry.role} uses forbidden legacy imageId authority.`);
  requireImage(entry.ociIndexDigest, `Release ${entry.role} ociIndexDigest`);
  requireImage(entry.linuxAmd64ManifestDigest, `Release ${entry.role} linuxAmd64ManifestDigest`);
  requireImage(entry.engineImageId, `Release ${entry.role} engineImageId`);
  if (['envoy', 'gotenberg'].includes(entry.role)) {
    const separator = entry.reference.lastIndexOf('@');
    const taggedReference = entry.reference.slice(0, separator);
    const digest = entry.reference.slice(separator + 1);
    const lastSlash = taggedReference.lastIndexOf('/');
    const tagSeparator = taggedReference.lastIndexOf(':');
    if (
      separator <= 0 ||
      tagSeparator <= lastSlash ||
      `sha256:${digest.replace(/^sha256:/, '')}` !== entry.ociIndexDigest
    ) refuse(`Release ${entry.role} reference is not bound to its OCI index digest.`);
  }
  else {
    const repositoryRole = entry.role === 'mysql' ? 'mariadb' : entry.role;
    if (entry.reference !== `easyfire-bookkeeping/${repositoryRole}:git-${sourceCommit}`) {
      refuse(`Release ${entry.role} reference is not the final commit tag.`);
    }
  }
  releaseImages.set(entry.role, entry);
}
for (const role of releaseRoles) {
  if (!releaseImages.has(role)) refuse(`Release manifest is missing role ${role}.`);
}

const runtime = object(readJson(runtimeManifestPath, 'Runtime manifest'), 'Runtime manifest');
exactKeys(runtime, ['schemaVersion', 'project', 'generatedAt', 'services'], 'Runtime manifest');
if (runtime.schemaVersion !== 1 || runtime.project !== 'easyfire-bookkeeping') {
  refuse('Runtime manifest identity is invalid.');
}
requireTimestamp(runtime.generatedAt, 'Runtime manifest generatedAt');
if (!Array.isArray(runtime.services) || runtime.services.length !== roleSpecs.length) {
  refuse('Runtime manifest must contain exactly six services.');
}

const evidence = object(readJson(runtimeEvidencePath, 'Runtime identity evidence'), 'Runtime identity evidence');
exactKeys(
  evidence,
  ['schemaVersion', 'project', 'generatedAt', 'releaseCommit', 'sourceReleasePath', 'services'],
  'Runtime identity evidence',
);
if (
  evidence.schemaVersion !== 1 ||
  evidence.project !== 'easyfire-bookkeeping' ||
  evidence.generatedAt !== runtime.generatedAt ||
  evidence.releaseCommit !== sourceCommit ||
  evidence.sourceReleasePath !== sourceReleasePath
) refuse('Runtime identity evidence is not bound to the runtime and source release.');
if (!Array.isArray(evidence.services) || evidence.services.length !== roleSpecs.length) {
  refuse('Runtime identity evidence must contain exactly six services.');
}

const runtimeByRole = new Map(runtime.services.map((entry) => [entry?.role, entry]));
const evidenceByRole = new Map(evidence.services.map((entry) => [entry?.role, entry]));
if (runtimeByRole.size !== roleSpecs.length || evidenceByRole.size !== roleSpecs.length) {
  refuse('Runtime documents contain duplicate service roles.');
}
const output = [];
for (const [role, expectedName, composeService, recoveryMode] of roleSpecs) {
  const service = object(runtimeByRole.get(role), `Runtime ${role}`);
  exactKeys(
    service,
    ['role', 'containerName', 'containerId', 'imageId', 'requireDockerHealth', 'recoveryMode'],
    `Runtime ${role}`,
  );
  const recorded = object(evidenceByRole.get(role), `Runtime evidence ${role}`);
  exactKeys(
    recorded,
    [
      'role',
      'containerName',
      'containerId',
      'configuredImageReference',
      'actualImageId',
      'authorityKind',
      'ociIndexDigest',
      'linuxAmd64ManifestDigest',
      'engineImageId',
      'verifiedRepoDigest',
    ],
    `Runtime evidence ${role}`,
  );
  if (
    service.role !== role ||
    service.containerName !== expectedName ||
    service.requireDockerHealth !== true ||
    service.recoveryMode !== recoveryMode
  ) refuse(`Runtime ${role} contract is invalid.`);
  requireContainer(service.containerId, `Runtime ${role} containerId`);
  requireImage(service.imageId, `Runtime ${role} imageId`);
  if (
    recorded.role !== role ||
    recorded.containerName !== expectedName ||
    recorded.containerId !== service.containerId ||
    recorded.actualImageId !== service.imageId ||
    recorded.actualImageId !== releaseImages.get(role).engineImageId ||
    recorded.ociIndexDigest !== releaseImages.get(role).ociIndexDigest ||
    recorded.linuxAmd64ManifestDigest !== releaseImages.get(role).linuxAmd64ManifestDigest ||
    recorded.engineImageId !== releaseImages.get(role).engineImageId ||
    recorded.configuredImageReference !== releaseImages.get(role).reference
  ) refuse(`Runtime evidence for ${role} does not match runtime/release authority.`);
  const expectedAuthority = ['envoy', 'gotenberg'].includes(role)
    ? 'engine-image-id-and-repo-digest'
    : 'engine-image-id';
  if (recorded.authorityKind !== expectedAuthority) {
    refuse(`Runtime evidence authority kind for ${role} is invalid.`);
  }
  if (
    (expectedAuthority === 'engine-image-id-and-repo-digest' &&
      (typeof recorded.verifiedRepoDigest !== 'string' ||
        !/@sha256:[a-f0-9]{64}$/.test(recorded.verifiedRepoDigest))) ||
    (expectedAuthority === 'engine-image-id' && recorded.verifiedRepoDigest !== null)
  ) refuse(`Runtime evidence repo-digest authority for ${role} is invalid.`);
  if (expectedAuthority === 'engine-image-id-and-repo-digest') {
    const releaseReference = releaseImages.get(role).reference;
    const at = releaseReference.lastIndexOf('@');
    const taggedReference = releaseReference.slice(0, at);
    const tagSeparator = taggedReference.lastIndexOf(':');
    const lastSlash = taggedReference.lastIndexOf('/');
    const expectedRepoDigest = `${taggedReference.slice(0, tagSeparator)}${releaseReference.slice(at)}`;
    if (tagSeparator <= lastSlash || recorded.verifiedRepoDigest !== expectedRepoDigest) {
      refuse(`Runtime evidence repo digest for ${role} does not match the release reference.`);
    }
  }
  if (
    typeof recorded.configuredImageReference !== 'string' ||
    /[\s\0]/.test(recorded.configuredImageReference)
  ) refuse(`Runtime evidence image reference for ${role} is invalid.`);
  output.push([
    'SERVICE',
    role,
    expectedName,
    service.containerId,
    service.imageId,
    composeService,
    recorded.configuredImageReference,
  ].join('\t'));
}

const migrationReceipt = object(readJson(migrationReceiptPath, 'Migration receipt'), 'Migration receipt');
exactKeys(
  migrationReceipt,
  [
    'schemaVersion',
    'project',
    'deploymentId',
    'releaseCommit',
    'sourceReleasePath',
    'releaseManifestSha256',
    'checkpointManifestSha256',
    'environmentSha256',
    'migration',
    'validation',
    'status',
  ],
  'Migration receipt',
);
if (
  migrationReceipt.schemaVersion !== 1 ||
  migrationReceipt.project !== 'easyfire-bookkeeping' ||
  migrationReceipt.releaseCommit !== sourceCommit ||
  migrationReceipt.sourceReleasePath !== sourceReleasePath ||
  migrationReceipt.releaseManifestSha256 !== releaseManifestSha256 ||
  migrationReceipt.checkpointManifestSha256 !== checkpointManifestSha256 ||
  migrationReceipt.environmentSha256 !== environmentSha256 ||
  migrationReceipt.status !== 'passed' ||
  typeof migrationReceipt.deploymentId !== 'string' ||
  !safeText.test(migrationReceipt.deploymentId)
) refuse('Migration receipt is not bound to the exact deployment inputs.');
const migration = object(migrationReceipt.migration, 'Migration receipt migration');
exactKeys(
  migration,
  ['containerName', 'containerId', 'imageId', 'startedAt', 'completedAt', 'exitCode', 'state'],
  'Migration receipt migration',
);
if (
  migration.containerName !== 'easyfire-bookkeeping-migration' ||
  migration.imageId !== releaseImages.get('migration').engineImageId ||
  migration.exitCode !== 0 ||
  migration.state !== 'exited'
) refuse('Migration receipt container result is invalid.');
requireContainer(migration.containerId, 'Migration containerId');
requireImage(migration.imageId, 'Migration imageId');
requireTimestamp(migration.startedAt, 'Migration startedAt');
requireTimestamp(migration.completedAt, 'Migration completedAt');
if (Date.parse(migration.completedAt) < Date.parse(migration.startedAt)) {
  refuse('Migration completion precedes its start.');
}
const validation = object(migrationReceipt.validation, 'Migration receipt validation');
exactKeys(
  validation,
  ['systemTableCount', 'tenantTableCount', 'identityCounts', 'accountingGuard'],
  'Migration receipt validation',
);
const expectedIdentityCounts = expectedIdentityCountsText.split('\t').map(Number);
if (
  validation.systemTableCount !== Number(expectedSystemTablesText) ||
  validation.tenantTableCount !== Number(expectedTenantTablesText) ||
  !Array.isArray(validation.identityCounts) ||
  validation.identityCounts.length !== expectedIdentityCounts.length ||
  validation.identityCounts.some((count, index) => count !== expectedIdentityCounts[index]) ||
  validation.accountingGuard !== 'passed'
) refuse('Migration validation does not match the backup data contract.');

const deployment = object(readJson(deploymentReceiptPath, 'Deployment receipt'), 'Deployment receipt');
exactKeys(
  deployment,
  [
    'schemaVersion',
    'project',
    'deploymentId',
    'releaseCommit',
    'releaseManifestSha256',
    'checkpointManifestSha256',
    'environmentSha256',
    'deploymentPlanSha256',
    'migrationReceiptSha256',
    'runtimeManifestSha256',
    'runtimeIdentityEvidenceSha256',
    'completedAt',
    'status',
  ],
  'Deployment receipt',
);
if (
  deployment.schemaVersion !== 1 ||
  deployment.project !== 'easyfire-bookkeeping' ||
  deployment.deploymentId !== migrationReceipt.deploymentId ||
  deployment.releaseCommit !== sourceCommit ||
  deployment.releaseManifestSha256 !== releaseManifestSha256 ||
  deployment.checkpointManifestSha256 !== checkpointManifestSha256 ||
  deployment.environmentSha256 !== environmentSha256 ||
  deployment.deploymentPlanSha256 !== deploymentPlanSha256 ||
  deployment.migrationReceiptSha256 !== migrationReceiptSha256 ||
  deployment.runtimeManifestSha256 !== runtimeManifestSha256 ||
  deployment.runtimeIdentityEvidenceSha256 !== runtimeIdentityEvidenceSha256 ||
  deployment.status !== 'complete'
) refuse('Deployment receipt is not bound to the complete deployment evidence chain.');
requireTimestamp(deployment.completedAt, 'Deployment completedAt');
if (Date.parse(deployment.completedAt) < Date.parse(migration.completedAt)) {
  refuse('Deployment receipt predates migration completion.');
}

output.unshift(['META', migrationReceipt.deploymentId].join('\t'));
output.push([
  'MIGRATION',
  'migration',
  migration.containerName,
  migration.containerId,
  migration.imageId,
  'database_migration',
  releaseImages.get('migration').reference,
  migration.startedAt,
  migration.completedAt,
].join('\t'));
process.stdout.write(`${output.join('\n')}\n`);
NODE
}

AUTHORITY_OUTPUT="$(run_authority_validator)" || fail 'Deployment authority validation failed.'
printf '%s\n' "${AUTHORITY_OUTPUT}" >"${UNIT}/proof/authority-bindings.tsv"

declare -A EXPECTED_CONTAINER_IDS=()
declare -A EXPECTED_IMAGE_IDS=()
declare -A EXPECTED_COMPOSE_SERVICES=()
declare -A EXPECTED_IMAGE_REFS=()
declare -A EXPECTED_CONTAINER_NAMES=()
DEPLOYMENT_ID=''
MIGRATION_STARTED_AT=''
MIGRATION_COMPLETED_AT=''
authority_line_count=0
while IFS=$'\t' read -r kind role container_name expected_container_id expected_image_id compose_service image_ref started_at completed_at; do
  authority_line_count=$((authority_line_count + 1))
  case "${kind}" in
    META)
      [[ -z "${DEPLOYMENT_ID}" && -n "${role}" ]] || fail 'Authority metadata is ambiguous.'
      DEPLOYMENT_ID="${role}"
      ;;
    SERVICE|MIGRATION)
      [[ -z "${EXPECTED_CONTAINER_IDS[${role}]:-}" ]] || fail "Duplicate authority role: ${role}"
      EXPECTED_CONTAINER_IDS["${role}"]="${expected_container_id}"
      EXPECTED_IMAGE_IDS["${role}"]="${expected_image_id}"
      EXPECTED_COMPOSE_SERVICES["${role}"]="${compose_service}"
      EXPECTED_IMAGE_REFS["${role}"]="${image_ref}"
      EXPECTED_CONTAINER_NAMES["${role}"]="${container_name}"
      if [[ "${kind}" == 'MIGRATION' ]]; then
        MIGRATION_STARTED_AT="${started_at}"
        MIGRATION_COMPLETED_AT="${completed_at}"
      fi
      ;;
    *) fail "Unexpected authority binding kind: ${kind}" ;;
  esac
done <<<"${AUTHORITY_OUTPUT}"
[[ "${authority_line_count}" -eq 8 && "${#EXPECTED_CONTAINER_IDS[@]}" -eq 7 && -n "${DEPLOYMENT_ID}" ]] ||
  fail 'Authority binding output was incomplete.'

assert_container_identity() {
  local role="$1"
  local container_name="${EXPECTED_CONTAINER_NAMES[${role}]}"
  local actual_id actual_image actual_ref actual_project actual_service tagged_image_id
  actual_id="$(docker inspect --format '{{.Id}}' "${container_name}")"
  actual_image="$(docker inspect --format '{{.Image}}' "${container_name}")"
  actual_ref="$(docker inspect --format '{{.Config.Image}}' "${container_name}")"
  actual_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "${container_name}")"
  actual_service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "${container_name}")"
  [[ "${actual_id}" =~ ^[a-f0-9]{64}$ ]] || fail "${role} did not return a full container ID."
  [[ "${actual_image}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "${role} did not return an image ID."
  [[ "${actual_id}" == "${EXPECTED_CONTAINER_IDS[${role}]}" ]] || fail "${role} container ID drifted."
  [[ "${actual_image}" == "${EXPECTED_IMAGE_IDS[${role}]}" ]] || fail "${role} image ID drifted."
  [[ "${actual_ref}" == "${EXPECTED_IMAGE_REFS[${role}]}" ]] || fail "${role} image reference drifted."
  [[ "${actual_project}" == "${COMPOSE_PROJECT}" ]] || fail "${role} Compose project label is invalid."
  [[ "${actual_service}" == "${EXPECTED_COMPOSE_SERVICES[${role}]}" ]] ||
    fail "${role} Compose service label is invalid."
  tagged_image_id="$(docker image inspect --format '{{.Id}}' "${actual_ref}")"
  [[ "${tagged_image_id}" == "${actual_image}" ]] ||
    fail "${role} image tag drifted from the running image."
}

for runtime_role in envoy webapp server gotenberg mysql redis migration; do
  assert_container_identity "${runtime_role}"
done

for required_role in mysql redis; do
  required_container="${EXPECTED_CONTAINER_NAMES[${required_role}]}"
  [[ "$(docker inspect --format '{{.State.Running}}' "${required_container}")" == 'true' ]] ||
    fail "Required container is not running: ${required_container}"
  [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${required_container}")" == 'healthy' ]] ||
    fail "Required container is not healthy: ${required_container}"
done

MIGRATION_STATE="$(docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.FinishedAt}}' "${MIGRATION_CONTAINER}")"
[[ "${MIGRATION_STATE}" == "exited|0|${MIGRATION_STARTED_AT}|${MIGRATION_COMPLETED_AT}" ]] ||
  fail 'Migration container state does not match the migration receipt.'

inspect_named_volume() {
  local role="$1"
  local destination="$2"
  local logical_name="$3"
  local container_name="${EXPECTED_CONTAINER_NAMES[${role}]}"
  local mounts volume_name volume_project volume_logical volume_driver
  mounts="$(docker inspect --format '{{range .Mounts}}{{printf "%s|%s|%s|%t\n" .Destination .Type .Name .RW}}{{end}}' "${container_name}")"
  [[ "${mounts}" != *$'\n'* ]] || fail "${role} has an ambiguous mount set."
  IFS='|' read -r actual_destination mount_type volume_name mount_rw <<<"${mounts}"
  [[ "${actual_destination}" == "${destination}" && "${mount_type}" == 'volume' && -n "${volume_name}" && "${mount_rw}" == 'true' ]] ||
    fail "${role} is not exclusively bound to one writable named volume at ${destination}."
  volume_project="$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "${volume_name}")"
  volume_logical="$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "${volume_name}")"
  volume_driver="$(docker volume inspect --format '{{.Driver}}' "${volume_name}")"
  [[ "${volume_project}" == "${COMPOSE_PROJECT}" && "${volume_logical}" == "${logical_name}" && "${volume_driver}" == 'local' ]] ||
    fail "${role} named-volume labels or driver are invalid."
  printf '%s' "${volume_name}"
}

MYSQL_VOLUME="$(inspect_named_volume mysql /var/lib/mysql mysql)"
REDIS_VOLUME="$(inspect_named_volume redis /data redis)"
[[ "${MYSQL_VOLUME}" != "${REDIS_VOLUME}" ]] || fail 'MariaDB and Redis cannot share a named volume.'
MYSQL_IMAGE_ID="${EXPECTED_IMAGE_IDS[mysql]}"

database_output="$(
  docker exec "${MYSQL_CONTAINER}" sh -ceu \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -u root -N -e "SHOW DATABASES;"'
)" || fail 'Unable to enumerate application databases.'
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
TENANT_DATABASE="${application_databases[1]}"

schema_table_query="SELECT table_schema, table_name, table_type, COALESCE(engine, 'VIEW') AS storage_engine FROM information_schema.tables WHERE table_schema IN ('${SYSTEM_DATABASE}','${TENANT_DATABASE}') ORDER BY BINARY table_schema, BINARY table_name;"
query_source_schema_tables() {
  docker exec "${MYSQL_CONTAINER}" sh -ceu \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -u root -N -e "$1"' \
    _ "${schema_table_query}"
}
source_schema_tables="$(query_source_schema_tables)" ||
  fail 'Unable to inventory source schema/table identities.'

validate_schema_table_inventory() {
  local inventory="$1"
  local label="$2"
  local expected_count=$((EXPECTED_SYSTEM_TABLES + EXPECTED_TENANT_TABLES))
  local row schema_name table_name table_type storage_engine extra
  local -a rows=()
  mapfile -t rows <<<"${inventory}"
  [[ "${#rows[@]}" -eq "${expected_count}" ]] ||
    fail "${label} schema/table inventory returned an unexpected row count."
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r schema_name table_name table_type storage_engine extra <<<"${row}"
    [[ \
      ("${schema_name}" == "${SYSTEM_DATABASE}" || "${schema_name}" == "${TENANT_DATABASE}") &&
      "${table_name}" =~ ^[A-Za-z0-9_]+$ &&
      (("${table_type}" == 'BASE TABLE' && "${storage_engine}" == 'InnoDB') ||
        ("${table_type}" == 'VIEW' && "${storage_engine}" == 'VIEW')) &&
      -z "${extra}" \
    ]] || fail "${label} schema/table inventory contains an unsafe or ambiguous identity."
  done
}

validate_schema_table_inventory "${source_schema_tables}" 'Source'
SOURCE_SCHEMA_TABLES_TSV="${UNIT}/proof/source-schema-tables.tsv"
SOURCE_SCHEMA_TABLES_TSV_PARTIAL="${SOURCE_SCHEMA_TABLES_TSV}.partial"
printf 'schema_name\ttable_name\ttable_type\tstorage_engine\n%s\n' "${source_schema_tables}" \
  >"${SOURCE_SCHEMA_TABLES_TSV_PARTIAL}"
mv "${SOURCE_SCHEMA_TABLES_TSV_PARTIAL}" "${SOURCE_SCHEMA_TABLES_TSV}"

DATABASE_BACKUP="${UNIT}/database/easyfire-app-${STAMP}.sql.gz"
DATABASE_PARTIAL="${DATABASE_BACKUP}.partial"
docker exec "${MYSQL_CONTAINER}" sh -ceu \
  'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mariadb-dump --single-transaction --skip-lock-tables --quick --routines --triggers --events --hex-blob --add-drop-database --databases "$@" -u root' \
  _ "${application_databases[@]}" |
  gzip -c >"${DATABASE_PARTIAL}"
[[ -s "${DATABASE_PARTIAL}" ]] || fail 'MariaDB backup is empty.'
gzip -t "${DATABASE_PARTIAL}" || fail 'MariaDB backup is not valid gzip data.'
chmod 0600 "${DATABASE_PARTIAL}"
sync -f "${DATABASE_PARTIAL}"
mv "${DATABASE_PARTIAL}" "${DATABASE_BACKUP}"

source_schema_tables_after_dump="$(query_source_schema_tables)" ||
  fail 'Unable to re-inventory source schema/table identities after the logical dump.'
validate_schema_table_inventory "${source_schema_tables_after_dump}" 'Post-dump source'
[[ "${source_schema_tables_after_dump}" == "${source_schema_tables}" ]] ||
  fail 'Source schema/table inventory changed during the logical dump.'

[[ "$(docker exec "${REDIS_CONTAINER}" redis-cli SAVE | tr -d '\r')" == 'OK' ]] ||
  fail 'Redis SAVE failed.'
REDIS_BACKUP="${UNIT}/redis/easyfire-redis-${STAMP}.rdb"
REDIS_PARTIAL="${REDIS_BACKUP}.partial"
docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${REDIS_PARTIAL}" >/dev/null
[[ -s "${REDIS_PARTIAL}" ]] || fail 'Redis snapshot is empty.'
chmod 0600 "${REDIS_PARTIAL}"
sync -f "${REDIS_PARTIAL}"
mv "${REDIS_PARTIAL}" "${REDIS_BACKUP}"

RESTORE_SUFFIX="$(printf '%s' "${STAMP}" | tr '[:upper:]' '[:lower:]')"
RESTORE_VOLUME="easyfire_bookkeeping_backup_restore_${RESTORE_SUFFIX}"
RESTORE_CONTAINER="easyfire-bookkeeping-backup-restore-${RESTORE_SUFFIX}"
if docker volume inspect "${RESTORE_VOLUME}" >/dev/null 2>&1; then
  fail "Restore proof volume already exists: ${RESTORE_VOLUME}"
fi
if docker container inspect "${RESTORE_CONTAINER}" >/dev/null 2>&1; then
  fail "Restore proof container already exists: ${RESTORE_CONTAINER}"
fi

PROOF_SECRET_DIRECTORY="$(mktemp -d /run/easyfire-bookkeeping-backup-proof.XXXXXXXX)"
[[ "${PROOF_SECRET_DIRECTORY}" == /run/easyfire-bookkeeping-backup-proof.* && -d "${PROOF_SECRET_DIRECTORY}" && ! -L "${PROOF_SECRET_DIRECTORY}" ]] ||
  fail 'Ephemeral proof credential directory is unsafe.'
chmod 0700 "${PROOF_SECRET_DIRECTORY}"
PROOF_DB_USER='easyfire_restore_proof'
restore_started=0
credentials_destroyed=0
destroy_ephemeral_credentials() {
  if [[ "${credentials_destroyed}" -eq 1 ]]; then
    return
  fi
  [[ "${PROOF_SECRET_DIRECTORY}" == /run/easyfire-bookkeeping-backup-proof.* ]] ||
    fail 'Refusing ambiguous proof credential cleanup.'
  rm -f -- \
    "${PROOF_SECRET_DIRECTORY}/database-password" \
    "${PROOF_SECRET_DIRECTORY}/root-password"
  rmdir -- "${PROOF_SECRET_DIRECTORY}"
  credentials_destroyed=1
}

stop_failed_restore() {
  local exit_code=$?
  trap - EXIT
  set +e
  if [[ "${exit_code}" -ne 0 && "${restore_started}" -eq 1 ]]; then
    docker stop --time 30 "${RESTORE_CONTAINER}" >/dev/null 2>&1 || true
  fi
  if [[ "${credentials_destroyed}" -eq 0 ]]; then
    destroy_ephemeral_credentials >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}
trap stop_failed_restore EXIT

PROOF_DB_PASSWORD="$(openssl rand -hex 32)"
PROOF_ROOT_PASSWORD="$(openssl rand -hex 32)"
printf '%s' "${PROOF_DB_PASSWORD}" >"${PROOF_SECRET_DIRECTORY}/database-password"
printf '%s' "${PROOF_ROOT_PASSWORD}" >"${PROOF_SECRET_DIRECTORY}/root-password"
chmod 0600 "${PROOF_SECRET_DIRECTORY}/database-password" "${PROOF_SECRET_DIRECTORY}/root-password"
unset PROOF_DB_PASSWORD PROOF_ROOT_PASSWORD

docker volume create \
  --label easyfire.bookkeeping.purpose=backup-restore-proof \
  --label "easyfire.bookkeeping.backup-stamp=${STAMP}" \
  "${RESTORE_VOLUME}" >/dev/null
docker create \
  --pull=never \
  --name "${RESTORE_CONTAINER}" \
  --network none \
  --label easyfire.bookkeeping.purpose=backup-restore-proof \
  --label "easyfire.bookkeeping.backup-stamp=${STAMP}" \
  --env "MYSQL_DATABASE=${SYSTEM_DATABASE}" \
  --env "MYSQL_USER=${PROOF_DB_USER}" \
  --env MYSQL_PASSWORD_FILE=/run/easyfire-proof-secrets/database-password \
  --env MYSQL_ROOT_PASSWORD_FILE=/run/easyfire-proof-secrets/root-password \
  --mount "type=bind,src=${PROOF_SECRET_DIRECTORY},dst=/run/easyfire-proof-secrets,readonly" \
  --volume "${RESTORE_VOLUME}:/var/lib/mysql" \
  "${MYSQL_IMAGE_ID}" >/dev/null

[[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${RESTORE_CONTAINER}")" == 'none' ]] ||
  fail 'Restore proof container is not network-isolated.'
[[ "$(docker inspect --format '{{.Image}}' "${RESTORE_CONTAINER}")" == "${MYSQL_IMAGE_ID}" ]] ||
  fail 'Restore proof container did not use the immutable MariaDB image ID.'

docker start "${RESTORE_CONTAINER}" >/dev/null
restore_started=1
restore_ready=0
for _ in $(seq 1 90); do
  if docker exec "${RESTORE_CONTAINER}" sh -ceu \
    'MYSQL_PWD="$(cat "$MYSQL_ROOT_PASSWORD_FILE")" mariadb-admin ping -h localhost -u root --silent' \
    >/dev/null 2>&1; then
    restore_ready=1
    break
  fi
  sleep 2
done
[[ "${restore_ready}" -eq 1 ]] || fail 'Isolated MariaDB restore container did not become ready.'

docker cp "${DATABASE_BACKUP}" "${RESTORE_CONTAINER}:/tmp/restore.sql.gz" >/dev/null
docker exec "${RESTORE_CONTAINER}" sh -ceu \
  'gzip -dc /tmp/restore.sql.gz | MYSQL_PWD="$(cat "$MYSQL_ROOT_PASSWORD_FILE")" mariadb -u root'
docker exec "${RESTORE_CONTAINER}" sh -ceu \
  'MYSQL_PWD="$(cat "$MYSQL_ROOT_PASSWORD_FILE")" mariadb -u root -e "GRANT SELECT, SHOW VIEW ON \`$1\`.* TO \`${MYSQL_USER}\`@\`%\`; GRANT SELECT, SHOW VIEW ON \`$2\`.* TO \`${MYSQL_USER}\`@\`%\`; FLUSH PRIVILEGES;"' \
  _ "${SYSTEM_DATABASE}" "${TENANT_DATABASE}"

proof_query() {
  local database_name="$1"
  local query="$2"
  docker exec "${RESTORE_CONTAINER}" sh -ceu \
    'MYSQL_PWD="$(cat "$MYSQL_PASSWORD_FILE")" mariadb -u "$MYSQL_USER" -D "$1" -N -e "$2"' \
    _ "${database_name}" "${query}"
}

docker exec "${RESTORE_CONTAINER}" sh -ceu \
  'MYSQL_PWD="$(cat "$MYSQL_PASSWORD_FILE")" mariadb-check -u "$MYSQL_USER" --databases "$@" --check' \
  _ "${SYSTEM_DATABASE}" "${TENANT_DATABASE}" \
  >"${UNIT}/proof/mariadb-check.txt"
system_table_count="$(
  proof_query "${SYSTEM_DATABASE}" \
    'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();'
)"
tenant_table_count="$(
  proof_query "${TENANT_DATABASE}" \
    'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();'
)"
identity_counts="$(
  proof_query "${SYSTEM_DATABASE}" \
    'SELECT (SELECT COUNT(*) FROM USERS),(SELECT COUNT(*) FROM TENANTS),(SELECT COUNT(*) FROM TENANTS_METADATA),(SELECT COUNT(*) FROM USER_TENANTS);'
)"
restored_schema_tables="$(proof_query "${SYSTEM_DATABASE}" "${schema_table_query}")"
validate_schema_table_inventory "${restored_schema_tables}" 'Restored'
[[ "${restored_schema_tables}" == "${source_schema_tables}" ]] ||
  fail 'Source and restored schema/table manifests do not match.'
RESTORED_SCHEMA_TABLES_TSV="${UNIT}/proof/restored-schema-tables.tsv"
RESTORED_SCHEMA_TABLES_TSV_PARTIAL="${RESTORED_SCHEMA_TABLES_TSV}.partial"
printf 'schema_name\ttable_name\ttable_type\tstorage_engine\n%s\n' "${restored_schema_tables}" \
  >"${RESTORED_SCHEMA_TABLES_TSV_PARTIAL}"
mv "${RESTORED_SCHEMA_TABLES_TSV_PARTIAL}" "${RESTORED_SCHEMA_TABLES_TSV}"

[[ "${system_table_count}" == "${EXPECTED_SYSTEM_TABLES}" ]] ||
  fail "Unexpected restored system table count: ${system_table_count}"
[[ "${tenant_table_count}" == "${EXPECTED_TENANT_TABLES}" ]] ||
  fail "Unexpected restored tenant table count: ${tenant_table_count}"
IFS=$'\t' read -r \
  users_count tenants_count tenant_metadata_count user_tenants_count identity_extra \
  <<<"${identity_counts}"
for identity_count in \
  "${users_count}" "${tenants_count}" "${tenant_metadata_count}" "${user_tenants_count}"; do
  [[ "${identity_count}" =~ ^[0-9]+$ ]] ||
    fail 'Restored identity count is not a nonnegative integer.'
done
[[ -z "${identity_extra}" ]] || fail 'Restored identity count output is ambiguous.'
identity_counts="$(printf '%s\t%s\t%s\t%s' \
  "${users_count}" "${tenants_count}" "${tenant_metadata_count}" "${user_tenants_count}")"
[[ "${#PROTECTED_ACCOUNTING_TABLES[@]}" -eq 37 ]] ||
  fail 'Protected accounting table contract is incomplete.'

protected_existence_union=''
protected_count_union=''
for protected_index in "${!PROTECTED_ACCOUNTING_TABLES[@]}"; do
  protected_table="${PROTECTED_ACCOUNTING_TABLES[${protected_index}]}"
  [[ "${protected_table}" =~ ^[A-Z][A-Z_]*$ ]] || fail 'Protected accounting table name is unsafe.'
  printf -v existence_fragment \
    "SELECT %d AS ordinal, '%s' AS table_name, COUNT(*) AS table_exists FROM information_schema.tables WHERE table_schema=DATABASE() AND BINARY table_name=BINARY '%s'" \
    "$((protected_index + 1))" "${protected_table}" "${protected_table}"
  printf -v count_fragment \
    "SELECT %d AS ordinal, '%s' AS table_name, COUNT(*) AS row_count FROM \`%s\`" \
    "$((protected_index + 1))" "${protected_table}" "${protected_table}"
  if [[ -n "${protected_existence_union}" ]]; then
    protected_existence_union+=' UNION ALL '
    protected_count_union+=' UNION ALL '
  fi
  protected_existence_union+="${existence_fragment}"
  protected_count_union+="${count_fragment}"
done

protected_existence_query="SELECT table_name, table_exists FROM (${protected_existence_union}) AS protected_existence ORDER BY ordinal;"
protected_count_query="SELECT table_name, row_count FROM (${protected_count_union}) AS protected_counts ORDER BY ordinal;"
protected_existence_output="$(proof_query "${TENANT_DATABASE}" "${protected_existence_query}")"
mapfile -t protected_existence_rows <<<"${protected_existence_output}"
[[ "${#protected_existence_rows[@]}" -eq 37 ]] ||
  fail 'Protected accounting existence proof returned an ambiguous row count.'
for protected_index in "${!PROTECTED_ACCOUNTING_TABLES[@]}"; do
  IFS=$'\t' read -r protected_table_name protected_table_exists protected_extra \
    <<<"${protected_existence_rows[${protected_index}]}"
  [[ \
    "${protected_table_name}" == "${PROTECTED_ACCOUNTING_TABLES[${protected_index}]}" &&
    "${protected_table_exists}" == '1' &&
    -z "${protected_extra}" \
  ]] || fail "Protected accounting table is missing or ambiguous: ${PROTECTED_ACCOUNTING_TABLES[${protected_index}]}"
done

protected_count_output="$(proof_query "${TENANT_DATABASE}" "${protected_count_query}")"
mapfile -t protected_count_rows <<<"${protected_count_output}"
[[ "${#protected_count_rows[@]}" -eq 37 ]] ||
  fail 'Protected accounting row-count proof returned an ambiguous row count.'
PROTECTED_ACCOUNTING_TSV="${UNIT}/proof/protected-accounting-counts.tsv"
PROTECTED_ACCOUNTING_TSV_PARTIAL="${PROTECTED_ACCOUNTING_TSV}.partial"
printf 'table_name\trow_count\n' >"${PROTECTED_ACCOUNTING_TSV_PARTIAL}"
for protected_index in "${!PROTECTED_ACCOUNTING_TABLES[@]}"; do
  IFS=$'\t' read -r protected_table_name protected_row_count protected_extra \
    <<<"${protected_count_rows[${protected_index}]}"
  [[ \
    "${protected_table_name}" == "${PROTECTED_ACCOUNTING_TABLES[${protected_index}]}" &&
    "${protected_row_count}" =~ ^[0-9]+$ &&
    -z "${protected_extra}" \
  ]] || fail "Protected accounting count is ambiguous: ${PROTECTED_ACCOUNTING_TABLES[${protected_index}]}"
  printf '%s\t%s\n' "${protected_table_name}" "${protected_row_count}" \
    >>"${PROTECTED_ACCOUNTING_TSV_PARTIAL}"
done
mv "${PROTECTED_ACCOUNTING_TSV_PARTIAL}" "${PROTECTED_ACCOUNTING_TSV}"

printf '%s\t%s\n' "${SYSTEM_DATABASE}" "${system_table_count}" \
  >"${UNIT}/proof/schema-table-counts.tsv"
printf '%s\t%s\n' "${TENANT_DATABASE}" "${tenant_table_count}" \
  >>"${UNIT}/proof/schema-table-counts.tsv"
printf 'users\ttenants\ttenant_metadata\tuser_tenants\n%s\n' "${identity_counts}" \
  >"${UNIT}/proof/identity-invariants.tsv"

docker stop --time 30 "${RESTORE_CONTAINER}" >/dev/null
restore_started=0
[[ "$(docker inspect --format '{{.State.Status}}' "${RESTORE_CONTAINER}")" == 'exited' ]] ||
  fail 'Restore proof container was not preserved in the stopped state.'
destroy_ephemeral_credentials

for runtime_role in envoy webapp server gotenberg mysql redis migration; do
  assert_container_identity "${runtime_role}"
done
[[ "$(inspect_named_volume mysql /var/lib/mysql mysql)" == "${MYSQL_VOLUME}" ]] ||
  fail 'MariaDB volume binding changed during backup.'
[[ "$(inspect_named_volume redis /data redis)" == "${REDIS_VOLUME}" ]] ||
  fail 'Redis volume binding changed during backup.'
AUTHORITY_RECHECK="$(run_authority_validator)" || fail 'Final deployment authority validation failed.'
[[ "${AUTHORITY_RECHECK}" == "${AUTHORITY_OUTPUT}" ]] ||
  fail 'Deployment authority changed during backup.'
DEPLOYMENT_CONTROLLER_VERIFY_RECHECK="$(run_deployment_controller_verification)" ||
  fail 'Final release-owned deployment completion verification failed.'
[[ "${DEPLOYMENT_CONTROLLER_VERIFY_RECHECK}" == "${DEPLOYMENT_CONTROLLER_VERIFY_OUTPUT}" ]] ||
  fail 'Release-owned deployment completion authority changed during backup.'
[[ "$(sha256_file "${RELEASE_MANIFEST}")" == "${RELEASE_MANIFEST_SHA256}" ]] || fail 'Release manifest changed during backup.'
[[ "$(sha256_file "${CHECKPOINT_MANIFEST}")" == "${CHECKPOINT_MANIFEST_SHA256}" ]] || fail 'Checkpoint manifest changed during backup.'
[[ "$(sha256_file "${ENV_FILE}")" == "${ENVIRONMENT_SHA256}" ]] || fail 'Production environment changed during backup.'
[[ "$(sha256_file "${DEPLOYMENT_PLAN}")" == "${DEPLOYMENT_PLAN_SHA256}" ]] || fail 'Deployment plan changed during backup.'
[[ "$(sha256_file "${MIGRATION_RECEIPT}")" == "${MIGRATION_RECEIPT_SHA256}" ]] || fail 'Migration receipt changed during backup.'
[[ "$(sha256_file "${DEPLOYMENT_RECEIPT}")" == "${DEPLOYMENT_RECEIPT_SHA256}" ]] || fail 'Deployment receipt changed during backup.'
[[ "$(sha256_file "${RUNTIME_MANIFEST}")" == "${RUNTIME_MANIFEST_SHA256}" ]] || fail 'Runtime manifest changed during backup.'
[[ "$(sha256_file "${RUNTIME_IDENTITY_EVIDENCE}")" == "${RUNTIME_IDENTITY_EVIDENCE_SHA256}" ]] || fail 'Runtime identity evidence changed during backup.'
[[ "$(docker inspect --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${MYSQL_CONTAINER}")" == 'true|healthy' ]] || fail 'MariaDB health changed during backup.'
[[ "$(docker inspect --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${REDIS_CONTAINER}")" == 'true|healthy' ]] || fail 'Redis health changed during backup.'
[[ "$(docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.FinishedAt}}' "${MIGRATION_CONTAINER}")" == "${MIGRATION_STATE}" ]] || fail 'Migration state changed during backup.'

install -m 0600 "${RELEASE_MANIFEST}" "${UNIT}/authority/release-manifest.json"
install -m 0600 "${CHECKPOINT_MANIFEST}" "${UNIT}/authority/checkpoint-manifest.json"
install -m 0600 "${MIGRATION_RECEIPT}" "${UNIT}/authority/migration-receipt.json"
install -m 0600 "${DEPLOYMENT_RECEIPT}" "${UNIT}/authority/deployment-receipt.json"
install -m 0600 "${RUNTIME_MANIFEST}" "${UNIT}/authority/runtime-manifest.json"
install -m 0600 "${RUNTIME_IDENTITY_EVIDENCE}" "${UNIT}/authority/runtime-identity-evidence.json"
[[ "$(sha256_file "${UNIT}/authority/release-manifest.json")" == "${RELEASE_MANIFEST_SHA256}" ]] || fail 'Copied release manifest hash mismatch.'
[[ "$(sha256_file "${UNIT}/authority/checkpoint-manifest.json")" == "${CHECKPOINT_MANIFEST_SHA256}" ]] || fail 'Copied checkpoint manifest hash mismatch.'
[[ "$(sha256_file "${UNIT}/authority/migration-receipt.json")" == "${MIGRATION_RECEIPT_SHA256}" ]] || fail 'Copied migration receipt hash mismatch.'
[[ "$(sha256_file "${UNIT}/authority/deployment-receipt.json")" == "${DEPLOYMENT_RECEIPT_SHA256}" ]] || fail 'Copied deployment receipt hash mismatch.'
[[ "$(sha256_file "${UNIT}/authority/runtime-manifest.json")" == "${RUNTIME_MANIFEST_SHA256}" ]] || fail 'Copied runtime manifest hash mismatch.'
[[ "$(sha256_file "${UNIT}/authority/runtime-identity-evidence.json")" == "${RUNTIME_IDENTITY_EVIDENCE_SHA256}" ]] || fail 'Copied runtime identity evidence hash mismatch.'

DATABASE_SHA256="$(sha256_file "${DATABASE_BACKUP}")"
REDIS_SHA256="$(sha256_file "${REDIS_BACKUP}")"
MYSQL_IMAGE_REF="${EXPECTED_IMAGE_REFS[mysql]}"
MYSQL_IMAGE_ID="${EXPECTED_IMAGE_IDS[mysql]}"
MYSQL_CONTAINER_ID="${EXPECTED_CONTAINER_IDS[mysql]}"
REDIS_IMAGE_REF="${EXPECTED_IMAGE_REFS[redis]}"
REDIS_IMAGE_ID="${EXPECTED_IMAGE_IDS[redis]}"
REDIS_CONTAINER_ID="${EXPECTED_CONTAINER_IDS[redis]}"
export MYSQL_CONTAINER MYSQL_CONTAINER_ID MYSQL_IMAGE_REF MYSQL_IMAGE_ID MYSQL_VOLUME
export REDIS_CONTAINER REDIS_CONTAINER_ID REDIS_IMAGE_REF REDIS_IMAGE_ID REDIS_VOLUME

/usr/local/bin/node - "${UNIT}/proof/source-container-bindings.json" <<'NODE'
const fs = require('node:fs');
const outputPath = process.argv[2];
const value = {
  schemaVersion: 1,
  project: 'easyfire-bookkeeping-prod',
  mysql: {
    containerName: process.env.MYSQL_CONTAINER,
    containerId: process.env.MYSQL_CONTAINER_ID,
    imageReference: process.env.MYSQL_IMAGE_REF,
    imageId: process.env.MYSQL_IMAGE_ID,
    volumeName: process.env.MYSQL_VOLUME,
    volumeDestination: '/var/lib/mysql',
  },
  redis: {
    containerName: process.env.REDIS_CONTAINER,
    containerId: process.env.REDIS_CONTAINER_ID,
    imageReference: process.env.REDIS_IMAGE_REF,
    imageId: process.env.REDIS_IMAGE_ID,
    volumeName: process.env.REDIS_VOLUME,
    volumeDestination: '/data',
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE

cat >"${UNIT}/RESTORE.md" <<EOF
# EasyFire Bookkeeping backup ${STAMP}

This unit is complete only when both backup-receipt.json and the final COMPLETE
marker exist and their hashes agree.

- Source release: ${SOURCE_COMMIT}
- Deployment: ${DEPLOYMENT_ID}
- Database archive: database/$(basename "${DATABASE_BACKUP}")
- Redis snapshot: redis/$(basename "${REDIS_BACKUP}")
- Preserved proof container: ${RESTORE_CONTAINER}
- Preserved proof volume: ${RESTORE_VOLUME}
- Proof network: none
- Proof credentials: random, proof-only, and destroyed after validation

Never restore this archive into an active volume. Verify COMPLETE, the receipt,
and SHA256SUMS before restoring into another uniquely named network-isolated
proof volume. Redis is cache state and is never the accounting authority. Never
allow the Windows and VM databases to receive user writes simultaneously.
EOF

for proof_file in \
  "${UNIT}/proof/deployment-controller-verification.json" \
  "${UNIT}/proof/authority-bindings.tsv" \
  "${UNIT}/proof/source-container-bindings.json" \
  "${UNIT}/proof/mariadb-check.txt" \
  "${UNIT}/proof/source-schema-tables.tsv" \
  "${UNIT}/proof/restored-schema-tables.tsv" \
  "${UNIT}/proof/schema-table-counts.tsv" \
  "${UNIT}/proof/identity-invariants.tsv" \
  "${UNIT}/proof/protected-accounting-counts.tsv" \
  "${UNIT}/RESTORE.md"; do
  [[ -s "${proof_file}" ]] || fail "Required proof file is empty: ${proof_file}"
  chmod 0600 "${proof_file}"
  sync -f "${proof_file}"
done

SOURCE_SCHEMA_TABLES_SHA256="$(sha256_file "${SOURCE_SCHEMA_TABLES_TSV}")"
RESTORED_SCHEMA_TABLES_SHA256="$(sha256_file "${RESTORED_SCHEMA_TABLES_TSV}")"
IDENTITY_COUNTS_SHA256="$(sha256_file "${UNIT}/proof/identity-invariants.tsv")"
PROTECTED_ACCOUNTING_COUNTS_SHA256="$(sha256_file "${PROTECTED_ACCOUNTING_TSV}")"

(
  cd "${UNIT}"
  sha256sum \
    "database/$(basename "${DATABASE_BACKUP}")" \
    "redis/$(basename "${REDIS_BACKUP}")" \
    authority/release-manifest.json \
    authority/checkpoint-manifest.json \
    authority/migration-receipt.json \
    authority/deployment-receipt.json \
    authority/runtime-manifest.json \
    authority/runtime-identity-evidence.json \
    proof/deployment-controller-verification.json \
    proof/authority-bindings.tsv \
    proof/source-container-bindings.json \
    proof/mariadb-check.txt \
    proof/source-schema-tables.tsv \
    proof/restored-schema-tables.tsv \
    proof/schema-table-counts.tsv \
    proof/identity-invariants.tsv \
    proof/protected-accounting-counts.tsv \
    RESTORE.md \
    >.SHA256SUMS.partial
  sync -f .SHA256SUMS.partial
  mv .SHA256SUMS.partial SHA256SUMS
  sha256sum --check SHA256SUMS >.verification.partial
  sync -f .verification.partial
  mv .verification.partial verification.txt
)
SHA256SUMS_SHA256="$(sha256_file "${UNIT}/SHA256SUMS")"
VERIFICATION_SHA256="$(sha256_file "${UNIT}/verification.txt")"
(
  cd "${UNIT}"
  sha256sum --check SHA256SUMS >/dev/null
)
[[ "$(sha256_file "${DATABASE_BACKUP}")" == "${DATABASE_SHA256}" ]] || fail 'Final database hash recheck failed.'
[[ "$(sha256_file "${REDIS_BACKUP}")" == "${REDIS_SHA256}" ]] || fail 'Final Redis hash recheck failed.'

export \
  STAMP DEPLOYMENT_ID SOURCE_COMMIT SOURCE_RELEASE \
  RELEASE_MANIFEST_SHA256 CHECKPOINT_MANIFEST_SHA256 ENVIRONMENT_SHA256 DEPLOYMENT_PLAN_SHA256 \
  MIGRATION_RECEIPT_SHA256 DEPLOYMENT_RECEIPT_SHA256 RUNTIME_MANIFEST_SHA256 \
  RUNTIME_IDENTITY_EVIDENCE_SHA256 DATABASE_SHA256 REDIS_SHA256 SHA256SUMS_SHA256 \
  VERIFICATION_SHA256 SOURCE_SCHEMA_TABLES_SHA256 RESTORED_SCHEMA_TABLES_SHA256 \
  IDENTITY_COUNTS_SHA256 PROTECTED_ACCOUNTING_COUNTS_SHA256 \
  MYSQL_CONTAINER MYSQL_CONTAINER_ID MYSQL_IMAGE_REF MYSQL_IMAGE_ID MYSQL_VOLUME \
  REDIS_CONTAINER REDIS_CONTAINER_ID REDIS_IMAGE_REF REDIS_IMAGE_ID REDIS_VOLUME \
  SYSTEM_DATABASE TENANT_DATABASE SYSTEM_TABLE_COUNT="${system_table_count}" \
  TENANT_TABLE_COUNT="${tenant_table_count}" IDENTITY_COUNTS="${identity_counts}" \
  RESTORE_CONTAINER RESTORE_VOLUME

/usr/local/bin/node - "${UNIT}/backup-receipt.json" "${UNIT}/COMPLETE" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [receiptPath, completePath] = process.argv.slice(2);
const sha256Pattern = /^[a-f0-9]{64}$/;
for (const [value, label] of [
  [process.env.SOURCE_SCHEMA_TABLES_SHA256, 'Source schema/table evidence hash'],
  [process.env.RESTORED_SCHEMA_TABLES_SHA256, 'Restored schema/table evidence hash'],
  [process.env.IDENTITY_COUNTS_SHA256, 'Identity-count evidence hash'],
  [process.env.PROTECTED_ACCOUNTING_COUNTS_SHA256, 'Protected accounting-count evidence hash'],
]) {
  if (!sha256Pattern.test(value ?? '')) throw new Error(`${label} is invalid.`);
}
if (process.env.SOURCE_SCHEMA_TABLES_SHA256 !== process.env.RESTORED_SCHEMA_TABLES_SHA256) {
  throw new Error('Source and restored schema/table evidence hashes do not match.');
}
function atomicWrite(targetPath, value) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.partial-${process.pid}-${crypto.randomUUID()}`,
  );
  const handle = fs.openSync(temporaryPath, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fchmodSync(handle, 0o600);
    fs.fsyncSync(handle);
  }
  finally {
    fs.closeSync(handle);
  }
  if (fs.existsSync(targetPath)) throw new Error(`Refusing to replace ${targetPath}.`);
  fs.renameSync(temporaryPath, targetPath);
  const directory = fs.openSync(path.dirname(targetPath), 'r');
  try { fs.fsyncSync(directory); }
  finally { fs.closeSync(directory); }
}

const receipt = {
  schemaVersion: 2,
  status: 'passed',
  completedAt: new Date().toISOString(),
  backupStamp: process.env.STAMP,
  sourceAuthority: {
    deploymentId: process.env.DEPLOYMENT_ID,
    releaseCommit: process.env.SOURCE_COMMIT,
    sourceReleasePath: process.env.SOURCE_RELEASE,
    releaseManifestSha256: process.env.RELEASE_MANIFEST_SHA256,
    checkpointManifestSha256: process.env.CHECKPOINT_MANIFEST_SHA256,
    environmentSha256: process.env.ENVIRONMENT_SHA256,
    deploymentPlanSha256: process.env.DEPLOYMENT_PLAN_SHA256,
    migrationReceiptSha256: process.env.MIGRATION_RECEIPT_SHA256,
    deploymentReceiptSha256: process.env.DEPLOYMENT_RECEIPT_SHA256,
    runtimeManifestSha256: process.env.RUNTIME_MANIFEST_SHA256,
    runtimeIdentityEvidenceSha256: process.env.RUNTIME_IDENTITY_EVIDENCE_SHA256,
  },
  sourceContainers: {
    mysql: {
      name: process.env.MYSQL_CONTAINER,
      id: process.env.MYSQL_CONTAINER_ID,
      imageReference: process.env.MYSQL_IMAGE_REF,
      imageId: process.env.MYSQL_IMAGE_ID,
    },
    redis: {
      name: process.env.REDIS_CONTAINER,
      id: process.env.REDIS_CONTAINER_ID,
      imageReference: process.env.REDIS_IMAGE_REF,
      imageId: process.env.REDIS_IMAGE_ID,
    },
  },
  sourceVolumes: {
    mysql: process.env.MYSQL_VOLUME,
    redis: process.env.REDIS_VOLUME,
  },
  databases: [process.env.SYSTEM_DATABASE, process.env.TENANT_DATABASE],
  artifacts: {
    databaseSha256: process.env.DATABASE_SHA256,
    redisSha256: process.env.REDIS_SHA256,
    sha256Manifest: 'SHA256SUMS',
    sha256ManifestSha256: process.env.SHA256SUMS_SHA256,
    verificationOutput: 'verification.txt',
    verificationOutputSha256: process.env.VERIFICATION_SHA256,
  },
  validation: {
    systemTableCount: Number(process.env.SYSTEM_TABLE_COUNT),
    tenantTableCount: Number(process.env.TENANT_TABLE_COUNT),
    identityCounts: process.env.IDENTITY_COUNTS.split('\t').map(Number),
    identityCountsEvidence: {
      path: 'proof/identity-invariants.tsv',
      sha256: process.env.IDENTITY_COUNTS_SHA256,
      valueDomain: 'nonnegative-integer',
    },
    schemaTableInventory: {
      tableCount: Number(process.env.SYSTEM_TABLE_COUNT) + Number(process.env.TENANT_TABLE_COUNT),
      sourceEvidence: 'proof/source-schema-tables.tsv',
      sourceEvidenceSha256: process.env.SOURCE_SCHEMA_TABLES_SHA256,
      restoredEvidence: 'proof/restored-schema-tables.tsv',
      restoredEvidenceSha256: process.env.RESTORED_SCHEMA_TABLES_SHA256,
      exactMatch: true,
      baseTableEngine: 'InnoDB',
    },
    protectedAccountingCounts: {
      tableCount: 37,
      evidence: 'proof/protected-accounting-counts.tsv',
      evidenceSha256: process.env.PROTECTED_ACCOUNTING_COUNTS_SHA256,
      valueDomain: 'nonnegative-integer',
    },
    applicationUserQueries: true,
  },
  restoreProof: {
    container: process.env.RESTORE_CONTAINER,
    volume: process.env.RESTORE_VOLUME,
    network: 'none',
    state: 'stopped-preserved',
    consistency: 'mariadb-single-transaction',
    credentials: 'ephemeral-random-destroyed',
  },
};
atomicWrite(receiptPath, receipt);
const receiptSha256 = crypto.createHash('sha256').update(fs.readFileSync(receiptPath)).digest('hex');
if (receiptSha256.length !== 64) throw new Error('Receipt SHA-256 was not produced.');
atomicWrite(completePath, {
  schemaVersion: 1,
  status: 'complete',
  backupStamp: process.env.STAMP,
  receipt: 'backup-receipt.json',
  receiptSha256,
  sha256Manifest: 'SHA256SUMS',
  sha256ManifestSha256: process.env.SHA256SUMS_SHA256,
});
NODE

[[ -f "${UNIT}/backup-receipt.json" && -f "${UNIT}/COMPLETE" ]] ||
  fail 'Final backup receipt or COMPLETE marker was not published.'
printf 'BACKUP_STATUS=passed\nBACKUP_UNIT=%s\nRESTORE_CONTAINER=%s\nRESTORE_VOLUME=%s\n' \
  "${UNIT}" "${RESTORE_CONTAINER}" "${RESTORE_VOLUME}"
