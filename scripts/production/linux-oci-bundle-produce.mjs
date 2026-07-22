#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
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

import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
import { inspectOciImageBundle } from './linux-release-manifest-v2.mjs';

const COMMIT = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BLOB_PATH = /^blobs\/sha256\/([a-f0-9]{64})$/;
const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';
const IN_TOTO_LAYER = 'application/vnd.in-toto+json';
const READ_CHUNK = 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024 * 1024;
const ROLES = Object.freeze([
  'envoy',
  'webapp',
  'server',
  'gotenberg',
  'mysql',
  'redis',
  'migration',
]);

const refuse = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value, label) => {
  if (!isObject(value)) refuse(`${label} must be an object.`);
  return value;
};
const exactKeys = (value, keys, label) => {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) refuse(`${label} has unexpected or missing fields.`);
};
const safeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    refuse(`${label} must be a non-negative safe integer.`);
  }
  return value;
};
const digest = (value, label) => {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    refuse(`${label} must be a lowercase sha256 digest.`);
  }
  return value;
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameState = (left, right) =>
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs &&
  left.ino === right.ino &&
  left.dev === right.dev;

export const DEFAULT_IMAGE_SPECS = (releaseCommit) => {
  if (!COMMIT.test(releaseCommit)) refuse('releaseCommit must be 40 lowercase hexadecimal characters.');
  return [
    {
      role: 'envoy',
      sourceReference: 'envoyproxy/envoy:v1.30.11',
      external: true,
      expectedOciIndexDigest:
        'sha256:b5cc70f5fe5503858817e897ae1da5d873dc32cbc493790b4e330b8a42c4af9d',
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
      expectedOciIndexDigest:
        'sha256:d03b8a04c6e6c5e568b38f57352266dee4674849b71818774025f8f48d869a9a',
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
};

function validateSpecs(specs) {
  if (!Array.isArray(specs) || specs.length !== ROLES.length) {
    refuse('Image specification must contain exactly seven roles.');
  }
  return specs.map((candidate, index) => {
    const role = ROLES[index];
    object(candidate, `${role} image specification`);
    if (
      candidate.role !== role ||
      typeof candidate.sourceReference !== 'string' ||
      candidate.sourceReference.length < 3 ||
      candidate.sourceReference.length > 512 ||
      /[\s\0@]/.test(candidate.sourceReference) ||
      candidate.external !== ['envoy', 'gotenberg'].includes(role)
    ) refuse(`${role} image specification is invalid.`);
    if (candidate.external) {
      digest(candidate.expectedOciIndexDigest, `${role} expected OCI index digest`);
    }
    return candidate;
  });
}

async function assertInputFile(filePath, label, requireRootOwner) {
  if (!path.isAbsolute(filePath)) refuse(`${label} path must be absolute.`);
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    refuse(`${label} must be a regular non-symlink file.`);
  }
  if (path.resolve(await realpath(filePath)) !== path.resolve(filePath)) {
    refuse(`${label} path must be canonical.`);
  }
  if (
    before.size < 1536 ||
    before.size > MAX_ARCHIVE_BYTES ||
    before.size % 512 !== 0
  ) refuse(`${label} is not a complete block-aligned tar archive.`);
  if (process.platform !== 'win32') {
    if (requireRootOwner && before.uid !== 0) refuse(`${label} must be owned by root.`);
    if ((before.mode & 0o777) !== 0o600) refuse(`${label} mode must be 0600.`);
  }
  return before;
}

function parseTarNumber(buffer, start, length, label) {
  const field = buffer.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) refuse(`${label} uses unsupported base-256 encoding.`);
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) refuse(`${label} is not a canonical octal value.`);
  return safeInteger(Number.parseInt(text, 8), label);
}

function tarString(header, start, length, label) {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  const bytes = end < 0 ? field : field.subarray(0, end);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    refuse(`${label} is not valid UTF-8.`);
  }
}

function tarPath(header, directory) {
  const name = tarString(header, 0, 100, 'Tar path');
  const prefix = tarString(header, 345, 155, 'Tar prefix');
  const raw = prefix ? `${prefix}/${name}` : name;
  const joined = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (
    joined.length === 0 ||
    joined.startsWith('/') ||
    joined.includes('\\') ||
    joined.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) refuse('OCI input contains an unsafe or non-canonical path.');
  return joined;
}

function verifyTarHeader(header) {
  const recorded = parseTarNumber(header, 148, 8, 'Tar header checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (recorded !== actual) refuse('OCI input tar header checksum mismatch.');
}

const allZero = (buffer) => buffer.every((byte) => byte === 0);

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

async function scanInputArchive(filePath, label, requireRootOwner) {
  const initial = await assertInputFile(filePath, label, requireRootOwner);
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const entries = new Map();
  const names = new Set();
  const foldedNames = new Map();
  let position = 0;
  let ended = false;
  try {
    while (position < initial.size) {
      const header = await readExact(handle, position, 512, `${label} tar header`);
      position += 512;
      if (allZero(header)) {
        const second = await readExact(handle, position, 512, `${label} tar end marker`);
        position += 512;
        if (!allZero(second)) refuse(`${label} has only one zero end marker.`);
        while (position < initial.size) {
          const length = Math.min(READ_CHUNK, initial.size - position);
          const trailing = await readExact(handle, position, length, `${label} tar trailer`);
          position += length;
          if (!allZero(trailing)) refuse(`${label} contains data after its end markers.`);
        }
        ended = true;
        break;
      }
      verifyTarHeader(header);
      const type = header[156];
      const directory = type === '5'.charCodeAt(0);
      const entryPath = tarPath(header, directory);
      const folded = entryPath.toLocaleLowerCase('en-US');
      if (names.has(entryPath) || (foldedNames.has(folded) && foldedNames.get(folded) !== entryPath)) {
        refuse(`${label} contains a duplicate or case-ambiguous path ${entryPath}.`);
      }
      names.add(entryPath);
      foldedNames.set(folded, entryPath);
      const size = parseTarNumber(header, 124, 12, `${entryPath} size`);
      if (directory) {
        if (size !== 0 || !['blobs', 'blobs/sha256'].includes(entryPath)) {
          refuse(`${label} contains an unexpected OCI directory ${entryPath}.`);
        }
        continue;
      }
      if (type !== 0 && type !== '0'.charCodeAt(0)) {
        refuse(`${label} entry ${entryPath} has unsupported type ${type}.`);
      }
      if (!['oci-layout', 'index.json'].includes(entryPath) && !BLOB_PATH.test(entryPath)) {
        refuse(`${label} contains unexpected file ${entryPath}.`);
      }
      const dataOffset = position;
      const entryHash = createHash('sha256');
      const capture = ['oci-layout', 'index.json'].includes(entryPath);
      if (capture && size > MAX_JSON_BYTES) refuse(`${entryPath} exceeds the JSON size limit.`);
      const captured = capture ? Buffer.alloc(size) : undefined;
      let consumed = 0;
      while (consumed < size) {
        const length = Math.min(READ_CHUNK, size - consumed);
        const chunk = await readExact(handle, position, length, entryPath);
        entryHash.update(chunk);
        if (captured) chunk.copy(captured, consumed);
        consumed += length;
        position += length;
      }
      const padding = (512 - (size % 512)) % 512;
      if (padding > 0) {
        const paddingBytes = await readExact(handle, position, padding, `${entryPath} padding`);
        position += padding;
        if (!allZero(paddingBytes)) refuse(`${entryPath} has nonzero tar padding.`);
      }
      const observed = entryHash.digest('hex');
      const blob = BLOB_PATH.exec(entryPath);
      if (blob && blob[1] !== observed) refuse(`${entryPath} digest does not match its bytes.`);
      entries.set(entryPath, { dataOffset, size, sha256: observed, captured });
    }
    if (!ended || position !== initial.size) refuse(`${label} is truncated or has an invalid trailer.`);
    const finalState = await handle.stat();
    if (!sameState(initial, finalState)) refuse(`${label} changed during verification.`);
    return { filePath, label, handle, initial, entries };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

function parseJson(bytes, label) {
  if (!bytes || bytes.length > MAX_JSON_BYTES) refuse(`${label} is missing or too large.`);
  try {
    return object(JSON.parse(bytes.toString('utf8')), label);
  } catch (error) {
    if (error?.message?.includes(label)) throw error;
    refuse(`${label} is not valid JSON.`);
  }
}

function requireDescriptor(value, mediaType, label) {
  const candidate = object(value, label);
  if (candidate.mediaType !== mediaType) refuse(`${label} mediaType is invalid.`);
  digest(candidate.digest, `${label}.digest`);
  safeInteger(candidate.size, `${label}.size`);
  return candidate;
}

function blobEntry(archive, descriptorValue, label) {
  const candidate = requireDescriptor(
    descriptorValue,
    descriptorValue.mediaType,
    label,
  );
  const entry = archive.entries.get(`blobs/sha256/${candidate.digest.slice(7)}`);
  if (!entry || entry.size !== candidate.size || entry.sha256 !== candidate.digest.slice(7)) {
    refuse(`${label} does not match a content-addressed blob.`);
  }
  return entry;
}

async function readJsonBlob(archive, descriptorValue, mediaType, label) {
  requireDescriptor(descriptorValue, mediaType, label);
  const entry = blobEntry(archive, descriptorValue, label);
  if (entry.size > MAX_JSON_BYTES) refuse(`${label} exceeds the JSON size limit.`);
  const bytes = await readExact(archive.handle, entry.dataOffset, entry.size, label);
  if (hash(bytes) !== entry.sha256) refuse(`${label} changed after archive verification.`);
  return parseJson(bytes, label);
}

function normalizedRootReference(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 512 ||
    /[\s\0@]/.test(value)
  ) refuse(`${label} is not an exact tagged image reference.`);
  return value.startsWith('docker.io/') ? value.slice('docker.io/'.length) : value;
}

function platformIdentity(descriptorValue, label) {
  const platform = object(descriptorValue.platform, `${label}.platform`);
  if (
    typeof platform.os !== 'string' ||
    typeof platform.architecture !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(platform.os) ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(platform.architecture)
  ) refuse(`${label} has an invalid platform identity.`);
  if ('variant' in platform && (
    typeof platform.variant !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(platform.variant)
  )) refuse(`${label} has an invalid platform variant.`);
  const unknownOs = platform.os === 'unknown';
  const unknownArchitecture = platform.architecture === 'unknown';
  if (unknownOs !== unknownArchitecture) {
    refuse(`${label} has a partially unknown platform identity.`);
  }
  return {
    os: platform.os,
    architecture: platform.architecture,
    attestation: unknownOs && unknownArchitecture,
  };
}

function attestationAuthority(descriptorValue, label) {
  const annotations = object(descriptorValue.annotations, `${label}.annotations`);
  if (annotations['vnd.docker.reference.type'] !== 'attestation-manifest') {
    refuse(`${label} is not a declared Docker attestation manifest.`);
  }
  return digest(
    annotations['vnd.docker.reference.digest'],
    `${label} vnd.docker.reference.digest`,
  );
}

async function validateIndexedManifest(
  archive,
  descriptorValue,
  spec,
  index,
  referenced,
) {
  const label = `${spec.role} indexed manifest ${index}`;
  const manifestDescriptor = requireDescriptor(descriptorValue, OCI_MANIFEST, label);
  const platform = platformIdentity(manifestDescriptor, label);
  referenced.add(manifestDescriptor.digest);
  const manifest = await readJsonBlob(
    archive,
    manifestDescriptor,
    OCI_MANIFEST,
    `${label} document`,
  );
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== OCI_MANIFEST) {
    refuse(`${label} identity is invalid.`);
  }
  const config = requireDescriptor(
    manifest.config,
    OCI_CONFIG,
    `${label} config descriptor`,
  );
  referenced.add(config.digest);
  const configValue = await readJsonBlob(
    archive,
    config,
    OCI_CONFIG,
    `${label} config`,
  );
  if (!platform.attestation && (
    configValue.os !== platform.os ||
    configValue.architecture !== platform.architecture
  )) refuse(`${label} config does not match its declared platform.`);
  if (!Array.isArray(manifest.layers)) refuse(`${label} layers must be an array.`);
  if (platform.attestation && manifest.layers.length < 1) {
    refuse(`${label} attestation must contain at least one statement layer.`);
  }
  for (const [layerIndex, layerValue] of manifest.layers.entries()) {
    const layer = object(layerValue, `${label} layer ${layerIndex}`);
    const validMediaType = platform.attestation
      ? layer.mediaType === IN_TOTO_LAYER
      : typeof layer.mediaType === 'string' &&
        layer.mediaType.startsWith('application/vnd.oci.image.layer.v1');
    if (!validMediaType) refuse(`${label} layer ${layerIndex} mediaType is invalid.`);
    digest(layer.digest, `${label} layer ${layerIndex}.digest`);
    safeInteger(layer.size, `${label} layer ${layerIndex}.size`);
    blobEntry(archive, layer, `${label} layer ${layerIndex}`);
    referenced.add(layer.digest);
  }
  return {
    descriptor: manifestDescriptor,
    platform,
    attestationTarget: platform.attestation
      ? attestationAuthority(manifestDescriptor, label)
      : null,
  };
}

async function validateImageArchive(archive, spec) {
  const layout = parseJson(archive.entries.get('oci-layout')?.captured, `${spec.role} OCI layout`);
  exactKeys(layout, ['imageLayoutVersion'], `${spec.role} OCI layout`);
  if (layout.imageLayoutVersion !== '1.0.0') refuse(`${spec.role} OCI layout version is invalid.`);
  const root = parseJson(archive.entries.get('index.json')?.captured, `${spec.role} root index`);
  if (
    root.schemaVersion !== 2 ||
    root.mediaType !== OCI_INDEX ||
    !Array.isArray(root.manifests) ||
    root.manifests.length !== 1
  ) refuse(`${spec.role} root index must contain exactly one image index.`);
  const rootDescriptor = requireDescriptor(root.manifests[0], OCI_INDEX, `${spec.role} root descriptor`);
  if (
    !isObject(rootDescriptor.annotations) ||
    normalizedRootReference(
      rootDescriptor.annotations['io.containerd.image.name'],
      `${spec.role} OCI reference/tag`,
    ) !== spec.sourceReference
  ) refuse(`${spec.role} OCI reference/tag is invalid.`);
  if (spec.external && rootDescriptor.digest !== spec.expectedOciIndexDigest) {
    refuse(`${spec.role} OCI index digest differs from its pinned authority.`);
  }
  const referenced = new Set([rootDescriptor.digest]);
  const imageIndex = await readJsonBlob(
    archive,
    rootDescriptor,
    OCI_INDEX,
    `${spec.role} image index`,
  );
  if (
    imageIndex.schemaVersion !== 2 ||
    imageIndex.mediaType !== OCI_INDEX ||
    !Array.isArray(imageIndex.manifests) ||
    imageIndex.manifests.length < 1 ||
    imageIndex.manifests.length > 256
  ) refuse(`${spec.role} image index has an invalid manifest inventory.`);
  const children = [];
  const childDigests = new Set();
  for (const [index, candidate] of imageIndex.manifests.entries()) {
    const child = await validateIndexedManifest(
      archive,
      candidate,
      spec,
      index,
      referenced,
    );
    if (childDigests.has(child.descriptor.digest)) {
      refuse(`${spec.role} image index contains a duplicate manifest descriptor.`);
    }
    childDigests.add(child.descriptor.digest);
    children.push(child);
  }
  const runnable = children.filter(({ platform }) => !platform.attestation);
  const linuxAmd64 = runnable.filter(({ platform }) =>
    platform.os === 'linux' && platform.architecture === 'amd64');
  if (linuxAmd64.length !== 1) {
    refuse(`${spec.role} image index must contain exactly one linux/amd64 manifest.`);
  }
  const runnableDigests = new Set(runnable.map(({ descriptor }) => descriptor.digest));
  for (const child of children.filter(({ platform }) => platform.attestation)) {
    if (!runnableDigests.has(child.attestationTarget)) {
      refuse(`${spec.role} attestation does not bind a runnable manifest in its index.`);
    }
  }
  for (const entryPath of archive.entries.keys()) {
    const match = BLOB_PATH.exec(entryPath);
    if (match && !referenced.has(`sha256:${match[1]}`)) {
      refuse(`${spec.role} OCI input contains unreferenced blob ${entryPath}.`);
    }
  }
  return {
    rootDescriptor: {
      mediaType: OCI_INDEX,
      digest: rootDescriptor.digest,
      size: rootDescriptor.size,
      annotations: { 'io.containerd.image.name': spec.sourceReference },
    },
    referenced,
  };
}

function tarHeader(name, size) {
  if (Buffer.byteLength(name) > 100) refuse(`Output tar path is too long: ${name}.`);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  const octal = (start, length, value) => {
    header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length, 'ascii');
  };
  octal(100, 8, 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

async function writeAll(handle, bytes, state) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      state.position,
    );
    if (bytesWritten < 1) refuse('OCI output write made no progress.');
    state.hash.update(bytes.subarray(offset, offset + bytesWritten));
    state.position += bytesWritten;
    offset += bytesWritten;
  }
}

async function writeBytesEntry(handle, name, bytes, state) {
  await writeAll(handle, tarHeader(name, bytes.length), state);
  await writeAll(handle, bytes, state);
  const padding = (512 - (bytes.length % 512)) % 512;
  if (padding > 0) await writeAll(handle, Buffer.alloc(padding), state);
}

async function writeBlobEntry(handle, name, source, state) {
  await writeAll(handle, tarHeader(name, source.size), state);
  const observed = createHash('sha256');
  let consumed = 0;
  while (consumed < source.size) {
    const length = Math.min(READ_CHUNK, source.size - consumed);
    const chunk = await readExact(source.handle, source.dataOffset + consumed, length, name);
    observed.update(chunk);
    await writeAll(handle, chunk, state);
    consumed += length;
  }
  if (observed.digest('hex') !== source.sha256) refuse(`${name} changed while writing output.`);
  const padding = (512 - (source.size % 512)) % 512;
  if (padding > 0) await writeAll(handle, Buffer.alloc(padding), state);
}

async function assertOutputTarget(output) {
  if (!path.isAbsolute(output) || path.basename(output) !== 'images.tar') {
    refuse('Output must be an absolute path named images.tar.');
  }
  if (await lstat(output).catch(() => null)) refuse('images.tar already exists; overwrite is forbidden.');
}

async function publishBundle(output, rootIndexBytes, blobs, specs) {
  const parent = path.dirname(output);
  const parentState = await lstat(parent);
  if (
    parentState.isSymbolicLink() ||
    !parentState.isDirectory() ||
    path.resolve(await realpath(parent)) !== path.resolve(parent)
  ) refuse('Output parent must be a canonical non-symlink directory.');
  const temporary = path.join(parent, `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const state = { position: 0, hash: createHash('sha256') };
    await writeBytesEntry(
      handle,
      'oci-layout',
      Buffer.from('{"imageLayoutVersion":"1.0.0"}\n'),
      state,
    );
    await writeBytesEntry(handle, 'index.json', rootIndexBytes, state);
    for (const [blobDigest, source] of [...blobs.entries()].sort(([left], [right]) =>
      left.localeCompare(right))) {
      await writeBlobEntry(handle, `blobs/sha256/${blobDigest.slice(7)}`, source, state);
    }
    await writeAll(handle, Buffer.alloc(1024), state);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const proof = await inspectOciImageBundle(temporary, specs);
    if (proof.sha256 !== state.hash.digest('hex') || proof.bytes !== state.position) {
      refuse('OCI output readback differs from the bytes written.');
    }
    try {
      await link(temporary, output);
    } catch (error) {
      if (error?.code === 'EEXIST') refuse('images.tar already exists; overwrite is forbidden.');
      throw error;
    }
    return proof;
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export async function produceOciBundle({
  releaseCommit,
  inputArchives,
  output,
  specs = DEFAULT_IMAGE_SPECS(releaseCommit),
  requireRootOwner = true,
}) {
  if (!COMMIT.test(releaseCommit)) refuse('releaseCommit must be 40 lowercase hexadecimal characters.');
  if (typeof requireRootOwner !== 'boolean') refuse('requireRootOwner must be boolean.');
  const validatedSpecs = validateSpecs(specs);
  exactKeys(inputArchives, ROLES, 'OCI input archive map');
  await assertOutputTarget(output);
  const inputPaths = ROLES.map((role) => inputArchives[role]);
  if (new Set(inputPaths.map((candidate) => path.resolve(candidate))).size !== ROLES.length) {
    refuse('Each image role must use a distinct OCI input archive.');
  }
  const archives = [];
  try {
    for (const spec of validatedSpecs) {
      archives.push(await scanInputArchive(
        inputArchives[spec.role],
        `${spec.role} OCI input`,
        requireRootOwner,
      ));
    }
    const validations = [];
    for (let index = 0; index < archives.length; index += 1) {
      validations.push(await validateImageArchive(archives[index], validatedSpecs[index]));
    }
    const blobs = new Map();
    for (let index = 0; index < archives.length; index += 1) {
      for (const blobDigest of validations[index].referenced) {
        const entry = archives[index].entries.get(`blobs/sha256/${blobDigest.slice(7)}`);
        const existing = blobs.get(blobDigest);
        if (existing && existing.size !== entry.size) refuse(`Shared OCI blob ${blobDigest} is ambiguous.`);
        if (!existing) blobs.set(blobDigest, { ...entry, handle: archives[index].handle });
      }
    }
    const rootIndexBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_INDEX,
      manifests: validations.map(({ rootDescriptor }) => rootDescriptor),
    }, null, 2)}\n`);
    const proof = await publishBundle(output, rootIndexBytes, blobs, validatedSpecs);
    return { sha256: proof.sha256, bytes: proof.bytes, inventory: proof.inventory };
  } finally {
    for (const archive of archives) await archive.handle.close().catch(() => {});
  }
}

export function parseOciBundleArguments(argv) {
  const flags = ['--release-commit', ...ROLES.map((role) => `--${role}`), '--output'];
  if (argv.length !== flags.length * 2) refuse(`Required arguments: ${flags.join(', ')}.`);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flags.includes(flag) || typeof value !== 'string' || value.length === 0 || flag in parsed) {
      refuse(`Invalid, duplicate, or incomplete argument ${flag ?? '<missing>'}.`);
    }
    if (flag !== '--release-commit' && !path.isAbsolute(value)) {
      refuse(`${flag} must be an absolute path.`);
    }
    parsed[flag] = value;
  }
  if (Object.keys(parsed).length !== flags.length) refuse(`Required arguments: ${flags.join(', ')}.`);
  return {
    releaseCommit: parsed['--release-commit'],
    inputArchives: Object.fromEntries(ROLES.map((role) => [role, parsed[`--${role}`]])),
    output: parsed['--output'],
  };
}

function ensureLinuxRoot() {
  if (process.platform !== 'linux') refuse('OCI bundle producer runs only on Linux.');
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    refuse('OCI bundle producer must run as root.');
  }
}

async function main() {
  ensureLinuxRoot();
  const result = await produceOciBundle(parseOciBundleArguments(process.argv.slice(2)));
  process.stdout.write(`oci-bundle sha256:${result.sha256}\n`);
}

if (await isCanonicalMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`oci-bundle refused: ${error.message}\n`);
    process.exitCode = 1;
  });
}
