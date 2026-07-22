#!/usr/bin/env node

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateCutoverPlan,
  validateSourceQuiesceReceipt,
  validateSourceSnapshot,
} from './direct-vm-cutover-contract.mjs';
import {
  buildFinalQuiescenceAuthority,
  FINAL_RECEIPT_RELATIVE_PATH,
} from './linux-final-quiescence-contract.mjs';

const AUTHORITY_TYPE = 'easyfire-bookkeeping-windows-checkpoint-transfer';
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const CHECKPOINT_ID = /^direct-vm-preflight-([0-9]{8}-[0-9]{6})$/;

export class CheckpointAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CheckpointAuthorityError';
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new CheckpointAuthorityError(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value, label) => {
  if (!isObject(value)) refuse('E_DOCUMENT_SHAPE', `${label} must be an object.`);
  return value;
};
const exactKeys = (value, expected, label) => {
  object(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    refuse('E_DOCUMENT_SHAPE', `${label} has unexpected or missing fields.`);
  }
};
const string = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    refuse('E_DOCUMENT_VALUE', `${label} is invalid.`);
  }
  return value;
};
const integer = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    refuse('E_DOCUMENT_VALUE', `${label} is invalid.`);
  }
  return value;
};
const lowerSha = (value, label) => string(value, SHA256, label).toLowerCase();
const safeText = (value, label) =>
  string(value, /^[^\u0000-\u001f\u007f]{1,512}$/, label);

const parseJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    refuse('E_JSON', `${label} is not valid JSON.`);
  }
};
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashFile = async (filePath) => {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
};
const equalHash = (actual, expected) =>
  actual.length === expected.length &&
  timingSafeEqual(Buffer.from(actual), Buffer.from(expected));

const portableRelativePath = (value, label) => {
  string(value, /^.{1,4096}$/, label);
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    refuse('E_MANIFEST_PATH', `${label} is not a contained relative path.`);
  }
  return normalized;
};
const isContained = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const verifiedCheckpointDirectories = new Set();
const secureInput = async (rootReal, portablePath, { maxBytes } = {}) => {
  const parts = portablePath.split('/');
  let directory = rootReal;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    const cacheKey =
      process.platform === 'win32' ? directory.toLowerCase() : directory;
    if (!verifiedCheckpointDirectories.has(cacheKey)) {
      const directoryMetadata = await lstat(directory).catch(() => null);
      if (!directoryMetadata?.isDirectory() || directoryMetadata.isSymbolicLink()) {
        refuse(
          'E_INPUT_FILE',
          `Checkpoint path traverses an unsafe directory: ${portablePath}.`,
        );
      }
      verifiedCheckpointDirectories.add(cacheKey);
    }
  }
  const diskPath = path.join(directory, parts.at(-1));
  const metadata = await lstat(diskPath).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    refuse('E_INPUT_FILE', `Required checkpoint file is missing or unsafe: ${portablePath}.`);
  }
  if (maxBytes !== undefined && metadata.size > maxBytes) {
    refuse('E_INPUT_FILE', `Required checkpoint file is too large: ${portablePath}.`);
  }
  return { diskPath, metadata };
};
const readJsonInput = async (rootReal, portablePath, label) => {
  const input = await secureInput(rootReal, portablePath, {
    maxBytes: MAX_JSON_BYTES,
  });
  const bytes = await readFile(input.diskPath);
  return { ...input, bytes, value: parseJson(bytes, label) };
};
const readAbsoluteJsonInput = async (filePath, label) => {
  if (!path.isAbsolute(filePath)) {
    refuse('E_PATH', `${label} path must be absolute.`);
  }
  const metadata = await lstat(filePath).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MAX_JSON_BYTES
  ) {
    refuse('E_INPUT_FILE', `${label} is missing, unsafe, or too large.`);
  }
  const bytes = await readFile(filePath);
  return { diskPath: filePath, metadata, bytes, value: parseJson(bytes, label) };
};

const verifyManifest = async (rootReal, document) => {
  if (!Array.isArray(document) || document.length < 1) {
    refuse('E_FILE_MANIFEST', 'files.sha256.json must contain entries.');
  }
  const entries = new Map();
  const pendingVerification = [];
  let totalBytes = 0;
  for (const [index, raw] of document.entries()) {
    exactKeys(raw, ['Path', 'Bytes', 'Sha256'], `File manifest entry ${index}`);
    const portablePath = portableRelativePath(raw.Path, `File manifest entry ${index} Path`);
    const key = portablePath.toLowerCase();
    if (entries.has(key)) {
      refuse('E_DUPLICATE_FILE', `File manifest contains duplicate path: ${portablePath}.`);
    }
    const expectedBytes = integer(raw.Bytes, `File manifest entry ${index} Bytes`);
    const expectedSha256 = lowerSha(raw.Sha256, `File manifest entry ${index} Sha256`);
    entries.set(key, {
      sourceRelativePath: portablePath,
      bytes: expectedBytes,
      sha256: expectedSha256,
    });
    pendingVerification.push({ portablePath, expectedBytes, expectedSha256 });
    totalBytes += expectedBytes;
    if (!Number.isSafeInteger(totalBytes)) {
      refuse('E_FILE_BYTES', 'File manifest byte total exceeds the safe integer range.');
    }
  }
  let cursor = 0;
  const verifyNext = async () => {
    while (cursor < pendingVerification.length) {
      const candidate = pendingVerification[cursor];
      cursor += 1;
      const input = await secureInput(rootReal, candidate.portablePath);
      if (input.metadata.size !== candidate.expectedBytes) {
        refuse(
          'E_FILE_BYTES',
          `File bytes do not match the manifest: ${candidate.portablePath}.`,
        );
      }
      const actualSha256 = await hashFile(input.diskPath);
      if (!equalHash(actualSha256, candidate.expectedSha256)) {
        refuse(
          'E_FILE_HASH',
          `File SHA-256 does not match the manifest: ${candidate.portablePath}.`,
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(16, pendingVerification.length) },
      () => verifyNext(),
    ),
  );
  return { entries, totalBytes };
};
const entry = (manifest, relativePath) => {
  const found = manifest.entries.get(relativePath.toLowerCase());
  if (!found) refuse('E_FILE_MANIFEST', `Required manifest entry is absent: ${relativePath}.`);
  return found;
};

const requireUnique = (values, predicate, label) => {
  if (!Array.isArray(values)) refuse('E_DOCUMENT_SHAPE', `${label} must be an array.`);
  const found = values.filter(predicate);
  if (found.length !== 1) refuse('E_RUNTIME_AUTHORITY', `${label} must occur exactly once.`);
  return found[0];
};
const validateIdentity = (value, role) => {
  exactKeys(
    value,
    ['Container', 'ImageId', 'ImageRef', 'RestartPolicy', 'Running', 'Health'],
    `${role} container identity`,
  );
  const expectedName = `easyfire-${role}`;
  const imageReferencePattern =
    role === 'mysql'
      ? /^easyfire-bookkeeping\/mariadb:[A-Za-z0-9._-]+$/
      : /^easyfire-bookkeeping\/redis:[A-Za-z0-9._-]+$/;
  if (
    value.Container !== expectedName ||
    !IMAGE_ID.test(value.ImageId) ||
    !imageReferencePattern.test(value.ImageRef) ||
    value.RestartPolicy !== 'unless-stopped' ||
    value.Running !== 'true' ||
    value.Health !== 'healthy'
  ) {
    refuse('E_RUNTIME_AUTHORITY', `${role} container identity is invalid.`);
  }
  return value;
};
const extractRuntime = (restricted, identity, role) => {
  const containerName = `easyfire-${role}`;
  const volumeName = `easyfire_prod_${role}`;
  const destination = role === 'mysql' ? '/var/lib/mysql' : '/data';
  const container = requireUnique(
    restricted,
    (candidate) => candidate?.Name === `/${containerName}`,
    `${role} restricted container`,
  );
  const mount = requireUnique(
    container.Mounts,
    (candidate) =>
      candidate?.Type === 'volume' &&
      candidate?.Name === volumeName &&
      candidate?.Destination === destination &&
      candidate?.RW === true,
    `${role} durable mount`,
  );
  void mount;
  if (
    !CONTAINER_ID.test(container.Id) ||
    !IMAGE_ID.test(container.Image) ||
    container.Image !== identity.ImageId ||
    container.Config?.Image !== identity.ImageRef ||
    container.Config?.Labels?.['com.docker.compose.project'] !==
      'easyfire-bookkeeping-prod' ||
    container.Config?.Labels?.['com.docker.compose.service'] !== role ||
    container.HostConfig?.RestartPolicy?.Name !== 'unless-stopped' ||
    !Array.isArray(container.HostConfig?.Binds) ||
    !container.HostConfig.Binds.includes(`${volumeName}:${destination}:rw`)
  ) {
    refuse('E_RUNTIME_AUTHORITY', `${role} restricted runtime identity is invalid.`);
  }
  return {
    containerName,
    containerId: container.Id,
    imageId: container.Image,
    imageReference: identity.ImageRef,
    volumeName,
  };
};
const validateVolume = (document, role) => {
  const volumeName = `easyfire_prod_${role}`;
  if (
    !Array.isArray(document) ||
    document.length !== 1 ||
    document[0]?.Name !== volumeName ||
    document[0]?.Driver !== 'local' ||
    document[0]?.Scope !== 'local' ||
    document[0]?.Labels?.['com.docker.compose.project'] !==
      'easyfire-bookkeeping-prod' ||
    document[0]?.Labels?.['com.docker.compose.volume'] !== role
  ) {
    refuse('E_RUNTIME_AUTHORITY', `${role} source volume authority is invalid.`);
  }
};

const time = (value, label) => {
  string(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) refuse('E_TIMESTAMP', `${label} is invalid.`);
  return parsed;
};
const pathEndsWithCheckpoint = (value, checkpointId, label) => {
  safeText(value, label);
  if (value.replaceAll('\\', '/').split('/').at(-1) !== checkpointId) {
    refuse('E_CHECKPOINT_BINDING', `${label} does not identify the checkpoint.`);
  }
  return value;
};

const writeExclusive = async (target, bytes) => {
  if (!path.isAbsolute(target)) refuse('E_OUTPUT_PATH', 'Output path must be absolute.');
  const parent = await realpath(path.dirname(target)).catch(() => null);
  if (!parent) refuse('E_OUTPUT_PATH', 'Output directory does not exist.');
  const finalPath = path.join(parent, path.basename(target));
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  let temporaryExists = false;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    temporaryExists = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, finalPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        refuse('E_OUTPUT_EXISTS', 'Checkpoint authority output already exists; exclusive emit refused.');
      }
      throw error;
    }
    await chmod(finalPath, 0o600);
    await unlink(temporary);
    temporaryExists = false;
    return finalPath;
  } finally {
    await handle?.close().catch(() => {});
    if (temporaryExists) await unlink(temporary).catch(() => {});
  }
};

const validateFinalQuiescence = async ({
  rootReal,
  manifest,
  checkpoint,
  identities,
  restricted,
  mysql,
  redis,
  quiesceReceiptPath,
  cutoverPlanPath,
  sourceSnapshotPath,
}) => {
  const [planDocument, receiptDocument, snapshotDocument, copiedReceiptDocument] =
    await Promise.all([
      readAbsoluteJsonInput(cutoverPlanPath, 'Cutover plan'),
      readAbsoluteJsonInput(quiesceReceiptPath, 'Source quiesce receipt'),
      readAbsoluteJsonInput(sourceSnapshotPath, 'Post-quiesce source snapshot'),
      readJsonInput(
        rootReal,
        FINAL_RECEIPT_RELATIVE_PATH,
        'Checkpoint source quiesce receipt',
      ),
    ]);
  const plan = validateCutoverPlan(planDocument.value);
  const receipt = validateSourceQuiesceReceipt(
    receiptDocument.value,
    plan,
    hashBytes(planDocument.bytes),
  );
  const snapshot = validateSourceSnapshot(
    snapshotDocument.value,
    plan,
    'post-quiesce',
  );
  return buildFinalQuiescenceAuthority({
    checkpoint,
    identities,
    restricted,
    mysql,
    redis,
    planDocument: { ...planDocument, value: plan },
    receiptDocument: { ...receiptDocument, value: receipt },
    snapshotDocument: { ...snapshotDocument, value: snapshot },
    copiedReceiptDocument,
    receiptEntry: entry(manifest, FINAL_RECEIPT_RELATIVE_PATH),
  });
};

export async function inspectCheckpointTransferAuthority({
  checkpointRoot,
  quiesceReceiptPath,
  cutoverPlanPath,
  sourceSnapshotPath,
}) {
  const finalInputs = [
    quiesceReceiptPath,
    cutoverPlanPath,
    sourceSnapshotPath,
  ];
  const finalMode = finalInputs.some((value) => value !== undefined);
  if (
    finalMode &&
    finalInputs.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    refuse(
      'E_ARGUMENTS',
      'Final mode requires --quiesce-receipt, --cutover-plan, and --source-snapshot together.',
    );
  }
  if (!path.isAbsolute(checkpointRoot)) {
    refuse('E_PATH', 'Checkpoint root must be absolute.');
  }
  const rootMetadata = await lstat(checkpointRoot).catch(() => null);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
    refuse('E_CHECKPOINT_ROOT', 'Checkpoint root must be an existing real directory.');
  }
  const rootReal = await realpath(checkpointRoot);

  const checkpointDocument = await readJsonInput(rootReal, 'checkpoint.json', 'checkpoint.json');
  const checkpoint = object(checkpointDocument.value, 'checkpoint.json');
  exactKeys(
    checkpoint,
    [
      'schemaVersion', 'checkpointId', 'status', 'createdAt', 'host', 'intent',
      'liveEndpoint', 'databaseCount', 'databaseNames', 'activeContainers',
      'sourceVolumes', 'preservedRestoreContainer', 'preservedRestoreVolume',
      'secondaryCopy',
    ],
    'checkpoint.json',
  );
  const idMatch = string(checkpoint.checkpointId, CHECKPOINT_ID, 'checkpointId').match(CHECKPOINT_ID);
  const checkpointTimestamp = idMatch[1];
  if (
    path.basename(rootReal) !== checkpoint.checkpointId ||
    checkpoint.schemaVersion !== 1 ||
    checkpoint.status !== 'preflight-verified' ||
    checkpoint.host !== 'NEWSEC' ||
    checkpoint.intent !==
      'Direct-to-VM migration recovery checkpoint; no source runtime resources removed.' ||
    checkpoint.databaseCount !== 2 ||
    !Array.isArray(checkpoint.databaseNames) ||
    checkpoint.databaseNames.length !== 2 ||
    checkpoint.databaseNames[0] !== 'easyfire_system' ||
    !/^easyfire_tenant_[a-z0-9]{8,64}$/.test(checkpoint.databaseNames[1]) ||
    !Array.isArray(checkpoint.sourceVolumes) ||
    checkpoint.sourceVolumes.length !== 2 ||
    checkpoint.sourceVolumes[0] !== 'easyfire_prod_mysql' ||
    checkpoint.sourceVolumes[1] !== 'easyfire_prod_redis'
  ) {
    refuse('E_CHECKPOINT_AUTHORITY', 'Original checkpoint v1 authority is invalid.');
  }

  const manifestDocument = await readJsonInput(rootReal, 'files.sha256.json', 'files.sha256.json');
  const manifest = await verifyManifest(rootReal, manifestDocument.value);
  const checkpointEntry = entry(manifest, 'checkpoint.json');
  if (
    checkpointEntry.bytes !== checkpointDocument.metadata.size ||
    checkpointEntry.sha256 !== hashBytes(checkpointDocument.bytes)
  ) {
    refuse('E_CHECKPOINT_BINDING', 'Original checkpoint does not match its file manifest.');
  }

  const databaseEntries = [...manifest.entries.values()].filter((candidate) =>
    candidate.sourceRelativePath.startsWith('database/'),
  );
  const sqlEntry = requireUnique(
    databaseEntries,
    (candidate) => candidate.sourceRelativePath.endsWith('.sql.gz'),
    'SQL checkpoint payload',
  );
  const redisEntry = requireUnique(
    databaseEntries,
    (candidate) => candidate.sourceRelativePath.endsWith('.rdb'),
    'Redis checkpoint payload',
  );
  const sqlName = `easyfire-app-${checkpointTimestamp}.sql.gz`;
  const redisName = `easyfire-redis-${checkpointTimestamp}.rdb`;
  if (
    sqlEntry.sourceRelativePath !== `database/${sqlName}` ||
    redisEntry.sourceRelativePath !== `database/${redisName}`
  ) {
    refuse('E_CHECKPOINT_BINDING', 'Payload filename timestamp does not match the checkpoint.');
  }
  const databaseDiskEntries = await readdir(path.join(rootReal, 'database'), {
    withFileTypes: true,
  });
  if (
    databaseDiskEntries.length !== 2 ||
    databaseDiskEntries.some((candidate) => !candidate.isFile()) ||
    !databaseDiskEntries.some((candidate) => candidate.name === sqlName) ||
    !databaseDiskEntries.some((candidate) => candidate.name === redisName)
  ) {
    refuse('E_DUPLICATE_FILE', 'Checkpoint database payload directory is not exact.');
  }

  const restoreDocument = await readJsonInput(
    rootReal,
    'restore-proof/isolated-restore-proof.json',
    'isolated restore proof',
  );
  const restore = object(restoreDocument.value, 'isolated restore proof');
  exactKeys(
    restore,
    [
      'schemaVersion', 'status', 'createdAt', 'sourceHost', 'sourceContainer',
      'sourceImage', 'sourceVolume', 'databases', 'backupFile', 'backupBytes',
      'backupSha256', 'redisFile', 'redisBytes', 'redisSha256', 'restoreContainer',
      'restoreVolume', 'restoreNetwork', 'restoreState', 'schemaTableCounts',
      'identityInvariants', 'mariadbCheckLineCount',
    ],
    'isolated restore proof',
  );
  const restoreEntry = entry(manifest, 'restore-proof/isolated-restore-proof.json');
  if (
    restoreEntry.bytes !== restoreDocument.metadata.size ||
    restoreEntry.sha256 !== hashBytes(restoreDocument.bytes) ||
    restore.schemaVersion !== 1 ||
    restore.status !== 'passed' ||
    restore.sourceHost !== 'NEWSEC' ||
    restore.sourceContainer !== 'easyfire-mysql' ||
    restore.sourceVolume !== 'easyfire_prod_mysql' ||
    restore.backupFile !== sqlName ||
    restore.backupBytes !== sqlEntry.bytes ||
    lowerSha(restore.backupSha256, 'restore backup SHA-256') !== sqlEntry.sha256 ||
    restore.redisFile !== redisName ||
    restore.redisBytes !== redisEntry.bytes ||
    lowerSha(restore.redisSha256, 'restore Redis SHA-256') !== redisEntry.sha256 ||
    restore.restoreContainer !== `easyfire-direct-vm-restore-${checkpointTimestamp}` ||
    restore.restoreVolume !== `easyfire_direct_vm_restore_${checkpointTimestamp.replaceAll('-', '_')}` ||
    checkpoint.preservedRestoreContainer !== restore.restoreContainer ||
    checkpoint.preservedRestoreVolume !== restore.restoreVolume ||
    restore.restoreNetwork !== 'none' ||
    restore.restoreState !== 'stopped-preserved' ||
    JSON.stringify(restore.databases) !== JSON.stringify(checkpoint.databaseNames) ||
    JSON.stringify(restore.schemaTableCounts) !==
      JSON.stringify([
        `${checkpoint.databaseNames[0]}\t17`,
        `${checkpoint.databaseNames[1]}\t70`,
      ]) ||
    restore.identityInvariants !==
      'users=1;tenants=1;tenant_metadata=1;user_tenants=1' ||
    !Number.isSafeInteger(restore.mariadbCheckLineCount) ||
    restore.mariadbCheckLineCount < 1
  ) {
    refuse('E_RESTORE_PROOF', 'Isolated restore proof does not match checkpoint payload authority.');
  }

  const identitiesDocument = await readJsonInput(
    rootReal,
    'runtime/container-identities.json',
    'runtime container identities',
  );
  entry(manifest, 'runtime/container-identities.json');
  const mysqlIdentity = validateIdentity(
    requireUnique(identitiesDocument.value, (value) => value?.Container === 'easyfire-mysql', 'MySQL identity'),
    'mysql',
  );
  const redisIdentity = validateIdentity(
    requireUnique(identitiesDocument.value, (value) => value?.Container === 'easyfire-redis', 'Redis identity'),
    'redis',
  );
  for (const [role, identity] of [['mysql', mysqlIdentity], ['redis', redisIdentity]]) {
    const checkpointIdentity = validateIdentity(
      requireUnique(checkpoint.activeContainers, (value) => value?.Container === `easyfire-${role}`, `${role} checkpoint identity`),
      role,
    );
    if (JSON.stringify(checkpointIdentity) !== JSON.stringify(identity)) {
      refuse('E_RUNTIME_AUTHORITY', `${role} checkpoint and runtime identities differ.`);
    }
  }
  const restrictedDocument = await readJsonInput(
    rootReal,
    'runtime/containers.restricted.json',
    'restricted container evidence',
  );
  entry(manifest, 'runtime/containers.restricted.json');
  if (!Array.isArray(restrictedDocument.value)) {
    refuse('E_RUNTIME_AUTHORITY', 'Restricted container evidence must be an array.');
  }
  const mysql = extractRuntime(restrictedDocument.value, mysqlIdentity, 'mysql');
  const redis = extractRuntime(restrictedDocument.value, redisIdentity, 'redis');
  if (restore.sourceImage !== mysql.imageId) {
    refuse('E_RESTORE_PROOF', 'Restore source image does not match exact MySQL authority.');
  }

  for (const role of ['mysql', 'redis']) {
    const relativePath = `runtime/easyfire_prod_${role}.json`;
    const volumeDocument = await readJsonInput(rootReal, relativePath, `${role} volume evidence`);
    entry(manifest, relativePath);
    validateVolume(volumeDocument.value, role);
  }

  const finalQuiescence = finalMode
    ? await validateFinalQuiescence({
        rootReal,
        manifest,
        checkpoint,
        identities: identitiesDocument.value,
        restricted: restrictedDocument.value,
        mysql,
        redis,
        quiesceReceiptPath,
        cutoverPlanPath,
        sourceSnapshotPath,
      })
    : undefined;

  const dualDocument = await readJsonInput(
    rootReal,
    'dual-location-verification.json',
    'dual-location verification',
  );
  const dual = object(dualDocument.value, 'dual-location verification');
  exactKeys(
    dual,
    ['schemaVersion', 'status', 'verifiedAt', 'primary', 'secondary', 'fileCount', 'totalBytes', 'checkpointSha256'],
    'dual-location verification',
  );
  if (
    dual.schemaVersion !== 1 ||
    dual.status !== 'passed' ||
    dual.primary === dual.secondary ||
    pathEndsWithCheckpoint(dual.primary, checkpoint.checkpointId, 'dual primary') !== dual.primary ||
    pathEndsWithCheckpoint(dual.secondary, checkpoint.checkpointId, 'dual secondary') !== dual.secondary ||
    dual.fileCount !== manifest.entries.size + 1 ||
    dual.totalBytes !== manifest.totalBytes + manifestDocument.metadata.size ||
    lowerSha(dual.checkpointSha256, 'dual checkpoint SHA-256') !== checkpointEntry.sha256 ||
    checkpoint.secondaryCopy !== dual.secondary
  ) {
    refuse('E_DUAL_LOCATION', 'Dual-location verification does not bind the checkpoint root.');
  }

  const recoveryDocument = await readJsonInput(
    rootReal,
    'recovery-unit-verification-v2.json',
    'recovery-unit verification',
  );
  const recovery = object(recoveryDocument.value, 'recovery-unit verification');
  exactKeys(
    recovery,
    [
      'schemaVersion', 'status', 'verifiedAt', 'primary', 'secondary',
      'priorDualLocationVerificationSha256', 'priorFileManifestSha256',
      'restoreInstructionsSha256', 'databaseBackupSha256',
      'isolatedRestoreProof', 'sourceRuntime',
    ],
    'recovery-unit verification',
  );
  const restoreInstructions = await secureInput(rootReal, 'RESTORE.md');
  const restoreInstructionsSha256 = await hashFile(restoreInstructions.diskPath);
  if (
    recovery.schemaVersion !== 2 ||
    recovery.status !== 'passed' ||
    recovery.primary !== dual.primary ||
    recovery.secondary !== dual.secondary ||
    lowerSha(recovery.priorDualLocationVerificationSha256, 'prior dual SHA-256') !==
      hashBytes(dualDocument.bytes) ||
    lowerSha(recovery.priorFileManifestSha256, 'prior file manifest SHA-256') !==
      hashBytes(manifestDocument.bytes) ||
    lowerSha(recovery.restoreInstructionsSha256, 'restore instructions SHA-256') !==
      restoreInstructionsSha256 ||
    lowerSha(recovery.databaseBackupSha256, 'database backup SHA-256') !==
      sqlEntry.sha256 ||
    recovery.isolatedRestoreProof !== 'passed' ||
    recovery.sourceRuntime !== 'preserved'
  ) {
    refuse('E_RECOVERY_UNIT', 'Recovery-unit verification does not bind preserved source authority.');
  }

  const restoredAt = time(restore.createdAt, 'restore createdAt');
  const checkpointAt = time(checkpoint.createdAt, 'checkpoint createdAt');
  const dualAt = time(dual.verifiedAt, 'dual verifiedAt');
  const recoveryAt = time(recovery.verifiedAt, 'recovery verifiedAt');
  if (!(restoredAt <= checkpointAt && checkpointAt <= dualAt && dualAt <= recoveryAt)) {
    refuse('E_TIMESTAMP', 'Checkpoint proof timestamps are not monotonic.');
  }

  const authority = {
    schemaVersion: 2,
    authorityType: AUTHORITY_TYPE,
    status: 'verified',
    checkpointId: checkpoint.checkpointId,
    checkpointTimestamp,
    checkpointCreatedAt: checkpoint.createdAt,
    source: {
      host: 'NEWSEC',
      runtimePreservation: 'preserved',
      databaseNames: [...checkpoint.databaseNames],
      mysql,
      redis,
    },
    payloads: {
      sqlGzip: {
        sourceRelativePath: sqlEntry.sourceRelativePath,
        fileName: sqlName,
        bytes: sqlEntry.bytes,
        sha256: sqlEntry.sha256,
      },
      redisRdb: {
        sourceRelativePath: redisEntry.sourceRelativePath,
        fileName: redisName,
        bytes: redisEntry.bytes,
        sha256: redisEntry.sha256,
      },
    },
    isolatedRestore: {
      status: 'passed',
      proof: {
        sourceRelativePath: restoreEntry.sourceRelativePath,
        bytes: restoreEntry.bytes,
        sha256: restoreEntry.sha256,
      },
      network: 'none',
      state: 'stopped-preserved',
      restoreContainer: restore.restoreContainer,
      restoreVolume: restore.restoreVolume,
      systemTableCount: 17,
      tenantTableCount: 70,
      identityCounts: {
        users: 1,
        tenants: 1,
        tenantMetadata: 1,
        userTenants: 1,
      },
      mariadbCheckLineCount: restore.mariadbCheckLineCount,
    },
    verification: {
      originalCheckpoint: {
        sourceRelativePath: 'checkpoint.json',
        bytes: checkpointEntry.bytes,
        sha256: checkpointEntry.sha256,
      },
      fileManifest: {
        sourceRelativePath: 'files.sha256.json',
        bytes: manifestDocument.metadata.size,
        sha256: hashBytes(manifestDocument.bytes),
        entryCount: manifest.entries.size,
        entryBytes: manifest.totalBytes,
      },
      restoreInstructions: {
        sourceRelativePath: 'RESTORE.md',
        bytes: restoreInstructions.metadata.size,
        sha256: restoreInstructionsSha256,
      },
      dualLocation: {
        sourceRelativePath: 'dual-location-verification.json',
        bytes: dualDocument.metadata.size,
        sha256: hashBytes(dualDocument.bytes),
        status: 'passed',
        verifiedAt: dual.verifiedAt,
        primary: dual.primary,
        secondary: dual.secondary,
        fileCount: dual.fileCount,
        totalBytes: dual.totalBytes,
      },
      recoveryUnit: {
        sourceRelativePath: 'recovery-unit-verification-v2.json',
        bytes: recoveryDocument.metadata.size,
        sha256: hashBytes(recoveryDocument.bytes),
        status: 'passed',
        verifiedAt: recovery.verifiedAt,
        sourceRuntime: 'preserved',
      },
    },
  };
  if (finalQuiescence) authority.finalQuiescence = finalQuiescence;
  return authority;
}

export async function produceCheckpointTransferAuthority({
  checkpointRoot,
  outputPath,
  quiesceReceiptPath,
  cutoverPlanPath,
  sourceSnapshotPath,
}) {
  if (!path.isAbsolute(checkpointRoot) || !path.isAbsolute(outputPath)) {
    refuse('E_PATH', 'Checkpoint root and output path must be absolute.');
  }
  const rootReal = await realpath(checkpointRoot).catch(() => null);
  const outputParent = await realpath(path.dirname(outputPath)).catch(() => null);
  if (
    !rootReal ||
    !outputParent ||
    isContained(rootReal, path.join(outputParent, path.basename(outputPath)))
  ) {
    refuse('E_OUTPUT_PATH', 'Output must be outside the preserved checkpoint root.');
  }
  const authority = await inspectCheckpointTransferAuthority({
    checkpointRoot,
    quiesceReceiptPath,
    cutoverPlanPath,
    sourceSnapshotPath,
  });
  await writeExclusive(
    outputPath,
    Buffer.from(`${JSON.stringify(authority, null, 2)}\n`),
  );
  return authority;
}

const parseArguments = (arguments_) => {
  if (arguments_.length === 1 && arguments_[0] === '--help') return { help: true };
  if (![4, 10].includes(arguments_.length)) {
    refuse(
      'E_ARGUMENTS',
      'Use --checkpoint-root <absolute-path> --output <absolute-path> [--quiesce-receipt <absolute-path> --cutover-plan <absolute-path> --source-snapshot <absolute-path>].',
    );
  }
  const values = new Map();
  const allowed = [
    '--checkpoint-root',
    '--output',
    '--quiesce-receipt',
    '--cutover-plan',
    '--source-snapshot',
  ];
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    if (!allowed.includes(name) || values.has(name)) {
      refuse(
        'E_ARGUMENTS',
        'Use --checkpoint-root <absolute-path> --output <absolute-path> [--quiesce-receipt <absolute-path> --cutover-plan <absolute-path> --source-snapshot <absolute-path>].',
      );
    }
    values.set(name, arguments_[index + 1]);
  }
  const finalArguments = [
    '--quiesce-receipt',
    '--cutover-plan',
    '--source-snapshot',
  ];
  if (
    !values.has('--checkpoint-root') ||
    !values.has('--output') ||
    finalArguments.some((name) => values.has(name)) !==
      finalArguments.every((name) => values.has(name))
  ) {
    refuse(
      'E_ARGUMENTS',
      'Final mode requires --quiesce-receipt, --cutover-plan, and --source-snapshot together.',
    );
  }
  return {
    checkpointRoot: values.get('--checkpoint-root'),
    outputPath: values.get('--output'),
    quiesceReceiptPath: values.get('--quiesce-receipt'),
    cutoverPlanPath: values.get('--cutover-plan'),
    sourceSnapshotPath: values.get('--source-snapshot'),
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    if (arguments_.help) {
      process.stdout.write(
        'Usage: node linux-checkpoint-authority-v2.mjs --checkpoint-root <absolute-path> --output <absolute-path> [--quiesce-receipt <absolute-path> --cutover-plan <absolute-path> --source-snapshot <absolute-path>]\n',
      );
    } else {
      const authority = await produceCheckpointTransferAuthority(arguments_);
      process.stdout.write(
        `CHECKPOINT_AUTHORITY_V2_WRITTEN=${authority.checkpointId}\n`,
      );
    }
  } catch (error) {
    const code = error instanceof CheckpointAuthorityError ? error.code : 'E_UNEXPECTED';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
