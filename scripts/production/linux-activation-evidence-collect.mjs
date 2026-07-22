#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  validateGuardianRehearsalProofs,
} from './linux-guardian-promote-active.mjs';
import {
  validateCheckpointManifest,
  validateDeploymentPlan,
} from './linux-deploy-plan.mjs';
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
const TAILSCALE = '/usr/bin/tailscale';
const SS = '/usr/bin/ss';
const SYSTEMCTL = '/usr/bin/systemctl';
const MAX_FILE = 4 * 1024 * 1024;
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
  reboot: '/etc/easyfire-bookkeeping/activation-proof/reboot.json',
  recovery: '/etc/easyfire-bookkeeping/activation-proof/recovery.json',
  guardianShadow: '/etc/easyfire-bookkeeping/guardian-proof/shadow.json',
  guardianActive: '/etc/easyfire-bookkeeping/guardian-proof/active-disposable.json',
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
    'backupReceipt', 'backupComplete', 'rollbackArmed', 'rollbackRearm',
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
  const rollback = /^\/etc\/easyfire-bookkeeping\/rollback-evidence\/rehearsals\/([^/]+)\/([a-f0-9-]+)\/armed\.json$/.exec(plan.files.rollbackArmed);
  if (!rollback || plan.files.rollbackRearm !== `${path.dirname(plan.files.rollbackArmed)}/rearm-complete.json`) {
    refuse('E_PATH', 'Activation rollback rehearsal paths are invalid.');
  }
  return plan;
}

const CHRONOLOGY_KEYS = Object.freeze([
  'cutoverPlanCreatedAt', 'sourceQuiescedAt', 'checkpointCreatedAt',
  'deploymentCompletedAt', 'backupCompletedAt', 'rollbackArmedAt',
  'rollbackLockedRebootVerifiedAt', 'rollbackRearmedAt', 'recoveryCompletedAt',
  'guardianShadowCompletedAt', 'guardianActiveCompletedAt', 'guardianPromotedAt',
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
    ['deploymentCompletedAt', 'rollbackArmedAt'],
    ['rollbackArmedAt', 'rollbackLockedRebootVerifiedAt'],
    ['rollbackLockedRebootVerifiedAt', 'rollbackRearmedAt'],
    ['deploymentCompletedAt', 'recoveryCompletedAt'],
    ['deploymentCompletedAt', 'guardianShadowCompletedAt'],
    ['guardianShadowCompletedAt', 'guardianActiveCompletedAt'],
    ['guardianActiveCompletedAt', 'guardianPromotedAt'],
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
  if (
    source.deploymentId !== authority.deploymentId ||
    source.releaseCommit !== authority.releaseCommit ||
    source.checkpointManifestSha256 !== authority.checkpointManifestSha256 ||
    source.deploymentPlanSha256 !== authority.deploymentPlanSha256 ||
    source.deploymentReceiptSha256 !== authority.deploymentReceiptSha256
  ) refuse('E_BACKUP_PROOF', 'Backup source authority is not deployment-bound.');
  for (const value of Object.values(source)) {
    if (typeof value === 'string' && value.endsWith(authority.releaseCommit)) continue;
    if (typeof value === 'string' && !SHA.test(value) && value !== authority.deploymentId && value !== authority.releaseCommit) {
      refuse('E_BACKUP_PROOF', 'Backup source authority contains an invalid value.');
    }
  }
  if (
    receipt.restoreProof?.network !== 'none' ||
    receipt.restoreProof?.state !== 'stopped-preserved' ||
    receipt.restoreProof?.consistency !== 'mariadb-single-transaction' ||
    receipt.restoreProof?.credentials !== 'ephemeral-random-destroyed' ||
    receipt.validation?.schemaTableInventory?.exactMatch !== true ||
    receipt.validation?.schemaTableInventory?.baseTableEngine !== 'InnoDB' ||
    receipt.validation?.protectedAccountingCounts?.tableCount !== 37 ||
    receipt.validation?.applicationUserQueries !== true
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
    complete.receiptSha256 !== authority.backupReceiptSha256
  ) refuse('E_BACKUP_PROOF', 'Backup COMPLETE marker is not receipt-bound.');
  hash(complete.sha256ManifestSha256, 'Backup completion manifest hash');
  return receipt;
};

const validateRollback = (armed, rearm, authority) => {
  exactKeys(armed, [
    'schemaVersion', 'project', 'kind', 'status', 'lockId', 'reason',
    'completedAt', 'lockSha256', 'deployment', 'proof',
  ], 'Rollback armed receipt');
  if (
    armed.schemaVersion !== 1 ||
    armed.project !== 'easyfire-bookkeeping-prod' ||
    armed.kind !== 'easyfire-bookkeeping-rollback-armed-receipt' ||
    armed.status !== 'locked-verified' ||
    armed.reason !== 'rehearsal' ||
    armed.deployment?.deploymentId !== authority.deploymentId ||
    armed.deployment?.releaseCommit !== authority.releaseCommit ||
    armed.deployment?.planSha256 !== authority.deploymentPlanSha256 ||
    armed.deployment?.deploymentReceiptSha256 !== authority.deploymentReceiptSha256 ||
    armed.proof?.migrationExitCode !== 0 ||
    armed.proof?.resourcesPreserved !== true ||
    JSON.stringify(armed.proof?.absentListeners) !== JSON.stringify([443, 8080])
  ) refuse('E_ROLLBACK_PROOF', 'Rollback armed receipt is incomplete or unbound.');
  timestamp(armed.completedAt, 'Rollback armed completedAt');
  hash(armed.lockSha256, 'Rollback lock hash');
  exactKeys(rearm, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'lockId',
    'deployment', 'guardianRemainsStopped', 'tailscaleRemainsDisabled',
    'resourcesPreserved',
  ], 'Rollback rearm completion');
  if (
    rearm.schemaVersion !== 1 ||
    rearm.project !== 'easyfire-bookkeeping-prod' ||
    rearm.kind !== 'easyfire-bookkeeping-rearm-completion' ||
    rearm.status !== 'deployment-verified' ||
    rearm.lockId !== armed.lockId ||
    JSON.stringify(rearm.deployment) !== JSON.stringify(armed.deployment) ||
    rearm.guardianRemainsStopped !== true ||
    rearm.tailscaleRemainsDisabled !== true ||
    rearm.resourcesPreserved !== true
  ) refuse('E_ROLLBACK_PROOF', 'Rollback rearm completion is incomplete or mixed.');
  timestamp(rearm.completedAt, 'Rollback rearm completedAt');
  return { armed, rearm };
};

const validateRebootRecovery = (reboot, recovery, authority) => {
  exactKeys(reboot, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'deploymentId',
    'releaseCommit', 'checkpointManifestSha256', 'bootIdBefore', 'bootIdAfter',
    'stackActive', 'stackAuthorityVerified', 'guardianTimerActive',
    'rollbackLockedRebootVerified',
  ], 'Reboot proof');
  exactKeys(recovery, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'deploymentId',
    'releaseCommit', 'dockerRestartRecoveryPassed', 'daemonFailureRecoveryPassed',
    'invalidReceiptBootRefused', 'disposableOnly', 'productionDataMutationCount',
  ], 'Recovery proof');
  if (
    reboot.schemaVersion !== 1 ||
    recovery.schemaVersion !== 1 ||
    reboot.project !== 'easyfire-bookkeeping' ||
    recovery.project !== 'easyfire-bookkeeping' ||
    reboot.kind !== 'easyfire-bookkeeping-reboot-proof' ||
    recovery.kind !== 'easyfire-bookkeeping-recovery-rehearsal-proof' ||
    reboot.status !== 'passed' ||
    recovery.status !== 'passed' ||
    reboot.deploymentId !== authority.deploymentId ||
    recovery.deploymentId !== authority.deploymentId ||
    reboot.releaseCommit !== authority.releaseCommit ||
    recovery.releaseCommit !== authority.releaseCommit ||
    reboot.checkpointManifestSha256 !== authority.checkpointManifestSha256 ||
    reboot.bootIdBefore === reboot.bootIdAfter ||
    reboot.stackActive !== true ||
    reboot.stackAuthorityVerified !== true ||
    reboot.guardianTimerActive !== true ||
    reboot.rollbackLockedRebootVerified !== true ||
    recovery.dockerRestartRecoveryPassed !== true ||
    recovery.daemonFailureRecoveryPassed !== true ||
    recovery.invalidReceiptBootRefused !== true ||
    recovery.disposableOnly !== true ||
    recovery.productionDataMutationCount !== 0
  ) refuse('E_RECOVERY_PROOF', 'Reboot/recovery proof is incomplete or unbound.');
  timestamp(reboot.completedAt, 'Reboot proof completedAt');
  timestamp(recovery.completedAt, 'Recovery proof completedAt');
  return { reboot, recovery };
};

const validateGuardianPromotion = ({ shadow, active, promotion, shadowConfig, productionConfig }, authority, hashes) => {
  validateGuardianConfig(shadowConfig, true);
  validateGuardianConfig(productionConfig, false);
  validateGuardianRehearsalProofs({
    shadowProof: shadow,
    activeProof: active,
    shadowConfigSha256: hashes.guardianShadowConfig,
    activeConfigSha256: hashes.guardianConfig,
  });
  exactKeys(promotion, [
    'schemaVersion', 'project', 'kind', 'status', 'promotedAt', 'deploymentId',
    'releaseCommit', 'executablePath', 'executableSha256',
    'releaseManifestSha256', 'cutoverPlanSha256', 'deploymentPlanSha256',
    'shadowConfigPath', 'shadowConfigSha256',
    'productionConfigPath', 'productionConfigSha256', 'shadowProofSha256',
    'activeProofSha256', 'timerWasInactive', 'timerActivationPerformed',
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
    promotion.shadowConfigPath !== '/etc/easyfire-bookkeeping/guardian.shadow.json' ||
    promotion.productionConfigPath !== '/etc/easyfire-bookkeeping/guardian.json' ||
    promotion.shadowConfigSha256 !== hashes.guardianShadowConfig ||
    promotion.productionConfigSha256 !== hashes.guardianConfig ||
    promotion.shadowProofSha256 !== hashes.guardianShadow ||
    promotion.activeProofSha256 !== hashes.guardianActive ||
    promotion.timerWasInactive !== true ||
    promotion.timerActivationPerformed !== false ||
    promotion.resourcesDeleted !== false
  ) refuse('E_GUARDIAN_PROOF', 'Guardian active-promotion proof is incomplete or unbound.');
  timestamp(promotion.promotedAt, 'Guardian promotion time');
  return { shadow, active, promotion };
};

const validateAuthentication = (proof, authority) => {
  exactKeys(proof, [
    'schemaVersion', 'project', 'kind', 'status', 'completedAt', 'deploymentId',
    'releaseCommit', 'checkpointManifestSha256', 'method', 'ownerConfirmed',
    'authenticatedPagePassed', 'accountingDataValidated',
    'secretMaterialPersisted',
  ], 'Authentication proof');
  if (
    proof.schemaVersion !== 1 ||
    proof.project !== 'easyfire-bookkeeping' ||
    proof.kind !== 'easyfire-bookkeeping-native-authentication-proof' ||
    proof.status !== 'passed' ||
    proof.deploymentId !== authority.deploymentId ||
    proof.releaseCommit !== authority.releaseCommit ||
    proof.checkpointManifestSha256 !== authority.checkpointManifestSha256 ||
    proof.method !== 'native-password' ||
    proof.ownerConfirmed !== true ||
    proof.authenticatedPagePassed !== true ||
    proof.accountingDataValidated !== true ||
    proof.secretMaterialPersisted !== false
  ) refuse('E_AUTH_PROOF', 'Native authentication proof is incomplete or unbound.');
  timestamp(proof.completedAt, 'Authentication proof completedAt');
  return proof;
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
  rollbackArmed,
  rollbackRearm,
  rebootProof,
  recoveryProof,
  guardianShadowProof,
  guardianActiveProof,
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
  };
  if (
    binding.checkpoint.manifestSha256 !== hashes.checkpointManifest ||
    deployment.checkpoint.manifestSha256 !== hashes.checkpointManifest
  ) refuse('E_BINDING', 'Checkpoint binding and deployment checkpoint differ.');
  validateBackup(backupReceipt, backupComplete, authority);
  const rollback = validateRollback(rollbackArmed, rollbackRearm, authority);
  const recovery = validateRebootRecovery(rebootProof, recoveryProof, authority);
  const guardian = validateGuardianPromotion({
    shadow: guardianShadowProof,
    active: guardianActiveProof,
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
    rollbackArmedAt: rollback.armed.completedAt,
    rollbackLockedRebootVerifiedAt: recovery.reboot.completedAt,
    rollbackRearmedAt: rollback.rearm.completedAt,
    recoveryCompletedAt: recovery.recovery.completedAt,
    guardianShadowCompletedAt: guardian.shadow.completedAt,
    guardianActiveCompletedAt: guardian.active.completedAt,
    guardianPromotedAt: guardian.promotion.promotedAt,
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
      rollback: {
        reason: rollback.armed.reason,
        armedReceiptSha256: hashes.rollbackArmed,
        rearmCompletionSha256: hashes.rollbackRearm,
        lockedRebootVerified: recovery.reboot.rollbackLockedRebootVerified,
        rearmedDeploymentVerified: rollback.rearm.status === 'deployment-verified',
        resourcesPreserved: rollback.rearm.resourcesPreserved,
        deploymentId: authority.deploymentId,
      },
      reboot: {
        bootIdBefore: recovery.reboot.bootIdBefore,
        bootIdAfter: recovery.reboot.bootIdAfter,
        stackActive: live.stackActive,
        stackAuthorityVerified: recovery.reboot.stackAuthorityVerified,
        guardianTimerActive: live.guardianTimerActive,
        dockerRestartRecoveryPassed: recovery.recovery.dockerRestartRecoveryPassed,
        daemonFailureRecoveryPassed: recovery.recovery.daemonFailureRecoveryPassed,
        invalidReceiptBootRefused: recovery.recovery.invalidReceiptBootRefused,
      },
      guardian: {
        status: 'passed',
        shadowRehearsalPassed: guardian.shadow.healthyObservationsPassed,
        statelessRecoveryPassed: guardian.active.statelessRecoveryPassed,
        databaseAutoRecoveryRefused: guardian.active.databaseAutoRecoveryRefused,
        identityMismatchRefused: guardian.active.identityMismatchRefused,
        activeModeEnabled: true,
        healthyAfterRehearsal: guardian.active.healthyAfterRehearsal,
        shadowConfigSha256: hashes.guardianShadowConfig,
        productionConfigSha256: hashes.guardianConfig,
        promotionReceiptSha256: hashes.guardianPromotion,
        promotionExecutableSha256: cutover.controller.guardianPromotionSha256,
        productionConfigMode: live.guardianConfigMode,
        shadowMode: false,
        timerActive: live.guardianTimerActive,
      },
      authentication: {
        status: authentication.status,
        method: authentication.method,
        ownerConfirmed: authentication.ownerConfirmed,
        authenticatedPagePassed: authentication.authenticatedPagePassed,
        accountingDataValidated: authentication.accountingDataValidated,
      },
      network,
    },
    proofFiles: {
      checkpointManifest: hashes.checkpointManifest,
      deploymentReceipt: hashes.deploymentReceipt,
      backupReceipt: hashes.backupReceipt,
      backupComplete: hashes.backupComplete,
      rollbackArmed: hashes.rollbackArmed,
      rollbackRearm: hashes.rollbackRearm,
      reboot: hashes.reboot,
      recovery: hashes.recovery,
      guardian: hashes.guardianActive,
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
};

async function collect() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    refuse('E_ROOT', 'Activation evidence collection requires Linux root.');
  }
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
    rollbackArmed: documents.rollbackArmed.value,
    rollbackRearm: documents.rollbackRearm.value,
    rebootProof: documents.reboot.value,
    recoveryProof: documents.recovery.value,
    guardianShadowProof: documents.guardianShadow.value,
    guardianActiveProof: documents.guardianActive.value,
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
      rollbackArmed: hashes.rollbackArmed,
      rollbackRearm: hashes.rollbackRearm,
      reboot: hashes.reboot,
      recovery: hashes.recovery,
      guardianShadow: hashes.guardianShadow,
      guardianActive: hashes.guardianActive,
      guardianPromotion: hashes.guardianPromotion,
      guardianShadowConfig: hashes.guardianShadowConfig,
      guardianConfig: hashes.guardianConfig,
      authentication: hashes.authentication,
      network: hashes.network,
    },
    collector,
    collectedAt: new Date().toISOString(),
  });
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.code ?? 'E_ACTIVATION_EVIDENCE'}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
