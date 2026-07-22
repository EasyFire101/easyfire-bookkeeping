#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  collectBoundInputs,
  readVerifiedDeploymentChain,
} from './linux-deploy-authority.mjs';
import { FIXED_PLAN_PATH } from './linux-deploy-plan.mjs';
import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
import {
  collectCurrentBootGuardianProof,
  validateGuardianNormalRebootSummary,
} from './linux-guardian-boot-proof.mjs';
import { validateNativeAuthenticationProof } from './linux-native-auth-proof.mjs';
import { parseManifestBoundRelease } from './linux-release-authority-verify.mjs';
import {
  ALL_RUNTIME_CONTAINERS,
  PROJECT as ROLLBACK_PROJECT,
  validateArmedReceipt,
  validateLockDocument,
  validateLockedRebootReceipt,
} from './linux-rollback-lock.mjs';
export const PLAN_PATH =
  '/etc/easyfire-bookkeeping/rehearsal-evidence-plan.json';
export const OUTPUT = '/etc/easyfire-bookkeeping/rehearsal-evidence.json';
export const PROOF_ROOT = '/etc/easyfire-bookkeeping/rehearsal-proof';
export const GUARDIAN_PROOF = `${PROOF_ROOT}/guardian-runtime.json`;
export const RECOVERY_PROOF = `${PROOF_ROOT}/runtime-recovery.json`;
export const NORMAL_REBOOT_MARKER = `${PROOF_ROOT}/normal-reboot-marker.json`;
export const NORMAL_REBOOT_PROOF = `${PROOF_ROOT}/normal-reboot.json`;
const PROJECT = 'easyfire-bookkeeping';
const REHEARSAL_HOST = 'easyfire-bookkeeping-rehearsal-newsec';
const DEPLOY_CONTROLLER =
  '/opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs';
const GUARDIAN = '/opt/easyfire-bookkeeping/guardian/guardian.js';
const GUARDIAN_CONFIG = '/etc/easyfire-bookkeeping/guardian.json';
const RUNTIME_MANIFEST = '/etc/easyfire-bookkeeping/runtime-manifest.json';
const DEPLOYMENT_RECEIPT = '/etc/easyfire-bookkeeping/deployment-receipt.json';
const NODE = '/usr/local/bin/node';
const DOCKER = '/usr/bin/docker';
const SYSTEMCTL = '/usr/bin/systemctl';
const TAILSCALE = '/usr/bin/tailscale';
const SS = '/usr/bin/ss';
const MACHINE_ID = '/etc/machine-id';
const BOOT_ID = '/proc/sys/kernel/random/boot_id';
const STACK_UNIT = 'easyfire-bookkeeping-stack.service';
const GUARDIAN_TIMER = 'easyfire-bookkeeping-guardian.timer';
const GUARDIAN_SERVICE = 'easyfire-bookkeeping-guardian.service';
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID = /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
export class RehearsalEvidenceRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RehearsalEvidenceRefusal';
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new RehearsalEvidenceRefusal(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, label) => {
  if (!isObject(value)) refuse('E_SHAPE', `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    refuse('E_SHAPE', `${label} has missing or unexpected fields.`);
  }
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const requireSha = (value, label) => {
  if (typeof value !== 'string' || !SHA.test(value)) {
    refuse('E_HASH', `${label} is invalid.`);
  }
};
const requireTime = (value, label) => {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    refuse('E_TIME', `${label} is invalid.`);
  }
};
const requireBootId = (value, label) => {
  if (!UUID.test(value ?? '')) refuse('E_BOOT_ID', `${label} is invalid.`);
};
export function validateRehearsalPlan(candidate) {
  const plan = candidate;
  exactKeys(
    plan,
    [
      'schemaVersion',
      'project',
      'kind',
      'rehearsalId',
      'createdAt',
      'host',
      'release',
      'deployment',
      'rollback',
      'authenticationProofPath',
      'outputPath',
    ],
    'Linux rehearsal plan',
  );
  if (
    plan.schemaVersion !== 1 ||
    plan.project !== PROJECT ||
    plan.kind !== 'easyfire-bookkeeping-linux-rehearsal-plan' ||
    !UUID.test(plan.rehearsalId ?? '')
  ) {
    refuse('E_PLAN', 'Linux rehearsal plan identity is invalid.');
  }
  requireTime(plan.createdAt, 'Linux rehearsal plan createdAt');
  exactKeys(
    plan.host,
    ['hostname', 'machineIdSha256', 'productionMachineIdSha256'],
    'Linux rehearsal host',
  );
  if (
    plan.host.hostname !== REHEARSAL_HOST ||
    plan.host.machineIdSha256 === plan.host.productionMachineIdSha256
  ) {
    refuse('E_HOST_ISOLATION', 'Rehearsal hostname or machine isolation is invalid.');
  }
  requireSha(plan.host.machineIdSha256, 'Rehearsal machine identity');
  requireSha(plan.host.productionMachineIdSha256, 'Production machine identity');

  exactKeys(
    plan.release,
    [
      'releaseCommit',
      'releasePath',
      'releaseManifestPath',
      'releaseManifestSha256',
    ],
    'Linux rehearsal release',
  );
  if (
    !COMMIT.test(plan.release.releaseCommit ?? '') ||
    plan.release.releasePath !==
      `/opt/easyfire-bookkeeping/releases/${plan.release.releaseCommit}` ||
    plan.release.releaseManifestPath !==
      `${plan.release.releasePath}/release-manifest.json`
  ) {
    refuse('E_RELEASE', 'Linux rehearsal release authority is invalid.');
  }
  requireSha(plan.release.releaseManifestSha256, 'Release manifest hash');

  exactKeys(
    plan.deployment,
    [
      'deploymentId',
      'planPath',
      'planSha256',
      'receiptPath',
      'receiptSha256',
    ],
    'Linux rehearsal deployment',
  );
  if (
    !DEPLOYMENT_ID.test(plan.deployment.deploymentId ?? '') ||
    plan.deployment.planPath !== FIXED_PLAN_PATH ||
    plan.deployment.receiptPath !== DEPLOYMENT_RECEIPT
  ) {
    refuse('E_DEPLOYMENT', 'Linux rehearsal deployment authority is invalid.');
  }
  requireSha(plan.deployment.planSha256, 'Rehearsal deployment plan hash');
  requireSha(plan.deployment.receiptSha256, 'Rehearsal deployment receipt hash');

  exactKeys(
    plan.rollback,
    ['armedReceiptPath', 'lockedRebootReceiptPath', 'rearmReceiptPath'],
    'Linux rehearsal rollback paths',
  );
  const match = new RegExp(
    `^/etc/easyfire-bookkeeping/rollback-evidence/rehearsals/${plan.deployment.deploymentId}/([a-f0-9-]+)/armed\\.json$`,
  ).exec(plan.rollback.armedReceiptPath);
  if (
    !match ||
    !UUID.test(match[1]) ||
    plan.rollback.lockedRebootReceiptPath !==
      `${path.dirname(plan.rollback.armedReceiptPath)}/locked-reboot.json` ||
    plan.rollback.rearmReceiptPath !==
      `${path.dirname(plan.rollback.armedReceiptPath)}/rearm-complete.json`
  ) {
    refuse('E_ROLLBACK_PATH', 'Linux rehearsal rollback proof paths are invalid.');
  }
  if (
    plan.authenticationProofPath !==
      '/etc/easyfire-bookkeeping/activation-proof/authentication.json' ||
    plan.outputPath !== OUTPUT
  ) {
    refuse('E_PLAN_PATH', 'Linux rehearsal proof output paths are invalid.');
  }
  return structuredClone(plan);
}
const validateRollbackSummary = (rollback) => {
  exactKeys(
    rollback,
    [
      'armedReceiptSha256',
      'lockedRebootReceiptSha256',
      'rearmReceiptSha256',
      'bootIdBefore',
      'bootIdAfter',
      'lockedAt',
      'rearmedAt',
      'resourcesPreserved',
    ],
    'Rehearsal rollback summary',
  );
  for (const field of [
    'armedReceiptSha256',
    'lockedRebootReceiptSha256',
    'rearmReceiptSha256',
  ]) {
    requireSha(rollback[field], `Rehearsal rollback ${field}`);
  }
  requireBootId(rollback.bootIdBefore, 'Rollback boot before');
  requireBootId(rollback.bootIdAfter, 'Rollback boot after');
  requireTime(rollback.lockedAt, 'Rollback locked reboot time');
  requireTime(rollback.rearmedAt, 'Rollback rearm time');
  if (
    rollback.bootIdBefore === rollback.bootIdAfter ||
    Date.parse(rollback.lockedAt) > Date.parse(rollback.rearmedAt) ||
    rollback.resourcesPreserved !== true
  ) {
    refuse(
      'E_ROLLBACK',
      'Rehearsal rollback boot proof is incomplete or reordered.',
    );
  }
  return rollback;
};
const validateRecoverySummary = (recovery) => {
  exactKeys(
    recovery,
    [
      'proofSha256',
      'dockerRestart',
      'daemonFailure',
      'invalidAuthorityStart',
      'completedAt',
    ],
    'Rehearsal recovery summary',
  );
  requireSha(recovery.proofSha256, 'Recovery proof hash');
  requireTime(recovery.completedAt, 'Recovery completion time');
  exactKeys(
    recovery.dockerRestart,
    ['before', 'after', 'mainPidBefore', 'mainPidAfter', 'recovered'],
    'Docker restart proof',
  );
  requireSha(recovery.dockerRestart.before, 'Docker restart before hash');
  requireSha(recovery.dockerRestart.after, 'Docker restart after hash');
  exactKeys(
    recovery.daemonFailure,
    ['mainPidBefore', 'mainPidAfter', 'failureObserved', 'recovered'],
    'Daemon failure proof',
  );
  exactKeys(
    recovery.invalidAuthorityStart,
    [
      'refused',
      'originalReceiptSha256',
      'invalidReceiptSha256',
      'originalReceiptRestored',
    ],
    'Invalid authority start proof',
  );
  if (
    !/^[1-9][0-9]*$/.test(recovery.dockerRestart.mainPidBefore ?? '') ||
    !/^[1-9][0-9]*$/.test(recovery.dockerRestart.mainPidAfter ?? '') ||
    recovery.dockerRestart.mainPidBefore === recovery.dockerRestart.mainPidAfter ||
    recovery.dockerRestart.recovered !== true ||
    !/^[1-9][0-9]*$/.test(recovery.daemonFailure.mainPidBefore ?? '') ||
    !/^[1-9][0-9]*$/.test(recovery.daemonFailure.mainPidAfter ?? '') ||
    recovery.daemonFailure.mainPidBefore === recovery.daemonFailure.mainPidAfter ||
    recovery.daemonFailure.failureObserved !== true ||
    recovery.daemonFailure.recovered !== true ||
    recovery.invalidAuthorityStart.refused !== true ||
    recovery.invalidAuthorityStart.originalReceiptRestored !== true
  ) {
    refuse('E_RECOVERY', 'Rehearsal recovery proof is incomplete or unsafe.');
  }
  requireSha(
    recovery.invalidAuthorityStart.originalReceiptSha256,
    'Original deployment receipt hash',
  );
  requireSha(
    recovery.invalidAuthorityStart.invalidReceiptSha256,
    'Invalid deployment receipt hash',
  );
  return recovery;
};
const validateGuardianSummary = (guardian) => {
  exactKeys(
    guardian,
    [
      'proofSha256',
      'shadowObservationCount',
      'shadowWouldStartObserved',
      'statelessStartContainerIdSha256',
      'statelessRecoveryObserved',
      'cooldownObserved',
      'redisObserveOnlyRefusalObserved',
      'mariadbObserveOnlyRefusalObserved',
      'identityMismatchRefusalObserved',
      'finalHealthVerified',
      'completedAt',
    ],
    'Guardian rehearsal summary',
  );
  requireSha(guardian.proofSha256, 'Guardian proof hash');
  requireSha(
    guardian.statelessStartContainerIdSha256,
    'Guardian stateless target hash',
  );
  requireTime(guardian.completedAt, 'Guardian rehearsal completion time');
  if (
    guardian.shadowObservationCount !== 3 ||
    guardian.shadowWouldStartObserved !== true ||
    guardian.statelessRecoveryObserved !== true ||
    guardian.cooldownObserved !== true ||
    guardian.redisObserveOnlyRefusalObserved !== true ||
    guardian.mariadbObserveOnlyRefusalObserved !== true ||
    guardian.identityMismatchRefusalObserved !== true ||
    guardian.finalHealthVerified !== true
  ) {
    refuse('E_GUARDIAN', 'Guardian rehearsal proof is incomplete.');
  }
  return guardian;
};
const validateAuthenticationSummary = (authentication) => {
  exactKeys(
    authentication,
    [
      'proofSha256',
      'method',
      'ownerConfirmed',
      'authenticatedApiPassed',
      'dataInvariantsPassed',
      'secretMaterialPersisted',
      'completedAt',
    ],
    'Rehearsal authentication summary',
  );
  requireSha(authentication.proofSha256, 'Authentication proof hash');
  requireTime(authentication.completedAt, 'Authentication proof completion time');
  if (
    authentication.method !== 'native-password-interactive' ||
    authentication.ownerConfirmed !== true ||
    authentication.authenticatedApiPassed !== true ||
    authentication.dataInvariantsPassed !== true ||
    authentication.secretMaterialPersisted !== false
  ) {
    refuse('E_AUTHENTICATION', 'Rehearsal native authentication proof is incomplete.');
  }
  return authentication;
};
const validateRehearsalChronology = ({
  planCreatedAt, rollback, normalReboot, recovery, guardian, authentication, completedAt,
}) => {
  const bootIds = [
    rollback.bootIdBefore,
    rollback.bootIdAfter,
    normalReboot.bootIdAfter,
  ];
  const times = [
    planCreatedAt,
    rollback.lockedAt,
    rollback.rearmedAt,
    guardian.completedAt,
    recovery.completedAt,
    authentication.completedAt,
    normalReboot.completedAt,
    completedAt,
  ].map(Date.parse);
  if (
    normalReboot.bootIdBefore !== rollback.bootIdAfter ||
    new Set(bootIds).size !== bootIds.length ||
    times.some((value, index) => index > 0 && value < times[index - 1])
  ) refuse('E_CHRONOLOGY', 'Rehearsal reboot transitions or proof order are invalid.');
};
export function buildRehearsalEvidence({
  plan: planCandidate,
  collector,
  host,
  rollback,
  normalReboot,
  recovery,
  guardian,
  authentication,
  completedAt,
}) {
  const plan = validateRehearsalPlan(planCandidate);
  exactKeys(collector, ['executablePath', 'executableSha256'], 'Rehearsal collector');
  if (
    collector.executablePath !==
      `${plan.release.releasePath}/scripts/production/linux-rehearsal-evidence.mjs`
  ) {
    refuse('E_EXECUTOR', 'Rehearsal collector path is not release-bound.');
  }
  requireSha(collector.executableSha256, 'Rehearsal collector hash');
  exactKeys(host, ['hostname', 'machineIdSha256'], 'Observed rehearsal host');
  if (
    host.hostname !== plan.host.hostname ||
    host.machineIdSha256 !== plan.host.machineIdSha256
  ) {
    refuse('E_HOST_ISOLATION', 'Observed rehearsal host does not match its plan.');
  }
  validateRollbackSummary(rollback);
  validateGuardianNormalRebootSummary(normalReboot);
  validateRecoverySummary(recovery);
  validateGuardianSummary(guardian);
  validateAuthenticationSummary(authentication);
  requireTime(completedAt, 'Rehearsal evidence completion time');
  validateRehearsalChronology({
    planCreatedAt: plan.createdAt,
    rollback, normalReboot, recovery, guardian, authentication, completedAt,
  });
  return {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-linux-rehearsal-evidence',
    status: 'passed',
    rehearsalId: plan.rehearsalId,
    planCreatedAt: plan.createdAt,
    completedAt,
    host: {
      hostname: host.hostname,
      machineIdSha256: host.machineIdSha256,
      productionMachineIdSha256: plan.host.productionMachineIdSha256,
      isolatedFromProduction: true,
    },
    release: {
      releaseCommit: plan.release.releaseCommit,
      releasePath: plan.release.releasePath,
      releaseManifestSha256: plan.release.releaseManifestSha256,
      collectorPath: collector.executablePath,
      collectorSha256: collector.executableSha256,
    },
    rehearsalDeployment: {
      deploymentId: plan.deployment.deploymentId,
      planSha256: plan.deployment.planSha256,
      receiptSha256: plan.deployment.receiptSha256,
      authority: 'isolated-rehearsal-only',
    },
    rollback: structuredClone(rollback),
    normalReboot: structuredClone(normalReboot),
    recovery: structuredClone(recovery),
    guardian: structuredClone(guardian),
    authentication: structuredClone(authentication),
    scope: {
      routeActivated: false,
      publicExposure: false,
      productionDataMutationCount: 0,
      resourcesDeleted: false,
    },
  };
}
export function validateRehearsalEvidence(candidate) {
  const evidence = candidate;
  exactKeys(
    evidence,
    [
      'schemaVersion',
      'project',
      'kind',
      'status',
      'rehearsalId',
      'planCreatedAt',
      'completedAt',
      'host',
      'release',
      'rehearsalDeployment',
      'rollback',
      'normalReboot',
      'recovery',
      'guardian',
      'authentication',
      'scope',
    ],
    'Linux rehearsal evidence',
  );
  if (
    evidence.schemaVersion !== 1 ||
    evidence.project !== PROJECT ||
    evidence.kind !== 'easyfire-bookkeeping-linux-rehearsal-evidence' ||
    evidence.status !== 'passed' ||
    !UUID.test(evidence.rehearsalId ?? '') ||
    evidence.host?.hostname !== REHEARSAL_HOST ||
    evidence.host?.isolatedFromProduction !== true ||
    evidence.host?.machineIdSha256 === evidence.host?.productionMachineIdSha256 ||
    !COMMIT.test(evidence.release?.releaseCommit ?? '') ||
    evidence.release?.releasePath !==
      `/opt/easyfire-bookkeeping/releases/${evidence.release?.releaseCommit}` ||
    evidence.release?.collectorPath !==
      `${evidence.release?.releasePath}/scripts/production/linux-rehearsal-evidence.mjs` ||
    !DEPLOYMENT_ID.test(evidence.rehearsalDeployment?.deploymentId ?? '') ||
    evidence.rehearsalDeployment?.authority !== 'isolated-rehearsal-only' ||
    evidence.scope?.routeActivated !== false ||
    evidence.scope?.publicExposure !== false ||
    evidence.scope?.productionDataMutationCount !== 0 ||
    evidence.scope?.resourcesDeleted !== false
  ) {
    refuse('E_REHEARSAL_EVIDENCE', 'Linux rehearsal evidence is incomplete or unsafe.');
  }
  requireTime(evidence.planCreatedAt, 'Linux rehearsal evidence planCreatedAt');
  requireTime(evidence.completedAt, 'Linux rehearsal evidence completedAt');
  for (const value of [
    evidence.host.machineIdSha256,
    evidence.host.productionMachineIdSha256,
    evidence.release.releaseManifestSha256,
    evidence.release.collectorSha256,
    evidence.rehearsalDeployment.planSha256,
    evidence.rehearsalDeployment.receiptSha256,
  ]) requireSha(value, 'Linux rehearsal evidence hash');
  validateRollbackSummary(evidence.rollback);
  validateGuardianNormalRebootSummary(evidence.normalReboot);
  validateRecoverySummary(evidence.recovery);
  validateGuardianSummary(evidence.guardian);
  validateAuthenticationSummary(evidence.authentication);
  validateRehearsalChronology({
    planCreatedAt: evidence.planCreatedAt,
    rollback: evidence.rollback,
    normalReboot: evidence.normalReboot,
    recovery: evidence.recovery,
    guardian: evidence.guardian,
    authentication: evidence.authentication,
    completedAt: evidence.completedAt,
  });
  return evidence;
}
const assertSecureFile = async (file, mode = 0o600) => {
  const resolved = await realpath(file).catch(() => null);
  const metadata = await lstat(file).catch(() => null);
  if (
    resolved !== file ||
    !metadata?.isFile() ||
    metadata.uid !== 0 ||
    (metadata.mode & 0o777) !== mode ||
    metadata.size < 1 ||
    metadata.size > MAX_FILE
  ) {
    refuse('E_FILE_AUTHORITY', `Required rehearsal file is unsafe: ${file}`);
  }
};
const readSecureJson = async (file, mode = 0o600) => {
  await assertSecureFile(file, mode);
  const bytes = await readFile(file);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    refuse('E_JSON', `Required rehearsal file is invalid JSON: ${file}`);
  }
};
const pathExists = async (file) =>
  lstat(file).then(() => true).catch((error) => {
    if (error?.code === 'ENOENT') return false;
    throw error;
  });
const writeExclusive = async (file, value) => {
  const handle = await open(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  ).catch((error) => {
    if (error?.code === 'EEXIST') refuse('E_ALREADY_EXISTS', `Refusing to replace ${file}.`);
    throw error;
  });
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(file), constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};
const run = (file, args, label, allowedCodes = [0], timeoutMs = 360_000) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) child.kill('SIGKILL');
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
      reject(new RehearsalEvidenceRefusal('E_COMMAND', `${label} could not start.`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || bytes > MAX_OUTPUT || signal || !allowedCodes.includes(code)) {
        reject(new RehearsalEvidenceRefusal('E_COMMAND', `${label} failed closed.`));
      } else {
        resolve({
          code,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      }
    });
  });
const parseJsonOutput = (result, label) => {
  try {
    return JSON.parse(result.stdout.toString('utf8').trim());
  } catch {
    refuse('E_COMMAND_JSON', `${label} returned invalid JSON.`);
  }
};

const verifyDeployment = async (plan) => {
  const result = parseJsonOutput(
    await run(
      NODE,
      [DEPLOY_CONTROLLER, '--verify-existing', '--plan', FIXED_PLAN_PATH],
      'Deployment verification',
    ),
    'Deployment verification',
  );
  if (
    result.ok !== true ||
    result.mode !== 'verify-existing' ||
    result.deploymentId !== plan.deployment.deploymentId ||
    result.releaseCommit !== plan.release.releaseCommit
  ) {
    refuse('E_DEPLOYMENT', 'Live rehearsal deployment verification failed.');
  }
};

const readRuntimeAuthority = async (plan) => {
  const hostname = os.hostname().toLowerCase();
  const machineId = (await readFile(MACHINE_ID, 'utf8')).trim();
  if (
    hostname !== plan.host.hostname ||
    sha256(machineId) !== plan.host.machineIdSha256
  ) {
    refuse('E_HOST_ISOLATION', 'Controller is not running on the planned rehearsal VM.');
  }
  const inputs = await collectBoundInputs(FIXED_PLAN_PATH, { fixedPlan: true });
  const chain = await readVerifiedDeploymentChain(inputs);
  if (
    inputs.plan.deploymentId !== plan.deployment.deploymentId ||
    inputs.plan.releaseCommit !== plan.release.releaseCommit ||
    inputs.planSha256 !== plan.deployment.planSha256 ||
    chain.deploymentReceiptSha256 !== plan.deployment.receiptSha256 ||
    inputs.plan.releaseManifest.sha256 !== plan.release.releaseManifestSha256
  ) {
    refuse('E_DEPLOYMENT', 'Rehearsal deployment does not match its fixed plan.');
  }
  const executablePath =
    `${plan.release.releasePath}/scripts/production/linux-rehearsal-evidence.mjs`;
  if ((await realpath(process.argv[1]).catch(() => null)) !== executablePath) {
    refuse('E_EXECUTOR_PATH', 'Rehearsal controller is not running from its immutable release.');
  }
  await assertSecureFile(executablePath, 0o644);
  const [executableBytes, manifestDocument] = await Promise.all([
    readFile(executablePath),
    readSecureJson(plan.release.releaseManifestPath, 0o644),
  ]);
  const manifest = parseManifestBoundRelease(manifestDocument.value);
  const artifact = manifest.artifacts.find(
    ({ path: artifactPath }) =>
      artifactPath === 'scripts/production/linux-rehearsal-evidence.mjs',
  );
  if (
    sha256(manifestDocument.bytes) !== plan.release.releaseManifestSha256 ||
    manifest.releaseCommit !== plan.release.releaseCommit ||
    !artifact ||
    artifact.mode !== '0644' ||
    artifact.bytes !== executableBytes.length ||
    artifact.sha256 !== sha256(executableBytes)
  ) {
    refuse('E_EXECUTOR_HASH', 'Rehearsal controller is not manifest-bound.');
  }
  return {
    inputs,
    chain,
    manifest,
    host: { hostname, machineIdSha256: sha256(machineId) },
    collector: {
      executablePath,
      executableSha256: sha256(executableBytes),
    },
  };
};

const readBootId = async () => {
  const value = (await readFile(BOOT_ID, 'utf8')).trim().toLowerCase();
  requireBootId(value, 'Observed Linux boot id');
  return value;
};
const readUnitState = async (unit, property = 'ActiveState') =>
  (
    await run(
      SYSTEMCTL,
      ['show', `--property=${property}`, '--value', unit],
      `${unit} ${property} readback`,
    )
  ).stdout.toString('utf8').trim();
const dockerInspect = async (names) => {
  const parsed = parseJsonOutput(
    await run(DOCKER, ['container', 'inspect', ...names], 'Docker container inspection'),
    'Docker container inspection',
  );
  if (!Array.isArray(parsed) || parsed.length !== names.length) {
    refuse('E_DOCKER', 'Docker returned an incomplete rehearsal container set.');
  }
  return parsed;
};
const waitHealthy = async (name) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const [inspection] = await dockerInspect([name]);
    if (
      inspection.State?.Running === true &&
      inspection.State?.Health?.Status === 'healthy'
    ) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  refuse('E_HEALTH', `Rehearsal container did not become healthy: ${name}`);
};
const runGuardian = async (configPath) =>
  parseJsonOutput(
    await run(NODE, [GUARDIAN, configPath], 'Guardian observation', [0, 2], 30_000),
    'Guardian observation',
  );

const REHEARSAL_OUTPUTS = Object.freeze([
  GUARDIAN_PROOF,
  RECOVERY_PROOF,
  NORMAL_REBOOT_MARKER,
  NORMAL_REBOOT_PROOF,
  OUTPUT,
  `${PROOF_ROOT}/guardian.active-rehearsal.json`,
  `${PROOF_ROOT}/guardian.identity-mismatch.json`,
  `${PROOF_ROOT}/runtime-manifest.identity-mismatch.json`,
  `${PROOF_ROOT}/deployment-receipt.original.json`,
  `${PROOF_ROOT}/deployment-receipt.invalid.json`,
]);

const assertExerciseOutputsAbsent = async () => {
  for (const output of REHEARSAL_OUTPUTS) {
    if (await pathExists(output)) {
      refuse(
        'E_EXISTING_REHEARSAL_PROOF',
        `Refusing to mutate runtime while a rehearsal output already exists: ${output}`,
      );
    }
  }
};

const assertNoRoute = async () => {
  const status = parseJsonOutput(
    await run(TAILSCALE, ['status', '--json'], 'Tailscale status'),
    'Tailscale status',
  );
  if (!['NeedsLogin', 'Running'].includes(status.BackendState)) {
    refuse('E_NETWORK', 'Rehearsal Tailscale state is unsafe.');
  }
  if (status.BackendState === 'Running') {
    const [serve, funnel] = await Promise.all([
      run(TAILSCALE, ['serve', 'status', '--json'], 'Tailscale Serve status'),
      run(TAILSCALE, ['funnel', 'status', '--json'], 'Tailscale Funnel status'),
    ]);
    for (const [result, label] of [[serve, 'Serve'], [funnel, 'Funnel']]) {
      const value = parseJsonOutput(result, `Tailscale ${label}`);
      if (JSON.stringify(value) !== '{}' && JSON.stringify(value) !== 'null') {
        refuse('E_NETWORK', `Tailscale ${label} must remain absent in rehearsal.`);
      }
    }
  }
  const listeners = (
    await run(SS, ['-H', '-ltn'], 'Host listener readback')
  ).stdout.toString('utf8');
  if (
    /(?:^|\s)(?:0\.0\.0\.0|\[?::\]?):(?:443|8080)(?:\s|$)/m.test(listeners) ||
    /(?:^|\s)(?:[^\s]+):443(?:\s|$)/m.test(listeners)
  ) {
    refuse('E_NETWORK', 'Rehearsal has a public or HTTPS listener.');
  }
};

const exerciseGuardian = async (plan) => {
  if ((await readUnitState(GUARDIAN_TIMER)) !== 'inactive') {
    refuse('E_GUARDIAN_TIMER', 'Guardian timer must be inactive during rehearsal.');
  }
  const configDocument = await readSecureJson(GUARDIAN_CONFIG);
  const config = configDocument.value;
  const expectedProbes = [
    {
      name: 'web',
      url: 'http://127.0.0.1:8080/',
      timeoutMs: 3000,
      expectedStatus: 200,
    },
    {
      name: 'api-system',
      url: 'http://127.0.0.1:8080/api/system_db',
      timeoutMs: 3000,
      expectedStatus: 200,
    },
    {
      name: 'auth-meta',
      url: 'http://127.0.0.1:8080/api/auth/meta',
      timeoutMs: 3000,
      expectedStatus: 200,
    },
  ];
  if (
    JSON.stringify(Object.keys(config).sort()) !== JSON.stringify([
      'attemptWindowSeconds',
      'cooldownSeconds',
      'dockerSocketPath',
      'failureThreshold',
      'maxRecoveryAttempts',
      'probes',
      'runtimeManifestPath',
      'schemaVersion',
      'shadowMode',
      'statePath',
      'statusPath',
    ]) ||
    config.schemaVersion !== 1 ||
    config.shadowMode !== true ||
    config.runtimeManifestPath !== RUNTIME_MANIFEST ||
    config.statePath !== '/var/lib/easyfire-bookkeeping-guardian/state.json' ||
    config.statusPath !== '/var/lib/easyfire-bookkeeping-guardian/status.json' ||
    config.dockerSocketPath !== '/var/run/docker.sock' ||
    config.failureThreshold !== 3 ||
    config.cooldownSeconds !== 900 ||
    config.attemptWindowSeconds !== 3600 ||
    config.maxRecoveryAttempts !== 2 ||
    JSON.stringify(config.probes) !== JSON.stringify(expectedProbes)
  ) {
    refuse('E_GUARDIAN_CONFIG', 'Guardian shadow policy is not exact.');
  }
  const healthy = await runGuardian(GUARDIAN_CONFIG);
  if (healthy.phase !== 'healthy' || healthy.action?.kind !== 'none') {
    refuse('E_GUARDIAN', 'Guardian healthy baseline failed.');
  }
  const shadowTarget = 'easyfire-bookkeeping-envoy';
  await run(DOCKER, ['container', 'stop', '--time', '30', shadowTarget], 'Shadow target stop');
  const shadow = [];
  for (let index = 0; index < 3; index += 1) shadow.push(await runGuardian(GUARDIAN_CONFIG));
  const [shadowInspect] = await dockerInspect([shadowTarget]);
  if (
    shadow.at(-1)?.action?.kind !== 'would-start-container' ||
    shadowInspect.State?.Running !== false
  ) {
    refuse('E_GUARDIAN', 'Guardian shadow rehearsal mutated or missed its target.');
  }
  await run(DOCKER, ['container', 'start', shadowTarget], 'Shadow target restore');
  await waitHealthy(shadowTarget);
  await runGuardian(GUARDIAN_CONFIG);

  const activeConfig = {
    ...config,
    shadowMode: false,
  };
  const activeConfigPath = `${PROOF_ROOT}/guardian.active-rehearsal.json`;
  await writeExclusive(activeConfigPath, activeConfig);
  const activeTarget = 'easyfire-bookkeeping-webapp';
  const [targetBefore] = await dockerInspect([activeTarget]);
  await run(DOCKER, ['container', 'stop', '--time', '30', activeTarget], 'Active target stop');
  const active = [];
  for (let index = 0; index < 3; index += 1) active.push(await runGuardian(activeConfigPath));
  const targetAfter = await waitHealthy(activeTarget);
  const cooldown = await runGuardian(activeConfigPath);
  if (
    active.at(-1)?.action?.kind !== 'start-container' ||
    active.at(-1)?.action?.containerId !== targetBefore.Id ||
    targetAfter.Id !== targetBefore.Id ||
    cooldown.phase !== 'cooldown'
  ) {
    refuse('E_GUARDIAN', 'Guardian active stateless recovery or cooldown failed.');
  }

  const dataRefusals = {};
  for (const [role, name] of [
    ['redis', 'easyfire-bookkeeping-redis'],
    ['mariadb', 'easyfire-bookkeeping-mysql'],
  ]) {
    await run(DOCKER, ['container', 'stop', '--time', '30', name], `${role} refusal stop`);
    const status = await runGuardian(activeConfigPath);
    dataRefusals[role] =
      status.phase === 'escalated' &&
      status.action?.kind === 'none' &&
      /Data service/i.test(status.reason ?? '');
    await run(DOCKER, ['container', 'start', name], `${role} rehearsal restore`);
    await waitHealthy(name);
    await run(SYSTEMCTL, ['start', STACK_UNIT], 'Stack recovery after data refusal');
    await verifyDeployment(plan);
  }

  const runtimeDocument = await readSecureJson(RUNTIME_MANIFEST);
  const mismatch = structuredClone(runtimeDocument.value);
  mismatch.services[0].containerId =
    mismatch.services[0].containerId === 'f'.repeat(64)
      ? 'e'.repeat(64)
      : 'f'.repeat(64);
  const mismatchManifestPath = `${PROOF_ROOT}/runtime-manifest.identity-mismatch.json`;
  const mismatchConfigPath = `${PROOF_ROOT}/guardian.identity-mismatch.json`;
  await writeExclusive(mismatchManifestPath, mismatch);
  await writeExclusive(mismatchConfigPath, {
    ...activeConfig,
    runtimeManifestPath: mismatchManifestPath,
    statePath: '/var/lib/easyfire-bookkeeping-guardian/rehearsal-mismatch-state.json',
    statusPath: '/var/lib/easyfire-bookkeeping-guardian/rehearsal-mismatch-status.json',
  });
  const mismatchStatus = await runGuardian(mismatchConfigPath);
  const identityMismatchRefusalObserved =
    mismatchStatus.phase === 'escalated' &&
    mismatchStatus.action?.kind === 'none' &&
    /identity mismatch/i.test(mismatchStatus.reason ?? '');
  await verifyDeployment(plan);
  const proof = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-guardian-runtime-rehearsal',
    status: 'passed',
    completedAt: new Date().toISOString(),
    deploymentId: plan.deployment.deploymentId,
    releaseCommit: plan.release.releaseCommit,
    shadowObservationCount: shadow.length,
    shadowWouldStartObserved: true,
    statelessStartContainerIdSha256: sha256(targetBefore.Id),
    statelessRecoveryObserved: true,
    cooldownObserved: true,
    redisObserveOnlyRefusalObserved: dataRefusals.redis,
    mariadbObserveOnlyRefusalObserved: dataRefusals.mariadb,
    identityMismatchRefusalObserved,
    finalHealthVerified: true,
    routeMutationCount: 0,
    productionDataMutationCount: 0,
  };
  validateGuardianSummary({ proofSha256: '0'.repeat(64), ...Object.fromEntries(
    Object.entries(proof).filter(([key]) => [
      'completedAt', 'shadowObservationCount', 'shadowWouldStartObserved',
      'statelessStartContainerIdSha256', 'statelessRecoveryObserved',
      'cooldownObserved', 'redisObserveOnlyRefusalObserved',
      'mariadbObserveOnlyRefusalObserved', 'identityMismatchRefusalObserved',
      'finalHealthVerified',
    ].includes(key)),
  ) });
  await writeExclusive(GUARDIAN_PROOF, proof);
  return proof;
};

const dockerIdentityHash = async () =>
  sha256((await run(DOCKER, ['info', '--format', '{{json .}}'], 'Docker identity')).stdout);

const restoreDeploymentReceipt = async (originalPath, invalidPath) => {
  if (await pathExists(DEPLOYMENT_RECEIPT)) {
    if (await pathExists(invalidPath)) {
      refuse('E_RECEIPT_RESTORE', 'Invalid receipt evidence path already exists.');
    }
    await rename(DEPLOYMENT_RECEIPT, invalidPath);
  }
  if (await pathExists(originalPath)) {
    if (await pathExists(DEPLOYMENT_RECEIPT)) {
      refuse('E_RECEIPT_RESTORE', 'Live deployment receipt path is not clear.');
    }
    await rename(originalPath, DEPLOYMENT_RECEIPT);
  }
};

const exerciseRecovery = async (plan) => {
  const dockerBefore = await dockerIdentityHash();
  const dockerPidBefore = await readUnitState('docker.service', 'MainPID');
  await run(SYSTEMCTL, ['restart', 'docker.service'], 'Docker service restart');
  const dockerPidAfter = await readUnitState('docker.service', 'MainPID');
  if (
    !/^[1-9][0-9]*$/.test(dockerPidBefore) ||
    !/^[1-9][0-9]*$/.test(dockerPidAfter) ||
    dockerPidBefore === dockerPidAfter
  ) {
    refuse('E_DOCKER_RESTART', 'Docker service restart did not change process identity.');
  }
  await run(SYSTEMCTL, ['start', STACK_UNIT], 'Stack start after Docker restart');
  await verifyDeployment(plan);
  const dockerAfter = await dockerIdentityHash();

  const daemonPidBefore = await readUnitState('docker.service', 'MainPID');
  await run(
    SYSTEMCTL,
    ['kill', '--kill-who=main', '--signal=SIGKILL', 'docker.service'],
    'Docker daemon failure injection',
  );
  let daemonPidAfter = daemonPidBefore;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const active = await readUnitState('docker.service');
    daemonPidAfter = await readUnitState('docker.service', 'MainPID');
    if (active === 'active' && daemonPidAfter !== daemonPidBefore && daemonPidAfter !== '0') break;
  }
  if (daemonPidAfter === daemonPidBefore || daemonPidAfter === '0') {
    refuse('E_DAEMON_RECOVERY', 'Docker daemon did not recover with a new process identity.');
  }
  await run(SYSTEMCTL, ['start', STACK_UNIT], 'Stack start after daemon recovery');
  await verifyDeployment(plan);

  const originalPath = `${PROOF_ROOT}/deployment-receipt.original.json`;
  const invalidPath = `${PROOF_ROOT}/deployment-receipt.invalid.json`;
  if ((await pathExists(originalPath)) || (await pathExists(invalidPath))) {
    refuse('E_RECEIPT_EVIDENCE', 'Deployment receipt rehearsal paths are not empty.');
  }
  let originalMoved = false;
  let invalidInstalled = false;
  let invalidRefused = false;
  try {
    await run(SYSTEMCTL, ['stop', GUARDIAN_TIMER, GUARDIAN_SERVICE], 'Guardian stop for invalid authority rehearsal', [0, 5]);
    await run(SYSTEMCTL, ['stop', STACK_UNIT], 'Stack gate stop for invalid authority rehearsal');
    await run(
      DOCKER,
      ['container', 'stop', '--time', '30', ...ALL_RUNTIME_CONTAINERS],
      'Runtime stop for invalid authority rehearsal',
    );
    await rename(DEPLOYMENT_RECEIPT, originalPath);
    originalMoved = true;
    await writeExclusive(DEPLOYMENT_RECEIPT, {
      schemaVersion: 1,
      project: PROJECT,
      status: 'intentionally-invalid-rehearsal-authority',
    });
    invalidInstalled = true;
    const start = await run(
      SYSTEMCTL,
      ['start', STACK_UNIT],
      'Invalid authority stack refusal',
      [1, 3, 4, 5],
    );
    invalidRefused = start.code !== 0;
    const inspections = await dockerInspect(ALL_RUNTIME_CONTAINERS);
    if (
      !invalidRefused ||
      inspections.some((container) => container.State?.Running === true)
    ) {
      refuse('E_INVALID_AUTHORITY', 'Invalid deployment authority did not fail closed.');
    }
  } finally {
    if (originalMoved) {
      await restoreDeploymentReceipt(originalPath, invalidPath);
      invalidInstalled = false;
    }
  }
  if (invalidInstalled) {
    refuse('E_RECEIPT_RESTORE', 'Invalid deployment receipt remained installed.');
  }
  const restoredBytes = await readFile(DEPLOYMENT_RECEIPT);
  if (sha256(restoredBytes) !== plan.deployment.receiptSha256) {
    refuse('E_RECEIPT_RESTORE', 'Original deployment receipt was not restored byte-for-byte.');
  }
  await run(SYSTEMCTL, ['start', STACK_UNIT], 'Stack recovery after invalid authority refusal');
  await verifyDeployment(plan);
  const proof = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-runtime-recovery-rehearsal',
    status: 'passed',
    completedAt: new Date().toISOString(),
    deploymentId: plan.deployment.deploymentId,
    releaseCommit: plan.release.releaseCommit,
    dockerRestart: {
      before: dockerBefore,
      after: dockerAfter,
      mainPidBefore: dockerPidBefore,
      mainPidAfter: dockerPidAfter,
      recovered: true,
    },
    daemonFailure: {
      signal: 'SIGKILL',
      mainPidBefore: daemonPidBefore,
      mainPidAfter: daemonPidAfter,
      failureObserved: true,
      recovered: true,
    },
    invalidAuthorityStart: {
      refused: invalidRefused,
      originalReceiptSha256: plan.deployment.receiptSha256,
      invalidReceiptSha256: sha256(await readFile(invalidPath)),
      originalReceiptRestored: true,
      invalidReceiptPreservedPath: invalidPath,
    },
    resourcesDeleted: false,
    productionDataMutationCount: 0,
  };
  await writeExclusive(RECOVERY_PROOF, proof);
  return proof;
};

const exercise = async (plan, runtime) => {
  await assertExerciseOutputsAbsent();
  await assertNoRoute();
  await verifyDeployment(plan);
  const guardian = await exerciseGuardian(plan);
  const recovery = await exerciseRecovery(plan);
  await run(SYSTEMCTL, ['enable', STACK_UNIT, GUARDIAN_TIMER], 'Rehearsal systemd enablement');
  await run(SYSTEMCTL, ['start', STACK_UNIT, GUARDIAN_TIMER], 'Rehearsal systemd activation');
  await verifyDeployment(plan);
  const marker = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-normal-reboot-marker',
    rehearsalId: plan.rehearsalId,
    preparedAt: new Date().toISOString(),
    bootIdBefore: await readBootId(),
    deploymentPlanSha256: plan.deployment.planSha256,
    deploymentReceiptSha256: plan.deployment.receiptSha256,
    guardianProofSha256: sha256(await readFile(GUARDIAN_PROOF)),
    recoveryProofSha256: sha256(await readFile(RECOVERY_PROOF)),
  };
  await writeExclusive(NORMAL_REBOOT_MARKER, marker);
  return {
    status: 'reboot-required',
    marker: NORMAL_REBOOT_MARKER,
    guardianCompletedAt: guardian.completedAt,
    recoveryCompletedAt: recovery.completedAt,
    collector: runtime.collector,
  };
};

const validateGuardianDocument = (document, plan) => {
  if (
    document.schemaVersion !== 1 ||
    document.kind !== 'easyfire-bookkeeping-guardian-runtime-rehearsal' ||
    document.status !== 'passed' ||
    document.deploymentId !== plan.deployment.deploymentId ||
    document.releaseCommit !== plan.release.releaseCommit ||
    document.routeMutationCount !== 0 ||
    document.productionDataMutationCount !== 0
  ) refuse('E_GUARDIAN', 'Guardian runtime proof is invalid.');
  return validateGuardianSummary({
    proofSha256: '0'.repeat(64),
    shadowObservationCount: document.shadowObservationCount,
    shadowWouldStartObserved: document.shadowWouldStartObserved,
    statelessStartContainerIdSha256: document.statelessStartContainerIdSha256,
    statelessRecoveryObserved: document.statelessRecoveryObserved,
    cooldownObserved: document.cooldownObserved,
    redisObserveOnlyRefusalObserved: document.redisObserveOnlyRefusalObserved,
    mariadbObserveOnlyRefusalObserved: document.mariadbObserveOnlyRefusalObserved,
    identityMismatchRefusalObserved: document.identityMismatchRefusalObserved,
    finalHealthVerified: document.finalHealthVerified,
    completedAt: document.completedAt,
  });
};

export const validateRecoveryDocument = (document, plan) => {
  if (
    document.schemaVersion !== 1 ||
    document.kind !== 'easyfire-bookkeeping-runtime-recovery-rehearsal' ||
    document.status !== 'passed' ||
    document.deploymentId !== plan.deployment.deploymentId ||
    document.releaseCommit !== plan.release.releaseCommit ||
    document.daemonFailure?.signal !== 'SIGKILL' ||
    document.daemonFailure?.mainPidBefore === document.daemonFailure?.mainPidAfter ||
    document.invalidAuthorityStart?.originalReceiptSha256 !==
      plan.deployment.receiptSha256 ||
    document.resourcesDeleted !== false ||
    document.productionDataMutationCount !== 0
  ) refuse('E_RECOVERY', 'Runtime recovery proof is invalid.');
  return validateRecoverySummary({
    proofSha256: '0'.repeat(64),
    dockerRestart: document.dockerRestart,
    daemonFailure: {
      mainPidBefore: document.daemonFailure.mainPidBefore,
      mainPidAfter: document.daemonFailure.mainPidAfter,
      failureObserved: document.daemonFailure.failureObserved,
      recovered: document.daemonFailure.recovered,
    },
    invalidAuthorityStart: {
      refused: document.invalidAuthorityStart.refused,
      originalReceiptSha256:
        document.invalidAuthorityStart.originalReceiptSha256,
      invalidReceiptSha256:
        document.invalidAuthorityStart.invalidReceiptSha256,
      originalReceiptRestored:
        document.invalidAuthorityStart.originalReceiptRestored,
    },
    completedAt: document.completedAt,
  });
};

export function validateRollbackEvidenceChain({
  plan: candidatePlan,
  lock,
  lockSha256,
  armedReceipt,
  armedReceiptSha256,
  lockedReceipt,
  lockedReceiptSha256,
  rearmReceipt,
}) {
  const plan = validateRehearsalPlan(candidatePlan);
  const boundLock = validateLockDocument(lock);
  for (const value of [lockSha256, armedReceiptSha256, lockedReceiptSha256]) {
    requireSha(value, 'Rollback evidence hash');
  }
  if (
    boundLock.reason !== 'rehearsal' ||
    boundLock.evidenceDirectory !== path.dirname(plan.rollback.armedReceiptPath) ||
    boundLock.deployment.deploymentId !== plan.deployment.deploymentId ||
    boundLock.deployment.releaseCommit !== plan.release.releaseCommit ||
    boundLock.deployment.planSha256 !== plan.deployment.planSha256 ||
    boundLock.deployment.deploymentReceiptSha256 !== plan.deployment.receiptSha256
  ) refuse('E_ROLLBACK', 'Rollback lock is not rehearsal-plan-bound.');
  validateArmedReceipt(armedReceipt, boundLock, lockSha256);
  validateLockedRebootReceipt(
    lockedReceipt, boundLock, lockSha256, armedReceiptSha256,
  );
  exactKeys(rearmReceipt, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'lockId',
    'deployment', 'lockedRebootProofSha256', 'guardianRemainsStopped',
    'tailscaleRemainsDisabled', 'resourcesPreserved',
  ], 'Rollback rearm receipt');
  requireTime(rearmReceipt.completedAt, 'Rollback rearm completion time');
  if (
    rearmReceipt.schemaVersion !== 1 ||
    rearmReceipt.project !== ROLLBACK_PROJECT ||
    rearmReceipt.kind !== 'easyfire-bookkeeping-rearm-completion' ||
    rearmReceipt.status !== 'deployment-verified' ||
    rearmReceipt.lockId !== boundLock.lockId ||
    JSON.stringify(rearmReceipt.deployment) !== JSON.stringify(boundLock.deployment) ||
    rearmReceipt.lockedRebootProofSha256 !== lockedReceiptSha256 ||
    rearmReceipt.guardianRemainsStopped !== true ||
    rearmReceipt.tailscaleRemainsDisabled !== true ||
    rearmReceipt.resourcesPreserved !== true ||
    [boundLock.armedAt, armedReceipt.completedAt, lockedReceipt.completedAt,
      rearmReceipt.completedAt].map(Date.parse)
      .some((value, index, values) => index > 0 && value < values[index - 1])
  ) refuse('E_ROLLBACK', 'Rollback receipts are invalid, reordered, or unbound.');
  return { lock: boundLock, armedReceipt, lockedReceipt, rearmReceipt };
}

const collect = async (plan, runtime) => {
  if ((await pathExists(OUTPUT)) || (await pathExists(NORMAL_REBOOT_PROOF))) {
    refuse('E_ALREADY_EXISTS', 'Rehearsal output or normal-reboot proof already exists.');
  }
  await assertNoRoute();
  await verifyDeployment(plan);
  const [markerDoc, guardianDoc, recoveryDoc, authDoc, armedDoc, lockedDoc, rearmDoc] =
    await Promise.all([
      readSecureJson(NORMAL_REBOOT_MARKER),
      readSecureJson(GUARDIAN_PROOF),
      readSecureJson(RECOVERY_PROOF),
      readSecureJson(plan.authenticationProofPath),
      readSecureJson(plan.rollback.armedReceiptPath),
      readSecureJson(plan.rollback.lockedRebootReceiptPath),
      readSecureJson(plan.rollback.rearmReceiptPath),
    ]);
  const bootIdAfter = await readBootId();
  const marker = markerDoc.value;
  if (
    marker.kind !== 'easyfire-bookkeeping-normal-reboot-marker' ||
    marker.rehearsalId !== plan.rehearsalId ||
    marker.deploymentPlanSha256 !== plan.deployment.planSha256 ||
    marker.deploymentReceiptSha256 !== plan.deployment.receiptSha256 ||
    marker.bootIdBefore === bootIdAfter ||
    marker.guardianProofSha256 !== sha256(guardianDoc.bytes) ||
    marker.recoveryProofSha256 !== sha256(recoveryDoc.bytes)
  ) refuse('E_NORMAL_REBOOT', 'Normal reboot marker is invalid or same-boot.');
  const stackActive = await readUnitState(STACK_UNIT);
  const timerActive = await readUnitState(GUARDIAN_TIMER);
  const timerEnabled = await readUnitState(GUARDIAN_TIMER, 'UnitFileState');
  if (stackActive !== 'active' || timerActive !== 'active' || timerEnabled !== 'enabled') {
    refuse('E_NORMAL_REBOOT', 'Stack or Guardian timer did not recover after reboot.');
  }
  const currentBootGuardian = await collectCurrentBootGuardianProof({
    run,
    readSecureJson,
    sha256,
    rebootMarkerPreparedAt: marker.preparedAt,
  });
  const normalProof = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-normal-reboot-proof',
    status: 'passed',
    completedAt: new Date().toISOString(),
    rehearsalId: plan.rehearsalId,
    bootIdBefore: marker.bootIdBefore,
    bootIdAfter,
    stackAuthorityVerified: true,
    guardianTimerActive: true,
    guardianTimerEnabled: true,
    guardianCurrentBoot: currentBootGuardian,
  };
  const normalBytes = Buffer.from(`${JSON.stringify(normalProof, null, 2)}\n`);

  const archivedLockPath = `${path.dirname(plan.rollback.armedReceiptPath)}/rollback.lock.json`;
  const archivedLockDoc = await readSecureJson(archivedLockPath);
  const rollbackChain = validateRollbackEvidenceChain({
    plan,
    lock: archivedLockDoc.value,
    lockSha256: sha256(archivedLockDoc.bytes),
    armedReceipt: armedDoc.value,
    armedReceiptSha256: sha256(armedDoc.bytes),
    lockedReceipt: lockedDoc.value,
    lockedReceiptSha256: sha256(lockedDoc.bytes),
    rearmReceipt: rearmDoc.value,
  });
  const lock = rollbackChain.lock;

  const guardian = validateGuardianDocument(guardianDoc.value, plan);
  const recovery = validateRecoveryDocument(recoveryDoc.value, plan);
  const authentication = validateNativeAuthenticationProof(authDoc.value);
  const authArtifact = runtime.manifest.artifacts.find(
    ({ path: artifactPath }) =>
      artifactPath === 'scripts/production/linux-native-auth-proof.mjs',
  );
  if (
    authentication.deploymentId !== plan.deployment.deploymentId ||
    authentication.releaseCommit !== plan.release.releaseCommit ||
    authentication.deploymentPlanSha256 !== plan.deployment.planSha256 ||
    authentication.deploymentReceiptSha256 !== plan.deployment.receiptSha256 ||
    !authArtifact || authArtifact.mode !== '0644' ||
    authentication.collector.executableSha256 !== authArtifact.sha256
  ) refuse('E_AUTHENTICATION', 'Authentication proof is not rehearsal-deployment-bound.');

  const evidence = buildRehearsalEvidence({
    plan,
    collector: runtime.collector,
    host: runtime.host,
    rollback: {
      armedReceiptSha256: sha256(armedDoc.bytes),
      lockedRebootReceiptSha256: sha256(lockedDoc.bytes),
      rearmReceiptSha256: sha256(rearmDoc.bytes),
      bootIdBefore: lockedDoc.value.bootIdBefore,
      bootIdAfter: lockedDoc.value.bootIdAfter,
      lockedAt: lockedDoc.value.completedAt,
      rearmedAt: rearmDoc.value.completedAt,
      resourcesPreserved: true,
    },
    normalReboot: {
      markerSha256: sha256(markerDoc.bytes),
      proofSha256: sha256(normalBytes),
      bootIdBefore: normalProof.bootIdBefore,
      bootIdAfter: normalProof.bootIdAfter,
      completedAt: normalProof.completedAt,
      stackAuthorityVerified: true,
      guardianTimerActive: true,
      guardianTimerEnabled: true,
      guardianCurrentBoot: normalProof.guardianCurrentBoot,
    },
    recovery: {
      proofSha256: sha256(recoveryDoc.bytes),
      dockerRestart: recovery.dockerRestart,
      daemonFailure: recovery.daemonFailure,
      invalidAuthorityStart: recovery.invalidAuthorityStart,
      completedAt: recovery.completedAt,
    },
    guardian: {
      proofSha256: sha256(guardianDoc.bytes),
      ...Object.fromEntries(
        Object.entries(guardian).filter(([key]) => key !== 'proofSha256'),
      ),
    },
    authentication: {
      proofSha256: sha256(authDoc.bytes),
      method: authentication.method,
      ownerConfirmed: authentication.ownerConfirmed,
      authenticatedApiPassed:
        authentication.authenticatedApi.account === 'passed' &&
        authentication.authenticatedApi.organization === 'passed',
      dataInvariantsPassed:
        authentication.dataValidation.protectedAccountingCountsExact === true,
      secretMaterialPersisted: authentication.secretMaterialPersisted,
      completedAt: authentication.completedAt,
    },
    completedAt: new Date().toISOString(),
  });
  await writeExclusive(NORMAL_REBOOT_PROOF, normalProof);
  await writeExclusive(OUTPUT, evidence);
  return evidence;
};

export function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  let mode;
  let planPath;
  let outputPath;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--exercise', '--collect'].includes(argument) && !mode) {
      mode = argument.slice(2);
    } else if (argument === '--plan' && !planPath) {
      planPath = args[++index];
    } else if (argument === '--output' && !outputPath) {
      outputPath = args[++index];
    } else {
      refuse('E_USAGE', 'Use the exact Linux rehearsal evidence command.');
    }
  }
  if (
    !['exercise', 'collect'].includes(mode) ||
    planPath !== PLAN_PATH ||
    (mode === 'exercise' && outputPath !== undefined) ||
    (mode === 'collect' && outputPath !== OUTPUT)
  ) {
    refuse(
      'E_USAGE',
      'Linux rehearsal evidence plan/output paths or mode are invalid.',
    );
  }
  return { help: false, mode, planPath, ...(mode === 'collect' ? { outputPath } : {}) };
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      `Usage: linux-rehearsal-evidence.mjs --exercise --plan ${PLAN_PATH} | --collect --plan ${PLAN_PATH} --output ${OUTPUT}\n`,
    );
    return;
  }
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    refuse('E_ROOT', 'Linux rehearsal evidence requires Linux root.');
  }
  const planDocument = await readSecureJson(options.planPath);
  const plan = validateRehearsalPlan(planDocument.value);
  const runtime = await readRuntimeAuthority(plan);
  const result = options.mode === 'exercise'
    ? await exercise(plan, runtime)
    : await collect(plan, runtime);
  process.stdout.write(
    `${JSON.stringify({ status: result.status, output: options.mode === 'collect' ? OUTPUT : NORMAL_REBOOT_MARKER })}\n`,
  );
}

if (await isCanonicalMainModule(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error?.code ?? 'E_REHEARSAL'}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
