import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protectedAccountingTables = [
  'ACCOUNTS_TRANSACTIONS',
  'BILLS',
  'BILLS_PAYMENTS',
  'BILLS_PAYMENTS_ENTRIES',
  'BILL_LOCATED_COSTS',
  'BILL_LOCATED_COST_ENTRIES',
  'CASHFLOW_TRANSACTIONS',
  'CASHFLOW_TRANSACTION_LINES',
  'CREDIT_NOTES',
  'CREDIT_NOTE_APPLIED_INVOICE',
  'EXPENSES_TRANSACTIONS',
  'EXPENSE_TRANSACTION_CATEGORIES',
  'INVENTORY_ADJUSTMENTS',
  'INVENTORY_ADJUSTMENTS_ENTRIES',
  'INVENTORY_COST_LOT_TRACKER',
  'INVENTORY_TRANSACTIONS',
  'INVENTORY_TRANSACTION_META',
  'ITEMS_ENTRIES',
  'ITEMS_WAREHOUSES_QUANTITY',
  'MANUAL_JOURNALS',
  'MANUAL_JOURNALS_ENTRIES',
  'MATCHED_BANK_TRANSACTIONS',
  'PAYMENT_RECEIVES',
  'PAYMENT_RECEIVES_ENTRIES',
  'RECOGNIZED_BANK_TRANSACTIONS',
  'REFUND_CREDIT_NOTE_TRANSACTIONS',
  'REFUND_VENDOR_CREDIT_TRANSACTIONS',
  'SALES_ESTIMATES',
  'SALES_INVOICES',
  'SALES_RECEIPTS',
  'TAX_RATE_TRANSACTIONS',
  'TIMES',
  'UNCATEGORIZED_CASHFLOW_TRANSACTIONS',
  'VENDOR_CREDITS',
  'VENDOR_CREDIT_APPLIED_BILL',
  'WAREHOUSES_TRANSFERS',
  'WAREHOUSES_TRANSFERS_ENTRIES',
];

test('Linux backup is packaged with LF line endings', async () => {
  const [attributes, script] = await Promise.all([
    readFile(path.join(root, '.gitattributes'), 'utf8'),
    readFile(
      path.join(root, 'scripts/production/linux-backup-verify.sh'),
      'utf8',
    ),
  ]);

  assert.match(
    attributes,
    /^scripts\/production\/linux-backup-verify\.sh text eol=lf$/m,
  );
  assert.equal(script.includes('\r'), false);
});

test('Linux backup database discovery uses GNU awk compatible identifiers', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );

  assert.doesNotMatch(script, /awk -v system=/);
  assert.match(script, /awk -v system_database=/);
  assert.match(script, /\$0 == system_database/);
});

test('Linux backup proves an append-only network-isolated restore', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );

  assert.match(script, /^#!\/usr\/bin\/env bash/);
  assert.match(script, /set -Eeuo pipefail/);
  assert.match(script, /umask 077/);
  assert.match(script, /flock -n 9/);
  assert.match(script, /\/var\/backups\/easyfire-bookkeeping/);
  assert.match(script, /RUNTIME_IDENTITY_EVIDENCE=.*runtime-identity-evidence\.json/);
  assert.match(script, /MIGRATION_RECEIPT=.*migration-receipt\.json/);
  assert.match(script, /DEPLOYMENT_RECEIPT=.*deployment-receipt\.json/);
  assert.match(script, /DEPLOYMENT_PLAN="\/etc\/easyfire-bookkeeping\/deployment-plan\.json"/);
  assert.match(script, /CHECKPOINT_MANIFEST=.*checkpoint-manifest\.json/);
  assert.match(
    script,
    /DEPLOYMENT_CONTROLLER="\$\{SOURCE_RELEASE\}\/scripts\/production\/linux-deploy-candidate\.mjs"/,
  );
  const controllerVerification = script.indexOf(
    '"${DEPLOYMENT_CONTROLLER}" --verify-existing --plan "${DEPLOYMENT_PLAN}"',
  );
  const streamedDump = script.indexOf('exec mariadb-dump --single-transaction');
  assert.ok(controllerVerification >= 0, 'release-owned deployment verification is missing');
  assert.ok(
    controllerVerification < streamedDump,
    'deployment verification must run before the logical dump',
  );
  assert.match(script, /mariadb-dump .*--single-transaction/);
  assert.match(script, /mariadb-dump .*--skip-lock-tables/);
  assert.match(script, /mariadb-dump .*--quick/);
  assert.match(script, /--routines/);
  assert.match(script, /--triggers/);
  assert.match(script, /--events/);
  assert.match(script, /--hex-blob/);
  assert.match(script, /docker volume create/);
  assert.match(script, /mkdir -m 0700 "\$\{UNIT\}"/);
  assert.match(script, /--network none/);
  assert.match(script, /--pull=never/);
  assert.match(script, /"\$\{MYSQL_IMAGE_ID\}" >\/dev\/null/);
  assert.match(script, /image tag drifted from the running image/);
  assert.match(script, /sourceVolumes/);
  assert.match(script, /sourceAuthority/);
  assert.match(script, /releaseManifestSha256/);
  assert.match(script, /checkpointManifestSha256/);
  assert.match(script, /environmentSha256/);
  assert.doesNotMatch(script, /docker create[\s\S]{0,300}--env-file/);
  assert.match(script, /mariadb-check/);
  assert.match(script, /EXPECTED_SYSTEM_TABLES="17"/);
  assert.match(script, /EXPECTED_TENANT_TABLES="70"/);
  assert.match(script, /EXPECTED_IDENTITY_COUNTS.*1\\t1\\t1\\t1/);
  assert.match(script, /SHA256SUMS/);
  assert.match(script, /state: 'stopped-preserved'/);
  assert.match(script, /docker stop --time 30 "\$\{RESTORE_CONTAINER\}"/);
  assert.doesNotMatch(script, /docker\s+(rm|rmi|system prune|volume rm)/i);
  assert.doesNotMatch(script, /docker\s+compose\s+(down|up)/i);
  assert.doesNotMatch(script, /find .*-(delete|exec rm)/i);
});

test('Linux backup binds exact Docker and deployment authority', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );

  assert.match(script, /com\.docker\.compose\.project/);
  assert.match(script, /com\.docker\.compose\.service/);
  assert.match(script, /easyfire-bookkeeping-prod/);
  assert.match(script, /easyfire-bookkeeping-migration/);
  assert.match(script, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(script, /\^sha256:\[a-f0-9\]\{64\}\$/);
  assert.match(script, /requireDockerHealth/);
  assert.match(script, /releaseCommit/);
  assert.match(script, /sourceReleasePath/);
  assert.match(script, /migrationReceiptSha256/);
  assert.match(script, /deploymentReceiptSha256/);
  assert.match(script, /deploymentPlanSha256/);
  assert.doesNotMatch(script, /(?:cat|printf|install)[^\n]*DEPLOYMENT_PLAN/);
  assert.match(script, /runtimeManifestSha256/);
  assert.match(script, /runtimeIdentityEvidenceSha256/);
  assert.match(script, /com\.docker\.compose\.volume/);
});

test('Linux restore proof never reuses production credentials and publishes completion last', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );

  assert.match(script, /openssl rand -hex/);
  assert.match(script, /MYSQL_ROOT_PASSWORD_FILE/);
  assert.match(script, /MYSQL_PASSWORD_FILE/);
  assert.doesNotMatch(script, /mysql_runtime_environment/);
  assert.doesNotMatch(script, /\.Config\.Env/);
  assert.match(script, /mariadb-dump[\s\S]{0,500}\|\s+gzip -c/);
  assert.doesNotMatch(script, /CONTAINER_BASE/);
  assert.match(script, /proof_query/);
  assert.match(script, /atomicWrite/);
  assert.match(script, /backup-receipt\.json/);
  assert.match(script, /COMPLETE/);
  assert.doesNotMatch(script, /status: 'restore-passed'/);
  assert.match(script, /status: 'passed'/);
});

test('Linux recurring restore proof records evolving counts without reapplying initial migration counts', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );
  const tableBlock = script.match(
    /PROTECTED_ACCOUNTING_TABLES=\(\r?\n([\s\S]*?)\r?\n\)/,
  );
  assert.ok(tableBlock, 'protected accounting table array is missing');
  const actualTables = [...tableBlock[1].matchAll(/^\s+([A-Z_]+)\s*$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(actualTables, protectedAccountingTables);
  assert.equal(new Set(actualTables).size, 37);
  assert.doesNotMatch(script, /\bJOURNAL_ENTRIES\b/);
  assert.match(script, /information_schema\.tables/);
  assert.match(script, /protected_table_exists/);
  assert.match(script, /protected_row_count/);
  const restoreValidation = script.match(
    /identity_counts="\$\([\s\S]*?docker stop --time 30 "\$\{RESTORE_CONTAINER\}"/,
  );
  assert.ok(restoreValidation, 'restore validation block is missing');
  assert.match(restoreValidation[0], /identity_count.*\^\[0-9\]\+\$/);
  assert.match(restoreValidation[0], /protected_row_count.*\^\[0-9\]\+\$/);
  assert.doesNotMatch(
    restoreValidation[0],
    /identity_counts\}" == "\$\{EXPECTED_IDENTITY_COUNTS\}/,
  );
  assert.doesNotMatch(restoreValidation[0], /protected_row_count\}" == '0'/);
  assert.match(script, /table_name\\trow_count/);
  assert.match(script, /source-schema-tables\.tsv/);
  assert.match(script, /restored-schema-tables\.tsv/);
  assert.match(script, /COALESCE\(engine, 'VIEW'\)/);
  assert.match(script, /storage_engine.*'InnoDB'/);
  assert.match(script, /Source schema\/table inventory changed during the logical dump/);
  assert.match(script, /Source and restored schema\/table manifests do not match/);
  assert.doesNotMatch(script, /requiredRowCount:\s*0/);
  assert.doesNotMatch(script, /SELECT\s+\*/i);

  const migrationAuthorityValidation = script.match(
    /const validation = object\(migrationReceipt\.validation[\s\S]*?const deployment = object/,
  );
  assert.ok(migrationAuthorityValidation, 'initial migration authority guard is missing');
  assert.match(
    migrationAuthorityValidation[0],
    /validation\.identityCounts\.some\([\s\S]*?expectedIdentityCounts/,
  );
  assert.match(migrationAuthorityValidation[0], /validation\.accountingGuard !== 'passed'/);
});

test('backup receipt records later nonzero identity observations and schema evidence', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );
  const writer = [...script.matchAll(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/g)][2][1];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'easyfire-backup-receipt-'));
  const receiptPath = path.join(directory, 'backup-receipt.json');
  const completePath = path.join(directory, 'COMPLETE');
  const windowsFsyncShim = path.join(directory, 'windows-fsync-shim.cjs');
  await writeFile(
    windowsFsyncShim,
    "const fs = require('node:fs'); const realFsync = fs.fsyncSync; fs.fsyncSync = (fd) => { try { realFsync(fd); } catch (error) { if (error.code !== 'EPERM') throw error; } };\n",
  );
  const schemaHash = 'a'.repeat(64);
  const result = spawnSync(
    process.execPath,
    ['--require', windowsFsyncShim, '-', receiptPath, completePath],
    {
      input: writer,
      encoding: 'utf8',
      env: {
        ...process.env,
        STAMP: '20260721T210000Z',
        SYSTEM_TABLE_COUNT: '17',
        TENANT_TABLE_COUNT: '70',
        IDENTITY_COUNTS: '2\t3\t4\t5',
        SOURCE_SCHEMA_TABLES_SHA256: schemaHash,
        RESTORED_SCHEMA_TABLES_SHA256: schemaHash,
        IDENTITY_COUNTS_SHA256: 'b'.repeat(64),
        PROTECTED_ACCOUNTING_COUNTS_SHA256: 'c'.repeat(64),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(receipt.validation.identityCounts, [2, 3, 4, 5]);
  assert.equal(receipt.validation.schemaTableInventory.tableCount, 87);
  assert.equal(receipt.validation.schemaTableInventory.exactMatch, true);
  assert.equal(
    receipt.validation.protectedAccountingCounts.valueDomain,
    'nonnegative-integer',
  );
  assert.equal('protectedAccountingGuard' in receipt.validation, false);
});

test('embedded Node evidence writers and validators parse', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );
  const programs = [...script.matchAll(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/g)].map(
    (match) => match[1],
  );
  assert.equal(programs.length, 3, 'expected three embedded Node programs');
  for (const program of programs) {
    const result = spawnSync(process.execPath, ['--check', '-'], {
      input: program,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('embedded authority validator accepts one exact evidence chain and rejects an incomplete deployment', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );
  const validator = [...script.matchAll(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/g)][0][1];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'easyfire-backup-authority-'));
  const commit = 'a'.repeat(40);
  const sourceReleasePath = `/opt/easyfire-bookkeeping/releases/${commit}`;
  const hashes = {
    release: '1'.repeat(64),
    checkpoint: '2'.repeat(64),
    environment: '3'.repeat(64),
    migration: '4'.repeat(64),
    runtime: '5'.repeat(64),
    evidence: '6'.repeat(64),
    plan: '7'.repeat(64),
  };
  const specs = [
    ['envoy', 'easyfire-bookkeeping-envoy', 'envoy', 'start-if-stopped'],
    ['webapp', 'easyfire-bookkeeping-webapp', 'webapp', 'start-if-stopped'],
    ['server', 'easyfire-bookkeeping-server', 'server', 'start-if-stopped'],
    ['gotenberg', 'easyfire-bookkeeping-gotenberg', 'gotenberg', 'start-if-stopped'],
    ['mysql', 'easyfire-bookkeeping-mysql', 'mysql', 'observe-only'],
    ['redis', 'easyfire-bookkeeping-redis', 'redis', 'observe-only'],
  ];
  const releaseRoles = [...specs.map(([role]) => role), 'migration'];
  const images = releaseRoles.map((role, index) => {
    const digestCharacter = (index + 1).toString(16);
    const ociIndexDigest = `sha256:${digestCharacter.repeat(64)}`;
    const repositoryRole = role === 'mysql' ? 'mariadb' : role;
    const external = role === 'envoy' || role === 'gotenberg';
    return {
      role,
      reference: external
        ? `example.invalid/${role}:v1@${ociIndexDigest}`
        : `easyfire-bookkeeping/${repositoryRole}:git-${commit}`,
      ociIndexDigest,
      linuxAmd64ManifestDigest: `sha256:${(index + 8).toString(16).repeat(64)}`,
      engineImageId: `sha256:${(index + 1).toString(16).repeat(64)}`,
    };
  });
  const release = { manifestVersion: 2, releaseCommit: commit, images };
  const generatedAt = '2026-07-21T20:00:00.000Z';
  const runtimeServices = specs.map(([role, containerName, , recoveryMode], index) => ({
    role,
    containerName,
    containerId: (index + 1).toString(16).repeat(64),
    imageId: images[index].engineImageId,
    requireDockerHealth: true,
    recoveryMode,
  }));
  const evidenceServices = specs.map(([role, containerName], index) => {
    const releaseImage = images[index];
    const external = role === 'envoy' || role === 'gotenberg';
    const taggedReference = releaseImage.reference.slice(
      0,
      releaseImage.reference.lastIndexOf('@'),
    );
    const repository = taggedReference.slice(0, taggedReference.lastIndexOf(':'));
    return {
      role,
      containerName,
      containerId: runtimeServices[index].containerId,
      configuredImageReference: releaseImage.reference,
      actualImageId: releaseImage.engineImageId,
      authorityKind: external
        ? 'engine-image-id-and-repo-digest'
        : 'engine-image-id',
      ociIndexDigest: releaseImage.ociIndexDigest,
      linuxAmd64ManifestDigest: releaseImage.linuxAmd64ManifestDigest,
      engineImageId: releaseImage.engineImageId,
      verifiedRepoDigest: external
        ? `${repository}@${releaseImage.ociIndexDigest}`
        : null,
    };
  });
  const runtime = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt,
    services: runtimeServices,
  };
  const evidence = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt,
    releaseCommit: commit,
    sourceReleasePath,
    services: evidenceServices,
  };
  const migration = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    deploymentId: 'direct-vm-20260721-abcdef12',
    releaseCommit: commit,
    sourceReleasePath,
    releaseManifestSha256: hashes.release,
    checkpointManifestSha256: hashes.checkpoint,
    environmentSha256: hashes.environment,
    migration: {
      containerName: 'easyfire-bookkeeping-migration',
      containerId: 'f'.repeat(64),
      imageId: images[6].engineImageId,
      startedAt: '2026-07-21T20:01:00.000Z',
      completedAt: '2026-07-21T20:02:00.000Z',
      exitCode: 0,
      state: 'exited',
    },
    validation: {
      systemTableCount: 17,
      tenantTableCount: 70,
      identityCounts: [1, 1, 1, 1],
      accountingGuard: 'passed',
    },
    status: 'passed',
  };
  const deployment = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    deploymentId: migration.deploymentId,
    releaseCommit: commit,
    releaseManifestSha256: hashes.release,
    checkpointManifestSha256: hashes.checkpoint,
    environmentSha256: hashes.environment,
    deploymentPlanSha256: hashes.plan,
    migrationReceiptSha256: hashes.migration,
    runtimeManifestSha256: hashes.runtime,
    runtimeIdentityEvidenceSha256: hashes.evidence,
    completedAt: '2026-07-21T20:03:00.000Z',
    status: 'complete',
  };
  const paths = Object.fromEntries(
    ['release', 'runtime', 'evidence', 'migration', 'deployment'].map((name) => [
      name,
      path.join(directory, `${name}.json`),
    ]),
  );
  await Promise.all([
    writeFile(paths.release, JSON.stringify(release)),
    writeFile(paths.runtime, JSON.stringify(runtime)),
    writeFile(paths.evidence, JSON.stringify(evidence)),
    writeFile(paths.migration, JSON.stringify(migration)),
    writeFile(paths.deployment, JSON.stringify(deployment)),
  ]);
  const args = [
    '-',
    paths.release,
    paths.runtime,
    paths.evidence,
    paths.migration,
    paths.deployment,
    sourceReleasePath,
    commit,
    hashes.release,
    hashes.checkpoint,
    hashes.environment,
    hashes.plan,
    hashes.migration,
    hashes.runtime,
    hashes.evidence,
    '17',
    '70',
    '1\t1\t1\t1',
  ];
  const accepted = spawnSync(process.execPath, args, {
    input: validator,
    encoding: 'utf8',
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout.trim().split('\n').length, 8);

  deployment.deploymentPlanSha256 = '8'.repeat(64);
  await writeFile(paths.deployment, JSON.stringify(deployment));
  const planMismatch = spawnSync(process.execPath, args, {
    input: validator,
    encoding: 'utf8',
  });
  assert.notEqual(planMismatch.status, 0);
  assert.match(planMismatch.stderr, /complete deployment evidence chain/i);

  delete deployment.deploymentPlanSha256;
  await writeFile(paths.deployment, JSON.stringify(deployment));
  const planMissing = spawnSync(process.execPath, args, {
    input: validator,
    encoding: 'utf8',
  });
  assert.notEqual(planMissing.status, 0);
  assert.match(planMissing.stderr, /unexpected field set/i);

  deployment.deploymentPlanSha256 = hashes.plan;
  deployment.status = 'incomplete';
  await writeFile(paths.deployment, JSON.stringify(deployment));
  const refused = spawnSync(process.execPath, args, {
    input: validator,
    encoding: 'utf8',
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /complete deployment evidence chain/i);
});
