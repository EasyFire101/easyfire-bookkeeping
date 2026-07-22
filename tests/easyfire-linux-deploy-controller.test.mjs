import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const controllerPath = path.join(
  root,
  'scripts',
  'production',
  'linux-deploy-candidate.mjs',
);
const authorityPath = path.join(
  root,
  'scripts',
  'production',
  'linux-deploy-authority.mjs',
);
const planPath = path.join(
  root,
  'scripts',
  'production',
  'linux-deploy-plan.mjs',
);
const dockerPath = path.join(
  root,
  'scripts',
  'production',
  'linux-deploy-docker.mjs',
);

const controller = await import(pathToFileURL(controllerPath).href);
const planContract = await import(pathToFileURL(planPath).href);
const dockerContract = await import(pathToFileURL(dockerPath).href);

function validPlan() {
  const commit = 'a'.repeat(40);
  const releasePath = `/opt/easyfire-bookkeeping/releases/${commit}`;
  return {
    schemaVersion: 1,
    deploymentId: 'direct-vm-20260721-abcdef12',
    project: 'easyfire-bookkeeping-prod',
    releaseCommit: commit,
    releasePath,
    currentReleasePath: '/opt/easyfire-bookkeeping/current',
    releaseManifest: {
      path: `${releasePath}/release-manifest.json`,
      sha256: '1'.repeat(64),
    },
    sourceArchive: {
      path: '/var/lib/easyfire-bookkeeping-staging/source.tar.gz',
      sha256: '2'.repeat(64),
    },
    imageBundle: {
      path: '/var/lib/easyfire-bookkeeping-staging/images.tar',
      sha256: '3'.repeat(64),
    },
    environment: {
      path: '/etc/easyfire-bookkeeping/production.env',
      sha256: '4'.repeat(64),
    },
    checkpoint: {
      manifestPath: '/var/lib/easyfire-bookkeeping-staging/checkpoint.json',
      manifestSha256: '5'.repeat(64),
      durableManifestPath: '/etc/easyfire-bookkeeping/checkpoint-manifest.json',
      sqlGzipPath: '/var/lib/easyfire-bookkeeping-staging/database.sql.gz',
      sqlGzipSha256: '6'.repeat(64),
      redisRdbPath: '/var/lib/easyfire-bookkeeping-staging/dump.rdb',
      redisRdbSha256: '7'.repeat(64),
    },
    composeFiles: [
      `${releasePath}/docker-compose.prod.yml`,
      `${releasePath}/deploy/linux/docker-compose.vm.yml`,
      `${releasePath}/deploy/linux/docker-compose.candidate.yml`,
    ],
    runtimeManifestGeneratorPath:
      '/opt/easyfire-bookkeeping/guardian/runtime-manifest-generator.js',
    outputs: {
      runtimeManifestPath: '/etc/easyfire-bookkeeping/runtime-manifest.json',
      runtimeIdentityEvidencePath:
        '/etc/easyfire-bookkeeping/runtime-identity-evidence.json',
      migrationReceiptPath: '/etc/easyfire-bookkeeping/migration-receipt.json',
      deploymentReceiptPath: '/etc/easyfire-bookkeeping/deployment-receipt.json',
      journalRoot: '/var/lib/easyfire-bookkeeping-deployments',
    },
    resources: {
      network: 'easyfire-bookkeeping-network',
      mysqlVolume: 'easyfire_bookkeeping_vm_20260721_abcdef12_mysql',
      redisVolume: 'easyfire_bookkeeping_vm_20260721_abcdef12_redis',
    },
    expected: {
      systemDatabase: 'easyfire_system',
      tenantDatabase: 'easyfire_tenant_11zwei1mruexcl9',
      systemTableCount: 17,
      tenantTableCount: 70,
      identityCounts: [1, 1, 1, 1],
      protectedTableCounts: Object.fromEntries(
        controller.PROTECTED_ACCOUNTING_TABLES.map((table) => [table, 0]),
      ),
      redisKeyUpperBound: 35,
    },
  };
}

test('accepts the exact isolated VM deployment authority', () => {
  const parsed = controller.validateDeploymentPlan(validPlan());
  assert.equal(parsed.project, 'easyfire-bookkeeping-prod');
  assert.equal(parsed.resources.network, 'easyfire-bookkeeping-network');
  assert.equal(parsed.expected.identityCounts.join('/'), '1/1/1/1');
});

test('binds deployment to the exact production or rehearsal hostname', () => {
  const legacyProduction = validPlan();
  assert.equal(
    planContract.expectedDeploymentHostname(legacyProduction),
    'easyfire-bookkeeping-newsec',
  );

  const production = validPlan();
  production.target = {
    role: 'production',
    hostname: 'easyfire-bookkeeping-newsec',
  };
  assert.equal(
    planContract.expectedDeploymentHostname(
      controller.validateDeploymentPlan(production),
    ),
    'easyfire-bookkeeping-newsec',
  );

  const rehearsal = validPlan();
  rehearsal.target = {
    role: 'rehearsal',
    hostname: 'easyfire-bookkeeping-rehearsal-newsec',
  };
  const parsed = controller.validateDeploymentPlan(rehearsal);
  assert.deepEqual(parsed.target, rehearsal.target);
  assert.equal(
    planContract.expectedDeploymentHostname(parsed),
    'easyfire-bookkeeping-rehearsal-newsec',
  );

  const mismatched = structuredClone(rehearsal);
  mismatched.target.hostname = 'easyfire-bookkeeping-newsec';
  assert.throws(
    () => controller.validateDeploymentPlan(mismatched),
    /target/i,
  );

  const unknownRole = structuredClone(rehearsal);
  unknownRole.target.role = 'disposable';
  assert.throws(
    () => controller.validateDeploymentPlan(unknownRole),
    /target/i,
  );

  const extraTargetAuthority = structuredClone(rehearsal);
  extraTargetAuthority.target.override = true;
  assert.throws(
    () => controller.validateDeploymentPlan(extraTargetAuthority),
    /target/i,
  );
});

test('rejects paths, resources, and accounting expectations outside the contract', () => {
  const wrongRelease = validPlan();
  wrongRelease.releasePath = '/tmp/release';
  assert.throws(
    () => controller.validateDeploymentPlan(wrongRelease),
    /releasePath/i,
  );

  const reusedVolume = validPlan();
  reusedVolume.resources.mysqlVolume = 'easyfire_prod_mysql';
  assert.throws(
    () => controller.validateDeploymentPlan(reusedVolume),
    /mysqlVolume/i,
  );

  const noAccountingGuard = validPlan();
  noAccountingGuard.expected.protectedTableCounts = {};
  assert.throws(
    () => controller.validateDeploymentPlan(noAccountingGuard),
    /protectedTableCounts/i,
  );
});

test('builds create and start commands without build, pull, up, or migration replay', () => {
  const parsed = controller.validateDeploymentPlan(validPlan());
  const create = controller.buildComposeArguments(parsed, [
    'create',
    '--pull',
    'never',
    '--no-build',
    ...controller.ALL_SERVICES,
  ]);
  assert.deepEqual(create.slice(-11), [
    'create',
    '--pull',
    'never',
    '--no-build',
    'mysql',
    'redis',
    'gotenberg',
    'server',
    'webapp',
    'envoy',
    'database_migration',
  ]);
  assert.ok(!create.includes('up'));
  assert.ok(!create.includes('build'));

  const routine = controller.buildComposeArguments(parsed, [
    'start',
    '--wait',
    '--wait-timeout',
    '180',
    'mysql',
    'redis',
  ]);
  assert.ok(!routine.includes('database_migration'));
});

test('publishes root-only JSON with exclusive no-overwrite semantics', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'easyfire-deploy-doc-'));
  const target = path.join(directory, 'receipt.json');
  await controller.writeJsonExclusive(target, { status: 'complete' });
  const mode = (await stat(target)).mode & 0o777;
  if (process.platform === 'win32') {
    assert.match(await readFile(authorityPath, 'utf8'), /chmod\(target, 0o600\)/);
  } else {
    assert.equal(mode, 0o600);
  }
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), {
    status: 'complete',
  });
  await assert.rejects(
    controller.writeJsonExclusive(target, { status: 'replacement' }),
    /already exists/i,
  );
});

test('source encodes a once-only migration and append-only failure boundary', async () => {
  const source = await readFile(controllerPath, 'utf8');
  assert.match(source, /easyfire-bookkeeping-migration/);
  assert.match(source, /migration-start-authority\.json/);
  assert.match(source, /State\.Status[^\n]+created/i);
  assert.match(source, /--pull[\s\S]{0,80}never[\s\S]{0,80}--no-build/);
  assert.match(source, /startup-gate-authority\.json/);
  assert.match(source, /activation-result\.json/);
  assert.match(source, /verifyExistingResources/);
  assert.doesNotMatch(source, /unless-stopped|docker\s+update/i);
  assert.doesNotMatch(source, /compose[^\n]+\b(up|down|rm|pull|build)\b/i);
  assert.doesNotMatch(source, /docker[^\n]+\b(prune|rm|rmi|volume\s+rm)\b/i);
});

test('deploy and verify-existing both enforce the plan-bound Docker hostname', async () => {
  const source = await readFile(controllerPath, 'utf8');
  const boundCalls = source.match(
    /getDockerIdentity\(\s*expectedDeploymentHostname\(plan\),?\s*\)/g,
  );
  assert.equal(boundCalls?.length, 2);

  const dockerSource = await readFile(dockerPath, 'utf8');
  assert.match(
    dockerSource,
    /getDockerIdentity = async \(expectedHostname = HOSTNAME\)/,
  );
  assert.match(
    dockerSource,
    /\[HOSTNAME, REHEARSAL_HOSTNAME\]\.includes\(expectedHostname\)/,
  );
  assert.match(dockerSource, /info\.Name !== expectedHostname/);
});

test('publishes the one final receipt only after systemd-owned activation proof', async () => {
  const source = await readFile(controllerPath, 'utf8');
  const startupAuthority = source.indexOf('startup-gate-authority.json');
  const activationResult = source.indexOf('activation-result.json');
  const deploymentEnd = source.indexOf(
    'plan.outputs.deploymentReceiptPath',
    activationResult,
  );
  assert.ok(startupAuthority >= 0);
  assert.ok(activationResult > startupAuthority);
  assert.ok(deploymentEnd > activationResult);
  assert.equal(source.indexOf('writeJsonExclusive', deploymentEnd + 1), -1);
});

test('real emitters produce exact backup and activation receipt shapes', () => {
  const plan = controller.validateDeploymentPlan(validPlan());
  const migrationContainer = {
    Id: 'b'.repeat(64),
    Image: `sha256:${'c'.repeat(64)}`,
  };
  const migrationTimes = {
    startedAt: '2026-07-21T22:00:00.000000000Z',
    completedAt: '2026-07-21T22:00:01.000000000Z',
  };
  const dataProof = {
    systemTableCount: 17,
    tenantTableCount: 70,
    identityCounts: [1, 1, 1, 1],
  };
  const migration = controller.buildMigrationReceipt({
    plan,
    migrationContainer,
    migrationTimes,
    dataProof,
  });
  assert.deepEqual(Object.keys(migration), [
    'schemaVersion',
    'project',
    'deploymentId',
    'releaseCommit',
    'sourceReleasePath',
    'releaseManifestSha256',
    'checkpointManifestSha256',
    'environmentSha256',
    'migration',
    'validation',
    'status',
  ]);
  const gate = controller.buildStartupGateAuthority({
    plan,
    planSha256: '8'.repeat(64),
    migrationReceiptSha256: '9'.repeat(64),
    authorizedAt: '2026-07-21T22:00:02.000Z',
  });
  assert.equal(gate.requiredRestartPolicy, 'no');
  assert.deepEqual(gate.services, [
    'easyfire-bookkeeping-mysql',
    'easyfire-bookkeeping-redis',
    'easyfire-bookkeeping-gotenberg',
    'easyfire-bookkeeping-server',
    'easyfire-bookkeeping-webapp',
    'easyfire-bookkeeping-envoy',
  ]);
  const activation = controller.buildActivationResult({
    plan,
    planSha256: '8'.repeat(64),
    startupGateAuthoritySha256: 'c'.repeat(64),
    deploymentEvidenceSha256: 'd'.repeat(64),
    activatedAt: '2026-07-21T22:00:02.500Z',
    containers: controller.ALL_SERVICES.slice(0, 6).map((_, index) => ({
      Id: `${index + 1}`.repeat(64),
      Image: `sha256:${`${index + 2}`.repeat(64)}`,
    })),
    migration: {
      ...migration.migration,
      restartPolicy: 'no',
    },
  });
  assert.deepEqual(Object.keys(activation), [
    'schemaVersion',
    'project',
    'deploymentId',
    'status',
    'activatedAt',
    'planSha256',
    'startupGateAuthoritySha256',
    'deploymentEvidenceSha256',
    'requiredRestartPolicy',
    'services',
    'migration',
  ]);
  assert.ok(
    activation.services.every(
      (service) =>
        service.state === 'running' &&
        service.health === 'healthy' &&
        service.restartPolicy === 'no',
    ),
  );
  const deployment = controller.buildDeploymentReceipt({
    plan,
    planSha256: '8'.repeat(64),
    migrationReceiptSha256: '9'.repeat(64),
    runtimeManifestSha256: 'a'.repeat(64),
    runtimeIdentityEvidenceSha256: 'b'.repeat(64),
    completedAt: '2026-07-21T22:00:03.000Z',
  });
  assert.deepEqual(Object.keys(deployment), [
    'schemaVersion',
    'project',
    'deploymentId',
    'releaseCommit',
    'releaseManifestSha256',
    'checkpointManifestSha256',
    'environmentSha256',
    'deploymentPlanSha256',
    'migrationReceiptSha256',
    'runtimeManifestSha256',
    'runtimeIdentityEvidenceSha256',
    'completedAt',
    'status',
  ]);
});

test('reboot preflight accepts stopped runtimes but rejects unhealthy running ones', () => {
  assert.doesNotThrow(() =>
    dockerContract.verifyRuntimeContainerState(
      { State: { Running: false, Status: 'exited' } },
      'server',
    ),
  );
  assert.doesNotThrow(() =>
    dockerContract.verifyRuntimeContainerState(
      { State: { Running: false, Status: 'created' } },
      'server',
    ),
  );
  assert.throws(
    () =>
      dockerContract.verifyRuntimeContainerState(
        {
          State: {
            Running: true,
            Status: 'running',
            Health: { Status: 'unhealthy' },
          },
        },
        'server',
      ),
    /not healthy/i,
  );
});

test('controller independently rejects Docker Compose-active env-file syntax', () => {
  const plan = controller.validateDeploymentPlan(validPlan());
  const validSecret = Buffer.alloc(64, 0xa5).toString('base64');
  const base = [
    `APP_JWT_SECRET=${validSecret}`,
    'DB_PASSWORD=safe-password',
    'DB_ROOT_PASSWORD=safe-root-password',
    'DB_USER=easyfire',
    `IMAGE_TAG=git-${plan.releaseCommit}`,
    `MARIADB_IMAGE_TAG=git-${plan.releaseCommit}`,
    `MARIADB_VOLUME_NAME=${plan.resources.mysqlVolume}`,
    `REDIS_VOLUME_NAME=${plan.resources.redisVolume}`,
    'BASE_URL=https://easyfire-bookkeeping-newsec.taild63e9b.ts.net',
    'SIGNUP_DISABLED=true',
    'SIGNUP_ALLOWED_DOMAINS=',
    'SIGNUP_ALLOWED_EMAILS=',
    'SIGNUP_EMAIL_CONFIRMATION=false',
    'DB_HOST=mysql',
    `SYSTEM_DB_NAME=${plan.expected.systemDatabase}`,
    'TENANT_DB_NAME_PERFIX=easyfire_tenant_',
    'PUBLIC_PROXY_PORT=8080',
  ];
  const unsafeValues = [
    '$TOKEN',
    '${TOKEN}',
    ' leading',
    'trailing ',
    'literal # comment',
  ];
  for (const unsafe of unsafeValues) {
    const bytes = Buffer.from(
      `${base.map((line) =>
        line.startsWith('DB_PASSWORD=') ? `DB_PASSWORD=${unsafe}` : line,
      ).join('\n')}\n`,
      'utf8',
    );
    assert.throws(
      () => planContract.parseProductionEnvironment(bytes, plan),
      /E_ENV_COMPOSE_SYNTAX|Docker Compose/,
    );
  }
});
