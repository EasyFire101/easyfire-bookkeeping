import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const modulePath = path.join(
  root,
  'scripts',
  'production',
  'linux-rehearsal-evidence.mjs',
);
const rehearsal = await import(pathToFileURL(modulePath).href);
const rollback = await import(pathToFileURL(path.join(
  root,
  'scripts',
  'production',
  'linux-rollback-lock.mjs',
)).href);

const sha = (character) => character.repeat(64);
const commit = 'a'.repeat(40);
const deploymentId = 'direct-vm-20260721-abcdef12';
const lockId = '123e4567-e89b-42d3-a456-426614174000';

function plan() {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-linux-rehearsal-plan',
    rehearsalId: '936de674-58c3-4c99-93bc-a157d36ee4c7',
    createdAt: '2026-07-21T22:00:00.000Z',
    host: {
      hostname: 'easyfire-bookkeeping-rehearsal-newsec',
      machineIdSha256: sha('1'),
      productionMachineIdSha256: sha('2'),
    },
    release: {
      releaseCommit: commit,
      releasePath: `/opt/easyfire-bookkeeping/releases/${commit}`,
      releaseManifestPath: `/opt/easyfire-bookkeeping/releases/${commit}/release-manifest.json`,
      releaseManifestSha256: sha('3'),
    },
    deployment: {
      deploymentId,
      planPath: '/etc/easyfire-bookkeeping/deployment-plan.json',
      planSha256: sha('4'),
      receiptPath: '/etc/easyfire-bookkeeping/deployment-receipt.json',
      receiptSha256: sha('5'),
    },
    rollback: {
      armedReceiptPath: `/etc/easyfire-bookkeeping/rollback-evidence/rehearsals/${deploymentId}/${lockId}/armed.json`,
      lockedRebootReceiptPath: `/etc/easyfire-bookkeeping/rollback-evidence/rehearsals/${deploymentId}/${lockId}/locked-reboot.json`,
      rearmReceiptPath: `/etc/easyfire-bookkeeping/rollback-evidence/rehearsals/${deploymentId}/${lockId}/rearm-complete.json`,
    },
    authenticationProofPath: '/etc/easyfire-bookkeeping/activation-proof/authentication.json',
    outputPath: '/etc/easyfire-bookkeeping/rehearsal-evidence.json',
  };
}

function inputs() {
  return {
    plan: plan(),
    collector: {
      executablePath: `/opt/easyfire-bookkeeping/releases/${commit}/scripts/production/linux-rehearsal-evidence.mjs`,
      executableSha256: sha('6'),
    },
    host: {
      hostname: 'easyfire-bookkeeping-rehearsal-newsec',
      machineIdSha256: sha('1'),
    },
    rollback: {
      armedReceiptSha256: sha('7'),
      lockedRebootReceiptSha256: sha('8'),
      rearmReceiptSha256: sha('9'),
      bootIdBefore: '1516c5b2-3340-4c02-b9c4-7a340930088d',
      bootIdAfter: '53682154-c88d-48ee-9194-adac4790d8cc',
      lockedAt: '2026-07-21T22:05:00.000Z',
      rearmedAt: '2026-07-21T22:06:00.000Z',
      resourcesPreserved: true,
    },
    normalReboot: {
      markerSha256: sha('a'),
      proofSha256: sha('b'),
      bootIdBefore: '53682154-c88d-48ee-9194-adac4790d8cc',
      bootIdAfter: '71129d5d-51c2-4599-9b9e-72a649d1eef2',
      completedAt: '2026-07-21T22:20:00.000Z',
      stackAuthorityVerified: true,
      guardianTimerActive: true,
      guardianTimerEnabled: true,
    },
    recovery: {
      proofSha256: sha('c'),
      dockerRestart: {
        before: sha('d'),
        after: sha('d'),
        mainPidBefore: '100',
        mainPidAfter: '101',
        recovered: true,
      },
      daemonFailure: {
        mainPidBefore: '101',
        mainPidAfter: '102',
        failureObserved: true,
        recovered: true,
      },
      invalidAuthorityStart: {
        refused: true,
        originalReceiptSha256: sha('5'),
        invalidReceiptSha256: sha('1'),
        originalReceiptRestored: true,
      },
      completedAt: '2026-07-21T22:15:00.000Z',
    },
    guardian: {
      proofSha256: sha('e'),
      shadowObservationCount: 3,
      shadowWouldStartObserved: true,
      statelessStartContainerIdSha256: sha('f'),
      statelessRecoveryObserved: true,
      cooldownObserved: true,
      redisObserveOnlyRefusalObserved: true,
      mariadbObserveOnlyRefusalObserved: true,
      identityMismatchRefusalObserved: true,
      finalHealthVerified: true,
      completedAt: '2026-07-21T22:10:00.000Z',
    },
    authentication: {
      proofSha256: sha('0'),
      method: 'native-password-interactive',
      ownerConfirmed: true,
      authenticatedApiPassed: true,
      dataInvariantsPassed: true,
      secretMaterialPersisted: false,
      completedAt: '2026-07-21T22:19:00.000Z',
    },
    completedAt: '2026-07-21T22:22:00.000Z',
  };
}

function recoveryDocument() {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-runtime-recovery-rehearsal',
    status: 'passed',
    completedAt: '2026-07-21T22:15:00.000Z',
    deploymentId,
    releaseCommit: commit,
    dockerRestart: inputs().recovery.dockerRestart,
    daemonFailure: {
      signal: 'SIGKILL',
      ...inputs().recovery.daemonFailure,
    },
    invalidAuthorityStart: {
      ...inputs().recovery.invalidAuthorityStart,
      invalidReceiptPreservedPath:
        '/etc/easyfire-bookkeeping/rehearsal-proof/deployment-receipt.invalid.json',
    },
    resourcesDeleted: false,
    productionDataMutationCount: 0,
  };
}

function rollbackChain(planCandidate = plan()) {
  const lock = rollback.createLockDocument({
    deploymentId,
    releaseCommit: commit,
    planSha256: planCandidate.deployment.planSha256,
    deploymentReceiptSha256: planCandidate.deployment.receiptSha256,
  }, 'rehearsal', {
    lockId,
    armedAt: '2026-07-21T22:01:00.000Z',
    bootIdAtArm: '1516c5b2-3340-4c02-b9c4-7a340930088d',
  });
  const lockSha256 = sha('6');
  const proof = {
    runtime: {
      stoppedContainers: rollback.ALL_RUNTIME_CONTAINERS,
      migrationExitCode: 0,
    },
    unitStates: {
      'easyfire-bookkeeping-guardian.timer': 'inactive',
      'easyfire-bookkeeping-guardian.service': 'inactive',
      'easyfire-bookkeeping-stack.service': 'inactive',
    },
    tailscale: { enrolled: false, serveAbsent: true, funnelAbsent: true },
  };
  const armedReceipt = {
    schemaVersion: 1,
    project: rollback.PROJECT,
    kind: 'easyfire-bookkeeping-rollback-armed-receipt',
    status: 'locked-verified',
    lockId,
    reason: 'rehearsal',
    completedAt: '2026-07-21T22:02:00.000Z',
    lockSha256,
    deployment: lock.deployment,
    proof: {
      stoppedContainers: proof.runtime.stoppedContainers,
      migrationExitCode: 0,
      unitStates: proof.unitStates,
      tailscale: proof.tailscale,
      absentListeners: [443, 8080],
      resourcesPreserved: true,
    },
  };
  const armedReceiptSha256 = sha('7');
  const lockedReceipt = rollback.buildLockedRebootReceipt({
    lock,
    lockSha256,
    armedReceiptSha256,
    bootIdAfter: '53682154-c88d-48ee-9194-adac4790d8cc',
    proof,
    completedAt: '2026-07-21T22:05:00.000Z',
  });
  const lockedReceiptSha256 = sha('8');
  const rearmReceipt = {
    schemaVersion: 1,
    project: rollback.PROJECT,
    kind: 'easyfire-bookkeeping-rearm-completion',
    status: 'deployment-verified',
    completedAt: '2026-07-21T22:06:00.000Z',
    lockId,
    deployment: lock.deployment,
    lockedRebootProofSha256: lockedReceiptSha256,
    guardianRemainsStopped: true,
    tailscaleRemainsDisabled: true,
    resourcesPreserved: true,
  };
  return {
    plan: planCandidate,
    lock,
    lockSha256,
    armedReceipt,
    armedReceiptSha256,
    lockedReceipt,
    lockedReceiptSha256,
    rearmReceipt,
  };
}

test('rehearsal plan is exact, host-separated, and deployment-bound', () => {
  assert.deepEqual(rehearsal.validateRehearsalPlan(plan()), plan());
  const sameMachine = plan();
  sameMachine.host.productionMachineIdSha256 = sameMachine.host.machineIdSha256;
  assert.throws(() => rehearsal.validateRehearsalPlan(sameMachine), /machine|isolat/i);
  const productionHost = plan();
  productionHost.host.hostname = 'easyfire-bookkeeping-newsec';
  assert.throws(() => rehearsal.validateRehearsalPlan(productionHost), /hostname|rehearsal/i);
  const malformedLock = plan();
  malformedLock.rollback.armedReceiptPath = malformedLock.rollback.armedReceiptPath.replace(
    lockId,
    'not-a-uuid',
  );
  malformedLock.rollback.lockedRebootReceiptPath =
    `${path.dirname(malformedLock.rollback.armedReceiptPath)}/locked-reboot.json`;
  malformedLock.rollback.rearmReceiptPath =
    `${path.dirname(malformedLock.rollback.armedReceiptPath)}/rearm-complete.json`;
  assert.throws(() => rehearsal.validateRehearsalPlan(malformedLock), /rollback|lock/i);
});

test('builds one release-bound rehearsal receipt independent of the later production checkpoint', () => {
  const receipt = rehearsal.buildRehearsalEvidence(inputs());
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.release.releaseCommit, commit);
  assert.equal(receipt.planCreatedAt, plan().createdAt);
  assert.equal(receipt.scope.productionDataMutationCount, 0);
  assert.equal(receipt.scope.publicExposure, false);
  assert.ok(!JSON.stringify(receipt).includes('checkpointManifestSha256'));
  assert.deepEqual(rehearsal.validateRehearsalEvidence(receipt), receipt);
  const reordered = structuredClone(receipt);
  reordered.guardian.completedAt = '2026-07-21T22:16:00.000Z';
  assert.throws(
    () => rehearsal.validateRehearsalEvidence(reordered),
    /chronology|order/i,
  );
  const conflated = structuredClone(receipt);
  conflated.normalReboot.bootIdBefore = conflated.rollback.bootIdBefore;
  conflated.normalReboot.bootIdAfter = conflated.rollback.bootIdAfter;
  assert.throws(
    () => rehearsal.validateRehearsalEvidence(conflated),
    /chronology|reboot|transition/i,
  );
  const authenticationAfterReboot = structuredClone(receipt);
  authenticationAfterReboot.authentication.completedAt = '2026-07-21T22:21:00.000Z';
  assert.throws(
    () => rehearsal.validateRehearsalEvidence(authenticationAfterReboot),
    /chronology|order/i,
  );
});

test('real recovery documents retain every machine-produced field required by the receipt', () => {
  const summary = rehearsal.validateRecoveryDocument(recoveryDocument(), plan());
  assert.equal(summary.daemonFailure.mainPidBefore, '101');
  assert.equal(summary.daemonFailure.mainPidAfter, '102');
  assert.equal(summary.invalidAuthorityStart.originalReceiptSha256, sha('5'));
  assert.equal(summary.invalidAuthorityStart.invalidReceiptSha256, sha('1'));
});

test('rollback receipts are semantically validated and bound to the rehearsal deployment', () => {
  const valid = rollbackChain();
  assert.equal(
    rehearsal.validateRollbackEvidenceChain(valid).lock.deployment.planSha256,
    plan().deployment.planSha256,
  );
  const drift = rollbackChain();
  drift.lock.deployment.planSha256 = sha('0');
  assert.throws(
    () => rehearsal.validateRollbackEvidenceChain(drift),
    /rollback|deployment|authority/i,
  );
});

test('rejects same-boot rollback, hand-waved Guardian, and missing recovery readback', () => {
  const sameBoot = inputs();
  sameBoot.rollback.bootIdAfter = sameBoot.rollback.bootIdBefore;
  assert.throws(() => rehearsal.buildRehearsalEvidence(sameBoot), /boot/i);

  const guardian = inputs();
  guardian.guardian.redisObserveOnlyRefusalObserved = false;
  assert.throws(() => rehearsal.buildRehearsalEvidence(guardian), /guardian/i);

  const recovery = inputs();
  recovery.recovery.invalidAuthorityStart.originalReceiptRestored = false;
  assert.throws(() => rehearsal.buildRehearsalEvidence(recovery), /recovery|receipt/i);
});

test('CLI is a two-phase release-owned exercise and collection contract', () => {
  assert.deepEqual(
    rehearsal.parseArguments([
      '--exercise',
      '--plan',
      '/etc/easyfire-bookkeeping/rehearsal-evidence-plan.json',
    ]),
    { help: false, mode: 'exercise', planPath: '/etc/easyfire-bookkeeping/rehearsal-evidence-plan.json' },
  );
  assert.deepEqual(
    rehearsal.parseArguments([
      '--collect',
      '--plan',
      '/etc/easyfire-bookkeeping/rehearsal-evidence-plan.json',
      '--output',
      '/etc/easyfire-bookkeeping/rehearsal-evidence.json',
    ]),
    {
      help: false,
      mode: 'collect',
      planPath: '/etc/easyfire-bookkeeping/rehearsal-evidence-plan.json',
      outputPath: '/etc/easyfire-bookkeeping/rehearsal-evidence.json',
    },
  );
  assert.throws(() => rehearsal.parseArguments(['--collect']), /plan|output/i);
});

test('runtime rehearsal is isolated, preflighted, and contains no destructive Docker operation', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(modulePath, 'utf8'),
  );
  assert.match(source, /easyfire-bookkeeping-rehearsal-newsec/);
  assert.match(source, /assertExerciseOutputsAbsent/);
  assert.match(source, /assertNoRoute/);
  assert.ok(
    source.indexOf('const evidence = buildRehearsalEvidence') <
      source.indexOf('await writeExclusive(NORMAL_REBOOT_PROOF'),
  );
  assert.match(source, /Docker service restart/);
  assert.match(source, /Docker daemon failure injection/);
  assert.match(source, /Invalid authority stack refusal/);
  assert.match(source, /originalReceiptRestored/);
  assert.match(source, /redisObserveOnlyRefusalObserved/);
  assert.match(source, /mariadbObserveOnlyRefusalObserved/);
  assert.doesNotMatch(source, /\['(?:rm|rmi|prune|volume)',/);
  assert.doesNotMatch(source, /\['compose',/);
  assert.doesNotMatch(source, /\bunlink\s*\(/);
});
