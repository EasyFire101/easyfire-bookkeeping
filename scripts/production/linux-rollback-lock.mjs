#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  collectBoundInputs,
  readVerifiedDeploymentChain,
} from './linux-deploy-authority.mjs';
import {
  FIXED_PLAN_PATH,
  PROJECT as DEPLOYMENT_PROJECT,
  SERVICE_CONTRACT,
} from './linux-deploy-plan.mjs';

export const PROJECT = DEPLOYMENT_PROJECT;
export const CONTROLLER_PATH =
  '/opt/easyfire-bookkeeping/current/scripts/production/linux-rollback-lock.mjs';
const NODE = '/usr/local/bin/node';
const DOCKER = '/usr/bin/docker';
const SYSTEMCTL = '/usr/bin/systemctl';
const TAILSCALE = '/usr/bin/tailscale';
const DEPLOY_CONTROLLER =
  '/opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs';
const PLAN_PATH = FIXED_PLAN_PATH;
const LOCK_PATH = '/etc/easyfire-bookkeeping/rollback.lock';
const CONFIG_ROOT = '/etc/easyfire-bookkeeping';
const EVIDENCE_ROOT = '/etc/easyfire-bookkeeping/rollback-evidence';
const PROC_TCP = '/proc/net/tcp';
const PROC_TCP6 = '/proc/net/tcp6';
const BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
const GUARDIAN_TIMER = 'easyfire-bookkeeping-guardian.timer';
const GUARDIAN_SERVICE = 'easyfire-bookkeeping-guardian.service';
const STACK_SERVICE = 'easyfire-bookkeeping-stack.service';
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_DOCUMENT = 1024 * 1024;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const DEPLOYMENT_ID = /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/;
const LOCK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BOOT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export const STATELESS_CONTAINERS = Object.freeze([
  SERVICE_CONTRACT.gotenberg.name,
  SERVICE_CONTRACT.server.name,
  SERVICE_CONTRACT.webapp.name,
  SERVICE_CONTRACT.envoy.name,
]);
export const DATA_CONTAINERS = Object.freeze([
  SERVICE_CONTRACT.redis.name,
  SERVICE_CONTRACT.mysql.name,
]);
export const ALL_RUNTIME_CONTAINERS = Object.freeze([
  ...STATELESS_CONTAINERS,
  ...DATA_CONTAINERS,
]);
export const MIGRATION_CONTAINER = SERVICE_CONTRACT.database_migration.name;
export const LONG_RUNNING_CONTAINERS = Object.freeze([
  { service: 'gotenberg', name: STATELESS_CONTAINERS[0] },
  { service: 'server', name: STATELESS_CONTAINERS[1] },
  { service: 'webapp', name: STATELESS_CONTAINERS[2] },
  { service: 'envoy', name: STATELESS_CONTAINERS[3] },
  { service: 'redis', name: DATA_CONTAINERS[0] },
  { service: 'mysql', name: DATA_CONTAINERS[1] },
]);

export class RollbackRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RollbackRefusal';
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new RollbackRefusal(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, label) => {
  if (!isObject(value)) refuse('E_DOCUMENT', `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    refuse('E_DOCUMENT', `${label} has an invalid shape.`);
  }
};
const canonicalTime = (value, label) => {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    refuse('E_DOCUMENT', `${label} is not a canonical UTC timestamp.`);
  }
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseArguments(args) {
  let mode;
  let reason;
  let help = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (['--arm', '--verify-locked', '--rearm'].includes(argument)) {
      if (mode || seen.has(argument)) {
        refuse('E_USAGE', 'Exactly one rollback-lock mode is required.');
      }
      seen.add(argument);
      mode = argument.slice(2);
      continue;
    }
    if (argument === '--reason') {
      if (seen.has(argument)) refuse('E_USAGE', 'Duplicate --reason argument.');
      seen.add(argument);
      reason = args[index + 1];
      if (!['rehearsal', 'rollback'].includes(reason)) {
        refuse('E_USAGE', 'Arm reason must be rehearsal or rollback.');
      }
      index += 1;
      continue;
    }
    refuse('E_USAGE', 'Unknown rollback-lock argument.');
  }
  if (help) return { help: true, mode, reason };
  if (!mode) refuse('E_USAGE', 'Exactly one rollback-lock mode is required.');
  if (mode === 'arm' && !reason) {
    refuse('E_USAGE', '--arm requires --reason rehearsal or rollback.');
  }
  if (mode !== 'arm' && reason !== undefined) {
    refuse('E_USAGE', '--reason is valid only with --arm.');
  }
  return { help: false, mode, reason };
}

const command = (stage, executable, args) => ({
  stage,
  executable,
  arguments: args,
});
const deploymentVerificationCommand = (stage) =>
  command(stage, NODE, [
    DEPLOY_CONTROLLER,
    '--verify-existing',
    '--plan',
    PLAN_PATH,
  ]);
const tailscaleStatusCommand = () =>
  command('tailscale-status', TAILSCALE, ['status', '--json']);
const serveStatusCommand = () =>
  command('tailscale-serve-status', TAILSCALE, ['serve', 'status', '--json']);
const funnelStatusCommand = () =>
  command('tailscale-funnel-status', TAILSCALE, ['funnel', 'status', '--json']);
const inspectCommand = (stage, names) =>
  command(stage, DOCKER, ['container', 'inspect', ...names]);

export function planArmCommands(enrolled) {
  return [
    deploymentVerificationCommand('deployment-preflight'),
    command('restart-neutralize', DOCKER, [
      'update',
      '--restart',
      'no',
      ...ALL_RUNTIME_CONTAINERS,
    ]),
    inspectCommand('restart-neutralize-inspect', ALL_RUNTIME_CONTAINERS),
    command('guardian-stop', SYSTEMCTL, [
      'stop',
      GUARDIAN_TIMER,
      GUARDIAN_SERVICE,
    ]),
    command('stack-stop', SYSTEMCTL, ['stop', STACK_SERVICE]),
    tailscaleStatusCommand(),
    ...(enrolled
      ? [
          command('tailscale-https-off', TAILSCALE, [
            'serve',
            '--https=443',
            'off',
          ]),
          serveStatusCommand(),
          funnelStatusCommand(),
        ]
      : []),
    command('stateless-stop', DOCKER, [
      'container',
      'stop',
      '--time',
      '30',
      ...STATELESS_CONTAINERS,
    ]),
    inspectCommand('stateless-inspect', STATELESS_CONTAINERS),
    command('data-stop', DOCKER, [
      'container',
      'stop',
      '--time',
      '30',
      ...DATA_CONTAINERS,
    ]),
    inspectCommand('runtime-inspect', [
      ...ALL_RUNTIME_CONTAINERS,
      MIGRATION_CONTAINER,
    ]),
  ];
}

export function planRearmCommands() {
  return [
    command('stack-start', SYSTEMCTL, ['start', STACK_SERVICE]),
    deploymentVerificationCommand('deployment-reverify'),
  ];
}

const evidenceDirectoryFor = (reason, deploymentId, lockId) =>
  `${EVIDENCE_ROOT}/${reason === 'rehearsal' ? 'rehearsals' : 'rollbacks'}/${deploymentId}/${lockId}`;

export function createLockDocument(
  deployment,
  reason,
  {
    lockId = randomUUID(),
    armedAt = new Date().toISOString(),
    bootIdAtArm,
  } = {},
) {
  if (!['rehearsal', 'rollback'].includes(reason)) {
    refuse('E_LOCK', 'Rollback-lock reason is invalid.');
  }
  const document = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-rollback-lock',
    status: 'armed',
    reason,
    lockId,
    armedAt,
    bootIdAtArm,
    deployment: { ...deployment },
    evidenceDirectory: evidenceDirectoryFor(
      reason,
      deployment.deploymentId,
      lockId,
    ),
  };
  return validateLockDocument(document);
}

export function validateLockDocument(candidate) {
  exactKeys(
    candidate,
    [
      'schemaVersion',
      'project',
      'kind',
      'status',
      'reason',
      'lockId',
      'armedAt',
      'bootIdAtArm',
      'deployment',
      'evidenceDirectory',
    ],
    'Rollback lock',
  );
  exactKeys(
    candidate.deployment,
    [
      'deploymentId',
      'releaseCommit',
      'planSha256',
      'deploymentReceiptSha256',
    ],
    'Rollback lock deployment binding',
  );
  if (
    candidate.schemaVersion !== 1 ||
    candidate.project !== PROJECT ||
    candidate.kind !== 'easyfire-bookkeeping-rollback-lock' ||
    candidate.status !== 'armed' ||
    !['rehearsal', 'rollback'].includes(candidate.reason) ||
    !LOCK_ID.test(candidate.lockId) ||
    !BOOT_ID.test(candidate.bootIdAtArm) ||
    !DEPLOYMENT_ID.test(candidate.deployment.deploymentId) ||
    !SHA40.test(candidate.deployment.releaseCommit) ||
    !SHA64.test(candidate.deployment.planSha256) ||
    !SHA64.test(candidate.deployment.deploymentReceiptSha256)
  ) {
    refuse('E_LOCK', 'Rollback lock identity is invalid.');
  }
  canonicalTime(candidate.armedAt, 'Rollback lock armedAt');
  if (
    candidate.evidenceDirectory !==
    evidenceDirectoryFor(
      candidate.reason,
      candidate.deployment.deploymentId,
      candidate.lockId,
    )
  ) {
    refuse('E_LOCK', 'Rollback lock evidence directory is invalid.');
  }
  return candidate;
}

export function buildLockedRebootReceipt({
  lock,
  lockSha256,
  armedReceiptSha256,
  bootIdAfter,
  proof,
  completedAt = new Date().toISOString(),
}) {
  validateLockDocument(lock);
  exactKeys(proof?.tailscale, ['enrolled', 'serveAbsent', 'funnelAbsent'], 'Locked reboot Tailscale proof');
  exactKeys(proof?.unitStates, [GUARDIAN_TIMER, GUARDIAN_SERVICE, STACK_SERVICE], 'Locked reboot unit states');
  if (
    !['rehearsal', 'rollback'].includes(lock.reason) ||
    !SHA64.test(lockSha256) ||
    !SHA64.test(armedReceiptSha256) ||
    !BOOT_ID.test(bootIdAfter) ||
    bootIdAfter === lock.bootIdAtArm ||
    !isObject(proof) ||
    !isObject(proof.runtime) ||
    proof.runtime.migrationExitCode !== 0 ||
    JSON.stringify(proof.runtime.stoppedContainers) !==
      JSON.stringify(ALL_RUNTIME_CONTAINERS) ||
    !isObject(proof.tailscale) ||
    proof.tailscale.serveAbsent !== true ||
    proof.tailscale.funnelAbsent !== true ||
    !isObject(proof.unitStates) ||
    [GUARDIAN_TIMER, GUARDIAN_SERVICE, STACK_SERVICE].some(
      (unit) => proof.unitStates[unit] !== 'inactive',
    )
  ) {
    refuse(
      'E_LOCKED_REBOOT',
      'Locked reboot proof is incomplete, not isolated, or did not cross a reboot.',
    );
  }
  canonicalTime(completedAt, 'Locked reboot completedAt');
  return {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-locked-reboot-receipt',
    status: 'locked-reboot-verified',
    lockId: lock.lockId,
    reason: lock.reason,
    completedAt,
    lockSha256,
    armedReceiptSha256,
    deployment: lock.deployment,
    bootIdBefore: lock.bootIdAtArm,
    bootIdAfter,
    proof: {
      stoppedContainers: proof.runtime.stoppedContainers,
      migrationExitCode: proof.runtime.migrationExitCode,
      unitStates: proof.unitStates,
      tailscale: proof.tailscale,
      absentListeners: [443, 8080],
      resourcesPreserved: true,
    },
  };
}

export function validateLockedRebootReceipt(
  receipt,
  lock,
  lockSha256,
  armedReceiptSha256,
) {
  const rebuilt = buildLockedRebootReceipt({
    lock,
    lockSha256,
    armedReceiptSha256,
    bootIdAfter: receipt?.bootIdAfter,
    proof: {
      runtime: {
        stoppedContainers: receipt?.proof?.stoppedContainers,
        migrationExitCode: receipt?.proof?.migrationExitCode,
      },
      tailscale: receipt?.proof?.tailscale,
      unitStates: receipt?.proof?.unitStates,
    },
    completedAt: receipt?.completedAt,
  });
  if (
    JSON.stringify(Object.keys(receipt ?? {}).sort()) !==
      JSON.stringify(Object.keys(rebuilt).sort()) ||
    JSON.stringify(receipt) !== JSON.stringify(rebuilt)
  ) {
    refuse('E_LOCKED_REBOOT', 'Locked reboot receipt is invalid or unbound.');
  }
  return receipt;
}

export function validateLockAgainstAuthority(lock, authority) {
  validateLockDocument(lock);
  exactKeys(
    authority,
    [
      'deploymentId',
      'releaseCommit',
      'planSha256',
      'deploymentReceiptSha256',
    ],
    'Deployment authority',
  );
  for (const field of Object.keys(authority)) {
    if (lock.deployment[field] !== authority[field]) {
      refuse('E_BINDING', 'Rollback lock deployment binding has drifted.');
    }
  }
  return lock;
}

export function assertRearmAllowed(lock) {
  validateLockDocument(lock);
  if (lock.reason !== 'rehearsal') {
    refuse('E_REARM_FORBIDDEN', 'A rollback lock can never be rearmed.');
  }
}

export function validateDeploymentVerification(candidate) {
  exactKeys(
    candidate,
    ['ok', 'mode', 'deploymentId', 'releaseCommit'],
    'Deployment verification',
  );
  if (
    candidate.ok !== true ||
    candidate.mode !== 'verify-existing' ||
    !DEPLOYMENT_ID.test(candidate.deploymentId) ||
    !SHA40.test(candidate.releaseCommit)
  ) {
    refuse('E_AUTHORITY', 'Deployment verification is invalid.');
  }
  return candidate;
}

const requireBoundContainer = (container, spec, recorded, restartPolicy) => {
  if (
    !isObject(container) ||
    container.Name !== `/${spec.name}` ||
    container.Id !== recorded?.id ||
    container.Image !== recorded?.imageId ||
    container.Config?.Labels?.['com.docker.compose.project'] !== PROJECT ||
    container.Config?.Labels?.['com.docker.compose.service'] !== spec.service ||
    container.HostConfig?.RestartPolicy?.Name !== restartPolicy
  ) {
    refuse('E_RUNTIME_IDENTITY', 'A bound Bookkeeping container identity is invalid.');
  }
};

const inspectionsByName = (inspections, expectedCount) => {
  if (!Array.isArray(inspections) || inspections.length !== expectedCount) {
    refuse('E_RUNTIME_IDENTITY', 'Docker returned an incomplete runtime set.');
  }
  const result = new Map();
  for (const inspection of inspections) {
    if (!isObject(inspection) || typeof inspection.Name !== 'string') {
      refuse('E_RUNTIME_IDENTITY', 'Docker runtime identity is invalid.');
    }
    const name = inspection.Name.replace(/^\//, '');
    if (result.has(name)) {
      refuse('E_RUNTIME_IDENTITY', 'Docker runtime identity is duplicated.');
    }
    result.set(name, inspection);
  }
  return result;
};

function validateBoundSubset(inspections, resources, specs, restartPolicy) {
  const indexed = inspectionsByName(inspections, specs.length);
  for (const spec of specs) {
    const inspection = indexed.get(spec.name);
    if (!inspection) {
      refuse('E_RUNTIME_IDENTITY', 'A required Bookkeeping container is absent.');
    }
    requireBoundContainer(
      inspection,
      spec,
      resources?.containers?.[spec.service],
      restartPolicy,
    );
  }
}

export function validateRestartPolicies(inspections, resources, policy) {
  if (policy !== 'no') {
    refuse('E_RESTART_POLICY', 'Bookkeeping restart policy must remain no.');
  }
  validateBoundSubset(
    inspections,
    resources,
    LONG_RUNNING_CONTAINERS,
    policy,
  );
  return { policy, containers: ALL_RUNTIME_CONTAINERS };
}

export function validateStoppedRuntime(
  inspections,
  resources,
  migrationResult,
) {
  const indexed = inspectionsByName(
    inspections,
    LONG_RUNNING_CONTAINERS.length + 1,
  );
  validateBoundSubset(
    LONG_RUNNING_CONTAINERS.map(({ name }) => indexed.get(name)),
    resources,
    LONG_RUNNING_CONTAINERS,
    'no',
  );
  for (const spec of LONG_RUNNING_CONTAINERS) {
    const container = indexed.get(spec.name);
    if (container.State?.Status !== 'exited' || container.State?.Running !== false) {
      refuse('E_RUNTIME_ACTIVE', 'A bound Bookkeeping container is not stopped.');
    }
  }
  const migrationContainer = indexed.get(MIGRATION_CONTAINER);
  if (
    !migrationContainer ||
    migrationContainer.Name !== `/${MIGRATION_CONTAINER}` ||
    migrationContainer.Id !== migrationResult.containerId ||
    migrationContainer.Image !== migrationResult.imageId ||
    migrationContainer.Config?.Labels?.['com.docker.compose.project'] !== PROJECT ||
    migrationContainer.Config?.Labels?.['com.docker.compose.service'] !==
      'database_migration' ||
    migrationContainer.HostConfig?.RestartPolicy?.Name !== 'no' ||
    migrationContainer.State?.Status !== 'exited' ||
    migrationContainer.State?.Running !== false ||
    migrationContainer.State?.ExitCode !== 0 ||
    migrationResult.containerName !== MIGRATION_CONTAINER ||
    migrationResult.exitCode !== 0 ||
    migrationResult.state !== 'exited'
  ) {
    refuse('E_MIGRATION', 'The bound migration is not preserved exited zero.');
  }
  return {
    stoppedContainers: ALL_RUNTIME_CONTAINERS,
    migrationExitCode: 0,
  };
}

const hasConfiguration = (value) => {
  if (value === null || value === undefined || value === false || value === '') {
    return false;
  }
  if (Array.isArray(value)) return value.some(hasConfiguration);
  if (isObject(value)) return Object.values(value).some(hasConfiguration);
  return true;
};

export function validateTailscaleIsolation({
  status,
  serveStatus,
  funnelStatus,
  listeningPorts = [],
}) {
  if (!isObject(status)) refuse('E_TAILSCALE', 'Tailscale status is invalid.');
  assertPortsAbsent(listeningPorts, [443]);
  if (status.BackendState === 'NeedsLogin') {
    return { enrolled: false, serveAbsent: true, funnelAbsent: true };
  }
  if (status.BackendState !== 'Running' || !isObject(status.Self)) {
    refuse('E_TAILSCALE', 'Tailscale is neither enrolled nor safely logged out.');
  }
  if (hasConfiguration(serveStatus)) {
    refuse('E_TAILSCALE_SERVE', 'Tailscale Serve is still configured.');
  }
  if (hasConfiguration(funnelStatus)) {
    refuse('E_TAILSCALE_FUNNEL', 'Tailscale Funnel is still configured.');
  }
  return { enrolled: true, serveAbsent: true, funnelAbsent: true };
}

export function parseListeningPorts(tcp, tcp6) {
  const ports = new Set();
  for (const document of [tcp, tcp6]) {
    for (const line of document.split(/\r?\n/).slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4 || fields[3] !== '0A') continue;
      const separator = fields[1].lastIndexOf(':');
      const port = Number.parseInt(fields[1].slice(separator + 1), 16);
      if (Number.isInteger(port)) ports.add(port);
    }
  }
  return [...ports].sort((left, right) => left - right);
}

export function assertPortsAbsent(listeningPorts, prohibitedPorts) {
  for (const port of prohibitedPorts) {
    if (listeningPorts.includes(port)) {
      refuse('E_LISTENER', `TCP listener ${port} is still present.`);
    }
  }
}

const sanitizedEnvironment = Object.freeze({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: '/root',
  LANG: 'C',
  LC_ALL: 'C',
});

async function runCommand(spec, { allowedExitCodes = [0], timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.arguments, {
      env: sanitizedEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let overflow = false;
    let timedOut = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) {
        overflow = true;
        child.kill('SIGTERM');
      } else {
        target.push(chunk);
      }
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new RollbackRefusal('E_COMMAND_START', `${spec.stage} could not start.`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || overflow || signal || !allowedExitCodes.includes(code)) {
        reject(new RollbackRefusal('E_COMMAND_FAILED', `${spec.stage} failed.`));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

const parseJsonResult = (result, label) => {
  try {
    return JSON.parse(result.stdout.toString('utf8'));
  } catch {
    refuse('E_COMMAND_JSON', `${label} returned invalid JSON.`);
  }
};

const ensureLinuxRoot = () => {
  if (process.platform !== 'linux') {
    refuse('E_PLATFORM', 'Rollback-lock mutation requires Linux.');
  }
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    refuse('E_ROOT_REQUIRED', 'Rollback-lock operation requires root.');
  }
};

const pathExists = async (candidate) => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const syncDirectory = async (directory) => {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const assertSecureDirectory = async (directory) => {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0) {
    refuse('E_FILE_AUTHORITY', 'Rollback evidence directory authority is invalid.');
  }
  await chmod(directory, 0o700);
};

const createEvidenceDirectory = async (lock) => {
  const relative = path.relative(EVIDENCE_ROOT, lock.evidenceDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    refuse('E_FILE_AUTHORITY', 'Rollback evidence path escaped its fixed root.');
  }
  const configRoot = await lstat(CONFIG_ROOT);
  if (
    !configRoot.isDirectory() ||
    configRoot.isSymbolicLink() ||
    configRoot.uid !== 0 ||
    (configRoot.mode & 0o022) !== 0
  ) {
    refuse('E_FILE_AUTHORITY', 'Bookkeeping configuration authority is invalid.');
  }
  let cursor = EVIDENCE_ROOT;
  const components = relative.split(path.sep);
  for (let index = -1; index < components.length; index += 1) {
    if (index >= 0) cursor = path.join(cursor, components[index]);
    try {
      await mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST' || index === components.length - 1) throw error;
    }
    await assertSecureDirectory(cursor);
  }
  await syncDirectory(path.dirname(lock.evidenceDirectory));
};

const writeBytesExclusiveAtomic = async (target, bytes) => {
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      refuse('E_ALREADY_EXISTS', 'Refusing to replace append-only rollback evidence.');
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o777) !== 0o600) {
    refuse('E_FILE_AUTHORITY', 'Rollback evidence file authority is invalid.');
  }
};

const writeJsonExclusiveAtomic = (target, value) =>
  writeBytesExclusiveAtomic(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));

const readSecureDocument = async (target, label) => {
  const info = await lstat(target);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    (info.mode & 0o777) !== 0o600 ||
    info.size <= 0 ||
    info.size > MAX_DOCUMENT
  ) {
    refuse('E_FILE_AUTHORITY', `${label} authority is invalid.`);
  }
  const bytes = await readFile(target);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    refuse('E_DOCUMENT', `${label} is not valid JSON.`);
  }
};

const runDeploymentVerification = async (stage) => {
  const result = await runCommand(deploymentVerificationCommand(stage), {
    timeoutMs: 300_000,
  });
  return validateDeploymentVerification(parseJsonResult(result, stage));
};

const readAuthority = async (verification) => {
  const inputs = await collectBoundInputs(PLAN_PATH, { fixedPlan: true });
  const chain = await readVerifiedDeploymentChain(inputs);
  const authority = {
    deploymentId: inputs.plan.deploymentId,
    releaseCommit: inputs.plan.releaseCommit,
    planSha256: inputs.planSha256,
    deploymentReceiptSha256: chain.deploymentReceiptSha256,
  };
  if (
    verification.deploymentId !== authority.deploymentId ||
    verification.releaseCommit !== authority.releaseCommit
  ) {
    refuse('E_AUTHORITY', 'Deployment authority binding is invalid.');
  }
  return {
    authority,
    resources: chain.evidence.resources,
    migration: chain.migration,
  };
};

const parseDockerInspections = (result, expectedCount) => {
  const parsed = parseJsonResult(result, 'runtime-inspect');
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    refuse('E_RUNTIME_IDENTITY', 'Docker returned an incomplete runtime set.');
  }
  return parsed;
};

const readListeningPorts = async () =>
  parseListeningPorts(
    await readFile(PROC_TCP, 'utf8'),
    await readFile(PROC_TCP6, 'utf8'),
  );

const readBootId = async () => {
  const bootId = (await readFile(BOOT_ID_PATH, 'utf8')).trim().toLowerCase();
  if (!BOOT_ID.test(bootId)) {
    refuse('E_BOOT_ID', 'Linux boot identity is invalid.');
  }
  return bootId;
};

const tailscaleSnapshot = async ({ disable }) => {
  const first = parseJsonResult(
    await runCommand(tailscaleStatusCommand()),
    'tailscale-status',
  );
  const enrolled = first?.BackendState === 'Running';
  if (disable && enrolled) {
    await runCommand(
      command('tailscale-https-off', TAILSCALE, [
        'serve',
        '--https=443',
        'off',
      ]),
    );
  }
  const status = disable
    ? parseJsonResult(
        await runCommand(tailscaleStatusCommand()),
        'tailscale-status',
      )
    : first;
  if (status?.BackendState !== 'Running') {
    return { status, serveStatus: undefined, funnelStatus: undefined };
  }
  return {
    status,
    serveStatus: parseJsonResult(
      await runCommand(serveStatusCommand()),
      'tailscale-serve-status',
    ),
    funnelStatus: parseJsonResult(
      await runCommand(funnelStatusCommand()),
      'tailscale-funnel-status',
    ),
  };
};

const readUnitStates = async () => {
  const states = {};
  for (const unit of [GUARDIAN_TIMER, GUARDIAN_SERVICE, STACK_SERVICE]) {
    const result = await runCommand(
      command('unit-state', SYSTEMCTL, [
        'show',
        '--property=ActiveState',
        '--value',
        unit,
      ]),
    );
    states[unit] = result.stdout.toString('utf8').trim();
  }
  return states;
};

const validateUnitsStopped = (states) => {
  for (const unit of [GUARDIAN_TIMER, GUARDIAN_SERVICE, STACK_SERVICE]) {
    if (states[unit] !== 'inactive') {
      refuse('E_UNIT_ACTIVE', 'A Bookkeeping systemd unit is not stopped.');
    }
  }
  return states;
};

const collectLockedProof = async (authority) => {
  const inspections = parseDockerInspections(
    await runCommand(
      inspectCommand('runtime-inspect', [
        ...ALL_RUNTIME_CONTAINERS,
        MIGRATION_CONTAINER,
      ]),
    ),
    LONG_RUNNING_CONTAINERS.length + 1,
  );
  const runtime = validateStoppedRuntime(
    inspections,
    authority.resources,
    authority.migration,
  );
  const listeningPorts = await readListeningPorts();
  assertPortsAbsent(listeningPorts, [443, 8080]);
  const tailscale = validateTailscaleIsolation({
    ...(await tailscaleSnapshot({ disable: false })),
    listeningPorts,
  });
  const unitStates = validateUnitsStopped(await readUnitStates());
  return { runtime, tailscale, unitStates };
};

const neutralizeRestartPolicy = async (authority, stage) => {
  await runCommand(
    command(stage, DOCKER, [
      'update',
      '--restart',
      'no',
      ...ALL_RUNTIME_CONTAINERS,
    ]),
  );
  const inspections = parseDockerInspections(
    await runCommand(inspectCommand(`${stage}-inspect`, ALL_RUNTIME_CONTAINERS)),
    ALL_RUNTIME_CONTAINERS.length,
  );
  validateRestartPolicies(inspections, authority.resources, 'no');
};

const quiesceRuntime = async (authority) => {
  await neutralizeRestartPolicy(authority, 'restart-neutralize');
  await runCommand(
    command('guardian-stop', SYSTEMCTL, [
      'stop',
      GUARDIAN_TIMER,
      GUARDIAN_SERVICE,
    ]),
  ).catch(() => undefined);
  await runCommand(
    command('stack-stop', SYSTEMCTL, ['stop', STACK_SERVICE]),
  ).catch(() => undefined);
  await tailscaleSnapshot({ disable: true }).catch(() => undefined);
  await runCommand(
    command('stateless-stop', DOCKER, [
      'container',
      'stop',
      '--time',
      '30',
      ...STATELESS_CONTAINERS,
    ]),
  );
  const stateless = parseDockerInspections(
    await runCommand(inspectCommand('stateless-inspect', STATELESS_CONTAINERS)),
    STATELESS_CONTAINERS.length,
  );
  validateBoundSubset(
    stateless,
    authority.resources,
    LONG_RUNNING_CONTAINERS.filter(({ name }) =>
      STATELESS_CONTAINERS.includes(name),
    ),
    'no',
  );
  if (stateless.some((container) => container.State?.Status !== 'exited' || container.State?.Running !== false)) {
    refuse('E_RUNTIME_ACTIVE', 'A stateless Bookkeeping container is not stopped.');
  }
  await runCommand(
    command('data-stop', DOCKER, [
      'container',
      'stop',
      '--time',
      '30',
      ...DATA_CONTAINERS,
    ]),
  );
  const proof = await collectLockedProof(authority);
  return proof;
};

const buildArmedReceipt = (lock, lockSha256, proof) => ({
  schemaVersion: 1,
  project: PROJECT,
  kind: 'easyfire-bookkeeping-rollback-armed-receipt',
  status: 'locked-verified',
  lockId: lock.lockId,
  reason: lock.reason,
  completedAt: new Date().toISOString(),
  lockSha256,
  deployment: lock.deployment,
  proof: {
    stoppedContainers: proof.runtime.stoppedContainers,
    migrationExitCode: proof.runtime.migrationExitCode,
    unitStates: proof.unitStates,
    tailscale: proof.tailscale,
    absentListeners: [443, 8080],
    resourcesPreserved: true,
  },
});

export const validateArmedReceipt = (receipt, lock, lockSha256) => {
  exactKeys(receipt, [
    'schemaVersion', 'project', 'kind', 'status', 'lockId', 'reason',
    'completedAt', 'lockSha256', 'deployment', 'proof',
  ], 'Armed receipt');
  exactKeys(receipt.proof, [
    'stoppedContainers', 'migrationExitCode', 'unitStates', 'tailscale',
    'absentListeners', 'resourcesPreserved',
  ], 'Armed receipt proof');
  exactKeys(receipt.proof.unitStates, [GUARDIAN_TIMER, GUARDIAN_SERVICE, STACK_SERVICE], 'Armed receipt unit states');
  exactKeys(receipt.proof.tailscale, ['enrolled', 'serveAbsent', 'funnelAbsent'], 'Armed receipt Tailscale proof');
  if (
    !isObject(receipt) ||
    receipt.schemaVersion !== 1 ||
    receipt.project !== PROJECT ||
    receipt.kind !== 'easyfire-bookkeeping-rollback-armed-receipt' ||
    receipt.status !== 'locked-verified' ||
    receipt.lockId !== lock.lockId ||
    receipt.reason !== lock.reason ||
    receipt.lockSha256 !== lockSha256 ||
    receipt.proof?.migrationExitCode !== 0 ||
    receipt.proof?.resourcesPreserved !== true ||
    receipt.proof.tailscale.serveAbsent !== true ||
    receipt.proof.tailscale.funnelAbsent !== true ||
    [GUARDIAN_TIMER, GUARDIAN_SERVICE, STACK_SERVICE].some(
      (unit) => receipt.proof.unitStates[unit] !== 'inactive',
    ) ||
    JSON.stringify(receipt.deployment) !== JSON.stringify(lock.deployment) ||
    JSON.stringify(receipt.proof?.stoppedContainers) !==
      JSON.stringify(ALL_RUNTIME_CONTAINERS) ||
    JSON.stringify(receipt.proof?.absentListeners) !== JSON.stringify([443, 8080])
  ) {
    refuse('E_ARMED_RECEIPT', 'Armed receipt is invalid.');
  }
  canonicalTime(receipt.completedAt, 'Armed receipt completedAt');
};

async function verifyLocked({ emitRebootProof = false, requireRebootProof = false } = {}) {
  const lockDocument = await readSecureDocument(LOCK_PATH, 'Rollback lock');
  const lock = validateLockDocument(lockDocument.value);
  const verification = {
    ok: true,
    mode: 'verify-existing',
    deploymentId: lock.deployment.deploymentId,
    releaseCommit: lock.deployment.releaseCommit,
  };
  const authority = await readAuthority(verification);
  validateLockAgainstAuthority(lock, authority.authority);
  const armedDocument = await readSecureDocument(
    `${lock.evidenceDirectory}/armed.json`,
    'Armed receipt',
  );
  validateArmedReceipt(armedDocument.value, lock, sha256(lockDocument.bytes));
  const proof = await collectLockedProof(authority);
  let lockedRebootProofSha256 = null;
  let lockedRebootProofPath = null;
  if (emitRebootProof) {
    const bootIdAfter = await readBootId();
    lockedRebootProofPath = `${lock.evidenceDirectory}/locked-reboot.json`;
    if (bootIdAfter !== lock.bootIdAtArm) {
      const candidate = buildLockedRebootReceipt({
        lock,
        lockSha256: sha256(lockDocument.bytes),
        armedReceiptSha256: sha256(armedDocument.bytes),
        bootIdAfter,
        proof,
      });
      if (await pathExists(lockedRebootProofPath)) {
        const existing = await readSecureDocument(
          lockedRebootProofPath,
          'Locked reboot receipt',
        );
        validateLockedRebootReceipt(
          existing.value,
          lock,
          sha256(lockDocument.bytes),
          sha256(armedDocument.bytes),
        );
        if (existing.value.bootIdAfter !== bootIdAfter) {
          refuse(
            'E_LOCKED_REBOOT',
            'Locked reboot receipt belongs to a different post-lock boot.',
          );
        }
        lockedRebootProofSha256 = sha256(existing.bytes);
      } else {
        await writeJsonExclusiveAtomic(lockedRebootProofPath, candidate);
        const published = await readSecureDocument(
          lockedRebootProofPath,
          'Locked reboot receipt',
        );
        validateLockedRebootReceipt(
          published.value,
          lock,
          sha256(lockDocument.bytes),
          sha256(armedDocument.bytes),
        );
        lockedRebootProofSha256 = sha256(published.bytes);
      }
    }
  }
  if (requireRebootProof && !lockedRebootProofSha256) {
    refuse(
      'E_LOCKED_REBOOT_REQUIRED',
      'Rehearsal rearm requires a durable locked-reboot proof from a later boot.',
    );
  }
  return {
    lock,
    lockBytes: lockDocument.bytes,
    lockSha256: sha256(lockDocument.bytes),
    authority,
    armedReceiptSha256: sha256(armedDocument.bytes),
    lockedRebootProofPath,
    lockedRebootProofSha256,
    proof,
  };
}

async function arm(reason) {
  const verification = await runDeploymentVerification('deployment-preflight');
  const authority = await readAuthority(verification);
  const lock = createLockDocument(authority.authority, reason, {
    bootIdAtArm: await readBootId(),
  });
  let lockPublished = false;
  try {
    await neutralizeRestartPolicy(authority, 'restart-neutralize');
    await createEvidenceDirectory(lock);
    await writeJsonExclusiveAtomic(LOCK_PATH, lock);
    lockPublished = true;
  } catch (error) {
    if (!lockPublished && (await pathExists(LOCK_PATH))) lockPublished = true;
    if (lockPublished) {
      try {
        await quiesceRuntime(authority);
      } catch {
        refuse(
          'E_ARM_CONTAINMENT',
          'Arm failed after lock publication and stopped containment could not be proven.',
        );
      }
    }
    if (!lockPublished) {
      try {
        await runDeploymentVerification('deployment-reverify');
      } catch {
        refuse(
          'E_ARM_CONTAINMENT',
          'Arm failed before lock publication and deployment authority could not be re-proven.',
        );
      }
    }
    throw error;
  }
  const lockDocument = await readSecureDocument(LOCK_PATH, 'Rollback lock');
  const proof = await quiesceRuntime(authority);
  await writeJsonExclusiveAtomic(
    `${lock.evidenceDirectory}/armed.json`,
    buildArmedReceipt(lock, sha256(lockDocument.bytes), proof),
  );
  await verifyLocked();
  return { deploymentId: lock.deployment.deploymentId, reason };
}

const moveLockToEvidence = async (locked) => {
  const destination = `${locked.lock.evidenceDirectory}/rollback.lock.json`;
  if (await pathExists(destination)) {
    refuse('E_ALREADY_EXISTS', 'Archived rollback lock already exists.');
  }
  let moved = false;
  try {
    await rename(LOCK_PATH, destination);
    moved = true;
    await syncDirectory(path.dirname(LOCK_PATH));
    await syncDirectory(locked.lock.evidenceDirectory);
    const archived = await readSecureDocument(destination, 'Archived rollback lock');
    if (sha256(archived.bytes) !== locked.lockSha256) {
      refuse('E_LOCK_ARCHIVE', 'Archived rollback lock bytes changed.');
    }
  } catch (error) {
    if (moved) await restoreLiveLock(locked);
    throw error;
  }
  return destination;
};

const restoreLiveLock = async (locked) => {
  if (!(await pathExists(LOCK_PATH))) {
    await writeBytesExclusiveAtomic(LOCK_PATH, locked.lockBytes);
  }
};

async function rearm() {
  const locked = await verifyLocked({
    emitRebootProof: true,
    requireRebootProof: true,
  });
  assertRearmAllowed(locked.lock);
  const archivedLockPath = await moveLockToEvidence(locked);
  try {
    await writeJsonExclusiveAtomic(
      `${locked.lock.evidenceDirectory}/rearm-receipt.json`,
      {
        schemaVersion: 1,
        project: PROJECT,
        kind: 'easyfire-bookkeeping-rearm-receipt',
        status: 'authorized',
        authorizedAt: new Date().toISOString(),
        lockId: locked.lock.lockId,
        archivedLockPath,
        archivedLockSha256: locked.lockSha256,
        armedReceiptSha256: locked.armedReceiptSha256,
        lockedRebootProofSha256: locked.lockedRebootProofSha256,
        deployment: locked.lock.deployment,
        startAuthority: { unit: STACK_SERVICE, only: true },
      },
    );
    const rearmPlan = planRearmCommands();
    await runCommand(rearmPlan[0], { timeoutMs: 360_000 });
    const verification = await runDeploymentVerification('deployment-reverify');
    const authority = await readAuthority(verification);
    validateLockAgainstAuthority(locked.lock, authority.authority);
    await writeJsonExclusiveAtomic(
      `${locked.lock.evidenceDirectory}/rearm-complete.json`,
      {
        schemaVersion: 1,
        project: PROJECT,
        kind: 'easyfire-bookkeeping-rearm-completion',
        status: 'deployment-verified',
        completedAt: new Date().toISOString(),
        lockId: locked.lock.lockId,
        deployment: locked.lock.deployment,
        lockedRebootProofSha256: locked.lockedRebootProofSha256,
        guardianRemainsStopped: true,
        tailscaleRemainsDisabled: true,
        resourcesPreserved: true,
      },
    );
  } catch {
    try {
      await restoreLiveLock(locked);
      await quiesceRuntime(locked.authority);
    } catch {
      refuse(
        'E_REARM_CONTAINMENT',
        'Rearm failed and locked runtime containment could not be re-proven.',
      );
    }
    refuse('E_REARM_FAILED', 'Rearm failed; the runtime was locked and stopped again.');
  }
  return {
    deploymentId: locked.lock.deployment.deploymentId,
    reason: locked.lock.reason,
  };
}

const usage =
  'Usage: linux-rollback-lock.mjs --arm --reason rehearsal|rollback | --verify-locked | --rearm\n';

async function runCli() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage);
    return;
  }
  ensureLinuxRoot();
  if (path.resolve(process.argv[1]) !== CONTROLLER_PATH) {
    refuse('E_RELEASE_AUTHORITY', 'Use the current release-owned rollback controller.');
  }
  const result =
    parsed.mode === 'arm'
      ? await arm(parsed.reason)
      : parsed.mode === 'verify-locked'
        ? await verifyLocked({ emitRebootProof: true, requireRebootProof: true })
        : await rearm();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: parsed.mode,
      deploymentId:
        result.deploymentId ?? result.lock.deployment.deploymentId,
      reason: result.reason ?? result.lock.reason,
    })}\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
) {
  runCli().catch((error) => {
    const refusal =
      error instanceof RollbackRefusal
        ? error
        : new RollbackRefusal('E_INTERNAL', 'Unexpected rollback-lock failure.');
    process.stderr.write(
      `Rollback-lock controller refused [${refusal.code}]: ${refusal.message}\n`,
    );
    process.exitCode =
      refusal.code === 'E_USAGE'
        ? 64
        : refusal.code === 'E_PLATFORM'
          ? 69
          : refusal.code === 'E_ROOT_REQUIRED'
            ? 77
            : 1;
  });
}
