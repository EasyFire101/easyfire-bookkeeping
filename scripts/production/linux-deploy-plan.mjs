import path from 'node:path';

import { validateFinalQuiescenceAuthority } from './linux-final-quiescence-contract.mjs';

export const PROJECT = 'easyfire-bookkeeping-prod';
export const HOSTNAME = 'easyfire-bookkeeping-newsec';
export const DOCKER_SOCKET = '/var/run/docker.sock';
export const FIXED_PLAN_PATH = '/etc/easyfire-bookkeeping/deployment-plan.json';
export const STAGED_PLAN_PATH =
  '/var/lib/easyfire-bookkeeping-staging/deployment-plan.json';
export const FIXED_RELEASE_ROOT = '/opt/easyfire-bookkeeping/releases';
export const FIXED_CURRENT_RELEASE = '/opt/easyfire-bookkeeping/current';
export const FIXED_STAGING_ROOT = '/var/lib/easyfire-bookkeeping-staging';
export const FIXED_JOURNAL_ROOT = '/var/lib/easyfire-bookkeeping-deployments';
export const FIXED_GENERATOR =
  '/opt/easyfire-bookkeeping/guardian/runtime-manifest-generator.js';
export const DOCKER_VERSION = '29.6.2';
export const COMPOSE_VERSION = '5.3.1';
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_COMMAND_OUTPUT = 8 * 1024 * 1024;
export const ZERO_DOCKER_TIME = '0001-01-01T00:00:00Z';
export const SHA256 = /^[a-f0-9]{64}$/;
export const ENGINE_SHA256 = /^sha256:[a-f0-9]{64}$/;

export const PROTECTED_ACCOUNTING_TABLES = Object.freeze([
  'ACCOUNTS_TRANSACTIONS',
  'BILLS',
  'BILLS_PAYMENTS',
  'BILLS_PAYMENTS_ENTRIES',
  'BILL_LOCATED_COSTS',
  'BILL_LOCATED_COST_ENTRIES',
  'CASHFLOW_TRANSACTIONS',
  'CASHFLOW_TRANSACTION_LINES',
  'CREDIT_NOTES',
  'CREDIT_NOTE_APPLIED_INVOICE',
  'EXPENSES_TRANSACTIONS',
  'EXPENSE_TRANSACTION_CATEGORIES',
  'INVENTORY_ADJUSTMENTS',
  'INVENTORY_ADJUSTMENTS_ENTRIES',
  'INVENTORY_COST_LOT_TRACKER',
  'INVENTORY_TRANSACTIONS',
  'INVENTORY_TRANSACTION_META',
  'ITEMS_ENTRIES',
  'ITEMS_WAREHOUSES_QUANTITY',
  'MANUAL_JOURNALS',
  'MANUAL_JOURNALS_ENTRIES',
  'MATCHED_BANK_TRANSACTIONS',
  'PAYMENT_RECEIVES',
  'PAYMENT_RECEIVES_ENTRIES',
  'RECOGNIZED_BANK_TRANSACTIONS',
  'REFUND_CREDIT_NOTE_TRANSACTIONS',
  'REFUND_VENDOR_CREDIT_TRANSACTIONS',
  'SALES_ESTIMATES',
  'SALES_INVOICES',
  'SALES_RECEIPTS',
  'TAX_RATE_TRANSACTIONS',
  'TIMES',
  'UNCATEGORIZED_CASHFLOW_TRANSACTIONS',
  'VENDOR_CREDITS',
  'VENDOR_CREDIT_APPLIED_BILL',
  'WAREHOUSES_TRANSFERS',
  'WAREHOUSES_TRANSFERS_ENTRIES',
]);

export const ALL_SERVICES = Object.freeze([
  'mysql',
  'redis',
  'gotenberg',
  'server',
  'webapp',
  'envoy',
  'database_migration',
]);
export const LONG_RUNNING_SERVICES = Object.freeze([
  'mysql',
  'redis',
  'gotenberg',
  'server',
  'webapp',
  'envoy',
]);
export const STATELESS_SERVICES = Object.freeze([
  'gotenberg',
  'server',
  'webapp',
  'envoy',
]);
export const SERVICE_CONTRACT = Object.freeze({
  mysql: {
    role: 'mysql',
    name: 'easyfire-bookkeeping-mysql',
    mountTarget: '/var/lib/mysql',
  },
  redis: {
    role: 'redis',
    name: 'easyfire-bookkeeping-redis',
    mountTarget: '/data',
  },
  gotenberg: { role: 'gotenberg', name: 'easyfire-bookkeeping-gotenberg' },
  server: { role: 'server', name: 'easyfire-bookkeeping-server' },
  webapp: { role: 'webapp', name: 'easyfire-bookkeeping-webapp' },
  envoy: {
    role: 'envoy',
    name: 'easyfire-bookkeeping-envoy',
    mountTarget: '/etc/envoy/envoy.yaml',
  },
  database_migration: {
    role: 'migration',
    name: 'easyfire-bookkeeping-migration',
  },
});
export const RELEASE_ROLES = Object.freeze([
  'envoy',
  'webapp',
  'server',
  'gotenberg',
  'mysql',
  'redis',
  'migration',
]);

export const buildMigrationReceipt = ({
  plan,
  migrationContainer,
  migrationTimes,
  dataProof,
}) => ({
  schemaVersion: 1,
  project: 'easyfire-bookkeeping',
  deploymentId: plan.deploymentId,
  releaseCommit: plan.releaseCommit,
  sourceReleasePath: plan.releasePath,
  releaseManifestSha256: plan.releaseManifest.sha256,
  checkpointManifestSha256: plan.checkpoint.manifestSha256,
  environmentSha256: plan.environment.sha256,
  migration: {
    containerName: SERVICE_CONTRACT.database_migration.name,
    containerId: migrationContainer.Id,
    imageId: migrationContainer.Image,
    startedAt: migrationTimes.startedAt,
    completedAt: migrationTimes.completedAt,
    exitCode: 0,
    state: 'exited',
  },
  validation: {
    systemTableCount: dataProof.systemTableCount,
    tenantTableCount: dataProof.tenantTableCount,
    identityCounts: dataProof.identityCounts,
    accountingGuard: 'passed',
  },
  status: 'passed',
});

export const buildStartupGateAuthority = ({
  plan,
  planSha256,
  migrationReceiptSha256,
  authorizedAt,
}) => ({
  schemaVersion: 1,
  project: PROJECT,
  deploymentId: plan.deploymentId,
  status: 'authorized-once',
  authorizedAt,
  planSha256,
  migrationReceiptSha256,
  requiredRestartPolicy: 'no',
  services: LONG_RUNNING_SERVICES.map(
    (service) => SERVICE_CONTRACT[service].name,
  ),
});

export const buildActivationResult = ({
  plan,
  planSha256,
  startupGateAuthoritySha256,
  deploymentEvidenceSha256,
  activatedAt,
  containers,
  migration,
}) => ({
  schemaVersion: 1,
  project: PROJECT,
  deploymentId: plan.deploymentId,
  status: 'activated-validated',
  activatedAt,
  planSha256,
  startupGateAuthoritySha256,
  deploymentEvidenceSha256,
  requiredRestartPolicy: 'no',
  services: containers.map((container, index) => ({
    service: LONG_RUNNING_SERVICES[index],
    containerName: SERVICE_CONTRACT[LONG_RUNNING_SERVICES[index]].name,
    containerId: container.Id,
    imageId: container.Image,
    state: 'running',
    health: 'healthy',
    restartPolicy: 'no',
  })),
  migration,
});

export const buildDeploymentReceipt = ({
  plan,
  planSha256,
  migrationReceiptSha256,
  runtimeManifestSha256,
  runtimeIdentityEvidenceSha256,
  completedAt,
}) => ({
  schemaVersion: 1,
  project: 'easyfire-bookkeeping',
  deploymentId: plan.deploymentId,
  releaseCommit: plan.releaseCommit,
  releaseManifestSha256: plan.releaseManifest.sha256,
  checkpointManifestSha256: plan.checkpoint.manifestSha256,
  environmentSha256: plan.environment.sha256,
  deploymentPlanSha256: planSha256,
  migrationReceiptSha256,
  runtimeManifestSha256,
  runtimeIdentityEvidenceSha256,
  completedAt,
  status: 'complete',
});

export class DeploymentRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeploymentRefusal';
    this.code = code;
  }
}

export const refuse = (code, message) => {
  throw new DeploymentRefusal(code, message);
};
export const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const requireObject = (value, label) => {
  if (!isObject(value)) refuse('E_PLAN_SHAPE', `${label} must be an object.`);
  return value;
};
const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((candidate, index) => candidate !== expected[index])
  ) {
    refuse('E_PLAN_SHAPE', `${label} contains unexpected or missing fields.`);
  }
};
const requireString = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    refuse('E_PLAN_VALUE', `${label} is invalid.`);
  }
  return value;
};
const requireSha = (value, label) => requireString(value, SHA256, label);
export const requireExactPath = (value, expected, label) => {
  if (value !== expected) refuse('E_PLAN_PATH', `${label} must be ${expected}.`);
  return value;
};

export const assertExactDocumentKeys = (value, expected, label) => {
  requireObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    refuse('E_RECEIPT_SHAPE', `${label} has an unexpected field set.`);
  }
};

export const validateDataProofDocument = (proof, plan, label) => {
  assertExactDocumentKeys(
    proof,
    [
      'systemTableCount',
      'tenantTableCount',
      'identityCounts',
      'protectedTableCounts',
      'redisDatabaseSize',
      'redisKeyUpperBound',
      'mariadbCheckSha256',
    ],
    label,
  );
  const protectedCounts = requireObject(
    proof.protectedTableCounts,
    `${label} protected counts`,
  );
  const expectedProtected = Object.keys(plan.expected.protectedTableCounts).sort();
  const actualProtected = Object.keys(protectedCounts).sort();
  if (
    proof.systemTableCount !== plan.expected.systemTableCount ||
    proof.tenantTableCount !== plan.expected.tenantTableCount ||
    !Array.isArray(proof.identityCounts) ||
    proof.identityCounts.length !== 4 ||
    proof.identityCounts.some(
      (count, index) => count !== plan.expected.identityCounts[index],
    ) ||
    actualProtected.length !== expectedProtected.length ||
    actualProtected.some(
      (table, index) =>
        table !== expectedProtected[index] || protectedCounts[table] !== 0,
    ) ||
    !Number.isInteger(proof.redisDatabaseSize) ||
    proof.redisDatabaseSize < 0 ||
    proof.redisDatabaseSize > plan.expected.redisKeyUpperBound ||
    proof.redisKeyUpperBound !== plan.expected.redisKeyUpperBound ||
    !/^[a-f0-9]{64}$/.test(proof.mariadbCheckSha256 ?? '')
  ) {
    refuse('E_DATA_PROOF', `${label} does not match the plan invariants.`);
  }
};

const validateProtectedCounts = (value) => {
  requireObject(value, 'expected.protectedTableCounts');
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedTables = [...PROTECTED_ACCOUNTING_TABLES].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    entries.length !== expectedTables.length ||
    entries.some(([table], index) => table !== expectedTables[index])
  ) {
    refuse('E_ACCOUNTING_AUTHORITY', 'expected.protectedTableCounts set is incomplete.');
  }
  if (entries.some(([, count]) => count !== 0)) {
    refuse(
      'E_ACCOUNTING_AUTHORITY',
      'expected.protectedTableCounts must contain only approved zero-count guards.',
    );
  }
};

export function validateDeploymentPlan(candidate) {
  const plan = requireObject(candidate, 'Deployment plan');
  exactKeys(
    plan,
    [
      'schemaVersion',
      'deploymentId',
      'project',
      'releaseCommit',
      'releasePath',
      'currentReleasePath',
      'releaseManifest',
      'sourceArchive',
      'imageBundle',
      'environment',
      'checkpoint',
      'composeFiles',
      'runtimeManifestGeneratorPath',
      'outputs',
      'resources',
      'expected',
    ],
    'Deployment plan',
  );
  if (plan.schemaVersion !== 1) refuse('E_PLAN_VERSION', 'schemaVersion must be 1.');
  requireString(
    plan.deploymentId,
    /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/,
    'deploymentId',
  );
  if (plan.project !== PROJECT) refuse('E_PLAN_VALUE', `project must be ${PROJECT}.`);
  requireString(plan.releaseCommit, /^[a-f0-9]{40}$/, 'releaseCommit');
  const releasePath = `${FIXED_RELEASE_ROOT}/${plan.releaseCommit}`;
  requireExactPath(plan.releasePath, releasePath, 'releasePath');
  requireExactPath(plan.currentReleasePath, FIXED_CURRENT_RELEASE, 'currentReleasePath');

  requireObject(plan.releaseManifest, 'releaseManifest');
  exactKeys(plan.releaseManifest, ['path', 'sha256'], 'releaseManifest');
  requireExactPath(
    plan.releaseManifest.path,
    `${releasePath}/release-manifest.json`,
    'releaseManifest.path',
  );
  requireSha(plan.releaseManifest.sha256, 'releaseManifest.sha256');
  for (const [field, expectedPath] of [
    ['sourceArchive', `${FIXED_STAGING_ROOT}/source.tar.gz`],
    ['imageBundle', `${FIXED_STAGING_ROOT}/images.tar`],
  ]) {
    requireObject(plan[field], field);
    exactKeys(plan[field], ['path', 'sha256'], field);
    requireExactPath(plan[field].path, expectedPath, `${field}.path`);
    requireSha(plan[field].sha256, `${field}.sha256`);
  }
  requireObject(plan.environment, 'environment');
  exactKeys(plan.environment, ['path', 'sha256'], 'environment');
  requireExactPath(
    plan.environment.path,
    '/etc/easyfire-bookkeeping/production.env',
    'environment.path',
  );
  requireSha(plan.environment.sha256, 'environment.sha256');

  requireObject(plan.checkpoint, 'checkpoint');
  exactKeys(
    plan.checkpoint,
    [
      'manifestPath',
      'manifestSha256',
      'durableManifestPath',
      'sqlGzipPath',
      'sqlGzipSha256',
      'redisRdbPath',
      'redisRdbSha256',
    ],
    'checkpoint',
  );
  for (const [field, expectedPath] of Object.entries({
    manifestPath: `${FIXED_STAGING_ROOT}/checkpoint.json`,
    durableManifestPath: '/etc/easyfire-bookkeeping/checkpoint-manifest.json',
    sqlGzipPath: `${FIXED_STAGING_ROOT}/database.sql.gz`,
    redisRdbPath: `${FIXED_STAGING_ROOT}/dump.rdb`,
  })) {
    requireExactPath(plan.checkpoint[field], expectedPath, `checkpoint.${field}`);
  }
  for (const field of ['manifestSha256', 'sqlGzipSha256', 'redisRdbSha256']) {
    requireSha(plan.checkpoint[field], `checkpoint.${field}`);
  }

  const composeFiles = [
    `${releasePath}/docker-compose.prod.yml`,
    `${releasePath}/deploy/linux/docker-compose.vm.yml`,
    `${releasePath}/deploy/linux/docker-compose.candidate.yml`,
  ];
  if (
    !Array.isArray(plan.composeFiles) ||
    plan.composeFiles.length !== composeFiles.length ||
    plan.composeFiles.some((value, index) => value !== composeFiles[index])
  ) {
    refuse('E_PLAN_PATH', 'composeFiles do not identify the exact release files.');
  }
  requireExactPath(
    plan.runtimeManifestGeneratorPath,
    FIXED_GENERATOR,
    'runtimeManifestGeneratorPath',
  );
  requireObject(plan.outputs, 'outputs');
  exactKeys(
    plan.outputs,
    [
      'runtimeManifestPath',
      'runtimeIdentityEvidencePath',
      'migrationReceiptPath',
      'deploymentReceiptPath',
      'journalRoot',
    ],
    'outputs',
  );
  for (const [field, expectedPath] of Object.entries({
    runtimeManifestPath: '/etc/easyfire-bookkeeping/runtime-manifest.json',
    runtimeIdentityEvidencePath:
      '/etc/easyfire-bookkeeping/runtime-identity-evidence.json',
    migrationReceiptPath: '/etc/easyfire-bookkeeping/migration-receipt.json',
    deploymentReceiptPath: '/etc/easyfire-bookkeeping/deployment-receipt.json',
    journalRoot: FIXED_JOURNAL_ROOT,
  })) {
    requireExactPath(plan.outputs[field], expectedPath, `outputs.${field}`);
  }

  requireObject(plan.resources, 'resources');
  exactKeys(plan.resources, ['network', 'mysqlVolume', 'redisVolume'], 'resources');
  if (plan.resources.network !== 'easyfire-bookkeeping-network') {
    refuse('E_PLAN_VALUE', 'resources.network is invalid.');
  }
  const stem = plan.deploymentId
    .replace(/^direct-vm-/, 'easyfire_bookkeeping_vm_')
    .replaceAll('-', '_');
  requireExactPath(plan.resources.mysqlVolume, `${stem}_mysql`, 'resources.mysqlVolume');
  requireExactPath(plan.resources.redisVolume, `${stem}_redis`, 'resources.redisVolume');

  requireObject(plan.expected, 'expected');
  exactKeys(
    plan.expected,
    [
      'systemDatabase',
      'tenantDatabase',
      'systemTableCount',
      'tenantTableCount',
      'identityCounts',
      'protectedTableCounts',
      'redisKeyUpperBound',
    ],
    'expected',
  );
  if (plan.expected.systemDatabase !== 'easyfire_system') {
    refuse('E_PLAN_VALUE', 'expected.systemDatabase is invalid.');
  }
  requireString(
    plan.expected.tenantDatabase,
    /^easyfire_tenant_[a-z0-9]{8,64}$/,
    'expected.tenantDatabase',
  );
  if (
    plan.expected.systemTableCount !== 17 ||
    plan.expected.tenantTableCount !== 70 ||
    !Array.isArray(plan.expected.identityCounts) ||
    plan.expected.identityCounts.length !== 4 ||
    plan.expected.identityCounts.some((value) => value !== 1) ||
    !Number.isInteger(plan.expected.redisKeyUpperBound) ||
    plan.expected.redisKeyUpperBound < 1 ||
    plan.expected.redisKeyUpperBound > 1_000_000
  ) {
    refuse('E_ACCOUNTING_AUTHORITY', 'expected accounting invariants are invalid.');
  }
  validateProtectedCounts(plan.expected.protectedTableCounts);
  return structuredClone(plan);
}

const allowedComposeOperation = (operation) => {
  const exact = (expected) =>
    operation.length === expected.length &&
    operation.every((value, index) => value === expected[index]);
  return (
    exact(['config', '--format', 'json']) ||
    exact(['create', '--pull', 'never', '--no-build', ...ALL_SERVICES]) ||
    exact(['start', '--wait', '--wait-timeout', '180', 'mysql', 'redis']) ||
    exact(['start', '--wait', '--wait-timeout', '180', ...STATELESS_SERVICES])
  );
};

export function buildComposeArguments(plan, operation) {
  const parsed = validateDeploymentPlan(plan);
  if (!Array.isArray(operation) || !allowedComposeOperation(operation)) {
    refuse('E_COMPOSE_OPERATION', 'Compose operation is outside the deployment contract.');
  }
  const args = ['compose', '--project-name', parsed.project];
  for (const composeFile of parsed.composeFiles) args.push('--file', composeFile);
  args.push('--env-file', parsed.environment.path, ...operation);
  return args;
}

export const parseProductionEnvironment = (bytes, plan) => {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    refuse('E_ENV_ENCODING', 'Production environment must be valid UTF-8.');
  }
  if (text.startsWith('\uFEFF') || text.includes('\0') || /\r(?!\n)/.test(text)) {
    refuse('E_ENV_ENCODING', 'Production environment encoding is ambiguous.');
  }
  const values = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^[\t ]*(?:#.*)?$/.test(line)) continue;
    const equals = line.indexOf('=');
    const key = equals > 0 ? line.slice(0, equals) : '';
    const value = equals > 0 ? line.slice(equals + 1) : '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      refuse('E_ENV_FORMAT', `Production environment line ${index + 1} is malformed.`);
    }
    if (values.has(key)) {
      refuse('E_ENV_DUPLICATE', `Production environment line ${index + 1} duplicates a key.`);
    }
    if (/^[\t ]*['"]/.test(value) || value.endsWith('\\')) {
      refuse('E_ENV_AMBIGUOUS', `Production environment line ${index + 1} is ambiguous.`);
    }
    if (
      value.includes('$') ||
      /^[\t ]/.test(value) ||
      /[\t ]$/.test(value) ||
      /[\t ]#/.test(value)
    ) {
      refuse(
        'E_ENV_COMPOSE_SYNTAX',
        `Production environment line ${index + 1} would be transformed by Docker Compose.`,
      );
    }
    values.set(key, value);
  }
  const required = (key) => {
    const value = values.get(key);
    if (typeof value !== 'string' || value.length === 0) {
      refuse('E_ENV_REQUIRED', `Production environment is missing ${key}.`);
    }
    return value;
  };
  if (values.has('JWT_SECRET')) {
    refuse('E_ENV_LEGACY', 'Production environment still contains legacy JWT_SECRET.');
  }
  const jwt = required('APP_JWT_SECRET');
  const canonical = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    jwt,
  );
  const decoded = canonical ? Buffer.from(jwt, 'base64') : Buffer.alloc(0);
  if (decoded.length < 64 || decoded.toString('base64') !== jwt) {
    refuse('E_ENV_JWT', 'Production JWT secret does not meet the existing policy.');
  }
  for (const key of ['DB_PASSWORD', 'DB_ROOT_PASSWORD']) {
    const value = required(key);
    if (value.length > 1024 || /[\0\r\n]/.test(value) || /PLACEHOLDER/i.test(value)) {
      refuse('E_ENV_SECRET', `Production environment ${key} has an invalid shape.`);
    }
  }
  requireString(required('DB_USER'), /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'DB_USER');
  const exact = {
    IMAGE_TAG: `git-${plan.releaseCommit}`,
    MARIADB_IMAGE_TAG: `git-${plan.releaseCommit}`,
    MARIADB_VOLUME_NAME: plan.resources.mysqlVolume,
    REDIS_VOLUME_NAME: plan.resources.redisVolume,
    BASE_URL: 'https://easyfire-bookkeeping-newsec.taild63e9b.ts.net',
    SIGNUP_DISABLED: 'true',
    SIGNUP_ALLOWED_DOMAINS: '',
    SIGNUP_ALLOWED_EMAILS: '',
    SIGNUP_EMAIL_CONFIRMATION: 'false',
    DB_HOST: 'mysql',
    SYSTEM_DB_NAME: plan.expected.systemDatabase,
    TENANT_DB_NAME_PERFIX: 'easyfire_tenant_',
    PUBLIC_PROXY_PORT: '8080',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    QUEUE_HOST: 'redis',
    QUEUE_PORT: '6379',
    GOTENBERG_URL: 'http://gotenberg:3000',
    GOTENBERG_DOCS_URL: 'http://server:3000/public/',
    HOSTED_ON_BIGCAPITAL_CLOUD: 'false',
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (values.get(key) !== expected) {
      refuse('E_ENV_BINDING', `Production environment ${key} is not plan-bound.`);
    }
  }
  return values;
};

export const expectedReference = (role, commit) => {
  if (role === 'envoy') {
    return 'envoyproxy/envoy:v1.30.11@sha256:b5cc70f5fe5503858817e897ae1da5d873dc32cbc493790b4e330b8a42c4af9d';
  }
  if (role === 'gotenberg') {
    return 'gotenberg/gotenberg:7.10.2@sha256:d03b8a04c6e6c5e568b38f57352266dee4674849b71818774025f8f48d869a9a';
  }
  return `easyfire-bookkeeping/${role === 'mysql' ? 'mariadb' : role}:git-${commit}`;
};

export const parseReleaseManifest = (candidate, plan) => {
  const manifest = requireObject(candidate, 'Release manifest');
  if (manifest.manifestVersion !== 2 || manifest.releaseCommit !== plan.releaseCommit) {
    refuse('E_RELEASE_MANIFEST', 'Release manifest identity is invalid.');
  }
  if (!Array.isArray(manifest.images) || manifest.images.length !== RELEASE_ROLES.length) {
    refuse('E_RELEASE_MANIFEST', 'Release manifest must contain exactly seven images.');
  }
  const images = new Map();
  for (const candidateImage of manifest.images) {
    const image = requireObject(candidateImage, 'Release image entry');
    if (!RELEASE_ROLES.includes(image.role) || images.has(image.role) || 'imageId' in image) {
      refuse('E_RELEASE_MANIFEST', 'Release manifest image roles or authority are invalid.');
    }
    for (const field of ['ociIndexDigest', 'linuxAmd64ManifestDigest', 'engineImageId']) {
      if (!ENGINE_SHA256.test(image[field])) {
        refuse('E_RELEASE_MANIFEST', `Release image ${image.role} ${field} is invalid.`);
      }
    }
    if (image.reference !== expectedReference(image.role, plan.releaseCommit)) {
      refuse('E_RELEASE_MANIFEST', `Release image ${image.role} reference is invalid.`);
    }
    if (
      ['envoy', 'gotenberg'].includes(image.role) &&
      image.reference.slice(image.reference.lastIndexOf('@') + 1) !== image.ociIndexDigest
    ) {
      refuse('E_RELEASE_MANIFEST', `Release image ${image.role} digest binding is invalid.`);
    }
    images.set(image.role, {
      role: image.role,
      reference: image.reference,
      ociIndexDigest: image.ociIndexDigest,
      linuxAmd64ManifestDigest: image.linuxAmd64ManifestDigest,
      engineImageId: image.engineImageId,
    });
  }
  if (RELEASE_ROLES.some((role) => !images.has(role))) {
    refuse('E_RELEASE_MANIFEST', 'Release manifest is missing a required image role.');
  }
  return { manifestVersion: 2, releaseCommit: manifest.releaseCommit, images };
};

export const validateCheckpointManifest = (candidate, plan, options = {}) => {
  const checkpoint = requireObject(candidate, 'Checkpoint manifest');
  requireObject(options, 'Checkpoint validation options');
  exactKeys(
    options,
    options.requireFinalQuiescence === undefined
      ? []
      : ['requireFinalQuiescence'],
    'Checkpoint validation options',
  );
  if (
    options.requireFinalQuiescence !== undefined &&
    typeof options.requireFinalQuiescence !== 'boolean'
  ) {
    refuse(
      'E_CHECKPOINT_AUTHORITY',
      'Checkpoint validation option requireFinalQuiescence must be boolean.',
    );
  }
  const hasFinalQuiescence = Object.hasOwn(checkpoint, 'finalQuiescence');
  if (options.requireFinalQuiescence === true && !hasFinalQuiescence) {
    refuse(
      'E_CHECKPOINT_QUIESCENCE',
      'A final-quiesced checkpoint authority is required.',
    );
  }
  exactKeys(
    checkpoint,
    [
      'schemaVersion',
      'authorityType',
      'status',
      'checkpointId',
      'checkpointTimestamp',
      'checkpointCreatedAt',
      'source',
      'payloads',
      'isolatedRestore',
      'verification',
      ...(hasFinalQuiescence ? ['finalQuiescence'] : []),
    ],
    'Checkpoint manifest',
  );
  const checkpointId = /^direct-vm-preflight-([0-9]{8}-[0-9]{6})$/.exec(
    checkpoint.checkpointId,
  );
  if (
    checkpoint.schemaVersion !== 2 ||
    checkpoint.authorityType !==
      'easyfire-bookkeeping-windows-checkpoint-transfer' ||
    checkpoint.status !== 'verified' ||
    !checkpointId ||
    checkpoint.checkpointTimestamp !== checkpointId[1] ||
    typeof checkpoint.checkpointCreatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      checkpoint.checkpointCreatedAt,
    ) ||
    !Number.isFinite(Date.parse(checkpoint.checkpointCreatedAt))
  ) {
    refuse(
      'E_CHECKPOINT_AUTHORITY',
      'Checkpoint manifest must be the exact verified transfer authority v2.',
    );
  }

  const exactText = (value, pattern, label) => {
    if (typeof value !== 'string' || !pattern.test(value)) {
      refuse('E_CHECKPOINT_AUTHORITY', `${label} is invalid.`);
    }
    return value;
  };
  const exactInteger = (value, label, minimum = 0) => {
    if (!Number.isSafeInteger(value) || value < minimum) {
      refuse('E_CHECKPOINT_AUTHORITY', `${label} is invalid.`);
    }
    return value;
  };
  const exactHash = (value, label) => exactText(value, SHA256, label);
  const safeText = (value, label) =>
    exactText(value, /^[^\u0000-\u001f\u007f]{1,512}$/, label);
  const endsWithCheckpoint = (value, label) => {
    safeText(value, label);
    if (
      value.replaceAll('\\', '/').split('/').at(-1) !== checkpoint.checkpointId
    ) {
      refuse('E_CHECKPOINT_AUTHORITY', `${label} is not checkpoint-bound.`);
    }
  };

  const source = requireObject(checkpoint.source, 'Checkpoint source');
  exactKeys(
    source,
    ['host', 'runtimePreservation', 'databaseNames', 'mysql', 'redis'],
    'Checkpoint source',
  );
  if (
    source.host !== 'NEWSEC' ||
    source.runtimePreservation !== 'preserved' ||
    !Array.isArray(source.databaseNames) ||
    source.databaseNames.length !== 2 ||
    source.databaseNames[0] !== plan.expected.systemDatabase ||
    source.databaseNames[1] !== plan.expected.tenantDatabase
  ) {
    refuse(
      'E_CHECKPOINT_AUTHORITY',
      'Checkpoint source database or preservation authority is invalid.',
    );
  }
  const runtimeIdentity = (candidateIdentity, role) => {
    const identity = requireObject(
      candidateIdentity,
      `Checkpoint ${role} source identity`,
    );
    exactKeys(
      identity,
      ['containerName', 'containerId', 'imageId', 'imageReference', 'volumeName'],
      `Checkpoint ${role} source identity`,
    );
    const expected = {
      mysql: {
        containerName: 'easyfire-mysql',
        volumeName: 'easyfire_prod_mysql',
        imageReference: /^easyfire-bookkeeping\/mariadb:[A-Za-z0-9._-]+$/,
      },
      redis: {
        containerName: 'easyfire-redis',
        volumeName: 'easyfire_prod_redis',
        imageReference: /^easyfire-bookkeeping\/redis:[A-Za-z0-9._-]+$/,
      },
    }[role];
    if (
      identity.containerName !== expected.containerName ||
      identity.volumeName !== expected.volumeName ||
      !/^[a-f0-9]{64}$/.test(identity.containerId) ||
      !ENGINE_SHA256.test(identity.imageId) ||
      !expected.imageReference.test(identity.imageReference)
    ) {
      refuse(
        'E_CHECKPOINT_AUTHORITY',
        `Checkpoint ${role} source identity is invalid.`,
      );
    }
    safeText(identity.imageReference, `Checkpoint ${role} image reference`);
    return identity;
  };
  const mysql = runtimeIdentity(source.mysql, 'mysql');
  const redis = runtimeIdentity(source.redis, 'redis');
  if (
    mysql.containerId === redis.containerId ||
    mysql.imageId === redis.imageId ||
    mysql.volumeName === redis.volumeName
  ) {
    refuse(
      'E_CHECKPOINT_AUTHORITY',
      'Checkpoint source identities are not distinct.',
    );
  }

  if (hasFinalQuiescence) {
    try {
      validateFinalQuiescenceAuthority(checkpoint.finalQuiescence, {
        checkpointCreatedAt: checkpoint.checkpointCreatedAt,
        source,
      });
    } catch (error) {
      refuse(
        'E_CHECKPOINT_QUIESCENCE',
        `Final checkpoint quiescence authority is invalid: ${error.message}`,
      );
    }
  }

  const payloads = requireObject(checkpoint.payloads, 'Checkpoint payloads');
  exactKeys(payloads, ['sqlGzip', 'redisRdb'], 'Checkpoint payloads');
  const validatePayload = (candidatePayload, role, expectedRelativePath, expectedName) => {
    const payload = requireObject(candidatePayload, `Checkpoint ${role} payload`);
    exactKeys(
      payload,
      ['sourceRelativePath', 'fileName', 'bytes', 'sha256'],
      `Checkpoint ${role} payload`,
    );
    if (
      payload.sourceRelativePath !== expectedRelativePath ||
      payload.fileName !== expectedName
    ) {
      refuse(
        'E_CHECKPOINT_AUTHORITY',
        `Checkpoint ${role} payload filename or timestamp is invalid.`,
      );
    }
    exactInteger(payload.bytes, `Checkpoint ${role} payload bytes`, 1);
    exactHash(payload.sha256, `Checkpoint ${role} payload SHA-256`);
    return payload;
  };
  const sqlName = `easyfire-app-${checkpoint.checkpointTimestamp}.sql.gz`;
  const redisName = `easyfire-redis-${checkpoint.checkpointTimestamp}.rdb`;
  const sqlGzip = validatePayload(
    payloads.sqlGzip,
    'SQL',
    `database/${sqlName}`,
    sqlName,
  );
  const redisRdb = validatePayload(
    payloads.redisRdb,
    'Redis',
    `database/${redisName}`,
    redisName,
  );
  if (
    sqlGzip.sha256 !== plan.checkpoint.sqlGzipSha256 ||
    redisRdb.sha256 !== plan.checkpoint.redisRdbSha256
  ) {
    refuse(
      'E_CHECKPOINT_PAYLOAD',
      'Plan SQL or Redis hashes do not match checkpoint v2 payload authority.',
    );
  }

  const restore = requireObject(
    checkpoint.isolatedRestore,
    'Checkpoint isolated restore',
  );
  exactKeys(
    restore,
    [
      'status',
      'proof',
      'network',
      'state',
      'restoreContainer',
      'restoreVolume',
      'systemTableCount',
      'tenantTableCount',
      'identityCounts',
      'mariadbCheckLineCount',
    ],
    'Checkpoint isolated restore',
  );
  const restoreProof = requireObject(
    restore.proof,
    'Checkpoint isolated restore proof',
  );
  exactKeys(
    restoreProof,
    ['sourceRelativePath', 'bytes', 'sha256'],
    'Checkpoint isolated restore proof',
  );
  if (
    restore.status !== 'passed' ||
    restore.network !== 'none' ||
    restore.state !== 'stopped-preserved' ||
    restore.restoreContainer !==
      `easyfire-direct-vm-restore-${checkpoint.checkpointTimestamp}` ||
    restore.restoreVolume !==
      `easyfire_direct_vm_restore_${checkpoint.checkpointTimestamp.replaceAll('-', '_')}` ||
    restore.systemTableCount !== 17 ||
    restore.tenantTableCount !== 70 ||
    restore.systemTableCount !== plan.expected.systemTableCount ||
    restore.tenantTableCount !== plan.expected.tenantTableCount ||
    restoreProof.sourceRelativePath !==
      'restore-proof/isolated-restore-proof.json'
  ) {
    refuse(
      'E_CHECKPOINT_AUTHORITY',
      'Checkpoint isolated restore authority is invalid.',
    );
  }
  exactInteger(restoreProof.bytes, 'Checkpoint restore proof bytes', 1);
  exactHash(restoreProof.sha256, 'Checkpoint restore proof SHA-256');
  exactInteger(
    restore.mariadbCheckLineCount,
    'Checkpoint MariaDB check line count',
    1,
  );
  const identities = requireObject(
    restore.identityCounts,
    'Checkpoint restore identity counts',
  );
  exactKeys(
    identities,
    ['users', 'tenants', 'tenantMetadata', 'userTenants'],
    'Checkpoint restore identity counts',
  );
  const identityValues = [
    identities.users,
    identities.tenants,
    identities.tenantMetadata,
    identities.userTenants,
  ];
  if (
    identityValues.some((value) => value !== 1) ||
    identityValues.some((value, index) => value !== plan.expected.identityCounts[index])
  ) {
    refuse(
      'E_CHECKPOINT_AUTHORITY',
      'Checkpoint isolated restore identity invariants are invalid.',
    );
  }

  const verification = requireObject(
    checkpoint.verification,
    'Checkpoint verification chain',
  );
  exactKeys(
    verification,
    [
      'originalCheckpoint',
      'fileManifest',
      'restoreInstructions',
      'dualLocation',
      'recoveryUnit',
    ],
    'Checkpoint verification chain',
  );
  const validateEvidence = (candidateEvidence, label, expectedPath) => {
    const evidence = requireObject(candidateEvidence, label);
    exactKeys(
      evidence,
      ['sourceRelativePath', 'bytes', 'sha256'],
      label,
    );
    if (evidence.sourceRelativePath !== expectedPath) {
      refuse('E_CHECKPOINT_AUTHORITY', `${label} path is invalid.`);
    }
    exactInteger(evidence.bytes, `${label} bytes`, 1);
    exactHash(evidence.sha256, `${label} SHA-256`);
    return evidence;
  };
  validateEvidence(
    verification.originalCheckpoint,
    'Original checkpoint evidence',
    'checkpoint.json',
  );
  validateEvidence(
    verification.restoreInstructions,
    'Restore instructions evidence',
    'RESTORE.md',
  );
  const fileManifest = requireObject(
    verification.fileManifest,
    'File manifest evidence',
  );
  exactKeys(
    fileManifest,
    ['sourceRelativePath', 'bytes', 'sha256', 'entryCount', 'entryBytes'],
    'File manifest evidence',
  );
  if (fileManifest.sourceRelativePath !== 'files.sha256.json') {
    refuse('E_CHECKPOINT_AUTHORITY', 'File manifest evidence path is invalid.');
  }
  exactInteger(fileManifest.bytes, 'File manifest bytes', 1);
  exactHash(fileManifest.sha256, 'File manifest SHA-256');
  exactInteger(fileManifest.entryCount, 'File manifest entry count', 1);
  exactInteger(fileManifest.entryBytes, 'File manifest entry bytes', 1);

  const dual = requireObject(verification.dualLocation, 'Dual-location evidence');
  exactKeys(
    dual,
    [
      'sourceRelativePath',
      'bytes',
      'sha256',
      'status',
      'verifiedAt',
      'primary',
      'secondary',
      'fileCount',
      'totalBytes',
    ],
    'Dual-location evidence',
  );
  if (
    dual.sourceRelativePath !== 'dual-location-verification.json' ||
    dual.status !== 'passed' ||
    dual.primary === dual.secondary ||
    dual.fileCount !== fileManifest.entryCount + 1 ||
    dual.totalBytes !== fileManifest.entryBytes + fileManifest.bytes
  ) {
    refuse('E_CHECKPOINT_AUTHORITY', 'Dual-location evidence is invalid.');
  }
  exactInteger(dual.bytes, 'Dual-location evidence bytes', 1);
  exactHash(dual.sha256, 'Dual-location evidence SHA-256');
  endsWithCheckpoint(dual.primary, 'Dual-location primary');
  endsWithCheckpoint(dual.secondary, 'Dual-location secondary');

  const recovery = requireObject(
    verification.recoveryUnit,
    'Recovery-unit evidence',
  );
  exactKeys(
    recovery,
    [
      'sourceRelativePath',
      'bytes',
      'sha256',
      'status',
      'verifiedAt',
      'sourceRuntime',
    ],
    'Recovery-unit evidence',
  );
  if (
    recovery.sourceRelativePath !== 'recovery-unit-verification-v2.json' ||
    recovery.status !== 'passed' ||
    recovery.sourceRuntime !== 'preserved'
  ) {
    refuse('E_CHECKPOINT_AUTHORITY', 'Recovery-unit evidence is invalid.');
  }
  exactInteger(recovery.bytes, 'Recovery-unit evidence bytes', 1);
  exactHash(recovery.sha256, 'Recovery-unit evidence SHA-256');
  const dualTime = Date.parse(
    exactText(
      dual.verifiedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
      'Dual-location verifiedAt',
    ),
  );
  const recoveryTime = Date.parse(
    exactText(
      recovery.verifiedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
      'Recovery-unit verifiedAt',
    ),
  );
  if (
    !Number.isFinite(dualTime) ||
    !Number.isFinite(recoveryTime) ||
    dualTime > recoveryTime
  ) {
    refuse('E_CHECKPOINT_AUTHORITY', 'Checkpoint verification chronology is invalid.');
  }
  return structuredClone(checkpoint);
};

export const validateCheckpointPayloadFiles = (
  checkpointCandidate,
  plan,
  candidateFiles,
  options = {},
) => {
  const checkpoint = validateCheckpointManifest(
    checkpointCandidate,
    plan,
    options,
  );
  const files = requireObject(candidateFiles, 'Checkpoint staged payload files');
  exactKeys(files, ['sqlGzip', 'redisRdb'], 'Checkpoint staged payload files');
  for (const [role, payloadRole] of [
    ['sqlGzip', 'sqlGzip'],
    ['redisRdb', 'redisRdb'],
  ]) {
    const file = requireObject(files[role], `Checkpoint staged ${role} file`);
    exactKeys(file, ['sha256', 'bytes'], `Checkpoint staged ${role} file`);
    requireSha(file.sha256, `Checkpoint staged ${role} SHA-256`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1) {
      refuse(
        'E_CHECKPOINT_PAYLOAD',
        `Checkpoint staged ${role} byte size is invalid.`,
      );
    }
    const payload = checkpoint.payloads[payloadRole];
    if (file.sha256 !== payload.sha256 || file.bytes !== payload.bytes) {
      refuse(
        'E_CHECKPOINT_PAYLOAD',
        `Checkpoint staged ${role} hash or byte size does not match v2 payload authority.`,
      );
    }
  }
  return checkpoint;
};
