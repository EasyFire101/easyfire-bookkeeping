import { readFile } from 'node:fs/promises';

const SYSTEMCTL = '/usr/bin/systemctl';
const JOURNALCTL = '/usr/bin/journalctl';
const GUARDIAN_SERVICE = 'easyfire-bookkeeping-guardian.service';
const GUARDIAN_TIMER = 'easyfire-bookkeeping-guardian.timer';
const GUARDIAN_STATUS = '/var/lib/easyfire-bookkeeping-guardian/status.json';
const SHA = /^[a-f0-9]{64}$/;
const INVOCATION_ID = /^[a-f0-9]{32}$/;
const BOOT_ID = /^[a-f0-9]{32}$/;
const HYPHENATED_BOOT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const MAX_TRIGGER_TO_START_USEC = 10_000_000n;
const MAX_READ_TIMEOUT_MS = 5_000;

export class GuardianBootProofRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardianBootProofRefusal';
    this.code = 'E_GUARDIAN_BOOT';
  }
}

const refuse = (message) => {
  throw new GuardianBootProofRefusal(message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, label) => {
  if (!isObject(value)) refuse(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) refuse(`${label} has missing or unexpected fields.`);
};
const requireTime = (value, label) => {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) refuse(`${label} is invalid.`);
};

export function validateGuardianCurrentBootStatus(candidate) {
  const status = candidate;
  exactKeys(status, [
    'schemaVersion', 'observedAt', 'phase', 'reason', 'action',
    'dockerAvailable', 'services', 'probes', 'consecutiveFailures',
    'failureFingerprint', 'cooldownUntil', 'recoveryAttemptsInWindow',
  ], 'Current-boot Guardian status');
  requireTime(status.observedAt, 'Current-boot Guardian status observedAt');
  exactKeys(status.action, ['kind'], 'Current-boot Guardian action');
  const hasCooldown = status.cooldownUntil !== null;
  if (hasCooldown) requireTime(status.cooldownUntil, 'Current-boot Guardian cooldown');
  if (
    status.schemaVersion !== 1 ||
    !['healthy', 'cooldown'].includes(status.phase) ||
    (status.phase === 'cooldown') !== hasCooldown ||
    typeof status.reason !== 'string' || status.reason.length === 0 ||
    status.action.kind !== 'none' ||
    status.dockerAvailable !== true ||
    status.consecutiveFailures !== 0 ||
    status.failureFingerprint !== null ||
    !Number.isInteger(status.recoveryAttemptsInWindow) ||
    status.recoveryAttemptsInWindow < 0 ||
    status.recoveryAttemptsInWindow > 2 ||
    (hasCooldown && Date.parse(status.cooldownUntil) <= Date.parse(status.observedAt))
  ) refuse('Current-boot Guardian status is not healthy.');

  const expectedServices = new Map([
    ['envoy', 'easyfire-bookkeeping-envoy'],
    ['webapp', 'easyfire-bookkeeping-webapp'],
    ['server', 'easyfire-bookkeeping-server'],
    ['gotenberg', 'easyfire-bookkeeping-gotenberg'],
    ['mysql', 'easyfire-bookkeeping-mysql'],
    ['redis', 'easyfire-bookkeeping-redis'],
  ]);
  if (!Array.isArray(status.services) || status.services.length !== expectedServices.size) {
    refuse('Current-boot Guardian service set is incomplete.');
  }
  const seenServices = new Set();
  for (const service of status.services) {
    exactKeys(
      service,
      ['role', 'containerName', 'state', 'healthy', 'identityMatches'],
      'Current-boot Guardian service',
    );
    if (
      seenServices.has(service.role) ||
      expectedServices.get(service.role) !== service.containerName ||
      service.state !== 'running' ||
      service.healthy !== true ||
      service.identityMatches !== true
    ) refuse('Current-boot Guardian service status is unhealthy.');
    seenServices.add(service.role);
  }

  const expectedProbes = new Set(['web', 'api-system', 'auth-meta']);
  if (!Array.isArray(status.probes) || status.probes.length !== expectedProbes.size) {
    refuse('Current-boot Guardian probe set is incomplete.');
  }
  const seenProbes = new Set();
  for (const probe of status.probes) {
    exactKeys(probe, ['name', 'ok', 'statusCode', 'latencyMs'], 'Current-boot Guardian probe');
    if (
      seenProbes.has(probe.name) ||
      !expectedProbes.has(probe.name) ||
      probe.ok !== true ||
      probe.statusCode !== 200 ||
      typeof probe.latencyMs !== 'number' ||
      !Number.isFinite(probe.latencyMs) ||
      probe.latencyMs < 0
    ) refuse('Current-boot Guardian probe status is unhealthy.');
    seenProbes.add(probe.name);
  }
  return structuredClone(status);
}

const EXECUTION_KEYS = [
  'timerActiveState', 'timerSubState', 'timerUnitFileState',
  'timerLastTriggerMonotonicUsec', 'timerNextElapseMonotonicUsec',
  'serviceActiveState', 'serviceSubState', 'serviceResult',
  'serviceExecMainCode', 'serviceExecMainStatus',
  'serviceStartedMonotonicUsec', 'serviceExitedMonotonicUsec',
  'serviceInvocationId',
];

export function validateGuardianExecutionSnapshot(candidate) {
  const snapshot = candidate;
  exactKeys(snapshot, EXECUTION_KEYS, 'Current-boot Guardian execution snapshot');
  for (const value of [
    snapshot.serviceStartedMonotonicUsec,
    snapshot.serviceExitedMonotonicUsec,
    snapshot.timerLastTriggerMonotonicUsec,
    snapshot.timerNextElapseMonotonicUsec,
  ]) {
    if (!POSITIVE_INTEGER.test(value ?? '')) {
      refuse('Guardian current-boot monotonic timestamp is invalid.');
    }
  }
  const serviceStarted = BigInt(snapshot.serviceStartedMonotonicUsec);
  const serviceExited = BigInt(snapshot.serviceExitedMonotonicUsec);
  const lastTrigger = BigInt(snapshot.timerLastTriggerMonotonicUsec);
  const nextElapse = BigInt(snapshot.timerNextElapseMonotonicUsec);
  if (
    snapshot.timerActiveState !== 'active' ||
    snapshot.timerSubState !== 'waiting' ||
    snapshot.timerUnitFileState !== 'enabled' ||
    snapshot.serviceActiveState !== 'inactive' ||
    snapshot.serviceSubState !== 'dead' ||
    snapshot.serviceResult !== 'success' ||
    snapshot.serviceExecMainCode !== 1 ||
    ![0, 2].includes(snapshot.serviceExecMainStatus) ||
    !INVOCATION_ID.test(snapshot.serviceInvocationId ?? '') ||
    serviceStarted < lastTrigger ||
    serviceStarted - lastTrigger > MAX_TRIGGER_TO_START_USEC ||
    serviceExited < serviceStarted ||
    serviceExited >= nextElapse ||
    nextElapse <= lastTrigger
  ) refuse('Guardian current-boot timer or service execution is incomplete.');
  return structuredClone(snapshot);
}

export function validateGuardianJournalBinding(statusCandidate, journalCandidate) {
  const status = validateGuardianCurrentBootStatus(statusCandidate);
  const journalStatus = validateGuardianCurrentBootStatus(journalCandidate);
  if (JSON.stringify(status) !== JSON.stringify(journalStatus)) {
    refuse('Guardian journal status does not match the secure status artifact.');
  }
  return status;
}

export function validateGuardianCurrentBootProof(candidate) {
  const proof = candidate;
  exactKeys(proof, [
    'timerActiveState', 'timerSubState', 'timerUnitFileState',
    'timerLastTriggerMonotonicUsec', 'timerNextElapseMonotonicUsec',
    'serviceActiveState', 'serviceSubState',
    'serviceResult', 'serviceExecMainCode', 'serviceExecMainStatus',
    'serviceStartedMonotonicUsec', 'serviceExitedMonotonicUsec',
    'serviceInvocationId', 'journalBootId', 'journalMessageSha256',
    'statusSha256', 'statusObservedAt', 'statusPhase', 'statusHealthy',
    'rebootMarkerPreparedAt',
  ], 'Current-boot Guardian proof');
  requireTime(proof.statusObservedAt, 'Current-boot Guardian observation time');
  requireTime(proof.rebootMarkerPreparedAt, 'Guardian reboot marker time');
  validateGuardianExecutionSnapshot(Object.fromEntries(
    EXECUTION_KEYS.map((key) => [key, proof[key]]),
  ));
  if (
    proof.serviceExecMainStatus !== 0 ||
    !BOOT_ID.test(proof.journalBootId ?? '') ||
    !SHA.test(proof.journalMessageSha256 ?? '') ||
    !SHA.test(proof.statusSha256 ?? '') ||
    !['healthy', 'cooldown'].includes(proof.statusPhase) ||
    proof.statusHealthy !== true ||
    Date.parse(proof.statusObservedAt) < Date.parse(proof.rebootMarkerPreparedAt)
  ) refuse('Guardian current-boot timer, service, or status proof is incomplete.');
  return structuredClone(proof);
}

export function validateGuardianNormalRebootSummary(candidate) {
  const reboot = candidate;
  exactKeys(reboot, [
    'markerSha256', 'proofSha256', 'bootIdBefore', 'bootIdAfter',
    'completedAt', 'stackAuthorityVerified', 'guardianTimerActive',
    'guardianTimerEnabled', 'guardianCurrentBoot',
  ], 'Rehearsal normal reboot summary');
  requireTime(reboot.completedAt, 'Normal reboot completion time');
  const guardian = validateGuardianCurrentBootProof(reboot.guardianCurrentBoot);
  if (
    !SHA.test(reboot.markerSha256 ?? '') ||
    !SHA.test(reboot.proofSha256 ?? '') ||
    !HYPHENATED_BOOT_ID.test(reboot.bootIdBefore ?? '') ||
    !HYPHENATED_BOOT_ID.test(reboot.bootIdAfter ?? '') ||
    reboot.bootIdBefore === reboot.bootIdAfter ||
    reboot.stackAuthorityVerified !== true ||
    reboot.guardianTimerActive !== true ||
    reboot.guardianTimerEnabled !== true ||
    guardian.journalBootId !== reboot.bootIdAfter.replaceAll('-', '') ||
    Date.parse(guardian.statusObservedAt) > Date.parse(reboot.completedAt)
  ) refuse('Normal reboot or current-boot Guardian proof is incomplete.');
  return structuredClone(reboot);
}

const readProperties = async (run, unit, properties) => {
  const output = (
    await run(
      SYSTEMCTL,
      ['show', ...properties.map((property) => `--property=${property}`), unit],
      `${unit} property readback`,
    )
  ).stdout.toString('utf8').trim();
  const values = {};
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) refuse(`${unit} returned malformed properties.`);
    const key = line.slice(0, separator);
    if (!properties.includes(key) || Object.hasOwn(values, key)) {
      refuse(`${unit} returned unexpected or duplicate properties.`);
    }
    values[key] = line.slice(separator + 1);
  }
  if (Object.keys(values).length !== properties.length) {
    refuse(`${unit} returned incomplete properties.`);
  }
  return values;
};

const readJournalStatus = async (run, bootId, invocationId) => {
  const output = (
    await run(
      JOURNALCTL,
      [
        '--boot=0', '--unit', GUARDIAN_SERVICE, '--output=json', '--no-pager',
        '--all', `_BOOT_ID=${bootId}`, `_SYSTEMD_INVOCATION_ID=${invocationId}`,
      ],
      'Current-boot Guardian journal readback',
    )
  ).stdout.toString('utf8').trim();
  const matches = [];
  for (const line of output === '' ? [] : output.split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    }
    catch {
      refuse('Guardian journal returned malformed JSON.');
    }
    if (
      record._BOOT_ID !== bootId ||
      record._SYSTEMD_INVOCATION_ID !== invocationId ||
      typeof record.MESSAGE !== 'string'
    ) continue;
    try {
      const status = JSON.parse(record.MESSAGE);
      if (isObject(status) && status.schemaVersion === 1 && 'services' in status) {
        matches.push({ message: record.MESSAGE, status });
      }
    }
    catch {
      // Non-JSON systemd lifecycle messages are not Guardian status output.
    }
  }
  if (matches.length !== 1) {
    refuse('Guardian journal does not contain one invocation-bound status message.');
  }
  return matches[0];
};

export async function collectCurrentBootGuardianProof({
  run,
  readSecureJson,
  sha256,
  rebootMarkerPreparedAt,
  attempts = 91,
  delayMs = 2_000,
  readBootId = async () => readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (
    typeof run !== 'function' ||
    typeof readSecureJson !== 'function' ||
    typeof sha256 !== 'function'
  ) refuse('Current-boot Guardian collector dependencies are invalid.');
  requireTime(rebootMarkerPreparedAt, 'Guardian reboot marker time');
  const serviceProperties = [
    'ActiveState', 'SubState', 'Result', 'ExecMainCode', 'ExecMainStatus',
    'ExecMainStartTimestampMonotonic', 'ExecMainExitTimestampMonotonic',
    'InvocationID',
  ];
  const timerProperties = [
    'ActiveState', 'SubState', 'UnitFileState',
    'LastTriggerUSecMonotonic', 'NextElapseUSecMonotonic',
  ];
  if (
    !Number.isInteger(attempts) || attempts < 1 ||
    !Number.isInteger(delayMs) || delayMs < 1 ||
    typeof readBootId !== 'function' || typeof now !== 'function' ||
    typeof sleep !== 'function'
  ) refuse('Current-boot Guardian collector bounds are invalid.');
  const deadline = now() + attempts * delayMs;
  const runBounded = (file, args, label) => {
    const remainingMs = Math.floor(deadline - now());
    if (remainingMs < 1) refuse('Guardian current-boot proof deadline expired.');
    return run(file, args, label, [0], Math.min(MAX_READ_TIMEOUT_MS, remainingMs));
  };
  const bootId = (await readBootId())
    .trim().toLowerCase().replaceAll('-', '');
  if (!BOOT_ID.test(bootId)) refuse('Current Linux boot id is invalid.');
  let lastRefusal;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timerBefore = await readProperties(runBounded, GUARDIAN_TIMER, timerProperties);
    const serviceBefore = await readProperties(runBounded, GUARDIAN_SERVICE, serviceProperties);
    const ready =
      timerBefore.ActiveState === 'active' &&
      timerBefore.SubState === 'waiting' &&
      timerBefore.UnitFileState === 'enabled' &&
      POSITIVE_INTEGER.test(timerBefore.LastTriggerUSecMonotonic) &&
      POSITIVE_INTEGER.test(timerBefore.NextElapseUSecMonotonic) &&
      serviceBefore.ActiveState === 'inactive' &&
      serviceBefore.SubState === 'dead' &&
      serviceBefore.Result === 'success' &&
      serviceBefore.ExecMainCode === '1' &&
      ['0', '2'].includes(serviceBefore.ExecMainStatus) &&
      POSITIVE_INTEGER.test(serviceBefore.ExecMainStartTimestampMonotonic) &&
      POSITIVE_INTEGER.test(serviceBefore.ExecMainExitTimestampMonotonic) &&
      INVOCATION_ID.test(serviceBefore.InvocationID);
    if (ready) {
      try {
        const statusDocument = await readSecureJson(GUARDIAN_STATUS);
        const journal = await readJournalStatus(runBounded, bootId, serviceBefore.InvocationID);
        const serviceAfter = await readProperties(runBounded, GUARDIAN_SERVICE, serviceProperties);
        const timerAfter = await readProperties(runBounded, GUARDIAN_TIMER, timerProperties);
        if (
          JSON.stringify(serviceBefore) === JSON.stringify(serviceAfter) &&
          JSON.stringify(timerBefore) === JSON.stringify(timerAfter)
        ) {
          const status = validateGuardianJournalBinding(
            statusDocument.value,
            journal.status,
          );
          if (now() > deadline) refuse('Guardian current-boot proof deadline expired.');
          return validateGuardianCurrentBootProof({
            timerActiveState: timerAfter.ActiveState,
            timerSubState: timerAfter.SubState,
            timerUnitFileState: timerAfter.UnitFileState,
            timerLastTriggerMonotonicUsec: timerAfter.LastTriggerUSecMonotonic,
            timerNextElapseMonotonicUsec: timerAfter.NextElapseUSecMonotonic,
            serviceActiveState: serviceAfter.ActiveState,
            serviceSubState: serviceAfter.SubState,
            serviceResult: serviceAfter.Result,
            serviceExecMainCode: Number(serviceAfter.ExecMainCode),
            serviceExecMainStatus: Number(serviceAfter.ExecMainStatus),
            serviceStartedMonotonicUsec: serviceAfter.ExecMainStartTimestampMonotonic,
            serviceExitedMonotonicUsec: serviceAfter.ExecMainExitTimestampMonotonic,
            serviceInvocationId: serviceAfter.InvocationID,
            journalBootId: bootId,
            journalMessageSha256: sha256(Buffer.from(journal.message)),
            statusSha256: sha256(statusDocument.bytes),
            statusObservedAt: status.observedAt,
            statusPhase: status.phase,
            statusHealthy: true,
            rebootMarkerPreparedAt,
          });
        }
      }
      catch (error) {
        if (!(error instanceof GuardianBootProofRefusal)) throw error;
        lastRefusal = error;
      }
    }
    if (attempt + 1 < attempts) {
      const remainingMs = Math.floor(deadline - now());
      if (remainingMs < 1) break;
      await sleep(Math.min(delayMs, remainingMs));
    }
  }
  refuse(
    `Guardian did not publish stable healthy current-boot timer evidence in time${
      lastRefusal ? `: ${lastRefusal.message}` : '.'
    }`,
  );
}
