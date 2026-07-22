import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const producerPath = path.join(
  root,
  'scripts',
  'production',
  'linux-checkpoint-authority-v2.mjs',
);
const planPath = path.join(
  root,
  'scripts',
  'production',
  'linux-deploy-plan.mjs',
);
const cutoverContractPath = path.join(
  root,
  'scripts',
  'production',
  'direct-vm-cutover-contract.mjs',
);

const producer = await import(pathToFileURL(producerPath).href);
const planContract = await import(pathToFileURL(planPath).href);
const cutoverContract = await import(pathToFileURL(cutoverContractPath).href);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const writeJson = async (filePath, value) => {
  const bytes = jsonBytes(value);
  await writeFile(filePath, bytes);
  return bytes;
};

const metadataFor = async (checkpointRoot, relativePath) => {
  const diskPath = path.join(checkpointRoot, ...relativePath.split('\\'));
  const bytes = await readFile(diskPath);
  return {
    Path: relativePath,
    Bytes: bytes.length,
    Sha256: sha256(bytes).toUpperCase(),
  };
};

const MYSQL_ID = '1'.repeat(64);
const REDIS_ID = '2'.repeat(64);
const MYSQL_IMAGE = `sha256:${'3'.repeat(64)}`;
const REDIS_IMAGE = `sha256:${'4'.repeat(64)}`;
const MYSQL_REF = 'easyfire-bookkeeping/mariadb:easyfire-20260713-e4210a54464d';
const REDIS_REF = 'easyfire-bookkeeping/redis:easyfire-20260713-e4210a54464d';
const FINAL_CONTAINER_SPECS = [
  ['mysql', 'data', 'easyfire-mysql', MYSQL_ID, MYSQL_IMAGE, MYSQL_REF],
  ['redis', 'data', 'easyfire-redis', REDIS_ID, REDIS_IMAGE, REDIS_REF],
  [
    'gotenberg',
    'stateless',
    'easyfire-gotenberg',
    '5'.repeat(64),
    `sha256:${'b'.repeat(64)}`,
    'easyfire-bookkeeping/gotenberg:pinned',
  ],
  [
    'proxy',
    'stateless',
    'easyfire-proxy',
    '6'.repeat(64),
    `sha256:${'c'.repeat(64)}`,
    'easyfire-bookkeeping/proxy:pinned',
  ],
  [
    'webapp',
    'stateless',
    'easyfire-webapp',
    '7'.repeat(64),
    `sha256:${'d'.repeat(64)}`,
    'easyfire-bookkeeping/webapp:pinned',
  ],
  [
    'server',
    'stateless',
    'easyfire-owner-onboarding-ca845969f4b2',
    '8'.repeat(64),
    `sha256:${'e'.repeat(64)}`,
    'easyfire-bookkeeping/server:pinned',
  ],
  [
    'onboarding-web',
    'stateless',
    'easyfire-owner-onboarding-web-0b7d1af8',
    '9'.repeat(64),
    `sha256:${'f'.repeat(64)}`,
    'easyfire-bookkeeping/onboarding-web:pinned',
  ],
  [
    'onboarding-gateway',
    'stateless',
    'easyfire-owner-onboarding-gateway-v2-0b7d1af8',
    'a'.repeat(64),
    `sha256:${'5'.repeat(64)}`,
    'easyfire-bookkeeping/onboarding-gateway:pinned',
  ],
];

function initialCutoverSnapshot(
  capturedAt = '2026-07-22T02:00:00.000Z',
) {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-source-snapshot',
    phase: 'pre-quiesce',
    capturedAt,
    host: 'NEWSEC',
    docker: {
      id: 'a'.repeat(64),
      name: 'docker-desktop',
      serverVersion: '29.6.2',
      osType: 'linux',
      architecture: 'x86_64',
      dockerRootDir: '/var/lib/docker',
    },
    containers: FINAL_CONTAINER_SPECS.map(
      ([role, tier, name, id, imageId, imageReference]) => ({
        role,
        tier,
        name,
        id,
        imageId,
        imageReference,
        composeProject: 'easyfire-bookkeeping-prod',
        composeService: role,
        restartPolicy: 'unless-stopped',
        maximumRetryCount: 0,
        running: true,
        state: 'running',
        health: 'healthy',
        mounts:
          role === 'mysql'
            ? [
                {
                  type: 'volume',
                  source: 'easyfire_prod_mysql',
                  destination: '/var/lib/mysql',
                  readOnly: false,
                },
              ]
            : role === 'redis'
              ? [
                  {
                    type: 'volume',
                    source: 'easyfire_prod_redis',
                    destination: '/data',
                    readOnly: false,
                  },
                ]
              : [],
        networks: ['easyfire-bookkeeping-prod_default'],
        publishedPorts:
          role === 'proxy'
            ? [
                {
                  containerPort: 80,
                  hostIp: '127.0.0.1',
                  hostPort: 25180,
                  protocol: 'tcp',
                },
              ]
            : [],
      }),
    ),
    volumes: [
      {
        role: 'mysql',
        name: 'easyfire_prod_mysql',
        driver: 'local',
        scope: 'local',
        composeProject: 'easyfire-bookkeeping-prod',
        composeVolume: 'mysql',
        consumers: [MYSQL_ID],
      },
      {
        role: 'redis',
        name: 'easyfire_prod_redis',
        driver: 'local',
        scope: 'local',
        composeProject: 'easyfire-bookkeeping-prod',
        composeVolume: 'redis',
        consumers: [REDIS_ID],
      },
    ],
    scheduledTasks: [
      {
        name: 'easyfire-bookkeeping-prod-backup',
        taskPath: '\\',
        enabled: true,
        state: 'Ready',
        xmlSha256: 'b'.repeat(64),
        executable: 'powershell.exe',
        argumentsSha256: 'c'.repeat(64),
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
        xmlSha256: 'd'.repeat(64),
        executable: 'powershell.exe',
        argumentsSha256: 'e'.repeat(64),
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
      executableSha256: 'f'.repeat(64),
      commandLineSha256: '1'.repeat(64),
      processPresent: true,
    },
    privateRoute: {
      kind: 'listener-process',
      processId: 4343,
      executablePath:
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      executableSha256: '2'.repeat(64),
      commandLineSha256: '3'.repeat(64),
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

function cutoverPlanFixture({
  initialCapturedAt = '2026-07-22T02:00:00.000Z',
  createdAt = '2026-07-22T02:01:00.000Z',
} = {}) {
  const initial = initialCutoverSnapshot(initialCapturedAt);
  const releaseCommit = '8'.repeat(40);
  const releaseRoot =
    `C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\releases\\${releaseCommit}`;
  const productionRoot = `${releaseRoot}\\scripts\\production`;
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    kind: 'easyfire-bookkeeping-direct-vm-cutover-plan',
    cutoverId: '9fa796ac-6c7b-4ace-b811-73af8553bb4e',
    createdAt,
    source: {
      host: 'NEWSEC',
      composeProject: 'easyfire-bookkeeping-prod',
      expectedInitialSnapshot: initial,
      mysqlContainerId: MYSQL_ID,
      redisContainerId: REDIS_ID,
      mysqlVolume: 'easyfire_prod_mysql',
      redisVolume: 'easyfire_prod_redis',
    },
    controller: {
      releaseCommit,
      releaseManifestPath: `${releaseRoot}\\release-manifest.json`,
      releaseManifestSha256: 'd'.repeat(64),
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      nodeSha256: '4'.repeat(64),
      contractPath: `${productionRoot}\\direct-vm-cutover-contract.mjs`,
      contractSha256: '5'.repeat(64),
      sourceControllerPath: `${productionRoot}\\direct-vm-cutover-authority.ps1`,
      sourceControllerSha256: '6'.repeat(64),
      checkpointControllerPath: `${productionRoot}\\direct-vm-preflight-checkpoint.ps1`,
      checkpointControllerSha256: '7'.repeat(64),
      checkpointV2ContractPath: `${productionRoot}\\direct-vm-checkpoint-v2-contract.mjs`,
      checkpointV2ContractSha256: '9'.repeat(64),
      finalQuiescenceContractPath: `${productionRoot}\\linux-final-quiescence-contract.mjs`,
      finalQuiescenceContractSha256: 'a'.repeat(64),
      activationEvidenceCollectorPath: `${productionRoot}\\linux-activation-evidence-collect.mjs`,
      activationEvidenceCollectorSha256: 'b'.repeat(64),
      guardianPromotionPath: `${productionRoot}\\linux-guardian-promote-active.mjs`,
      guardianPromotionSha256: 'c'.repeat(64),
      abortContractPath: `${productionRoot}\\direct-vm-source-abort-contract.mjs`,
      abortContractSha256: '8'.repeat(64),
      privateLauncherPath:
        'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\incoming\\launch-private-proxy-v2-0b7d1af8.ps1',
      privateLauncherSha256:
        'f90e275d1b941d554a15a0e8e5c2f6af7b6412033fcfa45d7e85939351a44130',
      privateLauncherChildSha256:
        '1adac5341abea3e496cf9c015b68562781d34bb985fb64d8317f6832ad1bd0b9',
    },
    evidence: {
      root: 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\direct-vm-cutover',
      authorityOwnerSid: 'S-1-5-21-111111111-222222222-333333333-1001',
      sourceQuiesceReceiptGuestPath:
        '/etc/easyfire-bookkeeping/source-quiesce-receipt.json',
      checkpointBindingGuestPath:
        '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json',
      activationEvidenceGuestPath:
        '/etc/easyfire-bookkeeping/cutover-evidence.json',
      activationAuthorizationGuestPath:
        '/etc/easyfire-bookkeeping/cutover-authorization.json',
    },
    target: {
      vmName: 'easyfire-bookkeeping-newsec',
      tailscaleDnsName: 'easyfire-bookkeeping-newsec.taild63e9b.ts.net',
      tailscaleOrigin: 'http://127.0.0.1:8080',
      authorizationMaxAgeSeconds: 900,
    },
  };
}

function postCutoverSnapshot(plan, capturedAt = '2026-07-22T02:30:00.000Z') {
  const snapshot = structuredClone(plan.source.expectedInitialSnapshot);
  snapshot.phase = 'post-quiesce';
  snapshot.capturedAt = capturedAt;
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
  Object.assign(snapshot.tunnel, {
    state: 'Stopped',
    startMode: 'Disabled',
    processId: 0,
    processPresent: false,
  });
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

const snapshotIdentity = (container) => ({
  Container: container.name,
  ImageId: container.imageId,
  ImageRef: container.imageReference,
  RestartPolicy: container.restartPolicy,
  Running: String(container.running).toLowerCase(),
  Health: container.health,
});

const snapshotRestricted = (container) => {
  const binds = container.mounts.map(
    (mount) =>
      `${mount.source}:${mount.destination}:${mount.readOnly ? 'ro' : 'rw'}`,
  );
  const portBindings = Object.fromEntries(
    container.publishedPorts.map((port) => [
      `${port.containerPort}/${port.protocol}`,
      [{ HostIp: port.hostIp, HostPort: String(port.hostPort) }],
    ]),
  );
  return {
    Id: container.id,
    Name: `/${container.name}`,
    Image: container.imageId,
    State: {
      Running: container.running,
      Status: container.state,
      ...(container.running && container.health !== 'none'
        ? { Health: { Status: container.health } }
        : {}),
    },
    HostConfig: {
      Binds: binds,
      RestartPolicy: {
        Name: container.restartPolicy,
        MaximumRetryCount: container.maximumRetryCount,
      },
      PortBindings: portBindings,
    },
    Mounts: container.mounts.map((mount) => ({
      Type: mount.type,
      Name: mount.type === 'volume' ? mount.source : undefined,
      Source: mount.source,
      Destination: mount.destination,
      RW: !mount.readOnly,
    })),
    Config: {
      Image: container.imageReference,
      Labels: {
        'com.docker.compose.project': container.composeProject,
        'com.docker.compose.service': container.composeService,
      },
    },
    NetworkSettings: {
      Networks: Object.fromEntries(container.networks.map((network) => [network, {}])),
    },
  };
};

async function makeFixture({
  payloadTimestamp = '20260721-193735',
  restoreMysqlImage = MYSQL_IMAGE,
  duplicateManifestPath = false,
  finalQuiesced = false,
  initialCapturedAt = '2026-07-22T02:00:00.000Z',
  planCreatedAt = '2026-07-22T02:01:00.000Z',
  postCapturedAt = '2026-07-22T02:30:00.000Z',
  receiptCompletedAt = '2026-07-22T02:31:00.000Z',
} = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'easyfire-checkpoint-v2-'));
  const checkpointId = 'direct-vm-preflight-20260721-193735';
  const checkpointRoot = path.join(base, checkpointId);
  const outputPath = path.join(base, 'checkpoint-authority-v2.json');
  await Promise.all([
    mkdir(path.join(checkpointRoot, 'database'), { recursive: true }),
    mkdir(path.join(checkpointRoot, 'restore-proof'), { recursive: true }),
    mkdir(path.join(checkpointRoot, 'runtime'), { recursive: true }),
    ...(finalQuiesced
      ? [mkdir(path.join(checkpointRoot, 'inputs'), { recursive: true })]
      : []),
  ]);

  let finalContext;
  if (finalQuiesced) {
    const cutoverPlan = cutoverPlanFixture({
      initialCapturedAt,
      createdAt: planCreatedAt,
    });
    const sourceSnapshot = postCutoverSnapshot(cutoverPlan, postCapturedAt);
    const cutoverPlanPath = path.join(base, 'cutover-plan.json');
    const sourceSnapshotPath = path.join(base, 'post-quiesce-snapshot.json');
    const quiesceReceiptPath = path.join(base, 'source-quiesce-receipt.json');
    const planBytes = await writeJson(cutoverPlanPath, cutoverPlan);
    const snapshotBytes = await writeJson(sourceSnapshotPath, sourceSnapshot);
    const beforeBytes = jsonBytes(cutoverPlan.source.expectedInitialSnapshot);
    const quiesceReceipt = cutoverContract.buildSourceQuiesceReceipt({
      plan: cutoverPlan,
      planSha256: sha256(planBytes),
      before: cutoverPlan.source.expectedInitialSnapshot,
      beforeSha256: sha256(beforeBytes),
      after: sourceSnapshot,
      afterSha256: sha256(snapshotBytes),
      completedAt: receiptCompletedAt,
    });
    const receiptBytes = await writeJson(quiesceReceiptPath, quiesceReceipt);
    await writeFile(
      path.join(checkpointRoot, 'inputs', 'source-quiesce-receipt.json'),
      receiptBytes,
    );
    finalContext = {
      cutoverPlan,
      sourceSnapshot,
      quiesceReceipt,
      cutoverPlanPath,
      sourceSnapshotPath,
      quiesceReceiptPath,
    };
  }

  const sqlName = `easyfire-app-${payloadTimestamp}.sql.gz`;
  const redisName = `easyfire-redis-${payloadTimestamp}.rdb`;
  const sqlBytes = Buffer.from('synthetic-gzip-sql-payload');
  const redisBytes = Buffer.from('synthetic-redis-rdb-payload');
  await writeFile(path.join(checkpointRoot, 'database', sqlName), sqlBytes);
  await writeFile(path.join(checkpointRoot, 'database', redisName), redisBytes);

  const liveIdentities = [
    {
      Container: 'easyfire-mysql',
      ImageId: MYSQL_IMAGE,
      ImageRef: MYSQL_REF,
      RestartPolicy: 'unless-stopped',
      Running: 'true',
      Health: 'healthy',
    },
    {
      Container: 'easyfire-redis',
      ImageId: REDIS_IMAGE,
      ImageRef: REDIS_REF,
      RestartPolicy: 'unless-stopped',
      Running: 'true',
      Health: 'healthy',
    },
  ];
  const liveRestricted = [
    {
      Id: MYSQL_ID,
      Name: '/easyfire-mysql',
      Image: MYSQL_IMAGE,
      HostConfig: {
        Binds: ['easyfire_prod_mysql:/var/lib/mysql:rw'],
        RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      },
      Mounts: [
        {
          Type: 'volume',
          Name: 'easyfire_prod_mysql',
          Destination: '/var/lib/mysql',
          RW: true,
        },
      ],
      Config: {
        Image: MYSQL_REF,
        Labels: {
          'com.docker.compose.project': 'easyfire-bookkeeping-prod',
          'com.docker.compose.service': 'mysql',
        },
      },
    },
    {
      Id: REDIS_ID,
      Name: '/easyfire-redis',
      Image: REDIS_IMAGE,
      HostConfig: {
        Binds: ['easyfire_prod_redis:/data:rw'],
        RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      },
      Mounts: [
        {
          Type: 'volume',
          Name: 'easyfire_prod_redis',
          Destination: '/data',
          RW: true,
        },
      ],
      Config: {
        Image: REDIS_REF,
        Labels: {
          'com.docker.compose.project': 'easyfire-bookkeeping-prod',
          'com.docker.compose.service': 'redis',
        },
      },
    },
  ];
  const identities = finalQuiesced
    ? finalContext.sourceSnapshot.containers.map(snapshotIdentity)
    : liveIdentities;
  const restricted = finalQuiesced
    ? finalContext.sourceSnapshot.containers.map(snapshotRestricted)
    : liveRestricted;
  const volume = (name, role) => [
    {
      Driver: 'local',
      Labels: {
        'com.docker.compose.project': 'easyfire-bookkeeping-prod',
        'com.docker.compose.volume': role,
      },
      Name: name,
      Scope: 'local',
    },
  ];
  await writeJson(
    path.join(checkpointRoot, 'runtime', 'container-identities.json'),
    identities,
  );
  await writeJson(
    path.join(checkpointRoot, 'runtime', 'containers.restricted.json'),
    restricted,
  );
  await writeJson(
    path.join(checkpointRoot, 'runtime', 'easyfire_prod_mysql.json'),
    volume('easyfire_prod_mysql', 'mysql'),
  );
  await writeJson(
    path.join(checkpointRoot, 'runtime', 'easyfire_prod_redis.json'),
    volume('easyfire_prod_redis', 'redis'),
  );
  const restoreInstructions = Buffer.from('synthetic restore instructions\n');
  await writeFile(path.join(checkpointRoot, 'RESTORE.md'), restoreInstructions);

  const checkpoint = {
    schemaVersion: 1,
    checkpointId,
    status: 'preflight-verified',
    createdAt: '2026-07-22T02:38:03.8122270Z',
    host: 'NEWSEC',
    intent:
      'Direct-to-VM migration recovery checkpoint; no source runtime resources removed.',
    liveEndpoint: 'http://100.84.66.30:25186',
    databaseCount: 2,
    databaseNames: ['easyfire_system', 'easyfire_tenant_11zwei1mruexcl9'],
    activeContainers: identities,
    sourceVolumes: ['easyfire_prod_mysql', 'easyfire_prod_redis'],
    preservedRestoreContainer: 'easyfire-direct-vm-restore-20260721-193735',
    preservedRestoreVolume: 'easyfire_direct_vm_restore_20260721_193735',
    secondaryCopy: `E:\\EasyFire Bookkeeping Recovery\\direct-vm-preflight\\${checkpointId}`,
  };
  await writeJson(path.join(checkpointRoot, 'checkpoint.json'), checkpoint);

  const restoreProof = {
    schemaVersion: 1,
    status: 'passed',
    createdAt: '2026-07-22T02:38:03.5467122Z',
    sourceHost: 'NEWSEC',
    sourceContainer: 'easyfire-mysql',
    sourceImage: restoreMysqlImage,
    sourceVolume: 'easyfire_prod_mysql',
    databases: checkpoint.databaseNames,
    backupFile: sqlName,
    backupBytes: sqlBytes.length,
    backupSha256: sha256(sqlBytes).toUpperCase(),
    redisFile: redisName,
    redisBytes: redisBytes.length,
    redisSha256: sha256(redisBytes).toUpperCase(),
    restoreContainer: 'easyfire-direct-vm-restore-20260721-193735',
    restoreVolume: 'easyfire_direct_vm_restore_20260721_193735',
    restoreNetwork: 'none',
    restoreState: 'stopped-preserved',
    schemaTableCounts: [
      'easyfire_system\t17',
      'easyfire_tenant_11zwei1mruexcl9\t70',
    ],
    identityInvariants: 'users=1;tenants=1;tenant_metadata=1;user_tenants=1',
    mariadbCheckLineCount: 116,
  };
  await writeJson(
    path.join(checkpointRoot, 'restore-proof', 'isolated-restore-proof.json'),
    restoreProof,
  );

  const manifestPaths = [
    'checkpoint.json',
    `database\\${sqlName}`,
    `database\\${redisName}`,
    'restore-proof\\isolated-restore-proof.json',
    'runtime\\container-identities.json',
    'runtime\\containers.restricted.json',
    'runtime\\easyfire_prod_mysql.json',
    'runtime\\easyfire_prod_redis.json',
    ...(finalQuiesced ? ['inputs\\source-quiesce-receipt.json'] : []),
  ];
  const entries = [];
  for (const relativePath of manifestPaths) {
    entries.push(await metadataFor(checkpointRoot, relativePath));
  }
  if (duplicateManifestPath) {
    const duplicate = structuredClone(entries[1]);
    duplicate.Path = duplicate.Path.toUpperCase();
    entries.push(duplicate);
  }
  const manifestBytes = await writeJson(
    path.join(checkpointRoot, 'files.sha256.json'),
    entries,
  );
  const entryBytes = entries.reduce((total, entry) => total + entry.Bytes, 0);

  const primary = `C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\backups\\${checkpointId}`;
  const secondary = checkpoint.secondaryCopy;
  const dual = {
    schemaVersion: 1,
    status: 'passed',
    verifiedAt: '2026-07-22T02:42:01.7501093Z',
    primary,
    secondary,
    fileCount: entries.length + 1,
    totalBytes: entryBytes + manifestBytes.length,
    checkpointSha256: sha256(await readFile(path.join(checkpointRoot, 'checkpoint.json'))).toUpperCase(),
  };
  const dualBytes = await writeJson(
    path.join(checkpointRoot, 'dual-location-verification.json'),
    dual,
  );
  const recovery = {
    schemaVersion: 2,
    status: 'passed',
    verifiedAt: '2026-07-22T02:44:02.1459647Z',
    primary,
    secondary,
    priorDualLocationVerificationSha256: sha256(dualBytes).toUpperCase(),
    priorFileManifestSha256: sha256(manifestBytes).toUpperCase(),
    restoreInstructionsSha256: sha256(restoreInstructions).toUpperCase(),
    databaseBackupSha256: sha256(sqlBytes).toUpperCase(),
    isolatedRestoreProof: 'passed',
    sourceRuntime: 'preserved',
  };
  await writeJson(
    path.join(checkpointRoot, 'recovery-unit-verification-v2.json'),
    recovery,
  );
  return {
    base,
    checkpointRoot,
    outputPath,
    sqlBytes,
    redisBytes,
    ...finalContext,
  };
}

function validPlan(authority) {
  const commit = 'a'.repeat(40);
  const releasePath = `/opt/easyfire-bookkeeping/releases/${commit}`;
  return {
    schemaVersion: 1,
    deploymentId: 'direct-vm-20260721-abcdef12',
    project: 'easyfire-bookkeeping-prod',
    releaseCommit: commit,
    releasePath,
    currentReleasePath: '/opt/easyfire-bookkeeping/current',
    releaseManifest: { path: `${releasePath}/release-manifest.json`, sha256: '1'.repeat(64) },
    sourceArchive: { path: '/var/lib/easyfire-bookkeeping-staging/source.tar.gz', sha256: '2'.repeat(64) },
    imageBundle: { path: '/var/lib/easyfire-bookkeeping-staging/images.tar', sha256: '3'.repeat(64) },
    environment: { path: '/etc/easyfire-bookkeeping/production.env', sha256: '4'.repeat(64) },
    checkpoint: {
      manifestPath: '/var/lib/easyfire-bookkeeping-staging/checkpoint.json',
      manifestSha256: '5'.repeat(64),
      durableManifestPath: '/etc/easyfire-bookkeeping/checkpoint-manifest.json',
      sqlGzipPath: '/var/lib/easyfire-bookkeeping-staging/database.sql.gz',
      sqlGzipSha256: authority.payloads.sqlGzip.sha256,
      redisRdbPath: '/var/lib/easyfire-bookkeeping-staging/dump.rdb',
      redisRdbSha256: authority.payloads.redisRdb.sha256,
    },
    composeFiles: [
      `${releasePath}/docker-compose.prod.yml`,
      `${releasePath}/deploy/linux/docker-compose.vm.yml`,
      `${releasePath}/deploy/linux/docker-compose.candidate.yml`,
    ],
    runtimeManifestGeneratorPath: '/opt/easyfire-bookkeeping/guardian/runtime-manifest-generator.js',
    outputs: {
      runtimeManifestPath: '/etc/easyfire-bookkeeping/runtime-manifest.json',
      runtimeIdentityEvidencePath: '/etc/easyfire-bookkeeping/runtime-identity-evidence.json',
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
        planContract.PROTECTED_ACCOUNTING_TABLES.map((table) => [table, 0]),
      ),
      redisKeyUpperBound: 35,
    },
  };
}

test('producer emits deterministic, secret-free checkpoint transfer authority v2', async () => {
  const fixture = await makeFixture();
  const authority = await producer.produceCheckpointTransferAuthority({
    checkpointRoot: fixture.checkpointRoot,
    outputPath: fixture.outputPath,
  });
  assert.equal(authority.schemaVersion, 2);
  assert.equal(authority.status, 'verified');
  assert.equal(authority.checkpointId, 'direct-vm-preflight-20260721-193735');
  assert.equal(authority.source.mysql.containerId, MYSQL_ID);
  assert.equal(authority.source.redis.containerId, REDIS_ID);
  assert.equal(authority.payloads.sqlGzip.bytes, fixture.sqlBytes.length);
  assert.equal(authority.payloads.redisRdb.bytes, fixture.redisBytes.length);
  assert.deepEqual(authority.isolatedRestore.identityCounts, {
    users: 1,
    tenants: 1,
    tenantMetadata: 1,
    userTenants: 1,
  });
  const firstBytes = await readFile(fixture.outputPath);
  assert.deepEqual(JSON.parse(firstBytes), authority);
  assert.equal(
    sha256(firstBytes),
    'fe9d35246c3b7ddaea7dd3ac465591a57098ee2fffb8ccda51b5ff99edb26ac7',
  );
  assert.doesNotMatch(firstBytes.toString('utf8'), /PASSWORD|Config\.Env|synthetic-gzip-sql-payload/);

  const second = await makeFixture();
  await producer.produceCheckpointTransferAuthority({
    checkpointRoot: second.checkpointRoot,
    outputPath: second.outputPath,
  });
  assert.deepEqual(await readFile(second.outputPath), firstBytes);
});

test('producer rejects cross-checkpoint payload names and mixed proof authority', async () => {
  const mixedTimestamp = await makeFixture({ payloadTimestamp: '20260721-194000' });
  await assert.rejects(
    producer.produceCheckpointTransferAuthority({
      checkpointRoot: mixedTimestamp.checkpointRoot,
      outputPath: mixedTimestamp.outputPath,
    }),
    /timestamp|checkpoint/i,
  );

  const mixedRestore = await makeFixture({
    restoreMysqlImage: `sha256:${'9'.repeat(64)}`,
  });
  await assert.rejects(
    producer.produceCheckpointTransferAuthority({
      checkpointRoot: mixedRestore.checkpointRoot,
      outputPath: mixedRestore.outputPath,
    }),
    /source image|mysql/i,
  );
});

test('producer rejects size or hash drift, duplicate files, and output overwrite', async () => {
  const drift = await makeFixture();
  await writeFile(
    path.join(drift.checkpointRoot, 'database', 'easyfire-app-20260721-193735.sql.gz'),
    Buffer.from('different payload bytes'),
  );
  await assert.rejects(
    producer.produceCheckpointTransferAuthority({
      checkpointRoot: drift.checkpointRoot,
      outputPath: drift.outputPath,
    }),
    /bytes|sha-?256|hash/i,
  );

  const duplicate = await makeFixture({ duplicateManifestPath: true });
  await assert.rejects(
    producer.produceCheckpointTransferAuthority({
      checkpointRoot: duplicate.checkpointRoot,
      outputPath: duplicate.outputPath,
    }),
    /duplicate/i,
  );

  const overwrite = await makeFixture();
  await producer.produceCheckpointTransferAuthority({
    checkpointRoot: overwrite.checkpointRoot,
    outputPath: overwrite.outputPath,
  });
  const before = await readFile(overwrite.outputPath);
  await assert.rejects(
    producer.produceCheckpointTransferAuthority({
      checkpointRoot: overwrite.checkpointRoot,
      outputPath: overwrite.outputPath,
    }),
    /already exists|exclusive/i,
  );
  assert.deepEqual(await readFile(overwrite.outputPath), before);
});

test('deployment consumer requires exact v2 payload hashes and byte sizes', async () => {
  const fixture = await makeFixture();
  const authority = await producer.produceCheckpointTransferAuthority({
    checkpointRoot: fixture.checkpointRoot,
    outputPath: fixture.outputPath,
  });
  const plan = validPlan(authority);
  planContract.validateCheckpointManifest(authority, plan);
  planContract.validateCheckpointPayloadFiles(authority, plan, {
    sqlGzip: { sha256: sha256(fixture.sqlBytes), bytes: fixture.sqlBytes.length },
    redisRdb: { sha256: sha256(fixture.redisBytes), bytes: fixture.redisBytes.length },
  });

  const v1 = { schemaVersion: 1, status: 'preflight-verified' };
  assert.throws(
    () => planContract.validateCheckpointManifest(v1, plan),
    /schemaVersion|authority|missing fields/i,
  );

  const mixedPlan = structuredClone(plan);
  mixedPlan.checkpoint.redisRdbSha256 = '8'.repeat(64);
  assert.throws(
    () => planContract.validateCheckpointManifest(authority, mixedPlan),
    /redis|payload|checkpoint/i,
  );

  assert.throws(
    () =>
      planContract.validateCheckpointPayloadFiles(authority, plan, {
        sqlGzip: { sha256: sha256(fixture.sqlBytes), bytes: fixture.sqlBytes.length + 1 },
        redisRdb: { sha256: sha256(fixture.redisBytes), bytes: fixture.redisBytes.length },
      }),
    /bytes|size/i,
  );
});

const finalProducerInputs = (fixture) => ({
  checkpointRoot: fixture.checkpointRoot,
  outputPath: fixture.outputPath,
  quiesceReceiptPath: fixture.quiesceReceiptPath,
  cutoverPlanPath: fixture.cutoverPlanPath,
  sourceSnapshotPath: fixture.sourceSnapshotPath,
});

test('explicit final mode binds the exact quiesce receipt, plan, source snapshot, and zero-writer state', async () => {
  const fixture = await makeFixture({ finalQuiesced: true });
  const authority = await producer.produceCheckpointTransferAuthority(
    finalProducerInputs(fixture),
  );
  assert.equal(authority.finalQuiescence.schemaVersion, 1);
  assert.equal(authority.finalQuiescence.mode, 'final-quiesced');
  assert.equal(
    authority.finalQuiescence.cutoverId,
    fixture.cutoverPlan.cutoverId,
  );
  assert.equal(
    authority.finalQuiescence.quiesceReceipt.sha256,
    sha256(await readFile(fixture.quiesceReceiptPath)),
  );
  assert.equal(
    authority.finalQuiescence.sourceSnapshot.sha256,
    sha256(await readFile(fixture.sourceSnapshotPath)),
  );
  assert.deepEqual(authority.finalQuiescence.sourceSnapshot.writerProof, {
    applicationContainersRunning: 0,
    mysqlNonSystemConnections: 0,
    mysqlEventScheduler: 'OFF',
    mysqlEnabledEvents: 0,
    redisExternalClients: 0,
  });
  assert.equal(authority.finalQuiescence.dataContainers.length, 2);
  assert.equal(authority.finalQuiescence.statelessContainers.length, 6);
  assert.ok(
    authority.finalQuiescence.statelessContainers.every(
      ({ restartPolicy, running, state }) =>
        restartPolicy === 'no' && running === false && state === 'exited',
    ),
  );

  const deploymentPlan = validPlan(authority);
  planContract.validateCheckpointManifest(authority, deploymentPlan, {
    requireFinalQuiescence: true,
  });
  planContract.validateCheckpointPayloadFiles(
    authority,
    deploymentPlan,
    {
      sqlGzip: {
        sha256: sha256(fixture.sqlBytes),
        bytes: fixture.sqlBytes.length,
      },
      redisRdb: {
        sha256: sha256(fixture.redisBytes),
        bytes: fixture.redisBytes.length,
      },
    },
    { requireFinalQuiescence: true },
  );
});

test('final mode rejects forged or mixed receipt/snapshot authority', async () => {
  const forged = await makeFixture({ finalQuiesced: true });
  const forgedReceipt = structuredClone(forged.quiesceReceipt);
  forgedReceipt.contentSha256 = '0'.repeat(64);
  await writeJson(forged.quiesceReceiptPath, forgedReceipt);
  await assert.rejects(
    producer.produceCheckpointTransferAuthority(finalProducerInputs(forged)),
    /receipt|hash|binding|match/i,
  );

  const mixed = await makeFixture({ finalQuiesced: true });
  const mixedSnapshot = structuredClone(mixed.sourceSnapshot);
  mixedSnapshot.capturedAt = '2026-07-22T02:30:01.000Z';
  await writeJson(mixed.sourceSnapshotPath, mixedSnapshot);
  await assert.rejects(
    producer.produceCheckpointTransferAuthority(finalProducerInputs(mixed)),
    /snapshot|binding|hash/i,
  );
});

test('final mode rejects stale receipts and partial opt-in inputs', async () => {
  const stale = await makeFixture({
    finalQuiesced: true,
    initialCapturedAt: '2026-07-22T00:00:00.000Z',
    planCreatedAt: '2026-07-22T00:01:00.000Z',
    postCapturedAt: '2026-07-22T00:30:00.000Z',
    receiptCompletedAt: '2026-07-22T00:31:00.000Z',
  });
  await assert.rejects(
    producer.produceCheckpointTransferAuthority(finalProducerInputs(stale)),
    /stale|chronology/i,
  );

  const partial = await makeFixture({ finalQuiesced: true });
  await assert.rejects(
    producer.produceCheckpointTransferAuthority({
      checkpointRoot: partial.checkpointRoot,
      outputPath: partial.outputPath,
      quiesceReceiptPath: partial.quiesceReceiptPath,
    }),
    /requires|together|arguments/i,
  );
});

test('consumer rejects absent or mutated final-quiescence proof when explicitly required', async () => {
  const normal = await makeFixture();
  const normalAuthority = await producer.produceCheckpointTransferAuthority({
    checkpointRoot: normal.checkpointRoot,
    outputPath: normal.outputPath,
  });
  assert.throws(
    () =>
      planContract.validateCheckpointManifest(
        normalAuthority,
        validPlan(normalAuthority),
        { requireFinalQuiescence: true },
      ),
    /final-quiesced|required|quiescence/i,
  );

  const final = await makeFixture({ finalQuiesced: true });
  const finalAuthority = await producer.produceCheckpointTransferAuthority(
    finalProducerInputs(final),
  );
  const mutated = structuredClone(finalAuthority);
  mutated.finalQuiescence.sourceSnapshot.writerProof.mysqlNonSystemConnections = 1;
  assert.throws(
    () =>
      planContract.validateCheckpointManifest(mutated, validPlan(finalAuthority), {
        requireFinalQuiescence: true,
      }),
    /writer|zero|quiescence/i,
  );
});
