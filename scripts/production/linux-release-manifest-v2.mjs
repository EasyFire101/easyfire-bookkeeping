#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';
const PINNED_DOCKER_VERSION = '29.6.2';
const RELEASE_ARTIFACTS = Object.freeze([
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

function roleSpecs(releaseCommit, externalAuthorities) {
  return [
    {
      role: 'envoy',
      sourceReference: 'envoyproxy/envoy:v1.30.11',
      external: true,
      expectedOciIndexDigest: externalAuthorities.envoy,
    },
    {
      role: 'webapp',
      sourceReference: `easyfire-bookkeeping/webapp:git-${releaseCommit}`,
      external: false,
    },
    {
      role: 'server',
      sourceReference: `easyfire-bookkeeping/server:git-${releaseCommit}`,
      external: false,
    },
    {
      role: 'gotenberg',
      sourceReference: 'gotenberg/gotenberg:7.10.2',
      external: true,
      expectedOciIndexDigest: externalAuthorities.gotenberg,
    },
    {
      role: 'mysql',
      sourceReference: `easyfire-bookkeeping/mariadb:git-${releaseCommit}`,
      external: false,
    },
    {
      role: 'redis',
      sourceReference: `easyfire-bookkeeping/redis:git-${releaseCommit}`,
      external: false,
    },
    {
      role: 'migration',
      sourceReference: `easyfire-bookkeeping/migration:git-${releaseCommit}`,
      external: false,
    },
  ];
}

function refuse(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) refuse(`${label} must be an object.`);
  return value;
}

function exactKeys(value, keys, label) {
  requireObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    refuse(`${label} has unexpected or missing fields.`);
  }
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    refuse(`${label} must be a lowercase sha256 digest.`);
  }
  return value;
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    refuse(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function parseArguments(argv) {
  const known = new Set([
    '--release-commit',
    '--source-root',
    '--source-archive',
    '--image-bundle',
    '--engine-evidence',
    '--output',
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!known.has(flag) || typeof value !== 'string' || value.length === 0) {
      refuse(`Invalid or incomplete argument ${flag ?? '<missing>'}.`);
    }
    if (flag in result) refuse(`Duplicate argument ${flag}.`);
    result[flag] = value;
  }
  if (Object.keys(result).length !== known.size) {
    refuse(`Required arguments: ${[...known].join(', ')}.`);
  }
  if (!COMMIT.test(result['--release-commit'])) {
    refuse('--release-commit must be 40 lowercase hexadecimal characters.');
  }
  const parsed = {
    releaseCommit: result['--release-commit'],
    sourceRoot: path.resolve(result['--source-root']),
    sourceArchive: path.resolve(result['--source-archive']),
    imageBundle: path.resolve(result['--image-bundle']),
    engineEvidence: path.resolve(result['--engine-evidence']),
    output: path.resolve(result['--output']),
  };
  for (const [field, expectedName] of [
    ['sourceArchive', 'source.tar.gz'],
    ['imageBundle', 'images.tar'],
    ['engineEvidence', 'target-engine-evidence.json'],
    ['output', 'release-manifest.json'],
  ]) {
    if (path.basename(parsed[field]) !== expectedName) {
      refuse(`${field} must use the deterministic file name ${expectedName}.`);
    }
  }
  return parsed;
}

function sameFileState(left, right) {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

async function assertRegularNoFollow(filePath, label) {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    refuse(`${label} must be a regular non-symlink file.`);
  }
  const canonical = await realpath(filePath);
  if (path.resolve(canonical) !== path.resolve(filePath)) {
    refuse(`${label} must use its canonical path.`);
  }
  return before;
}

async function readJsonFile(filePath, label) {
  const before = await assertRegularNoFollow(filePath, label);
  if (before.size > MAX_JSON_BYTES) refuse(`${label} exceeds the JSON size limit.`);
  const bytes = await readFile(filePath);
  const after = await stat(filePath);
  if (!sameFileState(before, after)) refuse(`${label} changed while it was read.`);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  }
  catch {
    refuse(`${label} is not valid JSON.`);
  }
  return {
    value,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

async function readPinnedExternalAuthorities(sourceRoot) {
  const composePath = path.join(sourceRoot, 'docker-compose.prod.yml');
  const before = await assertRegularNoFollow(composePath, 'Production Compose file');
  if (before.size > MAX_JSON_BYTES) refuse('Production Compose file exceeds the size limit.');
  const source = await readFile(composePath, 'utf8');
  const after = await stat(composePath);
  if (!sameFileState(before, after)) refuse('Production Compose file changed while it was read.');
  const authorities = {};
  for (const [role, taggedReference] of [
    ['envoy', 'envoyproxy/envoy:v1.30.11'],
    ['gotenberg', 'gotenberg/gotenberg:7.10.2'],
  ]) {
    const escaped = taggedReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [
      ...source.matchAll(new RegExp(`image:\\s*["']?${escaped}@(sha256:[a-f0-9]{64})["']?\\s*$`, 'gm')),
    ];
    if (matches.length !== 1) {
      refuse(`Production Compose must pin exactly one ${role} OCI index digest.`);
    }
    authorities[role] = matches[0][1];
  }
  return authorities;
}

function parseTarNumber(buffer, start, length, label) {
  const field = buffer.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) refuse(`${label} uses unsupported base-256 encoding.`);
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) refuse(`${label} is not a canonical octal value.`);
  return requireSafeInteger(Number.parseInt(text, 8), label);
}

function tarPath(header, directory) {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  const raw = prefix ? `${prefix}/${name}` : name;
  const joined = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (
    joined.length === 0 ||
    joined.startsWith('/') ||
    joined.includes('\\') ||
    joined.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    refuse('OCI tar contains an unsafe or non-canonical path.');
  }
  return joined;
}

function verifyTarHeader(header) {
  const recorded = parseTarNumber(header, 148, 8, 'Tar header checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (recorded !== actual) refuse('OCI tar header checksum mismatch.');
}

function allZero(buffer) {
  return buffer.every((byte) => byte === 0);
}

async function readExact(handle, position, length, label) {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      output,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) refuse(`${label} is truncated.`);
    offset += bytesRead;
  }
  return output;
}

async function scanOciTar(filePath) {
  const initial = await assertRegularNoFollow(filePath, 'Image bundle');
  if (initial.size < 1536 || initial.size % 512 !== 0) {
    refuse('Image bundle is not a complete block-aligned tar archive.');
  }
  const handle = await open(filePath, 'r');
  const entries = new Map();
  const names = new Set();
  const bundleHash = createHash('sha256');
  let position = 0;
  let indexBytes;
  let layoutBytes;
  try {
    while (position < initial.size) {
      const header = await readExact(handle, position, 512, 'OCI tar header');
      bundleHash.update(header);
      position += 512;
      if (allZero(header)) {
        const second = await readExact(handle, position, 512, 'OCI tar end marker');
        bundleHash.update(second);
        position += 512;
        if (!allZero(second)) refuse('OCI tar has only one zero end marker.');
        while (position < initial.size) {
          const remaining = Math.min(READ_CHUNK_BYTES, initial.size - position);
          const trailing = await readExact(handle, position, remaining, 'OCI tar trailer');
          bundleHash.update(trailing);
          position += remaining;
          if (!allZero(trailing)) refuse('OCI tar contains data after its end markers.');
        }
        break;
      }
      verifyTarHeader(header);
      const type = header[156];
      const directory = type === '5'.charCodeAt(0);
      const entryPath = tarPath(header, directory);
      if (names.has(entryPath)) refuse(`OCI tar contains duplicate entry ${entryPath}.`);
      names.add(entryPath);
      const size = parseTarNumber(header, 124, 12, `${entryPath} size`);
      if (directory) {
        if (size !== 0) refuse(`OCI tar directory ${entryPath} has payload bytes.`);
        continue;
      }
      if (type !== 0 && type !== '0'.charCodeAt(0)) {
        refuse(`OCI tar entry ${entryPath} has unsupported type ${type}.`);
      }
      const dataOffset = position;
      const entryHash = createHash('sha256');
      const capture = entryPath === 'index.json' || entryPath === 'oci-layout';
      if (capture && size > MAX_JSON_BYTES) refuse(`${entryPath} exceeds the JSON size limit.`);
      const captured = capture ? Buffer.alloc(size) : undefined;
      let consumed = 0;
      while (consumed < size) {
        const length = Math.min(READ_CHUNK_BYTES, size - consumed);
        const chunk = await readExact(handle, position, length, entryPath);
        bundleHash.update(chunk);
        entryHash.update(chunk);
        if (captured) chunk.copy(captured, consumed);
        consumed += length;
        position += length;
      }
      const padding = (512 - (size % 512)) % 512;
      if (padding > 0) {
        const paddingBytes = await readExact(handle, position, padding, `${entryPath} padding`);
        bundleHash.update(paddingBytes);
        position += padding;
        if (!allZero(paddingBytes)) refuse(`${entryPath} has nonzero tar padding.`);
      }
      const digest = entryHash.digest('hex');
      const blobMatch = /^blobs\/sha256\/([a-f0-9]{64})$/.exec(entryPath);
      if (blobMatch && blobMatch[1] !== digest) {
        refuse(`OCI blob digest does not match its tar path: ${entryPath}.`);
      }
      entries.set(entryPath, { dataOffset, size, sha256: digest });
      if (entryPath === 'index.json') indexBytes = captured;
      if (entryPath === 'oci-layout') layoutBytes = captured;
    }
    if (position !== initial.size) refuse('OCI tar traversal did not consume the exact bundle.');
    const finalState = await handle.stat();
    if (!sameFileState(initial, finalState)) refuse('Image bundle changed during verification.');
    if (!indexBytes) refuse('OCI tar is missing its root index.json.');
    if (!layoutBytes) refuse('OCI tar is missing its root oci-layout document.');
    let layout;
    try {
      layout = JSON.parse(layoutBytes.toString('utf8'));
    }
    catch {
      refuse('OCI layout document is not valid JSON.');
    }
    exactKeys(layout, ['imageLayoutVersion'], 'OCI layout document');
    if (layout.imageLayoutVersion !== '1.0.0') refuse('OCI layout version must be 1.0.0.');
    return {
      handle,
      initial,
      entries,
      indexBytes,
      sha256: bundleHash.digest('hex'),
      bytes: initial.size,
    };
  }
  catch (error) {
    await handle.close();
    throw error;
  }
}

function requireDescriptor(value, mediaType, label) {
  const descriptorValue = requireObject(value, label);
  if (descriptorValue.mediaType !== mediaType) {
    refuse(`${label} mediaType must be ${mediaType}.`);
  }
  requireDigest(descriptorValue.digest, `${label}.digest`);
  requireSafeInteger(descriptorValue.size, `${label}.size`);
  return descriptorValue;
}

function blobEntry(bundle, descriptorValue, label) {
  const digest = requireDigest(descriptorValue.digest, `${label}.digest`);
  const entry = bundle.entries.get(`blobs/sha256/${digest.slice(7)}`);
  if (!entry) refuse(`${label} refers to a missing OCI blob.`);
  if (entry.sha256 !== digest.slice(7) || entry.size !== descriptorValue.size) {
    refuse(`${label} digest or byte size does not match the actual tar blob.`);
  }
  return entry;
}

async function readDescriptorJson(bundle, descriptorValue, mediaType, label) {
  requireDescriptor(descriptorValue, mediaType, label);
  const entry = blobEntry(bundle, descriptorValue, label);
  if (entry.size > MAX_JSON_BYTES) refuse(`${label} JSON blob exceeds the size limit.`);
  const bytes = await readExact(bundle.handle, entry.dataOffset, entry.size, label);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    refuse(`${label} blob changed after the streaming tar verification.`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  }
  catch {
    refuse(`${label} blob is not valid JSON.`);
  }
  return requireObject(value, label);
}

function normalizedReference(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 512 ||
    /[\s\0@]/.test(value)
  ) {
    refuse(`${label} is not an exact tagged image reference.`);
  }
  return value.startsWith('docker.io/') ? value.slice('docker.io/'.length) : value;
}

function rootReference(descriptorValue, label) {
  const annotations = requireObject(descriptorValue.annotations, `${label}.annotations`);
  return normalizedReference(
    annotations['io.containerd.image.name'],
    `${label} io.containerd.image.name`,
  );
}

function parseRootIndex(indexBytes) {
  let value;
  try {
    value = JSON.parse(indexBytes.toString('utf8'));
  }
  catch {
    refuse('Root index.json is not valid JSON.');
  }
  const index = requireObject(value, 'Root index.json');
  if (index.schemaVersion !== 2 || index.mediaType !== OCI_INDEX) {
    refuse('Root index.json is not an OCI image index version 2.');
  }
  if (!Array.isArray(index.manifests) || index.manifests.length !== 7) {
    refuse('Root index.json must declare exactly seven image references.');
  }
  return index;
}

async function inspectImages(bundle, specs) {
  const byReference = new Map(specs.map((spec) => [spec.sourceReference, spec]));
  const rootIndex = parseRootIndex(bundle.indexBytes);
  const roots = new Map();
  const rootDigests = new Set();
  for (const [index, candidate] of rootIndex.manifests.entries()) {
    const label = `Root image descriptor ${index}`;
    const descriptorValue = requireDescriptor(candidate, OCI_INDEX, label);
    const reference = rootReference(descriptorValue, label);
    if (!byReference.has(reference)) refuse(`Root index declares undeclared image/tag ${reference}.`);
    if (roots.has(reference)) refuse(`Root index declares duplicate image/tag ${reference}.`);
    if (rootDigests.has(descriptorValue.digest)) {
      refuse('Root index assigns one OCI image digest to multiple expected tags.');
    }
    blobEntry(bundle, descriptorValue, label);
    rootDigests.add(descriptorValue.digest);
    roots.set(reference, descriptorValue);
  }

  const inventory = [];
  for (const spec of specs) {
    const rootDescriptor = roots.get(spec.sourceReference);
    if (!rootDescriptor) refuse(`Root index is missing image role ${spec.role}.`);
    if (spec.external && rootDescriptor.digest !== spec.expectedOciIndexDigest) {
      refuse(`${spec.role} OCI index digest differs from the pinned production Compose reference.`);
    }
    const imageIndex = await readDescriptorJson(
      bundle,
      rootDescriptor,
      OCI_INDEX,
      `${spec.role} OCI index`,
    );
    if (
      imageIndex.schemaVersion !== 2 ||
      imageIndex.mediaType !== OCI_INDEX ||
      !Array.isArray(imageIndex.manifests) ||
      imageIndex.manifests.length !== 1
    ) {
      refuse(`${spec.role} OCI index must contain exactly one linux/amd64 manifest.`);
    }
    const platformDescriptor = requireDescriptor(
      imageIndex.manifests[0],
      OCI_MANIFEST,
      `${spec.role} linux/amd64 descriptor`,
    );
    const platform = requireObject(
      platformDescriptor.platform,
      `${spec.role} linux/amd64 platform`,
    );
    if (platform.os !== 'linux' || platform.architecture !== 'amd64') {
      refuse(`${spec.role} OCI index is missing the exact linux/amd64 platform.`);
    }
    const imageManifest = await readDescriptorJson(
      bundle,
      platformDescriptor,
      OCI_MANIFEST,
      `${spec.role} linux/amd64 manifest`,
    );
    if (imageManifest.schemaVersion !== 2 || imageManifest.mediaType !== OCI_MANIFEST) {
      refuse(`${spec.role} linux/amd64 manifest identity is invalid.`);
    }
    const config = requireDescriptor(
      imageManifest.config,
      OCI_CONFIG,
      `${spec.role} config descriptor`,
    );
    blobEntry(bundle, config, `${spec.role} config descriptor`);
    if (!Array.isArray(imageManifest.layers)) {
      refuse(`${spec.role} manifest layers must be an array.`);
    }
    const layers = imageManifest.layers.map((candidate, layerIndex) => {
      const layer = requireObject(candidate, `${spec.role} layer ${layerIndex}`);
      if (
        typeof layer.mediaType !== 'string' ||
        !layer.mediaType.startsWith('application/vnd.oci.image.layer.v1')
      ) {
        refuse(`${spec.role} layer ${layerIndex} has an invalid mediaType.`);
      }
      requireDigest(layer.digest, `${spec.role} layer ${layerIndex}.digest`);
      requireSafeInteger(layer.size, `${spec.role} layer ${layerIndex}.size`);
      blobEntry(bundle, layer, `${spec.role} layer ${layerIndex}`);
      return {
        digest: layer.digest,
        bytes: layer.size,
        mediaType: layer.mediaType,
      };
    });
    inventory.push({
      role: spec.role,
      sourceReference: spec.sourceReference,
      ociIndexDigest: rootDescriptor.digest,
      ociIndexBytes: rootDescriptor.size,
      linuxAmd64ManifestDigest: platformDescriptor.digest,
      linuxAmd64ManifestBytes: platformDescriptor.size,
      configDigest: config.digest,
      configBytes: config.size,
      layers,
    });
  }
  return { specs, inventory };
}

function repositoryOf(reference) {
  const lastSlash = reference.lastIndexOf('/');
  const tagSeparator = reference.lastIndexOf(':');
  if (tagSeparator <= lastSlash) refuse(`Image reference ${reference} has no exact tag.`);
  return reference.slice(0, tagSeparator);
}

function exactStringArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    refuse(`${label} does not match the exact target-engine inventory.`);
  }
}

function parseEngineEvidence(document, bundle, releaseCommit, specs, inventory) {
  const evidence = requireObject(document, 'Target-engine evidence');
  exactKeys(
    evidence,
    ['schemaVersion', 'project', 'releaseCommit', 'imageBundleSha256', 'docker', 'images'],
    'Target-engine evidence',
  );
  if (
    evidence.schemaVersion !== 1 ||
    evidence.project !== 'easyfire-bookkeeping' ||
    evidence.releaseCommit !== releaseCommit ||
    evidence.imageBundleSha256 !== `sha256:${bundle.sha256}`
  ) {
    refuse('Target-engine evidence is not bound to this release and image bundle.');
  }
  exactKeys(
    evidence.docker,
    ['serverVersion', 'operatingSystem', 'architecture'],
    'Target-engine Docker identity',
  );
  if (
    evidence.docker.serverVersion !== PINNED_DOCKER_VERSION ||
    evidence.docker.operatingSystem !== 'linux' ||
    evidence.docker.architecture !== 'amd64'
  ) {
    refuse('Target-engine evidence is not from the pinned linux/amd64 Docker Engine.');
  }
  if (!Array.isArray(evidence.images) || evidence.images.length !== specs.length) {
    refuse('Target-engine evidence must contain exactly seven image entries.');
  }
  const entries = new Map();
  for (const [index, candidate] of evidence.images.entries()) {
    exactKeys(
      candidate,
      ['reference', 'Id', 'RepoTags', 'RepoDigests', 'externalDigestAuthority'],
      `Target-engine image ${index}`,
    );
    const reference = normalizedReference(candidate.reference, `Target-engine image ${index}`);
    if (entries.has(reference)) refuse(`Target-engine evidence duplicates ${reference}.`);
    if (!specs.some((spec) => spec.sourceReference === reference)) {
      refuse(`Target-engine evidence contains undeclared reference ${reference}.`);
    }
    requireDigest(candidate.Id, `${reference} Docker Id`);
    entries.set(reference, candidate);
  }

  return specs.map((spec, index) => {
    const candidate = entries.get(spec.sourceReference);
    if (!candidate) refuse(`Target-engine evidence is missing ${spec.sourceReference}.`);
    exactStringArray(candidate.RepoTags, [spec.sourceReference], `${spec.role} RepoTags`);
    const rootDigest = inventory[index].ociIndexDigest;
    const externalDigest = `${repositoryOf(spec.sourceReference)}@${rootDigest}`;
    if (spec.external) {
      exactStringArray(candidate.RepoDigests, [externalDigest], `${spec.role} RepoDigests`);
      if (candidate.externalDigestAuthority !== externalDigest) {
        refuse(`${spec.role} external digest authority is invalid.`);
      }
    }
    else {
      exactStringArray(candidate.RepoDigests, [], `${spec.role} RepoDigests`);
      if (candidate.externalDigestAuthority !== null) {
        refuse(`${spec.role} must not claim external digest authority.`);
      }
    }
    return candidate.Id;
  });
}

async function publishExclusive(outputPath, bytes) {
  const parent = path.dirname(outputPath);
  const parentState = await lstat(parent);
  if (parentState.isSymbolicLink() || !parentState.isDirectory()) {
    refuse('Manifest output parent must be a regular non-symlink directory.');
  }
  const temporary = path.join(parent, `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, outputPath);
    }
    catch (error) {
      if (error?.code === 'EEXIST') refuse('Release manifest already exists; overwrite is forbidden.');
      throw error;
    }
  }
  finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export async function inspectOciImageBundle(imageBundlePath, specs) {
  const bundle = await scanOciTar(imageBundlePath);
  try {
    const { inventory } = await inspectImages(bundle, specs);
    return { sha256: bundle.sha256, bytes: bundle.bytes, inventory };
  }
  finally {
    await bundle.handle.close();
  }
}

export async function produceReleaseManifest(options) {
  const { verifySourceArchiveProvenance } = await import(
    './linux-source-archive-authority.mjs'
  );
  const { sourceArchive, artifacts } = await verifySourceArchiveProvenance({
    sourceArchivePath: options.sourceArchive,
    sourceRoot: options.sourceRoot,
    releaseCommit: options.releaseCommit,
    artifactSpecs: RELEASE_ARTIFACTS,
  });
  const externalAuthorities = await readPinnedExternalAuthorities(options.sourceRoot);
  const specs = roleSpecs(options.releaseCommit, externalAuthorities);
  const bundle = await inspectOciImageBundle(options.imageBundle, specs);
  const evidenceDocument = await readJsonFile(
    options.engineEvidence,
    'Target-engine evidence',
  );
  const engineImageIds = parseEngineEvidence(
    evidenceDocument.value,
    bundle,
    options.releaseCommit,
    specs,
    bundle.inventory,
  );
  const images = specs.map((spec, index) => ({
    role: spec.role,
    reference: spec.external
      ? `${spec.sourceReference}@${bundle.inventory[index].ociIndexDigest}`
      : spec.sourceReference,
    ociIndexDigest: bundle.inventory[index].ociIndexDigest,
    linuxAmd64ManifestDigest: bundle.inventory[index].linuxAmd64ManifestDigest,
    engineImageId: engineImageIds[index],
  }));
  const manifest = {
    manifestVersion: 2,
    releaseCommit: options.releaseCommit,
    images,
    sourceArchive: {
      fileName: path.basename(options.sourceArchive),
      ...sourceArchive,
    },
    imageBundle: {
      fileName: path.basename(options.imageBundle),
      ...bundle,
    },
    targetEngineEvidence: {
      fileName: path.basename(options.engineEvidence),
      sha256: evidenceDocument.sha256,
      bytes: evidenceDocument.bytes,
    },
    artifactModeAuthority: 'required-install-mode',
    artifacts,
  };
  const outputBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await publishExclusive(options.output, outputBytes);
  return { manifest, sha256: `sha256:${createHash('sha256').update(outputBytes).digest('hex')}` };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await produceReleaseManifest(options);
  process.stdout.write(`release-manifest-v2 ${result.sha256}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`release-manifest-v2 refused: ${error.message}\n`);
    process.exitCode = 1;
  });
}
