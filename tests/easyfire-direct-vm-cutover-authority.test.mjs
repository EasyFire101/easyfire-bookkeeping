import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import * as contract from '../scripts/production/direct-vm-cutover-contract.mjs';
import * as abort from '../scripts/production/direct-vm-source-abort-contract.mjs';
import * as collector from '../scripts/production/linux-activation-evidence-collect.mjs';
import * as guardian from '../scripts/production/linux-guardian-promote-active.mjs';
import * as route from '../scripts/production/linux-private-route-activate.mjs';

const root = resolve(import.meta.dirname, '..');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const digest = (character) => character.repeat(64);
const image = (character) => `sha256:${digest(character)}`;

const containerNames = [
  ['mysql', 'data', 'easyfire-mysql'],
  ['redis', 'data', 'easyfire-redis'],
  ['gotenberg', 'stateless', 'easyfire-gotenberg'],
  ['proxy', 'stateless', 'easyfire-proxy'],
  ['webapp', 'stateless', 'easyfire-webapp'],
  ['server', 'stateless', 'easyfire-owner-onboarding-ca845969f4b2'],
  ['onboarding-web', 'stateless', 'easyfire-owner-onboarding-web-0b7d1af8'],
  ['onboarding-gateway', 'stateless', 'easyfire-owner-onboarding-gateway-v2-0b7d1af8'],
];

function initialSnapshot() {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-source-snapshot',
    phase: 'pre-quiesce',
    capturedAt: '2026-07-21T20:00:00.000Z',
    host: 'NEWSEC',
    docker: {
      id: digest('a'),
      name: 'docker-desktop',
      serverVersion: '29.6.2',
      osType: 'linux',
      architecture: 'x86_64',
      dockerRootDir: '/var/lib/docker',
    },
    containers: containerNames.map(([role, tier, name], index) => ({
      role,
      tier,
      name,
      id: digest('123456789abcdef0'[index]),
      imageId: image('abcdef0123456789'[index]),
      imageReference: `example/${role}:pinned`,
      composeProject: 'easyfire-bookkeeping-prod',
      composeService: role,
      restartPolicy: 'unless-stopped',
      maximumRetryCount: 0,
      running: true,
      state: 'running',
      health: 'healthy',
      mounts: role === 'mysql'
        ? [{ type: 'volume', source: 'easyfire_prod_mysql', destination: '/var/lib/mysql', readOnly: false }]
        : role === 'redis'
          ? [{ type: 'volume', source: 'easyfire_prod_redis', destination: '/data', readOnly: false }]
          : [],
      networks: ['easyfire-bookkeeping-prod_default'],
      publishedPorts: role === 'proxy'
        ? [{ containerPort: 80, hostIp: '127.0.0.1', hostPort: 25180, protocol: 'tcp' }]
        : [],
    })),
    volumes: [
      {
        role: 'mysql',
        name: 'easyfire_prod_mysql',
        driver: 'local',
        scope: 'local',
        composeProject: 'easyfire-bookkeeping-prod',
        composeVolume: 'mysql',
        consumers: [digest('1')],
      },
      {
        role: 'redis',
        name: 'easyfire_prod_redis',
        driver: 'local',
        scope: 'local',
        composeProject: 'easyfire-bookkeeping-prod',
        composeVolume: 'redis',
        consumers: [digest('2')],
      },
    ],
    scheduledTasks: [
      {
        name: 'easyfire-bookkeeping-prod-backup',
        taskPath: '\\',
        enabled: true,
        state: 'Ready',
        xmlSha256: digest('b'),
        executable: 'powershell.exe',
        argumentsSha256: digest('c'),
        workingDirectory: 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping',
        principalUserId: 'SYSTEM',
        logonType: 'ServiceAccount',
        runLevel: 'Highest',
      },
      {
        name: 'easyfire-bookkeeping-prod-startup',
        taskPath: '\\',
        enabled: true,
        state: 'Ready',
        xmlSha256: digest('d'),
        executable: 'powershell.exe',
        argumentsSha256: digest('e'),
        workingDirectory: 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping',
        principalUserId: 'SYSTEM',
        logonType: 'ServiceAccount',
        runLevel: 'Highest',
      },
    ],
    tunnel: {
      serviceName: 'EasyFireBookkeepingCloudflared',
      state: 'Running',
      startMode: 'Auto',
      processId: 4242,
      executablePath: 'C:\\Program Files\\cloudflared\\cloudflared.exe',
      executableSha256: digest('f'),
      commandLineSha256: digest('1'),
      processPresent: true,
    },
    privateRoute: {
      kind: 'listener-process',
      processId: 4343,
      executablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      executableSha256: digest('2'),
      commandLineSha256: digest('3'),
      listenerAddress: '100.84.66.30',
      listenerPort: 25186,
      processPresent: true,
      listenerPresent: true,
    },
    endpoint: {
      uri: 'http://100.84.66.30:25186/',
      reachable: true,
      listenerProcessId: 4343,
    },
    writerProof: null,
  };
}

function planFixture() {
  const snapshot = initialSnapshot();
  const releaseCommit = '8'.repeat(40);
  const releaseRoot = `C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\releases\\${releaseCommit}`;
  const productionRoot = `${releaseRoot}\\scripts\\production`;
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-direct-vm-cutover-plan',
    cutoverId: '9fa796ac-6c7b-4ace-b811-73af8553bb4e',
    createdAt: '2026-07-21T20:01:00.000Z',
    source: {
      host: 'NEWSEC',
      composeProject: 'easyfire-bookkeeping-prod',
      expectedInitialSnapshot: snapshot,
      mysqlContainerId: snapshot.containers[0].id,
      redisContainerId: snapshot.containers[1].id,
      mysqlVolume: 'easyfire_prod_mysql',
      redisVolume: 'easyfire_prod_redis',
    },
    controller: {
      releaseCommit,
      releaseManifestPath: `${releaseRoot}\\release-manifest.json`,
      releaseManifestSha256: digest('d'),
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      nodeSha256: digest('4'),
      contractPath: `${productionRoot}\\direct-vm-cutover-contract.mjs`,
      contractSha256: digest('5'),
      sourceControllerPath: `${productionRoot}\\direct-vm-cutover-authority.ps1`,
      sourceControllerSha256: digest('6'),
      checkpointControllerPath: `${productionRoot}\\direct-vm-preflight-checkpoint.ps1`,
      checkpointControllerSha256: digest('7'),
      checkpointV2ContractPath: `${productionRoot}\\direct-vm-checkpoint-v2-contract.mjs`,
      checkpointV2ContractSha256: digest('9'),
      finalQuiescenceContractPath: `${productionRoot}\\linux-final-quiescence-contract.mjs`,
      finalQuiescenceContractSha256: digest('a'),
      activationEvidenceCollectorPath: `${productionRoot}\\linux-activation-evidence-collect.mjs`,
      activationEvidenceCollectorSha256: digest('b'),
      guardianPromotionPath: `${productionRoot}\\linux-guardian-promote-active.mjs`,
      guardianPromotionSha256: digest('c'),
      abortContractPath: `${productionRoot}\\direct-vm-source-abort-contract.mjs`,
      abortContractSha256: digest('8'),
      privateLauncherPath: 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\incoming\\launch-private-proxy-v2-0b7d1af8.ps1',
      privateLauncherSha256: 'f90e275d1b941d554a15a0e8e5c2f6af7b6412033fcfa45d7e85939351a44130',
      privateLauncherChildSha256: '1adac5341abea3e496cf9c015b68562781d34bb985fb64d8317f6832ad1bd0b9',
    },
    evidence: {
      root: 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\direct-vm-cutover',
      authorityOwnerSid: 'S-1-5-21-111111111-222222222-333333333-1001',
      sourceQuiesceReceiptGuestPath: '/etc/easyfire-bookkeeping/source-quiesce-receipt.json',
      checkpointBindingGuestPath: '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json',
      activationEvidenceGuestPath: '/etc/easyfire-bookkeeping/cutover-evidence.json',
      activationAuthorizationGuestPath: '/etc/easyfire-bookkeeping/cutover-authorization.json',
    },
    target: {
      vmName: 'easyfire-bookkeeping-newsec',
      tailscaleDnsName: 'easyfire-bookkeeping-newsec.taild63e9b.ts.net',
      tailscaleOrigin: 'http://127.0.0.1:8080',
      authorizationMaxAgeSeconds: 900,
    },
  };
}

function postSnapshot(plan) {
  const snapshot = structuredClone(plan.source.expectedInitialSnapshot);
  snapshot.phase = 'post-quiesce';
  snapshot.capturedAt = '2026-07-21T20:05:00.000Z';
  for (const container of snapshot.containers) {
    if (container.tier === 'stateless') {
      container.restartPolicy = 'no';
      container.running = false;
      container.state = 'exited';
      container.health = 'none';
    }
  }
  for (const task of snapshot.scheduledTasks) {
    task.enabled = false;
    task.state = 'Disabled';
  }
  snapshot.tunnel.state = 'Stopped';
  snapshot.tunnel.startMode = 'Disabled';
  snapshot.tunnel.processPresent = false;
  snapshot.tunnel.processId = 0;
  snapshot.privateRoute.processPresent = false;
  snapshot.privateRoute.listenerPresent = false;
  snapshot.endpoint.reachable = false;
  snapshot.endpoint.listenerProcessId = 0;
  snapshot.writerProof = {
    applicationContainersRunning: 0,
    mysqlNonSystemConnections: 0,
    mysqlEventScheduler: 'OFF',
    mysqlEnabledEvents: 0,
    redisExternalClients: 0,
  };
  return snapshot;
}

function quiesceReceipt(plan) {
  const before = initialSnapshot();
  const after = postSnapshot(plan);
  return contract.buildSourceQuiesceReceipt({
    plan,
    planSha256: digest('b'),
    before,
    beforeSha256: hash(JSON.stringify(before)),
    after,
    afterSha256: hash(JSON.stringify(after)),
    completedAt: '2026-07-21T20:06:00.000Z',
  });
}

function activationEvidence(plan, sourceReceiptSha256) {
  const deploymentId = 'direct-vm-20260721-c9a090cb';
  const releaseCommit = digest('8').slice(0, 40);
  const deploymentPlanSha256 = digest('9');
  const checkpointManifestSha256 = digest('a');
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-direct-vm-activation-evidence',
    status: 'all-gates-passed',
    cutoverId: plan.cutoverId,
    collectedAt: '2026-07-21T20:10:00.000Z',
    chronology: {
      schemaVersion: 1,
      ordered: true,
      fresh: true,
      sourceQuiescedAt: '2026-07-21T20:06:00.000Z',
      deploymentCompletedAt: '2026-07-21T20:08:00.000Z',
      latestProofAt: '2026-07-21T20:09:30.000Z',
      collectedAt: '2026-07-21T20:10:00.000Z',
      maximumProofWindowSeconds: 86400,
    },
    collector: {
      schemaVersion: 1,
      kind: 'easyfire-bookkeeping-release-bound-activation-evidence-collector',
      sourceReleasePath: `/opt/easyfire-bookkeeping/releases/${releaseCommit}`,
      executablePath: `/opt/easyfire-bookkeeping/releases/${releaseCommit}/scripts/production/linux-activation-evidence-collect.mjs`,
      executableSha256: plan.controller.activationEvidenceCollectorSha256,
      releaseManifestSha256: digest('6'),
      collectionPlanSha256: digest('7'),
      outputPath: '/etc/easyfire-bookkeeping/cutover-evidence.json',
      outputPublishedCreateNew: true,
      secureFilesVerified: true,
      semanticProofsVerified: true,
      liveReadbacksVerified: true,
    },
    sourceQuiesce: {
      receiptSha256: sourceReceiptSha256,
      stillQuiesced: true,
    },
    checkpoint: {
      manifestVersion: 2,
      checkpointId: 'direct-vm-final-20260721-200600',
      checkpointCreatedAt: '2026-07-21T20:07:00.000Z',
      manifestSha256: checkpointManifestSha256,
      status: 'transfer-verified',
      sourceQuiesceReceiptSha256: sourceReceiptSha256,
      bindingReceiptSha256: digest('7'),
      dualLocationVerified: true,
      isolatedRestoreVerified: true,
      sqlGzipSha256: digest('c'),
      redisRdbSha256: digest('d'),
    },
    guest: {
      vmName: plan.target.vmName,
      deployment: {
        deploymentId,
        releaseCommit,
        planSha256: deploymentPlanSha256,
        checkpointManifestSha256,
        receiptSha256: digest('e'),
        status: 'complete',
        verifiedExisting: true,
      },
      backup: {
        receiptSha256: digest('f'),
        completeSha256: digest('1'),
        status: 'passed',
        isolatedRestoreVerified: true,
        restoreState: 'stopped-preserved',
        deploymentId,
        checkpointManifestSha256,
      },
      rollback: {
        reason: 'rehearsal',
        armedReceiptSha256: digest('2'),
        rearmCompletionSha256: digest('3'),
        lockedRebootVerified: true,
        rearmedDeploymentVerified: true,
        resourcesPreserved: true,
        deploymentId,
      },
      reboot: {
        bootIdBefore: '1516c5b2-3340-4c02-b9c4-7a340930088d',
        bootIdAfter: '53682154-c88d-48ee-9194-adac4790d8cc',
        stackActive: true,
        stackAuthorityVerified: true,
        guardianTimerActive: true,
        dockerRestartRecoveryPassed: true,
        daemonFailureRecoveryPassed: true,
        invalidReceiptBootRefused: true,
      },
      guardian: {
        status: 'passed',
        shadowRehearsalPassed: true,
        statelessRecoveryPassed: true,
        databaseAutoRecoveryRefused: true,
        identityMismatchRefused: true,
        activeModeEnabled: true,
        healthyAfterRehearsal: true,
        shadowConfigSha256: digest('4'),
        productionConfigSha256: digest('5'),
        promotionReceiptSha256: digest('6'),
        promotionExecutableSha256: plan.controller.guardianPromotionSha256,
        productionConfigMode: 'root:root-0600',
        shadowMode: false,
        timerActive: true,
      },
      authentication: {
        status: 'passed',
        method: 'native-password',
        ownerConfirmed: true,
        authenticatedPagePassed: true,
        accountingDataValidated: true,
      },
      network: {
        backendState: 'Running',
        selfOnline: true,
        dnsName: `${plan.target.tailscaleDnsName}.`,
        serveAbsent: true,
        funnelAbsent: true,
        publicExposure: false,
        publicListeners: [],
      },
    },
    proofFiles: Object.fromEntries(
      [
        'checkpointManifest',
        'deploymentReceipt',
        'backupReceipt',
        'backupComplete',
        'rollbackArmed',
        'rollbackRearm',
        'reboot',
        'recovery',
        'guardian',
        'guardianPromotion',
        'authentication',
        'network',
      ].map((name, index) => [name, digest('abcdef012345'[index])]),
    ),
  };
}

function checkpointV2(plan, receipt, receiptSha256, after, afterSha256) {
  const source = plan.source.expectedInitialSnapshot;
  const mysql = source.containers[0];
  const redis = source.containers[1];
  const payload = (name, character) => ({
    sourceRelativePath: `database/${name}`,
    fileName: name,
    bytes: 100,
    sha256: digest(character),
  });
  const file = (name, character) => ({
    sourceRelativePath: name,
    bytes: 100,
    sha256: digest(character),
  });
  return {
    schemaVersion: 2,
    authorityType: 'easyfire-bookkeeping-windows-checkpoint-transfer',
    status: 'verified',
    checkpointId: 'direct-vm-final-20260721-200600',
    checkpointTimestamp: '20260721-200600',
    checkpointCreatedAt: '2026-07-21T20:07:00.000Z',
    source: {
      host: 'NEWSEC',
      runtimePreservation: 'preserved',
      databaseNames: ['easyfire_system', 'easyfire_tenant_fixture'],
      mysql: {
        containerName: mysql.name,
        containerId: mysql.id,
        imageId: mysql.imageId,
        imageReference: mysql.imageReference,
        volumeName: 'easyfire_prod_mysql',
      },
      redis: {
        containerName: redis.name,
        containerId: redis.id,
        imageId: redis.imageId,
        imageReference: redis.imageReference,
        volumeName: 'easyfire_prod_redis',
      },
    },
    payloads: {
      sqlGzip: payload('final.sql.gz', 'c'),
      redisRdb: payload('final.rdb', 'd'),
    },
    isolatedRestore: {
      status: 'passed',
      proof: file('restore-proof/isolated-restore-proof.json', 'e'),
      network: 'none',
      state: 'stopped-preserved',
      restoreContainer: 'easyfire-direct-vm-restore-final',
      restoreVolume: 'easyfire_direct_vm_restore_final',
      systemTableCount: 17,
      tenantTableCount: 70,
      identityCounts: { users: 1, tenants: 1, tenantMetadata: 1, userTenants: 1 },
      mariadbCheckLineCount: 12,
    },
    verification: {
      originalCheckpoint: file('checkpoint.json', 'f'),
      fileManifest: {
        ...file('files.sha256.json', '1'),
        entryCount: 10,
        entryBytes: 1000,
      },
      restoreInstructions: file('direct-vm-checkpoint-RESTORE.md', '2'),
      dualLocation: {
        ...file('dual-location-verification.json', '3'),
        status: 'passed',
        verifiedAt: '2026-07-21T20:07:10.000Z',
        primary: 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\backups\\final',
        secondary: 'E:\\EasyFire Bookkeeping Recovery\\direct-vm-preflight\\final',
        fileCount: 12,
        totalBytes: 2000,
      },
      recoveryUnit: {
        ...file('recovery-unit-verification-v2.json', '4'),
        status: 'passed',
        verifiedAt: '2026-07-21T20:07:20.000Z',
        sourceRuntime: 'preserved',
      },
    },
    finalQuiescence: {
      schemaVersion: 1,
      mode: 'final-quiesced',
      cutoverId: plan.cutoverId,
      cutoverPlan: { bytes: 1000, sha256: digest('b') },
      quiesceReceipt: {
        sourceRelativePath: 'inputs/source-quiesce-receipt.json',
        bytes: 1000,
        sha256: receiptSha256,
        contentSha256: receipt.contentSha256,
        completedAt: receipt.completedAt,
        planSha256: receipt.planSha256,
        afterSnapshotSha256: receipt.afterSnapshotSha256,
      },
      sourceSnapshot: {
        bytes: 1000,
        sha256: afterSha256,
        phase: 'post-quiesce',
        capturedAt: after.capturedAt,
        writerProof: after.writerProof,
      },
      dataContainers: after.containers.filter(({ tier }) => tier === 'data').map((container, index) => ({
        role: container.role,
        name: container.name,
        containerId: container.id,
        imageId: container.imageId,
        imageReference: container.imageReference,
        volumeName: index === 0 ? plan.source.mysqlVolume : plan.source.redisVolume,
        restartPolicy: 'unless-stopped',
        running: true,
        health: 'healthy',
      })),
      statelessContainers: after.containers.filter(({ tier }) => tier === 'stateless').map((container) => ({
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
    },
  };
}

const guestContainerNames = [
  'easyfire-bookkeeping-envoy',
  'easyfire-bookkeeping-webapp',
  'easyfire-bookkeeping-server',
  'easyfire-bookkeeping-gotenberg',
  'easyfire-bookkeeping-mysql',
  'easyfire-bookkeeping-redis',
  'easyfire-bookkeeping-migration',
];

function guestIsolationEvidence(plan, sourceReceiptSha256, checkpointBindingSha256) {
  const deploymentPlanSha256 = digest('6');
  const deploymentReceiptSha256 = digest('7');
  const rollbackLockSha256 = digest('1');
  const rollbackArmedSha256 = digest('2');
  const decisionAuthoritySha256 = hash(contract.canonicalJson({
    cutoverPlanSha256: digest('0'),
    sourceReceiptSha256,
    checkpointBindingSha256,
    deploymentPlanSha256,
    deploymentReceiptSha256,
    rollbackLockSha256,
    rollbackArmedSha256,
    collectorExecutableSha256: plan.controller.abortContractSha256,
  }));
  const decisionClaim = route.buildCutoverDecisionClaim({
    decision: 'abort',
    cutoverId: plan.cutoverId,
    deploymentId: 'direct-vm-20260721-c9a090cb',
    releaseCommit: plan.controller.releaseCommit,
    authoritySha256: decisionAuthoritySha256,
    claimedAt: '2026-07-21T20:08:59.000Z',
  });
  const decisionClaimSha256 = hash(`${JSON.stringify(decisionClaim, null, 2)}\n`);
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-guest-pre-activation-isolation',
    status: 'locked-verified',
    cutoverId: plan.cutoverId,
    collectedAt: '2026-07-21T20:09:00.000Z',
    sourceQuiesceReceiptSha256: sourceReceiptSha256,
    checkpointBindingSha256,
    collector: {
      schemaVersion: 1,
      kind: 'easyfire-bookkeeping-release-bound-guest-isolation-collector',
      sourceReleasePath: `/opt/easyfire-bookkeeping/releases/${plan.controller.releaseCommit}`,
      executablePath: `/opt/easyfire-bookkeeping/releases/${plan.controller.releaseCommit}/scripts/production/direct-vm-source-abort-contract.mjs`,
      executableSha256: plan.controller.abortContractSha256,
      releaseManifestSha256: plan.controller.releaseManifestSha256,
      cutoverPlanSha256: digest('0'),
      deploymentPlanSha256,
      deploymentReceiptSha256,
      outputPath: '/etc/easyfire-bookkeeping/guest-pre-activation-isolation.json',
      decisionClaim: {
        path: '/etc/easyfire-bookkeeping/cutover-decision.json',
        sha256: decisionClaimSha256,
        decision: 'abort',
        claimedAt: '2026-07-21T20:08:59.000Z',
        authoritySha256: decisionAuthoritySha256,
      },
      outputPublishedCreateNew: true,
      rootOwnedSecureFilesVerified: true,
      liveRollbackVerificationPassed: true,
      liveReadbacksVerified: true,
    },
    guest: {
      vmName: 'easyfire-bookkeeping-newsec',
      deploymentId: 'direct-vm-20260721-c9a090cb',
      releaseCommit: plan.controller.releaseCommit,
      accountingDataAuthority: 'windows-final-checkpoint',
      firstUserWriteAuthority: {
        status: 'pre-activation-never-exposed',
        activationLockAbsent: true,
        authorizationAbsent: true,
        receiptAbsent: true,
        routeAbsent: true,
        cutoverDecision: 'abort',
        cutoverDecisionClaimSha256: decisionClaimSha256,
      },
      rollbackLock: {
        present: true,
        reason: 'rollback',
        path: '/etc/easyfire-bookkeeping/rollback.lock',
        lockSha256: rollbackLockSha256,
        receiptPath: `/etc/easyfire-bookkeeping/rollback-evidence/rollbacks/direct-vm-20260721-c9a090cb/123e4567-e89b-42d3-a456-426614174000/armed.json`,
        receiptSha256: rollbackArmedSha256,
      },
      containers: guestContainerNames.map((name, index) => ({
        name,
        id: digest('1234567'[index]),
        imageId: image('abcdef0'[index]),
        running: false,
        state: 'exited',
        restartPolicy: 'no',
      })),
      network: {
        tailscaleServeAbsent: true,
        tailscaleFunnelAbsent: true,
        targetRouteAbsent: true,
        originPort8080Absent: true,
        publicPort443Absent: true,
        publicListeners: [],
      },
      activation: {
        activationLockAbsent: true,
        authorizationAbsent: true,
        receiptAbsent: true,
      },
      preservation: {
        volumesPreserved: true,
        releasesPreserved: true,
        backupsPreserved: true,
        noResourcesDeleted: true,
      },
    },
    proofFiles: {
      cutoverPlan: digest('0'),
      sourceQuiesceReceipt: sourceReceiptSha256,
      checkpointBinding: checkpointBindingSha256,
      deploymentPlan: deploymentPlanSha256,
      deploymentReceipt: deploymentReceiptSha256,
      runtimeManifest: digest('8'),
      rollbackLock: rollbackLockSha256,
      rollbackArmed: rollbackArmedSha256,
      containerState: digest('3'),
      networkState: digest('4'),
      activationState: digest('5'),
      cutoverDecisionClaim: decisionClaimSha256,
      collectorExecutable: plan.controller.abortContractSha256,
      releaseManifest: plan.controller.releaseManifestSha256,
    },
  };
}

test('cutover plan requires the exact source, task, tunnel, and route allowlists', () => {
  const plan = planFixture();
  assert.equal(contract.validateCutoverPlan(plan).cutoverId, plan.cutoverId);
  assert.deepEqual(contract.SOURCE_CONTAINER_NAMES, containerNames.map((entry) => entry[2]));
  assert.deepEqual(contract.LEGACY_TASK_NAMES, [
    'easyfire-bookkeeping-prod-backup',
    'easyfire-bookkeeping-prod-startup',
  ]);

  for (const mutate of [
    (value) => value.source.expectedInitialSnapshot.containers.pop(),
    (value) => value.source.expectedInitialSnapshot.scheduledTasks[0].name = 'foreign-task',
    (value) => value.source.expectedInitialSnapshot.tunnel.serviceName = 'foreign-service',
    (value) => value.source.expectedInitialSnapshot.privateRoute.listenerPort = 443,
    (value) => value.controller.sourceControllerPath = resolve(root, 'scripts/production/direct-vm-cutover-authority.ps1'),
    (value) => value.controller.contractPath = value.controller.contractPath.replace('releases\\', 'checkout\\'),
    (value) => value.controller.guardianPromotionPath = value.controller.guardianPromotionPath.replace('linux-guardian-promote-active.mjs', 'linux-private-route-activate.mjs'),
    (value) => value.controller.releaseManifestPath = value.controller.releaseManifestPath.replace('release-manifest.json', 'other.json'),
    (value) => value.controller.releaseCommit = 'f'.repeat(40),
    (value) => value.target.tailscaleOrigin = 'http://0.0.0.0:8080',
    (value) => value.secret = 'forbidden',
  ]) {
    const invalid = structuredClone(plan);
    mutate(invalid);
    assert.throws(() => contract.validateCutoverPlan(invalid));
  }
});

test('source snapshot validation binds provenance and derives a stopped-writer state', () => {
  const plan = planFixture();
  const before = initialSnapshot();
  const after = postSnapshot(plan);
  assert.equal(contract.validateSourceSnapshot(before, plan, 'pre-quiesce').phase, 'pre-quiesce');
  assert.equal(contract.validateSourceSnapshot(after, plan, 'post-quiesce').phase, 'post-quiesce');

  const replaced = structuredClone(after);
  replaced.containers[3].id = digest('f');
  assert.throws(() => contract.validateSourceSnapshot(replaced, plan, 'post-quiesce'), /identity/i);

  const dataStopped = structuredClone(after);
  dataStopped.containers[0].running = false;
  assert.throws(() => contract.validateSourceSnapshot(dataStopped, plan, 'post-quiesce'), /data/i);

  const writerAlive = structuredClone(after);
  writerAlive.writerProof.mysqlNonSystemConnections = 1;
  assert.throws(() => contract.validateSourceSnapshot(writerAlive, plan, 'post-quiesce'), /writer/i);
  const eventWriter = structuredClone(after);
  eventWriter.writerProof.mysqlEventScheduler = 'ON';
  assert.throws(() => contract.validateSourceSnapshot(eventWriter, plan, 'post-quiesce'), /writer/i);
});

test('quiesce action plan mutates only allowlisted stateless containers, tasks, tunnel, and route', () => {
  const actions = contract.planSourceQuiesceActions(planFixture());
  assert.deepEqual(actions.slice(0, 2).map(({ kind, name }) => [kind, name]), [
    ['disable-task', 'easyfire-bookkeeping-prod-backup'],
    ['disable-task', 'easyfire-bookkeeping-prod-startup'],
  ]);
  assert.ok(actions.find((entry) => entry.kind === 'disable-service' && entry.name === 'EasyFireBookkeepingCloudflared'));
  assert.ok(actions.find((entry) => entry.kind === 'stop-private-route' && entry.processId === 4343));
  assert.equal(actions.filter((entry) => entry.kind === 'docker-restart-no').length, 6);
  assert.equal(actions.filter((entry) => entry.kind === 'docker-stop').length, 6);
  assert.ok(!actions.some((entry) => [digest('1'), digest('2')].includes(entry.containerId)));
  assert.ok(!actions.some((entry) => /remove|delete|prune|down/i.test(entry.kind)));
});

test('quiesce receipt binds both snapshots and preserves every original state', () => {
  const plan = planFixture();
  const receipt = quiesceReceipt(plan);
  assert.equal(contract.validateSourceQuiesceReceipt(receipt, plan).status, 'quiesced-verified');
  assert.equal(receipt.preservation.noResourcesDeleted, true);
  assert.equal(receipt.source.containers.length, 8);
  assert.equal(receipt.source.originalStates.scheduledTasks.length, 2);
  const changed = structuredClone(receipt);
  changed.afterSnapshotSha256 = digest('0');
  assert.throws(() => contract.validateSourceQuiesceReceipt(changed, plan), /snapshot/i);
});

test('pre-first-write abort requires a locked, route-free, stopped guest and rearms only the six source writers plus private launcher', () => {
  const plan = planFixture();
  const sourceReceiptSha256 = digest('a');
  const checkpointBindingSha256 = digest('b');
  const evidence = guestIsolationEvidence(plan, sourceReceiptSha256, checkpointBindingSha256);
  assert.equal(
    abort.validateGuestPreActivationIsolation(
      evidence,
      plan,
      digest('0'),
      sourceReceiptSha256,
      checkpointBindingSha256,
      new Date('2026-07-21T20:10:00.000Z'),
    ).status,
    'locked-verified',
  );
  const actions = abort.planSourceAbortActions(plan);
  assert.equal(actions.filter(({ kind }) => kind === 'docker-start').length, 6);
  assert.equal(actions.filter(({ kind }) => kind === 'docker-restore-restart-policy').length, 6);
  assert.equal(actions.filter(({ kind }) => kind === 'launch-private-route').length, 1);
  assert.ok(actions.every(({ name }) => !contract.LEGACY_TASK_NAMES.includes(name)));
  assert.ok(!actions.some(({ name }) => name === 'EasyFireBookkeepingCloudflared'));
  assert.ok(!actions.some(({ kind }) => /remove|delete|prune|down/i.test(kind)));

  for (const mutate of [
    (value) => value.guest.deploymentId = 'c9a090cb-2742-492e-a547-d4d63c28a043',
    (value) => value.guest.releaseCommit = 'f'.repeat(40),
    (value) => value.guest.firstUserWriteAuthority.authorizationAbsent = false,
    (value) => value.collector.liveRollbackVerificationPassed = false,
    (value) => value.collector.executableSha256 = digest('0'),
    (value) => value.collector.decisionClaim.decision = 'activate',
    (value) => value.guest.firstUserWriteAuthority.cutoverDecisionClaimSha256 = digest('0'),
    (value) => value.guest.rollbackLock.present = false,
    (value) => value.guest.containers[0].running = true,
    (value) => value.guest.containers[1].restartPolicy = 'unless-stopped',
    (value) => value.guest.network.tailscaleServeAbsent = false,
    (value) => value.guest.network.originPort8080Absent = false,
    (value) => value.guest.activation.receiptAbsent = false,
  ]) {
    const invalid = structuredClone(evidence);
    mutate(invalid);
    assert.throws(() => abort.validateGuestPreActivationIsolation(
      invalid,
      plan,
      digest('0'),
      sourceReceiptSha256,
      checkpointBindingSha256,
      new Date('2026-07-21T20:10:00.000Z'),
    ));
  }
});

test('guest isolation evidence is produced by the immutable root-only live collector', async () => {
  const source = await readFile(
    resolve(root, 'scripts/production/direct-vm-source-abort-contract.mjs'),
    'utf8',
  );
  assert.match(source, /collect-guest-isolation/);
  assert.match(source, /process\.getuid\?\.\(\) !== 0/);
  assert.match(source, /realpath\(process\.argv\[1\]\)/);
  assert.match(source, /parseManifestBoundRelease/);
  assert.match(source, /validateLockDocument/);
  assert.match(source, /--verify-locked/);
  assert.match(source, /tailscale.*serve.*status/is);
  assert.match(source, /tailscale.*funnel.*status/is);
  assert.match(source, /O_EXCL/);
  assert.match(source, /claimCutoverDecision/);
  assert.match(source, /cutoverDecisionClaimSha256/);
  assert.match(source, /guest-pre-activation-isolation\.json/);
  assert.doesNotMatch(source, /firstUserWriteObserved\s*:\s*options/i);
});

test('final checkpoint binding makes quiescence and checkpoint-v2 inseparable', () => {
  const plan = planFixture();
  const receipt = quiesceReceipt(plan);
  const receiptSha256 = hash(`${JSON.stringify(receipt, null, 2)}\n`);
  const after = postSnapshot(plan);
  const afterSha256 = hash(JSON.stringify(after));
  const checkpoint = checkpointV2(plan, receipt, receiptSha256, after, afterSha256);
  const checkpointSha256 = hash(`${JSON.stringify(checkpoint, null, 2)}\n`);
  const binding = contract.buildCheckpointBinding({
    plan,
    planSha256: digest('b'),
    sourceQuiesceReceipt: receipt,
    sourceQuiesceReceiptSha256: receiptSha256,
    postQuiesceSnapshot: after,
    postQuiesceSnapshotSha256: afterSha256,
    checkpoint,
    checkpointSha256,
    boundAt: '2026-07-21T20:08:00.000Z',
  });
  assert.equal(contract.validateCheckpointBinding(binding, plan, receiptSha256).status, 'bound-verified');
  assert.equal(binding.checkpoint.sqlGzip.sha256, checkpoint.payloads.sqlGzip.sha256);

  const ordinaryV2 = structuredClone(checkpoint);
  delete ordinaryV2.finalQuiescence;
  assert.equal(contract.validateCheckpointV2(ordinaryV2, plan).status, 'verified');
  assert.throws(() => contract.buildCheckpointBinding({
    plan,
    planSha256: digest('b'),
    sourceQuiesceReceipt: receipt,
    sourceQuiesceReceiptSha256: receiptSha256,
    postQuiesceSnapshot: after,
    postQuiesceSnapshotSha256: afterSha256,
    checkpoint: ordinaryV2,
    checkpointSha256,
    boundAt: '2026-07-21T20:08:00.000Z',
  }), /final-quiescence/i);

  const stale = structuredClone(checkpoint);
  stale.checkpointCreatedAt = '2026-07-21T19:59:00.000Z';
  assert.throws(() => contract.buildCheckpointBinding({
    plan,
    planSha256: digest('b'),
    sourceQuiesceReceipt: receipt,
    sourceQuiesceReceiptSha256: receiptSha256,
    postQuiesceSnapshot: after,
    postQuiesceSnapshotSha256: afterSha256,
    checkpoint: stale,
    checkpointSha256,
    boundAt: '2026-07-21T20:08:00.000Z',
  }), /(?:after.*quies|mixed or stale)/i);
});

test('activation evidence fails closed unless every migration gate passes and exposure is absent', () => {
  const plan = planFixture();
  const receipt = quiesceReceipt(plan);
  const receiptSha256 = hash(`${JSON.stringify(receipt, null, 2)}\n`);
  const evidence = activationEvidence(plan, receiptSha256);
  assert.equal(
    contract.validateActivationEvidence(evidence, plan, receiptSha256).status,
    'all-gates-passed',
  );

  for (const mutate of [
    (value) => value.sourceQuiesce.stillQuiesced = false,
    (value) => value.checkpoint.isolatedRestoreVerified = false,
    (value) => value.guest.backup.restoreState = 'running',
    (value) => value.guest.rollback.lockedRebootVerified = false,
    (value) => value.guest.reboot.bootIdAfter = value.guest.reboot.bootIdBefore,
    (value) => value.guest.guardian.databaseAutoRecoveryRefused = false,
    (value) => value.guest.guardian.shadowMode = true,
    (value) => value.collector.semanticProofsVerified = false,
    (value) => value.collector.executableSha256 = digest('0'),
    (value) => value.guest.authentication.ownerConfirmed = false,
    (value) => value.guest.network.serveAbsent = false,
    (value) => value.guest.network.funnelAbsent = false,
    (value) => value.guest.network.publicListeners.push(443),
  ]) {
    const invalid = structuredClone(evidence);
    mutate(invalid);
    assert.throws(() => contract.validateActivationEvidence(invalid, plan, receiptSha256));
  }
});

test('activation authorization grants one fresh tailnet-only Serve route', () => {
  const plan = planFixture();
  const receipt = quiesceReceipt(plan);
  const receiptSha256 = hash(`${JSON.stringify(receipt, null, 2)}\n`);
  const evidence = activationEvidence(plan, receiptSha256);
  const authorization = contract.buildActivationAuthorization({
    plan,
    planSha256: digest('b'),
    sourceQuiesceReceiptSha256: receiptSha256,
    activationEvidence: evidence,
    activationEvidenceSha256: digest('c'),
    authorizedAt: '2026-07-21T20:11:00.000Z',
  });
  assert.equal(
    contract.validateActivationAuthorization(
      authorization,
      new Date('2026-07-21T20:11:30.000Z'),
    ).maximumActivations,
    1,
  );
  assert.equal(authorization.activationEvidenceCollectedAt, evidence.collectedAt);
  assert.throws(() => contract.buildActivationAuthorization({
    plan,
    planSha256: digest('b'),
    sourceQuiesceReceiptSha256: receiptSha256,
    activationEvidence: evidence,
    activationEvidenceSha256: digest('c'),
    authorizedAt: '2026-07-21T20:26:00.001Z',
  }), /evidence.*stale/i);
  const lateAuthorization = contract.buildActivationAuthorization({
    plan,
    planSha256: digest('b'),
    sourceQuiesceReceiptSha256: receiptSha256,
    activationEvidence: evidence,
    activationEvidenceSha256: digest('c'),
    authorizedAt: '2026-07-21T20:24:00.000Z',
  });
  assert.equal(route.revalidateActivationFreshnessBeforeServe(
    lateAuthorization,
    new Date('2026-07-21T20:24:59.999Z'),
  ).maximumActivations, 1);
  assert.throws(() => route.revalidateActivationFreshnessBeforeServe(
    lateAuthorization,
    new Date('2026-07-21T20:25:00.001Z'),
  ), /evidence.*stale/i);
  assert.throws(() => contract.validateActivationAuthorization(
    lateAuthorization,
    new Date('2026-07-21T20:25:00.001Z'),
  ), /evidence.*stale/i);
  assert.deepEqual(authorization.route, {
    provider: 'tailscale-serve',
    scope: 'tailnet-only',
    dnsName: plan.target.tailscaleDnsName,
    httpsPort: 443,
    origin: 'http://127.0.0.1:8080',
    funnelAllowed: false,
  });
});

test('Linux route activator accepts an empty edge and an exact private Serve result only', () => {
  const before = route.validatePreActivationNetwork({
    tailscaleStatus: {
      BackendState: 'Running',
      Self: { Online: true, DNSName: 'easyfire-bookkeeping-newsec.taild63e9b.ts.net.' },
    },
    serveStatus: { TCP: {}, Web: {}, AllowFunnel: {} },
    funnelStatus: {},
    listeningPorts: [22, 8080],
  });
  assert.equal(before.safe, true);

  const after = route.validatePostActivationNetwork({
    tailscaleStatus: {
      BackendState: 'Running',
      Self: { Online: true, DNSName: 'easyfire-bookkeeping-newsec.taild63e9b.ts.net.' },
    },
    serveStatus: {
      TCP: {},
      Web: {
        'easyfire-bookkeeping-newsec.taild63e9b.ts.net:443': {
          Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } },
        },
      },
      AllowFunnel: {},
    },
    funnelStatus: {},
    listeningPorts: [22, 8080],
  });
  assert.equal(after.tailnetOnly, true);

  assert.throws(() => route.validatePostActivationNetwork({
    tailscaleStatus: before.tailscaleStatus,
    serveStatus: {
      TCP: {},
      Web: {
        'easyfire-bookkeeping-newsec.taild63e9b.ts.net:443': {
          Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } },
        },
      },
      AllowFunnel: { 'easyfire-bookkeeping-newsec.taild63e9b.ts.net:443': true },
    },
    funnelStatus: {},
    listeningPorts: [22, 8080],
  }), /Funnel/i);
  assert.throws(() => route.validatePostActivationNetwork({
    tailscaleStatus: before.tailscaleStatus,
    serveStatus: {
      TCP: {},
      Web: {
        'easyfire-bookkeeping-newsec.taild63e9b.ts.net:443': {
          Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } },
        },
      },
      AllowFunnel: {},
    },
    funnelStatus: { Web: { public: true } },
    listeningPorts: [22, 8080],
  }), /Funnel/i);
});

test('route command plan contains one Serve activation and never Funnel', () => {
  const commands = route.planActivationCommands('8'.repeat(40));
  assert.equal(route.validateTailscaleVersion('1.98.9\n  tailscale commit: pinned\n'), '1.98.9');
  assert.throws(() => route.validateTailscaleVersion('1.98.8\n'), /version/i);
  assert.ok(commands.find(({ stage, args }) => stage === 'tailscale-version' && args[0] === 'version'));
  assert.ok(commands.find(({ stage }) => stage === 'tailscale-funnel-before'));
  assert.ok(commands.find(({ stage }) => stage === 'tailscale-funnel-after'));
  assert.equal(commands.filter(({ stage }) => stage === 'activate-private-route').length, 1);
  const activation = commands.find(({ stage }) => stage === 'activate-private-route');
  assert.deepEqual(activation.args, [
    'serve', '--bg', '--https=443', 'http://127.0.0.1:8080',
  ]);
  assert.ok(!commands.some(({ file, args }) => [file, ...args].join(' ').match(/\bfunnel\s+--/i)));
  assert.ok(!commands.some(({ args }) => args.includes('--yes')));
});

test('abort and activation race on one exclusive cutover decision claim', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'easyfire-cutover-decision-'));
  const target = join(directory, 'cutover-decision.json');
  t.after(async () => {
    await unlink(target).catch(() => {});
    await rmdir(directory).catch(() => {});
  });
  const common = {
    cutoverId: planFixture().cutoverId,
    deploymentId: 'direct-vm-20260721-c9a090cb',
    releaseCommit: '8'.repeat(40),
    claimedAt: '2026-07-21T20:10:30.000Z',
  };
  const abortClaim = route.buildCutoverDecisionClaim({
    ...common,
    decision: 'abort',
    authoritySha256: digest('a'),
  });
  const activateClaim = route.buildCutoverDecisionClaim({
    ...common,
    decision: 'activate',
    authoritySha256: digest('b'),
  });
  const outcomes = await Promise.allSettled([
    route.writeCutoverDecisionExclusiveForTarget(target, abortClaim),
    route.writeCutoverDecisionExclusiveForTarget(target, activateClaim),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const loser = outcomes.find(({ status }) => status === 'rejected');
  assert.equal(loser.reason.code, 'E_CUTOVER_DECISION_CLAIMED');
  const published = JSON.parse(await readFile(target, 'utf8'));
  assert.ok(['abort', 'activate'].includes(published.decision));
  assert.equal(published.status, 'claimed-once');
  const winner = outcomes.find(({ status }) => status === 'fulfilled').value;
  assert.equal(winner.sha256, hash(winner.bytes));
  const mutated = { ...published, authoritySha256: digest('c') };
  await writeFile(target, `${JSON.stringify(mutated, null, 2)}\n`);
  await assert.rejects(
    route.rereadCutoverDecisionWinner(
      target,
      winner.bytes,
      winner.sha256,
      winner.document,
    ),
    (error) => error.code === 'E_CUTOVER_DECISION_READBACK',
  );
});

test('Linux route activation is immutable-release-bound before its once-only lock or commands', async () => {
  const source = await readFile(
    resolve(root, 'scripts/production/linux-private-route-activate.mjs'),
    'utf8',
  );
  assert.match(source, /parseManifestBoundRelease/);
  assert.match(source, /realpath\(process\.argv\[1\]\)/);
  assert.match(source, /releases\/\$\{authorization\.deployment\.releaseCommit\}/);
  assert.match(source, /artifact\.bytes/);
  const activate = source.indexOf('async function activate');
  const immutableGate = source.indexOf('assertImmutableReleaseExecutor', activate);
  const decisionClaim = source.indexOf('claimCutoverDecision', activate);
  const lock = source.indexOf('writeExclusive(ACTIVATION_LOCK', activate);
  const firstCommand = source.indexOf('const commands = planActivationCommands', activate);
  const postCommandsFreshness = source.indexOf('revalidateActivationFreshnessBeforeServe', firstCommand);
  const preActivation = source.indexOf('const before = validatePreActivationNetwork', firstCommand);
  const freshnessBoundary = source.indexOf('revalidateActivationFreshnessBeforeServe', preActivation);
  const serve = source.indexOf("results['activate-private-route'] = await run", freshnessBoundary);
  assert.ok(immutableGate > activate);
  assert.ok(immutableGate < lock && immutableGate < firstCommand);
  assert.ok(decisionClaim > immutableGate && decisionClaim < lock && decisionClaim < firstCommand);
  assert.ok(postCommandsFreshness > firstCommand && postCommandsFreshness < preActivation);
  assert.ok(preActivation > firstCommand && freshnessBoundary > preActivation && serve > freshnessBoundary);
  assert.match(source, /rereadCutoverDecisionWinner/);
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /onDiskBytes\.equals\(intendedBytes\)/);
  assert.doesNotMatch(source, /\bunlink\b/);
});

test('Guardian promotion requires both rehearsals and materializes only the exact active policy', () => {
  const shadowConfig = {
    schemaVersion: 1,
    runtimeManifestPath: '/etc/easyfire-bookkeeping/runtime-manifest.json',
    statePath: '/var/lib/easyfire-bookkeeping-guardian/state.json',
    statusPath: '/var/lib/easyfire-bookkeeping-guardian/status.json',
    dockerSocketPath: '/var/run/docker.sock',
    failureThreshold: 3,
    cooldownSeconds: 900,
    attemptWindowSeconds: 3600,
    maxRecoveryAttempts: 2,
    shadowMode: true,
    probes: [
      { name: 'web', url: 'http://127.0.0.1:8080/', timeoutMs: 3000, expectedStatus: 200 },
      { name: 'api-system', url: 'http://127.0.0.1:8080/api/system_db', timeoutMs: 3000, expectedStatus: 200 },
      { name: 'auth-meta', url: 'http://127.0.0.1:8080/api/auth/meta', timeoutMs: 3000, expectedStatus: 200 },
    ],
  };
  const activeConfig = guardian.buildActiveGuardianConfig(shadowConfig);
  assert.equal(activeConfig.shadowMode, false);
  assert.equal(shadowConfig.shadowMode, true);
  const shadowHash = hash(`${JSON.stringify(shadowConfig, null, 2)}\n`);
  const activeHash = hash(`${JSON.stringify(activeConfig, null, 2)}\n`);
  const common = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    status: 'passed',
    completedAt: '2026-07-21T20:09:00.000Z',
    deploymentId: 'direct-vm-20260721-c9a090cb',
    releaseCommit: '8'.repeat(40),
    disposableOnly: true,
    productionMutationCount: 0,
  };
  const shadowProof = {
    ...common,
    kind: 'easyfire-bookkeeping-guardian-shadow-rehearsal',
    configSha256: shadowHash,
    healthyObservationsPassed: true,
  };
  const activeProof = {
    ...common,
    kind: 'easyfire-bookkeeping-guardian-active-disposable-rehearsal',
    configSha256: activeHash,
    statelessRecoveryPassed: true,
    cooldownBudgetPassed: true,
    databaseAutoRecoveryRefused: true,
    identityMismatchRefused: true,
    healthyAfterRehearsal: true,
  };
  assert.equal(guardian.validateGuardianRehearsalProofs({
    shadowProof,
    activeProof,
    shadowConfigSha256: shadowHash,
    activeConfigSha256: activeHash,
  }).deploymentId, common.deploymentId);
  assert.throws(() => guardian.validateGuardianRehearsalProofs({
    shadowProof,
    activeProof: { ...activeProof, databaseAutoRecoveryRefused: false },
    shadowConfigSha256: shadowHash,
    activeConfigSha256: activeHash,
  }));
});

test('Guardian active promotion is release-bound before systemd or config mutation', async () => {
  const source = await readFile(
    resolve(root, 'scripts/production/linux-guardian-promote-active.mjs'),
    'utf8',
  );
  assert.match(source, /parseManifestBoundRelease/);
  assert.match(source, /validateCutoverPlan/);
  assert.match(source, /validateDeploymentPlan/);
  assert.match(source, /deployment\.deploymentId !== authority\.deploymentId/);
  assert.match(source, /realpath\(process\.argv\[1\]\)/);
  assert.match(source, /artifact\.bytes/);
  const promote = source.indexOf('async function promote');
  const immutableGate = source.indexOf('assertImmutableReleaseExecutor', promote);
  const systemd = source.indexOf('requireTimerInactive()', promote);
  const firstWrite = source.indexOf('writeExclusive(SHADOW_CONFIG', promote);
  assert.ok(immutableGate > promote && immutableGate < systemd && immutableGate < firstWrite);
});

test('activation evidence collection has fixed proof paths and exclusive root-owned output', async () => {
  const plan = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-activation-evidence-collection-plan',
    cutoverId: planFixture().cutoverId,
    createdAt: '2026-07-21T20:09:00.000Z',
    files: {
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
      backupReceipt: '/var/backups/easyfire-bookkeeping/20260721T200900Z/backup-receipt.json',
      backupComplete: '/var/backups/easyfire-bookkeeping/20260721T200900Z/COMPLETE',
      rollbackArmed: '/etc/easyfire-bookkeeping/rollback-evidence/rehearsals/direct-vm-20260721-c9a090cb/123e4567-e89b-42d3-a456-426614174000/armed.json',
      rollbackRearm: '/etc/easyfire-bookkeeping/rollback-evidence/rehearsals/direct-vm-20260721-c9a090cb/123e4567-e89b-42d3-a456-426614174000/rearm-complete.json',
    },
  };
  assert.equal(collector.validateCollectionPlan(plan).cutoverId, plan.cutoverId);
  const drift = structuredClone(plan);
  drift.files.authentication = '/tmp/authentication.json';
  assert.throws(() => collector.validateCollectionPlan(drift), /path/i);
  const source = await readFile(resolve(root, 'scripts/production/linux-activation-evidence-collect.mjs'), 'utf8');
  assert.match(source, /process\.getuid\?\.\(\) !== 0/);
  assert.match(source, /O_EXCL/);
  assert.match(source, /const OUTPUT = .*cutover-evidence\.json|export const OUTPUT = .*cutover-evidence\.json/);
  assert.match(source, /--verify-existing/);
  assert.match(source, /funnel.*status/i);
});

test('activation evidence chronology rejects stale or reordered migration proofs', () => {
  const timeline = {
    cutoverPlanCreatedAt: '2026-07-21T20:00:00.000Z',
    sourceQuiescedAt: '2026-07-21T20:01:00.000Z',
    checkpointCreatedAt: '2026-07-21T20:02:00.000Z',
    deploymentCompletedAt: '2026-07-21T20:03:00.000Z',
    backupCompletedAt: '2026-07-21T20:04:00.000Z',
    rollbackArmedAt: '2026-07-21T20:05:00.000Z',
    rollbackLockedRebootVerifiedAt: '2026-07-21T20:06:00.000Z',
    rollbackRearmedAt: '2026-07-21T20:07:00.000Z',
    recoveryCompletedAt: '2026-07-21T20:07:30.000Z',
    guardianShadowCompletedAt: '2026-07-21T20:08:00.000Z',
    guardianActiveCompletedAt: '2026-07-21T20:08:30.000Z',
    guardianPromotedAt: '2026-07-21T20:09:00.000Z',
    authenticationCompletedAt: '2026-07-21T20:09:15.000Z',
    collectionPlanCreatedAt: '2026-07-21T20:09:30.000Z',
  };
  const collectedAt = '2026-07-21T20:10:00.000Z';
  assert.equal(collector.validateProofChronology(timeline, collectedAt).ordered, true);
  assert.throws(() => collector.validateProofChronology({
    ...timeline,
    rollbackRearmedAt: '2026-07-21T20:05:30.000Z',
  }, collectedAt), /chronolog|order/i);
  assert.throws(() => collector.validateProofChronology(timeline, '2026-07-23T20:10:00.000Z'), /stale|fresh/i);
});

test('Windows controller contains no cleanup/delete authority and gates every live stage', async () => {
  const source = await readFile(
    resolve(root, 'scripts/production/direct-vm-cutover-authority.ps1'),
    'utf8',
  );
  assert.match(source, /ValidateSet\('PreparePlan', 'Quiesce', 'VerifyQuiesced', 'BindFinalCheckpoint', 'AbortBeforeActivation', 'AuthorizeActivation'\)/);
  assert.match(source, /COMPUTERNAME -cne 'NEWSEC'/);
  assert.match(source, /Assert-EasyFireCutoverPlan/);
  assert.match(source, /Assert-EasyFireSourceSnapshot/);
  assert.match(source, /Disable-ScheduledTask/);
  assert.match(source, /Set-Service[^\n]+-StartupType Disabled/);
  assert.match(source, /privateLauncherSha256/);
  assert.match(source, /Invoke-EasyFireAbortBeforeActivation/);
  assert.match(source, /firstUserWriteAuthority/);
  assert.match(source, /release-manifest\.json/);
  assert.match(source, /manifest\.releaseCommit/);
  assert.match(source, /artifact\.sha256/);
  assert.match(source, /artifact\.bytes/);
  const prepare = source.indexOf('function Invoke-EasyFirePreparePlan');
  const immutableReleaseGate = source.indexOf('Assert-EasyFireInstalledRelease', prepare);
  const authorityWrite = source.indexOf('Protect-EasyFireDirectory', prepare);
  assert.ok(prepare >= 0 && immutableReleaseGate > prepare);
  assert.ok(immutableReleaseGate < authorityWrite, 'immutable release proof must precede plan-authority mutation');
  assert.match(source, /docker[^\n]+update[^\n]+--restart=no/i);
  assert.doesNotMatch(source, /\b(Remove-Item|Unregister-ScheduledTask|docker\s+(?:rm|rmi|volume\s+rm|system\s+prune|compose\s+down)|tailscale\s+funnel)\b/i);
});

test('checkpoint producer has an explicit stopped-writer final mode without weakening its default', async () => {
  const source = await readFile(
    resolve(root, 'scripts/production/direct-vm-preflight-checkpoint.ps1'),
    'utf8',
  );
  assert.match(source, /\[switch\]\$RequireWritersStopped/);
  assert.match(source, /\$SourceQuiesceReceiptPath/);
  assert.match(source, /source-quiesce-receipt\.json/);
  assert.match(source, /if \(\$RequireWritersStopped\)/);
  assert.match(source, /restart policy must be no/i);
  assert.match(source, /Source MariaDB writer-connection proof/i);
  assert.match(source, /Source Redis external-client proof/i);
  assert.match(source, /else\s*\{[\s\S]{0,500}Required live container is not running/);
});
