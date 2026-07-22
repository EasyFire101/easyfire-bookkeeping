#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalJson,
  CutoverRefusal,
  safeHashEqual,
  sha256,
  TAILSCALE_DNS_NAME,
  TAILSCALE_ORIGIN,
  validateActivationAuthorization,
} from './direct-vm-cutover-contract.mjs';
import { parseManifestBoundRelease } from './linux-release-authority-verify.mjs';
import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';

const NODE = '/usr/local/bin/node';
const TAILSCALE = '/usr/bin/tailscale';
export const EXPECTED_TAILSCALE_VERSION = '1.98.9';
const SS = '/usr/bin/ss';
const DEPLOYMENT_PLAN = '/etc/easyfire-bookkeeping/deployment-plan.json';
const AUTHORIZATION_PATH =
  '/etc/easyfire-bookkeeping/cutover-authorization.json';
const ACTIVATION_LOCK =
  '/etc/easyfire-bookkeeping/private-route-activation.lock';
const ACTIVATION_RECEIPT =
  '/etc/easyfire-bookkeeping/private-route-activation.json';
export const CUTOVER_DECISION_PATH =
  '/etc/easyfire-bookkeeping/cutover-decision.json';
const MAX_OUTPUT = 1024 * 1024;
const MAX_DECISION_BYTES = 16 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;

const refuse = (code, message) => {
  throw new CutoverRefusal(code, message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasConfiguration = (value) => {
  if (value === null || value === undefined || value === false || value === '') {
    return false;
  }
  if (Array.isArray(value)) return value.some(hasConfiguration);
  if (isObject(value)) return Object.values(value).some(hasConfiguration);
  return true;
};

export function validatePreActivationNetwork({
  tailscaleStatus,
  serveStatus,
  funnelStatus,
  listeningPorts,
}) {
  if (
    !isObject(tailscaleStatus) ||
    tailscaleStatus.BackendState !== 'Running' ||
    tailscaleStatus.Self?.Online !== true ||
    tailscaleStatus.Self?.DNSName !== `${TAILSCALE_DNS_NAME}.`
  ) refuse('E_TAILSCALE_IDENTITY', 'Tailscale is not the exact online target identity.');
  if (hasConfiguration(serveStatus)) {
    refuse('E_TAILSCALE_SERVE', 'Tailscale Serve was already configured.');
  }
  if (hasConfiguration(funnelStatus)) {
    refuse('E_TAILSCALE_FUNNEL', 'Tailscale Funnel was already configured.');
  }
  if (!Array.isArray(listeningPorts) || listeningPorts.some((port) => port === 443)) {
    refuse('E_PUBLIC_LISTENER', 'An HTTPS listener already exists outside the authorized route.');
  }
  return { safe: true, tailscaleStatus, serveAbsent: true, funnelAbsent: true };
}

const exactKeys = (value, keys) =>
  isObject(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function buildCutoverDecisionClaim({
  decision,
  cutoverId,
  deploymentId,
  releaseCommit,
  authoritySha256,
  claimedAt = new Date().toISOString(),
}) {
  const claim = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-cutover-decision',
    status: 'claimed-once',
    decision,
    claimedAt,
    cutoverId,
    deploymentId,
    releaseCommit,
    authorityKind: decision === 'abort'
      ? 'release-bound-guest-isolation-collector'
      : 'activation-authorization',
    authoritySha256,
  };
  return validateCutoverDecisionClaim(claim);
}

export function validateCutoverDecisionClaim(candidate, expectedDecision) {
  if (!exactKeys(candidate, [
    'schemaVersion', 'project', 'kind', 'status', 'decision', 'claimedAt',
    'cutoverId', 'deploymentId', 'releaseCommit', 'authorityKind',
    'authoritySha256',
  ])) refuse('E_CUTOVER_DECISION', 'Cutover decision shape is invalid.');
  const expectedAuthority = candidate.decision === 'abort'
    ? 'release-bound-guest-isolation-collector'
    : 'activation-authorization';
  if (
    candidate.schemaVersion !== 1 || candidate.project !== 'easyfire-bookkeeping' ||
    candidate.kind !== 'easyfire-bookkeeping-cutover-decision' ||
    candidate.status !== 'claimed-once' ||
    !['abort', 'activate'].includes(candidate.decision) ||
    (expectedDecision && candidate.decision !== expectedDecision) ||
    candidate.authorityKind !== expectedAuthority ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate.cutoverId ?? '') ||
    !/^direct-vm-[0-9]{8}-[a-f0-9]{8}$/.test(candidate.deploymentId ?? '') ||
    !COMMIT.test(candidate.releaseCommit ?? '') ||
    !/^[a-f0-9]{64}$/.test(candidate.authoritySha256 ?? '') ||
    typeof candidate.claimedAt !== 'string' ||
    Number.isNaN(Date.parse(candidate.claimedAt)) ||
    new Date(candidate.claimedAt).toISOString() !== candidate.claimedAt
  ) refuse('E_CUTOVER_DECISION', 'Cutover decision identity is invalid.');
  return candidate;
}

const sameDecisionFileState = (left, right) =>
  left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
  left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;

export async function rereadCutoverDecisionWinner(
  target,
  intendedBytes,
  intendedSha256,
  intendedDocument,
) {
  validateCutoverDecisionClaim(intendedDocument);
  if (!Buffer.isBuffer(intendedBytes) || !/^[a-f0-9]{64}$/.test(intendedSha256 ?? '')) {
    refuse('E_CUTOVER_DECISION_READBACK', 'Intended cutover decision bytes or hash are invalid.');
  }
  const canonical = await realpath(target).catch(() => null);
  if (canonical === null || path.resolve(canonical) !== path.resolve(target)) {
    refuse('E_CUTOVER_DECISION_READBACK', 'Published cutover decision path is not canonical.');
  }
  const pathBefore = await lstat(target);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  let handleBefore;
  let handleAfter;
  let onDiskBytes;
  try {
    handle = await open(target, constants.O_RDONLY | noFollow);
    handleBefore = await handle.stat();
    onDiskBytes = await handle.readFile();
    handleAfter = await handle.stat();
  } catch {
    refuse('E_CUTOVER_DECISION_READBACK', 'Published cutover decision could not be securely reopened.');
  } finally {
    await handle?.close().catch(() => {});
  }
  const pathAfter = await lstat(target);
  const unsafeLinuxAuthority = process.platform === 'linux' &&
    ((pathAfter.mode & 0o777) !== 0o600 || pathAfter.uid !== 0);
  if (
    pathBefore.isSymbolicLink() || !pathBefore.isFile() ||
    !handleBefore?.isFile() || !handleAfter?.isFile() ||
    pathAfter.isSymbolicLink() || !pathAfter.isFile() || unsafeLinuxAuthority ||
    pathAfter.size < 2 || pathAfter.size > MAX_DECISION_BYTES ||
    !sameDecisionFileState(pathBefore, handleBefore) ||
    !sameDecisionFileState(handleBefore, handleAfter) ||
    !sameDecisionFileState(handleAfter, pathAfter)
  ) refuse('E_CUTOVER_DECISION_READBACK', 'Published cutover decision authority or file state drifted.');
  let onDiskDocument;
  try { onDiskDocument = JSON.parse(onDiskBytes.toString('utf8')); }
  catch { refuse('E_CUTOVER_DECISION_READBACK', 'Published cutover decision is not valid JSON.'); }
  validateCutoverDecisionClaim(onDiskDocument, intendedDocument.decision);
  const onDiskSha256 = createHash('sha256').update(onDiskBytes).digest('hex');
  if (
    !onDiskBytes.equals(intendedBytes) || onDiskSha256 !== intendedSha256 ||
    JSON.stringify(onDiskDocument) !== JSON.stringify(intendedDocument)
  ) refuse('E_CUTOVER_DECISION_READBACK', 'Published cutover decision bytes differ from the winner.');
  return { document: onDiskDocument, bytes: onDiskBytes, sha256: onDiskSha256 };
}

export async function writeCutoverDecisionExclusiveForTarget(target, document) {
  validateCutoverDecisionClaim(document);
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  const intendedSha256 = createHash('sha256').update(bytes).digest('hex');
  let handle;
  try {
    handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      refuse('E_CUTOVER_DECISION_CLAIMED', 'Abort or activation already owns the cutover decision.');
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
  return rereadCutoverDecisionWinner(target, bytes, intendedSha256, document);
}

export const claimCutoverDecision = async (document) => {
  const directory = path.dirname(CUTOVER_DECISION_PATH);
  const metadata = await lstat(directory);
  if (
    await realpath(directory) !== directory || !metadata.isDirectory() ||
    metadata.uid !== 0 || ((metadata.mode & 0o777) & 0o022) !== 0
  ) refuse('E_CUTOVER_DECISION', 'Cutover decision directory authority is unsafe.');
  const claimed = await writeCutoverDecisionExclusiveForTarget(
    CUTOVER_DECISION_PATH,
    document,
  );
  const directoryHandle = await open(directory, constants.O_RDONLY);
  try { await directoryHandle.sync(); }
  finally { await directoryHandle.close(); }
  return claimed;
};

export function validatePostActivationNetwork({
  tailscaleStatus,
  serveStatus,
  funnelStatus,
  listeningPorts,
}) {
  if (
    !isObject(tailscaleStatus) ||
    tailscaleStatus.BackendState !== 'Running' ||
    tailscaleStatus.Self?.Online !== true ||
    tailscaleStatus.Self?.DNSName !== `${TAILSCALE_DNS_NAME}.`
  ) refuse('E_TAILSCALE_IDENTITY', 'Tailscale identity drifted during route activation.');
  if (!isObject(serveStatus) || !exactKeys(serveStatus, ['TCP', 'Web', 'AllowFunnel'])) {
    refuse('E_TAILSCALE_SERVE', 'Tailscale Serve status shape is ambiguous.');
  }
  if (hasConfiguration(serveStatus.TCP)) {
    refuse('E_TAILSCALE_SERVE', 'Unexpected Tailscale TCP Serve configuration exists.');
  }
  if (hasConfiguration(serveStatus.AllowFunnel)) {
    refuse('E_TAILSCALE_FUNNEL', 'Tailscale Funnel exposure is configured.');
  }
  if (hasConfiguration(funnelStatus)) {
    refuse('E_TAILSCALE_FUNNEL', 'Tailscale Funnel became configured during activation.');
  }
  const webKeys = Object.keys(serveStatus.Web ?? {});
  const expectedHost = `${TAILSCALE_DNS_NAME}:443`;
  if (webKeys.length !== 1 || webKeys[0] !== expectedHost) {
    refuse('E_TAILSCALE_SERVE', 'Tailscale Serve does not contain exactly one private HTTPS host.');
  }
  const web = serveStatus.Web[expectedHost];
  if (
    !exactKeys(web, ['Handlers']) ||
    !exactKeys(web.Handlers, ['/']) ||
    !exactKeys(web.Handlers['/'], ['Proxy']) ||
    web.Handlers['/'].Proxy !== TAILSCALE_ORIGIN
  ) refuse('E_TAILSCALE_SERVE', 'Tailscale Serve origin is not exact.');
  if (!Array.isArray(listeningPorts) || listeningPorts.some((port) => port === 443)) {
    refuse('E_PUBLIC_LISTENER', 'Route activation created an unexpected host HTTPS listener.');
  }
  return {
    tailnetOnly: true,
    serveHosts: [expectedHost],
    funnelAllowed: false,
    funnelAbsent: true,
  };
}

export function validateTailscaleVersion(output) {
  const firstLine = String(output).replace(/\r/g, '').split('\n')[0].trim();
  if (firstLine !== EXPECTED_TAILSCALE_VERSION) {
    refuse('E_TAILSCALE_VERSION', 'Installed Tailscale version does not match the security-fixed pin.');
  }
  return firstLine;
}

export function revalidateActivationFreshnessBeforeServe(authorization, now = new Date()) {
  return validateActivationAuthorization(authorization, now);
}

const command = (stage, file, args, timeoutMs = 60_000) => ({
  stage,
  file,
  args,
  timeoutMs,
});

export function planActivationCommands(releaseCommit) {
  if (!COMMIT.test(releaseCommit ?? '')) {
    refuse('E_RELEASE_COMMIT', 'Private-route activation release commit is invalid.');
  }
  const deploymentController =
    `/opt/easyfire-bookkeeping/releases/${releaseCommit}/scripts/production/linux-deploy-candidate.mjs`;
  return [
    command('tailscale-version', TAILSCALE, ['version']),
    command('deployment-preflight', NODE, [
      deploymentController,
      '--verify-existing',
      '--plan',
      DEPLOYMENT_PLAN,
    ], 360_000),
    command('tailscale-status-before', TAILSCALE, ['status', '--json']),
    command('tailscale-serve-before', TAILSCALE, ['serve', 'status', '--json']),
    command('tailscale-funnel-before', TAILSCALE, ['funnel', 'status', '--json']),
    command('listeners-before', SS, ['-H', '-ltn']),
    command('activate-private-route', TAILSCALE, [
      'serve',
      '--bg',
      '--https=443',
      TAILSCALE_ORIGIN,
    ]),
    command('tailscale-status-after', TAILSCALE, ['status', '--json']),
    command('tailscale-serve-after', TAILSCALE, ['serve', 'status', '--json']),
    command('tailscale-funnel-after', TAILSCALE, ['funnel', 'status', '--json']),
    command('listeners-after', SS, ['-H', '-ltn']),
    command('deployment-postcheck', NODE, [
      deploymentController,
      '--verify-existing',
      '--plan',
      DEPLOYMENT_PLAN,
    ], 360_000),
  ];
}

const ensureRoot = () => {
  if (process.platform !== 'linux') refuse('E_PLATFORM', 'Private-route activator runs only on Linux.');
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    refuse('E_ROOT_REQUIRED', 'Private-route activator must run as root.');
  }
};

const assertSecureFile = async (filePath, exactMode = 0o600) => {
  const resolved = await realpath(filePath).catch(() => null);
  if (resolved !== filePath) refuse('E_FILE_PATH', 'Required authority file is missing or traverses a symlink.');
  const metadata = await lstat(filePath);
  const mode = metadata.mode & 0o777;
  if (
    !metadata.isFile() ||
    metadata.uid !== 0 ||
    mode !== exactMode ||
    metadata.size < 2 ||
    metadata.size > 2 * 1024 * 1024
  ) refuse('E_FILE_AUTHORITY', 'Required authority file ownership, mode, type, or size is unsafe.');
  return metadata;
};

const readSecureJson = async (filePath, label, mode = 0o600) => {
  await assertSecureFile(filePath, mode);
  const bytes = await readFile(filePath);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
  } catch {
    refuse('E_JSON', `${label} is not valid JSON.`);
  }
};

const assertImmutableReleaseExecutor = async (authorization, releaseManifestSha256) => {
  const releaseRoot = `/opt/easyfire-bookkeeping/releases/${authorization.deployment.releaseCommit}`;
  const executablePath = `${releaseRoot}/scripts/production/linux-private-route-activate.mjs`;
  if (await realpath(process.argv[1]).catch(() => null) !== executablePath) {
    refuse('E_EXECUTOR_PATH', 'Private-route activator is not running from the immutable release.');
  }
  await assertSecureFile(executablePath, 0o644);
  const executable = await readFile(executablePath);
  const manifestDocument = await readSecureJson(
    `${releaseRoot}/release-manifest.json`,
    'Release manifest',
    0o644,
  );
  const manifest = parseManifestBoundRelease(manifestDocument.value);
  const artifact = manifest.artifacts.find(({ path: artifactPath }) =>
    artifactPath === 'scripts/production/linux-private-route-activate.mjs');
  if (
    manifest.releaseCommit !== authorization.deployment.releaseCommit ||
    !safeHashEqual(sha256(manifestDocument.bytes), releaseManifestSha256) ||
    !artifact ||
    artifact.mode !== '0644' ||
    artifact.bytes !== executable.length ||
    !safeHashEqual(artifact.sha256, sha256(executable))
  ) refuse('E_EXECUTOR_HASH', 'Private-route activator is not an exact manifest-bound artifact.');
  return {
    releaseRoot,
    executablePath,
    executableSha256: sha256(executable),
    releaseManifestSha256: sha256(manifestDocument.bytes),
  };
};

const run = ({ stage, file, args, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    const collect = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) {
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new CutoverRefusal('E_COMMAND', `${stage} could not start: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || bytes > MAX_OUTPUT || code !== 0 || signal) {
        reject(new CutoverRefusal('E_COMMAND', `${stage} failed closed.`));
        return;
      }
      resolve({
        stage,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });

const parseJsonResult = (result, label) => {
  try {
    const text = result.stdout.toString('utf8').trim();
    return text ? JSON.parse(text) : {};
  } catch {
    refuse('E_COMMAND_JSON', `${label} did not return valid JSON.`);
  }
};

export function parseListeningPorts(output) {
  const ports = new Set();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;
    const local = fields[3];
    const match = local.match(/:(\d+)$/);
    if (match) ports.add(Number(match[1]));
  }
  return [...ports].sort((left, right) => left - right);
}

const writeExclusive = async (target, value) => {
  let handle;
  try {
    handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      refuse('E_ALREADY_ATTEMPTED', 'Private-route activation was already attempted.');
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
};

const verifyProofBindings = async (authorization) => {
  const source = await readSecureJson(
    authorization.proofBindings.sourceQuiesceReceiptPath,
    'Source quiesce receipt',
  );
  if (!safeHashEqual(sha256(source.bytes), authorization.sourceQuiesceReceiptSha256)) {
    refuse('E_PROOF_HASH', 'Source quiesce receipt hash is invalid.');
  }
  const evidence = await readSecureJson(
    authorization.proofBindings.activationEvidencePath,
    'Activation evidence',
  );
  if (!safeHashEqual(sha256(evidence.bytes), authorization.activationEvidenceSha256)) {
    refuse('E_PROOF_HASH', 'Activation evidence hash is invalid.');
  }
  const binding = await readSecureJson(
    authorization.proofBindings.checkpointBindingPath,
    'Checkpoint binding',
  );
  if (!safeHashEqual(sha256(binding.bytes), authorization.checkpointBindingSha256)) {
    refuse('E_PROOF_HASH', 'Checkpoint binding receipt hash is invalid.');
  }
  if (
    source.value?.status !== 'quiesced-verified' ||
    source.value?.cutoverId !== authorization.cutoverId ||
    evidence.value?.status !== 'all-gates-passed' ||
    evidence.value?.cutoverId !== authorization.cutoverId ||
    evidence.value?.guest?.deployment?.vmName !== authorization.deployment.vmName ||
    evidence.value?.guest?.deployment?.deploymentId !== authorization.deployment.deploymentId ||
    evidence.value?.guest?.deployment?.releaseCommit !== authorization.deployment.releaseCommit ||
    evidence.value?.guest?.deployment?.planSha256 !== authorization.deployment.deploymentPlanSha256 ||
    evidence.value?.guest?.deployment?.checkpointManifestSha256 !== authorization.deployment.checkpointManifestSha256 ||
    evidence.value?.collectedAt !== authorization.activationEvidenceCollectedAt ||
    evidence.value?.sourceQuiesce?.receiptSha256 !==
      authorization.sourceQuiesceReceiptSha256 ||
    evidence.value?.sourceQuiesce?.stillQuiesced !== true ||
    evidence.value?.checkpoint?.bindingReceiptSha256 !==
      authorization.checkpointBindingSha256 ||
    binding.value?.status !== 'bound-verified' ||
    binding.value?.cutoverId !== authorization.cutoverId ||
    binding.value?.sourceQuiesceReceiptSha256 !==
      authorization.sourceQuiesceReceiptSha256 ||
    binding.value?.sourceStillQuiesced !== true
  ) refuse('E_PROOF_BINDING', 'Cutover proof documents are not mutually bound.');
  return {
    sourceQuiesceReceiptSha256: sha256(source.bytes),
    activationEvidenceSha256: sha256(evidence.bytes),
    checkpointBindingSha256: sha256(binding.bytes),
    releaseManifestSha256: evidence.value.collector.releaseManifestSha256,
  };
};

async function activate() {
  ensureRoot();
  const authorizationDocument = await readSecureJson(
    AUTHORIZATION_PATH,
    'Activation authorization',
  );
  const authorization = validateActivationAuthorization(
    authorizationDocument.value,
    new Date(),
  );
  const bindings = await verifyProofBindings(authorization);
  const executor = await assertImmutableReleaseExecutor(
    authorization,
    bindings.releaseManifestSha256,
  );
  await assertSecureFile(DEPLOYMENT_PLAN);
  if (await lstat(ACTIVATION_RECEIPT).catch(() => null)) {
    refuse('E_ALREADY_ACTIVATED', 'Private-route activation receipt already exists.');
  }
  const authorizationSha256 = sha256(authorizationDocument.bytes);
  const decisionClaim = await claimCutoverDecision(buildCutoverDecisionClaim({
    decision: 'activate',
    cutoverId: authorization.cutoverId,
    deploymentId: authorization.deployment.deploymentId,
    releaseCommit: authorization.deployment.releaseCommit,
    authoritySha256: authorizationSha256,
  }));
  const lock = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-private-route-activation-lock',
    status: 'claimed-once',
    claimedAt: new Date().toISOString(),
    cutoverId: authorization.cutoverId,
    authorizationSha256,
    decisionClaimPath: CUTOVER_DECISION_PATH,
    decisionClaimSha256: decisionClaim.sha256,
    decision: decisionClaim.document.decision,
  };
  await writeExclusive(ACTIVATION_LOCK, lock);

  const commands = planActivationCommands(authorization.deployment.releaseCommit);
  const results = {};
  const activationIndex = commands.findIndex(({ stage }) => stage === 'activate-private-route');
  if (activationIndex < 1) refuse('E_COMMAND_PLAN', 'Private-route activation command is missing.');
  for (const planned of commands.slice(0, activationIndex)) {
    results[planned.stage] = await run(planned);
  }
  revalidateActivationFreshnessBeforeServe(authorization, new Date());
  const tailscaleVersion = validateTailscaleVersion(
    results['tailscale-version'].stdout.toString('utf8'),
  );
  const before = validatePreActivationNetwork({
    tailscaleStatus: parseJsonResult(results['tailscale-status-before'], 'Tailscale status'),
    serveStatus: parseJsonResult(results['tailscale-serve-before'], 'Tailscale Serve status'),
    funnelStatus: parseJsonResult(results['tailscale-funnel-before'], 'Tailscale Funnel status'),
    listeningPorts: parseListeningPorts(results['listeners-before'].stdout.toString('utf8')),
  });
  revalidateActivationFreshnessBeforeServe(authorization, new Date());
  results['activate-private-route'] = await run(commands[activationIndex]);
  for (const planned of commands.slice(activationIndex + 1)) {
    results[planned.stage] = await run(planned);
  }
  const after = validatePostActivationNetwork({
    tailscaleStatus: parseJsonResult(results['tailscale-status-after'], 'Tailscale status'),
    serveStatus: parseJsonResult(results['tailscale-serve-after'], 'Tailscale Serve status'),
    funnelStatus: parseJsonResult(results['tailscale-funnel-after'], 'Tailscale Funnel status'),
    listeningPorts: parseListeningPorts(results['listeners-after'].stdout.toString('utf8')),
  });
  const receipt = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-private-route-activation-receipt',
    status: 'tailnet-only-active',
    cutoverId: authorization.cutoverId,
    activatedAt: new Date().toISOString(),
    authorizationSha256,
    decisionClaim: {
      path: CUTOVER_DECISION_PATH,
      sha256: decisionClaim.sha256,
      decision: decisionClaim.document.decision,
    },
    executor,
    bindings,
    route: authorization.route,
    preActivation: before,
    postActivation: after,
    tailscaleProof: {
      version: tailscaleVersion,
      versionOutputSha256: sha256(results['tailscale-version'].stdout),
      serveBeforeSha256: sha256(results['tailscale-serve-before'].stdout),
      funnelBeforeSha256: sha256(results['tailscale-funnel-before'].stdout),
      serveAfterSha256: sha256(results['tailscale-serve-after'].stdout),
      funnelAfterSha256: sha256(results['tailscale-funnel-after'].stdout),
      serveAbsentBefore: before.serveAbsent,
      funnelAbsentBefore: before.funnelAbsent,
      funnelAbsentAfter: after.funnelAbsent,
      tailnetOnlyAfter: after.tailnetOnly,
    },
    deploymentPreflightSha256: createHash('sha256')
      .update(results['deployment-preflight'].stdout)
      .digest('hex'),
    deploymentPostcheckSha256: createHash('sha256')
      .update(results['deployment-postcheck'].stdout)
      .digest('hex'),
    maximumActivations: 1,
    publicExposureCreated: false,
    resourcesDeleted: false,
  };
  await writeExclusive(ACTIVATION_RECEIPT, receipt);
  return receipt;
}

const usage =
  'Usage: linux-private-route-activate.mjs --activate --authorization /etc/easyfire-bookkeeping/cutover-authorization.json\n';

async function runCli() {
  if (
    process.argv.length !== 5 ||
    process.argv[2] !== '--activate' ||
    process.argv[3] !== '--authorization' ||
    process.argv[4] !== AUTHORIZATION_PATH
  ) refuse('E_USAGE', usage.trim());
  const result = await activate();
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    cutoverId: result.cutoverId,
    receipt: ACTIVATION_RECEIPT,
  })}\n`);
}

if (await isCanonicalMainModule(import.meta.url)) {
  runCli().catch((error) => {
    const refusal = error instanceof CutoverRefusal
      ? error
      : new CutoverRefusal('E_INTERNAL', 'Unexpected private-route activation failure.');
    process.stderr.write(`${refusal.code}: ${refusal.message}\n`);
    process.exitCode = 1;
  });
}
