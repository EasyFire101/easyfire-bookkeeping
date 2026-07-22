import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const controllerPath = path.join(
  root,
  'scripts',
  'production',
  'linux-rollback-lock.mjs',
);
const controller = await import(pathToFileURL(controllerPath).href);

const deploymentId = 'direct-vm-20260721-abcdef12';
const releaseCommit = 'a'.repeat(40);
const planSha256 = 'b'.repeat(64);
const deploymentReceiptSha256 = 'c'.repeat(64);
const lockId = '123e4567-e89b-42d3-a456-426614174000';

function binding() {
  return {
    deploymentId,
    releaseCommit,
    planSha256,
    deploymentReceiptSha256,
  };
}

function lock(reason = 'rehearsal') {
  return controller.createLockDocument(binding(), reason, {
    lockId,
    armedAt: '2026-07-21T22:00:00.000Z',
  });
}

function deploymentResources() {
  return {
    containers: Object.fromEntries(
      controller.LONG_RUNNING_CONTAINERS.map(({ service, name }, index) => [
        service,
        {
          name,
          id: `${index}`.repeat(64),
          imageId: `sha256:${`${index + 1}`.repeat(64)}`,
        },
      ]),
    ),
  };
}

function migrationResult() {
  return {
    containerName: controller.MIGRATION_CONTAINER,
    containerId: 'f'.repeat(64),
    imageId: `sha256:${'e'.repeat(64)}`,
    startedAt: '2026-07-21T21:00:00.000Z',
    completedAt: '2026-07-21T21:01:00.000Z',
    exitCode: 0,
    state: 'exited',
  };
}

function stoppedInspections() {
  return [
    ...controller.LONG_RUNNING_CONTAINERS.map(({ service, name }, index) => ({
      Id: `${index}`.repeat(64),
      Name: `/${name}`,
      Image: `sha256:${`${index + 1}`.repeat(64)}`,
      Config: {
        Labels: {
          'com.docker.compose.project': controller.PROJECT,
          'com.docker.compose.service': service,
        },
      },
      HostConfig: { RestartPolicy: { Name: 'no' } },
      State: { Status: 'exited', Running: false, ExitCode: 0 },
    })),
    {
      Id: 'f'.repeat(64),
      Name: `/${controller.MIGRATION_CONTAINER}`,
      Image: `sha256:${'e'.repeat(64)}`,
      Config: {
        Labels: {
          'com.docker.compose.project': controller.PROJECT,
          'com.docker.compose.service': 'database_migration',
        },
      },
      HostConfig: { RestartPolicy: { Name: 'no' } },
      State: { Status: 'exited', Running: false, ExitCode: 0 },
    },
  ];
}

test('parses only the three fixed modes and bounded arm reasons', () => {
  assert.deepEqual(
    controller.parseArguments(['--arm', '--reason', 'rehearsal']),
    { help: false, mode: 'arm', reason: 'rehearsal' },
  );
  assert.deepEqual(controller.parseArguments(['--verify-locked']), {
    help: false,
    mode: 'verify-locked',
    reason: undefined,
  });
  assert.deepEqual(controller.parseArguments(['--rearm']), {
    help: false,
    mode: 'rearm',
    reason: undefined,
  });
  assert.throws(
    () => controller.parseArguments(['--arm', '--reason', 'anything']),
    /reason/i,
  );
  assert.throws(
    () => controller.parseArguments(['--arm', '--verify-locked', '--reason', 'rollback']),
    /mode/i,
  );
  assert.throws(
    () => controller.parseArguments(['--rearm', '--reason', 'rehearsal']),
    /reason/i,
  );
});

test('arm command plan verifies authority first and quiesces in exact order', () => {
  const commands = controller.planArmCommands(true);
  assert.deepEqual(commands[0], {
    stage: 'deployment-preflight',
    executable: '/usr/local/bin/node',
    arguments: [
      '/opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs',
      '--verify-existing',
      '--plan',
      '/etc/easyfire-bookkeeping/deployment-plan.json',
    ],
  });
  const stages = commands.map(({ stage }) => stage);
  assert.ok(stages.indexOf('restart-neutralize') < stages.indexOf('guardian-stop'));
  assert.ok(stages.indexOf('guardian-stop') < stages.indexOf('tailscale-https-off'));
  assert.ok(stages.indexOf('tailscale-https-off') < stages.indexOf('stateless-stop'));
  assert.ok(stages.indexOf('stateless-inspect') < stages.indexOf('data-stop'));
  assert.ok(stages.indexOf('data-stop') < stages.indexOf('runtime-inspect'));

  const stateless = commands.find(({ stage }) => stage === 'stateless-stop');
  const data = commands.find(({ stage }) => stage === 'data-stop');
  assert.deepEqual(
    commands.find(({ stage }) => stage === 'restart-neutralize').arguments,
    ['update', '--restart', 'no', ...controller.ALL_RUNTIME_CONTAINERS],
  );
  assert.deepEqual(stateless.arguments, [
    'container',
    'stop',
    '--time',
    '30',
    ...controller.STATELESS_CONTAINERS,
  ]);
  assert.deepEqual(data.arguments, [
    'container',
    'stop',
    '--time',
    '30',
    ...controller.DATA_CONTAINERS,
  ]);
  const rendered = commands
    .map(({ executable, arguments: args }) => [executable, ...args].join(' '))
    .join('\n');
  assert.doesNotMatch(rendered, /\b(compose|up|down|rm|prune|rmi|volume\s+rm)\b/i);
});

test('logged-out plan never mutates Tailscale and rearm starts only the stack gate', () => {
  const loggedOut = controller.planArmCommands(false);
  assert.ok(!loggedOut.some(({ stage }) => stage === 'tailscale-https-off'));

  const rearm = controller.planRearmCommands();
  assert.deepEqual(rearm, [
    {
      stage: 'stack-start',
      executable: '/usr/bin/systemctl',
      arguments: ['start', 'easyfire-bookkeeping-stack.service'],
    },
    {
      stage: 'deployment-reverify',
      executable: '/usr/local/bin/node',
      arguments: [
        '/opt/easyfire-bookkeeping/current/scripts/production/linux-deploy-candidate.mjs',
        '--verify-existing',
        '--plan',
        '/etc/easyfire-bookkeeping/deployment-plan.json',
      ],
    },
  ]);
  assert.ok(!rearm.some(({ executable }) => executable.endsWith('/docker')));
});

test('lock document is exact, deployment-bound, and rollback can never rearm', () => {
  const rehearsal = lock();
  assert.deepEqual(controller.validateLockDocument(rehearsal), rehearsal);
  assert.match(
    rehearsal.evidenceDirectory,
    /^\/etc\/easyfire-bookkeeping\/rollback-evidence\/rehearsals\//,
  );
  assert.doesNotThrow(() => controller.assertRearmAllowed(rehearsal));

  const rollback = lock('rollback');
  assert.match(
    rollback.evidenceDirectory,
    /^\/etc\/easyfire-bookkeeping\/rollback-evidence\/rollbacks\//,
  );
  assert.throws(() => controller.assertRearmAllowed(rollback), /rollback/i);

  const drift = structuredClone(rehearsal);
  drift.deployment.planSha256 = 'd'.repeat(64);
  assert.throws(
    () => controller.validateLockAgainstAuthority(drift, binding()),
    /binding/i,
  );
});

test('locked runtime proof binds all six stopped containers and exited migration', () => {
  const resources = deploymentResources();
  const migration = migrationResult();
  assert.deepEqual(
    controller.validateStoppedRuntime(
      stoppedInspections(),
      resources,
      migration,
    ),
    {
      stoppedContainers: controller.ALL_RUNTIME_CONTAINERS,
      migrationExitCode: 0,
    },
  );

  const running = stoppedInspections();
  running[2].State = { Status: 'running', Running: true, ExitCode: 0 };
  assert.throws(
    () => controller.validateStoppedRuntime(running, resources, migration),
    /stopped/i,
  );

  const replayedMigration = stoppedInspections();
  replayedMigration.at(-1).State.ExitCode = 1;
  assert.throws(
    () => controller.validateStoppedRuntime(replayedMigration, resources, migration),
    /migration/i,
  );

  const unsafeRestart = stoppedInspections();
  unsafeRestart[0].HostConfig.RestartPolicy.Name = 'unless-stopped';
  assert.throws(
    () => controller.validateStoppedRuntime(unsafeRestart, resources, migration),
    /identity/i,
  );
  assert.throws(
    () =>
      controller.validateRestartPolicies(
        stoppedInspections().slice(0, -1),
        resources,
        'unless-stopped',
      ),
    /must remain no/i,
  );
});

test('Tailscale isolation accepts logged-out/no-listener and rejects Serve or Funnel', () => {
  assert.deepEqual(
    controller.validateTailscaleIsolation({
      status: { BackendState: 'NeedsLogin' },
      serveStatus: undefined,
      funnelStatus: undefined,
      listeningPorts: [],
    }),
    { enrolled: false, serveAbsent: true, funnelAbsent: true },
  );

  assert.deepEqual(
    controller.validateTailscaleIsolation({
      status: { BackendState: 'Running', Self: { Online: true } },
      serveStatus: { TCP: {}, Web: {}, AllowFunnel: {} },
      funnelStatus: {},
      listeningPorts: [],
    }),
    { enrolled: true, serveAbsent: true, funnelAbsent: true },
  );

  assert.throws(
    () =>
      controller.validateTailscaleIsolation({
        status: { BackendState: 'Running', Self: { Online: true } },
        serveStatus: { Web: { 'host:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } } } },
        funnelStatus: {},
        listeningPorts: [],
      }),
    /Serve/i,
  );
  assert.throws(
    () =>
      controller.validateTailscaleIsolation({
        status: { BackendState: 'NeedsLogin' },
        listeningPorts: [443],
      }),
    /listener/i,
  );
});

test('parses Linux TCP tables and rejects listeners on 443 or 8080', () => {
  const tcp = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 1',
    '   1: 0100007F:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 2',
  ].join('\n');
  assert.deepEqual(controller.parseListeningPorts(tcp, ''), [22, 8080]);
  assert.throws(
    () => controller.assertPortsAbsent([22, 8080], [443, 8080]),
    /8080/,
  );
  assert.doesNotThrow(() => controller.assertPortsAbsent([22], [443, 8080]));
});

test('source has atomic no-replace writes and no destructive Docker vocabulary', async () => {
  const source = await readFile(controllerPath, 'utf8');
  const deploymentAuthoritySource = await readFile(
    path.join(root, 'scripts', 'production', 'linux-deploy-authority.mjs'),
    'utf8',
  );
  assert.match(source, /collectBoundInputs/);
  assert.match(source, /readVerifiedDeploymentChain/);
  assert.doesNotMatch(source, /deploymentReceipt\.planSha256/);
  assert.doesNotMatch(source, /restartPromotion\?\.authorized/);
  assert.match(deploymentAuthoritySource, /deploymentPlanSha256/);
  assert.match(
    deploymentAuthoritySource,
    /deploymentReceipt\.project !== 'easyfire-bookkeeping'/,
  );
  assert.match(deploymentAuthoritySource, /migrationReceipt\.status !== 'passed'/);
  assert.match(deploymentAuthoritySource, /migration\.exitCode !== 0/);
  assert.doesNotMatch(source, /unless-stopped/);
  assert.match(source, /open\([^\n]+['"]wx['"]/);
  assert.match(source, /rename\(/);
  assert.match(source, /mode[^\n]+0o600|0o600/);
  assert.match(source, /ensureLinuxRoot/);
  assert.doesNotMatch(source, /\bshell\s*:\s*true\b/);
  assert.doesNotMatch(source, /['"](?:down|rm|prune|rmi)['"]/);
  assert.doesNotMatch(source, /['"]volume['"]\s*,\s*['"]rm['"]/);
});
