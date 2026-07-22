import { validateFinalQuiescenceAuthority } from './linux-final-quiescence-contract.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY = /(?:password|secret|token|credential)/i;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};
const object = (value, label) => {
  if (!isObject(value)) refuse('E_SHAPE', `${label} must be an object.`);
  return value;
};
const exactKeys = (value, keys, label) => {
  object(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    refuse('E_KEYS', `${label} has missing or unexpected fields.`);
  }
};
const string = (value, label, pattern) => {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    refuse('E_VALUE', `${label} is invalid.`);
  }
};
const integer = (value, label, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) refuse('E_VALUE', `${label} is invalid.`);
};
const date = (value, label) => {
  string(value, label);
  if (Number.isNaN(Date.parse(value))) refuse('E_TIME', `${label} is invalid.`);
};
const hash = (value, label) => string(value, label, SHA256);
const rejectSensitiveKeys = (value, trail = 'document') => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveKeys(entry, `${trail}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) refuse('E_SECRET_FIELD', `${trail} contains a forbidden field.`);
    rejectSensitiveKeys(child, `${trail}.${key}`);
  }
};
const validateFileRecord = (candidate, label, extraKeys = []) => {
  exactKeys(candidate, ['sourceRelativePath', 'bytes', 'sha256', ...extraKeys], label);
  string(candidate.sourceRelativePath, `${label} sourceRelativePath`);
  integer(candidate.bytes, `${label} bytes`, 1);
  hash(candidate.sha256, `${label} sha256`);
};

export function validateCheckpointV2Document(checkpointCandidate, plan, expectedFinalQuiescence) {
  const checkpoint = object(checkpointCandidate, 'Checkpoint v2');
  rejectSensitiveKeys(checkpoint);
  const checkpointKeys = [
    'schemaVersion', 'authorityType', 'status', 'checkpointId', 'checkpointTimestamp',
    'checkpointCreatedAt', 'source', 'payloads', 'isolatedRestore', 'verification',
  ];
  const hasFinalQuiescence = Object.hasOwn(checkpoint, 'finalQuiescence');
  if (hasFinalQuiescence) checkpointKeys.push('finalQuiescence');
  exactKeys(checkpoint, checkpointKeys, 'Checkpoint v2');
  if (
    checkpoint.schemaVersion !== 2 ||
    checkpoint.authorityType !== 'easyfire-bookkeeping-windows-checkpoint-transfer' ||
    checkpoint.status !== 'verified'
  ) refuse('E_CHECKPOINT_V2', 'Checkpoint-v2 identity is invalid.');
  string(checkpoint.checkpointId, 'Checkpoint-v2 id');
  string(checkpoint.checkpointTimestamp, 'Checkpoint-v2 timestamp', /^\d{8}-\d{6}$/);
  date(checkpoint.checkpointCreatedAt, 'Checkpoint-v2 createdAt');
  if (expectedFinalQuiescence !== undefined && !hasFinalQuiescence) {
    refuse('E_FINAL_QUIESCENCE', 'Final cutover binding requires final-quiescence checkpoint proof.');
  }

  const source = object(checkpoint.source, 'Checkpoint-v2 source');
  exactKeys(source, ['host', 'runtimePreservation', 'databaseNames', 'mysql', 'redis'], 'Checkpoint-v2 source');
  if (
    source.host !== 'NEWSEC' ||
    source.runtimePreservation !== 'preserved' ||
    !Array.isArray(source.databaseNames) ||
    source.databaseNames.length !== 2 ||
    source.databaseNames[0] !== 'easyfire_system' ||
    !/^easyfire_tenant_[A-Za-z0-9_]+$/.test(source.databaseNames[1])
  ) refuse('E_CHECKPOINT_SOURCE', 'Checkpoint-v2 source authority is invalid.');
  const expectedData = new Map(
    plan.source.expectedInitialSnapshot.containers
      .filter(({ tier }) => tier === 'data')
      .map((entry) => [entry.role, entry]),
  );
  for (const [role, volumeName] of [
    ['mysql', plan.source.mysqlVolume], ['redis', plan.source.redisVolume],
  ]) {
    const entry = source[role];
    exactKeys(entry, [
      'containerName', 'containerId', 'imageId', 'imageReference', 'volumeName',
    ], `Checkpoint-v2 ${role}`);
    const expected = expectedData.get(role);
    if (
      entry.containerName !== expected.name ||
      entry.containerId !== expected.id ||
      entry.imageId !== expected.imageId ||
      entry.imageReference !== expected.imageReference ||
      entry.volumeName !== volumeName
    ) refuse('E_CHECKPOINT_SOURCE', `Checkpoint-v2 ${role} authority drifted.`);
  }
  if (hasFinalQuiescence) {
    const final = validateFinalQuiescenceAuthority(checkpoint.finalQuiescence, {
      checkpointCreatedAt: checkpoint.checkpointCreatedAt,
      source,
    });
    if (final.cutoverId !== plan.cutoverId) {
      refuse('E_FINAL_QUIESCENCE_BINDING', 'Final checkpoint cutover id is not bound.');
    }
    const expectedStateless = plan.source.expectedInitialSnapshot.containers.filter(
      ({ tier }) => tier === 'stateless',
    );
    final.statelessContainers.forEach((container, index) => {
      const expected = expectedStateless[index];
      if (
        container.role !== expected.role ||
        container.name !== expected.name ||
        container.containerId !== expected.id ||
        container.imageId !== expected.imageId ||
        container.imageReference !== expected.imageReference
      ) refuse('E_FINAL_QUIESCENCE_BINDING', `Final stateless container ${index} is not plan-bound.`);
    });
    for (const [actual, wanted, label] of [
      [final.cutoverPlan.sha256, expectedFinalQuiescence?.planSha256, 'cutover plan'],
      [final.quiesceReceipt.sha256, expectedFinalQuiescence?.sourceQuiesceReceiptSha256, 'quiesce receipt'],
      [final.quiesceReceipt.contentSha256, expectedFinalQuiescence?.sourceQuiesceContentSha256, 'quiesce content'],
      [final.sourceSnapshot.sha256, expectedFinalQuiescence?.postQuiesceSnapshotSha256, 'source snapshot'],
    ]) {
      if (wanted !== undefined && actual !== wanted) {
        refuse('E_FINAL_QUIESCENCE_BINDING', `Final ${label} hash is not bound.`);
      }
    }
    if (
      expectedFinalQuiescence?.sourceQuiesceCompletedAt !== undefined &&
      final.quiesceReceipt.completedAt !== expectedFinalQuiescence.sourceQuiesceCompletedAt
    ) refuse('E_FINAL_QUIESCENCE_BINDING', 'Final quiesce completion time is not bound.');
    if (
      expectedFinalQuiescence?.postQuiesceCapturedAt !== undefined &&
      final.sourceSnapshot.capturedAt !== expectedFinalQuiescence.postQuiesceCapturedAt
    ) refuse('E_FINAL_QUIESCENCE_BINDING', 'Final source snapshot time is not bound.');
    if (
      expectedFinalQuiescence?.writerProof !== undefined &&
      Object.keys(expectedFinalQuiescence.writerProof).some(
        (key) => final.sourceSnapshot.writerProof[key] !== expectedFinalQuiescence.writerProof[key],
      )
    ) refuse('E_FINAL_QUIESCENCE_BINDING', 'Final source writer tuple is not bound.');
  }
  exactKeys(checkpoint.payloads, ['sqlGzip', 'redisRdb'], 'Checkpoint-v2 payloads');
  for (const [name, entry] of Object.entries(checkpoint.payloads)) {
    validateFileRecord(entry, `Checkpoint-v2 ${name}`, ['fileName']);
    string(entry.fileName, `Checkpoint-v2 ${name} fileName`);
  }
  const restore = checkpoint.isolatedRestore;
  exactKeys(restore, [
    'status', 'proof', 'network', 'state', 'restoreContainer', 'restoreVolume',
    'systemTableCount', 'tenantTableCount', 'identityCounts', 'mariadbCheckLineCount',
  ], 'Checkpoint-v2 isolated restore');
  validateFileRecord(restore.proof, 'Checkpoint-v2 restore proof');
  exactKeys(restore.identityCounts, [
    'users', 'tenants', 'tenantMetadata', 'userTenants',
  ], 'Checkpoint-v2 identity counts');
  if (
    restore.status !== 'passed' ||
    restore.network !== 'none' ||
    restore.state !== 'stopped-preserved' ||
    restore.systemTableCount !== 17 ||
    restore.tenantTableCount !== 70 ||
    Object.values(restore.identityCounts).some((count) => count !== 1) ||
    !Number.isInteger(restore.mariadbCheckLineCount) ||
    restore.mariadbCheckLineCount < 1
  ) refuse('E_CHECKPOINT_RESTORE', 'Checkpoint-v2 isolated restore proof is invalid.');
  string(restore.restoreContainer, 'Checkpoint-v2 restore container');
  string(restore.restoreVolume, 'Checkpoint-v2 restore volume');

  const verification = checkpoint.verification;
  exactKeys(verification, [
    'originalCheckpoint', 'fileManifest', 'restoreInstructions', 'dualLocation', 'recoveryUnit',
  ], 'Checkpoint-v2 verification');
  validateFileRecord(verification.originalCheckpoint, 'Checkpoint-v2 original checkpoint');
  validateFileRecord(verification.fileManifest, 'Checkpoint-v2 file manifest', ['entryCount', 'entryBytes']);
  integer(verification.fileManifest.entryCount, 'Checkpoint-v2 manifest entry count', 1);
  integer(verification.fileManifest.entryBytes, 'Checkpoint-v2 manifest entry bytes', 1);
  validateFileRecord(verification.restoreInstructions, 'Checkpoint-v2 restore instructions');
  validateFileRecord(
    verification.dualLocation,
    'Checkpoint-v2 dual-location proof',
    ['status', 'verifiedAt', 'primary', 'secondary', 'fileCount', 'totalBytes'],
  );
  if (
    verification.dualLocation.status !== 'passed' ||
    !Number.isInteger(verification.dualLocation.fileCount) ||
    verification.dualLocation.fileCount < 1 ||
    !Number.isInteger(verification.dualLocation.totalBytes) ||
    verification.dualLocation.totalBytes < 1
  ) refuse('E_CHECKPOINT_DUAL', 'Checkpoint-v2 dual-location proof is invalid.');
  date(verification.dualLocation.verifiedAt, 'Checkpoint-v2 dual verifiedAt');
  string(verification.dualLocation.primary, 'Checkpoint-v2 primary path');
  string(verification.dualLocation.secondary, 'Checkpoint-v2 secondary path');
  validateFileRecord(
    verification.recoveryUnit,
    'Checkpoint-v2 recovery unit',
    ['status', 'verifiedAt', 'sourceRuntime'],
  );
  if (
    verification.recoveryUnit.status !== 'passed' ||
    verification.recoveryUnit.sourceRuntime !== 'preserved'
  ) refuse('E_CHECKPOINT_RECOVERY', 'Checkpoint-v2 recovery proof is invalid.');
  date(verification.recoveryUnit.verifiedAt, 'Checkpoint-v2 recovery verifiedAt');
  return checkpoint;
}
