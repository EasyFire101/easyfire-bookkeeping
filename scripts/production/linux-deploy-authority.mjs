import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { createReadStream } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createGunzip } from 'node:zlib';

import {
  assertExactDocumentKeys,
  DeploymentRefusal,
  FIXED_PLAN_PATH,
  LONG_RUNNING_SERVICES,
  MAX_JSON_BYTES,
  parseProductionEnvironment,
  parseReleaseManifest,
  PROJECT,
  refuse,
  requireExactPath,
  requireObject,
  SERVICE_CONTRACT,
  STAGED_PLAN_PATH,
  validateCheckpointManifest,
  validateCheckpointPayloadFiles,
  validateDataProofDocument,
  validateDeploymentPlan,
  ZERO_DOCKER_TIME,
  DOCKER_SOCKET,
} from './linux-deploy-plan.mjs';
import { docker, runCommand, runDockerExec } from './linux-deploy-docker.mjs';
import { verifyManifestBoundRelease } from './linux-release-authority-verify.mjs';

export const pathExists = async (candidate) => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const syncDirectory = async (directory) => {
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const writeBytesExclusive = async (target, bytes) => {
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let handle;
  let temporaryExists = false;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    temporaryExists = true;
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        refuse('E_EXCLUSIVE_OUTPUT', `Output already exists: ${target}.`);
      }
      throw error;
    }
    await chmod(target, 0o600);
    await syncDirectory(directory);
    await unlink(temporary);
    temporaryExists = false;
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => {});
    if (temporaryExists) await unlink(temporary).catch(() => {});
  }
};

export const writeJsonExclusive = (target, value) =>
  writeBytesExclusive(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));

export const ensureLinuxRoot = () => {
  if (process.platform !== 'linux') {
    refuse('E_PLATFORM', 'Deployment controller runs only on Linux.');
  }
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    refuse('E_ROOT_REQUIRED', 'Deployment controller must run as root.');
  }
};

export const assertSecureFile = async (
  filePath,
  { exactMode, maxBytes = Number.MAX_SAFE_INTEGER } = {},
) => {
  if ((await realpath(filePath).catch(() => null)) !== filePath) {
    refuse('E_FILE_PATH', 'A required input is missing or traverses a symlink.');
  }
  const metadata = await lstat(filePath);
  const mode = metadata.mode & 0o777;
  if (
    !metadata.isFile() ||
    metadata.uid !== 0 ||
    (mode & 0o022) !== 0 ||
    (exactMode !== undefined && mode !== exactMode) ||
    metadata.size < 1 ||
    metadata.size > maxBytes
  ) {
    refuse('E_FILE_AUTHORITY', 'A required input has unsafe ownership, mode, type, or size.');
  }
  return metadata;
};

export const sha256Bytes = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const sha256File = async (filePath) => {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
};
export const verifyFileHash = async (filePath, expected, options = {}) => {
  await assertSecureFile(filePath, options);
  const actual = await sha256File(filePath);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  ) {
    refuse('E_HASH_MISMATCH', 'A required input SHA-256 does not match its plan.');
  }
  return actual;
};

const parseJsonBytes = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    refuse('E_JSON', `${label} is not valid JSON.`);
  }
};
export const readJsonSecure = async (filePath, label, options = {}) => {
  await assertSecureFile(filePath, { maxBytes: MAX_JSON_BYTES, ...options });
  const bytes = await readFile(filePath);
  return { bytes, value: parseJsonBytes(bytes, label) };
};

const assertCurrentRelease = async (plan) => {
  const current = await lstat(plan.currentReleasePath);
  if (!current.isSymbolicLink() || (await realpath(plan.currentReleasePath)) !== plan.releasePath) {
    refuse('E_RELEASE_LINK', 'Current release symlink does not match the deployment plan.');
  }
  const release = await stat(plan.releasePath);
  if (
    !release.isDirectory() ||
    release.uid !== 0 ||
    ((release.mode & 0o777) & 0o022) !== 0
  ) {
    refuse('E_RELEASE_AUTHORITY', 'Release directory ownership or mode is unsafe.');
  }
};

export const collectBoundInputs = async (planPath, { fixedPlan }) => {
  requireExactPath(planPath, fixedPlan ? FIXED_PLAN_PATH : STAGED_PLAN_PATH, 'CLI --plan');
  const planDocument = await readJsonSecure(planPath, 'Deployment plan', {
    exactMode: 0o600,
  });
  const plan = validateDeploymentPlan(planDocument.value);
  const planSha256 = sha256Bytes(planDocument.bytes);
  await assertCurrentRelease(plan);
  await verifyFileHash(plan.releaseManifest.path, plan.releaseManifest.sha256, {
    exactMode: 0o644,
    maxBytes: MAX_JSON_BYTES,
  });
  await verifyFileHash(plan.sourceArchive.path, plan.sourceArchive.sha256);
  await verifyFileHash(plan.imageBundle.path, plan.imageBundle.sha256);
  await verifyFileHash(plan.environment.path, plan.environment.sha256, {
    exactMode: 0o600,
    maxBytes: MAX_JSON_BYTES,
  });
  await verifyFileHash(plan.checkpoint.manifestPath, plan.checkpoint.manifestSha256, {
    exactMode: 0o600,
    maxBytes: MAX_JSON_BYTES,
  });
  const sqlGzipSha256 = await verifyFileHash(
    plan.checkpoint.sqlGzipPath,
    plan.checkpoint.sqlGzipSha256,
    { exactMode: 0o600 },
  );
  const redisRdbSha256 = await verifyFileHash(
    plan.checkpoint.redisRdbPath,
    plan.checkpoint.redisRdbSha256,
    { exactMode: 0o600 },
  );
  const [sqlGzipMetadata, redisRdbMetadata] = await Promise.all([
    stat(plan.checkpoint.sqlGzipPath),
    stat(plan.checkpoint.redisRdbPath),
  ]);
  await assertSecureFile(plan.runtimeManifestGeneratorPath);
  const releaseDocument = await readJsonSecure(plan.releaseManifest.path, 'Release manifest');
  const releaseManifest = parseReleaseManifest(releaseDocument.value, plan);
  await verifyManifestBoundRelease({
    manifestValue: releaseDocument.value,
    releasePath: plan.releasePath,
    sourceArchivePath: plan.sourceArchive.path,
    imageBundlePath: plan.imageBundle.path,
    engineEvidencePath:
      '/var/lib/easyfire-bookkeeping-staging/target-engine-evidence.json',
    guardianInstallRoot: '/opt/easyfire-bookkeeping/guardian',
    systemdRoot: '/etc/systemd/system',
    requireRootOwner: true,
    requireInstalledCopies: fixedPlan,
  });
  const environment = parseProductionEnvironment(await readFile(plan.environment.path), plan);
  const checkpointDocument = await readJsonSecure(
    plan.checkpoint.manifestPath,
    'Checkpoint manifest',
    { exactMode: 0o600 },
  );
  const checkpoint = validateCheckpointManifest(checkpointDocument.value, plan);
  validateCheckpointPayloadFiles(checkpoint, plan, {
    sqlGzip: {
      sha256: sqlGzipSha256,
      bytes: sqlGzipMetadata.size,
    },
    redisRdb: {
      sha256: redisRdbSha256,
      bytes: redisRdbMetadata.size,
    },
  });
  const composeSha256 = {};
  for (const composeFile of plan.composeFiles) {
    await assertSecureFile(composeFile, { maxBytes: MAX_JSON_BYTES });
    composeSha256[composeFile.slice(plan.releasePath.length + 1)] =
      await sha256File(composeFile);
  }
  return {
    plan,
    planBytes: planDocument.bytes,
    planSha256,
    releaseManifest,
    environment,
    checkpointBytes: checkpointDocument.bytes,
    composeSha256,
    runtimeManifestGeneratorSha256: await sha256File(
      plan.runtimeManifestGeneratorPath,
    ),
  };
};

export const assertDeploymentOutputsAbsent = async (plan) => {
  for (const output of [
    FIXED_PLAN_PATH,
    plan.checkpoint.durableManifestPath,
    plan.outputs.runtimeManifestPath,
    plan.outputs.runtimeIdentityEvidencePath,
    plan.outputs.migrationReceiptPath,
    plan.outputs.deploymentReceiptPath,
  ]) {
    if (await pathExists(output)) {
      refuse('E_EXISTING_OUTPUT', `Deployment output already exists: ${output}.`);
    }
  }
  if (await pathExists('/etc/easyfire-bookkeeping/rollback.lock')) {
    refuse('E_ROLLBACK_LOCK', 'Rollback lock is present.');
  }
  const root = await realpath(plan.outputs.journalRoot).catch(() => null);
  const metadata = await lstat(plan.outputs.journalRoot).catch(() => null);
  if (
    root !== plan.outputs.journalRoot ||
    !metadata?.isDirectory() ||
    metadata.uid !== 0 ||
    ((metadata.mode & 0o777) & 0o022) !== 0
  ) {
    refuse('E_JOURNAL_ROOT', 'Deployment journal root is unsafe.');
  }
  if ((await readdir(plan.outputs.journalRoot)).length !== 0) {
    refuse('E_JOURNAL_COLLISION', 'Deployment journal root is not empty.');
  }
};

export const createDeploymentJournal = async (inputs, dockerEngine) => {
  const journal = `${inputs.plan.outputs.journalRoot}/${inputs.plan.deploymentId}`;
  await mkdir(journal, { recursive: false, mode: 0o700 });
  await chmod(journal, 0o700);
  await writeJsonExclusive(`${journal}/authority.json`, {
    schemaVersion: 1,
    project: PROJECT,
    deploymentId: inputs.plan.deploymentId,
    status: 'claimed',
    createdAt: new Date().toISOString(),
    planSha256: inputs.planSha256,
    releaseCommit: inputs.plan.releaseCommit,
    inputSha256: {
      releaseManifest: inputs.plan.releaseManifest.sha256,
      sourceArchive: inputs.plan.sourceArchive.sha256,
      imageBundle: inputs.plan.imageBundle.sha256,
      environment: inputs.plan.environment.sha256,
      checkpointManifest: inputs.plan.checkpoint.manifestSha256,
      sqlGzip: inputs.plan.checkpoint.sqlGzipSha256,
      redisRdb: inputs.plan.checkpoint.redisRdbSha256,
      runtimeManifestGenerator: inputs.runtimeManifestGeneratorSha256,
      compose: inputs.composeSha256,
    },
    dockerEngine,
  });
  return journal;
};

export const writeFailureJournal = async (
  journal,
  phase,
  error,
  migrationMayHaveStarted,
) => {
  if (!journal) return;
  const refusal =
    error instanceof DeploymentRefusal
      ? error
      : new DeploymentRefusal('E_INTERNAL', 'Unexpected deployment failure.');
  await writeJsonExclusive(`${journal}/failure.json`, {
    schemaVersion: 1,
    project: PROJECT,
    status: 'failed-preserved',
    failedAt: new Date().toISOString(),
    phase,
    code: refusal.code,
    message: refusal.message,
    migrationMayHaveStarted,
    retryAuthorized: false,
    preservationRequired: true,
  });
};

const parseSingleInteger = (buffer, label) => {
  const text = buffer.toString('utf8').trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    refuse('E_DATA_PROOF', `${label} did not return one integer.`);
  }
  return Number(text);
};

const runMariaDb = async ({ environment, user, database, query, command, input, label, timeoutMs }) => {
  const args = command ?? [
    'mariadb',
    '--protocol=socket',
    '--batch',
    '--skip-column-names',
    '--raw',
    '--user',
    user,
  ];
  if (database) args.push('--database', database);
  if (query) args.push('--execute', query);
  return runDockerExec({
    containerName: SERVICE_CONTRACT.mysql.name,
    command: args,
    environment,
    input,
    timeoutMs,
    label,
  });
};

export const restoreDatabase = async (plan, environment) => {
  const compressed = createReadStream(plan.checkpoint.sqlGzipPath);
  const gunzip = createGunzip();
  compressed.once('error', () => gunzip.destroy(new Error('compressed input failed')));
  compressed.pipe(gunzip);
  await runMariaDb({
    environment: [`MYSQL_PWD=${environment.get('DB_ROOT_PASSWORD')}`],
    command: ['mariadb', '--protocol=socket', '--batch', '--user', 'root'],
    input: gunzip,
    label: 'Exact checkpoint database restore',
    timeoutMs: 600_000,
  });
};

export const validateDatabaseState = async (plan, environment, phase) => {
  const appEnv = [`MYSQL_PWD=${environment.get('DB_PASSWORD')}`];
  const rootEnv = [`MYSQL_PWD=${environment.get('DB_ROOT_PASSWORD')}`];
  const user = environment.get('DB_USER');
  const check = await runMariaDb({
    environment: rootEnv,
    command: ['mariadb-check', '--user', 'root', '--all-databases', '--check'],
    label: `${phase} MariaDB integrity check`,
    timeoutMs: 300_000,
  });
  const databaseOutput = await runMariaDb({
    environment: appEnv,
    user,
    query:
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${plan.expected.systemDatabase}' OR SCHEMA_NAME LIKE 'easyfire\\_tenant\\_%' ORDER BY SCHEMA_NAME;`,
    label: `${phase} application database inventory`,
  });
  const databases = databaseOutput.stdout
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    databases.length !== 2 ||
    databases[0] !== plan.expected.systemDatabase ||
    databases[1] !== plan.expected.tenantDatabase
  ) {
    refuse('E_DATA_AUTHORITY', `${phase} application database set is ambiguous.`);
  }
  const tableQuery =
    'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();';
  const queryCount = async (database, query, label) =>
    parseSingleInteger(
      (await runMariaDb({ environment: appEnv, user, database, query, label })).stdout,
      label,
    );
  const systemTableCount = await queryCount(
    plan.expected.systemDatabase,
    tableQuery,
    `${phase} system table count`,
  );
  const tenantTableCount = await queryCount(
    plan.expected.tenantDatabase,
    tableQuery,
    `${phase} tenant table count`,
  );
  const identityCounts = (
    await runMariaDb({
      environment: appEnv,
      user,
      database: plan.expected.systemDatabase,
      query:
        'SELECT (SELECT COUNT(*) FROM USERS),(SELECT COUNT(*) FROM TENANTS),(SELECT COUNT(*) FROM TENANTS_METADATA),(SELECT COUNT(*) FROM USER_TENANTS);',
      label: `${phase} identity invariant check`,
    })
  ).stdout
    .toString('utf8')
    .trim()
    .split('\t')
    .map(Number);
  const protectedTableCounts = {};
  for (const [table, expected] of Object.entries(plan.expected.protectedTableCounts)) {
    const count = await queryCount(
      plan.expected.tenantDatabase,
      `SELECT COUNT(*) FROM \`${table}\`;`,
      `${phase} protected table check`,
    );
    if (count !== expected) {
      refuse('E_ACCOUNTING_DATA', `${phase} protected accounting table count changed.`);
    }
    protectedTableCounts[table] = count;
  }
  if (
    systemTableCount !== plan.expected.systemTableCount ||
    tenantTableCount !== plan.expected.tenantTableCount ||
    identityCounts.length !== 4 ||
    identityCounts.some((value, index) => value !== plan.expected.identityCounts[index])
  ) {
    refuse('E_DATA_PROOF', `${phase} schema or identity invariants failed.`);
  }
  const redisResult = await docker(
    ['container', 'exec', SERVICE_CONTRACT.redis.name, 'redis-cli', '--raw', 'DBSIZE'],
    { label: `${phase} Redis size check`, timeoutMs: 30_000, maxOutputBytes: 64 * 1024 },
  );
  const redisDatabaseSize = parseSingleInteger(redisResult.stdout, `${phase} Redis size check`);
  if (redisDatabaseSize > plan.expected.redisKeyUpperBound) {
    refuse('E_DATA_PROOF', `${phase} Redis key count exceeds its checkpoint upper bound.`);
  }
  return {
    systemTableCount,
    tenantTableCount,
    identityCounts,
    protectedTableCounts,
    redisDatabaseSize,
    redisKeyUpperBound: plan.expected.redisKeyUpperBound,
    mariadbCheckSha256: sha256Bytes(check.stdout),
  };
};

export const localHttpProbe = (pathname) =>
  new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port: 8080,
        path: pathname,
        timeout: 15_000,
        headers: { Host: 'easyfire-bookkeeping-newsec.taild63e9b.ts.net' },
      },
      (response) => {
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) request.destroy();
        });
        response.once('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new DeploymentRefusal('E_HTTP_HEALTH', 'Local health probe failed.'));
          } else resolve({ path: pathname, statusCode: response.statusCode });
        });
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () =>
      reject(new DeploymentRefusal('E_HTTP_HEALTH', 'Local health probe failed.')),
    );
  });

export const assertFreshMigration = (container) => {
  if (
    container.State?.Status !== 'created' ||
    container.State?.Running !== false ||
    container.State?.StartedAt !== ZERO_DOCKER_TIME ||
    container.State?.FinishedAt !== ZERO_DOCKER_TIME ||
    container.RestartCount !== 0
  ) {
    refuse('E_MIGRATION_REPLAY', 'Migration container is not never-started.');
  }
};
export const assertCompletedMigration = (container) => {
  const startedAt = container.State?.StartedAt;
  const completedAt = container.State?.FinishedAt;
  if (
    container.State?.Status !== 'exited' ||
    container.State?.Running !== false ||
    container.State?.ExitCode !== 0 ||
    container.RestartCount !== 0 ||
    startedAt === ZERO_DOCKER_TIME ||
    completedAt === ZERO_DOCKER_TIME ||
    Number.isNaN(Date.parse(startedAt)) ||
    Number.isNaN(Date.parse(completedAt)) ||
    Date.parse(completedAt) < Date.parse(startedAt)
  ) {
    refuse('E_MIGRATION_RESULT', 'Migration did not exit successfully exactly once.');
  }
  return { startedAt, completedAt };
};

export const runRuntimeManifestGenerator = async (plan, verifyExisting) => {
  const args = [plan.runtimeManifestGeneratorPath];
  if (verifyExisting) args.push('--verify-existing');
  args.push(
    '--release-manifest',
    plan.releaseManifest.path,
    '--current-release',
    plan.currentReleasePath,
    '--output',
    plan.outputs.runtimeManifestPath,
    '--evidence',
    plan.outputs.runtimeIdentityEvidencePath,
    '--docker-socket',
    DOCKER_SOCKET,
  );
  await runCommand('/usr/local/bin/node', args, {
    label: verifyExisting ? 'Existing runtime identity verification' : 'Runtime identity generation',
    timeoutMs: 120_000,
    maxOutputBytes: 1024 * 1024,
  });
};

export const validateRuntimeDocuments = async (plan, resources) => {
  const runtime = await readJsonSecure(plan.outputs.runtimeManifestPath, 'Runtime manifest', {
    exactMode: 0o600,
  });
  const evidence = await readJsonSecure(
    plan.outputs.runtimeIdentityEvidencePath,
    'Runtime identity evidence',
    { exactMode: 0o600 },
  );
  for (const document of [runtime.bytes, evidence.bytes]) {
    if (/APP_JWT_SECRET|DB_ROOT_PASSWORD|DB_PASSWORD/.test(document.toString('utf8'))) {
      refuse('E_RUNTIME_EVIDENCE_SECRET', 'Runtime documents contain forbidden secret keys.');
    }
  }
  if (
    runtime.value?.schemaVersion !== 1 ||
    runtime.value?.project !== 'easyfire-bookkeeping' ||
    runtime.value?.services?.length !== 6 ||
    evidence.value?.schemaVersion !== 1 ||
    evidence.value?.project !== 'easyfire-bookkeeping' ||
    evidence.value?.releaseCommit !== plan.releaseCommit ||
    evidence.value?.sourceReleasePath !== plan.releasePath ||
    evidence.value?.services?.length !== 6
  ) {
    refuse('E_RUNTIME_EVIDENCE', 'Runtime identity documents have an invalid shape.');
  }
  for (const service of LONG_RUNNING_SERVICES) {
    const role = SERVICE_CONTRACT[service].role;
    const runtimeEntry = runtime.value.services.find((entry) => entry.role === role);
    const evidenceEntry = evidence.value.services.find((entry) => entry.role === role);
    const created = resources.containers[service];
    if (
      !runtimeEntry ||
      !evidenceEntry ||
      runtimeEntry.containerName !== created.name ||
      runtimeEntry.containerId !== created.id ||
      runtimeEntry.imageId !== created.imageId ||
      runtimeEntry.requireDockerHealth !== true ||
      evidenceEntry.containerName !== created.name ||
      evidenceEntry.containerId !== created.id ||
      evidenceEntry.actualImageId !== created.imageId
    ) {
      refuse('E_RUNTIME_EVIDENCE', `Runtime identity for ${service} is invalid.`);
    }
  }
  return {
    runtimeManifestSha256: sha256Bytes(runtime.bytes),
    runtimeIdentityEvidenceSha256: sha256Bytes(evidence.bytes),
  };
};

export const readVerifiedDeploymentChain = async (inputs) => {
  const { plan } = inputs;
  const journalPath = `${plan.outputs.journalRoot}/${plan.deploymentId}`;
  if (await pathExists(`${journalPath}/failure.json`)) {
    refuse('E_FAILED_DEPLOYMENT', 'Deployment failure evidence exists.');
  }
  const readJournal = (name, label) =>
    readJsonSecure(`${journalPath}/${name}`, label, { exactMode: 0o600 });
  const [
    migrationDoc,
    deploymentDoc,
    authorityDoc,
    evidenceDoc,
    startupGateDoc,
    activationDoc,
  ] = await Promise.all([
    readJsonSecure(plan.outputs.migrationReceiptPath, 'Migration receipt', {
      exactMode: 0o600,
    }),
    readJsonSecure(plan.outputs.deploymentReceiptPath, 'Deployment receipt', {
      exactMode: 0o600,
    }),
    readJournal('authority.json', 'Deployment authority journal'),
    readJournal('deployment-evidence.json', 'Deployment evidence journal'),
    readJournal('startup-gate-authority.json', 'Startup gate authority'),
    readJournal('activation-result.json', 'Activation result'),
  ]);
  const migrationReceipt = requireObject(migrationDoc.value, 'Migration receipt');
  const deploymentReceipt = requireObject(deploymentDoc.value, 'Deployment receipt');
  const authority = requireObject(authorityDoc.value, 'Deployment authority journal');
  const evidence = requireObject(evidenceDoc.value, 'Deployment evidence journal');
  const startupGate = requireObject(startupGateDoc.value, 'Startup gate authority');
  const activationResult = requireObject(activationDoc.value, 'Activation result');
  assertExactDocumentKeys(migrationReceipt, [
    'schemaVersion', 'project', 'deploymentId', 'releaseCommit', 'sourceReleasePath',
    'releaseManifestSha256', 'checkpointManifestSha256', 'environmentSha256',
    'migration', 'validation', 'status',
  ], 'Migration receipt');
  assertExactDocumentKeys(migrationReceipt.migration, [
    'containerName', 'containerId', 'imageId', 'startedAt', 'completedAt',
    'exitCode', 'state',
  ], 'Migration receipt result');
  assertExactDocumentKeys(migrationReceipt.validation, [
    'systemTableCount', 'tenantTableCount', 'identityCounts', 'accountingGuard',
  ], 'Migration receipt validation');
  assertExactDocumentKeys(deploymentReceipt, [
    'schemaVersion', 'project', 'deploymentId', 'releaseCommit',
    'releaseManifestSha256', 'checkpointManifestSha256', 'environmentSha256',
    'deploymentPlanSha256', 'migrationReceiptSha256', 'runtimeManifestSha256',
    'runtimeIdentityEvidenceSha256', 'completedAt', 'status',
  ], 'Deployment receipt');
  const migration = migrationReceipt.migration;
  const validation = migrationReceipt.validation;
  const migrationReceiptSha256 = sha256Bytes(migrationDoc.bytes);
  if (
    migrationReceipt.schemaVersion !== 1 ||
    migrationReceipt.project !== 'easyfire-bookkeeping' ||
    migrationReceipt.deploymentId !== plan.deploymentId ||
    migrationReceipt.releaseCommit !== plan.releaseCommit ||
    migrationReceipt.sourceReleasePath !== plan.releasePath ||
    migrationReceipt.releaseManifestSha256 !== plan.releaseManifest.sha256 ||
    migrationReceipt.checkpointManifestSha256 !== plan.checkpoint.manifestSha256 ||
    migrationReceipt.environmentSha256 !== plan.environment.sha256 ||
    migrationReceipt.status !== 'passed' ||
    migration.containerName !== SERVICE_CONTRACT.database_migration.name ||
    !/^[a-f0-9]{64}$/.test(migration.containerId ?? '') ||
    migration.imageId !== inputs.releaseManifest.images.get('migration').engineImageId ||
    migration.exitCode !== 0 ||
    migration.state !== 'exited' ||
    Number.isNaN(Date.parse(migration.startedAt)) ||
    Number.isNaN(Date.parse(migration.completedAt)) ||
    Date.parse(migration.completedAt) < Date.parse(migration.startedAt) ||
    validation.systemTableCount !== plan.expected.systemTableCount ||
    validation.tenantTableCount !== plan.expected.tenantTableCount ||
    !Array.isArray(validation.identityCounts) ||
    validation.identityCounts.length !== 4 ||
    validation.identityCounts.some(
      (count, index) => count !== plan.expected.identityCounts[index],
    ) ||
    validation.accountingGuard !== 'passed'
  ) refuse('E_RECEIPT_IDENTITY', 'Migration receipt identity is invalid.');
  if (
    deploymentReceipt.schemaVersion !== 1 ||
    deploymentReceipt.project !== 'easyfire-bookkeeping' ||
    deploymentReceipt.deploymentId !== plan.deploymentId ||
    deploymentReceipt.releaseCommit !== plan.releaseCommit ||
    deploymentReceipt.releaseManifestSha256 !== plan.releaseManifest.sha256 ||
    deploymentReceipt.checkpointManifestSha256 !== plan.checkpoint.manifestSha256 ||
    deploymentReceipt.environmentSha256 !== plan.environment.sha256 ||
    deploymentReceipt.deploymentPlanSha256 !== inputs.planSha256 ||
    deploymentReceipt.migrationReceiptSha256 !== migrationReceiptSha256 ||
    deploymentReceipt.status !== 'complete' ||
    Number.isNaN(Date.parse(deploymentReceipt.completedAt))
  ) refuse('E_RECEIPT_IDENTITY', 'Deployment receipt identity is invalid.');

  assertExactDocumentKeys(authority, [
    'schemaVersion', 'project', 'deploymentId', 'status', 'createdAt',
    'planSha256', 'releaseCommit', 'inputSha256', 'dockerEngine',
  ], 'Deployment authority journal');
  assertExactDocumentKeys(evidence, [
    'schemaVersion', 'project', 'deploymentId', 'status', 'validatedAt',
    'releaseCommit', 'planSha256', 'migrationReceiptSha256',
    'runtimeManifestSha256', 'runtimeIdentityEvidenceSha256', 'inputSha256',
    'composeConfigSha256', 'dockerEngine', 'resources', 'images',
    'restoredDataProof', 'migratedDataProof', 'httpProof',
  ], 'Deployment evidence journal');
  if (
    authority.schemaVersion !== 1 ||
    authority.project !== PROJECT ||
    authority.deploymentId !== plan.deploymentId ||
    authority.status !== 'claimed' ||
    authority.planSha256 !== inputs.planSha256 ||
    authority.releaseCommit !== plan.releaseCommit ||
    evidence.schemaVersion !== 1 ||
    evidence.project !== PROJECT ||
    evidence.deploymentId !== plan.deploymentId ||
    evidence.status !== 'candidate-validated' ||
    evidence.releaseCommit !== plan.releaseCommit ||
    evidence.planSha256 !== inputs.planSha256 ||
    evidence.migrationReceiptSha256 !== migrationReceiptSha256 ||
    Number.isNaN(Date.parse(authority.createdAt)) ||
    Number.isNaN(Date.parse(evidence.validatedAt))
  ) refuse('E_JOURNAL_IDENTITY', 'Deployment journal identity is invalid.');
  const inputHashes = {
    releaseManifest: plan.releaseManifest.sha256,
    sourceArchive: plan.sourceArchive.sha256,
    imageBundle: plan.imageBundle.sha256,
    environment: plan.environment.sha256,
    checkpointManifest: plan.checkpoint.manifestSha256,
    sqlGzip: plan.checkpoint.sqlGzipSha256,
    redisRdb: plan.checkpoint.redisRdbSha256,
    runtimeManifestGenerator: inputs.runtimeManifestGeneratorSha256,
  };
  for (const [field, expected] of Object.entries(inputHashes)) {
    assertHashField(authority.inputSha256?.[field], expected, `Authority ${field}`);
    assertHashField(evidence.inputSha256?.[field], expected, `Evidence ${field}`);
  }
  assertHashField(
    evidence.inputSha256?.durableCheckpointManifest,
    plan.checkpoint.manifestSha256,
    'Durable checkpoint manifest',
  );
  for (const [composeFile, hash] of Object.entries(inputs.composeSha256)) {
    assertHashField(authority.inputSha256?.compose?.[composeFile], hash, composeFile);
    assertHashField(evidence.inputSha256?.compose?.[composeFile], hash, composeFile);
  }
  assertDockerIdentityEqual(evidence.dockerEngine, authority.dockerEngine);
  validateDataProofDocument(evidence.restoredDataProof, plan, 'Restored data proof');
  validateDataProofDocument(evidence.migratedDataProof, plan, 'Migrated data proof');
  if (
    validation.systemTableCount !== evidence.migratedDataProof.systemTableCount ||
    validation.tenantTableCount !== evidence.migratedDataProof.tenantTableCount ||
    validation.identityCounts.some(
      (count, index) => count !== evidence.migratedDataProof.identityCounts[index],
    ) ||
    !Array.isArray(evidence.httpProof) ||
    evidence.httpProof.length !== 3 ||
    evidence.httpProof.some(
      (probe, index) =>
        probe?.path !== ['/', '/api/system_db', '/api/auth/meta'][index] ||
        !Number.isInteger(probe.statusCode) ||
        probe.statusCode < 200 ||
        probe.statusCode >= 300,
    )
  ) refuse('E_DATA_PROOF', 'Deployment application proof is invalid.');

  assertExactDocumentKeys(startupGate, [
    'schemaVersion', 'project', 'deploymentId', 'status', 'authorizedAt',
    'planSha256', 'migrationReceiptSha256', 'requiredRestartPolicy', 'services',
  ], 'Startup gate authority');
  assertExactDocumentKeys(activationResult, [
    'schemaVersion', 'project', 'deploymentId', 'status', 'activatedAt',
    'planSha256', 'startupGateAuthoritySha256', 'deploymentEvidenceSha256',
    'requiredRestartPolicy', 'services', 'migration',
  ], 'Activation result');
  assertExactDocumentKeys(activationResult.migration, [
    'containerName', 'containerId', 'imageId', 'state', 'exitCode',
    'startedAt', 'completedAt', 'restartPolicy',
  ], 'Activation migration result');
  const expectedNames = LONG_RUNNING_SERVICES.map(
    (service) => SERVICE_CONTRACT[service].name,
  );
  const startupGateAuthoritySha256 = sha256Bytes(startupGateDoc.bytes);
  const deploymentEvidenceSha256 = sha256Bytes(evidenceDoc.bytes);
  if (
    startupGate.schemaVersion !== 1 ||
    startupGate.project !== PROJECT ||
    startupGate.deploymentId !== plan.deploymentId ||
    startupGate.status !== 'authorized-once' ||
    startupGate.planSha256 !== inputs.planSha256 ||
    startupGate.migrationReceiptSha256 !== migrationReceiptSha256 ||
    startupGate.requiredRestartPolicy !== 'no' ||
    Number.isNaN(Date.parse(startupGate.authorizedAt)) ||
    Date.parse(startupGate.authorizedAt) < Date.parse(migration.completedAt) ||
    !Array.isArray(startupGate.services) ||
    startupGate.services.length !== expectedNames.length ||
    startupGate.services.some((name, index) => name !== expectedNames[index]) ||
    activationResult.schemaVersion !== 1 ||
    activationResult.project !== PROJECT ||
    activationResult.deploymentId !== plan.deploymentId ||
    activationResult.status !== 'activated-validated' ||
    activationResult.planSha256 !== inputs.planSha256 ||
    activationResult.startupGateAuthoritySha256 !== startupGateAuthoritySha256 ||
    activationResult.deploymentEvidenceSha256 !== deploymentEvidenceSha256 ||
    activationResult.requiredRestartPolicy !== 'no' ||
    Number.isNaN(Date.parse(activationResult.activatedAt)) ||
    Date.parse(activationResult.activatedAt) < Date.parse(evidence.validatedAt) ||
    !Array.isArray(activationResult.services) ||
    activationResult.services.length !== LONG_RUNNING_SERVICES.length ||
    Date.parse(deploymentReceipt.completedAt) < Date.parse(activationResult.activatedAt)
  ) refuse('E_ACTIVATION_AUTHORITY', 'Startup activation evidence is invalid.');
  for (let index = 0; index < LONG_RUNNING_SERVICES.length; index += 1) {
    const service = LONG_RUNNING_SERVICES[index];
    const entry = activationResult.services[index];
    assertExactDocumentKeys(entry, [
      'service', 'containerName', 'containerId', 'imageId', 'state',
      'health', 'restartPolicy',
    ], `Activation service ${service}`);
    if (
      entry.service !== service ||
      entry.containerName !== SERVICE_CONTRACT[service].name ||
      !/^[a-f0-9]{64}$/.test(entry.containerId ?? '') ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.imageId ?? '') ||
      entry.state !== 'running' ||
      entry.health !== 'healthy' ||
      entry.restartPolicy !== 'no'
    ) refuse('E_ACTIVATION_AUTHORITY', `Activation service ${service} is invalid.`);
  }
  const activationMigration = activationResult.migration;
  if (
    activationMigration.containerName !== migration.containerName ||
    activationMigration.containerId !== migration.containerId ||
    activationMigration.imageId !== migration.imageId ||
    activationMigration.state !== 'exited' ||
    activationMigration.exitCode !== 0 ||
    activationMigration.startedAt !== migration.startedAt ||
    activationMigration.completedAt !== migration.completedAt ||
    activationMigration.restartPolicy !== 'no'
  ) refuse('E_ACTIVATION_AUTHORITY', 'Activation migration proof is invalid.');
  return {
    migration,
    deploymentReceipt,
    evidence,
    activationResult,
    deploymentReceiptSha256: sha256Bytes(deploymentDoc.bytes),
  };
};


export const assertHashField = (actual, expected, label) => {
  if (
    typeof actual !== 'string' ||
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  ) {
    refuse('E_RECEIPT_HASH', `${label} does not match its bound SHA-256.`);
  }
};
export const assertDockerIdentityEqual = (actual, expected) => {
  for (const key of [
    'id',
    'name',
    'osType',
    'architecture',
    'dockerRootDir',
    'serverVersion',
    'apiVersion',
    'composeVersion',
  ]) {
    if (actual[key] !== expected?.[key]) {
      refuse('E_DOCKER_DRIFT', 'Docker engine identity drifted from its receipt.');
    }
  }
};
