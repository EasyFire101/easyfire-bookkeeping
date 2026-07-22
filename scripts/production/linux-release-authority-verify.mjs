import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { inspectOciImageBundle } from './linux-release-manifest-v2.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const ENGINE_SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const DOCKER_VERSION = '29.6.2';

export const RELEASE_ARTIFACT_SPECS = Object.freeze([
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
]);

const ROLES = Object.freeze([
  'envoy',
  'webapp',
  'server',
  'gotenberg',
  'mysql',
  'redis',
  'migration',
]);

function refuse(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value, label) {
  if (!isObject(value)) refuse(`${label} must be an object.`);
  return value;
}

function exactKeys(value, expected, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    refuse(`${label} has unexpected or missing fields.`);
  }
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    refuse(`${label} must be a lowercase SHA-256 hash.`);
  }
  return value;
}

function engineSha256(value, label) {
  if (typeof value !== 'string' || !ENGINE_SHA256.test(value)) {
    refuse(`${label} must be a lowercase sha256 digest.`);
  }
  return value;
}

function bytes(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    refuse(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function repositoryOf(reference) {
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  if (colon <= slash) refuse(`Image reference ${reference} has no exact tag.`);
  return reference.slice(0, colon);
}

function sourceReference(reference) {
  const parts = reference.split('@');
  if (parts.length > 2) refuse(`Image reference ${reference} has ambiguous digest authority.`);
  return parts[0];
}

function expectedCustomReference(role, releaseCommit) {
  const repository = role === 'mysql' ? 'mariadb' : role;
  return `easyfire-bookkeeping/${repository}:git-${releaseCommit}`;
}

function parseImages(value, releaseCommit) {
  if (!Array.isArray(value) || value.length !== ROLES.length) {
    refuse('Release manifest must contain exactly seven image entries.');
  }
  return value.map((candidate, index) => {
    const role = ROLES[index];
    exactKeys(
      candidate,
      ['role', 'reference', 'ociIndexDigest', 'linuxAmd64ManifestDigest', 'engineImageId'],
      `Release image ${index}`,
    );
    if (candidate.role !== role) refuse(`Release image order must bind role ${role}.`);
    if (
      typeof candidate.reference !== 'string' ||
      candidate.reference.length < 3 ||
      candidate.reference.length > 512 ||
      /[\s\0]/.test(candidate.reference)
    ) {
      refuse(`${role} release reference is invalid.`);
    }
    engineSha256(candidate.ociIndexDigest, `${role} ociIndexDigest`);
    engineSha256(candidate.linuxAmd64ManifestDigest, `${role} linuxAmd64ManifestDigest`);
    engineSha256(candidate.engineImageId, `${role} engineImageId`);
    if (['envoy', 'gotenberg'].includes(role)) {
      const parts = candidate.reference.split('@');
      const expectedTag = role === 'envoy'
        ? 'envoyproxy/envoy:v1.30.11'
        : 'gotenberg/gotenberg:7.10.2';
      if (
        parts.length !== 2 ||
        parts[0] !== expectedTag ||
        parts[1] !== candidate.ociIndexDigest
      ) {
        refuse(`${role} external reference must bind its OCI index digest.`);
      }
    }
    else if (candidate.reference !== expectedCustomReference(role, releaseCommit)) {
      refuse(`${role} custom reference is not the exact git-commit tag.`);
    }
    return candidate;
  });
}

function parseFileBinding(value, fileName, label) {
  exactKeys(value, ['fileName', 'sha256', 'bytes'], label);
  if (value.fileName !== fileName) refuse(`${label} fileName must be ${fileName}.`);
  sha256(value.sha256, `${label}.sha256`);
  bytes(value.bytes, `${label}.bytes`);
  return value;
}

function parseInventory(value, images) {
  if (!Array.isArray(value) || value.length !== ROLES.length) {
    refuse('Image bundle inventory must contain exactly seven entries.');
  }
  return value.map((candidate, index) => {
    const image = images[index];
    const role = ROLES[index];
    exactKeys(
      candidate,
      [
        'role',
        'sourceReference',
        'ociIndexDigest',
        'ociIndexBytes',
        'linuxAmd64ManifestDigest',
        'linuxAmd64ManifestBytes',
        'configDigest',
        'configBytes',
        'layers',
      ],
      `${role} image bundle inventory`,
    );
    if (
      candidate.role !== role ||
      candidate.sourceReference !== sourceReference(image.reference) ||
      candidate.ociIndexDigest !== image.ociIndexDigest ||
      candidate.linuxAmd64ManifestDigest !== image.linuxAmd64ManifestDigest
    ) {
      refuse(`${role} image bundle inventory does not match the release manifest.`);
    }
    bytes(candidate.ociIndexBytes, `${role} inventory ociIndexBytes`);
    bytes(candidate.linuxAmd64ManifestBytes, `${role} inventory linuxAmd64ManifestBytes`);
    engineSha256(candidate.configDigest, `${role} inventory configDigest`);
    bytes(candidate.configBytes, `${role} inventory configBytes`);
    if (!Array.isArray(candidate.layers)) refuse(`${role} inventory layers must be an array.`);
    candidate.layers.forEach((layer, layerIndex) => {
      exactKeys(layer, ['digest', 'bytes', 'mediaType'], `${role} layer ${layerIndex}`);
      engineSha256(layer.digest, `${role} layer ${layerIndex}.digest`);
      bytes(layer.bytes, `${role} layer ${layerIndex}.bytes`);
      if (
        typeof layer.mediaType !== 'string' ||
        !layer.mediaType.startsWith('application/vnd.oci.image.layer.v1')
      ) {
        refuse(`${role} layer ${layerIndex} mediaType is invalid.`);
      }
    });
    return candidate;
  });
}

function parseArtifacts(value) {
  if (!Array.isArray(value) || value.length !== RELEASE_ARTIFACT_SPECS.length) {
    refuse(`Release manifest must contain exactly ${RELEASE_ARTIFACT_SPECS.length} release artifacts.`);
  }
  return value.map((candidate, index) => {
    const [artifactPath, expectedMode] = RELEASE_ARTIFACT_SPECS[index];
    exactKeys(candidate, ['path', 'sha256', 'bytes', 'mode'], `Release artifact ${index}`);
    if (candidate.path !== artifactPath || candidate.mode !== expectedMode) {
      refuse(`Release artifact set or mode is invalid at ${artifactPath}.`);
    }
    sha256(candidate.sha256, `${artifactPath} sha256`);
    bytes(candidate.bytes, `${artifactPath} bytes`);
    return candidate;
  });
}

export function parseManifestBoundRelease(value) {
  const manifest = object(value, 'Release manifest');
  exactKeys(
    manifest,
    [
      'manifestVersion',
      'releaseCommit',
      'images',
      'sourceArchive',
      'imageBundle',
      'targetEngineEvidence',
      'artifactModeAuthority',
      'artifacts',
    ],
    'Release manifest',
  );
  if (manifest.manifestVersion !== 2 || !COMMIT.test(manifest.releaseCommit)) {
    refuse('Release manifest version or commit is invalid.');
  }
  if (manifest.artifactModeAuthority !== 'required-install-mode') {
    refuse('Release artifact mode authority is invalid.');
  }
  const images = parseImages(manifest.images, manifest.releaseCommit);
  const sourceArchive = parseFileBinding(
    manifest.sourceArchive,
    'source.tar.gz',
    'Source archive binding',
  );
  exactKeys(
    manifest.imageBundle,
    ['fileName', 'sha256', 'bytes', 'inventory'],
    'Image bundle binding',
  );
  if (manifest.imageBundle.fileName !== 'images.tar') {
    refuse('Image bundle binding fileName must be images.tar.');
  }
  sha256(manifest.imageBundle.sha256, 'Image bundle binding.sha256');
  bytes(manifest.imageBundle.bytes, 'Image bundle binding.bytes');
  const inventory = parseInventory(manifest.imageBundle.inventory, images);
  const targetEngineEvidence = parseFileBinding(
    manifest.targetEngineEvidence,
    'target-engine-evidence.json',
    'Target-engine evidence binding',
  );
  const artifacts = parseArtifacts(manifest.artifacts);
  return {
    manifestVersion: 2,
    releaseCommit: manifest.releaseCommit,
    images,
    sourceArchive,
    imageBundle: { ...manifest.imageBundle, inventory },
    targetEngineEvidence,
    artifactModeAuthority: manifest.artifactModeAuthority,
    artifacts,
  };
}

function sameState(left, right) {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

async function assertFileAuthority(filePath, label, options) {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    refuse(`${label} must be a regular non-symlink file.`);
  }
  if (path.resolve(await realpath(filePath)) !== path.resolve(filePath)) {
    refuse(`${label} must use its canonical path.`);
  }
  if (process.platform !== 'win32') {
    if (options.requireRootOwner && before.uid !== 0) refuse(`${label} must be owned by root.`);
    if ((before.mode & 0o777) !== Number.parseInt(options.mode, 8)) {
      refuse(`${label} mode does not match ${options.mode}.`);
    }
  }
  return before;
}

async function verifyFile(filePath, expected, label, options) {
  const before = await assertFileAuthority(filePath, label, options);
  const hash = createHash('sha256');
  let observedBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    observedBytes += chunk.length;
    hash.update(chunk);
  }
  const after = await stat(filePath);
  if (!sameState(before, after)) refuse(`${label} changed during verification.`);
  const observedHash = hash.digest('hex');
  if (observedHash !== expected.sha256) refuse(`${label} hash does not match the manifest.`);
  if (observedBytes !== expected.bytes) refuse(`${label} byte size does not match the manifest.`);
  return { sha256: observedHash, bytes: observedBytes };
}

async function verifyImageBundle(filePath, manifest, requireRootOwner) {
  const before = await assertFileAuthority(filePath, 'Image bundle', {
    mode: '0600',
    requireRootOwner,
  });
  const specs = manifest.images.map((image) => ({
    role: image.role,
    sourceReference: sourceReference(image.reference),
    external: image.reference.includes('@'),
    expectedOciIndexDigest: image.ociIndexDigest,
  }));
  const observed = await inspectOciImageBundle(filePath, specs);
  const after = await assertFileAuthority(filePath, 'Image bundle', {
    mode: '0600',
    requireRootOwner,
  });
  if (!sameState(before, after)) refuse('Image bundle changed during verification.');
  if (
    observed.sha256 !== manifest.imageBundle.sha256 ||
    observed.bytes !== manifest.imageBundle.bytes
  ) {
    refuse('Image bundle hash or byte size does not match the manifest.');
  }
  if (!isDeepStrictEqual(observed.inventory, manifest.imageBundle.inventory)) {
    refuse('Image bundle inventory does not match the actual OCI bytes.');
  }
  return { sha256: observed.sha256, bytes: observed.bytes };
}

async function readEvidence(filePath, binding, requireRootOwner) {
  await verifyFile(filePath, binding, 'Target-engine evidence', {
    mode: '0600',
    requireRootOwner,
  });
  if (binding.bytes > MAX_JSON_BYTES) refuse('Target-engine evidence exceeds 1 MiB.');
  const evidenceBytes = await readFile(filePath);
  if (
    evidenceBytes.length !== binding.bytes ||
    createHash('sha256').update(evidenceBytes).digest('hex') !== binding.sha256
  ) {
    refuse('Target-engine evidence changed after verification.');
  }
  let value;
  try {
    value = JSON.parse(evidenceBytes.toString('utf8'));
  }
  catch {
    refuse('Target-engine evidence is not valid JSON.');
  }
  return object(value, 'Target-engine evidence');
}

function exactArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    refuse(`${label} does not match the exact image authority.`);
  }
}

function verifyEvidence(value, manifest) {
  exactKeys(
    value,
    ['schemaVersion', 'project', 'releaseCommit', 'imageBundleSha256', 'docker', 'images'],
    'Target-engine evidence',
  );
  if (
    value.schemaVersion !== 1 ||
    value.project !== 'easyfire-bookkeeping' ||
    value.releaseCommit !== manifest.releaseCommit ||
    value.imageBundleSha256 !== `sha256:${manifest.imageBundle.sha256}`
  ) {
    refuse('Target-engine evidence does not bind the exact release image bundle.');
  }
  exactKeys(
    value.docker,
    ['serverVersion', 'operatingSystem', 'architecture'],
    'Target-engine Docker identity',
  );
  if (
    value.docker.serverVersion !== DOCKER_VERSION ||
    value.docker.operatingSystem !== 'linux' ||
    value.docker.architecture !== 'amd64'
  ) {
    refuse('Target-engine Docker identity is not the pinned linux/amd64 engine.');
  }
  if (!Array.isArray(value.images) || value.images.length !== ROLES.length) {
    refuse('Target-engine evidence must contain exactly seven images.');
  }
  value.images.forEach((candidate, index) => {
    const image = manifest.images[index];
    const role = ROLES[index];
    exactKeys(
      candidate,
      ['reference', 'Id', 'RepoTags', 'RepoDigests', 'externalDigestAuthority'],
      `${role} target-engine evidence`,
    );
    const tagged = sourceReference(image.reference);
    if (candidate.reference !== tagged || candidate.Id !== image.engineImageId) {
      refuse(`${role} target Docker Id does not match release engineImageId.`);
    }
    exactArray(candidate.RepoTags, [tagged], `${role} RepoTags`);
    if (image.reference.includes('@')) {
      const repoDigest = `${repositoryOf(tagged)}@${image.ociIndexDigest}`;
      exactArray(candidate.RepoDigests, [repoDigest], `${role} RepoDigests`);
      if (candidate.externalDigestAuthority !== repoDigest) {
        refuse(`${role} external digest authority is invalid.`);
      }
    }
    else {
      exactArray(candidate.RepoDigests, [], `${role} RepoDigests`);
      if (candidate.externalDigestAuthority !== null) {
        refuse(`${role} must not claim external digest authority.`);
      }
    }
  });
}

function installedCopySpecs(options) {
  return [
    {
      source: 'packages/guardian/dist/guardian.js',
      target: path.join(options.guardianInstallRoot, 'guardian.js'),
      label: 'Installed Guardian guardian.js',
    },
    {
      source: 'packages/guardian/dist/runtime-manifest-generator.js',
      target: path.join(options.guardianInstallRoot, 'runtime-manifest-generator.js'),
      label: 'Installed Guardian runtime-manifest-generator.js',
    },
    ...[
      'easyfire-bookkeeping-stack.service',
      'easyfire-bookkeeping-guardian.service',
      'easyfire-bookkeeping-guardian.timer',
    ].map((name) => ({
      source: `deploy/linux/${name}`,
      target: path.join(options.systemdRoot, name),
      label: `Installed systemd ${name}`,
    })),
  ];
}

export async function verifyManifestBoundRelease(options) {
  const manifest = parseManifestBoundRelease(options.manifestValue);
  const requireRootOwner = options.requireRootOwner ?? true;
  const requireInstalledCopies = options.requireInstalledCopies ?? true;
  if (typeof requireInstalledCopies !== 'boolean') {
    refuse('requireInstalledCopies must be boolean.');
  }
  const releaseState = await lstat(options.releasePath);
  if (releaseState.isSymbolicLink() || !releaseState.isDirectory()) {
    refuse('Release path must be a regular non-symlink directory.');
  }
  if (process.platform !== 'win32' && requireRootOwner && releaseState.uid !== 0) {
    refuse('Release path must be owned by root.');
  }

  const artifactProof = [];
  const artifactsByPath = new Map(manifest.artifacts.map((entry) => [entry.path, entry]));
  for (const artifact of manifest.artifacts) {
    const target = path.resolve(options.releasePath, ...artifact.path.split('/'));
    if (!target.startsWith(`${path.resolve(options.releasePath)}${path.sep}`)) {
      refuse(`Release artifact path escapes the release: ${artifact.path}.`);
    }
    const proof = await verifyFile(target, artifact, `Release artifact ${artifact.path}`, {
      mode: artifact.mode,
      requireRootOwner,
    });
    artifactProof.push({ path: artifact.path, ...proof, mode: artifact.mode });
  }

  const installedProof = [];
  const copies = requireInstalledCopies
    ? installedCopySpecs(options)
    : installedCopySpecs(options).filter(
      ({ source }) => source === 'packages/guardian/dist/runtime-manifest-generator.js',
    );
  for (const copy of copies) {
    const source = artifactsByPath.get(copy.source);
    const proof = await verifyFile(copy.target, source, copy.label, {
      mode: source.mode,
      requireRootOwner,
    });
    installedProof.push({ source: copy.source, targetName: path.basename(copy.target), ...proof });
  }

  for (const [filePath, binding, label] of [
    [options.sourceArchivePath, manifest.sourceArchive, 'Source archive'],
    [options.imageBundlePath, manifest.imageBundle, 'Image bundle'],
    [options.engineEvidencePath, manifest.targetEngineEvidence, 'Target-engine evidence'],
  ]) {
    if (path.basename(filePath) !== binding.fileName) {
      refuse(`${label} path does not match manifest fileName ${binding.fileName}.`);
    }
  }

  const sourceArchive = await verifyFile(
    options.sourceArchivePath,
    manifest.sourceArchive,
    'Source archive',
    { mode: '0600', requireRootOwner },
  );
  const imageBundle = await verifyImageBundle(
    options.imageBundlePath,
    manifest,
    requireRootOwner,
  );
  const evidence = await readEvidence(
    options.engineEvidencePath,
    manifest.targetEngineEvidence,
    requireRootOwner,
  );
  verifyEvidence(evidence, manifest);
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    releaseCommit: manifest.releaseCommit,
    sourceArchive,
    imageBundle,
    targetEngineEvidence: {
      sha256: manifest.targetEngineEvidence.sha256,
      bytes: manifest.targetEngineEvidence.bytes,
    },
    artifacts: artifactProof,
    installedCopies: installedProof,
  };
}
