import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const modulePath = path.join(
  root,
  'scripts',
  'production',
  'linux-native-auth-proof.mjs',
);
const auth = await import(pathToFileURL(modulePath).href);

const sha = (character) => character.repeat(64);
const commit = 'a'.repeat(40);

function authority() {
  return {
    deploymentId: 'direct-vm-20260721-abcdef12',
    releaseCommit: commit,
    releaseManifestSha256: sha('1'),
    checkpointManifestSha256: sha('2'),
    deploymentPlanSha256: sha('3'),
    deploymentReceiptSha256: sha('4'),
    collectorPath: `/opt/easyfire-bookkeeping/releases/${commit}/scripts/production/linux-native-auth-proof.mjs`,
    collectorSha256: sha('5'),
  };
}

function dataProof() {
  return {
    systemTableCount: 17,
    tenantTableCount: 70,
    identityCounts: [1, 1, 1, 1],
    protectedTableCounts: Object.fromEntries(
      auth.PROTECTED_ACCOUNTING_TABLES.map((table) => [table, 0]),
    ),
    redisDatabaseSize: 20,
    redisKeyUpperBound: 35,
    mariadbCheckSha256: sha('6'),
  };
}

test('builds a credential-free proof from authenticated API and live data evidence', () => {
  const proof = auth.buildNativeAuthenticationProof({
    authority: authority(),
    completedAt: '2026-07-21T23:00:00.000Z',
    ownerConfirmed: true,
    principalBindingSha256: sha('7'),
    accountResponseSha256: sha('8'),
    organizationResponseSha256: sha('9'),
    dataProof: dataProof(),
  });
  assert.equal(proof.method, 'native-password-interactive');
  assert.equal(proof.ownerConfirmed, true);
  assert.equal(proof.authenticatedApi.account, 'passed');
  assert.equal(proof.dataValidation.protectedAccountingTableCount, 37);
  assert.equal(proof.secretMaterialPersisted, false);
  assert.doesNotMatch(
    JSON.stringify(proof),
    /"(?:accessToken|password|authorization)"\s*:/i,
  );
  assert.deepEqual(auth.validateNativeAuthenticationProof(proof), proof);
});

test('rejects owner ambiguity and any incomplete live data invariant', () => {
  assert.throws(
    () => auth.buildNativeAuthenticationProof({
      authority: authority(),
      completedAt: '2026-07-21T23:00:00.000Z',
      ownerConfirmed: false,
      principalBindingSha256: sha('7'),
      accountResponseSha256: sha('8'),
      organizationResponseSha256: sha('9'),
      dataProof: dataProof(),
    }),
    /owner/i,
  );
  const drift = dataProof();
  drift.protectedTableCounts.BILLS = 1;
  assert.throws(
    () => auth.buildNativeAuthenticationProof({
      authority: authority(),
      completedAt: '2026-07-21T23:00:00.000Z',
      ownerConfirmed: true,
      principalBindingSha256: sha('7'),
      accountResponseSha256: sha('8'),
      organizationResponseSha256: sha('9'),
      dataProof: drift,
    }),
    /data|accounting/i,
  );

  const valid = auth.buildNativeAuthenticationProof({
    authority: authority(),
    completedAt: '2026-07-21T23:00:00.000Z',
    ownerConfirmed: true,
    principalBindingSha256: sha('7'),
    accountResponseSha256: sha('8'),
    organizationResponseSha256: sha('9'),
    dataProof: dataProof(),
  });
  const missingRedis = structuredClone(valid);
  delete missingRedis.dataValidation.redisDatabaseSize;
  delete missingRedis.dataValidation.redisKeyUpperBound;
  assert.throws(
    () => auth.validateNativeAuthenticationProof(missingRedis),
    /shape|missing|redis|incomplete/i,
  );
  const persistedSecret = structuredClone(valid);
  persistedSecret.authenticatedApi.token = 'persisted-secret';
  assert.throws(
    () => auth.validateNativeAuthenticationProof(persistedSecret),
    /shape|missing|secret|token/i,
  );
});

test('server-side account and organization responses match the signed-in principal', () => {
  const binding = auth.validateAuthenticatedSessionBinding({
    email: 'owner@example.test',
    userId: 41,
    tenantId: 7,
    organizationId: 'org_private_123',
    account: { id: 41, email: 'OWNER@example.test', tenantId: 7 },
    organization: { id: 7, organizationId: 'org_private_123' },
  });
  assert.deepEqual(binding, {
    userId: '41',
    tenantId: '7',
    organizationId: 'org_private_123',
  });
  assert.throws(
    () => auth.validateAuthenticatedSessionBinding({
      email: 'owner@example.test',
      userId: 41,
      tenantId: 7,
      organizationId: 'org_private_123',
      account: { id: 99, email: 'owner@example.test', tenantId: 7 },
      organization: { id: 7, organizationId: 'org_private_123' },
    }),
    /principal|account|session/i,
  );
});

test('CLI contract requires interactive TTY input and preflights fixed create-new output', async () => {
  assert.deepEqual(
    auth.parseArguments([
      '--collect',
      '--plan',
      '/etc/easyfire-bookkeeping/deployment-plan.json',
      '--output',
      '/etc/easyfire-bookkeeping/activation-proof/authentication.json',
    ]),
    {
      help: false,
      mode: 'collect',
      planPath: '/etc/easyfire-bookkeeping/deployment-plan.json',
      outputPath: '/etc/easyfire-bookkeeping/activation-proof/authentication.json',
    },
  );
  assert.throws(() => auth.parseArguments(['--collect']), /plan|output/i);
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(modulePath, 'utf8'),
  );
  const preflightAt = source.indexOf('await assertOutputAbsent(outputPath)');
  const credentialAt = source.indexOf('await readInteractiveInputs()');
  assert.ok(preflightAt >= 0 && preflightAt < credentialAt);
  assert.match(source, /redirect:\s*'error'/);
});
