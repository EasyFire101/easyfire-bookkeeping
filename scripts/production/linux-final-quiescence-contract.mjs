import { createHash, timingSafeEqual } from 'node:crypto';

export const FINAL_QUIESCE_MAX_AGE_MS = 60 * 60 * 1000;
export const FINAL_RECEIPT_RELATIVE_PATH =
  'inputs/source-quiesce-receipt.json';
export const FINAL_STATELESS_SOURCE_CONTAINERS = Object.freeze([
  ['gotenberg', 'easyfire-gotenberg'],
  ['proxy', 'easyfire-proxy'],
  ['webapp', 'easyfire-webapp'],
  ['server', 'easyfire-owner-onboarding-ca845969f4b2'],
  ['onboarding-web', 'easyfire-owner-onboarding-web-0b7d1af8'],
  ['onboarding-gateway', 'easyfire-owner-onboarding-gateway-v2-0b7d1af8'],
]);

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class FinalQuiescenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinalQuiescenceError';
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new FinalQuiescenceError(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value, label) => {
  if (!isObject(value)) refuse('E_FINAL_SHAPE', `${label} must be an object.`);
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
    refuse('E_FINAL_SHAPE', `${label} has unexpected or missing fields.`);
  }
};
const integer = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    refuse('E_FINAL_VALUE', `${label} is invalid.`);
  }
  return value;
};
const hash = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    refuse('E_FINAL_VALUE', `${label} is invalid.`);
  }
  return value;
};
const timestamp = (value, label) => {
  if (
    typeof value !== 'string' ||
    !TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    refuse('E_FINAL_VALUE', `${label} is invalid.`);
  }
  return Date.parse(value);
};
const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])]),
  );
};
const canonicalJson = (value) => JSON.stringify(sortObject(value));
const same = (left, right, code, message) => {
  if (canonicalJson(left) !== canonicalJson(right)) refuse(code, message);
};
const hashBytes = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const equalHash = (left, right) =>
  typeof left === 'string' &&
  typeof right === 'string' &&
  left.length === right.length &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));

const normalizeMounts = (container) =>
  (container.Mounts ?? [])
    .map((mount) => ({
      type: String(mount.Type ?? '').toLowerCase(),
      source:
        String(mount.Type ?? '').toLowerCase() === 'volume' && mount.Name
          ? String(mount.Name)
          : String(mount.Source ?? ''),
      destination: String(mount.Destination ?? ''),
      readOnly: mount.RW !== true,
    }))
    .sort((left, right) =>
      `${left.destination}\u0000${left.source}`.localeCompare(
        `${right.destination}\u0000${right.source}`,
      ),
    );
const normalizePorts = (container) => {
  const records = [];
  for (const [key, bindings] of Object.entries(
    container.HostConfig?.PortBindings ?? {},
  ).sort(([left], [right]) => left.localeCompare(right))) {
    const [containerPort, protocol] = key.split('/');
    for (const binding of bindings ?? []) {
      if (!binding) continue;
      records.push({
        containerPort: Number(containerPort),
        hostIp: String(binding.HostIp ?? ''),
        hostPort: Number(binding.HostPort),
        protocol,
      });
    }
  }
  return records.sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
};
const unique = (values, predicate, label) => {
  if (!Array.isArray(values)) refuse('E_FINAL_SHAPE', `${label} must be an array.`);
  const found = values.filter(predicate);
  if (found.length !== 1) {
    refuse('E_FINAL_RUNTIME', `${label} must occur exactly once.`);
  }
  return found[0];
};

const validateFinalContainerEvidence = ({
  checkpoint,
  identities,
  restricted,
  snapshot,
}) => {
  if (
    !Array.isArray(checkpoint.activeContainers) ||
    checkpoint.activeContainers.length !== 8 ||
    !Array.isArray(identities) ||
    identities.length !== 8 ||
    !Array.isArray(restricted) ||
    restricted.length !== 8
  ) {
    refuse(
      'E_FINAL_RUNTIME',
      'Final checkpoint evidence must contain exactly eight source containers.',
    );
  }
  for (const expected of snapshot.containers) {
    const identity = unique(
      identities,
      (candidate) => candidate?.Container === expected.name,
      `${expected.name} final identity`,
    );
    exactKeys(
      identity,
      ['Container', 'ImageId', 'ImageRef', 'RestartPolicy', 'Running', 'Health'],
      `${expected.name} final identity`,
    );
    if (
      identity.ImageId !== expected.imageId ||
      identity.ImageRef !== expected.imageReference ||
      identity.RestartPolicy !== expected.restartPolicy ||
      identity.Running !== String(expected.running).toLowerCase() ||
      identity.Health !== expected.health
    ) {
      refuse(
        'E_FINAL_RUNTIME',
        `Checkpoint identity drifted from the quiesced snapshot: ${expected.name}.`,
      );
    }
    same(
      unique(
        checkpoint.activeContainers,
        (candidate) => candidate?.Container === expected.name,
        `${expected.name} checkpoint identity`,
      ),
      identity,
      'E_FINAL_RUNTIME',
      `Checkpoint and runtime identity records differ: ${expected.name}.`,
    );

    const raw = unique(
      restricted,
      (candidate) => candidate?.Name === `/${expected.name}`,
      `${expected.name} restricted runtime`,
    );
    const actualHealth =
      raw.State?.Running === true
        ? String(raw.State?.Health?.Status ?? 'none')
        : 'none';
    if (
      raw.Id !== expected.id ||
      raw.Image !== expected.imageId ||
      raw.Config?.Image !== expected.imageReference ||
      raw.Config?.Labels?.['com.docker.compose.project'] !==
        expected.composeProject ||
      raw.Config?.Labels?.['com.docker.compose.service'] !==
        expected.composeService ||
      raw.HostConfig?.RestartPolicy?.Name !== expected.restartPolicy ||
      raw.HostConfig?.RestartPolicy?.MaximumRetryCount !==
        expected.maximumRetryCount ||
      raw.State?.Running !== expected.running ||
      raw.State?.Status !== expected.state ||
      actualHealth !== expected.health
    ) {
      refuse(
        'E_FINAL_RUNTIME',
        `Restricted runtime drifted from the quiesced snapshot: ${expected.name}.`,
      );
    }
    same(
      normalizeMounts(raw),
      expected.mounts,
      'E_FINAL_RUNTIME',
      `Runtime mounts drifted from the quiesced snapshot: ${expected.name}.`,
    );
    same(
      Object.keys(raw.NetworkSettings?.Networks ?? {}).sort(),
      expected.networks,
      'E_FINAL_RUNTIME',
      `Runtime networks drifted from the quiesced snapshot: ${expected.name}.`,
    );
    same(
      normalizePorts(raw),
      expected.publishedPorts,
      'E_FINAL_RUNTIME',
      `Runtime ports drifted from the quiesced snapshot: ${expected.name}.`,
    );
  }
};

const requireAllTrue = (candidate, fields, label) => {
  const value = object(candidate, label);
  exactKeys(value, fields, label);
  if (fields.some((field) => value[field] !== true)) {
    refuse('E_FINAL_VALUE', `${label} is incomplete.`);
  }
};

export function validateFinalQuiescenceAuthority(
  candidate,
  { checkpointCreatedAt, source },
) {
  const final = object(candidate, 'Final quiescence authority');
  exactKeys(
    final,
    [
      'schemaVersion',
      'mode',
      'cutoverId',
      'cutoverPlan',
      'quiesceReceipt',
      'sourceSnapshot',
      'dataContainers',
      'statelessContainers',
      'sourceControls',
      'preservation',
    ],
    'Final quiescence authority',
  );
  if (
    final.schemaVersion !== 1 ||
    final.mode !== 'final-quiesced' ||
    !UUID.test(final.cutoverId ?? '')
  ) {
    refuse('E_FINAL_IDENTITY', 'Final mode or cutover identity is invalid.');
  }
  const plan = object(final.cutoverPlan, 'Final cutover plan');
  exactKeys(plan, ['bytes', 'sha256'], 'Final cutover plan');
  integer(plan.bytes, 'Final cutover plan bytes', 1);
  hash(plan.sha256, 'Final cutover plan SHA-256');

  const receipt = object(final.quiesceReceipt, 'Final quiesce receipt');
  exactKeys(
    receipt,
    [
      'sourceRelativePath',
      'bytes',
      'sha256',
      'contentSha256',
      'completedAt',
      'planSha256',
      'afterSnapshotSha256',
    ],
    'Final quiesce receipt',
  );
  if (receipt.sourceRelativePath !== FINAL_RECEIPT_RELATIVE_PATH) {
    refuse('E_FINAL_RECEIPT', 'Final receipt path is not checkpoint-bound.');
  }
  integer(receipt.bytes, 'Final receipt bytes', 1);
  for (const [value, label] of [
    [receipt.sha256, 'Final receipt SHA-256'],
    [receipt.contentSha256, 'Final receipt content SHA-256'],
    [receipt.planSha256, 'Final receipt plan SHA-256'],
    [receipt.afterSnapshotSha256, 'Final receipt snapshot SHA-256'],
  ]) {
    hash(value, label);
  }
  const receiptAt = timestamp(receipt.completedAt, 'Final receipt completedAt');
  if (!equalHash(receipt.planSha256, plan.sha256)) {
    refuse('E_FINAL_BINDING', 'Final receipt does not bind the cutover plan.');
  }

  const snapshot = object(final.sourceSnapshot, 'Final source snapshot');
  exactKeys(
    snapshot,
    ['bytes', 'sha256', 'phase', 'capturedAt', 'writerProof'],
    'Final source snapshot',
  );
  integer(snapshot.bytes, 'Final source snapshot bytes', 1);
  hash(snapshot.sha256, 'Final source snapshot SHA-256');
  const snapshotAt = timestamp(snapshot.capturedAt, 'Final snapshot capturedAt');
  const checkpointAt = timestamp(checkpointCreatedAt, 'Final checkpoint createdAt');
  if (
    snapshot.phase !== 'post-quiesce' ||
    !equalHash(receipt.afterSnapshotSha256, snapshot.sha256) ||
    snapshotAt > receiptAt ||
    receiptAt > checkpointAt ||
    checkpointAt - receiptAt > FINAL_QUIESCE_MAX_AGE_MS
  ) {
    refuse('E_FINAL_STALE', 'Final receipt/snapshot binding is mixed or stale.');
  }
  const writerProof = object(snapshot.writerProof, 'Final writer proof');
  exactKeys(
    writerProof,
    [
      'applicationContainersRunning',
      'mysqlNonSystemConnections',
      'mysqlEventScheduler',
      'mysqlEnabledEvents',
      'redisExternalClients',
    ],
    'Final writer proof',
  );
  if (
    writerProof.applicationContainersRunning !== 0 ||
    writerProof.mysqlNonSystemConnections !== 0 ||
    writerProof.mysqlEventScheduler !== 'OFF' ||
    writerProof.mysqlEnabledEvents !== 0 ||
    writerProof.redisExternalClients !== 0
  ) {
    refuse('E_FINAL_WRITER', 'Final writer proof is not the zero-writer tuple.');
  }

  if (!Array.isArray(final.dataContainers) || final.dataContainers.length !== 2) {
    refuse('E_FINAL_DATA', 'Final authority must bind exactly two data containers.');
  }
  for (const [index, role] of ['mysql', 'redis'].entries()) {
    const data = object(final.dataContainers[index], `Final ${role} state`);
    exactKeys(
      data,
      [
        'role',
        'name',
        'containerId',
        'imageId',
        'imageReference',
        'volumeName',
        'restartPolicy',
        'running',
        'health',
      ],
      `Final ${role} state`,
    );
    const bound = source?.[role];
    if (
      !bound ||
      data.role !== role ||
      data.name !== bound.containerName ||
      data.containerId !== bound.containerId ||
      data.imageId !== bound.imageId ||
      data.imageReference !== bound.imageReference ||
      data.volumeName !== bound.volumeName ||
      data.restartPolicy !== 'unless-stopped' ||
      data.running !== true ||
      data.health !== 'healthy'
    ) {
      refuse('E_FINAL_DATA', `Final ${role} authority is invalid.`);
    }
  }

  if (
    !Array.isArray(final.statelessContainers) ||
    final.statelessContainers.length !== FINAL_STATELESS_SOURCE_CONTAINERS.length
  ) {
    refuse(
      'E_FINAL_STATELESS',
      'Final authority must bind exactly six stateless containers.',
    );
  }
  const sourceIds = new Set([
    source.mysql.containerId,
    source.redis.containerId,
  ]);
  for (const [index, [role, name]] of
    FINAL_STATELESS_SOURCE_CONTAINERS.entries()) {
    const stateless = object(
      final.statelessContainers[index],
      `Final stateless container ${name}`,
    );
    exactKeys(
      stateless,
      [
        'role',
        'name',
        'containerId',
        'imageId',
        'imageReference',
        'restartPolicy',
        'running',
        'state',
        'health',
      ],
      `Final stateless container ${name}`,
    );
    if (
      stateless.role !== role ||
      stateless.name !== name ||
      !SHA256.test(stateless.containerId ?? '') ||
      !IMAGE_ID.test(stateless.imageId ?? '') ||
      typeof stateless.imageReference !== 'string' ||
      stateless.imageReference.length < 1 ||
      stateless.restartPolicy !== 'no' ||
      stateless.running !== false ||
      stateless.state !== 'exited' ||
      stateless.health !== 'none' ||
      sourceIds.has(stateless.containerId)
    ) {
      refuse('E_FINAL_STATELESS', `Final stateless authority is invalid: ${name}.`);
    }
    sourceIds.add(stateless.containerId);
  }
  requireAllTrue(
    final.sourceControls,
    [
      'legacyTasksDisabled',
      'tunnelStoppedAndDisabled',
      'privateRouteStopped',
      'oldEndpointUnreachable',
    ],
    'Final source controls',
  );
  requireAllTrue(
    final.preservation,
    [
      'noResourcesDeleted',
      'dataContainersRunning',
      'volumesPreserved',
      'releasesPreserved',
      'backupsPreserved',
      'originalStatesRecorded',
    ],
    'Final preservation proof',
  );
  return final;
}

export function buildFinalQuiescenceAuthority({
  checkpoint,
  identities,
  restricted,
  mysql,
  redis,
  planDocument,
  receiptDocument,
  snapshotDocument,
  copiedReceiptDocument,
  receiptEntry,
}) {
  const plan = planDocument.value;
  const receipt = receiptDocument.value;
  const snapshot = snapshotDocument.value;
  const receiptSha256 = hashBytes(receiptDocument.bytes);
  if (
    receiptEntry.bytes !== copiedReceiptDocument.metadata.size ||
    !equalHash(receiptEntry.sha256, hashBytes(copiedReceiptDocument.bytes)) ||
    receiptEntry.bytes !== receiptDocument.metadata.size ||
    !equalHash(receiptEntry.sha256, receiptSha256) ||
    !copiedReceiptDocument.bytes.equals(receiptDocument.bytes)
  ) {
    refuse(
      'E_FINAL_RECEIPT',
      'Checkpoint receipt copy does not match the external receipt bytes.',
    );
  }
  exactKeys(
    receipt.source,
    [
      'host',
      'composeProject',
      'dataContainers',
      'dataVolumes',
      'containers',
      'originalStates',
    ],
    'Quiesce receipt source',
  );
  exactKeys(
    receipt.source.originalStates,
    ['containers', 'scheduledTasks', 'tunnel', 'privateRoute'],
    'Quiesce receipt original states',
  );
  exactKeys(
    receipt.proof,
    [
      'dataHealthy',
      'statelessWritersStopped',
      'statelessRestartPolicy',
      'legacyTasksDisabled',
      'tunnelStoppedAndDisabled',
      'privateRouteStopped',
      'oldEndpointUnreachable',
      'writerConnectionsAbsent',
    ],
    'Quiesce receipt proof',
  );
  exactKeys(
    receipt.preservation,
    [
      'noResourcesDeleted',
      'dataContainersRunning',
      'volumesPreserved',
      'releasesPreserved',
      'backupsPreserved',
      'originalStatesRecorded',
    ],
    'Quiesce receipt preservation',
  );
  const initial = plan.source.expectedInitialSnapshot;
  same(
    receipt.source.containers,
    snapshot.containers.map(
      ({ role, name, id, imageId, running, restartPolicy }) => ({
        role,
        name,
        id,
        imageId,
        running,
        restartPolicy,
      }),
    ),
    'E_FINAL_BINDING',
    'Receipt containers do not match the post-quiesce snapshot.',
  );
  same(
    receipt.source.originalStates,
    {
      containers: initial.containers.map(
        ({ role, name, id, restartPolicy, running, state }) => ({
          role,
          name,
          id,
          restartPolicy,
          running,
          state,
        }),
      ),
      scheduledTasks: initial.scheduledTasks.map(
        ({ name, xmlSha256, enabled, state }) => ({
          name,
          xmlSha256,
          enabled,
          state,
        }),
      ),
      tunnel: initial.tunnel,
      privateRoute: initial.privateRoute,
    },
    'E_FINAL_BINDING',
    'Receipt original state does not match the cutover plan.',
  );
  if (
    plan.source.mysqlContainerId !== mysql.containerId ||
    plan.source.redisContainerId !== redis.containerId ||
    plan.source.mysqlVolume !== mysql.volumeName ||
    plan.source.redisVolume !== redis.volumeName
  ) {
    refuse('E_FINAL_BINDING', 'Plan data authority does not match the checkpoint.');
  }
  validateFinalContainerEvidence({
    checkpoint,
    identities,
    restricted,
    snapshot,
  });
  const stateless = snapshot.containers.filter(
    (container) => container.tier === 'stateless',
  );
  same(
    stateless.map(({ role, name }) => [role, name]),
    FINAL_STATELESS_SOURCE_CONTAINERS,
    'E_FINAL_STATELESS',
    'Final checkpoint does not bind the exact six stateless containers.',
  );
  const planSha256 = hashBytes(planDocument.bytes);
  const snapshotSha256 = hashBytes(snapshotDocument.bytes);
  if (
    !equalHash(receipt.planSha256, planSha256) ||
    !equalHash(receipt.afterSnapshotSha256, snapshotSha256)
  ) {
    refuse('E_FINAL_BINDING', 'Receipt plan or snapshot byte binding is invalid.');
  }
  const planAt = timestamp(plan.createdAt, 'Cutover plan createdAt');
  const snapshotAt = timestamp(snapshot.capturedAt, 'Source snapshot capturedAt');
  const receiptAt = timestamp(receipt.completedAt, 'Quiesce receipt completedAt');
  const checkpointAt = timestamp(checkpoint.createdAt, 'Checkpoint createdAt');
  if (
    planAt > snapshotAt ||
    snapshotAt > receiptAt ||
    receiptAt > checkpointAt ||
    checkpointAt - receiptAt > FINAL_QUIESCE_MAX_AGE_MS
  ) {
    refuse('E_FINAL_STALE', 'Quiesce plan/receipt/checkpoint is stale or out of order.');
  }
  const writerProof = {
    applicationContainersRunning: 0,
    mysqlNonSystemConnections: 0,
    mysqlEventScheduler: 'OFF',
    mysqlEnabledEvents: 0,
    redisExternalClients: 0,
  };
  same(
    snapshot.writerProof,
    writerProof,
    'E_FINAL_WRITER',
    'Source snapshot does not contain the zero-writer tuple.',
  );
  const authority = {
    schemaVersion: 1,
    mode: 'final-quiesced',
    cutoverId: plan.cutoverId,
    cutoverPlan: {
      bytes: planDocument.metadata.size,
      sha256: planSha256,
    },
    quiesceReceipt: {
      sourceRelativePath: FINAL_RECEIPT_RELATIVE_PATH,
      bytes: receiptEntry.bytes,
      sha256: receiptSha256,
      contentSha256: receipt.contentSha256,
      completedAt: receipt.completedAt,
      planSha256: receipt.planSha256,
      afterSnapshotSha256: receipt.afterSnapshotSha256,
    },
    sourceSnapshot: {
      bytes: snapshotDocument.metadata.size,
      sha256: snapshotSha256,
      phase: 'post-quiesce',
      capturedAt: snapshot.capturedAt,
      writerProof,
    },
    dataContainers: snapshot.containers
      .filter(({ tier }) => tier === 'data')
      .map((container) => ({
        role: container.role,
        name: container.name,
        containerId: container.id,
        imageId: container.imageId,
        imageReference: container.imageReference,
        volumeName:
          container.role === 'mysql'
            ? plan.source.mysqlVolume
            : plan.source.redisVolume,
        restartPolicy: container.restartPolicy,
        running: true,
        health: 'healthy',
      })),
    statelessContainers: stateless.map((container) => ({
      role: container.role,
      name: container.name,
      containerId: container.id,
      imageId: container.imageId,
      imageReference: container.imageReference,
      restartPolicy: 'no',
      running: false,
      state: 'exited',
      health: 'none',
    })),
    sourceControls: {
      legacyTasksDisabled: true,
      tunnelStoppedAndDisabled: true,
      privateRouteStopped: true,
      oldEndpointUnreachable: true,
    },
    preservation: {
      noResourcesDeleted: true,
      dataContainersRunning: true,
      volumesPreserved: true,
      releasesPreserved: true,
      backupsPreserved: true,
      originalStatesRecorded: true,
    },
  };
  return validateFinalQuiescenceAuthority(authority, {
    checkpointCreatedAt: checkpoint.createdAt,
    source: { mysql, redis },
  });
}
