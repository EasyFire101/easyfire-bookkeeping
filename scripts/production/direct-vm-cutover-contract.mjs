#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateCheckpointV2Document } from './direct-vm-checkpoint-v2-contract.mjs';
import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
export const PROJECT = 'easyfire-bookkeeping';
export const SOURCE_HOST = 'NEWSEC';
export const SOURCE_COMPOSE_PROJECT = 'easyfire-bookkeeping-prod';
export const TARGET_VM = 'easyfire-bookkeeping-newsec';
export const TAILSCALE_DNS_NAME = 'easyfire-bookkeeping-newsec.taild63e9b.ts.net';
export const TAILSCALE_ORIGIN = 'http://127.0.0.1:8080';
export const WINDOWS_AUTHORITY_ROOT = 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\direct-vm-cutover';
export const WINDOWS_RELEASE_ROOT = 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\releases';
export const PRIVATE_SOURCE_LAUNCHER = 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\incoming\\launch-private-proxy-v2-0b7d1af8.ps1';
export const PRIVATE_SOURCE_LAUNCHER_SHA256 = 'f90e275d1b941d554a15a0e8e5c2f6af7b6412033fcfa45d7e85939351a44130';
export const PRIVATE_SOURCE_LAUNCHER_CHILD_SHA256 = '1adac5341abea3e496cf9c015b68562781d34bb985fb64d8317f6832ad1bd0b9';
const CONTAINER_SPECS = Object.freeze([
  ['mysql', 'data', 'easyfire-mysql'],
  ['redis', 'data', 'easyfire-redis'],
  ['gotenberg', 'stateless', 'easyfire-gotenberg'],
  ['proxy', 'stateless', 'easyfire-proxy'],
  ['webapp', 'stateless', 'easyfire-webapp'],
  ['server', 'stateless', 'easyfire-owner-onboarding-ca845969f4b2'],
  ['onboarding-web', 'stateless', 'easyfire-owner-onboarding-web-0b7d1af8'],
  ['onboarding-gateway', 'stateless', 'easyfire-owner-onboarding-gateway-v2-0b7d1af8'],
]);
export const SOURCE_CONTAINER_NAMES = Object.freeze(CONTAINER_SPECS.map(([, , name]) => name));
export const LEGACY_TASK_NAMES = Object.freeze(['easyfire-bookkeeping-prod-backup', 'easyfire-bookkeeping-prod-startup']);
export const STATELESS_CONTAINER_NAMES = Object.freeze(CONTAINER_SPECS.filter(([, tier]) => tier === 'stateless').map(([, , name]) => name));
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID = /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/;
const WINDOWS_RELEASE_EXECUTORS = Object.freeze({
  contractPath: 'direct-vm-cutover-contract.mjs', sourceControllerPath: 'direct-vm-cutover-authority.ps1',
  checkpointControllerPath: 'direct-vm-preflight-checkpoint.ps1', checkpointV2ContractPath: 'direct-vm-checkpoint-v2-contract.mjs',
  finalQuiescenceContractPath: 'linux-final-quiescence-contract.mjs', activationEvidenceCollectorPath: 'linux-activation-evidence-collect.mjs',
  guardianPromotionPath: 'linux-guardian-promote-active.mjs', abortContractPath: 'direct-vm-source-abort-contract.mjs',
});
const SENSITIVE_KEY = /(?:password|secret|token|credential)/i;
export class CutoverRefusal extends Error {
  constructor(code, message) { super(message); this.name = 'CutoverRefusal'; this.code = code; }
}
const refuse = (code, message) => { throw new CutoverRefusal(code, message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value, label) => {
  if (!isObject(value)) refuse('E_SHAPE', `${label} must be an object.`);
  return value;
};
const exactKeys = (value, keys, label) => {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) refuse('E_KEYS', `${label} has missing or unexpected fields.`);
};
const string = (value, label, pattern) => {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) refuse('E_VALUE', `${label} is invalid.`);
  return value;
};
const integer = (value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) refuse('E_VALUE', `${label} is invalid.`);
  return value;
};
const bool = (value, label) => typeof value === 'boolean' ? value : refuse('E_VALUE', `${label} is invalid.`);
const date = (value, label) => {
  string(value, label);
  if (Number.isNaN(Date.parse(value))) refuse('E_TIME', `${label} is invalid.`);
  return value;
};
const sha = (value, label) => string(value, label, SHA256);
const imageId = (value, label) => string(value, label, IMAGE_ID);
const rejectSensitiveKeys = (value, trail = 'document') => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveKeys(entry, `${trail}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) refuse('E_SECRET_FIELD', `${trail} contains a forbidden secret-bearing field.`);
    rejectSensitiveKeys(child, `${trail}.${key}`);
  }
};
const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
};
export const canonicalJson = (value) => JSON.stringify(sortObject(value));
export const sha256 = (value) => createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
const same = (left, right, label, code = 'E_IDENTITY') => {
  if (canonicalJson(left) !== canonicalJson(right)) refuse(code, `${label} does not match the bound identity.`);
};
const validateDocker = (candidate) => {
  exactKeys(candidate, ['id', 'name', 'serverVersion', 'osType', 'architecture', 'dockerRootDir'], 'Source Docker identity');
  sha(candidate.id, 'Source Docker id');
  for (const field of ['name', 'serverVersion', 'osType', 'architecture', 'dockerRootDir']) string(candidate[field], `Source Docker ${field}`);
  if (candidate.osType !== 'linux') refuse('E_DOCKER', 'The source must remain the pinned Linux-container Docker engine.');
};
const validateMount = (mount, label) => {
  exactKeys(mount, ['type', 'source', 'destination', 'readOnly'], label);
  if (!['volume', 'bind'].includes(mount.type)) refuse('E_MOUNT', `${label} type is invalid.`);
  string(mount.source, `${label} source`);
  string(mount.destination, `${label} destination`);
  bool(mount.readOnly, `${label} readOnly`);
};
const validatePort = (port, label) => {
  exactKeys(port, ['containerPort', 'hostIp', 'hostPort', 'protocol'], label);
  integer(port.containerPort, `${label} containerPort`, { minimum: 1, maximum: 65535 });
  string(port.hostIp, `${label} hostIp`);
  integer(port.hostPort, `${label} hostPort`, { minimum: 1, maximum: 65535 });
  if (!['tcp', 'udp'].includes(port.protocol)) refuse('E_PORT', `${label} protocol is invalid.`);
};
const validateContainer = (candidate, index) => {
  const label = `Source container ${index}`;
  exactKeys(candidate, [
    'role', 'tier', 'name', 'id', 'imageId', 'imageReference', 'composeProject', 'composeService',
    'restartPolicy', 'maximumRetryCount', 'running', 'state', 'health', 'mounts', 'networks', 'publishedPorts',
  ], label);
  const [role, tier, name] = CONTAINER_SPECS[index] ?? [];
  if (
    candidate.role !== role ||
    candidate.tier !== tier ||
    candidate.name !== name ||
    candidate.composeProject !== SOURCE_COMPOSE_PROJECT
  ) {
    refuse('E_CONTAINER_ALLOWLIST', `${label} is not the exact source allowlist entry.`);
  }
  string(candidate.id, `${label} id`, SHA256);
  imageId(candidate.imageId, `${label} imageId`);
  string(candidate.imageReference, `${label} imageReference`);
  string(candidate.composeService, `${label} composeService`);
  string(candidate.restartPolicy, `${label} restartPolicy`);
  integer(candidate.maximumRetryCount, `${label} maximumRetryCount`);
  bool(candidate.running, `${label} running`);
  string(candidate.state, `${label} state`);
  string(candidate.health, `${label} health`);
  if (!Array.isArray(candidate.mounts) || !Array.isArray(candidate.networks) || !Array.isArray(candidate.publishedPorts)) {
    refuse('E_CONTAINER_SHAPE', `${label} runtime attachments are invalid.`);
  }
  candidate.mounts.forEach((mount, mountIndex) => validateMount(mount, `${label} mount ${mountIndex}`));
  candidate.networks.forEach((network) => string(network, `${label} network`));
  candidate.publishedPorts.forEach((port, portIndex) => validatePort(port, `${label} port ${portIndex}`));
};
const validateVolume = (candidate, index) => {
  const expected = index === 0
    ? ['mysql', 'easyfire_prod_mysql', 'mysql']
    : ['redis', 'easyfire_prod_redis', 'redis'];
  exactKeys(candidate, [
    'role',
    'name',
    'driver',
    'scope',
    'composeProject',
    'composeVolume',
    'consumers',
  ], `Source volume ${index}`);
  if (
    candidate.role !== expected[0] ||
    candidate.name !== expected[1] ||
    candidate.composeProject !== SOURCE_COMPOSE_PROJECT ||
    candidate.composeVolume !== expected[2] ||
    candidate.driver !== 'local' ||
    candidate.scope !== 'local' ||
    !Array.isArray(candidate.consumers) ||
    candidate.consumers.length !== 1
  ) refuse('E_VOLUME_AUTHORITY', `Source volume ${index} identity is invalid.`);
  string(candidate.consumers[0], `Source volume ${index} consumer`, SHA256);
};
const validateTask = (candidate, index) => {
  exactKeys(candidate, [
    'name',
    'taskPath',
    'enabled',
    'state',
    'xmlSha256',
    'executable',
    'argumentsSha256',
    'workingDirectory',
    'principalUserId',
    'logonType',
    'runLevel',
  ], `Legacy task ${index}`);
  if (candidate.name !== LEGACY_TASK_NAMES[index] || candidate.taskPath !== '\\') {
    refuse('E_TASK_ALLOWLIST', `Legacy task ${index} is not allowlisted.`);
  }
  bool(candidate.enabled, `Legacy task ${index} enabled`);
  for (const field of [
    'state',
    'executable',
    'workingDirectory',
    'principalUserId',
    'logonType',
    'runLevel',
  ]) string(candidate[field], `Legacy task ${index} ${field}`);
  sha(candidate.xmlSha256, `Legacy task ${index} XML hash`);
  sha(candidate.argumentsSha256, `Legacy task ${index} arguments hash`);
};
const validateTunnel = (candidate) => {
  exactKeys(candidate, [
    'serviceName',
    'state',
    'startMode',
    'processId',
    'executablePath',
    'executableSha256',
    'commandLineSha256',
    'processPresent',
  ], 'Source tunnel');
  if (candidate.serviceName !== 'EasyFireBookkeepingCloudflared') {
    refuse('E_TUNNEL_ALLOWLIST', 'The source tunnel service is not allowlisted.');
  }
  string(candidate.state, 'Source tunnel state');
  string(candidate.startMode, 'Source tunnel start mode');
  integer(candidate.processId, 'Source tunnel processId');
  string(candidate.executablePath, 'Source tunnel executablePath');
  sha(candidate.executableSha256, 'Source tunnel executable hash');
  sha(candidate.commandLineSha256, 'Source tunnel command-line hash');
  bool(candidate.processPresent, 'Source tunnel processPresent');
};
const validatePrivateRoute = (candidate) => {
  exactKeys(candidate, [
    'kind',
    'processId',
    'executablePath',
    'executableSha256',
    'commandLineSha256',
    'listenerAddress',
    'listenerPort',
    'processPresent',
    'listenerPresent',
  ], 'Source private route');
  if (
    candidate.kind !== 'listener-process' ||
    candidate.listenerAddress !== '100.84.66.30' ||
    candidate.listenerPort !== 25186 ||
    !/\\(?:powershell|pwsh)\.exe$/i.test(candidate.executablePath)
  ) refuse('E_ROUTE_ALLOWLIST', 'The source private route is not the exact allowlisted listener.');
  integer(candidate.processId, 'Source private route processId');
  sha(candidate.executableSha256, 'Source private route executable hash');
  sha(candidate.commandLineSha256, 'Source private route command-line hash');
  bool(candidate.processPresent, 'Source private route processPresent');
  bool(candidate.listenerPresent, 'Source private route listenerPresent');
};
const validateEndpoint = (candidate) => {
  exactKeys(candidate, ['uri', 'reachable', 'listenerProcessId'], 'Source endpoint');
  if (candidate.uri !== 'http://100.84.66.30:25186/') {
    refuse('E_ENDPOINT', 'Source endpoint is not the exact private Windows address.');
  }
  bool(candidate.reachable, 'Source endpoint reachable');
  integer(candidate.listenerProcessId, 'Source endpoint listenerProcessId');
};
const validateSnapshotShape = (candidate) => {
  exactKeys(candidate, [
    'schemaVersion',
    'project',
    'kind',
    'phase',
    'capturedAt',
    'host',
    'docker',
    'containers',
    'volumes',
    'scheduledTasks',
    'tunnel',
    'privateRoute',
    'endpoint',
    'writerProof',
  ], 'Source snapshot');
  if (
    candidate.schemaVersion !== 1 ||
    candidate.project !== PROJECT ||
    candidate.kind !== 'easyfire-bookkeeping-source-snapshot' ||
    candidate.host !== SOURCE_HOST
  ) refuse('E_SNAPSHOT', 'Source snapshot identity is invalid.');
  date(candidate.capturedAt, 'Source snapshot capturedAt');
  validateDocker(object(candidate.docker, 'Source Docker identity'));
  if (!Array.isArray(candidate.containers) || candidate.containers.length !== CONTAINER_SPECS.length) {
    refuse('E_CONTAINER_ALLOWLIST', 'Source snapshot must contain exactly eight allowlisted containers.');
  }
  candidate.containers.forEach(validateContainer);
  if (new Set(candidate.containers.map(({ id }) => id)).size !== candidate.containers.length) {
    refuse('E_CONTAINER_IDENTITY', 'Source container IDs must be unique.');
  }
  if (!Array.isArray(candidate.volumes) || candidate.volumes.length !== 2) {
    refuse('E_VOLUME_AUTHORITY', 'Source snapshot must contain exactly two durable volumes.');
  }
  candidate.volumes.forEach(validateVolume);
  if (!Array.isArray(candidate.scheduledTasks) || candidate.scheduledTasks.length !== 2) {
    refuse('E_TASK_ALLOWLIST', 'Source snapshot must contain exactly the two legacy tasks.');
  }
  candidate.scheduledTasks.forEach(validateTask);
  validateTunnel(object(candidate.tunnel, 'Source tunnel'));
  validatePrivateRoute(object(candidate.privateRoute, 'Source private route'));
  validateEndpoint(object(candidate.endpoint, 'Source endpoint'));
};
const validateInitialSnapshot = (snapshot) => {
  validateSnapshotShape(snapshot);
  if (
    snapshot.phase !== 'pre-quiesce' ||
    snapshot.writerProof !== null ||
    snapshot.endpoint.reachable !== true ||
    snapshot.endpoint.listenerProcessId !== snapshot.privateRoute.processId ||
    snapshot.privateRoute.processPresent !== true ||
    snapshot.privateRoute.listenerPresent !== true ||
    snapshot.tunnel.state !== 'Running' ||
    snapshot.tunnel.startMode !== 'Auto' ||
    snapshot.tunnel.processPresent !== true ||
    snapshot.tunnel.processId < 1 ||
    snapshot.scheduledTasks.some((task) => task.enabled !== true || task.state === 'Running') ||
    snapshot.containers.some(
      (container) =>
        container.running !== true ||
        container.state !== 'running' ||
        (container.tier === 'data' && container.health !== 'healthy') ||
        !['healthy', 'none'].includes(container.health),
    )
  ) refuse('E_INITIAL_STATE', 'Source initial state is not safe to quiesce.');
  const byRole = new Map(snapshot.containers.map((entry) => [entry.role, entry]));
  if (
    snapshot.volumes[0].consumers[0] !== byRole.get('mysql').id ||
    snapshot.volumes[1].consumers[0] !== byRole.get('redis').id
  ) refuse('E_VOLUME_CONSUMER', 'A durable source volume has an ambiguous consumer.');
};
export function validateCutoverPlan(candidate) {
  rejectSensitiveKeys(candidate);
  const plan = object(candidate, 'Cutover plan');
  exactKeys(plan, [
    'schemaVersion',
    'project',
    'kind',
    'cutoverId',
    'createdAt',
    'source',
    'controller',
    'evidence',
    'target',
  ], 'Cutover plan');
  if (
    plan.schemaVersion !== 1 ||
    plan.project !== PROJECT ||
    plan.kind !== 'easyfire-bookkeeping-direct-vm-cutover-plan'
  ) refuse('E_PLAN_IDENTITY', 'Cutover plan identity is invalid.');
  string(plan.cutoverId, 'Cutover id', UUID);
  date(plan.createdAt, 'Cutover plan createdAt');
  exactKeys(plan.source, [
    'host',
    'composeProject',
    'expectedInitialSnapshot',
    'mysqlContainerId',
    'redisContainerId',
    'mysqlVolume',
    'redisVolume',
  ], 'Cutover source');
  if (
    plan.source.host !== SOURCE_HOST ||
    plan.source.composeProject !== SOURCE_COMPOSE_PROJECT ||
    plan.source.mysqlVolume !== 'easyfire_prod_mysql' ||
    plan.source.redisVolume !== 'easyfire_prod_redis'
  ) refuse('E_SOURCE_AUTHORITY', 'Cutover source authority is invalid.');
  validateInitialSnapshot(plan.source.expectedInitialSnapshot);
  if (
    plan.source.mysqlContainerId !== plan.source.expectedInitialSnapshot.containers[0].id ||
    plan.source.redisContainerId !== plan.source.expectedInitialSnapshot.containers[1].id
  ) refuse('E_SOURCE_AUTHORITY', 'Cutover data-container authority is invalid.');
  exactKeys(plan.controller, [
    'releaseCommit',
    'releaseManifestPath',
    'releaseManifestSha256',
    'nodePath',
    'nodeSha256',
    'contractPath',
    'contractSha256',
    'sourceControllerPath',
    'sourceControllerSha256',
    'checkpointControllerPath',
    'checkpointControllerSha256',
    'checkpointV2ContractPath',
    'checkpointV2ContractSha256',
    'finalQuiescenceContractPath',
    'finalQuiescenceContractSha256',
    'activationEvidenceCollectorPath',
    'activationEvidenceCollectorSha256',
    'guardianPromotionPath',
    'guardianPromotionSha256',
    'abortContractPath',
    'abortContractSha256',
    'privateLauncherPath',
    'privateLauncherSha256',
    'privateLauncherChildSha256',
  ], 'Cutover controller');
  string(plan.controller.releaseCommit, 'Cutover controller releaseCommit', COMMIT);
  for (const field of [
    'releaseManifestPath',
    'nodePath',
    'contractPath',
    'sourceControllerPath',
    'checkpointControllerPath',
    'checkpointV2ContractPath',
    'finalQuiescenceContractPath',
    'activationEvidenceCollectorPath',
    'guardianPromotionPath',
    'abortContractPath',
    'privateLauncherPath',
  ]) string(plan.controller[field], `Cutover controller ${field}`, /^[A-Za-z]:\\/);
  for (const field of [
    'releaseManifestSha256',
    'nodeSha256',
    'contractSha256',
    'sourceControllerSha256',
    'checkpointControllerSha256',
    'checkpointV2ContractSha256',
    'finalQuiescenceContractSha256',
    'activationEvidenceCollectorSha256',
    'guardianPromotionSha256',
    'abortContractSha256',
    'privateLauncherSha256',
    'privateLauncherChildSha256',
  ]) sha(plan.controller[field], `Cutover controller ${field}`);
  const releaseRoot = `${WINDOWS_RELEASE_ROOT}\\${plan.controller.releaseCommit}`;
  if (plan.controller.releaseManifestPath !== `${releaseRoot}\\release-manifest.json`) {
    refuse('E_RELEASE_PATH', 'Windows release manifest is not at its immutable release path.');
  }
  const productionRoot = `${releaseRoot}\\scripts\\production`;
  for (const [field, fileName] of Object.entries(WINDOWS_RELEASE_EXECUTORS)) {
    if (plan.controller[field] !== `${productionRoot}\\${fileName}`) {
      refuse('E_RELEASE_PATH', `Cutover controller ${field} is not release-bound.`);
    }
  }
  if (
    plan.controller.privateLauncherPath !== PRIVATE_SOURCE_LAUNCHER ||
    plan.controller.privateLauncherSha256 !== PRIVATE_SOURCE_LAUNCHER_SHA256 ||
    plan.controller.privateLauncherChildSha256 !==
      PRIVATE_SOURCE_LAUNCHER_CHILD_SHA256
  ) refuse('E_PRIVATE_LAUNCHER', 'Private source launcher authority is invalid.');
  exactKeys(plan.evidence, [
    'root',
    'authorityOwnerSid',
    'sourceQuiesceReceiptGuestPath',
    'checkpointBindingGuestPath',
    'activationEvidenceGuestPath',
    'activationAuthorizationGuestPath',
  ], 'Cutover evidence');
  if (plan.evidence.root !== WINDOWS_AUTHORITY_ROOT) {
    refuse('E_EVIDENCE_PATH', 'Cutover evidence root is not the fixed protected path.');
  }
  string(
    plan.evidence.authorityOwnerSid,
    'Cutover evidence authority owner SID',
    /^S-1-5-21-(?:[0-9]+-){2,14}[0-9]+$/,
  );
  const guestPaths = {
    sourceQuiesceReceiptGuestPath:
      '/etc/easyfire-bookkeeping/source-quiesce-receipt.json',
    checkpointBindingGuestPath:
      '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json',
    activationEvidenceGuestPath:
      '/etc/easyfire-bookkeeping/cutover-evidence.json',
    activationAuthorizationGuestPath:
      '/etc/easyfire-bookkeeping/cutover-authorization.json',
  };
  for (const [field, expected] of Object.entries(guestPaths)) {
    if (plan.evidence[field] !== expected) {
      refuse('E_EVIDENCE_PATH', `Cutover evidence ${field} is invalid.`);
    }
  }
  exactKeys(plan.target, [
    'vmName',
    'tailscaleDnsName',
    'tailscaleOrigin',
    'authorizationMaxAgeSeconds',
  ], 'Cutover target');
  if (
    plan.target.vmName !== TARGET_VM ||
    plan.target.tailscaleDnsName !== TAILSCALE_DNS_NAME ||
    plan.target.tailscaleOrigin !== TAILSCALE_ORIGIN ||
    plan.target.authorizationMaxAgeSeconds !== 900
  ) refuse('E_TARGET_AUTHORITY', 'Cutover target authority is invalid.');
  return plan;
}
const immutableContainer = ({ restartPolicy, running, state, health, ...rest }) => rest;
const immutableTask = ({ enabled, state, ...rest }) => rest;
const immutableTunnel = ({ state, startMode, processId, processPresent, ...rest }) => rest;
const immutableRoute = ({ processId, processPresent, listenerPresent, ...rest }) => rest;
export function validateSourceSnapshot(candidate, planCandidate, phase) {
  const plan = validateCutoverPlan(planCandidate);
  const snapshot = object(candidate, 'Source snapshot');
  validateSnapshotShape(snapshot);
  if (snapshot.phase !== phase) refuse('E_SNAPSHOT_PHASE', 'Source snapshot phase is invalid.');
  const initial = plan.source.expectedInitialSnapshot;
  if (phase === 'pre-quiesce') {
    same(
      { ...snapshot, capturedAt: initial.capturedAt },
      initial,
      'Pre-quiesce snapshot',
    );
    return snapshot;
  }
  if (phase !== 'post-quiesce') refuse('E_SNAPSHOT_PHASE', 'Unknown source snapshot phase.');
  same(snapshot.docker, initial.docker, 'Source Docker identity');
  same(snapshot.volumes, initial.volumes, 'Source volume identity');
  for (let index = 0; index < initial.containers.length; index += 1) {
    const before = initial.containers[index];
    const after = snapshot.containers[index];
    same(immutableContainer(after), immutableContainer(before), `Container ${before.name} identity`);
    if (before.tier === 'data') {
      if (
        after.restartPolicy !== before.restartPolicy ||
        after.running !== true ||
        after.state !== 'running' ||
        after.health !== 'healthy'
      ) refuse('E_DATA_STATE', `Source data container ${before.name} is not healthy and preserved.`);
    } else if (
      after.restartPolicy !== 'no' ||
      after.running !== false ||
      after.state !== 'exited' ||
      after.health !== 'none'
    ) refuse('E_WRITER_STATE', `Source writer container ${before.name} is not stopped with restart=no.`);
  }
  for (let index = 0; index < initial.scheduledTasks.length; index += 1) {
    const before = initial.scheduledTasks[index];
    const after = snapshot.scheduledTasks[index];
    same(immutableTask(after), immutableTask(before), `Legacy task ${before.name} identity`);
    if (after.enabled !== false || after.state !== 'Disabled') {
      refuse('E_TASK_STATE', `Legacy task ${before.name} is not disabled.`);
    }
  }
  same(immutableTunnel(snapshot.tunnel), immutableTunnel(initial.tunnel), 'Source tunnel identity');
  if (
    snapshot.tunnel.state !== 'Stopped' ||
    snapshot.tunnel.startMode !== 'Disabled' ||
    snapshot.tunnel.processId !== 0 ||
    snapshot.tunnel.processPresent !== false
  ) refuse('E_TUNNEL_STATE', 'Source tunnel is not stopped and disabled.');
  same(immutableRoute(snapshot.privateRoute), immutableRoute(initial.privateRoute), 'Source private-route identity');
  if (
    snapshot.privateRoute.processId !== initial.privateRoute.processId ||
    snapshot.privateRoute.processPresent !== false ||
    snapshot.privateRoute.listenerPresent !== false
  ) refuse('E_ROUTE_STATE', 'Source private route is not stopped.');
  if (
    snapshot.endpoint.uri !== initial.endpoint.uri ||
    snapshot.endpoint.reachable !== false ||
    snapshot.endpoint.listenerProcessId !== 0
  ) refuse('E_ENDPOINT_STATE', 'Old application endpoint remains reachable.');
  exactKeys(snapshot.writerProof, [
    'applicationContainersRunning',
    'mysqlNonSystemConnections',
    'mysqlEventScheduler',
    'mysqlEnabledEvents',
    'redisExternalClients',
  ], 'Writer proof');
  for (const field of [
    'applicationContainersRunning',
    'mysqlNonSystemConnections',
    'mysqlEnabledEvents',
    'redisExternalClients',
  ]) {
    if (snapshot.writerProof[field] !== 0) {
      refuse('E_WRITER_PROOF', `Writer proof ${field} is not zero.`);
    }
  }
  if (snapshot.writerProof.mysqlEventScheduler !== 'OFF') {
    refuse('E_WRITER_PROOF', 'Writer proof does not show the MariaDB event scheduler disabled.');
  }
  return snapshot;
}
export function planSourceQuiesceActions(planCandidate) {
  const plan = validateCutoverPlan(planCandidate);
  const snapshot = plan.source.expectedInitialSnapshot;
  const stateless = snapshot.containers.filter(({ tier }) => tier === 'stateless');
  return [
    ...snapshot.scheduledTasks.map(({ name, taskPath, xmlSha256 }) => ({
      kind: 'disable-task',
      name,
      taskPath,
      xmlSha256,
    })),
    {
      kind: 'disable-service',
      name: snapshot.tunnel.serviceName,
      executableSha256: snapshot.tunnel.executableSha256,
      commandLineSha256: snapshot.tunnel.commandLineSha256,
    },
    {
      kind: 'stop-private-route',
      processId: snapshot.privateRoute.processId,
      executableSha256: snapshot.privateRoute.executableSha256,
      commandLineSha256: snapshot.privateRoute.commandLineSha256,
    },
    ...stateless.map(({ name, id }) => ({
      kind: 'docker-restart-no',
      name,
      containerId: id,
    })),
    ...stateless.map(({ name, id }) => ({
      kind: 'docker-stop',
      name,
      containerId: id,
      timeoutSeconds: 30,
    })),
  ];
}
const receiptContent = (receipt) => {
  const { contentSha256, ...content } = receipt;
  return content;
};
export function buildSourceQuiesceReceipt({
  plan: planCandidate,
  planSha256,
  before,
  beforeSha256,
  after,
  afterSha256,
  completedAt,
}) {
  const plan = validateCutoverPlan(planCandidate);
  validateSourceSnapshot(before, plan, 'pre-quiesce');
  validateSourceSnapshot(after, plan, 'post-quiesce');
  sha(planSha256, 'Cutover plan hash');
  sha(beforeSha256, 'Before snapshot hash');
  sha(afterSha256, 'After snapshot hash');
  date(completedAt, 'Quiesce completion time');
  const receipt = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-source-quiesce-receipt',
    status: 'quiesced-verified',
    cutoverId: plan.cutoverId,
    completedAt,
    planSha256,
    beforeSnapshotSha256: beforeSha256,
    afterSnapshotSha256: afterSha256,
    source: {
      host: SOURCE_HOST,
      composeProject: SOURCE_COMPOSE_PROJECT,
      dataContainers: [plan.source.mysqlContainerId, plan.source.redisContainerId],
      dataVolumes: [plan.source.mysqlVolume, plan.source.redisVolume],
      containers: after.containers.map(({ role, name, id, imageId, running, restartPolicy }) => ({
        role,
        name,
        id,
        imageId,
        running,
        restartPolicy,
      })),
      originalStates: {
        containers: before.containers.map(({ role, name, id, restartPolicy, running, state }) => ({
          role,
          name,
          id,
          restartPolicy,
          running,
          state,
        })),
        scheduledTasks: before.scheduledTasks.map(({ name, xmlSha256, enabled, state }) => ({
          name,
          xmlSha256,
          enabled,
          state,
        })),
        tunnel: before.tunnel,
        privateRoute: before.privateRoute,
      },
    },
    proof: {
      dataHealthy: true,
      statelessWritersStopped: true,
      statelessRestartPolicy: 'no',
      legacyTasksDisabled: true,
      tunnelStoppedAndDisabled: true,
      privateRouteStopped: true,
      oldEndpointUnreachable: true,
      writerConnectionsAbsent: true,
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
  return { ...receipt, contentSha256: sha256(canonicalJson(receipt)) };
}
export function validateSourceQuiesceReceipt(candidate, planCandidate, expectedPlanSha256) {
  const plan = validateCutoverPlan(planCandidate);
  const receipt = object(candidate, 'Source quiesce receipt');
  exactKeys(receipt, [
    'schemaVersion',
    'project',
    'kind',
    'status',
    'cutoverId',
    'completedAt',
    'planSha256',
    'beforeSnapshotSha256',
    'afterSnapshotSha256',
    'source',
    'proof',
    'preservation',
    'contentSha256',
  ], 'Source quiesce receipt');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.project !== PROJECT ||
    receipt.kind !== 'easyfire-bookkeeping-source-quiesce-receipt' ||
    receipt.status !== 'quiesced-verified' ||
    receipt.cutoverId !== plan.cutoverId
  ) refuse('E_QUIESCE_RECEIPT', 'Source quiesce receipt identity is invalid.');
  date(receipt.completedAt, 'Source quiesce completion time');
  for (const field of [
    'planSha256',
    'beforeSnapshotSha256',
    'afterSnapshotSha256',
    'contentSha256',
  ]) sha(receipt[field], `Source quiesce ${field}`);
  if (expectedPlanSha256 !== undefined) {
    sha(expectedPlanSha256, 'Expected cutover plan hash');
    if (!safeHashEqual(receipt.planSha256, expectedPlanSha256)) {
      refuse('E_PLAN_BINDING', 'Source quiesce receipt is not bound to the cutover plan bytes.');
    }
  }
  const expectedContentHash = sha256(canonicalJson(receiptContent(receipt)));
  if (!safeHashEqual(receipt.contentSha256, expectedContentHash)) {
    refuse('E_SNAPSHOT_BINDING', 'Source quiesce receipt or snapshot binding changed.');
  }
  exactKeys(receipt.source, [
    'host',
    'composeProject',
    'dataContainers',
    'dataVolumes',
    'containers',
    'originalStates',
  ], 'Source quiesce receipt source');
  exactKeys(receipt.source.originalStates, [
    'containers', 'scheduledTasks', 'tunnel', 'privateRoute',
  ], 'Source quiesce original states');
  exactKeys(receipt.proof, [
    'dataHealthy',
    'statelessWritersStopped',
    'statelessRestartPolicy',
    'legacyTasksDisabled',
    'tunnelStoppedAndDisabled',
    'privateRouteStopped',
    'oldEndpointUnreachable',
    'writerConnectionsAbsent',
  ], 'Source quiesce proof');
  exactKeys(receipt.preservation, [
    'noResourcesDeleted',
    'dataContainersRunning',
    'volumesPreserved',
    'releasesPreserved',
    'backupsPreserved',
    'originalStatesRecorded',
  ], 'Source quiesce preservation');
  if (!Array.isArray(receipt.source.containers) || receipt.source.containers.length !== 8) {
    refuse('E_QUIESCE_RECEIPT', 'Source quiesce compact container inventory is invalid.');
  }
  receipt.source.containers.forEach((container, index) => {
    exactKeys(container, [
      'role', 'name', 'id', 'imageId', 'running', 'restartPolicy',
    ], `Source quiesce container ${index}`);
    const expected = plan.source.expectedInitialSnapshot.containers[index];
    if (
      container.role !== expected.role ||
      container.name !== expected.name ||
      container.id !== expected.id ||
      container.imageId !== expected.imageId ||
      container.running !== (expected.tier === 'data') ||
      container.restartPolicy !== (expected.tier === 'data' ? expected.restartPolicy : 'no')
    ) refuse('E_QUIESCE_RECEIPT', `Source quiesce container ${index} proof is invalid.`);
  });
  if (
    !Array.isArray(receipt.source.originalStates.containers) ||
    receipt.source.originalStates.containers.length !== 8 ||
    !Array.isArray(receipt.source.originalStates.scheduledTasks) ||
    receipt.source.originalStates.scheduledTasks.length !== 2
  ) refuse('E_QUIESCE_RECEIPT', 'Source quiesce original-state inventory is incomplete.');
  receipt.source.originalStates.containers.forEach((container, index) => {
    exactKeys(container, [
      'role', 'name', 'id', 'restartPolicy', 'running', 'state',
    ], `Source original container ${index}`);
    const expected = plan.source.expectedInitialSnapshot.containers[index];
    same(container, {
      role: expected.role,
      name: expected.name,
      id: expected.id,
      restartPolicy: expected.restartPolicy,
      running: expected.running,
      state: expected.state,
    }, `Source original container ${index}`, 'E_QUIESCE_RECEIPT');
  });
  receipt.source.originalStates.scheduledTasks.forEach((task, index) => {
    exactKeys(task, ['name', 'xmlSha256', 'enabled', 'state'], `Source original task ${index}`);
    const expected = plan.source.expectedInitialSnapshot.scheduledTasks[index];
    same(task, {
      name: expected.name,
      xmlSha256: expected.xmlSha256,
      enabled: expected.enabled,
      state: expected.state,
    }, `Source original task ${index}`, 'E_QUIESCE_RECEIPT');
  });
  same(
    receipt.source.originalStates.tunnel,
    plan.source.expectedInitialSnapshot.tunnel,
    'Source original tunnel',
    'E_QUIESCE_RECEIPT',
  );
  same(
    receipt.source.originalStates.privateRoute,
    plan.source.expectedInitialSnapshot.privateRoute,
    'Source original private route',
    'E_QUIESCE_RECEIPT',
  );
  if (
    receipt.source?.host !== SOURCE_HOST ||
    receipt.source?.composeProject !== SOURCE_COMPOSE_PROJECT ||
    canonicalJson(receipt.source?.dataContainers) !==
      canonicalJson([plan.source.mysqlContainerId, plan.source.redisContainerId]) ||
    canonicalJson(receipt.source?.dataVolumes) !==
      canonicalJson([plan.source.mysqlVolume, plan.source.redisVolume]) ||
    receipt.proof?.dataHealthy !== true ||
    receipt.proof?.statelessWritersStopped !== true ||
    receipt.proof?.statelessRestartPolicy !== 'no' ||
    receipt.proof?.legacyTasksDisabled !== true ||
    receipt.proof?.tunnelStoppedAndDisabled !== true ||
    receipt.proof?.privateRouteStopped !== true ||
    receipt.proof?.oldEndpointUnreachable !== true ||
    receipt.proof?.writerConnectionsAbsent !== true ||
    Object.values(receipt.preservation ?? {}).some((value) => value !== true)
  ) refuse('E_QUIESCE_RECEIPT', 'Source quiesce receipt proof is incomplete.');
  return receipt;
}
export function validateCheckpointV2(candidate, planCandidate, expectedFinalQuiescence) {
  const plan = validateCutoverPlan(planCandidate);
  return validateCheckpointV2Document(candidate, plan, expectedFinalQuiescence);
}
export function buildCheckpointBinding({
  plan: planCandidate,
  planSha256,
  sourceQuiesceReceipt,
  sourceQuiesceReceiptSha256,
  postQuiesceSnapshot,
  postQuiesceSnapshotSha256,
  checkpoint,
  checkpointSha256,
  boundAt,
}) {
  const plan = validateCutoverPlan(planCandidate);
  const receipt = validateSourceQuiesceReceipt(
    sourceQuiesceReceipt,
    plan,
    planSha256,
  );
  validateSourceSnapshot(postQuiesceSnapshot, plan, 'post-quiesce');
  const verifiedCheckpoint = validateCheckpointV2(checkpoint, plan, {
    planSha256,
    sourceQuiesceReceiptSha256,
    sourceQuiesceContentSha256: receipt.contentSha256,
    sourceQuiesceCompletedAt: receipt.completedAt,
    postQuiesceSnapshotSha256,
    postQuiesceCapturedAt: postQuiesceSnapshot.capturedAt,
    writerProof: postQuiesceSnapshot.writerProof,
  });
  for (const [value, label] of [
    [planSha256, 'Cutover plan hash'],
    [sourceQuiesceReceiptSha256, 'Source quiesce receipt hash'],
    [postQuiesceSnapshotSha256, 'Post-quiesce snapshot hash'],
    [checkpointSha256, 'Checkpoint-v2 hash'],
  ]) sha(value, label);
  if (!safeHashEqual(receipt.afterSnapshotSha256, postQuiesceSnapshotSha256)) {
    refuse('E_SNAPSHOT_BINDING', 'Final checkpoint snapshot is not the receipt-bound source snapshot.');
  }
  date(boundAt, 'Checkpoint binding time');
  if (Date.parse(verifiedCheckpoint.checkpointCreatedAt) < Date.parse(receipt.completedAt)) {
    refuse('E_CHECKPOINT_ORDER', 'Final checkpoint was not created after source quiescence.');
  }
  if (Date.parse(boundAt) < Date.parse(verifiedCheckpoint.checkpointCreatedAt)) {
    refuse('E_CHECKPOINT_ORDER', 'Checkpoint binding predates the final checkpoint.');
  }
  const binding = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-source-quiesce-checkpoint-binding',
    status: 'bound-verified',
    cutoverId: plan.cutoverId,
    boundAt,
    planSha256,
    sourceQuiesceReceiptSha256,
    sourceQuiesceCompletedAt: receipt.completedAt,
    postQuiesceSnapshotSha256,
    sourceStillQuiesced: true,
    checkpoint: {
      schemaVersion: 2,
      authorityType: verifiedCheckpoint.authorityType,
      checkpointId: verifiedCheckpoint.checkpointId,
      checkpointCreatedAt: verifiedCheckpoint.checkpointCreatedAt,
      manifestSha256: checkpointSha256,
      sqlGzip: {
        bytes: verifiedCheckpoint.payloads.sqlGzip.bytes,
        sha256: verifiedCheckpoint.payloads.sqlGzip.sha256,
      },
      redisRdb: {
        bytes: verifiedCheckpoint.payloads.redisRdb.bytes,
        sha256: verifiedCheckpoint.payloads.redisRdb.sha256,
      },
      isolatedRestoreStatus: verifiedCheckpoint.isolatedRestore.status,
      dualLocationStatus: verifiedCheckpoint.verification.dualLocation.status,
      recoveryStatus: verifiedCheckpoint.verification.recoveryUnit.status,
      sourceRuntime: verifiedCheckpoint.verification.recoveryUnit.sourceRuntime,
    },
    preservation: {
      windowsRuntimePreserved: true,
      volumesPreserved: true,
      releasesPreserved: true,
      backupsPreserved: true,
      noResourcesDeleted: true,
    },
  };
  return { ...binding, contentSha256: sha256(canonicalJson(binding)) };
}
export function validateCheckpointBinding(candidate, planCandidate, sourceReceiptSha256) {
  const plan = validateCutoverPlan(planCandidate);
  const binding = object(candidate, 'Checkpoint binding');
  exactKeys(binding, [
    'schemaVersion',
    'project',
    'kind',
    'status',
    'cutoverId',
    'boundAt',
    'planSha256',
    'sourceQuiesceReceiptSha256',
    'sourceQuiesceCompletedAt',
    'postQuiesceSnapshotSha256',
    'sourceStillQuiesced',
    'checkpoint',
    'preservation',
    'contentSha256',
  ], 'Checkpoint binding');
  if (
    binding.schemaVersion !== 1 ||
    binding.project !== PROJECT ||
    binding.kind !== 'easyfire-bookkeeping-source-quiesce-checkpoint-binding' ||
    binding.status !== 'bound-verified' ||
    binding.cutoverId !== plan.cutoverId ||
    binding.sourceQuiesceReceiptSha256 !== sourceReceiptSha256 ||
    binding.sourceStillQuiesced !== true ||
    binding.checkpoint?.schemaVersion !== 2 ||
    binding.checkpoint?.authorityType !==
      'easyfire-bookkeeping-windows-checkpoint-transfer' ||
    binding.checkpoint?.isolatedRestoreStatus !== 'passed' ||
    binding.checkpoint?.dualLocationStatus !== 'passed' ||
    binding.checkpoint?.recoveryStatus !== 'passed' ||
    binding.checkpoint?.sourceRuntime !== 'preserved' ||
    Object.values(binding.preservation ?? {}).some((value) => value !== true)
  ) refuse('E_CHECKPOINT_BINDING', 'Checkpoint binding proof is invalid.');
  for (const field of [
    'planSha256',
    'sourceQuiesceReceiptSha256',
    'postQuiesceSnapshotSha256',
    'contentSha256',
  ]) sha(binding[field], `Checkpoint binding ${field}`);
  for (const payload of ['sqlGzip', 'redisRdb']) {
    integer(binding.checkpoint?.[payload]?.bytes, `Checkpoint binding ${payload} bytes`, { minimum: 1 });
    sha(binding.checkpoint?.[payload]?.sha256, `Checkpoint binding ${payload} hash`);
  }
  sha(binding.checkpoint?.manifestSha256, 'Checkpoint binding manifest hash');
  string(binding.checkpoint?.checkpointId, 'Checkpoint binding checkpoint id');
  date(binding.boundAt, 'Checkpoint binding boundAt');
  date(binding.sourceQuiesceCompletedAt, 'Checkpoint binding source completedAt');
  date(binding.checkpoint.checkpointCreatedAt, 'Checkpoint binding checkpoint createdAt');
  if (
    Date.parse(binding.checkpoint.checkpointCreatedAt) <
      Date.parse(binding.sourceQuiesceCompletedAt) ||
    Date.parse(binding.boundAt) < Date.parse(binding.checkpoint.checkpointCreatedAt) ||
    !safeHashEqual(binding.contentSha256, sha256(canonicalJson(receiptContent(binding))))
  ) refuse('E_CHECKPOINT_BINDING', 'Checkpoint binding ordering or content hash is invalid.');
  return binding;
}
const PROOF_FILE_KEYS = Object.freeze([
  'checkpointManifest',
  'deploymentReceipt',
  'backupReceipt',
  'backupComplete',
  'rehearsal',
  'guardianPromotion',
  'authentication',
  'network',
]);
export function validateActivationEvidence(candidate, planCandidate, sourceReceiptSha256) {
  const plan = validateCutoverPlan(planCandidate);
  sha(sourceReceiptSha256, 'Source quiesce receipt hash');
  const evidence = object(candidate, 'Activation evidence');
  rejectSensitiveKeys(evidence);
  exactKeys(evidence, [
    'schemaVersion', 'project', 'kind', 'status', 'cutoverId', 'collectedAt',
    'chronology', 'collector', 'sourceQuiesce', 'checkpoint', 'guest',
    'proofFiles',
  ], 'Activation evidence');
  if (
    evidence.schemaVersion !== 1 ||
    evidence.project !== PROJECT ||
    evidence.kind !== 'easyfire-bookkeeping-direct-vm-activation-evidence' ||
    evidence.status !== 'all-gates-passed' ||
    evidence.cutoverId !== plan.cutoverId
  ) refuse('E_ACTIVATION_EVIDENCE', 'Activation evidence identity is invalid.');
  date(evidence.collectedAt, 'Activation evidence collectedAt');
  const chronology = object(evidence.chronology, 'Activation evidence chronology');
  exactKeys(chronology, ['schemaVersion', 'ordered', 'fresh', 'sourceQuiescedAt', 'deploymentCompletedAt', 'latestProofAt', 'collectedAt', 'maximumProofWindowSeconds'], 'Activation evidence chronology');
  for (const field of ['sourceQuiescedAt', 'deploymentCompletedAt', 'latestProofAt', 'collectedAt']) date(chronology[field], `Activation chronology ${field}`);
  if (
    chronology.schemaVersion !== 1 || chronology.ordered !== true || chronology.fresh !== true ||
    chronology.collectedAt !== evidence.collectedAt || chronology.maximumProofWindowSeconds !== 86400 ||
    Date.parse(chronology.sourceQuiescedAt) > Date.parse(chronology.deploymentCompletedAt) ||
    Date.parse(chronology.deploymentCompletedAt) > Date.parse(chronology.latestProofAt) ||
    Date.parse(chronology.latestProofAt) > Date.parse(evidence.collectedAt) ||
    Date.parse(evidence.collectedAt) - Date.parse(chronology.sourceQuiescedAt) > 86400000
  ) refuse('E_CHRONOLOGY', 'Activation evidence chronology is invalid.');
  const collector = object(evidence.collector, 'Activation evidence collector');
  exactKeys(collector, [
    'schemaVersion', 'kind', 'sourceReleasePath', 'executablePath',
    'executableSha256', 'releaseManifestSha256', 'collectionPlanSha256',
    'outputPath', 'outputPublishedCreateNew', 'secureFilesVerified',
    'semanticProofsVerified', 'liveReadbacksVerified',
  ], 'Activation evidence collector');
  if (
    collector.schemaVersion !== 1 ||
    collector.kind !== 'easyfire-bookkeeping-release-bound-activation-evidence-collector' ||
    collector.executableSha256 !== plan.controller.activationEvidenceCollectorSha256 ||
    collector.releaseManifestSha256 !== plan.controller.releaseManifestSha256 ||
    collector.outputPath !== '/etc/easyfire-bookkeeping/cutover-evidence.json' ||
    collector.outputPublishedCreateNew !== true ||
    collector.secureFilesVerified !== true ||
    collector.semanticProofsVerified !== true ||
    collector.liveReadbacksVerified !== true
  ) refuse('E_EVIDENCE_COLLECTOR', 'Activation evidence was not produced by the release-bound collector.');
  sha(collector.releaseManifestSha256, 'Activation collector release manifest hash');
  sha(collector.collectionPlanSha256, 'Activation collector plan hash');
  if (
    evidence.sourceQuiesce?.receiptSha256 !== sourceReceiptSha256 ||
    evidence.sourceQuiesce?.stillQuiesced !== true
  ) refuse('E_SINGLE_WRITER', 'The Windows source is not proven still quiesced.');
  const checkpoint = evidence.checkpoint;
  if (
    checkpoint?.manifestVersion !== 2 ||
    checkpoint?.status !== 'transfer-verified' ||
    checkpoint?.sourceQuiesceReceiptSha256 !== sourceReceiptSha256 ||
    checkpoint?.dualLocationVerified !== true ||
    checkpoint?.isolatedRestoreVerified !== true
  ) refuse('E_CHECKPOINT_PROOF', 'Final checkpoint proof is incomplete or unbound.');
  string(checkpoint?.checkpointId, 'Final checkpoint id');
  date(checkpoint?.checkpointCreatedAt, 'Final checkpoint createdAt');
  sha(checkpoint?.manifestSha256, 'Final checkpoint manifest hash');
  sha(checkpoint?.sqlGzipSha256, 'Final checkpoint SQL hash');
  sha(checkpoint?.redisRdbSha256, 'Final checkpoint Redis hash');
  sha(checkpoint?.bindingReceiptSha256, 'Final checkpoint binding receipt hash');
  const guest = object(evidence.guest, 'Guest activation evidence');
  if (guest.vmName !== plan.target.vmName) refuse('E_GUEST_IDENTITY', 'Guest VM identity is invalid.');
  const deployment = guest.deployment;
  if (
    deployment?.checkpointManifestSha256 !== checkpoint.manifestSha256 ||
    deployment?.status !== 'complete' ||
    deployment?.verifiedExisting !== true
  ) refuse('E_DEPLOYMENT_PROOF', 'Guest deployment proof is incomplete or unbound.');
  string(deployment?.deploymentId, 'Guest deployment id', DEPLOYMENT_ID);
  string(deployment?.releaseCommit, 'Guest release commit', COMMIT);
  if (deployment.releaseCommit !== plan.controller.releaseCommit) {
    refuse('E_DEPLOYMENT_BINDING', 'Guest deployment commit does not match cutover release authority.');
  }
  sha(deployment?.planSha256, 'Guest deployment plan hash');
  sha(deployment?.receiptSha256, 'Guest deployment receipt hash');
  const expectedReleasePath = `/opt/easyfire-bookkeeping/releases/${deployment.releaseCommit}`;
  if (
    collector.sourceReleasePath !== expectedReleasePath ||
    collector.executablePath !==
      `${expectedReleasePath}/scripts/production/linux-activation-evidence-collect.mjs`
  ) refuse('E_EVIDENCE_COLLECTOR', 'Activation collector release path is not deployment-bound.');
  const backup = guest.backup;
  if (
    backup?.status !== 'passed' ||
    backup?.isolatedRestoreVerified !== true ||
    backup?.restoreState !== 'stopped-preserved' ||
    backup?.deploymentId !== deployment.deploymentId ||
    backup?.checkpointManifestSha256 !== checkpoint.manifestSha256
  ) refuse('E_BACKUP_PROOF', 'Guest backup/restore proof is incomplete or unbound.');
  sha(backup?.receiptSha256, 'Guest backup receipt hash');
  sha(backup?.completeSha256, 'Guest backup completion hash');
  const rehearsal = guest.rehearsal;
  exactKeys(rehearsal, [
    'status', 'rehearsalId', 'deploymentId', 'releaseCommit',
    'releaseManifestSha256', 'evidenceSha256',
    'isolatedHostMachineIdSha256', 'productionMachineIdSha256',
    'rollbackLockedRebootReceiptSha256', 'normalRebootProofSha256',
    'recoveryProofSha256', 'guardianProofSha256',
    'authenticationProofSha256', 'routeActivated', 'publicExposure',
    'productionDataMutationCount', 'resourcesDeleted',
  ], 'Release rehearsal proof');
  if (
    rehearsal?.status !== 'passed' ||
    !UUID.test(rehearsal?.rehearsalId ?? '') ||
    !DEPLOYMENT_ID.test(rehearsal?.deploymentId ?? '') ||
    rehearsal.deploymentId === deployment.deploymentId ||
    rehearsal.releaseCommit !== deployment.releaseCommit ||
    rehearsal.releaseManifestSha256 !== collector.releaseManifestSha256 ||
    rehearsal.isolatedHostMachineIdSha256 === rehearsal.productionMachineIdSha256 ||
    rehearsal.routeActivated !== false ||
    rehearsal.publicExposure !== false ||
    rehearsal.productionDataMutationCount !== 0 ||
    rehearsal.resourcesDeleted !== false
  ) {
    refuse(
      'E_REHEARSAL_PROOF',
      'Release rehearsal proof is incomplete, mixed, or not isolated.',
    );
  }
  for (const field of [
    'releaseManifestSha256', 'evidenceSha256', 'isolatedHostMachineIdSha256',
    'productionMachineIdSha256', 'rollbackLockedRebootReceiptSha256',
    'normalRebootProofSha256', 'recoveryProofSha256', 'guardianProofSha256',
    'authenticationProofSha256',
  ]) sha(rehearsal?.[field], `Release rehearsal ${field}`);
  const guardian = guest.guardian;
  exactKeys(guardian, [
    'status', 'rehearsalEvidenceSha256', 'shadowConfigSha256', 'productionConfigSha256',
    'promotionReceiptSha256', 'promotionExecutableSha256', 'productionConfigMode',
    'shadowMode', 'timerActive', 'timerEnabled',
  ], 'Guardian activation proof');
  if (
    guardian?.status !== 'active-config-materialized' ||
    guardian?.rehearsalEvidenceSha256 !== rehearsal.evidenceSha256 ||
    guardian?.promotionExecutableSha256 !== plan.controller.guardianPromotionSha256 ||
    guardian?.productionConfigMode !== 'root:root-0600' ||
    guardian?.shadowMode !== false ||
    guardian?.timerActive !== true ||
    guardian?.timerEnabled !== true
  ) refuse('E_GUARDIAN_PROOF', 'Guardian proof is incomplete.');
  for (const field of [
    'shadowConfigSha256', 'productionConfigSha256', 'promotionReceiptSha256',
  ]) sha(guardian?.[field], `Guardian proof ${field}`);
  const authentication = guest.authentication;
  exactKeys(authentication, ['status', 'method', 'ownerConfirmed',
    'authenticatedApiPassed', 'dataInvariantsPassed', 'proofSha256'],
  'Native authentication proof');
  if (
    authentication?.status !== 'passed' ||
    authentication?.method !== 'native-password-interactive' ||
    authentication?.ownerConfirmed !== true ||
    authentication?.authenticatedApiPassed !== true ||
    authentication?.dataInvariantsPassed !== true
  ) refuse('E_AUTH_PROOF', 'Native authentication/data proof is incomplete.');
  sha(authentication?.proofSha256, 'Native authentication proof hash');
  const network = guest.network;
  exactKeys(network, ['proofSha256', 'backendState', 'selfOnline', 'dnsName',
    'serveAbsent', 'funnelAbsent', 'publicExposure', 'publicListeners'],
  'Guest private-network proof');
  if (
    network?.backendState !== 'Running' ||
    network?.selfOnline !== true ||
    network?.dnsName !== `${TAILSCALE_DNS_NAME}.` ||
    network?.serveAbsent !== true ||
    network?.funnelAbsent !== true ||
    network?.publicExposure !== false ||
    !Array.isArray(network?.publicListeners) ||
    network.publicListeners.length !== 0
  ) refuse('E_NETWORK_PROOF', 'Guest private-network proof is unsafe.');
  sha(network.proofSha256, 'Guest private-network proof hash');
  exactKeys(evidence.proofFiles, PROOF_FILE_KEYS, 'Activation proof-file hashes');
  for (const key of PROOF_FILE_KEYS) sha(evidence.proofFiles[key], `Activation proof ${key}`);
  const expectedProofFiles = {
    rehearsal: rehearsal.evidenceSha256, authentication: authentication.proofSha256,
    guardianPromotion: guardian.promotionReceiptSha256, checkpointManifest: checkpoint.manifestSha256,
    deploymentReceipt: deployment.receiptSha256, backupReceipt: backup.receiptSha256,
    backupComplete: backup.completeSha256, network: network.proofSha256,
  };
  if (PROOF_FILE_KEYS.some((key) => evidence.proofFiles[key] !== expectedProofFiles[key])) {
    refuse('E_PROOF_BINDING', 'Activation proof-file hashes are not summary-bound.');
  }
  return evidence;
}
export function buildActivationAuthorization({
  plan: planCandidate,
  planSha256,
  sourceQuiesceReceiptSha256,
  activationEvidence,
  activationEvidenceSha256,
  authorizedAt,
}) {
  const plan = validateCutoverPlan(planCandidate);
  sha(planSha256, 'Cutover plan hash');
  validateActivationEvidence(activationEvidence, plan, sourceQuiesceReceiptSha256);
  sha(activationEvidenceSha256, 'Activation evidence hash');
  date(authorizedAt, 'Activation authorization time');
  date(activationEvidence.collectedAt, 'Activation evidence collection time');
  const evidenceAge = Date.parse(authorizedAt) - Date.parse(activationEvidence.collectedAt);
  if (evidenceAge < 0 || evidenceAge > plan.target.authorizationMaxAgeSeconds * 1000) {
    refuse('E_AUTHORIZATION_EVIDENCE_TIME', 'Activation evidence is future-dated or stale at authorization.');
  }
  const expiresAt = new Date(Date.parse(authorizedAt) +
    plan.target.authorizationMaxAgeSeconds * 1000).toISOString();
  const authorization = {
    schemaVersion: 1,
    project: PROJECT,
    kind: 'easyfire-bookkeeping-private-route-authorization',
    status: 'authorized-once',
    cutoverId: plan.cutoverId,
    authorizedAt,
    activationEvidenceCollectedAt: activationEvidence.collectedAt,
    expiresAt,
    maximumActivations: 1,
    planSha256,
    sourceQuiesceReceiptSha256,
    activationEvidenceSha256,
    checkpointBindingSha256:
      activationEvidence.checkpoint.bindingReceiptSha256,
    deployment: {
      vmName: plan.target.vmName,
      deploymentId: activationEvidence.guest.deployment.deploymentId,
      releaseCommit: activationEvidence.guest.deployment.releaseCommit,
      deploymentPlanSha256: activationEvidence.guest.deployment.planSha256,
      checkpointManifestSha256:
        activationEvidence.guest.deployment.checkpointManifestSha256,
    },
    proofBindings: {
      sourceQuiesceReceiptPath:
        plan.evidence.sourceQuiesceReceiptGuestPath,
      activationEvidencePath: plan.evidence.activationEvidenceGuestPath,
      checkpointBindingPath: plan.evidence.checkpointBindingGuestPath,
    },
    route: {
      provider: 'tailscale-serve',
      scope: 'tailnet-only',
      dnsName: plan.target.tailscaleDnsName,
      httpsPort: 443,
      origin: plan.target.tailscaleOrigin,
      funnelAllowed: false,
    },
  };
  return {
    ...authorization,
    contentSha256: sha256(canonicalJson(authorization)),
  };
}
export function validateActivationAuthorization(candidate, now = new Date()) {
  const authorization = object(candidate, 'Activation authorization');
  rejectSensitiveKeys(authorization);
  exactKeys(authorization, [
    'schemaVersion', 'project', 'kind', 'status', 'cutoverId', 'authorizedAt',
    'activationEvidenceCollectedAt', 'expiresAt', 'maximumActivations',
    'planSha256', 'sourceQuiesceReceiptSha256', 'activationEvidenceSha256',
    'checkpointBindingSha256', 'deployment', 'proofBindings', 'route',
    'contentSha256',
  ], 'Activation authorization');
  if (
    authorization.schemaVersion !== 1 ||
    authorization.project !== PROJECT ||
    authorization.kind !== 'easyfire-bookkeeping-private-route-authorization' ||
    authorization.status !== 'authorized-once' ||
    authorization.maximumActivations !== 1
  ) refuse('E_AUTHORIZATION', 'Activation authorization identity is invalid.');
  string(authorization.cutoverId, 'Activation authorization cutover id', UUID);
  date(authorization.authorizedAt, 'Activation authorization authorizedAt');
  date(authorization.activationEvidenceCollectedAt, 'Activation evidence collectedAt');
  date(authorization.expiresAt, 'Activation authorization expiresAt');
  const age = Date.parse(authorization.expiresAt) - Date.parse(authorization.authorizedAt);
  const evidenceAge = now.getTime() - Date.parse(authorization.activationEvidenceCollectedAt);
  if (
    Date.parse(authorization.activationEvidenceCollectedAt) > Date.parse(authorization.authorizedAt) ||
    evidenceAge < 0 || evidenceAge > 900_000
  ) refuse('E_AUTHORIZATION_EVIDENCE_TIME', 'Activation evidence is future-dated or stale.');
  if (
    age !== 900_000 ||
    now.getTime() < Date.parse(authorization.authorizedAt) ||
    now.getTime() > Date.parse(authorization.expiresAt)
  ) {
    refuse('E_AUTHORIZATION_TIME', 'Activation authorization is expired or has an invalid lifetime.');
  }
  for (const field of [
    'planSha256',
    'sourceQuiesceReceiptSha256',
    'activationEvidenceSha256',
    'checkpointBindingSha256',
    'contentSha256',
  ]) sha(authorization[field], `Activation authorization ${field}`);
  exactKeys(authorization.deployment, [
    'vmName', 'deploymentId', 'releaseCommit', 'deploymentPlanSha256',
    'checkpointManifestSha256',
  ], 'Activation authorization deployment');
  if (
    authorization.deployment.vmName !== TARGET_VM ||
    !DEPLOYMENT_ID.test(authorization.deployment.deploymentId ?? '') ||
    !COMMIT.test(authorization.deployment.releaseCommit ?? '')
  ) refuse('E_AUTHORIZATION_DEPLOYMENT', 'Activation deployment authority is invalid.');
  sha(authorization.deployment.deploymentPlanSha256, 'Activation deployment plan hash');
  sha(authorization.deployment.checkpointManifestSha256, 'Activation checkpoint hash');
  if (!safeHashEqual(
    authorization.contentSha256,
    sha256(canonicalJson(receiptContent(authorization))),
  )) refuse('E_AUTHORIZATION_HASH', 'Activation authorization content hash is invalid.');
  if (
    authorization.route?.provider !== 'tailscale-serve' ||
    authorization.route?.scope !== 'tailnet-only' ||
    authorization.route?.dnsName !== TAILSCALE_DNS_NAME ||
    authorization.route?.httpsPort !== 443 ||
    authorization.route?.origin !== TAILSCALE_ORIGIN ||
    authorization.route?.funnelAllowed !== false ||
    authorization.proofBindings?.sourceQuiesceReceiptPath !==
      '/etc/easyfire-bookkeeping/source-quiesce-receipt.json' ||
    authorization.proofBindings?.activationEvidencePath !==
      '/etc/easyfire-bookkeeping/cutover-evidence.json' ||
    authorization.proofBindings?.checkpointBindingPath !==
      '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json'
  ) refuse('E_AUTHORIZATION_ROUTE', 'Activation authorization route is invalid.');
  return authorization;
}
export const safeHashEqual = (left, right) =>
  typeof left === 'string' &&
  typeof right === 'string' &&
  left.length === right.length &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));
const writeExclusive = async (target, bytes) => {
  const temporary = `${target}.partial-${process.pid}`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code === 'EEXIST') refuse('E_OUTPUT_EXISTS', 'Output already exists.');
      throw error;
    }
    await unlink(temporary);
  } catch (error) {
    if (error?.code === 'EEXIST') refuse('E_OUTPUT_EXISTS', 'Output already exists.');
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
};
const readJson = async (filePath, label) => {
  const bytes = await readFile(filePath);
  if (bytes.length < 2 || bytes.length > 2 * 1024 * 1024) {
    refuse('E_FILE_SIZE', `${label} has an invalid size.`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
  } catch {
    refuse('E_JSON', `${label} is not valid JSON.`);
  }
};
const parseCli = (args) => {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || key in parsed) {
      refuse('E_USAGE', 'Cutover contract arguments are invalid.');
    }
    parsed[key] = value;
  }
  return parsed;
};
async function runCli() {
  const args = parseCli(process.argv.slice(2));
  const mode = args['--mode'];
  const planDocument = await readJson(args['--plan'], 'Cutover plan');
  const plan = validateCutoverPlan(planDocument.value);
  if (mode === 'validate-plan') {
    process.stdout.write(`${JSON.stringify({ ok: true, cutoverId: plan.cutoverId })}\n`);
    return;
  }
  if (mode === 'validate-snapshot') {
    const snapshot = await readJson(args['--snapshot'], 'Source snapshot');
    validateSourceSnapshot(snapshot.value, plan, args['--phase']);
    process.stdout.write(`${JSON.stringify({ ok: true, phase: args['--phase'] })}\n`);
    return;
  }
  if (mode === 'validate-quiesce-receipt') {
    const receipt = await readJson(args['--source-receipt'], 'Source quiesce receipt');
    validateSourceQuiesceReceipt(receipt.value, plan, sha256(planDocument.bytes));
    if (args['--before'] && args['--after']) {
      const before = await readJson(args['--before'], 'Before snapshot');
      const after = await readJson(args['--after'], 'After snapshot');
      validateSourceSnapshot(before.value, plan, 'pre-quiesce');
      validateSourceSnapshot(after.value, plan, 'post-quiesce');
      if (
        receipt.value.beforeSnapshotSha256 !== sha256(before.bytes) ||
        receipt.value.afterSnapshotSha256 !== sha256(after.bytes)
      ) refuse('E_SNAPSHOT_BINDING', 'Source quiesce snapshot file hashes do not match the receipt.');
    } else if (args['--before'] || args['--after']) {
      refuse('E_USAGE', 'Both source snapshot paths are required together.');
    }
    process.stdout.write(`${JSON.stringify({ ok: true, cutoverId: plan.cutoverId })}\n`);
    return;
  }
  if (mode === 'build-quiesce-receipt') {
    const before = await readJson(args['--before'], 'Before snapshot');
    const after = await readJson(args['--after'], 'After snapshot');
    const receipt = buildSourceQuiesceReceipt({
      plan,
      planSha256: sha256(planDocument.bytes),
      before: before.value,
      beforeSha256: sha256(before.bytes),
      after: after.value,
      afterSha256: sha256(after.bytes),
      completedAt: args['--completed-at'],
    });
    await writeExclusive(
      args['--output'],
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
    );
    process.stdout.write(`${JSON.stringify({ ok: true, output: args['--output'] })}\n`);
    return;
  }
  if (mode === 'build-checkpoint-binding') {
    const receipt = await readJson(args['--source-receipt'], 'Source quiesce receipt');
    const snapshot = await readJson(args['--snapshot'], 'Post-quiesce snapshot');
    const checkpoint = await readJson(args['--checkpoint'], 'Checkpoint v2');
    const binding = buildCheckpointBinding({
      plan,
      planSha256: sha256(planDocument.bytes),
      sourceQuiesceReceipt: receipt.value,
      sourceQuiesceReceiptSha256: sha256(receipt.bytes),
      postQuiesceSnapshot: snapshot.value,
      postQuiesceSnapshotSha256: sha256(snapshot.bytes),
      checkpoint: checkpoint.value,
      checkpointSha256: sha256(checkpoint.bytes),
      boundAt: args['--bound-at'],
    });
    await writeExclusive(
      args['--output'],
      Buffer.from(`${JSON.stringify(binding, null, 2)}\n`),
    );
    process.stdout.write(`${JSON.stringify({ ok: true, output: args['--output'] })}\n`);
    return;
  }
  if (mode === 'build-activation-authorization') {
    const receipt = await readJson(args['--source-receipt'], 'Source quiesce receipt');
    validateSourceQuiesceReceipt(receipt.value, plan, sha256(planDocument.bytes));
    const evidence = await readJson(args['--activation-evidence'], 'Activation evidence');
    const receiptSha256 = sha256(receipt.bytes);
    const binding = await readJson(args['--checkpoint-binding'], 'Checkpoint binding');
    validateCheckpointBinding(binding.value, plan, receiptSha256);
    if (binding.value.planSha256 !== sha256(planDocument.bytes)) {
      refuse('E_PLAN_BINDING', 'Checkpoint binding is not bound to the cutover plan bytes.');
    }
    const bindingSha256 = sha256(binding.bytes);
    if (
      evidence.value?.checkpoint?.bindingReceiptSha256 !== bindingSha256 ||
      evidence.value?.checkpoint?.manifestSha256 !==
        binding.value.checkpoint.manifestSha256 ||
      evidence.value?.checkpoint?.checkpointId !==
        binding.value.checkpoint.checkpointId ||
      evidence.value?.checkpoint?.sqlGzipSha256 !==
        binding.value.checkpoint.sqlGzip.sha256 ||
      evidence.value?.checkpoint?.redisRdbSha256 !==
        binding.value.checkpoint.redisRdb.sha256
    ) refuse('E_CHECKPOINT_BINDING', 'Activation evidence is not bound to the final checkpoint receipt.');
    const authorization = buildActivationAuthorization({
      plan,
      planSha256: sha256(planDocument.bytes),
      sourceQuiesceReceiptSha256: receiptSha256,
      activationEvidence: evidence.value,
      activationEvidenceSha256: sha256(evidence.bytes),
      authorizedAt: args['--authorized-at'],
    });
    await writeExclusive(
      args['--output'],
      Buffer.from(`${JSON.stringify(authorization, null, 2)}\n`),
    );
    process.stdout.write(`${JSON.stringify({ ok: true, output: args['--output'] })}\n`);
    return;
  }
  refuse('E_USAGE', 'Unknown cutover contract mode.');
}
if (await isCanonicalMainModule(import.meta.url)) {
  runCli().catch((error) => {
    const refusal = error instanceof CutoverRefusal
      ? error
      : new CutoverRefusal('E_INTERNAL', 'Unexpected cutover contract failure.');
    process.stderr.write(`${refusal.code}: ${refusal.message}\n`);
    process.exitCode = 1;
  });
}
