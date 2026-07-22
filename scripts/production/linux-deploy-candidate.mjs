#!/usr/bin/env node

import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ALL_SERVICES,
  buildActivationResult,
  buildComposeArguments,
  buildDeploymentReceipt,
  buildMigrationReceipt,
  buildStartupGateAuthority,
  DeploymentRefusal,
  FIXED_PLAN_PATH,
  isObject,
  LONG_RUNNING_SERVICES,
  MAX_COMMAND_OUTPUT,
  PROJECT,
  PROTECTED_ACCOUNTING_TABLES,
  refuse,
  RELEASE_ROLES,
  SERVICE_CONTRACT,
  STATELESS_SERVICES,
  validateDeploymentPlan,
} from './linux-deploy-plan.mjs';
import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
import {
  assertNoExistingDockerResources,
  docker,
  getDockerIdentity,
  inspectContainers,
  inspectMigration,
  validateComposeConfig,
  verifyContainerContract,
  verifyCreatedResources,
  verifyExistingResources,
  verifyLoadedImages,
  verifyRunningHealth,
  verifyRuntimeContainerState,
} from './linux-deploy-docker.mjs';
import {
  assertCompletedMigration,
  assertDeploymentOutputsAbsent,
  assertDockerIdentityEqual,
  assertFreshMigration,
  assertHashField,
  collectBoundInputs,
  createDeploymentJournal,
  ensureLinuxRoot,
  localHttpProbe,
  pathExists,
  readVerifiedDeploymentChain,
  restoreDatabase,
  runRuntimeManifestGenerator,
  sha256Bytes,
  sha256File,
  validateDatabaseState,
  validateRuntimeDocuments,
  verifyFileHash,
  writeBytesExclusive,
  writeFailureJournal,
  writeJsonExclusive,
} from './linux-deploy-authority.mjs';

export {
  ALL_SERVICES,
  buildActivationResult,
  buildComposeArguments,
  buildDeploymentReceipt,
  buildMigrationReceipt,
  buildStartupGateAuthority,
  PROTECTED_ACCOUNTING_TABLES,
  validateDeploymentPlan,
  writeJsonExclusive,
};

const assertMigrationNameInvariant = () => {
  if (
    SERVICE_CONTRACT.database_migration.name !==
    'easyfire-bookkeeping-migration'
  ) {
    refuse('E_CONTROLLER_CONTRACT', 'Migration container contract drifted.');
  }
};

export async function executeDeployment(planPath) {
  ensureLinuxRoot();
  assertMigrationNameInvariant();
  let phase = 'read-only-preflight';
  let journalPath = null;
  let migrationMayHaveStarted = false;

  try {
    const inputs = await collectBoundInputs(planPath, { fixedPlan: false });
    const { plan, releaseManifest, environment } = inputs;
    await assertDeploymentOutputsAbsent(plan);
    const dockerIdentity = await getDockerIdentity();
    await assertNoExistingDockerResources(plan, releaseManifest);
    const composeConfigSha256 = await validateComposeConfig(
      plan,
      releaseManifest,
    );

    phase = 'journal-authority';
    journalPath = await createDeploymentJournal(inputs, dockerIdentity);
    await writeBytesExclusive(FIXED_PLAN_PATH, inputs.planBytes);
    await writeBytesExclusive(
      plan.checkpoint.durableManifestPath,
      inputs.checkpointBytes,
    );

    phase = 'image-load';
    await docker(['image', 'load', '--input', plan.imageBundle.path], {
      label: 'Exact release image-bundle load',
      timeoutMs: 900_000,
      maxOutputBytes: MAX_COMMAND_OUTPUT,
    });
    const imageIdentities = await verifyLoadedImages(releaseManifest);
    await writeJsonExclusive(`${journalPath}/loaded-images.json`, {
      schemaVersion: 1,
      status: 'verified',
      images: imageIdentities,
    });

    phase = 'candidate-create';
    await docker(
      buildComposeArguments(plan, [
        'create',
        '--pull',
        'never',
        '--no-build',
        ...ALL_SERVICES,
      ]),
      {
        label: 'Candidate container creation',
        timeoutMs: 300_000,
        maxOutputBytes: MAX_COMMAND_OUTPUT,
      },
    );
    const createdResources = await verifyCreatedResources(
      plan,
      releaseManifest,
    );
    await writeJsonExclusive(`${journalPath}/created-resources.json`, {
      schemaVersion: 1,
      status: 'created-stopped',
      ...createdResources,
    });

    phase = 'redis-seed';
    await docker(
      [
        'container',
        'cp',
        plan.checkpoint.redisRdbPath,
        `${SERVICE_CONTRACT.redis.name}:/data/dump.rdb`,
      ],
      {
        label: 'Stopped Redis checkpoint seed',
        timeoutMs: 60_000,
        maxOutputBytes: 1024 * 1024,
      },
    );

    phase = 'data-services-start';
    await docker(
      buildComposeArguments(plan, [
        'start',
        '--wait',
        '--wait-timeout',
        '180',
        'mysql',
        'redis',
      ]),
      {
        label: 'MariaDB and Redis candidate start',
        timeoutMs: 240_000,
        maxOutputBytes: MAX_COMMAND_OUTPUT,
      },
    );
    await verifyRunningHealth(['mysql', 'redis'], plan, releaseManifest);

    phase = 'database-restore';
    await restoreDatabase(plan, environment);
    const restoredDataProof = await validateDatabaseState(
      plan,
      environment,
      'post-restore',
    );
    await writeJsonExclusive(`${journalPath}/restore-proof.json`, {
      schemaVersion: 1,
      status: 'validated',
      ...restoredDataProof,
    });

    phase = 'migration-authority';
    const migrationBefore = await inspectMigration(plan, releaseManifest);
    // assertFreshMigration requires State.Status === 'created' and never started.
    assertFreshMigration(migrationBefore);
    await writeJsonExclusive(`${journalPath}/migration-start-authority.json`, {
      schemaVersion: 1,
      project: PROJECT,
      deploymentId: plan.deploymentId,
      status: 'authorized-once',
      authorizedAt: new Date().toISOString(),
      planSha256: inputs.planSha256,
      containerName: SERVICE_CONTRACT.database_migration.name,
      containerId: migrationBefore.Id,
      engineImageId: migrationBefore.Image,
      initialState: migrationBefore.State.Status,
      initialStartedAt: migrationBefore.State.StartedAt,
      initialFinishedAt: migrationBefore.State.FinishedAt,
      retryAuthorized: false,
    });

    phase = 'migration-running';
    migrationMayHaveStarted = true;
    await docker(
      ['start', '--attach', SERVICE_CONTRACT.database_migration.name],
      {
        label: 'Once-only database migration',
        timeoutMs: 600_000,
        maxOutputBytes: MAX_COMMAND_OUTPUT,
      },
    );
    const migrationAfter = await inspectMigration(plan, releaseManifest);
    if (
      migrationAfter.Id !== migrationBefore.Id ||
      migrationAfter.Image !== migrationBefore.Image
    ) {
      refuse(
        'E_MIGRATION_IDENTITY',
        'Migration container identity changed while running.',
      );
    }
    const migrationTimes = assertCompletedMigration(migrationAfter);
    await writeJsonExclusive(`${journalPath}/migration-result.json`, {
      schemaVersion: 1,
      status: 'exited-zero',
      containerId: migrationAfter.Id,
      engineImageId: migrationAfter.Image,
      exitCode: migrationAfter.State.ExitCode,
      startedAt: migrationTimes.startedAt,
      completedAt: migrationTimes.completedAt,
    });

    phase = 'post-migration-data-validation';
    const migratedDataProof = await validateDatabaseState(
      plan,
      environment,
      'post-migration',
    );
    const migrationReceipt = buildMigrationReceipt({
      plan,
      migrationContainer: migrationAfter,
      migrationTimes,
      dataProof: migratedDataProof,
    });
    await writeJsonExclusive(
      plan.outputs.migrationReceiptPath,
      migrationReceipt,
    );
    const migrationReceiptSha256 = await sha256File(
      plan.outputs.migrationReceiptPath,
    );

    phase = 'startup-gate-authority';
    const startupGateAuthorityPath =
      `${journalPath}/startup-gate-authority.json`;
    await writeJsonExclusive(
      startupGateAuthorityPath,
      buildStartupGateAuthority({
        plan,
        planSha256: inputs.planSha256,
        migrationReceiptSha256,
        authorizedAt: new Date().toISOString(),
      }),
    );
    const startupGateAuthoritySha256 = await sha256File(
      startupGateAuthorityPath,
    );

    phase = 'application-start';
    await docker(
      buildComposeArguments(plan, [
        'start',
        '--wait',
        '--wait-timeout',
        '180',
        ...STATELESS_SERVICES,
      ]),
      {
        label: 'Remaining candidate service start',
        timeoutMs: 240_000,
        maxOutputBytes: MAX_COMMAND_OUTPUT,
      },
    );
    await verifyRunningHealth(LONG_RUNNING_SERVICES, plan, releaseManifest);
    const httpProof = [];
    for (const pathname of ['/', '/api/system_db', '/api/auth/meta']) {
      httpProof.push(await localHttpProbe(pathname));
    }

    phase = 'runtime-identity';
    await runRuntimeManifestGenerator(plan, false);
    const runtimeHashes = await validateRuntimeDocuments(
      plan,
      createdResources,
    );
    await runRuntimeManifestGenerator(plan, true);

    phase = 'deployment-evidence';
    const deploymentEvidence = {
      schemaVersion: 1,
      project: PROJECT,
      deploymentId: plan.deploymentId,
      status: 'candidate-validated',
      validatedAt: new Date().toISOString(),
      releaseCommit: plan.releaseCommit,
      planSha256: inputs.planSha256,
      migrationReceiptSha256,
      runtimeManifestSha256: runtimeHashes.runtimeManifestSha256,
      runtimeIdentityEvidenceSha256:
        runtimeHashes.runtimeIdentityEvidenceSha256,
      inputSha256: {
        checkpointManifest: plan.checkpoint.manifestSha256,
        durableCheckpointManifest: await sha256File(
          plan.checkpoint.durableManifestPath,
        ),
        releaseManifest: plan.releaseManifest.sha256,
        sourceArchive: plan.sourceArchive.sha256,
        imageBundle: plan.imageBundle.sha256,
        environment: plan.environment.sha256,
        sqlGzip: plan.checkpoint.sqlGzipSha256,
        redisRdb: plan.checkpoint.redisRdbSha256,
        runtimeManifestGenerator: inputs.runtimeManifestGeneratorSha256,
        compose: inputs.composeSha256,
      },
      composeConfigSha256,
      dockerEngine: dockerIdentity,
      resources: createdResources,
      images: imageIdentities,
      restoredDataProof,
      migratedDataProof,
      httpProof,
    };
    await writeJsonExclusive(
      `${journalPath}/deployment-evidence.json`,
      deploymentEvidence,
    );
    const deploymentEvidenceSha256 = await sha256File(
      `${journalPath}/deployment-evidence.json`,
    );

    phase = 'activation-proof';
    const activatedContainers = await verifyRunningHealth(
      LONG_RUNNING_SERVICES,
      plan,
      releaseManifest,
    );
    const migrationFinal = await inspectMigration(plan, releaseManifest);
    const migrationFinalTimes = assertCompletedMigration(migrationFinal);
    if (
      migrationFinal.Id !== migrationAfter.Id ||
      migrationFinal.Image !== migrationAfter.Image ||
      migrationFinalTimes.startedAt !== migrationTimes.startedAt ||
      migrationFinalTimes.completedAt !== migrationTimes.completedAt
    ) {
      refuse(
        'E_MIGRATION_DRIFT',
        'Migration identity changed during candidate activation.',
      );
    }
    const activationResultPath = `${journalPath}/activation-result.json`;
    await writeJsonExclusive(
      activationResultPath,
      buildActivationResult({
        plan,
        planSha256: inputs.planSha256,
        startupGateAuthoritySha256,
        deploymentEvidenceSha256,
        activatedAt: new Date().toISOString(),
        containers: activatedContainers,
        migration: {
          containerName: SERVICE_CONTRACT.database_migration.name,
          containerId: migrationFinal.Id,
          imageId: migrationFinal.Image,
          state: 'exited',
          exitCode: 0,
          startedAt: migrationFinalTimes.startedAt,
          completedAt: migrationFinalTimes.completedAt,
          restartPolicy: 'no',
        },
      }),
    );

    phase = 'final-receipt';
    const deploymentReceipt = buildDeploymentReceipt({
      plan,
      planSha256: inputs.planSha256,
      migrationReceiptSha256,
      runtimeManifestSha256: runtimeHashes.runtimeManifestSha256,
      runtimeIdentityEvidenceSha256:
        runtimeHashes.runtimeIdentityEvidenceSha256,
      completedAt: new Date().toISOString(),
    });
    const deploymentReceiptSha256 = sha256Bytes(
      Buffer.from(`${JSON.stringify(deploymentReceipt, null, 2)}\n`),
    );
    await writeJsonExclusive(
      plan.outputs.deploymentReceiptPath,
      deploymentReceipt,
    );

    return {
      deploymentId: plan.deploymentId,
      releaseCommit: plan.releaseCommit,
      deploymentReceiptSha256,
    };
  } catch (error) {
    try {
      await writeFailureJournal(
        journalPath,
        phase,
        error,
        migrationMayHaveStarted,
      );
    } catch {
      throw new DeploymentRefusal(
        'E_FAILURE_JOURNAL',
        'Deployment failed and its failure journal could not be published.',
      );
    }
    throw error;
  }
}

export async function verifyExistingDeployment(planPath = FIXED_PLAN_PATH) {
  ensureLinuxRoot();
  assertMigrationNameInvariant();
  if (await pathExists('/etc/easyfire-bookkeeping/rollback.lock')) {
    refuse('E_ROLLBACK_LOCK', 'Rollback lock is present.');
  }

  const inputs = await collectBoundInputs(planPath, { fixedPlan: true });
  const { plan, releaseManifest } = inputs;
  await verifyFileHash(
    plan.checkpoint.durableManifestPath,
    plan.checkpoint.manifestSha256,
    { exactMode: 0o600 },
  );
  const durableCheckpoint = await readFile(
    plan.checkpoint.durableManifestPath,
  );
  if (
    durableCheckpoint.length !== inputs.checkpointBytes.length ||
    !timingSafeEqual(durableCheckpoint, inputs.checkpointBytes)
  ) {
    refuse(
      'E_CHECKPOINT_DRIFT',
      'Durable checkpoint manifest differs from its source bytes.',
    );
  }

  const chain = await readVerifiedDeploymentChain(inputs);
  const { deploymentReceipt, evidence, migration, activationResult } = chain;
  const createdResources = evidence.resources;
  if (
    !isObject(createdResources) ||
    !isObject(createdResources.containers) ||
    !/^[a-f0-9]{64}$/.test(createdResources.networkId ?? '')
  ) {
    refuse(
      'E_RECEIPT_RESOURCES',
      'Deployment journal resource identities are invalid.',
    );
  }
  await verifyExistingResources(plan, createdResources);
  assertHashField(
    evidence.composeConfigSha256,
    await validateComposeConfig(plan, releaseManifest),
    'Compose configuration',
  );
  const runtimeHashes = await validateRuntimeDocuments(
    plan,
    createdResources,
  );
  for (const [label, actual, expected] of [
    [
      'Runtime manifest',
      deploymentReceipt.runtimeManifestSha256,
      runtimeHashes.runtimeManifestSha256,
    ],
    [
      'Runtime identity evidence',
      deploymentReceipt.runtimeIdentityEvidenceSha256,
      runtimeHashes.runtimeIdentityEvidenceSha256,
    ],
    [
      'Journal runtime manifest',
      evidence.runtimeManifestSha256,
      runtimeHashes.runtimeManifestSha256,
    ],
    [
      'Journal runtime identity evidence',
      evidence.runtimeIdentityEvidenceSha256,
      runtimeHashes.runtimeIdentityEvidenceSha256,
    ],
  ]) {
    assertHashField(actual, expected, label);
  }

  assertDockerIdentityEqual(await getDockerIdentity(), evidence.dockerEngine);
  const imageIdentities = await verifyLoadedImages(releaseManifest);
  for (const role of RELEASE_ROLES) {
    const recorded = evidence.images?.[role];
    const actual = imageIdentities[role];
    if (
      !recorded ||
      recorded.reference !== actual.reference ||
      recorded.ociIndexDigest !== actual.ociIndexDigest ||
      recorded.linuxAmd64ManifestDigest !==
        actual.linuxAmd64ManifestDigest ||
      recorded.engineImageId !== actual.engineImageId
    ) {
      refuse(
        'E_IMAGE_DRIFT',
        `Runtime image ${role} drifted from the journal evidence.`,
      );
    }
  }

  const runtimeContainers = await inspectContainers(
    LONG_RUNNING_SERVICES.map((service) => SERVICE_CONTRACT[service].name),
    'Existing runtime container inspection',
  );
  for (let index = 0; index < LONG_RUNNING_SERVICES.length; index += 1) {
    const serviceName = LONG_RUNNING_SERVICES[index];
    const container = runtimeContainers[index];
    verifyContainerContract(
      container,
      serviceName,
      plan,
      releaseManifest,
      'no',
    );
    const recorded = createdResources.containers[serviceName];
    const activated = activationResult.services[index];
    if (
      recorded?.name !== SERVICE_CONTRACT[serviceName].name ||
      recorded?.id !== container.Id ||
      recorded?.imageId !== container.Image ||
      activated?.service !== serviceName ||
      activated?.containerName !== recorded.name ||
      activated?.containerId !== container.Id ||
      activated?.imageId !== container.Image ||
      activated?.restartPolicy !== 'no'
    ) {
      refuse(
        'E_CONTAINER_DRIFT',
        `Runtime ${serviceName} identity drifted from its journal evidence.`,
      );
    }
    verifyRuntimeContainerState(container, serviceName);
  }

  const migrationContainer = await inspectMigration(plan, releaseManifest);
  const migrationTimes = assertCompletedMigration(migrationContainer);
  if (
    migration.containerId !== migrationContainer.Id ||
    migration.imageId !== migrationContainer.Image ||
    migration.startedAt !== migrationTimes.startedAt ||
    migration.completedAt !== migrationTimes.completedAt
  ) {
    refuse(
      'E_MIGRATION_DRIFT',
      'Exited migration identity drifted from its receipt.',
    );
  }

  await runRuntimeManifestGenerator(plan, true);
  return {
    deploymentId: plan.deploymentId,
    releaseCommit: plan.releaseCommit,
    planSha256: inputs.planSha256,
    deploymentReceiptSha256: chain.deploymentReceiptSha256,
  };
}


const parseCli = (args) => {
  let verifyExisting = false;
  let planPath;
  let help = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--verify-existing') {
      if (seen.has(argument)) {
        refuse('E_USAGE', 'Duplicate --verify-existing argument.');
      }
      seen.add(argument);
      verifyExisting = true;
      continue;
    }
    if (argument === '--plan') {
      if (seen.has(argument)) {
        refuse('E_USAGE', 'Duplicate --plan argument.');
      }
      seen.add(argument);
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        refuse('E_USAGE', '--plan requires an absolute path.');
      }
      planPath = value;
      index += 1;
      continue;
    }
    refuse('E_USAGE', 'Unknown deployment controller argument.');
  }
  if (!help && !planPath) refuse('E_USAGE', '--plan is required.');
  return { help, planPath, verifyExisting };
};

const usage =
  'Usage: linux-deploy-candidate.mjs [--verify-existing] --plan <absolute-path>\n';

const runCli = async () => {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage);
    return 0;
  }
  const result = parsed.verifyExisting
    ? await verifyExistingDeployment(parsed.planPath)
    : await executeDeployment(parsed.planPath);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: parsed.verifyExisting ? 'verify-existing' : 'deploy',
      deploymentId: result.deploymentId,
      releaseCommit: result.releaseCommit,
    })}\n`,
  );
  return 0;
};

if (await isCanonicalMainModule(import.meta.url)) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    const refusal =
      error instanceof DeploymentRefusal
        ? error
        : new DeploymentRefusal(
            'E_INTERNAL',
            'Unexpected deployment controller failure.',
          );
    process.stderr.write(
      `Deployment controller refused [${refusal.code}]: ${refusal.message}\n`,
    );
    process.exitCode =
      refusal.code === 'E_USAGE'
        ? 64
        : refusal.code === 'E_PLATFORM'
          ? 69
          : refusal.code === 'E_ROOT_REQUIRED'
            ? 77
            : 1;
  }
}
