#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  safeHashEqual,
  validateCutoverPlan,
} from './direct-vm-cutover-contract.mjs';
import { validateDeploymentPlan } from './linux-deploy-plan.mjs';
import { parseManifestBoundRelease } from './linux-release-authority-verify.mjs';

export const GUARDIAN_CONFIG = '/etc/easyfire-bookkeeping/guardian.json';
export const SHADOW_CONFIG = '/etc/easyfire-bookkeeping/guardian.shadow.json';
export const SHADOW_PROOF = '/etc/easyfire-bookkeeping/guardian-proof/shadow.json';
export const ACTIVE_PROOF = '/etc/easyfire-bookkeeping/guardian-proof/active-disposable.json';
export const PROMOTION_RECEIPT = '/etc/easyfire-bookkeeping/guardian-active-promotion.json';
const CUTOVER_PLAN = '/etc/easyfire-bookkeeping/cutover-plan.json';
const DEPLOYMENT_PLAN = '/etc/easyfire-bookkeeping/deployment-plan.json';
const PENDING_CONFIG = '/etc/easyfire-bookkeeping/guardian.json.active-pending';
const SYSTEMCTL = '/usr/bin/systemctl';
const TIMER = 'easyfire-bookkeeping-guardian.timer';
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

export class GuardianPromotionRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuardianPromotionRefusal';
    this.code = code;
  }
}
const refuse = (code, message) => { throw new GuardianPromotionRefusal(code, message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, label) => {
  if (!isObject(value)) refuse('E_SHAPE', `${label} must be an object.`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    refuse('E_KEYS', `${label} has missing or unexpected fields.`);
  }
};
const validTime = (value, label) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) refuse('E_TIME', `${label} is invalid.`);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const EXPECTED_PROBES = Object.freeze([
  { name: 'web', url: 'http://127.0.0.1:8080/', timeoutMs: 3000, expectedStatus: 200 },
  { name: 'api-system', url: 'http://127.0.0.1:8080/api/system_db', timeoutMs: 3000, expectedStatus: 200 },
  { name: 'auth-meta', url: 'http://127.0.0.1:8080/api/auth/meta', timeoutMs: 3000, expectedStatus: 200 },
]);

export function validateGuardianConfig(candidate, shadowMode) {
  exactKeys(candidate, [
    'schemaVersion', 'runtimeManifestPath', 'statePath', 'statusPath',
    'dockerSocketPath', 'failureThreshold', 'cooldownSeconds',
    'attemptWindowSeconds', 'maxRecoveryAttempts', 'shadowMode', 'probes',
  ], 'Guardian config');
  if (
    candidate.schemaVersion !== 1 ||
    candidate.runtimeManifestPath !== '/etc/easyfire-bookkeeping/runtime-manifest.json' ||
    candidate.statePath !== '/var/lib/easyfire-bookkeeping-guardian/state.json' ||
    candidate.statusPath !== '/var/lib/easyfire-bookkeeping-guardian/status.json' ||
    candidate.dockerSocketPath !== '/var/run/docker.sock' ||
    candidate.failureThreshold !== 3 ||
    candidate.cooldownSeconds !== 900 ||
    candidate.attemptWindowSeconds !== 3600 ||
    candidate.maxRecoveryAttempts !== 2 ||
    candidate.shadowMode !== shadowMode ||
    !Array.isArray(candidate.probes) ||
    candidate.probes.length !== EXPECTED_PROBES.length
  ) refuse('E_CONFIG', 'Guardian config is not the exact production policy.');
  candidate.probes.forEach((probe, index) => {
    exactKeys(probe, ['name', 'url', 'timeoutMs', 'expectedStatus'], `Guardian probe ${index}`);
    if (JSON.stringify(probe) !== JSON.stringify(EXPECTED_PROBES[index])) {
      refuse('E_CONFIG', `Guardian probe ${index} drifted.`);
    }
  });
  return candidate;
}

export function buildActiveGuardianConfig(shadowCandidate) {
  const shadow = validateGuardianConfig(shadowCandidate, true);
  return validateGuardianConfig({ ...shadow, shadowMode: false }, false);
}

export function validateGuardianRehearsalProofs({
  shadowProof,
  activeProof,
  shadowConfigSha256,
  activeConfigSha256,
}) {
  if (!SHA256.test(shadowConfigSha256) || !SHA256.test(activeConfigSha256)) {
    refuse('E_PROOF_HASH', 'Guardian config hashes are invalid.');
  }
  exactKeys(shadowProof, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'deploymentId',
    'releaseCommit', 'configSha256', 'healthyObservationsPassed',
    'disposableOnly', 'productionMutationCount',
  ], 'Guardian shadow proof');
  exactKeys(activeProof, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'deploymentId',
    'releaseCommit', 'configSha256', 'statelessRecoveryPassed',
    'cooldownBudgetPassed', 'databaseAutoRecoveryRefused',
    'identityMismatchRefused', 'healthyAfterRehearsal', 'disposableOnly',
    'productionMutationCount',
  ], 'Guardian active disposable proof');
  validTime(shadowProof.completedAt, 'Guardian shadow proof time');
  validTime(activeProof.completedAt, 'Guardian active proof time');
  if (
    shadowProof.schemaVersion !== 1 ||
    activeProof.schemaVersion !== 1 ||
    shadowProof.project !== 'easyfire-bookkeeping' ||
    activeProof.project !== 'easyfire-bookkeeping' ||
    shadowProof.kind !== 'easyfire-bookkeeping-guardian-shadow-rehearsal' ||
    activeProof.kind !== 'easyfire-bookkeeping-guardian-active-disposable-rehearsal' ||
    shadowProof.status !== 'passed' ||
    activeProof.status !== 'passed' ||
    shadowProof.deploymentId !== activeProof.deploymentId ||
    shadowProof.releaseCommit !== activeProof.releaseCommit ||
    !COMMIT.test(shadowProof.releaseCommit ?? '') ||
    shadowProof.configSha256 !== shadowConfigSha256 ||
    activeProof.configSha256 !== activeConfigSha256 ||
    shadowProof.healthyObservationsPassed !== true ||
    activeProof.statelessRecoveryPassed !== true ||
    activeProof.cooldownBudgetPassed !== true ||
    activeProof.databaseAutoRecoveryRefused !== true ||
    activeProof.identityMismatchRefused !== true ||
    activeProof.healthyAfterRehearsal !== true ||
    shadowProof.disposableOnly !== true ||
    activeProof.disposableOnly !== true ||
    shadowProof.productionMutationCount !== 0 ||
    activeProof.productionMutationCount !== 0
  ) refuse('E_REHEARSAL', 'Guardian shadow/active disposable proof is incomplete or mixed.');
  return { deploymentId: shadowProof.deploymentId, releaseCommit: shadowProof.releaseCommit };
}

const assertSecureRootFile = async (file, mode = 0o600) => {
  const resolved = await realpath(file).catch(() => null);
  if (resolved !== file) refuse('E_FILE', `Required file is missing or traverses a symlink: ${file}`);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== mode || stat.size < 2 || stat.size > 1024 * 1024) {
    refuse('E_FILE', `Required file authority is invalid: ${file}`);
  }
};
const readSecureJson = async (file, mode = 0o600) => {
  await assertSecureRootFile(file, mode);
  const bytes = await readFile(file);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { refuse('E_JSON', `Required file is not valid JSON: ${file}`); }
};
const assertImmutableReleaseExecutor = async (authority) => {
  const [cutoverDocument, deploymentDocument] = await Promise.all([
    readSecureJson(CUTOVER_PLAN),
    readSecureJson(DEPLOYMENT_PLAN),
  ]);
  const cutover = validateCutoverPlan(cutoverDocument.value);
  const deployment = validateDeploymentPlan(deploymentDocument.value);
  const releaseRoot = `/opt/easyfire-bookkeeping/releases/${authority.releaseCommit}`;
  const executablePath = `${releaseRoot}/scripts/production/linux-guardian-promote-active.mjs`;
  if (await realpath(process.argv[1]).catch(() => null) !== executablePath) {
    refuse('E_EXECUTOR_PATH', 'Guardian promotion is not running from the immutable release.');
  }
  await assertSecureRootFile(executablePath, 0o644);
  const executable = await readFile(executablePath);
  const manifestDocument = await readSecureJson(`${releaseRoot}/release-manifest.json`, 0o644);
  const manifest = parseManifestBoundRelease(manifestDocument.value);
  const artifact = manifest.artifacts.find(({ path: artifactPath }) =>
    artifactPath === 'scripts/production/linux-guardian-promote-active.mjs');
  if (
    cutover.controller.releaseCommit !== authority.releaseCommit ||
    deployment.deploymentId !== authority.deploymentId ||
    deployment.releaseCommit !== authority.releaseCommit ||
    manifest.releaseCommit !== authority.releaseCommit ||
    !safeHashEqual(sha256(manifestDocument.bytes), cutover.controller.releaseManifestSha256) ||
    !safeHashEqual(sha256(manifestDocument.bytes), deployment.releaseManifest.sha256) ||
    !safeHashEqual(sha256(executable), cutover.controller.guardianPromotionSha256) ||
    !artifact || artifact.mode !== '0644' || artifact.bytes !== executable.length ||
    !safeHashEqual(artifact.sha256, sha256(executable))
  ) refuse('E_EXECUTOR_HASH', 'Guardian promotion is not an exact cutover/manifest-bound artifact.');
  return {
    executablePath,
    executableSha256: sha256(executable),
    releaseManifestSha256: sha256(manifestDocument.bytes),
    cutoverPlanSha256: sha256(cutoverDocument.bytes),
    deploymentPlanSha256: sha256(deploymentDocument.bytes),
  };
};
const writeExclusive = async (file, bytes) => {
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    .catch((error) => {
      if (error?.code === 'EEXIST') refuse('E_ALREADY_EXISTS', `Refusing to replace ${file}.`);
      throw error;
    });
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
  } finally { await handle.close(); }
};
const syncDirectory = async (directory) => {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
};
const requireTimerInactive = () => new Promise((resolve, reject) => {
  const child = spawn(SYSTEMCTL, ['is-active', TIMER], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let bytes = 0;
  child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes <= 1024) chunks.push(chunk); });
  child.once('error', () => reject(new GuardianPromotionRefusal('E_TIMER', 'Guardian timer readback failed.')));
  child.once('close', (code) => {
    const state = Buffer.concat(chunks).toString('utf8').trim();
    if (bytes > 1024 || ![0, 3].includes(code) || state !== 'inactive') {
      reject(new GuardianPromotionRefusal('E_TIMER', 'Guardian timer must be inactive during promotion.'));
    } else resolve();
  });
});

async function promote() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    refuse('E_ROOT', 'Guardian active promotion requires Linux root.');
  }
  const [configDocument, shadowProofDocument, activeProofDocument] = await Promise.all([
    readSecureJson(GUARDIAN_CONFIG),
    readSecureJson(SHADOW_PROOF),
    readSecureJson(ACTIVE_PROOF),
  ]);
  const shadowConfig = validateGuardianConfig(configDocument.value, true);
  const activeConfig = buildActiveGuardianConfig(shadowConfig);
  const activeBytes = Buffer.from(`${JSON.stringify(activeConfig, null, 2)}\n`);
  const authority = validateGuardianRehearsalProofs({
    shadowProof: shadowProofDocument.value,
    activeProof: activeProofDocument.value,
    shadowConfigSha256: sha256(configDocument.bytes),
    activeConfigSha256: sha256(activeBytes),
  });
  const executor = await assertImmutableReleaseExecutor(authority);
  await requireTimerInactive();
  await writeExclusive(SHADOW_CONFIG, configDocument.bytes);
  await writeExclusive(PENDING_CONFIG, activeBytes);
  await rename(PENDING_CONFIG, GUARDIAN_CONFIG);
  await syncDirectory(path.dirname(GUARDIAN_CONFIG));
  const readback = await readSecureJson(GUARDIAN_CONFIG);
  validateGuardianConfig(readback.value, false);
  if (sha256(readback.bytes) !== sha256(activeBytes)) refuse('E_READBACK', 'Guardian active config bytes drifted.');
  const receipt = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-guardian-active-promotion',
    status: 'active-config-materialized',
    promotedAt: new Date().toISOString(),
    deploymentId: authority.deploymentId,
    releaseCommit: authority.releaseCommit,
    ...executor,
    shadowConfigPath: SHADOW_CONFIG,
    shadowConfigSha256: sha256(configDocument.bytes),
    productionConfigPath: GUARDIAN_CONFIG,
    productionConfigSha256: sha256(readback.bytes),
    shadowProofSha256: sha256(shadowProofDocument.bytes),
    activeProofSha256: sha256(activeProofDocument.bytes),
    timerWasInactive: true,
    timerActivationPerformed: false,
    resourcesDeleted: false,
  };
  await writeExclusive(PROMOTION_RECEIPT, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  return receipt;
}

async function runCli() {
  const args = process.argv.slice(2);
  if (
    JSON.stringify(args) !== JSON.stringify([
      '--promote', '--shadow-proof', SHADOW_PROOF, '--active-proof', ACTIVE_PROOF,
    ])
  ) refuse('E_USAGE', 'Use the exact fixed Guardian promotion command.');
  const receipt = await promote();
  process.stdout.write(`${JSON.stringify({ status: receipt.status, receipt: PROMOTION_RECEIPT })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.code ?? 'E_GUARDIAN_PROMOTION'}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
