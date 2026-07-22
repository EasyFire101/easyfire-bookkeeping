import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RELEASE_ARTIFACT_SPECS,
  verifyManifestBoundRelease,
} from '../scripts/production/linux-release-authority-verify.mjs';

const releaseCommit = '1234567890abcdef1234567890abcdef12345678';
const roles = ['envoy', 'webapp', 'server', 'gotenberg', 'mysql', 'redis', 'migration'];
const postArchiveExecutors = [
  ['scripts/production/linux-source-archive-authority.mjs', '0644'],
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
];

function relativeModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\bimport\s*['"](\.[^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function taggedReference(role) {
  if (role === 'envoy') return 'envoyproxy/envoy:v1.30.11';
  if (role === 'gotenberg') return 'gotenberg/gotenberg:7.10.2';
  const repository = role === 'mysql' ? 'mariadb' : role;
  return `easyfire-bookkeeping/${repository}:git-${releaseCommit}`;
}

function descriptor(bytes, mediaType, extra = {}) {
  return {
    mediaType,
    digest: `sha256:${hash(bytes)}`,
    size: bytes.length,
    ...extra,
  };
}

function writeOctal(header, start, length, value) {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length, 'ascii');
}

function tarHeader(name, size, type = '0') {
  assert.ok(Buffer.byteLength(name) <= 100);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function makeTar(entries) {
  const chunks = [];
  for (const [name, bytes, type] of entries) {
    chunks.push(tarHeader(name, bytes.length, type), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function buildOciBundle() {
  const blobs = new Map();
  const records = roles.map((role, index) => {
    const sourceReference = taggedReference(role);
    const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', role }));
    const configDescriptor = descriptor(config, 'application/vnd.oci.image.config.v1+json');
    blobs.set(`blobs/sha256/${configDescriptor.digest.slice(7)}`, config);

    const layer = Buffer.from(`synthetic-layer-for-${role}`);
    const layerDescriptor = descriptor(layer, 'application/vnd.oci.image.layer.v1.tar');
    blobs.set(`blobs/sha256/${layerDescriptor.digest.slice(7)}`, layer);

    const imageManifest = Buffer.from(JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: configDescriptor,
      layers: [layerDescriptor],
    }));
    const imageManifestDescriptor = descriptor(
      imageManifest,
      'application/vnd.oci.image.manifest.v1+json',
      { platform: { os: 'linux', architecture: 'amd64' } },
    );
    blobs.set(`blobs/sha256/${imageManifestDescriptor.digest.slice(7)}`, imageManifest);

    const imageIndex = Buffer.from(JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [imageManifestDescriptor],
    }));
    const imageIndexDescriptor = descriptor(
      imageIndex,
      'application/vnd.oci.image.index.v1+json',
      { annotations: { 'io.containerd.image.name': `docker.io/${sourceReference}` } },
    );
    blobs.set(`blobs/sha256/${imageIndexDescriptor.digest.slice(7)}`, imageIndex);
    return {
      image: {
        role,
        reference: ['envoy', 'gotenberg'].includes(role)
          ? `${sourceReference}@${imageIndexDescriptor.digest}`
          : sourceReference,
        ociIndexDigest: imageIndexDescriptor.digest,
        linuxAmd64ManifestDigest: imageManifestDescriptor.digest,
        engineImageId: imageIndexDescriptor.digest,
      },
      inventory: {
        role,
        sourceReference,
        ociIndexDigest: imageIndexDescriptor.digest,
        ociIndexBytes: imageIndexDescriptor.size,
        linuxAmd64ManifestDigest: imageManifestDescriptor.digest,
        linuxAmd64ManifestBytes: imageManifestDescriptor.size,
        configDigest: configDescriptor.digest,
        configBytes: configDescriptor.size,
        layers: [{
          digest: layerDescriptor.digest,
          bytes: layerDescriptor.size,
          mediaType: layerDescriptor.mediaType,
        }],
      },
      rootDescriptor: imageIndexDescriptor,
    };
  });
  const index = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: records.map(({ rootDescriptor }) => rootDescriptor),
  }));
  const entries = [
    ['blobs/', Buffer.alloc(0), '5'],
    ['blobs/sha256/', Buffer.alloc(0), '5'],
    ['oci-layout', Buffer.from('{"imageLayoutVersion":"1.0.0"}')],
    ['index.json', index],
    ...[...blobs.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ];
  return {
    bundle: makeTar(entries),
    images: records.map(({ image }) => image),
    inventory: records.map(({ inventory }) => inventory),
  };
}

function sourceReference(fullReference) {
  return fullReference.split('@')[0];
}

function repositoryOf(taggedReference) {
  const slash = taggedReference.lastIndexOf('/');
  const colon = taggedReference.lastIndexOf(':');
  assert.ok(colon > slash);
  return taggedReference.slice(0, colon);
}

async function writeMode(filePath, bytes, mode) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  if (process.platform !== 'win32') await chmod(filePath, Number.parseInt(mode, 8));
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'easyfire-release-authority-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releasePath = path.join(root, 'release');
  const stagingPath = path.join(root, 'staging');
  const guardianInstallRoot = path.join(root, 'installed-guardian');
  const systemdRoot = path.join(root, 'systemd');
  await Promise.all([
    mkdir(releasePath, { recursive: true }),
    mkdir(stagingPath, { recursive: true }),
    mkdir(guardianInstallRoot, { recursive: true }),
    mkdir(systemdRoot, { recursive: true }),
  ]);

  const artifacts = [];
  for (const [artifactPath, mode] of RELEASE_ARTIFACT_SPECS) {
    const bytes = Buffer.from(`release-artifact:${artifactPath}\n`);
    const target = path.join(releasePath, ...artifactPath.split('/'));
    await writeMode(target, bytes, mode);
    artifacts.push({ path: artifactPath, sha256: hash(bytes), bytes: bytes.length, mode });
  }
  for (const [source, destination] of [
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
    await copyFile(path.join(releasePath, ...source.split('/')), destination);
    if (process.platform !== 'win32') await chmod(destination, 0o644);
  }

  const sourceArchiveBytes = Buffer.from('immutable-source-archive');
  const { bundle: imageBundleBytes, images, inventory } = buildOciBundle();
  const sourceArchivePath = path.join(stagingPath, 'source.tar.gz');
  const imageBundlePath = path.join(stagingPath, 'images.tar');
  await writeMode(sourceArchivePath, sourceArchiveBytes, '0600');
  await writeMode(imageBundlePath, imageBundleBytes, '0600');

  const evidence = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    releaseCommit,
    imageBundleSha256: `sha256:${hash(imageBundleBytes)}`,
    docker: {
      serverVersion: '29.6.2',
      operatingSystem: 'linux',
      architecture: 'amd64',
    },
    images: images.map((image) => {
      const tagged = sourceReference(image.reference);
      const external = image.reference.includes('@');
      const repoDigest = `${repositoryOf(tagged)}@${image.ociIndexDigest}`;
      return {
        reference: tagged,
        Id: image.engineImageId,
        RepoTags: [tagged],
        RepoDigests: [repoDigest],
        externalDigestAuthority: external ? repoDigest : null,
      };
    }),
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const engineEvidencePath = path.join(stagingPath, 'target-engine-evidence.json');
  await writeMode(engineEvidencePath, evidenceBytes, '0600');

  const manifest = {
    manifestVersion: 2,
    releaseCommit,
    images,
    sourceArchive: {
      fileName: 'source.tar.gz',
      sha256: hash(sourceArchiveBytes),
      bytes: sourceArchiveBytes.length,
    },
    imageBundle: {
      fileName: 'images.tar',
      sha256: hash(imageBundleBytes),
      bytes: imageBundleBytes.length,
      inventory,
    },
    targetEngineEvidence: {
      fileName: 'target-engine-evidence.json',
      sha256: hash(evidenceBytes),
      bytes: evidenceBytes.length,
    },
    artifactModeAuthority: 'required-install-mode',
    artifacts,
  };
  const options = {
    manifestValue: manifest,
    releasePath,
    sourceArchivePath,
    imageBundlePath,
    engineEvidencePath,
    guardianInstallRoot,
    systemdRoot,
    requireRootOwner: false,
  };
  return { manifest, options, releasePath, imageBundlePath, engineEvidencePath, guardianInstallRoot, systemdRoot };
}

test('checks every manifest binding against release, staging, and installed bytes', async (t) => {
  const { manifest, options } = await fixture(t);
  const proof = await verifyManifestBoundRelease(options);
  assert.equal(proof.releaseCommit, releaseCommit);
  assert.equal(proof.artifacts.length, RELEASE_ARTIFACT_SPECS.length);
  assert.equal(proof.imageBundle.sha256, manifest.imageBundle.sha256);
  assert.equal(proof.installedCopies.length, 5);
  assert.doesNotMatch(JSON.stringify(proof), /release-artifact:/);
});

test('initial collection requires the installed generator but defers other inert copies', async (t) => {
  const value = await fixture(t);
  await rm(path.join(value.guardianInstallRoot, 'guardian.js'));
  await rm(path.join(value.systemdRoot, 'easyfire-bookkeeping-stack.service'));
  await rm(path.join(value.systemdRoot, 'easyfire-bookkeeping-guardian.service'));
  await rm(path.join(value.systemdRoot, 'easyfire-bookkeeping-guardian.timer'));
  const proof = await verifyManifestBoundRelease({
    ...value.options,
    requireInstalledCopies: false,
  });
  assert.equal(proof.installedCopies.length, 1);
  await assert.rejects(
    verifyManifestBoundRelease({ ...value.options, requireInstalledCopies: true }),
    /Installed Guardian guardian\.js|ENOENT/,
  );
});

test('rejects a changed source-release artifact before trusting the release', async (t) => {
  const { options, releasePath } = await fixture(t);
  await writeFile(path.join(releasePath, 'scripts/production/linux-rollback-lock.mjs'), 'tampered');
  await assert.rejects(verifyManifestBoundRelease(options), /linux-rollback-lock.*hash|hash.*linux-rollback-lock/i);
});

test('binds every post-archive cutover executor and refuses missing or changed release copies', async (t) => {
  assert.deepEqual(
    RELEASE_ARTIFACT_SPECS.filter(([artifactPath]) =>
      postArchiveExecutors.some(([expectedPath]) => expectedPath === artifactPath)),
    postArchiveExecutors,
  );

  const missing = await fixture(t);
  await rm(path.join(
    missing.releasePath,
    'scripts/production/linux-private-route-activate.mjs',
  ));
  await assert.rejects(
    verifyManifestBoundRelease(missing.options),
    /linux-private-route-activate|ENOENT/i,
  );

  const changed = await fixture(t);
  await writeFile(
    path.join(changed.releasePath, 'scripts/production/direct-vm-cutover-authority.ps1'),
    'tampered source-quiesce executor',
  );
  await assert.rejects(
    verifyManifestBoundRelease(changed.options),
    /direct-vm-cutover-authority.*hash|hash.*direct-vm-cutover-authority/i,
  );

  const missingDependency = await fixture(t);
  await rm(path.join(
    missingDependency.releasePath,
    'scripts/production/linux-final-quiescence-contract.mjs',
  ));
  await assert.rejects(
    verifyManifestBoundRelease(missingDependency.options),
    /linux-final-quiescence-contract|ENOENT/i,
  );

  const changedAbort = await fixture(t);
  await writeFile(
    path.join(
      changedAbort.releasePath,
      'scripts/production/direct-vm-source-abort-contract.mjs',
    ),
    'tampered abort contract',
  );
  await assert.rejects(
    verifyManifestBoundRelease(changedAbort.options),
    /direct-vm-source-abort-contract.*hash|hash.*direct-vm-source-abort-contract/i,
  );
});

test('manifest-bound runtime artifacts form a closed imported and executed dependency graph', async () => {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const boundPaths = new Set(RELEASE_ARTIFACT_SPECS.map(([artifactPath]) => artifactPath));

  for (const [artifactPath] of RELEASE_ARTIFACT_SPECS) {
    if (!/\.(?:mjs|ps1|sh|service|timer)$/.test(artifactPath)) continue;
    const source = await readFile(path.join(projectRoot, ...artifactPath.split('/')), 'utf8');
    const relativeDependencies = artifactPath.endsWith('.mjs')
      ? relativeModuleSpecifiers(source)
      : [];
    const siblingExecutors = [...source.matchAll(
      /\bJoin-Path\s+\$PSScriptRoot\s+['"]([^'"]+\.(?:mjs|ps1|sh))['"]/g,
    )].map((match) => `./${match[1].replaceAll('\\', '/')}`);
    for (const specifier of [...relativeDependencies, ...siblingExecutors]) {
      const dependencyPath = path.posix.normalize(path.posix.join(
        path.posix.dirname(artifactPath),
        specifier,
      ));
      assert.ok(
        boundPaths.has(dependencyPath),
        `${artifactPath} imports or executes unbound runtime module ${specifier} (${dependencyPath})`,
      );
    }
    for (const match of source.matchAll(
      /\/opt\/easyfire-bookkeeping\/current\/([A-Za-z0-9_./-]+\.(?:js|mjs|sh|yml))/g,
    )) {
      assert.ok(
        boundPaths.has(match[1]),
        `${artifactPath} executes unbound immutable-release artifact ${match[1]}`,
      );
    }
  }
});

test('rejects changed installed Guardian and systemd copies', async (t) => {
  const guardian = await fixture(t);
  await writeFile(path.join(guardian.guardianInstallRoot, 'guardian.js'), 'tampered');
  await assert.rejects(verifyManifestBoundRelease(guardian.options), /installed.*guardian.*hash/i);

  const unit = await fixture(t);
  await writeFile(path.join(unit.systemdRoot, 'easyfire-bookkeeping-stack.service'), 'tampered');
  await assert.rejects(verifyManifestBoundRelease(unit.options), /installed.*stack.*hash/i);
});

test('rejects image-bundle byte drift and manifest metadata not derived from OCI bytes', async (t) => {
  const changedBundle = await fixture(t);
  await writeFile(changedBundle.imageBundlePath, 'different-bundle');
  await assert.rejects(verifyManifestBoundRelease(changedBundle.options), /image bundle|OCI tar/i);

  const changedInventory = await fixture(t);
  changedInventory.manifest.imageBundle.inventory[2].configDigest = digest('0');
  await assert.rejects(
    verifyManifestBoundRelease(changedInventory.options),
    /inventory.*actual OCI bytes/i,
  );
});

test('rejects target-engine evidence that no longer matches the manifest', async (t) => {
  const fixtureValue = await fixture(t);
  const evidence = JSON.parse(await readFile(fixtureValue.engineEvidencePath, 'utf8'));
  evidence.images[1].Id = digest('f');
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(fixtureValue.engineEvidencePath, bytes);
  fixtureValue.manifest.targetEngineEvidence.sha256 = hash(bytes);
  fixtureValue.manifest.targetEngineEvidence.bytes = bytes.length;
  await assert.rejects(verifyManifestBoundRelease(fixtureValue.options), /webapp.*Docker Id.*engineImageId/i);
});

test('requires root-index Docker IDs and accepts the bounded external offline-load state', async (t) => {
  const wrongId = await fixture(t);
  wrongId.manifest.images[1].engineImageId = digest('f');
  await assert.rejects(
    verifyManifestBoundRelease(wrongId.options),
    /webapp.*engineImageId.*root OCI index digest/i,
  );

  const offline = await fixture(t);
  const evidence = JSON.parse(await readFile(offline.engineEvidencePath, 'utf8'));
  evidence.images[0].RepoDigests = [];
  evidence.images[1].RepoDigests = [];
  evidence.images[3].RepoDigests = [];
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(offline.engineEvidencePath, evidenceBytes);
  offline.manifest.targetEngineEvidence.sha256 = hash(evidenceBytes);
  offline.manifest.targetEngineEvidence.bytes = evidenceBytes.length;
  const proof = await verifyManifestBoundRelease(offline.options);
  assert.equal(proof.releaseCommit, releaseCommit);
});

test('rejects a custom RepoDigest not derived from the exact OCI index', async (t) => {
  const value = await fixture(t);
  const evidence = JSON.parse(await readFile(value.engineEvidencePath, 'utf8'));
  evidence.images[1].RepoDigests = [
    `easyfire-bookkeeping/webapp@sha256:${'f'.repeat(64)}`,
  ];
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(value.engineEvidencePath, evidenceBytes);
  value.manifest.targetEngineEvidence.sha256 = hash(evidenceBytes);
  value.manifest.targetEngineEvidence.bytes = evidenceBytes.length;
  await assert.rejects(
    verifyManifestBoundRelease(value.options),
    /webapp.*RepoDigests|repo digest/i,
  );
});

test('rejects missing or undeclared release artifacts', async (t) => {
  const missing = await fixture(t);
  missing.manifest.artifacts.pop();
  await assert.rejects(verifyManifestBoundRelease(missing.options), /exactly.*release artifacts|artifact set/i);

  const extra = await fixture(t);
  extra.manifest.artifacts.push({
    path: 'undeclared.sh',
    sha256: '0'.repeat(64),
    bytes: 0,
    mode: '0644',
  });
  await assert.rejects(verifyManifestBoundRelease(extra.options), /exactly.*release artifacts|artifact set/i);
});

test('deployment verifies manifest authority before resources and installed copies before systemd activation', async () => {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const authority = await readFile(
    path.join(projectRoot, 'scripts/production/linux-deploy-authority.mjs'),
    'utf8',
  );
  const controller = await readFile(
    path.join(projectRoot, 'scripts/production/linux-deploy-candidate.mjs'),
    'utf8',
  );
  const runbook = await readFile(
    path.join(projectRoot, 'docs/easyfire/LINUX_VM_RUNBOOK.md'),
    'utf8',
  );
  assert.match(authority, /verifyManifestBoundRelease/);
  assert.ok(
    authority.indexOf('await verifyManifestBoundRelease') <
      authority.indexOf('parseProductionEnvironment(await readFile'),
    'manifest-bound bytes must be verified before later deployment inputs',
  );
  assert.ok(
    controller.indexOf('await collectBoundInputs') <
      controller.indexOf('await assertNoExistingDockerResources'),
    'bound-input verification must precede Docker resource creation',
  );
  const installGuardian = runbook.indexOf('install -m 0644 packages/guardian/dist/guardian.js');
  const verifyExisting = runbook.indexOf('--verify-existing', installGuardian);
  const daemonReload = runbook.indexOf('systemctl daemon-reload');
  const enableUnits = runbook.indexOf('systemctl enable');
  assert.ok(installGuardian >= 0);
  assert.ok(installGuardian < verifyExisting);
  assert.ok(verifyExisting < daemonReload);
  assert.ok(daemonReload < enableUnits);
  assert.match(
    runbook,
    /releases\\<releaseCommit>\\scripts\\production\\direct-vm-cutover-authority\.ps1/,
  );
  assert.match(runbook, /git -c tar\.umask=0022 archive --format=tar\.gz/);
  assert.match(runbook, /--add-file=packages\/guardian\/dist\/guardian\.js/);
  assert.match(runbook, /--add-file=packages\/guardian\/dist\/runtime-manifest-generator\.js/);
  assert.match(runbook, /never execute an\s+operational executor from a Git checkout/i);
  assert.match(runbook, /eight Windows-controlled release executor\/module hashes/i);
  for (const [artifactPath] of postArchiveExecutors) {
    assert.ok(
      runbook.includes(`\`${artifactPath}\``),
      `runbook omits the immutable post-archive executor ${artifactPath}`,
    );
  }
  const privateRouteSection = runbook.indexOf('## Private Tailscale route');
  const routePreflight = runbook.indexOf('--verify-existing', privateRouteSection);
  const routeExecution = runbook.indexOf('linux-private-route-activate.mjs', privateRouteSection);
  assert.ok(routeExecution > routePreflight);
});

test('deployment and Guardian enforce the same exact artifact path/mode contract', async () => {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const guardianContract = await readFile(
    path.join(projectRoot, 'packages/guardian/src/runtime-manifest-contracts.ts'),
    'utf8',
  );
  for (const [artifactPath, mode] of RELEASE_ARTIFACT_SPECS) {
    const escapedPath = artifactPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      guardianContract,
      new RegExp(`\\['${escapedPath}', '${mode}'\\]`),
      `Guardian artifact contract drifted for ${artifactPath}`,
    );
  }
});
