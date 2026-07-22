import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateRuntimeManifest,
  verifyExistingRuntimeManifest,
  writeRuntimeDocumentsExclusive,
} from '../dist/runtime-manifest-generator.js';

const releaseCommit = '1234567890abcdef1234567890abcdef12345678';
const runtimeRoles = ['envoy', 'webapp', 'server', 'gotenberg', 'mysql', 'redis'];
const customRepositories = {
  webapp: 'webapp',
  server: 'server',
  mysql: 'mariadb',
  redis: 'redis',
};

const releaseArtifactSpecs = [
  ['packages/guardian/dist/guardian.js', '0644'],
  ['packages/guardian/dist/runtime-manifest-generator.js', '0644'],
  ['scripts/production/linux-deploy-candidate.mjs', '0644'],
  ['scripts/production/linux-deploy-authority.mjs', '0644'],
  ['scripts/production/linux-release-authority-verify.mjs', '0644'],
  ['scripts/production/linux-release-manifest-v2.mjs', '0644'],
  ['scripts/production/linux-source-archive-authority.mjs', '0644'],
  ['scripts/production/linux-deploy-docker.mjs', '0644'],
  ['scripts/production/linux-deploy-plan.mjs', '0644'],
  ['scripts/production/linux-convert-production-env.mjs', '0644'],
  ['scripts/production/linux-checkpoint-authority-v2.mjs', '0644'],
  ['scripts/production/direct-vm-checkpoint-v2-contract.mjs', '0644'],
  ['scripts/production/direct-vm-cutover-contract.mjs', '0644'],
  ['scripts/production/direct-vm-source-abort-contract.mjs', '0644'],
  ['scripts/production/direct-vm-cutover-authority.ps1', '0644'],
  ['scripts/production/direct-vm-preflight-checkpoint.ps1', '0644'],
  ['scripts/production/linux-final-quiescence-contract.mjs', '0644'],
  ['scripts/production/linux-activation-evidence-collect.mjs', '0644'],
  ['scripts/production/linux-guardian-promote-active.mjs', '0644'],
  ['scripts/production/linux-private-route-activate.mjs', '0644'],
  ['scripts/production/linux-backup-verify.sh', '0755'],
  ['scripts/production/linux-rollback-lock.mjs', '0644'],
  ['deploy/linux/easyfire-bookkeeping-stack.service', '0644'],
  ['deploy/linux/easyfire-bookkeeping-guardian.service', '0644'],
  ['deploy/linux/easyfire-bookkeeping-guardian.timer', '0644'],
  ['docker-compose.prod.yml', '0644'],
  ['deploy/linux/docker-compose.vm.yml', '0644'],
  ['deploy/linux/docker-compose.candidate.yml', '0644'],
  ['deploy/linux/guardian.config.example.json', '0644'],
  ['deploy/linux/runtime-manifest.schema.json', '0644'],
];

function fileHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function expectedRepoDigest(reference) {
  const [name, digest] = reference.split('@');
  const lastSlash = name.lastIndexOf('/');
  const tag = name.indexOf(':', lastSlash + 1);
  return `${tag === -1 ? name : name.slice(0, tag)}@${digest}`;
}

function releaseManifest() {
  return {
    manifestVersion: 2,
    releaseCommit,
    images: [
      {
        role: 'envoy',
        reference: `envoyproxy/envoy:v1.30.11@${sha('a')}`,
        ociIndexDigest: sha('a'),
        linuxAmd64ManifestDigest: sha('1'),
        engineImageId: sha('8'),
      },
      {
        role: 'webapp',
        reference: `easyfire-bookkeeping/webapp:git-${releaseCommit}`,
        ociIndexDigest: sha('b'),
        linuxAmd64ManifestDigest: sha('c'),
        engineImageId: sha('2'),
      },
      {
        role: 'server',
        reference: `easyfire-bookkeeping/server:git-${releaseCommit}`,
        ociIndexDigest: sha('d'),
        linuxAmd64ManifestDigest: sha('e'),
        engineImageId: sha('3'),
      },
      {
        role: 'gotenberg',
        reference: `gotenberg/gotenberg:7.10.2@${sha('f')}`,
        ociIndexDigest: sha('f'),
        linuxAmd64ManifestDigest: sha('0'),
        engineImageId: sha('9'),
      },
      {
        role: 'mysql',
        reference: `easyfire-bookkeeping/mariadb:git-${releaseCommit}`,
        ociIndexDigest: sha('1'),
        linuxAmd64ManifestDigest: sha('2'),
        engineImageId: sha('5'),
      },
      {
        role: 'redis',
        reference: `easyfire-bookkeeping/redis:git-${releaseCommit}`,
        ociIndexDigest: sha('3'),
        linuxAmd64ManifestDigest: sha('4'),
        engineImageId: sha('6'),
      },
      {
        role: 'migration',
        reference: `easyfire-bookkeeping/migration:git-${releaseCommit}`,
        ociIndexDigest: sha('5'),
        linuxAmd64ManifestDigest: sha('6'),
        engineImageId: sha('7'),
      },
    ],
  };
}

function fakeDocker(manifest, overrides = {}) {
  const entries = new Map(manifest.images.map((entry) => [entry.role, entry]));
  const actualImageIds = new Map(
    runtimeRoles.map((role, index) => [
      role,
      ['envoy', 'gotenberg'].includes(role)
        ? sha(role === 'envoy' ? '8' : '9')
        : entries.get(role).engineImageId,
    ]),
  );
  const calls = [];
  const transport = async (method, requestPath) => {
    calls.push({ method, path: requestPath });
    assert.equal(method, 'GET', 'the generator must use read-only Docker requests');
    if (requestPath === '/_ping') {
      return { statusCode: 200, body: 'OK' };
    }
    for (const [index, role] of runtimeRoles.entries()) {
      const entry = entries.get(role);
      const containerName = `easyfire-bookkeeping-${role}`;
      if (requestPath === `/containers/${containerName}/json`) {
        const inspect = {
          Id: (index + 1).toString(16).repeat(64),
          Image: actualImageIds.get(role),
          Name: `/${containerName}`,
          Config: {
            Image: entry.reference,
            Labels: {
              'com.docker.compose.project': 'easyfire-bookkeeping-prod',
              'com.docker.compose.service': role,
            },
            Env: ['APP_JWT_SECRET=must-not-escape'],
          },
          State: {
            Status: 'running',
            Running: true,
            Health: { Status: 'healthy' },
          },
        };
        Object.assign(inspect, overrides[`${role}Container`]);
        if (overrides[`${role}ContainerConfig`]) {
          Object.assign(inspect.Config, overrides[`${role}ContainerConfig`]);
        }
        if (overrides[`${role}ContainerState`]) {
          Object.assign(inspect.State, overrides[`${role}ContainerState`]);
        }
        return { statusCode: 200, body: JSON.stringify(inspect) };
      }
      if (requestPath === `/images/${encodeURIComponent(entry.reference)}/json`) {
        const image = {
          Id: actualImageIds.get(role),
          RepoTags: [entry.reference.split('@')[0]],
          RepoDigests: ['envoy', 'gotenberg'].includes(role)
            ? [expectedRepoDigest(entry.reference)]
            : [],
        };
        Object.assign(image, overrides[`${role}Image`]);
        return { statusCode: 200, body: JSON.stringify(image) };
      }
    }
    return { statusCode: 404, body: '' };
  };
  return { transport, calls, actualImageIds };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'easyfire-runtime-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releases = path.join(root, 'releases');
  const release = path.join(releases, releaseCommit);
  const currentReleasePath = path.join(root, 'current');
  const releaseManifestPath = path.join(release, 'release-manifest.json');
  const outputDirectory = path.join(root, 'etc');
  const stagingDirectory = path.join(root, 'staging');
  const guardianInstallRoot = path.join(root, 'guardian');
  const systemdRoot = path.join(root, 'systemd');
  const runtimeManifestPath = path.join(outputDirectory, 'runtime-manifest.json');
  const evidencePath = path.join(outputDirectory, 'runtime-identity-evidence.json');
  await mkdir(release, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(stagingDirectory, { recursive: true });
  await mkdir(guardianInstallRoot, { recursive: true });
  await mkdir(systemdRoot, { recursive: true });
  await symlink(release, currentReleasePath, process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = releaseManifest();
  manifest.artifactModeAuthority = 'required-install-mode';
  manifest.artifacts = [];
  for (const [artifactPath, mode] of releaseArtifactSpecs) {
    const bytes = Buffer.from(`artifact:${artifactPath}\n`);
    const target = path.join(release, ...artifactPath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (process.platform !== 'win32') await chmod(target, Number.parseInt(mode, 8));
    manifest.artifacts.push({ path: artifactPath, sha256: fileHash(bytes), bytes: bytes.length, mode });
  }
  for (const [source, target] of [
    ['packages/guardian/dist/guardian.js', path.join(guardianInstallRoot, 'guardian.js')],
    [
      'packages/guardian/dist/runtime-manifest-generator.js',
      path.join(guardianInstallRoot, 'runtime-manifest-generator.js'),
    ],
    [
      'deploy/linux/easyfire-bookkeeping-stack.service',
      path.join(systemdRoot, 'easyfire-bookkeeping-stack.service'),
    ],
    [
      'deploy/linux/easyfire-bookkeeping-guardian.service',
      path.join(systemdRoot, 'easyfire-bookkeeping-guardian.service'),
    ],
    [
      'deploy/linux/easyfire-bookkeeping-guardian.timer',
      path.join(systemdRoot, 'easyfire-bookkeeping-guardian.timer'),
    ],
  ]) {
    await copyFile(path.join(release, ...source.split('/')), target);
    if (process.platform !== 'win32') await chmod(target, 0o644);
  }
  const sourceArchivePath = path.join(stagingDirectory, 'source.tar.gz');
  const imageBundlePath = path.join(stagingDirectory, 'images.tar');
  const engineEvidencePath = path.join(stagingDirectory, 'target-engine-evidence.json');
  const sourceBytes = Buffer.from('source-archive');
  const bundleBytes = Buffer.from('image-bundle');
  await writeFile(sourceArchivePath, sourceBytes);
  await writeFile(imageBundlePath, bundleBytes);
  if (process.platform !== 'win32') {
    await chmod(sourceArchivePath, 0o600);
    await chmod(imageBundlePath, 0o600);
  }
  manifest.sourceArchive = {
    fileName: 'source.tar.gz',
    sha256: fileHash(sourceBytes),
    bytes: sourceBytes.length,
  };
  manifest.imageBundle = {
    fileName: 'images.tar',
    sha256: fileHash(bundleBytes),
    bytes: bundleBytes.length,
    inventory: manifest.images.map((image, index) => ({
      role: image.role,
      sourceReference: image.reference.split('@')[0],
      ociIndexDigest: image.ociIndexDigest,
      ociIndexBytes: 100 + index,
      linuxAmd64ManifestDigest: image.linuxAmd64ManifestDigest,
      linuxAmd64ManifestBytes: 200 + index,
      configDigest: sha((index + 1).toString(16)),
      configBytes: 300 + index,
      layers: [
        {
          digest: sha((index + 2).toString(16)),
          bytes: 400 + index,
          mediaType: 'application/vnd.oci.image.layer.v1.tar',
        },
      ],
    })),
  };
  const engineEvidence = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    releaseCommit,
    imageBundleSha256: `sha256:${manifest.imageBundle.sha256}`,
    docker: { serverVersion: '29.6.2', operatingSystem: 'linux', architecture: 'amd64' },
    images: manifest.images.map((image) => {
      const tagged = image.reference.split('@')[0];
      const external = image.reference.includes('@');
      const repoDigest = external ? expectedRepoDigest(image.reference) : null;
      return {
        reference: tagged,
        Id: image.engineImageId,
        RepoTags: [tagged],
        RepoDigests: external ? [repoDigest] : [],
        externalDigestAuthority: repoDigest,
      };
    }),
  };
  const engineEvidenceBytes = Buffer.from(`${JSON.stringify(engineEvidence, null, 2)}\n`);
  await writeFile(engineEvidencePath, engineEvidenceBytes);
  if (process.platform !== 'win32') await chmod(engineEvidencePath, 0o600);
  manifest.targetEngineEvidence = {
    fileName: 'target-engine-evidence.json',
    sha256: fileHash(engineEvidenceBytes),
    bytes: engineEvidenceBytes.length,
  };
  await writeFile(releaseManifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  return {
    manifest,
    release,
    guardianInstallRoot,
    systemdRoot,
    options: {
      releaseManifestPath,
      currentReleasePath,
      runtimeManifestPath,
      evidencePath,
      dockerSocketPath: '/unused/docker.sock',
      sourceArchivePath,
      imageBundlePath,
      engineEvidencePath,
      guardianInstallRoot,
      systemdRoot,
      requireRootOwner: false,
    },
  };
}

async function assertMissing(filePath) {
  await assert.rejects(() => lstat(filePath), (error) => error.code === 'ENOENT');
}

test('two concurrent publishers cannot overwrite or cross-pair runtime evidence', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'guardian-publish-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtimePath = path.join(directory, 'runtime.json');
  const evidencePath = path.join(directory, 'evidence.json');
  const publish = (writer) =>
    writeRuntimeDocumentsExclusive(
      runtimePath,
      { writer },
      evidencePath,
      { writer },
    );

  const results = await Promise.allSettled([publish('first'), publish('second')]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.match(
    results.find(({ status }) => status === 'rejected').reason.message,
    /already exists|refusing to replace/i,
  );
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(runtime.writer, evidence.writer);
});

test('uses the container config image ID when an external release entry names an OCI index digest', async (t) => {
  const { manifest, options } = await fixture(t);
  const docker = fakeDocker(manifest);

  const generated = await generateRuntimeManifest(options, {
    transport: docker.transport,
    now: () => new Date('2026-07-21T22:30:00.000Z'),
  });

  const runtime = JSON.parse(await readFile(options.runtimeManifestPath, 'utf8'));
  const evidence = JSON.parse(await readFile(options.evidencePath, 'utf8'));
  assert.deepEqual(runtime, generated.runtimeManifest);
  assert.equal(runtime.services.length, 6);
  assert.equal(runtime.services.find(({ role }) => role === 'envoy').imageId, sha('8'));
  assert.notEqual(
    runtime.services.find(({ role }) => role === 'envoy').imageId,
    manifest.images.find(({ role }) => role === 'envoy').ociIndexDigest,
  );
  const envoyEvidence = evidence.services.find(({ role }) => role === 'envoy');
  assert.equal(envoyEvidence.ociIndexDigest, sha('a'));
  assert.equal(envoyEvidence.linuxAmd64ManifestDigest, sha('1'));
  assert.equal(envoyEvidence.engineImageId, sha('8'));
  assert.equal(
    evidence.services.find(({ role }) => role === 'envoy').verifiedRepoDigest,
    expectedRepoDigest(manifest.images.find(({ role }) => role === 'envoy').reference),
  );
  assert.doesNotMatch(JSON.stringify(evidence), /APP_JWT_SECRET|must-not-escape/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(options.runtimeManifestPath)).mode & 0o777, 0o600);
    assert.equal((await stat(options.evidencePath)).mode & 0o777, 0o600);
  }
  assert.ok(docker.calls.every(({ method }) => method === 'GET'));
});

test('fails closed when a custom engineImageId differs from the local config image object', async (t) => {
  const { manifest, options } = await fixture(t);
  const docker = fakeDocker(manifest, {
    serverImage: { Id: sha('d') },
    serverContainer: { Image: sha('d') },
  });

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /server.*release-manifest engineImageId/i,
  );
  await assertMissing(options.runtimeManifestPath);
  await assertMissing(options.evidencePath);
});

test('fails closed when an external engineImageId differs even if its repo digest matches', async (t) => {
  const { manifest, options } = await fixture(t);
  const docker = fakeDocker(manifest, {
    envoyImage: { Id: sha('d') },
    envoyContainer: { Image: sha('d') },
  });

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /envoy.*release-manifest engineImageId/i,
  );
  await assertMissing(options.runtimeManifestPath);
  await assertMissing(options.evidencePath);
});

test('fails closed when an external local image does not prove the required repo digest', async (t) => {
  const { manifest, options } = await fixture(t);
  const docker = fakeDocker(manifest, {
    envoyImage: { RepoDigests: [`envoyproxy/envoy@${sha('c')}`] },
  });

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /envoy.*required repo digest/i,
  );
  await assertMissing(options.runtimeManifestPath);
  await assertMissing(options.evidencePath);
});

test('rejects unhealthy containers and refuses to replace either output', async (t) => {
  const { manifest, options } = await fixture(t);
  const docker = fakeDocker(manifest, {
    redisContainerState: { Health: { Status: 'unhealthy' } },
  });
  await writeFile(options.evidencePath, 'owned\n', 'utf8');

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /already exists/i,
  );
  assert.equal(await readFile(options.evidencePath, 'utf8'), 'owned\n');
  assert.equal(docker.calls.length, 0, 'pre-existing output refusal must precede Docker access');
  await rm(options.evidencePath);

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /redis.*running and healthy/i,
  );
  await assertMissing(options.runtimeManifestPath);
  await assertMissing(options.evidencePath);
});

test('requires the exact seven-role release manifest but excludes migration from runtime output', async (t) => {
  const { manifest, options } = await fixture(t);
  manifest.images.push({
    role: 'worker',
    reference: `easyfire-bookkeeping/worker:git-${releaseCommit}`,
    ociIndexDigest: sha('a'),
    linuxAmd64ManifestDigest: sha('b'),
    engineImageId: sha('c'),
  });
  await writeFile(options.releaseManifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const docker = fakeDocker(manifest);

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /exactly.*seven|unexpected image role/i,
  );
  assert.equal(docker.calls.length, 0, 'release authority is validated before Docker access');
});

test('rejects duplicate runtime roles instead of treating them as a complete image set', async (t) => {
  const { manifest, options } = await fixture(t);
  const server = manifest.images.find(({ role }) => role === 'server');
  manifest.images[manifest.images.findIndex(({ role }) => role === 'migration')] = {
    ...server,
  };
  await writeFile(options.releaseManifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const docker = fakeDocker(manifest);

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /duplicate release image role: server/i,
  );
  assert.equal(docker.calls.length, 0);
});

test('rejects the ambiguous legacy imageId release contract', async (t) => {
  const { manifest, options } = await fixture(t);
  const envoy = manifest.images.find(({ role }) => role === 'envoy');
  envoy.imageId = envoy.ociIndexDigest;
  delete envoy.engineImageId;
  await writeFile(options.releaseManifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const docker = fakeDocker(manifest);

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /legacy imageId|engineImageId/i,
  );
  assert.equal(docker.calls.length, 0);
});

test('requires an external reference repo digest to equal ociIndexDigest', async (t) => {
  const { manifest, options } = await fixture(t);
  manifest.images.find(({ role }) => role === 'envoy').ociIndexDigest = sha('c');
  await writeFile(options.releaseManifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  const docker = fakeDocker(manifest);

  await assert.rejects(
    () => generateRuntimeManifest(options, { transport: docker.transport }),
    /envoy reference repo digest must equal ociIndexDigest/i,
  );
  assert.equal(docker.calls.length, 0);
});

test('rejects manifest-bound release, bundle, and installed-copy drift before Docker access', async (t) => {
  const releaseDrift = await fixture(t);
  await writeFile(
    path.join(releaseDrift.release, 'scripts/production/linux-private-route-activate.mjs'),
    'tampered',
  );
  const releaseDocker = fakeDocker(releaseDrift.manifest);
  await assert.rejects(
    generateRuntimeManifest(releaseDrift.options, { transport: releaseDocker.transport }),
    /linux-private-route-activate.*hash/i,
  );
  assert.equal(releaseDocker.calls.length, 0);

  const bundleDrift = await fixture(t);
  await writeFile(bundleDrift.options.imageBundlePath, 'tampered');
  const bundleDocker = fakeDocker(bundleDrift.manifest);
  await assert.rejects(
    generateRuntimeManifest(bundleDrift.options, { transport: bundleDocker.transport }),
    /image bundle.*hash/i,
  );
  assert.equal(bundleDocker.calls.length, 0);

  const installedDrift = await fixture(t);
  await writeFile(path.join(installedDrift.guardianInstallRoot, 'guardian.js'), 'tampered');
  const installedDocker = fakeDocker(installedDrift.manifest);
  await assert.rejects(
    generateRuntimeManifest(installedDrift.options, { transport: installedDocker.transport }),
    /installed Guardian.*hash/i,
  );
  assert.equal(installedDocker.calls.length, 0);
});

test('rejects image inventory and target-engine evidence drift before Docker access', async (t) => {
  const inventoryDrift = await fixture(t);
  inventoryDrift.manifest.imageBundle.inventory[2].ociIndexDigest = sha('0');
  await writeFile(
    inventoryDrift.options.releaseManifestPath,
    `${JSON.stringify(inventoryDrift.manifest)}\n`,
  );
  const inventoryDocker = fakeDocker(inventoryDrift.manifest);
  await assert.rejects(
    generateRuntimeManifest(inventoryDrift.options, { transport: inventoryDocker.transport }),
    /server.*inventory.*release manifest/i,
  );
  assert.equal(inventoryDocker.calls.length, 0);

  const evidenceDrift = await fixture(t);
  const evidence = JSON.parse(await readFile(evidenceDrift.options.engineEvidencePath, 'utf8'));
  evidence.images[1].Id = sha('f');
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(evidenceDrift.options.engineEvidencePath, evidenceBytes);
  evidenceDrift.manifest.targetEngineEvidence = {
    ...evidenceDrift.manifest.targetEngineEvidence,
    sha256: fileHash(evidenceBytes),
    bytes: evidenceBytes.length,
  };
  await writeFile(
    evidenceDrift.options.releaseManifestPath,
    `${JSON.stringify(evidenceDrift.manifest)}\n`,
  );
  const evidenceDocker = fakeDocker(evidenceDrift.manifest);
  await assert.rejects(
    generateRuntimeManifest(evidenceDrift.options, { transport: evidenceDocker.transport }),
    /webapp.*Docker Id.*engineImageId/i,
  );
  assert.equal(evidenceDocker.calls.length, 0);
});

test('verify-existing rechecks identities without writes and accepts stopped or created containers', async (t) => {
  const { manifest, options } = await fixture(t);
  const runningDocker = fakeDocker(manifest);
  await generateRuntimeManifest(options, { transport: runningDocker.transport });
  const runtimeBefore = await readFile(options.runtimeManifestPath, 'utf8');
  const evidenceBefore = await readFile(options.evidencePath, 'utf8');
  const stoppedOverrides = Object.fromEntries(
    runtimeRoles.map((role, index) => [
      `${role}ContainerState`,
      {
        Running: false,
        Status: index % 2 === 0 ? 'exited' : 'created',
        Health: undefined,
      },
    ]),
  );
  const stoppedDocker = fakeDocker(manifest, stoppedOverrides);

  const verified = await verifyExistingRuntimeManifest(options, {
    transport: stoppedDocker.transport,
  });

  assert.equal(verified.services.length, 6);
  assert.equal(await readFile(options.runtimeManifestPath, 'utf8'), runtimeBefore);
  assert.equal(await readFile(options.evidencePath, 'utf8'), evidenceBefore);
  assert.ok(stoppedDocker.calls.every(({ method }) => method === 'GET'));
});
