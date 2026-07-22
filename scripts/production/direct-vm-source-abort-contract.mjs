#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { link, lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  PRIVATE_SOURCE_LAUNCHER,
  PRIVATE_SOURCE_LAUNCHER_CHILD_SHA256,
  PRIVATE_SOURCE_LAUNCHER_SHA256,
  PROJECT,
  SOURCE_HOST,
  STATELESS_CONTAINER_NAMES,
  TARGET_VM,
  canonicalJson,
  safeHashEqual,
  sha256,
  validateCheckpointBinding,
  validateCutoverPlan,
  validateSourceQuiesceReceipt,
} from './direct-vm-cutover-contract.mjs';
import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
import {
  collectBoundInputs,
  readVerifiedDeploymentChain,
} from './linux-deploy-authority.mjs';
import {
  FIXED_PLAN_PATH,
  validateDeploymentPlan,
} from './linux-deploy-plan.mjs';
import { parseManifestBoundRelease } from './linux-release-authority-verify.mjs';
import {
  ALL_RUNTIME_CONTAINERS,
  MIGRATION_CONTAINER,
  validateLockAgainstAuthority,
  validateLockDocument,
  validateStoppedRuntime,
} from './linux-rollback-lock.mjs';
import {
  buildCutoverDecisionClaim,
  claimCutoverDecision,
  CUTOVER_DECISION_PATH,
  parseListeningPorts,
  validatePreActivationNetwork,
  validateTailscaleVersion,
} from './linux-private-route-activate.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const DEPLOYMENT_ID = /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SENSITIVE_KEY = /(?:password|secret|token|credential)/i;
const MAX_EVIDENCE_AGE_MS = 15 * 60 * 1000;
const NODE = '/usr/local/bin/node';
const DOCKER = '/usr/bin/docker';
const SYSTEMCTL = '/usr/bin/systemctl';
const TAILSCALE = '/usr/bin/tailscale';
const SS = '/usr/bin/ss';
const CUTOVER_PLAN_PATH = '/etc/easyfire-bookkeeping/cutover-plan.json';
const SOURCE_RECEIPT_PATH = '/etc/easyfire-bookkeeping/source-quiesce-receipt.json';
const CHECKPOINT_BINDING_PATH =
  '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json';
const RUNTIME_MANIFEST_PATH = '/etc/easyfire-bookkeeping/runtime-manifest.json';
const ROLLBACK_LOCK_PATH = '/etc/easyfire-bookkeeping/rollback.lock';
const GUEST_ISOLATION_OUTPUT =
  '/etc/easyfire-bookkeeping/guest-pre-activation-isolation.json';
const ACTIVATION_AUTHORIZATION =
  '/etc/easyfire-bookkeeping/cutover-authorization.json';
const ACTIVATION_LOCK =
  '/etc/easyfire-bookkeeping/private-route-activation.lock';
const ACTIVATION_RECEIPT =
  '/etc/easyfire-bookkeeping/private-route-activation.json';
const ROLLBACK_CONTROLLER =
  '/opt/easyfire-bookkeeping/current/scripts/production/linux-rollback-lock.mjs';
const MAX_GUEST_FILE = 4 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024;

export const GUEST_CONTAINER_NAMES = Object.freeze([
  'easyfire-bookkeeping-envoy',
  'easyfire-bookkeeping-webapp',
  'easyfire-bookkeeping-server',
  'easyfire-bookkeeping-gotenberg',
  'easyfire-bookkeeping-mysql',
  'easyfire-bookkeeping-redis',
  'easyfire-bookkeeping-migration',
]);

class AbortRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AbortRefusal';
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new AbortRefusal(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
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
  return value;
};
const integer = (value, label, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) refuse('E_VALUE', `${label} is invalid.`);
  return value;
};
const date = (value, label) => {
  string(value, label);
  if (Number.isNaN(Date.parse(value))) refuse('E_TIME', `${label} is invalid.`);
  return value;
};
const hash = (value, label) => string(value, label, SHA256);
const trueOnly = (value, label) => {
  if (value !== true) refuse('E_PROOF', `${label} must be true.`);
};
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
const contentWithoutHash = ({ contentSha256, ...rest }) => rest;

export function validateGuestPreActivationIsolation(
  candidate,
  planCandidate,
  planSha256,
  sourceQuiesceReceiptSha256,
  checkpointBindingSha256,
  now = new Date(),
) {
  const plan = validateCutoverPlan(planCandidate);
  hash(planSha256, 'Cutover plan hash');
  hash(sourceQuiesceReceiptSha256, 'Source quiesce receipt hash');
  hash(checkpointBindingSha256, 'Checkpoint binding hash');
  const evidence = object(candidate, 'Guest pre-activation isolation evidence');
  rejectSensitiveKeys(evidence);
  exactKeys(evidence, [
    'schemaVersion',
    'project',
    'kind',
    'status',
    'cutoverId',
    'collectedAt',
    'sourceQuiesceReceiptSha256',
    'checkpointBindingSha256',
    'collector',
    'guest',
    'proofFiles',
  ], 'Guest pre-activation isolation evidence');
  if (
    evidence.schemaVersion !== 1 ||
    evidence.project !== PROJECT ||
    evidence.kind !== 'easyfire-bookkeeping-guest-pre-activation-isolation' ||
    evidence.status !== 'locked-verified' ||
    evidence.cutoverId !== plan.cutoverId ||
    evidence.sourceQuiesceReceiptSha256 !== sourceQuiesceReceiptSha256 ||
    evidence.checkpointBindingSha256 !== checkpointBindingSha256
  ) refuse('E_GUEST_ISOLATION', 'Guest isolation identity or binding is invalid.');
  date(evidence.collectedAt, 'Guest isolation collectedAt');
  const collected = Date.parse(evidence.collectedAt);
  if (collected > now.getTime() || now.getTime() - collected > MAX_EVIDENCE_AGE_MS) {
    refuse('E_GUEST_ISOLATION_TIME', 'Guest isolation proof is future-dated or stale.');
  }

  const collector = object(evidence.collector, 'Guest isolation collector');
  exactKeys(collector, [
    'schemaVersion', 'kind', 'sourceReleasePath', 'executablePath',
    'executableSha256', 'releaseManifestSha256', 'cutoverPlanSha256',
    'deploymentPlanSha256', 'deploymentReceiptSha256', 'outputPath',
    'decisionClaim',
    'outputPublishedCreateNew', 'rootOwnedSecureFilesVerified',
    'liveRollbackVerificationPassed', 'liveReadbacksVerified',
  ], 'Guest isolation collector');
  const expectedReleasePath =
    `/opt/easyfire-bookkeeping/releases/${plan.controller.releaseCommit}`;
  if (
    collector.schemaVersion !== 1 ||
    collector.kind !== 'easyfire-bookkeeping-release-bound-guest-isolation-collector' ||
    collector.sourceReleasePath !== expectedReleasePath ||
    collector.executablePath !==
      `${expectedReleasePath}/scripts/production/direct-vm-source-abort-contract.mjs` ||
    collector.executableSha256 !== plan.controller.abortContractSha256 ||
    collector.releaseManifestSha256 !== plan.controller.releaseManifestSha256 ||
    collector.cutoverPlanSha256 !== planSha256 ||
    collector.outputPath !== GUEST_ISOLATION_OUTPUT
  ) refuse('E_COLLECTOR_AUTHORITY', 'Guest isolation collector is not release and plan bound.');
  hash(collector.deploymentPlanSha256, 'Guest collector deployment plan hash');
  hash(collector.deploymentReceiptSha256, 'Guest collector deployment receipt hash');
  exactKeys(collector.decisionClaim, [
    'path', 'sha256', 'decision', 'claimedAt', 'authoritySha256',
  ], 'Guest collector cutover decision claim');
  if (
    collector.decisionClaim.path !== CUTOVER_DECISION_PATH ||
    collector.decisionClaim.decision !== 'abort' ||
    Date.parse(collector.decisionClaim.claimedAt) > collected
  ) refuse('E_CUTOVER_DECISION', 'Guest collector does not own the abort decision.');
  date(collector.decisionClaim.claimedAt, 'Guest cutover decision time');
  hash(collector.decisionClaim.sha256, 'Guest cutover decision hash');
  hash(collector.decisionClaim.authoritySha256, 'Guest cutover decision authority hash');
  for (const field of [
    'outputPublishedCreateNew', 'rootOwnedSecureFilesVerified',
    'liveRollbackVerificationPassed', 'liveReadbacksVerified',
  ]) trueOnly(collector[field], `Guest collector ${field}`);

  const guest = object(evidence.guest, 'Guest isolation state');
  exactKeys(guest, [
    'vmName',
    'deploymentId',
    'releaseCommit',
    'accountingDataAuthority',
    'firstUserWriteAuthority',
    'rollbackLock',
    'containers',
    'network',
    'activation',
    'preservation',
  ], 'Guest isolation state');
  if (
    guest.vmName !== TARGET_VM ||
    guest.accountingDataAuthority !== 'windows-final-checkpoint'
  ) refuse('E_FIRST_WRITE', 'The guest is not eligible for pre-first-write source rearm.');
  exactKeys(guest.firstUserWriteAuthority, [
    'status', 'activationLockAbsent', 'authorizationAbsent',
    'receiptAbsent', 'routeAbsent', 'cutoverDecision',
    'cutoverDecisionClaimSha256',
  ], 'Guest first-write authority');
  if (guest.firstUserWriteAuthority.status !== 'pre-activation-never-exposed') {
    refuse('E_FIRST_WRITE', 'Guest first-write boundary status is invalid.');
  }
  if (
    guest.firstUserWriteAuthority.cutoverDecision !== 'abort' ||
    guest.firstUserWriteAuthority.cutoverDecisionClaimSha256 !==
      collector.decisionClaim.sha256
  ) refuse('E_CUTOVER_DECISION', 'Guest first-write authority is not abort-claim-bound.');
  hash(
    guest.firstUserWriteAuthority.cutoverDecisionClaimSha256,
    'Guest first-write cutover decision hash',
  );
  for (const field of [
    'activationLockAbsent', 'authorizationAbsent', 'receiptAbsent', 'routeAbsent',
  ]) trueOnly(guest.firstUserWriteAuthority[field], `Guest first-write authority ${field}`);
  string(guest.deploymentId, 'Guest deployment id', DEPLOYMENT_ID);
  string(guest.releaseCommit, 'Guest release commit', COMMIT);
  if (guest.releaseCommit !== plan.controller.releaseCommit) {
    refuse('E_GUEST_DEPLOYMENT', 'Guest release commit is not cutover-plan-bound.');
  }
  exactKeys(guest.rollbackLock, [
    'present', 'reason', 'path', 'lockSha256', 'receiptPath', 'receiptSha256',
  ], 'Guest rollback lock');
  trueOnly(guest.rollbackLock.present, 'Guest rollback lock presence');
  if (
    guest.rollbackLock.reason !== 'rollback' ||
    guest.rollbackLock.path !== ROLLBACK_LOCK_PATH ||
    !/^\/etc\/easyfire-bookkeeping\/rollback-evidence\/rollbacks\/direct-vm-[0-9]{8}-[a-f0-9]{8}\/[0-9a-f-]{36}\/armed\.json$/.test(
      guest.rollbackLock.receiptPath,
    )
  ) refuse('E_ROLLBACK_LOCK', 'Guest rollback lock authority is invalid.');
  hash(guest.rollbackLock.lockSha256, 'Guest rollback lock hash');
  hash(guest.rollbackLock.receiptSha256, 'Guest rollback lock receipt hash');

  if (!Array.isArray(guest.containers) || guest.containers.length !== GUEST_CONTAINER_NAMES.length) {
    refuse('E_GUEST_CONTAINERS', 'Guest isolation must prove exactly seven containers.');
  }
  guest.containers.forEach((container, index) => {
    exactKeys(container, [
      'name', 'id', 'imageId', 'running', 'state', 'restartPolicy',
    ], `Guest container ${index}`);
    if (
      container.name !== GUEST_CONTAINER_NAMES[index] ||
      container.running !== false ||
      container.state !== 'exited' ||
      container.restartPolicy !== 'no'
    ) refuse('E_GUEST_CONTAINERS', `Guest container ${index} is not stopped and restart-locked.`);
    string(container.id, `Guest container ${index} id`, SHA256);
    string(container.imageId, `Guest container ${index} image id`, IMAGE_ID);
  });
  if (new Set(guest.containers.map(({ id }) => id)).size !== guest.containers.length) {
    refuse('E_GUEST_CONTAINERS', 'Guest container IDs are not unique.');
  }

  exactKeys(guest.network, [
    'tailscaleServeAbsent',
    'tailscaleFunnelAbsent',
    'targetRouteAbsent',
    'originPort8080Absent',
    'publicPort443Absent',
    'publicListeners',
  ], 'Guest isolation network');
  for (const field of [
    'tailscaleServeAbsent',
    'tailscaleFunnelAbsent',
    'targetRouteAbsent',
    'originPort8080Absent',
    'publicPort443Absent',
  ]) trueOnly(guest.network[field], `Guest isolation network ${field}`);
  if (!Array.isArray(guest.network.publicListeners) || guest.network.publicListeners.length !== 0) {
    refuse('E_PUBLIC_EXPOSURE', 'Guest isolation found a public listener.');
  }
  exactKeys(guest.activation, [
    'activationLockAbsent', 'authorizationAbsent', 'receiptAbsent',
  ], 'Guest activation state');
  trueOnly(guest.activation.activationLockAbsent, 'Guest activation lock absence');
  trueOnly(guest.activation.authorizationAbsent, 'Guest activation authorization absence');
  trueOnly(guest.activation.receiptAbsent, 'Guest activation receipt absence');
  exactKeys(guest.preservation, [
    'volumesPreserved', 'releasesPreserved', 'backupsPreserved', 'noResourcesDeleted',
  ], 'Guest preservation proof');
  Object.entries(guest.preservation).forEach(([key, value]) => trueOnly(value, `Guest preservation ${key}`));
  exactKeys(evidence.proofFiles, [
    'cutoverPlan', 'sourceQuiesceReceipt', 'checkpointBinding',
    'deploymentPlan', 'deploymentReceipt', 'runtimeManifest', 'rollbackLock',
    'rollbackArmed', 'containerState', 'networkState', 'activationState',
    'cutoverDecisionClaim', 'collectorExecutable', 'releaseManifest',
  ], 'Guest isolation proof files');
  Object.entries(evidence.proofFiles).forEach(([key, value]) => hash(value, `Guest proof ${key}`));
  const expectedProofHashes = {
    cutoverPlan: planSha256,
    sourceQuiesceReceipt: sourceQuiesceReceiptSha256,
    checkpointBinding: checkpointBindingSha256,
    deploymentPlan: collector.deploymentPlanSha256,
    deploymentReceipt: collector.deploymentReceiptSha256,
    rollbackLock: guest.rollbackLock.lockSha256,
    rollbackArmed: guest.rollbackLock.receiptSha256,
    cutoverDecisionClaim: collector.decisionClaim.sha256,
    collectorExecutable: collector.executableSha256,
    releaseManifest: collector.releaseManifestSha256,
  };
  for (const [field, expected] of Object.entries(expectedProofHashes)) {
    if (evidence.proofFiles[field] !== expected) {
      refuse('E_PROOF_BINDING', `Guest proof ${field} is not authority-bound.`);
    }
  }
  const expectedDecisionAuthoritySha256 = sha256(canonicalJson({
    cutoverPlanSha256: planSha256,
    sourceReceiptSha256: sourceQuiesceReceiptSha256,
    checkpointBindingSha256,
    deploymentPlanSha256: collector.deploymentPlanSha256,
    deploymentReceiptSha256: collector.deploymentReceiptSha256,
    rollbackLockSha256: guest.rollbackLock.lockSha256,
    rollbackArmedSha256: guest.rollbackLock.receiptSha256,
    collectorExecutableSha256: collector.executableSha256,
  }));
  const expectedDecision = buildCutoverDecisionClaim({
    decision: 'abort',
    cutoverId: evidence.cutoverId,
    deploymentId: guest.deploymentId,
    releaseCommit: guest.releaseCommit,
    authoritySha256: expectedDecisionAuthoritySha256,
    claimedAt: collector.decisionClaim.claimedAt,
  });
  if (
    collector.decisionClaim.authoritySha256 !== expectedDecisionAuthoritySha256 ||
    collector.decisionClaim.sha256 !==
      sha256(Buffer.from(`${JSON.stringify(expectedDecision, null, 2)}\n`))
  ) refuse('E_CUTOVER_DECISION', 'Guest abort decision claim bytes are not proof-bound.');
  return evidence;
}

const guestEnvironment = Object.freeze({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: '/root',
  LANG: 'C',
  LC_ALL: 'C',
});

const ensureGuestCollectorRoot = () => {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    refuse('E_ROOT_REQUIRED', 'Guest-isolation collection requires Linux root.');
  }
};

const assertSecureGuestFile = async (file, mode = 0o600) => {
  const resolved = await realpath(file).catch(() => null);
  if (resolved !== file) refuse('E_FILE_PATH', `Required file is missing or non-canonical: ${file}`);
  const metadata = await lstat(file);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 ||
    (metadata.mode & 0o777) !== mode || metadata.size < 2 ||
    metadata.size > MAX_GUEST_FILE
  ) refuse('E_FILE_AUTHORITY', `Required file authority is unsafe: ${file}`);
  return metadata;
};

const readSecureGuestJson = async (file, label, mode = 0o600) => {
  await assertSecureGuestFile(file, mode);
  const bytes = await readFile(file);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
  } catch {
    refuse('E_JSON', `${label} is not valid JSON.`);
  }
};

const assertGuestPathAbsent = async (file, label) => {
  try {
    await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    refuse('E_FILE_STATE', `${label} absence could not be proven.`);
  }
  refuse('E_FIRST_WRITE', `${label} exists, so pre-activation source rearm is forbidden.`);
};

const assertActivationBoundaryAbsent = async () => {
  await assertGuestPathAbsent(ACTIVATION_LOCK, 'Private-route activation lock');
  await assertGuestPathAbsent(ACTIVATION_AUTHORIZATION, 'Cutover authorization');
  await assertGuestPathAbsent(ACTIVATION_RECEIPT, 'Private-route activation receipt');
  return {
    status: 'pre-activation-never-exposed',
    activationLockAbsent: true,
    authorizationAbsent: true,
    receiptAbsent: true,
    routeAbsent: true,
  };
};

const runGuestCommand = (file, args, label, timeoutMs = 360_000) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: '/',
      env: guestEnvironment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_COMMAND_OUTPUT) child.kill('SIGKILL');
      else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new AbortRefusal('E_COMMAND', `${label} could not start.`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || bytes > MAX_COMMAND_OUTPUT || code !== 0 || signal) {
        reject(new AbortRefusal('E_COMMAND', `${label} failed closed.`));
      } else {
        resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      }
    });
  });

const parseGuestCommandJson = (result, label) => {
  try {
    return JSON.parse(result.stdout.toString('utf8').trim());
  } catch {
    refuse('E_COMMAND_JSON', `${label} returned invalid JSON.`);
  }
};

const assertImmutableGuestCollector = async (
  cutover,
  deployment,
  cutoverPlanSha256,
  deploymentPlanSha256,
) => {
  const releaseRoot = `/opt/easyfire-bookkeeping/releases/${deployment.releaseCommit}`;
  const executablePath =
    `${releaseRoot}/scripts/production/direct-vm-source-abort-contract.mjs`;
  const invokedPath = await realpath(process.argv[1]);
  if (invokedPath !== executablePath) {
    refuse('E_EXECUTOR_PATH', 'Guest-isolation collector is not running from the immutable release.');
  }
  const executableMetadata = await assertSecureGuestFile(executablePath, 0o644);
  const executable = await readFile(executablePath);
  const releaseManifestPath = `${releaseRoot}/release-manifest.json`;
  const manifestDocument = await readSecureGuestJson(
    releaseManifestPath,
    'Release manifest',
    0o644,
  );
  const manifest = parseManifestBoundRelease(manifestDocument.value);
  const manifestSha256 = sha256(manifestDocument.bytes);
  const executableSha256 = sha256(executable);
  const artifact = manifest.artifacts.find(({ path: artifactPath }) =>
    artifactPath === 'scripts/production/direct-vm-source-abort-contract.mjs');
  if (
    deployment.releaseCommit !== cutover.controller.releaseCommit ||
    deployment.releaseManifest.sha256 !== cutover.controller.releaseManifestSha256 ||
    manifest.releaseCommit !== deployment.releaseCommit ||
    manifestSha256 !== deployment.releaseManifest.sha256 ||
    cutoverPlanSha256.length !== 64 || deploymentPlanSha256.length !== 64 ||
    executableSha256 !== cutover.controller.abortContractSha256 ||
    !artifact || artifact.sha256 !== executableSha256 ||
    artifact.bytes !== executableMetadata.size || artifact.mode !== '0644'
  ) refuse('E_EXECUTOR_HASH', 'Guest-isolation collector is not an exact manifest-bound artifact.');
  return {
    releaseRoot,
    executablePath,
    executableSha256,
    releaseManifestSha256: manifestSha256,
  };
};

const validateRollbackArmedReceipt = (receipt, lock, lockSha256) => {
  exactKeys(receipt, [
    'schemaVersion', 'project', 'kind', 'status', 'lockId', 'reason',
    'completedAt', 'lockSha256', 'deployment', 'proof',
  ], 'Rollback armed receipt');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.project !== 'easyfire-bookkeeping-prod' ||
    receipt.kind !== 'easyfire-bookkeeping-rollback-armed-receipt' ||
    receipt.status !== 'locked-verified' || receipt.reason !== 'rollback' ||
    receipt.lockId !== lock.lockId || receipt.lockSha256 !== lockSha256 ||
    JSON.stringify(receipt.deployment) !== JSON.stringify(lock.deployment) ||
    receipt.proof?.migrationExitCode !== 0 ||
    receipt.proof?.resourcesPreserved !== true ||
    JSON.stringify(receipt.proof?.stoppedContainers) !==
      JSON.stringify(ALL_RUNTIME_CONTAINERS) ||
    JSON.stringify(receipt.proof?.absentListeners) !== JSON.stringify([443, 8080])
  ) refuse('E_ROLLBACK_LOCK', 'Rollback armed receipt is incomplete or unbound.');
  date(receipt.completedAt, 'Rollback armed completion time');
  return receipt;
};

const DOCKER_INSPECT_FORMAT = [
  '[{{json .Id}}', '{{json .Image}}', '{{json .Name}}',
  '{{json .State.Running}}', '{{json .State.Status}}', '{{json .State.ExitCode}}',
  '{{json .HostConfig.RestartPolicy.Name}}',
  '{{json (index .Config.Labels "com.docker.compose.project")}}',
  '{{json (index .Config.Labels "com.docker.compose.service")}}]',
].join(',');

const collectStoppedContainers = async (resources, migration) => {
  const result = await runGuestCommand(DOCKER, [
    'container', 'inspect', '--format', DOCKER_INSPECT_FORMAT,
    ...GUEST_CONTAINER_NAMES,
  ], 'Docker stopped-runtime readback');
  const lines = result.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== GUEST_CONTAINER_NAMES.length) {
    refuse('E_GUEST_CONTAINERS', 'Docker returned an incomplete guest runtime set.');
  }
  const inspections = lines.map((line, index) => {
    let values;
    try { values = JSON.parse(line); }
    catch { refuse('E_COMMAND_JSON', `Docker inspection ${index} is invalid.`); }
    if (!Array.isArray(values) || values.length !== 9) {
      refuse('E_COMMAND_JSON', `Docker inspection ${index} has an invalid shape.`);
    }
    const [Id, Image, Name, Running, Status, ExitCode, RestartPolicy, project, service] = values;
    if (
      typeof Id !== 'string' || !SHA256.test(Id) ||
      typeof Image !== 'string' || !IMAGE_ID.test(Image) ||
      typeof Name !== 'string' || typeof Running !== 'boolean' ||
      typeof Status !== 'string' || !Number.isInteger(ExitCode) ||
      typeof RestartPolicy !== 'string' || typeof project !== 'string' ||
      typeof service !== 'string'
    ) refuse('E_COMMAND_JSON', `Docker inspection ${index} contains invalid values.`);
    return {
      Id,
      Image,
      Name,
      State: { Running, Status, ExitCode },
      HostConfig: { RestartPolicy: { Name: RestartPolicy } },
      Config: { Labels: {
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
      } },
    };
  });
  validateStoppedRuntime(inspections, resources, migration);
  const byName = new Map(inspections.map((entry) => [entry.Name.replace(/^\//, ''), entry]));
  return GUEST_CONTAINER_NAMES.map((name) => {
    const entry = byName.get(name);
    if (!entry) refuse('E_GUEST_CONTAINERS', `Required guest container is absent: ${name}`);
    return {
      name,
      id: entry.Id,
      imageId: entry.Image,
      running: entry.State.Running,
      state: entry.State.Status,
      restartPolicy: entry.HostConfig.RestartPolicy.Name,
    };
  });
};

const collectInactiveUnits = async () => {
  const unitStates = {};
  for (const unit of [
    'easyfire-bookkeeping-stack.service',
    'easyfire-bookkeeping-guardian.service',
    'easyfire-bookkeeping-guardian.timer',
  ]) {
    const result = await runGuestCommand(SYSTEMCTL, [
      'show', '--property=ActiveState', '--value', unit,
    ], `systemd ${unit} readback`);
    unitStates[unit] = result.stdout.toString('utf8').trim();
    if (unitStates[unit] !== 'inactive') {
      refuse('E_UNIT_ACTIVE', `Guest unit is not inactive: ${unit}`);
    }
  }
  return unitStates;
};

const collectPreActivationNetwork = async () => {
  const version = await runGuestCommand(TAILSCALE, ['version'], 'Tailscale version');
  const status = await runGuestCommand(TAILSCALE, ['status', '--json'], 'Tailscale status');
  const serve = await runGuestCommand(
    TAILSCALE,
    ['serve', 'status', '--json'],
    'Tailscale Serve status',
  );
  const funnel = await runGuestCommand(
    TAILSCALE,
    ['funnel', 'status', '--json'],
    'Tailscale Funnel status',
  );
  const listeners = await runGuestCommand(SS, ['-H', '-ltn'], 'Host listener status');
  const tailscaleVersion = validateTailscaleVersion(version.stdout.toString('utf8'));
  const listeningPorts = parseListeningPorts(listeners.stdout.toString('utf8'));
  const validated = validatePreActivationNetwork({
    tailscaleStatus: parseGuestCommandJson(status, 'Tailscale status'),
    serveStatus: parseGuestCommandJson(serve, 'Tailscale Serve status'),
    funnelStatus: parseGuestCommandJson(funnel, 'Tailscale Funnel status'),
    listeningPorts,
  });
  if (listeningPorts.includes(8080)) {
    refuse('E_PUBLIC_EXPOSURE', 'Guest origin port 8080 is still listening.');
  }
  return {
    evidence: {
      tailscaleServeAbsent: validated.serveAbsent,
      tailscaleFunnelAbsent: validated.funnelAbsent,
      targetRouteAbsent: true,
      originPort8080Absent: true,
      publicPort443Absent: true,
      publicListeners: [],
    },
    proof: {
      tailscaleVersion,
      statusSha256: sha256(status.stdout),
      serveStatusSha256: sha256(serve.stdout),
      funnelStatusSha256: sha256(funnel.stdout),
      listenersSha256: sha256(listeners.stdout),
      listeningPorts,
    },
  };
};

const writeGuestEvidenceExclusive = async (value) => {
  const directory = path.dirname(GUEST_ISOLATION_OUTPUT);
  if (await realpath(directory).catch(() => null) !== directory) {
    refuse('E_FILE_AUTHORITY', 'Guest-isolation output directory is non-canonical.');
  }
  const directoryMetadata = await lstat(directory);
  if (
    !directoryMetadata.isDirectory() || directoryMetadata.uid !== 0 ||
    ((directoryMetadata.mode & 0o777) & 0o022) !== 0
  ) refuse('E_FILE_AUTHORITY', 'Guest-isolation output directory authority is unsafe.');
  let handle;
  try {
    handle = await open(
      GUEST_ISOLATION_OUTPUT,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      refuse('E_OUTPUT_EXISTS', 'Guest-isolation evidence already exists.');
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
  const published = await assertSecureGuestFile(GUEST_ISOLATION_OUTPUT, 0o600);
  if (published.size < 2) refuse('E_OUTPUT', 'Guest-isolation evidence publication failed.');
  const directoryHandle = await open(directory, constants.O_RDONLY);
  try { await directoryHandle.sync(); }
  finally { await directoryHandle.close(); }
};

export async function collectGuestPreActivationIsolation() {
  ensureGuestCollectorRoot();
  await assertGuestPathAbsent(GUEST_ISOLATION_OUTPUT, 'Guest-isolation output');
  const cutoverDocument = await readSecureGuestJson(CUTOVER_PLAN_PATH, 'Cutover plan');
  const sourceDocument = await readSecureGuestJson(SOURCE_RECEIPT_PATH, 'Source quiesce receipt');
  const bindingDocument = await readSecureGuestJson(
    CHECKPOINT_BINDING_PATH,
    'Checkpoint binding',
  );
  const deploymentDocument = await readSecureGuestJson(FIXED_PLAN_PATH, 'Deployment plan');
  const runtimeManifestDocument = await readSecureGuestJson(
    RUNTIME_MANIFEST_PATH,
    'Runtime manifest',
  );
  const cutover = validateCutoverPlan(cutoverDocument.value);
  const cutoverPlanSha256 = sha256(cutoverDocument.bytes);
  const sourceReceiptSha256 = sha256(sourceDocument.bytes);
  const checkpointBindingSha256 = sha256(bindingDocument.bytes);
  validateSourceQuiesceReceipt(sourceDocument.value, cutover, cutoverPlanSha256);
  const binding = validateCheckpointBinding(
    bindingDocument.value,
    cutover,
    sourceReceiptSha256,
  );
  const deployment = validateDeploymentPlan(deploymentDocument.value);
  const deploymentPlanSha256 = sha256(deploymentDocument.bytes);
  if (
    deployment.releaseCommit !== cutover.controller.releaseCommit ||
    deployment.releaseManifest.sha256 !== cutover.controller.releaseManifestSha256 ||
    deployment.checkpoint.manifestSha256 !== binding.checkpoint.manifestSha256
  ) refuse('E_DEPLOYMENT_BINDING', 'Guest deployment is not cutover and checkpoint bound.');
  const inputs = await collectBoundInputs(FIXED_PLAN_PATH, { fixedPlan: true });
  if (inputs.planSha256 !== deploymentPlanSha256) {
    refuse('E_DEPLOYMENT_BINDING', 'Verified deployment plan bytes changed during collection.');
  }
  const chain = await readVerifiedDeploymentChain(inputs);
  if (sha256(runtimeManifestDocument.bytes) !== chain.deploymentReceipt.runtimeManifestSha256) {
    refuse('E_DEPLOYMENT_BINDING', 'Runtime manifest is not deployment-receipt-bound.');
  }
  const authority = {
    deploymentId: deployment.deploymentId,
    releaseCommit: deployment.releaseCommit,
    planSha256: deploymentPlanSha256,
    deploymentReceiptSha256: chain.deploymentReceiptSha256,
  };
  const executor = await assertImmutableGuestCollector(
    cutover,
    deployment,
    cutoverPlanSha256,
    deploymentPlanSha256,
  );
  const lockDocument = await readSecureGuestJson(ROLLBACK_LOCK_PATH, 'Rollback lock');
  const lock = validateLockDocument(lockDocument.value);
  if (lock.reason !== 'rollback') {
    refuse('E_ROLLBACK_LOCK', 'Source abort requires an irreversible rollback lock.');
  }
  validateLockAgainstAuthority(lock, authority);
  const lockSha256 = sha256(lockDocument.bytes);
  const armedReceiptPath = `${lock.evidenceDirectory}/armed.json`;
  const armedDocument = await readSecureGuestJson(armedReceiptPath, 'Rollback armed receipt');
  validateRollbackArmedReceipt(armedDocument.value, lock, lockSha256);
  await assertActivationBoundaryAbsent();

  const rollbackVerification = parseGuestCommandJson(
    await runGuestCommand(
      NODE,
      [ROLLBACK_CONTROLLER, '--verify-locked'],
      'Live rollback-lock verification',
    ),
    'Live rollback-lock verification',
  );
  exactKeys(rollbackVerification, [
    'ok', 'mode', 'deploymentId', 'reason',
  ], 'Live rollback-lock verification');
  if (
    rollbackVerification.ok !== true ||
    rollbackVerification.mode !== 'verify-locked' ||
    rollbackVerification.deploymentId !== deployment.deploymentId ||
    rollbackVerification.reason !== 'rollback'
  ) refuse('E_ROLLBACK_LOCK', 'Live rollback-lock verification is invalid.');
  const lockReadback = await readSecureGuestJson(ROLLBACK_LOCK_PATH, 'Rollback lock readback');
  if (sha256(lockReadback.bytes) !== lockSha256) {
    refuse('E_ROLLBACK_LOCK', 'Rollback lock changed during live verification.');
  }

  const containers = await collectStoppedContainers(chain.evidence.resources, chain.migration);
  const unitStates = await collectInactiveUnits();
  const network = await collectPreActivationNetwork();
  const activationState = await assertActivationBoundaryAbsent();
  const decisionAuthoritySha256 = sha256(canonicalJson({
    cutoverPlanSha256,
    sourceReceiptSha256,
    checkpointBindingSha256,
    deploymentPlanSha256,
    deploymentReceiptSha256: chain.deploymentReceiptSha256,
    rollbackLockSha256: lockSha256,
    rollbackArmedSha256: sha256(armedDocument.bytes),
    collectorExecutableSha256: executor.executableSha256,
  }));
  const decisionClaim = await claimCutoverDecision(buildCutoverDecisionClaim({
    decision: 'abort',
    cutoverId: cutover.cutoverId,
    deploymentId: deployment.deploymentId,
    releaseCommit: deployment.releaseCommit,
    authoritySha256: decisionAuthoritySha256,
  }));
  const firstWriteAuthority = {
    ...activationState,
    cutoverDecision: decisionClaim.document.decision,
    cutoverDecisionClaimSha256: decisionClaim.sha256,
  };
  const collectedAt = new Date().toISOString();
  const evidence = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-guest-pre-activation-isolation',
    status: 'locked-verified',
    cutoverId: cutover.cutoverId,
    collectedAt,
    sourceQuiesceReceiptSha256,
    checkpointBindingSha256,
    collector: {
      schemaVersion: 1,
      kind: 'easyfire-bookkeeping-release-bound-guest-isolation-collector',
      sourceReleasePath: executor.releaseRoot,
      executablePath: executor.executablePath,
      executableSha256: executor.executableSha256,
      releaseManifestSha256: executor.releaseManifestSha256,
      cutoverPlanSha256,
      deploymentPlanSha256,
      deploymentReceiptSha256: chain.deploymentReceiptSha256,
      outputPath: GUEST_ISOLATION_OUTPUT,
      decisionClaim: {
        path: CUTOVER_DECISION_PATH,
        sha256: decisionClaim.sha256,
        decision: decisionClaim.document.decision,
        claimedAt: decisionClaim.document.claimedAt,
        authoritySha256: decisionClaim.document.authoritySha256,
      },
      outputPublishedCreateNew: true,
      rootOwnedSecureFilesVerified: true,
      liveRollbackVerificationPassed: true,
      liveReadbacksVerified: true,
    },
    guest: {
      vmName: TARGET_VM,
      deploymentId: deployment.deploymentId,
      releaseCommit: deployment.releaseCommit,
      accountingDataAuthority: 'windows-final-checkpoint',
      firstUserWriteAuthority,
      rollbackLock: {
        present: true,
        reason: lock.reason,
        path: ROLLBACK_LOCK_PATH,
        lockSha256,
        receiptPath: armedReceiptPath,
        receiptSha256: sha256(armedDocument.bytes),
      },
      containers,
      network: network.evidence,
      activation: {
        activationLockAbsent: activationState.activationLockAbsent,
        authorizationAbsent: activationState.authorizationAbsent,
        receiptAbsent: activationState.receiptAbsent,
      },
      preservation: {
        volumesPreserved: true,
        releasesPreserved: true,
        backupsPreserved: true,
        noResourcesDeleted: true,
      },
    },
    proofFiles: {
      cutoverPlan: cutoverPlanSha256,
      sourceQuiesceReceipt: sourceReceiptSha256,
      checkpointBinding: checkpointBindingSha256,
      deploymentPlan: deploymentPlanSha256,
      deploymentReceipt: chain.deploymentReceiptSha256,
      runtimeManifest: sha256(runtimeManifestDocument.bytes),
      rollbackLock: lockSha256,
      rollbackArmed: sha256(armedDocument.bytes),
      containerState: sha256(canonicalJson(containers)),
      networkState: sha256(canonicalJson(network.proof)),
      activationState: sha256(canonicalJson({ firstWriteAuthority, unitStates })),
      cutoverDecisionClaim: decisionClaim.sha256,
      collectorExecutable: executor.executableSha256,
      releaseManifest: executor.releaseManifestSha256,
    },
  };
  validateGuestPreActivationIsolation(
    evidence,
    cutover,
    cutoverPlanSha256,
    sourceReceiptSha256,
    checkpointBindingSha256,
    new Date(collectedAt),
  );
  await assertActivationBoundaryAbsent();
  await writeGuestEvidenceExclusive(evidence);
  return evidence;
}

export function planSourceAbortActions(planCandidate) {
  const plan = validateCutoverPlan(planCandidate);
  const stateless = plan.source.expectedInitialSnapshot.containers.filter(
    ({ tier }) => tier === 'stateless',
  );
  return [
    ...stateless.map((container) => ({
      kind: 'docker-start',
      name: container.name,
      containerId: container.id,
    })),
    {
      kind: 'launch-private-route',
      name: 'hash-pinned-private-launcher',
      path: plan.controller.privateLauncherPath,
      sha256: plan.controller.privateLauncherSha256,
      childSha256: plan.controller.privateLauncherChildSha256,
    },
    ...stateless.map((container) => ({
      kind: 'docker-restore-restart-policy',
      name: container.name,
      containerId: container.id,
      restartPolicy: container.restartPolicy,
      maximumRetryCount: container.maximumRetryCount,
    })),
  ];
}

export function validateSourceRearmSnapshot(candidate, planCandidate) {
  const plan = validateCutoverPlan(planCandidate);
  const snapshot = object(candidate, 'Source rearm snapshot');
  rejectSensitiveKeys(snapshot);
  exactKeys(snapshot, [
    'schemaVersion', 'project', 'kind', 'status', 'cutoverId', 'capturedAt', 'host',
    'containers', 'scheduledTasks', 'tunnel', 'privateRoute', 'endpoint', 'preservation',
  ], 'Source rearm snapshot');
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.project !== PROJECT ||
    snapshot.kind !== 'easyfire-bookkeeping-source-pre-activation-abort-snapshot' ||
    snapshot.status !== 'rearmed-private-verified' ||
    snapshot.cutoverId !== plan.cutoverId ||
    snapshot.host !== SOURCE_HOST
  ) refuse('E_REARM_SNAPSHOT', 'Source rearm snapshot identity is invalid.');
  date(snapshot.capturedAt, 'Source rearm capturedAt');
  const expectedContainers = plan.source.expectedInitialSnapshot.containers;
  if (!Array.isArray(snapshot.containers) || snapshot.containers.length !== expectedContainers.length) {
    refuse('E_REARM_CONTAINERS', 'Source rearm must prove exactly eight source containers.');
  }
  snapshot.containers.forEach((container, index) => {
    exactKeys(container, [
      'role', 'tier', 'name', 'id', 'imageId', 'running', 'state', 'health',
      'restartPolicy', 'maximumRetryCount',
    ], `Rearmed source container ${index}`);
    const expected = expectedContainers[index];
    if (
      container.role !== expected.role ||
      container.tier !== expected.tier ||
      container.name !== expected.name ||
      container.id !== expected.id ||
      container.imageId !== expected.imageId ||
      container.running !== true ||
      container.state !== 'running' ||
      container.restartPolicy !== expected.restartPolicy ||
      container.maximumRetryCount !== expected.maximumRetryCount ||
      (container.tier === 'data' && container.health !== 'healthy') ||
      !['healthy', 'none'].includes(container.health)
    ) refuse('E_REARM_CONTAINERS', `Rearmed source container ${index} drifted or is unhealthy.`);
  });

  const expectedTasks = plan.source.expectedInitialSnapshot.scheduledTasks;
  if (!Array.isArray(snapshot.scheduledTasks) || snapshot.scheduledTasks.length !== expectedTasks.length) {
    refuse('E_REARM_TASKS', 'Source rearm task proof is incomplete.');
  }
  snapshot.scheduledTasks.forEach((task, index) => {
    exactKeys(task, ['name', 'enabled', 'state', 'xmlSha256'], `Rearmed legacy task ${index}`);
    if (
      task.name !== expectedTasks[index].name ||
      task.xmlSha256 !== expectedTasks[index].xmlSha256 ||
      task.enabled !== false ||
      task.state === 'Running'
    ) refuse('E_REARM_TASKS', `Legacy task ${index} was re-enabled or changed.`);
  });
  exactKeys(snapshot.tunnel, [
    'serviceName', 'state', 'startMode', 'processId', 'processPresent',
  ], 'Rearmed tunnel state');
  if (
    snapshot.tunnel.serviceName !== 'EasyFireBookkeepingCloudflared' ||
    snapshot.tunnel.state !== 'Stopped' ||
    snapshot.tunnel.startMode !== 'Disabled' ||
    snapshot.tunnel.processId !== 0 ||
    snapshot.tunnel.processPresent !== false
  ) refuse('E_PUBLIC_EXPOSURE', 'Cloudflare tunnel must remain stopped and disabled.');
  exactKeys(snapshot.privateRoute, [
    'kind', 'processId', 'executablePath', 'executableSha256', 'commandLineSha256',
    'launcherPath', 'launcherSha256', 'launcherChildSha256', 'listenerAddress',
    'listenerPort', 'processPresent', 'listenerPresent',
  ], 'Rearmed private route');
  if (
    snapshot.privateRoute.kind !== 'hash-pinned-private-launcher' ||
    snapshot.privateRoute.launcherPath !== PRIVATE_SOURCE_LAUNCHER ||
    snapshot.privateRoute.launcherSha256 !== PRIVATE_SOURCE_LAUNCHER_SHA256 ||
    snapshot.privateRoute.launcherChildSha256 !== PRIVATE_SOURCE_LAUNCHER_CHILD_SHA256 ||
    snapshot.privateRoute.listenerAddress !== '100.84.66.30' ||
    snapshot.privateRoute.listenerPort !== 25186 ||
    snapshot.privateRoute.processId < 1 ||
    snapshot.privateRoute.processPresent !== true ||
    snapshot.privateRoute.listenerPresent !== true ||
    !/\\(?:powershell|pwsh)\.exe$/i.test(snapshot.privateRoute.executablePath)
  ) refuse('E_REARM_ROUTE', 'The private source route was not restored by the pinned launcher.');
  hash(snapshot.privateRoute.executableSha256, 'Rearmed route executable hash');
  hash(snapshot.privateRoute.commandLineSha256, 'Rearmed route command-line hash');
  exactKeys(snapshot.endpoint, ['listenerProcessId', 'probes'], 'Rearmed endpoint');
  if (
    snapshot.endpoint.listenerProcessId !== snapshot.privateRoute.processId ||
    !Array.isArray(snapshot.endpoint.probes) ||
    snapshot.endpoint.probes.length !== 3
  ) refuse('E_REARM_ENDPOINT', 'Rearmed endpoint listener proof is invalid.');
  const expectedUris = [
    'http://100.84.66.30:25186/',
    'http://100.84.66.30:25186/api/system_db',
    'http://100.84.66.30:25186/api/auth/meta',
  ];
  snapshot.endpoint.probes.forEach((probe, index) => {
    exactKeys(probe, ['uri', 'statusCode'], `Rearmed endpoint probe ${index}`);
    if (probe.uri !== expectedUris[index] || probe.statusCode !== 200) {
      refuse('E_REARM_ENDPOINT', `Rearmed endpoint probe ${index} failed.`);
    }
  });
  exactKeys(snapshot.preservation, [
    'dataVolumesPreserved', 'releasesPreserved', 'backupsPreserved',
    'guestStoppedAndLocked', 'noResourcesDeleted', 'publicExposureAbsent',
  ], 'Source rearm preservation');
  Object.entries(snapshot.preservation).forEach(([key, value]) => trueOnly(value, `Source rearm preservation ${key}`));
  return snapshot;
}

export function buildSourceAbortReceipt({
  plan: planCandidate,
  planSha256,
  sourceQuiesceReceipt,
  sourceQuiesceReceiptSha256,
  checkpointBinding,
  checkpointBindingSha256,
  guestIsolationEvidence,
  guestIsolationEvidenceSha256,
  sourceRearmSnapshot,
  sourceRearmSnapshotSha256,
  abortedAt,
}) {
  const plan = validateCutoverPlan(planCandidate);
  hash(planSha256, 'Cutover plan hash');
  hash(sourceQuiesceReceiptSha256, 'Source quiesce receipt hash');
  validateSourceQuiesceReceipt(sourceQuiesceReceipt, plan, planSha256);
  hash(checkpointBindingSha256, 'Checkpoint binding hash');
  validateCheckpointBinding(checkpointBinding, plan, sourceQuiesceReceiptSha256);
  hash(guestIsolationEvidenceSha256, 'Guest isolation evidence hash');
  const evidence = validateGuestPreActivationIsolation(
    guestIsolationEvidence,
    plan,
    planSha256,
    sourceQuiesceReceiptSha256,
    checkpointBindingSha256,
    new Date(abortedAt),
  );
  hash(sourceRearmSnapshotSha256, 'Source rearm snapshot hash');
  const snapshot = validateSourceRearmSnapshot(sourceRearmSnapshot, plan);
  date(abortedAt, 'Source abort completion time');
  if (
    Date.parse(abortedAt) < Date.parse(evidence.collectedAt) ||
    Date.parse(abortedAt) < Date.parse(snapshot.capturedAt)
  ) refuse('E_ABORT_ORDER', 'Source abort receipt chronology is invalid.');
  const receipt = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-source-pre-activation-abort-receipt',
    status: 'windows-source-rearmed-private',
    cutoverId: plan.cutoverId,
    abortedAt,
    planSha256,
    sourceQuiesceReceiptSha256,
    checkpointBindingSha256,
    guestIsolationEvidenceSha256,
    sourceRearmSnapshotSha256,
    guest: {
      vmName: evidence.guest.vmName,
      deploymentId: evidence.guest.deploymentId,
      rollbackLockReceiptSha256: evidence.guest.rollbackLock.receiptSha256,
      firstUserWriteAuthority: {
        ...evidence.guest.firstUserWriteAuthority,
        collectorExecutableSha256: evidence.collector.executableSha256,
        guestIsolationEvidenceSha256,
      },
      containersStoppedAndRestartLocked: true,
      routeAbsent: true,
      activationArtifactsAbsent: true,
    },
    source: {
      statelessContainersRearmed: [...STATELESS_CONTAINER_NAMES],
      privateLauncherPath: PRIVATE_SOURCE_LAUNCHER,
      privateLauncherSha256: PRIVATE_SOURCE_LAUNCHER_SHA256,
      privateLauncherChildSha256: PRIVATE_SOURCE_LAUNCHER_CHILD_SHA256,
      privateListener: '100.84.66.30:25186',
      legacyTasksRemainDisabled: true,
      cloudflareRemainsDisabled: true,
    },
    policy: {
      activationPermanentlyRefusedForCutoverId: true,
      staleWindowsRollbackAfterGuestWriteForbidden: true,
      postWriteRollbackRequiresFreshGuestBackupRestoreAndReverseMigration: true,
    },
    preservation: {
      windowsVolumesPreserved: true,
      windowsReleasesPreserved: true,
      windowsBackupsPreserved: true,
      guestVolumesPreserved: true,
      noResourcesDeleted: true,
      publicExposureAbsent: true,
    },
  };
  return { ...receipt, contentSha256: sha256(canonicalJson(receipt)) };
}

export function validateSourceAbortReceipt(candidate, planCandidate) {
  const plan = validateCutoverPlan(planCandidate);
  const receipt = object(candidate, 'Source abort receipt');
  rejectSensitiveKeys(receipt);
  exactKeys(receipt, [
    'schemaVersion', 'project', 'kind', 'status', 'cutoverId', 'abortedAt',
    'planSha256', 'sourceQuiesceReceiptSha256', 'checkpointBindingSha256',
    'guestIsolationEvidenceSha256', 'sourceRearmSnapshotSha256', 'guest',
    'source', 'policy', 'preservation', 'contentSha256',
  ], 'Source abort receipt');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.project !== PROJECT ||
    receipt.kind !== 'easyfire-bookkeeping-source-pre-activation-abort-receipt' ||
    receipt.status !== 'windows-source-rearmed-private' ||
    receipt.cutoverId !== plan.cutoverId
  ) refuse('E_ABORT_RECEIPT', 'Source abort receipt identity is invalid.');
  date(receipt.abortedAt, 'Source abort receipt abortedAt');
  for (const field of [
    'planSha256', 'sourceQuiesceReceiptSha256', 'checkpointBindingSha256',
    'guestIsolationEvidenceSha256', 'sourceRearmSnapshotSha256', 'contentSha256',
  ]) hash(receipt[field], `Source abort receipt ${field}`);
  if (!safeHashEqual(
    receipt.contentSha256,
    sha256(canonicalJson(contentWithoutHash(receipt))),
  )) refuse('E_ABORT_RECEIPT', 'Source abort receipt content hash is invalid.');
  exactKeys(receipt.guest, [
    'vmName', 'deploymentId', 'rollbackLockReceiptSha256',
    'firstUserWriteAuthority', 'containersStoppedAndRestartLocked',
    'routeAbsent', 'activationArtifactsAbsent',
  ], 'Source abort receipt guest proof');
  exactKeys(receipt.guest.firstUserWriteAuthority, [
    'status', 'activationLockAbsent', 'authorizationAbsent', 'receiptAbsent',
    'routeAbsent', 'cutoverDecision', 'cutoverDecisionClaimSha256',
    'collectorExecutableSha256', 'guestIsolationEvidenceSha256',
  ], 'Source abort receipt first-write authority');
  hash(
    receipt.guest.firstUserWriteAuthority.collectorExecutableSha256,
    'Source abort receipt collector executable hash',
  );
  hash(
    receipt.guest.firstUserWriteAuthority.guestIsolationEvidenceSha256,
    'Source abort receipt guest-isolation evidence hash',
  );
  hash(
    receipt.guest.firstUserWriteAuthority.cutoverDecisionClaimSha256,
    'Source abort receipt cutover decision hash',
  );
  if (
    receipt.guest.firstUserWriteAuthority.status !== 'pre-activation-never-exposed' ||
    receipt.guest.firstUserWriteAuthority.activationLockAbsent !== true ||
    receipt.guest.firstUserWriteAuthority.authorizationAbsent !== true ||
    receipt.guest.firstUserWriteAuthority.receiptAbsent !== true ||
    receipt.guest.firstUserWriteAuthority.routeAbsent !== true ||
    receipt.guest.firstUserWriteAuthority.cutoverDecision !== 'abort' ||
    receipt.guest.firstUserWriteAuthority.guestIsolationEvidenceSha256 !==
      receipt.guestIsolationEvidenceSha256 ||
    receipt.guest?.containersStoppedAndRestartLocked !== true ||
    receipt.guest?.routeAbsent !== true ||
    receipt.guest?.activationArtifactsAbsent !== true ||
    receipt.source?.legacyTasksRemainDisabled !== true ||
    receipt.source?.cloudflareRemainsDisabled !== true ||
    Object.values(receipt.policy ?? {}).some((value) => value !== true) ||
    Object.values(receipt.preservation ?? {}).some((value) => value !== true)
  ) refuse('E_ABORT_RECEIPT', 'Source abort receipt proof is incomplete.');
  return receipt;
}

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) refuse('E_ARGUMENTS', 'CLI arguments are invalid.');
    if (Object.hasOwn(options, key.slice(2))) refuse('E_ARGUMENTS', `Duplicate argument: ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
};
const readJson = async (file, label) => {
  const bytes = await readFile(file);
  if (bytes.length < 2 || bytes.length > 5 * 1024 * 1024) refuse('E_FILE_SIZE', `${label} size is invalid.`);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
};
const writeExclusive = async (target, bytes) => {
  const temporary = `${target}.partial-${process.pid}`;
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, target);
  } catch (error) {
    if (error?.code === 'EEXIST') refuse('E_OUTPUT_EXISTS', 'Output already exists.');
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options.mode;
  if (mode === 'collect-guest-isolation') {
    if (Object.keys(options).length !== 1) {
      refuse('E_ARGUMENTS', 'Guest-isolation collection accepts only its fixed mode.');
    }
    const evidence = await collectGuestPreActivationIsolation();
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      deploymentId: evidence.guest.deploymentId,
      output: GUEST_ISOLATION_OUTPUT,
    })}\n`);
    return;
  }
  const planDocument = await readJson(options.plan, 'Cutover plan');
  const plan = validateCutoverPlan(planDocument.value);
  if (mode === 'validate-guest-isolation' || mode === 'build-source-abort-receipt') {
    const sourceReceipt = await readJson(options['source-receipt'], 'Source quiesce receipt');
    const binding = await readJson(options['checkpoint-binding'], 'Checkpoint binding');
    const evidence = await readJson(options['guest-evidence'], 'Guest isolation evidence');
    const planHash = sha256(planDocument.bytes);
    const sourceReceiptHash = sha256(sourceReceipt.bytes);
    const bindingHash = sha256(binding.bytes);
    validateSourceQuiesceReceipt(sourceReceipt.value, plan, planHash);
    validateCheckpointBinding(binding.value, plan, sourceReceiptHash);
    const now = options['aborted-at'] ? new Date(options['aborted-at']) : new Date();
    validateGuestPreActivationIsolation(
      evidence.value,
      plan,
      planHash,
      sourceReceiptHash,
      bindingHash,
      now,
    );
    if (mode === 'validate-guest-isolation') {
      process.stdout.write(`${JSON.stringify({ status: 'locked-verified' })}\n`);
      return;
    }
    const snapshot = await readJson(options.snapshot, 'Source rearm snapshot');
    const receipt = buildSourceAbortReceipt({
      plan,
      planSha256: planHash,
      sourceQuiesceReceipt: sourceReceipt.value,
      sourceQuiesceReceiptSha256: sourceReceiptHash,
      checkpointBinding: binding.value,
      checkpointBindingSha256: bindingHash,
      guestIsolationEvidence: evidence.value,
      guestIsolationEvidenceSha256: sha256(evidence.bytes),
      sourceRearmSnapshot: snapshot.value,
      sourceRearmSnapshotSha256: sha256(snapshot.bytes),
      abortedAt: options['aborted-at'],
    });
    await writeExclusive(options.output, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
    process.stdout.write(`${JSON.stringify({ status: receipt.status, output: path.resolve(options.output) })}\n`);
    return;
  }
  if (mode === 'validate-rearm-snapshot') {
    const snapshot = await readJson(options.snapshot, 'Source rearm snapshot');
    validateSourceRearmSnapshot(snapshot.value, plan);
    process.stdout.write('{"status":"rearmed-private-verified"}\n');
    return;
  }
  if (mode === 'validate-source-abort-receipt') {
    const receipt = await readJson(options.receipt, 'Source abort receipt');
    validateSourceAbortReceipt(receipt.value, plan);
    process.stdout.write('{"status":"windows-source-rearmed-private"}\n');
    return;
  }
  refuse('E_MODE', 'Unknown source-abort contract mode.');
}

if (await isCanonicalMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.code ?? 'E_ABORT'}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
