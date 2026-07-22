#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  sha256,
  validateActivationEvidence,
  validateCheckpointBinding,
  validateCutoverPlan,
  validateSourceQuiesceReceipt,
} from './direct-vm-cutover-contract.mjs';
import { validateCheckpointV2Document } from './direct-vm-checkpoint-v2-contract.mjs';
import {
  validateGuardianConfig,
} from './linux-guardian-promote-active.mjs';
import { validateNativeAuthenticationProof } from './linux-native-auth-proof.mjs';
import { validateRehearsalEvidence } from './linux-rehearsal-evidence.mjs';
import {
  SERVICE_CONTRACT,
  validateCheckpointManifest,
  validateDeploymentPlan,
} from './linux-deploy-plan.mjs';
import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
import { parseManifestBoundRelease } from './linux-release-authority-verify.mjs';
import {
  parseListeningPorts,
  validatePreActivationNetwork,
  validateTailscaleVersion,
} from './linux-private-route-activate.mjs';

export const COLLECTION_PLAN = '/etc/easyfire-bookkeeping/activation-evidence-plan.json';
export const OUTPUT = '/etc/easyfire-bookkeeping/cutover-evidence.json';
export const NETWORK_PROOF = '/etc/easyfire-bookkeeping/activation-network-proof.json';
const NODE = '/usr/local/bin/node';
const DOCKER = '/usr/bin/docker';
const TAILSCALE = '/usr/bin/tailscale';
const SS = '/usr/bin/ss';
const SYSTEMCTL = '/usr/bin/systemctl';
const MAX_FILE = 4 * 1024 * 1024;
const MAX_BACKUP_ARTIFACT = 256 * 1024 * 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEPLOYMENT_ID = /^direct-vm-[0-9]{8}-[a-f0-9]{8}$/;
const SENSITIVE_KEY = /(?:password|secret|token|credential)/i;
const MAX_PROOF_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_COLLECTION_PLAN_AGE_MS = 15 * 60 * 1000;

export class ActivationEvidenceRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ActivationEvidenceRefusal';
    this.code = code;
  }
}
const refuse = (code, message) => { throw new ActivationEvidenceRefusal(code, message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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
const hash = (value, label) => {
  if (typeof value !== 'string' || !SHA.test(value)) refuse('E_HASH', `${label} is invalid.`);
};
const timestamp = (value, label) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) refuse('E_TIME', `${label} is invalid.`);
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

const FIXED_FILES = Object.freeze({
  cutoverPlan: '/etc/easyfire-bookkeeping/cutover-plan.json',
  sourceQuiesceReceipt: '/etc/easyfire-bookkeeping/source-quiesce-receipt.json',
  checkpointBinding: '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json',
  checkpointManifest: '/etc/easyfire-bookkeeping/checkpoint-manifest.json',
  deploymentPlan: '/etc/easyfire-bookkeeping/deployment-plan.json',
  deploymentReceipt: '/etc/easyfire-bookkeeping/deployment-receipt.json',
  rehearsalEvidence: '/etc/easyfire-bookkeeping/rehearsal-evidence.json',
  guardianPromotion: '/etc/easyfire-bookkeeping/guardian-active-promotion.json',
  authentication: '/etc/easyfire-bookkeeping/activation-proof/authentication.json',
  guardianConfig: '/etc/easyfire-bookkeeping/guardian.json',
  guardianShadowConfig: '/etc/easyfire-bookkeeping/guardian.shadow.json',
});

export function validateCollectionPlan(candidate) {
  const plan = object(candidate, 'Activation evidence collection plan');
  rejectSensitiveKeys(plan);
  exactKeys(plan, [
    'schemaVersion', 'project', 'kind', 'cutoverId', 'createdAt', 'files',
  ], 'Activation evidence collection plan');
  if (
    plan.schemaVersion !== 1 ||
    plan.project !== 'easyfire-bookkeeping' ||
    plan.kind !== 'easyfire-bookkeeping-activation-evidence-collection-plan' ||
    !UUID.test(plan.cutoverId ?? '')
  ) refuse('E_PLAN', 'Activation evidence collection plan identity is invalid.');
  timestamp(plan.createdAt, 'Activation evidence collection plan createdAt');
  exactKeys(plan.files, [
    ...Object.keys(FIXED_FILES),
    'backupReceipt', 'backupComplete',
  ], 'Activation evidence proof paths');
  for (const [key, expected] of Object.entries(FIXED_FILES)) {
    if (plan.files[key] !== expected) refuse('E_PATH', `Activation evidence ${key} path is invalid.`);
  }
  if (!/^\/var\/backups\/easyfire-bookkeeping\/[0-9]{8}T[0-9]{6}Z\/backup-receipt\.json$/.test(plan.files.backupReceipt)) {
    refuse('E_PATH', 'Activation backup receipt path is invalid.');
  }
  if (plan.files.backupComplete !== `${path.dirname(plan.files.backupReceipt)}/COMPLETE`) {
    refuse('E_PATH', 'Activation backup completion path is not receipt-bound.');
  }
  return plan;
}

const CHRONOLOGY_KEYS = Object.freeze([
  'cutoverPlanCreatedAt', 'sourceQuiescedAt', 'checkpointCreatedAt',
  'deploymentCompletedAt', 'backupCompletedAt', 'rehearsalCompletedAt',
  'guardianPromotedAt',
  'authenticationCompletedAt', 'collectionPlanCreatedAt',
]);

export function validateProofChronology(candidate, collectedAt) {
  const timeline = object(candidate, 'Activation proof chronology');
  exactKeys(timeline, CHRONOLOGY_KEYS, 'Activation proof chronology');
  timestamp(collectedAt, 'Activation evidence collectedAt');
  for (const key of CHRONOLOGY_KEYS) timestamp(timeline[key], `Activation chronology ${key}`);
  const at = Object.fromEntries(CHRONOLOGY_KEYS.map((key) => [key, Date.parse(timeline[key])]));
  const collected = Date.parse(collectedAt);
  const orderedPairs = [
    ['cutoverPlanCreatedAt', 'sourceQuiescedAt'],
    ['sourceQuiescedAt', 'checkpointCreatedAt'],
    ['checkpointCreatedAt', 'deploymentCompletedAt'],
    ['deploymentCompletedAt', 'backupCompletedAt'],
    ['rehearsalCompletedAt', 'guardianPromotedAt'],
    ['deploymentCompletedAt', 'guardianPromotedAt'],
    ['deploymentCompletedAt', 'authenticationCompletedAt'],
    ['deploymentCompletedAt', 'collectionPlanCreatedAt'],
  ];
  if (
    orderedPairs.some(([before, after]) => at[before] > at[after]) ||
    Object.values(at).some((value) => value > collected)
  ) refuse('E_CHRONOLOGY', 'Activation proof chronology is reordered or future-dated.');
  if (
    collected - at.sourceQuiescedAt > MAX_PROOF_WINDOW_MS ||
    collected - at.collectionPlanCreatedAt > MAX_COLLECTION_PLAN_AGE_MS
  ) refuse('E_CHRONOLOGY_STALE', 'Activation proof chronology is stale.');
  const latestProofAt = new Date(Math.max(...Object.values(at))).toISOString();
  return {
    schemaVersion: 1,
    ordered: true,
    fresh: true,
    sourceQuiescedAt: new Date(at.sourceQuiescedAt).toISOString(),
    deploymentCompletedAt: new Date(at.deploymentCompletedAt).toISOString(),
    latestProofAt,
    collectedAt: new Date(collected).toISOString(),
    maximumProofWindowSeconds: MAX_PROOF_WINDOW_MS / 1000,
  };
}

const validateDeploymentReceipt = (receipt, plan, planSha256) => {
  exactKeys(receipt, [
    'schemaVersion', 'project', 'deploymentId', 'releaseCommit',
    'releaseManifestSha256', 'checkpointManifestSha256', 'environmentSha256',
    'deploymentPlanSha256', 'migrationReceiptSha256', 'runtimeManifestSha256',
    'runtimeIdentityEvidenceSha256', 'completedAt', 'status',
  ], 'Deployment receipt');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.project !== 'easyfire-bookkeeping' ||
    receipt.deploymentId !== plan.deploymentId ||
    receipt.releaseCommit !== plan.releaseCommit ||
    receipt.releaseManifestSha256 !== plan.releaseManifest.sha256 ||
    receipt.checkpointManifestSha256 !== plan.checkpoint.manifestSha256 ||
    receipt.environmentSha256 !== plan.environment.sha256 ||
    receipt.deploymentPlanSha256 !== planSha256 ||
    receipt.status !== 'complete'
  ) refuse('E_DEPLOYMENT_PROOF', 'Deployment receipt is incomplete or unbound.');
  timestamp(receipt.completedAt, 'Deployment receipt completedAt');
  for (const field of [
    'migrationReceiptSha256', 'runtimeManifestSha256',
    'runtimeIdentityEvidenceSha256',
  ]) hash(receipt[field], `Deployment receipt ${field}`);
  return receipt;
};

export const expectedBackupArtifactPaths = (receipt) => {
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(receipt?.backupStamp ?? '')) {
    refuse('E_BACKUP_ARTIFACT', 'Backup artifact stamp is invalid.');
  }
  const stamp = receipt.backupStamp;
  return [
    `database/easyfire-app-${stamp}.sql.gz`,
    `redis/easyfire-redis-${stamp}.rdb`,
    'authority/release-manifest.json',
    'authority/checkpoint-manifest.json',
    'authority/migration-receipt.json',
    'authority/deployment-receipt.json',
    'authority/runtime-manifest.json',
    'authority/runtime-identity-evidence.json',
    'proof/deployment-controller-verification.json',
    'proof/authority-bindings.tsv',
    'proof/source-container-bindings.json',
    'proof/mariadb-check.txt',
    'proof/source-schema-tables.tsv',
    'proof/restored-schema-tables.tsv',
    'proof/schema-table-counts.tsv',
    'proof/identity-invariants.tsv',
    'proof/protected-accounting-counts.tsv',
    'RESTORE.md',
  ];
};

const parseBackupManifest = (manifestBytes, expectedPaths) => {
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length < 2 ||
      manifestBytes.length > MAX_FILE) refuse('E_BACKUP_ARTIFACT', 'Backup manifest bytes are invalid.');
  const text = manifestBytes.toString('utf8');
  if (!Buffer.from(text).equals(manifestBytes) || !text.endsWith('\n') || text.includes('\r')) {
    refuse('E_BACKUP_ARTIFACT', 'Backup manifest encoding is invalid.');
  }
  const entries = text.slice(0, -1).split('\n').map((line) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/.exec(line);
    if (!match || match[2].startsWith('/') || match[2].split('/').includes('..')) {
      refuse('E_BACKUP_ARTIFACT', 'Backup manifest entry is unsafe.');
    }
    return { sha256: match[1], path: match[2] };
  });
  if (JSON.stringify(entries.map((entry) => entry.path)) !== JSON.stringify(expectedPaths)) {
    refuse('E_BACKUP_ARTIFACT', 'Backup manifest file set or order is invalid.');
  }
  return entries;
};

export function validateBackupArtifactSet({
  receipt, manifestBytes, verificationBytes, observedHashes,
}) {
  const expectedPaths = expectedBackupArtifactPaths(receipt);
  const entries = parseBackupManifest(manifestBytes, expectedPaths);
  exactKeys(observedHashes, expectedPaths, 'Observed backup artifact hashes');
  if (sha256(manifestBytes) !== receipt.artifacts?.sha256ManifestSha256 ||
      !Buffer.isBuffer(verificationBytes) ||
      sha256(verificationBytes) !== receipt.artifacts?.verificationOutputSha256) {
    refuse('E_BACKUP_ARTIFACT', 'Backup manifest or verification output hash drifted.');
  }
  for (const { path: artifactPath, sha256: expectedSha256 } of entries) {
    hash(observedHashes[artifactPath], `Observed backup artifact ${artifactPath}`);
    if (observedHashes[artifactPath] !== expectedSha256) {
      refuse('E_BACKUP_ARTIFACT', `Backup artifact hash drifted: ${artifactPath}`);
    }
  }
  const databasePath = expectedPaths[0];
  const redisPath = expectedPaths[1];
  const bindings = {
    [databasePath]: receipt.artifacts.databaseSha256,
    [redisPath]: receipt.artifacts.redisSha256,
    'authority/release-manifest.json': receipt.sourceAuthority.releaseManifestSha256,
    'authority/checkpoint-manifest.json': receipt.sourceAuthority.checkpointManifestSha256,
    'authority/migration-receipt.json': receipt.sourceAuthority.migrationReceiptSha256,
    'authority/deployment-receipt.json': receipt.sourceAuthority.deploymentReceiptSha256,
    'authority/runtime-manifest.json': receipt.sourceAuthority.runtimeManifestSha256,
    'authority/runtime-identity-evidence.json': receipt.sourceAuthority.runtimeIdentityEvidenceSha256,
    'proof/source-schema-tables.tsv': receipt.validation.schemaTableInventory.sourceEvidenceSha256,
    'proof/restored-schema-tables.tsv': receipt.validation.schemaTableInventory.restoredEvidenceSha256,
    'proof/identity-invariants.tsv': receipt.validation.identityCountsEvidence.sha256,
    'proof/protected-accounting-counts.tsv': receipt.validation.protectedAccountingCounts.evidenceSha256,
  };
  for (const [artifactPath, expectedSha256] of Object.entries(bindings)) {
    if (observedHashes[artifactPath] !== expectedSha256) {
      refuse('E_BACKUP_ARTIFACT', `Backup receipt binding drifted: ${artifactPath}`);
    }
  }
  return { artifactCount: entries.length };
}

export function validatePreservedBackupRestore({
  receipt, containerInspection, volumeInspection,
}) {
  if (!Array.isArray(containerInspection) || containerInspection.length !== 1 ||
      !Array.isArray(volumeInspection) || volumeInspection.length !== 1) {
    refuse('E_BACKUP_RESTORE', 'Preserved backup restore resources are missing or ambiguous.');
  }
  const container = object(containerInspection[0], 'Preserved restore container');
  const volume = object(volumeInspection[0], 'Preserved restore volume');
  const expectedLabels = {
    'easyfire.bookkeeping.purpose': 'backup-restore-proof',
    'easyfire.bookkeeping.backup-stamp': receipt.backupStamp,
  };
  const mounts = Array.isArray(container.Mounts) ? container.Mounts : [];
  const dataMount = mounts.find(({ Destination }) => Destination === '/var/lib/mysql');
  const secretMount = mounts.find(({ Destination }) => Destination === '/run/easyfire-proof-secrets');
  if (
    !SHA.test(container.Id ?? '') ||
    container.Name !== `/${receipt.restoreProof.container}` ||
    container.Image !== receipt.sourceContainers.mysql.imageId ||
    container.State?.Status !== 'exited' || container.State?.Running !== false ||
    container.HostConfig?.NetworkMode !== 'none' ||
    container.HostConfig?.RestartPolicy?.Name !== 'no' ||
    Object.entries(expectedLabels).some(([key, value]) => container.Config?.Labels?.[key] !== value) ||
    mounts.length !== 2 || dataMount?.Type !== 'volume' ||
    dataMount?.Name !== receipt.restoreProof.volume || dataMount?.RW !== true ||
    secretMount?.Type !== 'bind' || secretMount?.RW !== false ||
    !/^\/run\/easyfire-bookkeeping-backup-proof\.[A-Za-z0-9]{8,}$/.test(secretMount?.Source ?? '') ||
    volume.Name !== receipt.restoreProof.volume || volume.Driver !== 'local' || volume.Scope !== 'local' ||
    Object.entries(expectedLabels).some(([key, value]) => volume.Labels?.[key] !== value)
  ) refuse('E_BACKUP_RESTORE', 'Backup restore resources are not stopped, isolated, and preserved.');
  return { preserved: true };
}

const validateBackup = (receipt, complete, authority) => {
  exactKeys(receipt, [
    'schemaVersion', 'status', 'completedAt', 'backupStamp', 'sourceAuthority',
    'sourceContainers', 'sourceVolumes', 'databases', 'artifacts', 'validation',
    'restoreProof',
  ], 'Backup receipt');
  if (receipt.schemaVersion !== 2 || receipt.status !== 'passed') {
    refuse('E_BACKUP_PROOF', 'Backup receipt did not pass.');
  }
  timestamp(receipt.completedAt, 'Backup receipt completedAt');
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(receipt.backupStamp ?? '')) refuse('E_BACKUP_PROOF', 'Backup stamp is invalid.');
  const source = object(receipt.sourceAuthority, 'Backup source authority');
  exactKeys(source, [
    'deploymentId', 'releaseCommit', 'sourceReleasePath', 'releaseManifestSha256',
    'checkpointManifestSha256', 'environmentSha256', 'deploymentPlanSha256',
    'migrationReceiptSha256', 'deploymentReceiptSha256', 'runtimeManifestSha256',
    'runtimeIdentityEvidenceSha256',
  ], 'Backup source authority');
  if (
    source.deploymentId !== authority.deploymentId ||
    source.releaseCommit !== authority.releaseCommit ||
    source.sourceReleasePath !== `/opt/easyfire-bookkeeping/releases/${authority.releaseCommit}` ||
    source.releaseManifestSha256 !== authority.releaseManifestSha256 ||
    source.checkpointManifestSha256 !== authority.checkpointManifestSha256 ||
    source.environmentSha256 !== authority.environmentSha256 ||
    source.deploymentPlanSha256 !== authority.deploymentPlanSha256 ||
    source.migrationReceiptSha256 !== authority.migrationReceiptSha256 ||
    source.deploymentReceiptSha256 !== authority.deploymentReceiptSha256 ||
    source.runtimeManifestSha256 !== authority.runtimeManifestSha256 ||
    source.runtimeIdentityEvidenceSha256 !== authority.runtimeIdentityEvidenceSha256
  ) refuse('E_BACKUP_PROOF', 'Backup source authority is not deployment-bound.');
  for (const field of Object.keys(source).filter((key) => key.endsWith('Sha256'))) {
    hash(source[field], `Backup source authority ${field}`);
  }
  exactKeys(receipt.sourceContainers, ['mysql', 'redis'], 'Backup source containers');
  const containerSpecs = {
    mysql: [SERVICE_CONTRACT.mysql.name, /^easyfire-bookkeeping\/mariadb:[A-Za-z0-9._-]+$/],
    redis: [SERVICE_CONTRACT.redis.name, /^easyfire-bookkeeping\/redis:[A-Za-z0-9._-]+$/],
  };
  for (const [role, [name, reference]] of Object.entries(containerSpecs)) {
    const container = receipt.sourceContainers[role];
    exactKeys(container, ['name', 'id', 'imageReference', 'imageId'], `Backup ${role} container`);
    if (container.name !== name || !SHA.test(container.id) ||
        !reference.test(container.imageReference ?? '') || !/^sha256:[a-f0-9]{64}$/.test(container.imageId ?? '')) {
      refuse('E_BACKUP_PROOF', `Backup ${role} container identity is invalid.`);
    }
  }
  exactKeys(receipt.sourceVolumes, ['mysql', 'redis'], 'Backup source volumes');
  if (receipt.sourceVolumes.mysql !== authority.resources.mysqlVolume ||
      receipt.sourceVolumes.redis !== authority.resources.redisVolume) {
    refuse('E_BACKUP_PROOF', 'Backup source volumes are not deployment-bound.');
  }
  if (JSON.stringify(receipt.databases) !== JSON.stringify([
    authority.expected.systemDatabase, authority.expected.tenantDatabase,
  ])) refuse('E_BACKUP_PROOF', 'Backup database set is invalid.');
  exactKeys(receipt.artifacts, [
    'databaseSha256', 'redisSha256', 'sha256Manifest', 'sha256ManifestSha256',
    'verificationOutput', 'verificationOutputSha256',
  ], 'Backup artifacts');
  for (const field of ['databaseSha256', 'redisSha256', 'sha256ManifestSha256', 'verificationOutputSha256']) {
    hash(receipt.artifacts[field], `Backup artifact ${field}`);
  }
  if (receipt.artifacts.sha256Manifest !== 'SHA256SUMS' ||
      receipt.artifacts.verificationOutput !== 'verification.txt') {
    refuse('E_BACKUP_PROOF', 'Backup artifact names are invalid.');
  }
  exactKeys(receipt.validation, [
    'systemTableCount', 'tenantTableCount', 'identityCounts',
    'identityCountsEvidence', 'schemaTableInventory',
    'protectedAccountingCounts', 'applicationUserQueries',
  ], 'Backup validation');
  exactKeys(receipt.validation.identityCountsEvidence,
    ['path', 'sha256', 'valueDomain'], 'Backup identity-count evidence');
  exactKeys(receipt.validation.schemaTableInventory, [
    'tableCount', 'sourceEvidence', 'sourceEvidenceSha256', 'restoredEvidence',
    'restoredEvidenceSha256', 'exactMatch', 'baseTableEngine',
  ], 'Backup schema inventory');
  exactKeys(receipt.validation.protectedAccountingCounts,
    ['tableCount', 'evidence', 'evidenceSha256', 'valueDomain'],
    'Backup protected-accounting evidence');
  const schema = receipt.validation.schemaTableInventory;
  const protectedCounts = receipt.validation.protectedAccountingCounts;
  if (
    receipt.validation.systemTableCount !== authority.expected.systemTableCount ||
    receipt.validation.tenantTableCount !== authority.expected.tenantTableCount ||
    JSON.stringify(receipt.validation.identityCounts) !== JSON.stringify(authority.expected.identityCounts) ||
    receipt.validation.identityCountsEvidence.path !== 'proof/identity-invariants.tsv' ||
    receipt.validation.identityCountsEvidence.valueDomain !== 'nonnegative-integer' ||
    schema.tableCount !== authority.expected.systemTableCount + authority.expected.tenantTableCount ||
    schema.sourceEvidence !== 'proof/source-schema-tables.tsv' ||
    schema.restoredEvidence !== 'proof/restored-schema-tables.tsv' ||
    schema.sourceEvidenceSha256 !== schema.restoredEvidenceSha256 ||
    schema.exactMatch !== true || schema.baseTableEngine !== 'InnoDB' ||
    protectedCounts.tableCount !== Object.keys(authority.expected.protectedTableCounts).length ||
    protectedCounts.evidence !== 'proof/protected-accounting-counts.tsv' ||
    protectedCounts.valueDomain !== 'nonnegative-integer' ||
    receipt.validation.applicationUserQueries !== true
  ) refuse('E_BACKUP_PROOF', 'Backup isolated-restore validation is incomplete.');
  for (const value of [
    receipt.validation.identityCountsEvidence.sha256,
    schema.sourceEvidenceSha256, schema.restoredEvidenceSha256,
    protectedCounts.evidenceSha256,
  ]) hash(value, 'Backup validation evidence hash');
  exactKeys(receipt.restoreProof,
    ['container', 'volume', 'network', 'state', 'consistency', 'credentials'],
    'Backup restore proof');
  const restoreSuffix = receipt.backupStamp.toLowerCase();
  if (
    receipt.restoreProof?.container !== `easyfire-bookkeeping-backup-restore-${restoreSuffix}` ||
    receipt.restoreProof?.volume !== `easyfire_bookkeeping_backup_restore_${restoreSuffix}` ||
    receipt.restoreProof?.network !== 'none' ||
    receipt.restoreProof?.state !== 'stopped-preserved' ||
    receipt.restoreProof?.consistency !== 'mariadb-single-transaction' ||
    receipt.restoreProof?.credentials !== 'ephemeral-random-destroyed' ||
    receipt.restoreProof.volume === receipt.sourceVolumes.mysql ||
    receipt.restoreProof.volume === receipt.sourceVolumes.redis
  ) refuse('E_BACKUP_PROOF', 'Backup isolated-restore semantics are incomplete.');
  exactKeys(complete, [
    'schemaVersion', 'status', 'backupStamp', 'receipt', 'receiptSha256',
    'sha256Manifest', 'sha256ManifestSha256',
  ], 'Backup completion');
  if (
    complete.schemaVersion !== 1 ||
    complete.status !== 'complete' ||
    complete.backupStamp !== receipt.backupStamp ||
    complete.receipt !== 'backup-receipt.json' ||
    complete.receiptSha256 !== authority.backupReceiptSha256 ||
    complete.sha256Manifest !== receipt.artifacts.sha256Manifest ||
    complete.sha256ManifestSha256 !== receipt.artifacts.sha256ManifestSha256
  ) refuse('E_BACKUP_PROOF', 'Backup COMPLETE marker is not receipt-bound.');
  hash(complete.sha256ManifestSha256, 'Backup completion manifest hash');
  return receipt;
};

const validateGuardianPromotion = ({ rehearsal, promotion, shadowConfig, productionConfig }, authority, hashes) => {
  validateGuardianConfig(shadowConfig, true);
  validateGuardianConfig(productionConfig, false);
  exactKeys(promotion, [
    'schemaVersion', 'project', 'kind', 'status', 'promotedAt', 'deploymentId',
    'releaseCommit', 'executablePath', 'executableSha256',
    'releaseManifestSha256', 'cutoverPlanSha256', 'deploymentPlanSha256',
    'rehearsalId', 'rehearsalDeploymentId', 'rehearsalEvidencePath',
    'rehearsalEvidenceSha256', 'rehearsalHostMachineIdSha256',
    'shadowConfigPath', 'shadowConfigSha256',
    'productionConfigPath', 'productionConfigSha256',
    'timerWasInactive', 'timerActivationPerformed',
    'resourcesDeleted',
  ], 'Guardian promotion receipt');
  if (
    promotion.schemaVersion !== 1 ||
    promotion.project !== 'easyfire-bookkeeping' ||
    promotion.kind !== 'easyfire-bookkeeping-guardian-active-promotion' ||
    promotion.status !== 'active-config-materialized' ||
    promotion.deploymentId !== authority.deploymentId ||
    promotion.releaseCommit !== authority.releaseCommit ||
    promotion.executablePath !== `/opt/easyfire-bookkeeping/releases/${authority.releaseCommit}/scripts/production/linux-guardian-promote-active.mjs` ||
    promotion.executableSha256 !== authority.guardianPromotionSha256 ||
    promotion.releaseManifestSha256 !== authority.releaseManifestSha256 ||
    promotion.cutoverPlanSha256 !== authority.cutoverPlanSha256 ||
    promotion.deploymentPlanSha256 !== authority.deploymentPlanSha256 ||
    promotion.rehearsalId !== rehearsal.rehearsalId ||
    promotion.rehearsalDeploymentId !== rehearsal.rehearsalDeployment.deploymentId ||
    promotion.rehearsalEvidencePath !== '/etc/easyfire-bookkeeping/rehearsal-evidence.json' ||
    promotion.rehearsalEvidenceSha256 !== hashes.rehearsalEvidence ||
    promotion.rehearsalHostMachineIdSha256 !== rehearsal.host.machineIdSha256 ||
    promotion.shadowConfigPath !== '/etc/easyfire-bookkeeping/guardian.shadow.json' ||
    promotion.productionConfigPath !== '/etc/easyfire-bookkeeping/guardian.json' ||
    promotion.shadowConfigSha256 !== hashes.guardianShadowConfig ||
    promotion.productionConfigSha256 !== hashes.guardianConfig ||
    promotion.timerWasInactive !== true ||
    promotion.timerActivationPerformed !== false ||
    promotion.resourcesDeleted !== false
  ) refuse('E_GUARDIAN_PROOF', 'Guardian active-promotion proof is incomplete or unbound.');
  timestamp(promotion.promotedAt, 'Guardian promotion time');
  return promotion;
};

const validateAuthentication = (proof, authority) => {
  const validated = validateNativeAuthenticationProof(proof);
  if (
    validated.deploymentId !== authority.deploymentId ||
    validated.releaseCommit !== authority.releaseCommit ||
    validated.releaseManifestSha256 !== authority.releaseManifestSha256 ||
    validated.checkpointManifestSha256 !== authority.checkpointManifestSha256 ||
    validated.deploymentPlanSha256 !== authority.deploymentPlanSha256 ||
    validated.deploymentReceiptSha256 !== authority.deploymentReceiptSha256
  ) refuse('E_AUTH_PROOF', 'Native authentication proof is incomplete or unbound.');
  return validated;
};

export function buildActivationEvidence({
  collectionPlan,
  cutoverPlan,
  sourceReceipt,
  checkpointBinding,
  checkpointManifest,
  deploymentPlan,
  deploymentReceipt,
  backupReceipt,
  backupComplete,
  rehearsalEvidence,
  guardianPromotion,
  guardianShadowConfig,
  guardianConfig,
  authenticationProof,
  network,
  live,
  hashes,
  collector,
  collectedAt,
}) {
  const plan = validateCollectionPlan(collectionPlan);
  const cutover = validateCutoverPlan(cutoverPlan);
  if (plan.cutoverId !== cutover.cutoverId) refuse('E_BINDING', 'Collection plan and cutover id differ.');
  const source = validateSourceQuiesceReceipt(sourceReceipt, cutover, hashes.cutoverPlan);
  const binding = validateCheckpointBinding(checkpointBinding, cutover, hashes.sourceReceipt);
  validateCheckpointV2Document(checkpointManifest, cutover, {
    planSha256: hashes.cutoverPlan,
    sourceQuiesceReceiptSha256: hashes.sourceReceipt,
    sourceQuiesceContentSha256: source.contentSha256,
    sourceQuiesceCompletedAt: source.completedAt,
    postQuiesceSnapshotSha256: source.afterSnapshotSha256,
    postQuiesceCapturedAt: checkpointManifest.finalQuiescence?.sourceSnapshot?.capturedAt,
    writerProof: checkpointManifest.finalQuiescence?.sourceSnapshot?.writerProof,
  });
  const deployment = validateDeploymentPlan(deploymentPlan);
  validateCheckpointManifest(checkpointManifest, deployment, { requireFinalQuiescence: true });
  const deploymentReceiptValue = validateDeploymentReceipt(deploymentReceipt, deployment, hashes.deploymentPlan);
  const authority = {
    deploymentId: deployment.deploymentId,
    releaseCommit: deployment.releaseCommit,
    checkpointManifestSha256: hashes.checkpointManifest,
    deploymentPlanSha256: hashes.deploymentPlan,
    deploymentReceiptSha256: hashes.deploymentReceipt,
    backupReceiptSha256: hashes.backupReceipt,
    cutoverPlanSha256: hashes.cutoverPlan,
    guardianPromotionSha256: cutover.controller.guardianPromotionSha256,
    releaseManifestSha256: collector.releaseManifestSha256,
    environmentSha256: deployment.environment.sha256,
    migrationReceiptSha256: deploymentReceiptValue.migrationReceiptSha256,
    runtimeManifestSha256: deploymentReceiptValue.runtimeManifestSha256,
    runtimeIdentityEvidenceSha256: deploymentReceiptValue.runtimeIdentityEvidenceSha256,
    resources: deployment.resources,
    expected: deployment.expected,
  };
  if (
    binding.checkpoint.manifestSha256 !== hashes.checkpointManifest ||
    deployment.checkpoint.manifestSha256 !== hashes.checkpointManifest
  ) refuse('E_BINDING', 'Checkpoint binding and deployment checkpoint differ.');
  validateBackup(backupReceipt, backupComplete, authority);
  const rehearsal = validateRehearsalEvidence(rehearsalEvidence);
  if (
    rehearsal.release.releaseCommit !== authority.releaseCommit ||
    rehearsal.release.releaseManifestSha256 !== authority.releaseManifestSha256 ||
    rehearsal.rehearsalDeployment.deploymentId === authority.deploymentId
  ) {
    refuse(
      'E_REHEARSAL_PROOF',
      'Rehearsal proof is not isolated and bound to the exact production release.',
    );
  }
  const guardian = validateGuardianPromotion({
    rehearsal,
    promotion: guardianPromotion,
    shadowConfig: guardianShadowConfig,
    productionConfig: guardianConfig,
  }, authority, hashes);
  const authentication = validateAuthentication(authenticationProof, authority);
  if (
    live.deploymentVerified !== true ||
    live.stackActive !== true ||
    live.guardianTimerActive !== true ||
    live.guardianTimerEnabled !== true ||
    live.guardianConfigMode !== 'root:root-0600'
  ) refuse('E_LIVE_READBACK', 'Live deployment/Guardian readback is incomplete.');
  const chronology = validateProofChronology({
    cutoverPlanCreatedAt: cutover.createdAt,
    sourceQuiescedAt: source.completedAt,
    checkpointCreatedAt: checkpointManifest.checkpointCreatedAt,
    deploymentCompletedAt: deploymentReceiptValue.completedAt,
    backupCompletedAt: backupReceipt.completedAt,
    rehearsalCompletedAt: rehearsal.completedAt,
    guardianPromotedAt: guardian.promotedAt,
    authenticationCompletedAt: authentication.completedAt,
    collectionPlanCreatedAt: plan.createdAt,
  }, collectedAt);
  const evidence = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-direct-vm-activation-evidence',
    status: 'all-gates-passed',
    cutoverId: cutover.cutoverId,
    collectedAt,
    chronology,
    collector,
    sourceQuiesce: { receiptSha256: hashes.sourceReceipt, stillQuiesced: true },
    checkpoint: {
      manifestVersion: 2,
      checkpointId: checkpointManifest.checkpointId,
      checkpointCreatedAt: checkpointManifest.checkpointCreatedAt,
      manifestSha256: hashes.checkpointManifest,
      status: 'transfer-verified',
      sourceQuiesceReceiptSha256: hashes.sourceReceipt,
      bindingReceiptSha256: hashes.checkpointBinding,
      dualLocationVerified: true,
      isolatedRestoreVerified: true,
      sqlGzipSha256: checkpointManifest.payloads.sqlGzip.sha256,
      redisRdbSha256: checkpointManifest.payloads.redisRdb.sha256,
    },
    guest: {
      vmName: cutover.target.vmName,
      deployment: {
        deploymentId: authority.deploymentId,
        releaseCommit: authority.releaseCommit,
        planSha256: hashes.deploymentPlan,
        checkpointManifestSha256: hashes.checkpointManifest,
        receiptSha256: hashes.deploymentReceipt,
        status: deploymentReceiptValue.status,
        verifiedExisting: true,
      },
      backup: {
        receiptSha256: hashes.backupReceipt,
        completeSha256: hashes.backupComplete,
        status: backupReceipt.status,
        isolatedRestoreVerified: true,
        restoreState: backupReceipt.restoreProof.state,
        deploymentId: authority.deploymentId,
        checkpointManifestSha256: hashes.checkpointManifest,
      },
      rehearsal: {
        status: rehearsal.status,
        rehearsalId: rehearsal.rehearsalId,
        deploymentId: rehearsal.rehearsalDeployment.deploymentId,
        releaseCommit: rehearsal.release.releaseCommit,
        releaseManifestSha256: rehearsal.release.releaseManifestSha256,
        evidenceSha256: hashes.rehearsalEvidence,
        isolatedHostMachineIdSha256: rehearsal.host.machineIdSha256,
        productionMachineIdSha256: rehearsal.host.productionMachineIdSha256,
        rollbackLockedRebootReceiptSha256:
          rehearsal.rollback.lockedRebootReceiptSha256,
        normalRebootProofSha256: rehearsal.normalReboot.proofSha256,
        recoveryProofSha256: rehearsal.recovery.proofSha256,
        guardianProofSha256: rehearsal.guardian.proofSha256,
        authenticationProofSha256: rehearsal.authentication.proofSha256,
        routeActivated: rehearsal.scope.routeActivated,
        publicExposure: rehearsal.scope.publicExposure,
        productionDataMutationCount: rehearsal.scope.productionDataMutationCount,
        resourcesDeleted: rehearsal.scope.resourcesDeleted,
      },
      guardian: {
        status: 'active-config-materialized',
        rehearsalEvidenceSha256: hashes.rehearsalEvidence,
        shadowConfigSha256: hashes.guardianShadowConfig,
        productionConfigSha256: hashes.guardianConfig,
        promotionReceiptSha256: hashes.guardianPromotion,
        promotionExecutableSha256: cutover.controller.guardianPromotionSha256,
        productionConfigMode: live.guardianConfigMode,
        shadowMode: false,
        timerActive: live.guardianTimerActive,
        timerEnabled: live.guardianTimerEnabled,
      },
      authentication: {
        status: authentication.status,
        method: authentication.method,
        ownerConfirmed: authentication.ownerConfirmed,
        authenticatedApiPassed:
          authentication.authenticatedApi.account === 'passed' &&
          authentication.authenticatedApi.organization === 'passed',
        dataInvariantsPassed:
          authentication.dataValidation.protectedAccountingCountsExact === true,
        proofSha256: hashes.authentication,
      },
      network: { proofSha256: hashes.network, ...network },
    },
    proofFiles: {
      checkpointManifest: hashes.checkpointManifest,
      deploymentReceipt: hashes.deploymentReceipt,
      backupReceipt: hashes.backupReceipt,
      backupComplete: hashes.backupComplete,
      rehearsal: hashes.rehearsalEvidence,
      guardianPromotion: hashes.guardianPromotion,
      authentication: hashes.authentication,
      network: hashes.network,
    },
  };
  validateActivationEvidence(evidence, cutover, hashes.sourceReceipt);
  return evidence;
}

const assertSecureFile = async (file, mode = 0o600) => {
  const resolved = await realpath(file).catch(() => null);
  if (resolved !== file) refuse('E_FILE', `File is missing or traverses a symlink: ${file}`);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o777) !== mode || stat.size < 2 || stat.size > MAX_FILE) {
    refuse('E_FILE', `File authority is invalid: ${file}`);
  }
  return stat;
};
const readSecureJson = async (file, mode = 0o600) => {
  await assertSecureFile(file, mode);
  const bytes = await readFile(file);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { refuse('E_JSON', `File is not valid JSON: ${file}`); }
};
const readSecureBytes = async (file) => {
  await assertSecureFile(file);
  return readFile(file);
};
const hashSecureBackupFile = async (file) => {
  const resolved = await realpath(file).catch(() => null);
  if (resolved !== file) refuse('E_BACKUP_ARTIFACT', `Backup artifact is missing or linked: ${file}`);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== 0 || (before.mode & 0o777) !== 0o600 ||
        before.size < 1 || before.size > MAX_BACKUP_ARTIFACT) {
      refuse('E_BACKUP_ARTIFACT', `Backup artifact authority is invalid: ${file}`);
    }
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer, 0, Math.min(buffer.length, before.size - position), position,
      );
      if (bytesRead < 1) refuse('E_BACKUP_ARTIFACT', `Backup artifact truncated: ${file}`);
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      refuse('E_BACKUP_ARTIFACT', `Backup artifact changed while hashing: ${file}`);
    }
    return digest.digest('hex');
  } finally { await handle.close(); }
};
const revalidateBackupArtifacts = async (backupReceiptPath, receipt) => {
  const backupRoot = path.dirname(backupReceiptPath);
  const manifestPath = path.join(backupRoot, receipt.artifacts.sha256Manifest);
  const verificationPath = path.join(backupRoot, receipt.artifacts.verificationOutput);
  const [manifestBytes, verificationBytes] = await Promise.all([
    readSecureBytes(manifestPath), readSecureBytes(verificationPath),
  ]);
  const observedHashes = {};
  for (const artifactPath of expectedBackupArtifactPaths(receipt)) {
    const absolutePath = path.resolve(backupRoot, ...artifactPath.split('/'));
    if (!absolutePath.startsWith(`${backupRoot}${path.sep}`)) {
      refuse('E_BACKUP_ARTIFACT', 'Backup artifact escaped its receipt directory.');
    }
    observedHashes[artifactPath] = await hashSecureBackupFile(absolutePath);
  }
  return validateBackupArtifactSet({ receipt, manifestBytes, verificationBytes, observedHashes });
};
const run = (file, args, label, allowedCodes = [0], timeoutMs = 360_000) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', () => { clearTimeout(timer); reject(new ActivationEvidenceRefusal('E_COMMAND', `${label} could not start.`)); });
  child.once('close', (code, signal) => {
    clearTimeout(timer);
    if (timedOut || bytes > MAX_OUTPUT || signal || !allowedCodes.includes(code)) {
      reject(new ActivationEvidenceRefusal('E_COMMAND', `${label} failed closed.`));
    } else resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code });
  });
});
const parseJsonOutput = (result, label) => {
  try { return JSON.parse(result.stdout.toString('utf8').trim() || '{}'); }
  catch { refuse('E_COMMAND_JSON', `${label} returned invalid JSON.`); }
};
const revalidateBackupRestoreState = async (receipt) => {
  const [containerResult, volumeResult] = await Promise.all([
    run(DOCKER, ['container', 'inspect', receipt.restoreProof.container], 'Backup restore container readback'),
    run(DOCKER, ['volume', 'inspect', receipt.restoreProof.volume], 'Backup restore volume readback'),
  ]);
  return validatePreservedBackupRestore({
    receipt,
    containerInspection: parseJsonOutput(containerResult, 'Backup restore container'),
    volumeInspection: parseJsonOutput(volumeResult, 'Backup restore volume'),
  });
};
const writeExclusive = async (file, value) => {
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    .catch((error) => {
      if (error?.code === 'EEXIST') refuse('E_ALREADY_EXISTS', `Refusing to replace ${file}.`);
      throw error;
    });
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.chmod(0o600);
    await handle.sync();
  } finally { await handle.close(); }
  const directory = await open(path.dirname(file), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
};
const assertOutputsAbsent = async () => {
  const absent = await Promise.all([OUTPUT, NETWORK_PROOF].map(async (file) => {
    try { await lstat(file); return false; }
    catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
  }));
  if (!absent.every(Boolean)) refuse('E_ALREADY_EXISTS', 'Activation evidence output already exists.');
};

async function collect() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    refuse('E_ROOT', 'Activation evidence collection requires Linux root.');
  }
  await assertOutputsAbsent();
  const planDocument = await readSecureJson(COLLECTION_PLAN);
  const collectionPlan = validateCollectionPlan(planDocument.value);
  const documents = {};
  for (const [key, file] of Object.entries(collectionPlan.files)) {
    documents[key] = await readSecureJson(file);
  }
  const cutoverPlan = validateCutoverPlan(documents.cutoverPlan.value);
  const deploymentPlan = validateDeploymentPlan(documents.deploymentPlan.value);
  const releaseRoot = `/opt/easyfire-bookkeeping/releases/${deploymentPlan.releaseCommit}`;
  const executablePath = `${releaseRoot}/scripts/production/linux-activation-evidence-collect.mjs`;
  const actualExecutable = await realpath(process.argv[1]);
  if (actualExecutable !== executablePath) refuse('E_EXECUTOR_PATH', 'Collector is not running from the immutable release.');
  const executableDocument = await readFile(executablePath);
  if (sha256(executableDocument) !== cutoverPlan.controller.activationEvidenceCollectorSha256) {
    refuse('E_EXECUTOR_HASH', 'Collector hash is not cutover-plan-bound.');
  }
  await assertSecureFile(executablePath, 0o644);
  const releaseManifestPath = `${releaseRoot}/release-manifest.json`;
  const releaseManifestDocument = await readSecureJson(releaseManifestPath, 0o644);
  const releaseManifest = parseManifestBoundRelease(releaseManifestDocument.value);
  const artifact = releaseManifest.artifacts.find(({ path: artifactPath }) =>
    artifactPath === 'scripts/production/linux-activation-evidence-collect.mjs');
  if (
    releaseManifest.releaseCommit !== deploymentPlan.releaseCommit ||
    sha256(releaseManifestDocument.bytes) !== deploymentPlan.releaseManifest.sha256 ||
    !artifact || artifact.sha256 !== sha256(executableDocument) ||
    artifact.bytes !== executableDocument.length || artifact.mode !== '0644'
  ) {
    refuse('E_EXECUTOR_HASH', 'Collector is not an exact release-manifest artifact.');
  }
  const rehearsalProof = validateRehearsalEvidence(
    documents.rehearsalEvidence.value,
  );
  const authenticationProof = validateNativeAuthenticationProof(
    documents.authentication.value,
  );
  const rehearsalArtifact = releaseManifest.artifacts.find(
    ({ path: artifactPath }) =>
      artifactPath === 'scripts/production/linux-rehearsal-evidence.mjs',
  );
  const authenticationArtifact = releaseManifest.artifacts.find(
    ({ path: artifactPath }) =>
      artifactPath === 'scripts/production/linux-native-auth-proof.mjs',
  );
  if (
    !rehearsalArtifact || rehearsalArtifact.mode !== '0644' ||
    rehearsalProof.release.collectorSha256 !== rehearsalArtifact.sha256 ||
    !authenticationArtifact || authenticationArtifact.mode !== '0644' ||
    authenticationProof.collector.executableSha256 !== authenticationArtifact.sha256
  ) refuse('E_PROOF_EXECUTOR', 'Rehearsal or authentication proof executor is not manifest-bound.');
  const deploymentController = `${releaseRoot}/scripts/production/linux-deploy-candidate.mjs`;
  const deploymentReadback = parseJsonOutput(await run(NODE, [
    deploymentController, '--verify-existing', '--plan', collectionPlan.files.deploymentPlan,
  ], 'Deployment verification'), 'Deployment verification');
  if (
    deploymentReadback.ok !== true ||
    deploymentReadback.mode !== 'verify-existing' ||
    deploymentReadback.deploymentId !== deploymentPlan.deploymentId ||
    deploymentReadback.releaseCommit !== deploymentPlan.releaseCommit
  ) refuse('E_DEPLOYMENT_PROOF', 'Deployment live verification result is invalid.');

  const [versionResult, statusResult, serveResult, funnelResult, listenersResult, stackResult, timerActiveResult, timerEnabledResult] = await Promise.all([
    run(TAILSCALE, ['version'], 'Tailscale version'),
    run(TAILSCALE, ['status', '--json'], 'Tailscale status'),
    run(TAILSCALE, ['serve', 'status', '--json'], 'Tailscale Serve status'),
    run(TAILSCALE, ['funnel', 'status', '--json'], 'Tailscale Funnel status'),
    run(SS, ['-H', '-ltn'], 'Host listener status'),
    run(SYSTEMCTL, ['is-active', 'easyfire-bookkeeping-stack.service'], 'Stack unit readback'),
    run(SYSTEMCTL, ['is-active', 'easyfire-bookkeeping-guardian.timer'], 'Guardian timer active readback'),
    run(SYSTEMCTL, ['is-enabled', 'easyfire-bookkeeping-guardian.timer'], 'Guardian timer enabled readback'),
  ]);
  validateTailscaleVersion(versionResult.stdout.toString('utf8'));
  const networkReadback = validatePreActivationNetwork({
    tailscaleStatus: parseJsonOutput(statusResult, 'Tailscale status'),
    serveStatus: parseJsonOutput(serveResult, 'Tailscale Serve status'),
    funnelStatus: parseJsonOutput(funnelResult, 'Tailscale Funnel status'),
    listeningPorts: parseListeningPorts(listenersResult.stdout.toString('utf8')),
  });
  const networkProof = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-pre-activation-network-proof',
    status: 'private-unrouted',
    collectedAt: new Date().toISOString(),
    tailscaleVersion: '1.98.9',
    statusSha256: sha256(statusResult.stdout),
    serveStatusSha256: sha256(serveResult.stdout),
    funnelStatusSha256: sha256(funnelResult.stdout),
    listenersSha256: sha256(listenersResult.stdout),
    serveAbsent: networkReadback.serveAbsent,
    funnelAbsent: networkReadback.funnelAbsent,
    publicExposure: false,
  };
  const networkBytes = Buffer.from(`${JSON.stringify(networkProof, null, 2)}\n`);
  const hashes = Object.fromEntries(Object.entries(documents).map(([key, document]) => [key, sha256(document.bytes)]));
  hashes.network = sha256(networkBytes);
  const collector = {
    schemaVersion: 1,
    kind: 'easyfire-bookkeeping-release-bound-activation-evidence-collector',
    sourceReleasePath: releaseRoot,
    executablePath,
    executableSha256: sha256(executableDocument),
    releaseManifestSha256: sha256(releaseManifestDocument.bytes),
    collectionPlanSha256: sha256(planDocument.bytes),
    outputPath: OUTPUT,
    outputPublishedCreateNew: true,
    secureFilesVerified: true,
    semanticProofsVerified: true,
    liveReadbacksVerified: true,
  };
  const evidence = buildActivationEvidence({
    collectionPlan,
    cutoverPlan: documents.cutoverPlan.value,
    sourceReceipt: documents.sourceQuiesceReceipt.value,
    checkpointBinding: documents.checkpointBinding.value,
    checkpointManifest: documents.checkpointManifest.value,
    deploymentPlan: documents.deploymentPlan.value,
    deploymentReceipt: documents.deploymentReceipt.value,
    backupReceipt: documents.backupReceipt.value,
    backupComplete: documents.backupComplete.value,
    rehearsalEvidence: documents.rehearsalEvidence.value,
    guardianPromotion: documents.guardianPromotion.value,
    guardianShadowConfig: documents.guardianShadowConfig.value,
    guardianConfig: documents.guardianConfig.value,
    authenticationProof: documents.authentication.value,
    network: {
      backendState: networkReadback.tailscaleStatus.BackendState,
      selfOnline: networkReadback.tailscaleStatus.Self.Online,
      dnsName: networkReadback.tailscaleStatus.Self.DNSName,
      serveAbsent: true,
      funnelAbsent: true,
      publicExposure: false,
      publicListeners: [],
    },
    live: {
      deploymentVerified: true,
      stackActive: stackResult.stdout.toString('utf8').trim() === 'active',
      guardianTimerActive: timerActiveResult.stdout.toString('utf8').trim() === 'active',
      guardianTimerEnabled: timerEnabledResult.stdout.toString('utf8').trim() === 'enabled',
      guardianConfigMode: 'root:root-0600',
    },
    hashes: {
      cutoverPlan: hashes.cutoverPlan,
      sourceReceipt: hashes.sourceQuiesceReceipt,
      checkpointBinding: hashes.checkpointBinding,
      checkpointManifest: hashes.checkpointManifest,
      deploymentPlan: hashes.deploymentPlan,
      deploymentReceipt: hashes.deploymentReceipt,
      backupReceipt: hashes.backupReceipt,
      backupComplete: hashes.backupComplete,
      rehearsalEvidence: hashes.rehearsalEvidence,
      guardianPromotion: hashes.guardianPromotion,
      guardianShadowConfig: hashes.guardianShadowConfig,
      guardianConfig: hashes.guardianConfig,
      authentication: hashes.authentication,
      network: hashes.network,
    },
    collector,
    collectedAt: new Date().toISOString(),
  });
  await revalidateBackupArtifacts(collectionPlan.files.backupReceipt, documents.backupReceipt.value);
  await revalidateBackupRestoreState(documents.backupReceipt.value);
  await writeExclusive(NETWORK_PROOF, networkProof);
  await writeExclusive(OUTPUT, evidence);
  return evidence;
}

async function runCli() {
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['--collect', '--plan', COLLECTION_PLAN, '--output', OUTPUT])) {
    refuse('E_USAGE', 'Use the exact fixed activation-evidence collection command.');
  }
  const evidence = await collect();
  process.stdout.write(`${JSON.stringify({ status: evidence.status, output: OUTPUT })}\n`);
}

if (await isCanonicalMainModule(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.code ?? 'E_ACTIVATION_EVIDENCE'}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
