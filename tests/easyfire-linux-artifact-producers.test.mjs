import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_IMAGE_SPECS,
  produceOciBundle,
} from '../scripts/production/linux-oci-bundle-produce.mjs';
import {
  DOCKER_SOCKET,
  produceTargetEngineEvidence,
} from '../scripts/production/linux-target-engine-evidence-produce.mjs';
import { inspectOciImageBundle } from '../scripts/production/linux-release-manifest-v2.mjs';

const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';
const OCI_LAYER = 'application/vnd.oci.image.layer.v1.tar';
const ROLE_REFERENCES = [
  ['envoy', 'envoyproxy/envoy:v1.30.11', true],
  ['webapp', `easyfire-bookkeeping/webapp:git-${COMMIT}`, false],
  ['server', `easyfire-bookkeeping/server:git-${COMMIT}`, false],
  ['gotenberg', 'gotenberg/gotenberg:7.10.2', true],
  ['mysql', `easyfire-bookkeeping/mariadb:git-${COMMIT}`, false],
  ['redis', `easyfire-bookkeeping/redis:git-${COMMIT}`, false],
  ['migration', `easyfire-bookkeeping/migration:git-${COMMIT}`, false],
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const descriptor = (bytes, mediaType, extra = {}) => ({
  mediaType,
  digest: `sha256:${sha256(bytes)}`,
  size: bytes.length,
  ...extra,
});

function writeOctal(header, start, length, value) {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length, 'ascii');
}

function tarHeader(name, size, type = '0') {
  assert.ok(Buffer.byteLength(name) <= 100);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, type === '5' ? 0o755 : 0o644);
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

function tar(entries) {
  const chunks = [];
  for (const { name, bytes, type = '0' } of entries) {
    chunks.push(tarHeader(name, bytes.length, type), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function singleImageArchive(reference, seed, extraEntries = [], options = {}) {
  const blobs = [];
  const config = jsonBytes({
    architecture: 'amd64',
    os: 'linux',
    config: { Labels: { fixture: seed } },
    rootfs: { type: 'layers', diff_ids: [] },
  });
  const layer = Buffer.from(`layer:${seed}\n`);
  const manifest = jsonBytes({
    schemaVersion: 2,
    mediaType: OCI_MANIFEST,
    config: descriptor(config, OCI_CONFIG),
    layers: [descriptor(layer, OCI_LAYER)],
  });
  const manifestDescriptor = descriptor(manifest, OCI_MANIFEST, {
    platform: { architecture: 'amd64', os: 'linux' },
  });
  blobs.push(config, layer, manifest);
  const manifests = [manifestDescriptor];
  for (const [index, platform] of (options.otherPlatforms ?? []).entries()) {
    const alternateConfig = jsonBytes({
      architecture: platform.architecture,
      os: platform.os,
      config: { Labels: { fixture: `${seed}-platform-${index}` } },
      rootfs: { type: 'layers', diff_ids: [] },
    });
    const alternateLayer = Buffer.from(`layer:${seed}:platform:${index}\n`);
    const alternateManifest = jsonBytes({
      schemaVersion: 2,
      mediaType: OCI_MANIFEST,
      config: descriptor(alternateConfig, OCI_CONFIG),
      layers: [descriptor(alternateLayer, OCI_LAYER)],
    });
    manifests.push(descriptor(alternateManifest, OCI_MANIFEST, { platform }));
    blobs.push(alternateConfig, alternateLayer, alternateManifest);
  }
  if (options.duplicateAmd64) manifests.push({ ...manifestDescriptor });
  const attestationTargets = options.attestations === 'all'
    ? manifests.filter(({ platform }) => platform?.os !== 'unknown')
    : options.attestations
      ? [manifestDescriptor]
      : [];
  for (const [index, target] of attestationTargets.entries()) {
    const attestationConfig = jsonBytes({});
    const attestationLayer = jsonBytes({
      _type: 'https://in-toto.io/Statement/v0.1',
      predicateType: 'https://slsa.dev/provenance/v0.2',
      subject: [{ digest: { sha256: target.digest.slice(7) }, name: reference }],
    });
    const attestationManifest = jsonBytes({
      schemaVersion: 2,
      mediaType: OCI_MANIFEST,
      config: descriptor(attestationConfig, OCI_CONFIG),
      layers: [descriptor(attestationLayer, 'application/vnd.in-toto+json', {
        annotations: {
          'in-toto.io/predicate-type': 'https://slsa.dev/provenance/v0.2',
        },
      })],
    });
    manifests.push(descriptor(attestationManifest, OCI_MANIFEST, {
      platform: { architecture: 'unknown', os: 'unknown' },
      annotations: options.invalidAttestation && index === 0
        ? { 'vnd.docker.reference.type': 'not-an-attestation' }
        : {
          'vnd.docker.reference.digest': target.digest,
          'vnd.docker.reference.type': 'attestation-manifest',
        },
    }));
    blobs.push(attestationConfig, attestationLayer, attestationManifest);
  }
  const imageIndex = jsonBytes({
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests,
  });
  const rootIndex = jsonBytes({
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests: [descriptor(imageIndex, OCI_INDEX, {
      annotations: {
        'io.containerd.image.name': options.dockerIoPrefix
          ? `docker.io/${reference}`
          : reference,
      },
    })],
  });
  blobs.push(imageIndex);
  const uniqueBlobs = new Map(blobs.map((bytes) => [sha256(bytes), bytes]));
  return {
    bytes: tar([
      { name: 'oci-layout', bytes: jsonBytes({ imageLayoutVersion: '1.0.0' }) },
      { name: 'index.json', bytes: rootIndex },
      ...[...uniqueBlobs].map(([digestValue, bytes]) => ({
        name: `blobs/sha256/${digestValue}`,
        bytes,
      })),
      ...extraEntries,
    ]),
    configDigest: `sha256:${sha256(config)}`,
    manifestDigest: manifestDescriptor.digest,
    indexDigest: `sha256:${sha256(imageIndex)}`,
  };
}

function repositoryOf(reference) {
  return reference.slice(0, reference.lastIndexOf(':'));
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'easyfire-artifact-producers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputArchives = {};
  const imageFixtures = new Map();
  for (const [role, reference] of ROLE_REFERENCES) {
    const image = singleImageArchive(reference, role);
    const file = path.join(root, `${role}.oci.tar`);
    await writeFile(file, image.bytes);
    if (process.platform !== 'win32') await chmod(file, 0o600);
    inputArchives[role] = file;
    imageFixtures.set(role, image);
  }
  const specs = ROLE_REFERENCES.map(([role, sourceReference, external]) => ({
    role,
    sourceReference,
    external,
    ...(external
      ? { expectedOciIndexDigest: imageFixtures.get(role).indexDigest }
      : {}),
  }));
  return { root, inputArchives, imageFixtures, specs };
}

async function realShapeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'easyfire-real-shape-producers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputArchives = {};
  const imageFixtures = new Map();
  for (const [role, reference, external] of ROLE_REFERENCES) {
    const options = {
      dockerIoPrefix: true,
      ...(role === 'envoy'
        ? { otherPlatforms: [{ architecture: 'arm64', os: 'linux' }] }
        : role === 'gotenberg'
          ? {
            otherPlatforms: [
              { architecture: 'arm64', os: 'linux' },
              { architecture: '386', os: 'linux' },
              { architecture: 'arm', os: 'linux', variant: 'v7' },
            ],
            attestations: 'all',
          }
          : { attestations: true }),
    };
    const image = singleImageArchive(reference, `real-${role}`, [], options);
    const file = path.join(root, `${role}.oci.tar`);
    await writeFile(file, image.bytes);
    if (process.platform !== 'win32') await chmod(file, 0o600);
    inputArchives[role] = file;
    imageFixtures.set(role, image);
  }
  const specs = ROLE_REFERENCES.map(([role, sourceReference, external]) => ({
    role,
    sourceReference,
    external,
    ...(external
      ? { expectedOciIndexDigest: imageFixtures.get(role).indexDigest }
      : {}),
  }));
  return { root, inputArchives, imageFixtures, specs };
}

test('default producer authority fixes all seven release references and external digests', () => {
  const specs = DEFAULT_IMAGE_SPECS(COMMIT);
  assert.deepEqual(specs.map(({ role }) => role), ROLE_REFERENCES.map(([role]) => role));
  assert.equal(specs[0].sourceReference, 'envoyproxy/envoy:v1.30.11');
  assert.equal(
    specs[0].expectedOciIndexDigest,
    'sha256:b5cc70f5fe5503858817e897ae1da5d873dc32cbc493790b4e330b8a42c4af9d',
  );
  assert.equal(specs[3].sourceReference, 'gotenberg/gotenberg:7.10.2');
  assert.equal(
    specs[3].expectedOciIndexDigest,
    'sha256:d03b8a04c6e6c5e568b38f57352266dee4674849b71818774025f8f48d869a9a',
  );
  assert.equal(specs[4].sourceReference, `easyfire-bookkeeping/mariadb:git-${COMMIT}`);
});

test('OCI producer deterministically merges exactly seven validated image layouts', async (t) => {
  const value = await fixture(t);
  const first = path.join(value.root, 'first', 'images.tar');
  const second = path.join(value.root, 'second', 'images.tar');
  await mkdir(path.dirname(first));
  await mkdir(path.dirname(second));

  const proof = await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output: first,
    specs: value.specs,
    requireRootOwner: false,
  });
  await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output: second,
    specs: value.specs,
    requireRootOwner: false,
  });

  assert.deepEqual(await readFile(first), await readFile(second));
  assert.equal(proof.bytes, (await stat(first)).size);
  assert.equal(proof.sha256, sha256(await readFile(first)));
  const inspected = await inspectOciImageBundle(first, value.specs);
  assert.deepEqual(inspected.inventory.map(({ role }) => role), ROLE_REFERENCES.map(([role]) => role));
  if (process.platform !== 'win32') assert.equal((await stat(first)).mode & 0o777, 0o600);
});

test('OCI producer preserves real Docker 29 multi-platform and attestation index shapes', async (t) => {
  const value = await realShapeFixture(t);
  const output = path.join(value.root, 'bundle', 'images.tar');
  await mkdir(path.dirname(output));

  await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output,
    specs: value.specs,
    requireRootOwner: false,
  });

  const inspected = await inspectOciImageBundle(output, value.specs);
  assert.deepEqual(
    inspected.inventory.map(({ ociIndexDigest }) => ociIndexDigest),
    ROLE_REFERENCES.map(([role]) => value.imageFixtures.get(role).indexDigest),
  );
  assert.deepEqual(
    inspected.inventory.map(({ linuxAmd64ManifestDigest }) => linuxAmd64ManifestDigest),
    ROLE_REFERENCES.map(([role]) => value.imageFixtures.get(role).manifestDigest),
  );
});

test('OCI producer refuses swapped roles, digest drift, unsafe tar entries, and overwrite', async (t) => {
  const value = await fixture(t);

  const swapped = { ...value.inputArchives, webapp: value.inputArchives.server };
  await assert.rejects(
    produceOciBundle({
      releaseCommit: COMMIT,
      inputArchives: swapped,
      output: path.join(value.root, 'swapped', 'images.tar'),
      specs: value.specs,
      requireRootOwner: false,
    }),
    /distinct|webapp|reference|tag/i,
  );

  const digestDrift = value.specs.map((spec) => spec.role === 'envoy'
    ? { ...spec, expectedOciIndexDigest: `sha256:${'f'.repeat(64)}` }
    : spec);
  await assert.rejects(
    produceOciBundle({
      releaseCommit: COMMIT,
      inputArchives: value.inputArchives,
      output: path.join(value.root, 'digest', 'images.tar'),
      specs: digestDrift,
      requireRootOwner: false,
    }),
    /envoy.*digest|digest.*envoy/i,
  );

  const unsafeImage = singleImageArchive(
    ROLE_REFERENCES[1][1],
    'unsafe',
    [{ name: 'escape', bytes: Buffer.alloc(0), type: '2' }],
  );
  const unsafePath = path.join(value.root, 'unsafe.oci.tar');
  await writeFile(unsafePath, unsafeImage.bytes);
  if (process.platform !== 'win32') await chmod(unsafePath, 0o600);
  await assert.rejects(
    produceOciBundle({
      releaseCommit: COMMIT,
      inputArchives: { ...value.inputArchives, webapp: unsafePath },
      output: path.join(value.root, 'unsafe', 'images.tar'),
      specs: value.specs,
      requireRootOwner: false,
    }),
    /unsupported type|unsafe/i,
  );

  const output = path.join(value.root, 'existing', 'images.tar');
  await mkdir(path.dirname(output));
  await writeFile(output, 'preserve-me');
  await assert.rejects(
    produceOciBundle({
      releaseCommit: COMMIT,
      inputArchives: value.inputArchives,
      output,
      specs: value.specs,
      requireRootOwner: false,
    }),
    /already exists|overwrite/i,
  );
  assert.equal(await readFile(output, 'utf8'), 'preserve-me');
});

test('OCI producer rejects duplicate linux/amd64 and malformed attestation children', async (t) => {
  const value = await fixture(t);
  for (const [name, options, pattern] of [
    ['duplicate-amd64', { duplicateAmd64: true }, /exactly one linux\/amd64|duplicate/i],
    ['bad-attestation', { attestations: true, invalidAttestation: true }, /attestation/i],
  ]) {
    const image = singleImageArchive(ROLE_REFERENCES[1][1], name, [], options);
    const input = path.join(value.root, `${name}.oci.tar`);
    await writeFile(input, image.bytes);
    if (process.platform !== 'win32') await chmod(input, 0o600);
    await assert.rejects(
      produceOciBundle({
        releaseCommit: COMMIT,
        inputArchives: { ...value.inputArchives, webapp: input },
        output: path.join(value.root, name, 'images.tar'),
        specs: value.specs,
        requireRootOwner: false,
      }),
      pattern,
    );
  }
});

function dockerEvidenceRunner(value, overrides = {}) {
  const calls = [];
  const byReference = new Map(ROLE_REFERENCES.map(([role, reference, external]) => {
    const image = value.imageFixtures.get(role);
    const externalDigest = `${repositoryOf(reference)}@${image.indexDigest}`;
    return [reference, {
      Id: image.indexDigest,
      RepoTags: [reference],
      RepoDigests: external ? [externalDigest] : [],
      ...overrides[role],
    }];
  }));
  const runDocker = async (args) => {
    calls.push(args);
    assert.deepEqual(args.slice(0, 2), ['--host', DOCKER_SOCKET]);
    if (args[2] === 'version') {
      return overrides.version ?? '29.6.2|linux|amd64\n';
    }
    assert.deepEqual(args.slice(2, 5), ['image', 'inspect', '--format']);
    const image = byReference.get(args[6]);
    assert.ok(image, `unexpected image reference ${args[6]}`);
    return `${JSON.stringify(image.Id)}\n${JSON.stringify(image.RepoTags)}\n${JSON.stringify(image.RepoDigests)}\n`;
  };
  return { calls, runDocker };
}

test('target-engine producer emits exact Docker 29.6.2 linux/amd64 evidence', async (t) => {
  const value = await fixture(t);
  const imageBundle = path.join(value.root, 'bundle', 'images.tar');
  const output = path.join(value.root, 'evidence', 'target-engine-evidence.json');
  await mkdir(path.dirname(imageBundle));
  await mkdir(path.dirname(output));
  await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output: imageBundle,
    specs: value.specs,
    requireRootOwner: false,
  });
  const docker = dockerEvidenceRunner(value);

  const proof = await produceTargetEngineEvidence({
    releaseCommit: COMMIT,
    imageBundle,
    output,
    specs: value.specs,
    runDocker: docker.runDocker,
    requireRootOwner: false,
  });

  const evidence = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(evidence.imageBundleSha256, `sha256:${sha256(await readFile(imageBundle))}`);
  assert.deepEqual(evidence.docker, {
    serverVersion: '29.6.2',
    operatingSystem: 'linux',
    architecture: 'amd64',
  });
  assert.deepEqual(evidence.images.map(({ reference }) => reference), value.specs.map(({ sourceReference }) => sourceReference));
  assert.deepEqual(evidence.images.map(({ Id }) => Id), ROLE_REFERENCES.map(([role]) => value.imageFixtures.get(role).indexDigest));
  assert.equal(evidence.images[0].externalDigestAuthority, evidence.images[0].RepoDigests[0]);
  assert.equal(evidence.images[1].externalDigestAuthority, null);
  assert.equal(proof.sha256, sha256(await readFile(output)));
  assert.equal(docker.calls.length, 8);
  assert.ok(docker.calls.every((args) => args[2] === 'version' || args.slice(2, 4).join(' ') === 'image inspect'));
  if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test('target-engine producer permits offline-load external RepoDigests only when authority stays pinned', async (t) => {
  const value = await fixture(t);
  const imageBundle = path.join(value.root, 'bundle', 'images.tar');
  const output = path.join(value.root, 'evidence', 'target-engine-evidence.json');
  await mkdir(path.dirname(imageBundle));
  await mkdir(path.dirname(output));
  await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output: imageBundle,
    specs: value.specs,
    requireRootOwner: false,
  });
  const docker = dockerEvidenceRunner(value, {
    envoy: { RepoDigests: [] },
    gotenberg: { RepoDigests: [] },
  });

  await produceTargetEngineEvidence({
    releaseCommit: COMMIT,
    imageBundle,
    output,
    specs: value.specs,
    runDocker: docker.runDocker,
    requireRootOwner: false,
  });

  const evidence = JSON.parse(await readFile(output, 'utf8'));
  for (const role of ['envoy', 'gotenberg']) {
    const index = ROLE_REFERENCES.findIndex(([candidate]) => candidate === role);
    const image = evidence.images[index];
    assert.deepEqual(image.RepoDigests, []);
    assert.equal(
      image.externalDigestAuthority,
      `${repositoryOf(image.reference)}@${value.imageFixtures.get(role).indexDigest}`,
    );
  }
});

test('target-engine producer refuses engine, image ID, tag, digest, and output drift', async (t) => {
  const value = await fixture(t);
  const imageBundle = path.join(value.root, 'bundle', 'images.tar');
  await mkdir(path.dirname(imageBundle));
  await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output: imageBundle,
    specs: value.specs,
    requireRootOwner: false,
  });

  for (const [name, overrides, pattern] of [
    ['version', { version: '29.6.1|linux|amd64\n' }, /Docker.*29\.6\.2|version/i],
    ['id', { server: { Id: `sha256:${'f'.repeat(64)}` } }, /server.*Id|image ID/i],
    ['tag', { redis: { RepoTags: [ROLE_REFERENCES[5][1], 'extra:tag'] } }, /redis.*RepoTags|tag/i],
    ['digest', { envoy: { RepoDigests: [`envoyproxy/envoy@sha256:${'e'.repeat(64)}`] } }, /envoy.*RepoDigests|digest/i],
  ]) {
    const output = path.join(value.root, name, 'target-engine-evidence.json');
    await mkdir(path.dirname(output));
    const docker = dockerEvidenceRunner(value, overrides);
    await assert.rejects(
      produceTargetEngineEvidence({
        releaseCommit: COMMIT,
        imageBundle,
        output,
        specs: value.specs,
        runDocker: docker.runDocker,
        requireRootOwner: false,
      }),
      pattern,
    );
    await assert.rejects(readFile(output), /ENOENT/);
  }

  const output = path.join(value.root, 'existing', 'target-engine-evidence.json');
  await mkdir(path.dirname(output));
  await writeFile(output, 'preserve-me');
  await assert.rejects(
    produceTargetEngineEvidence({
      releaseCommit: COMMIT,
      imageBundle,
      output,
      specs: value.specs,
      runDocker: dockerEvidenceRunner(value).runDocker,
      requireRootOwner: false,
    }),
    /already exists|overwrite/i,
  );
  assert.equal(await readFile(output, 'utf8'), 'preserve-me');
});

test('Docker runner failures never echo captured output or secret-like values', async (t) => {
  const value = await fixture(t);
  const imageBundle = path.join(value.root, 'bundle', 'images.tar');
  const output = path.join(value.root, 'evidence', 'target-engine-evidence.json');
  await mkdir(path.dirname(imageBundle));
  await mkdir(path.dirname(output));
  await produceOciBundle({
    releaseCommit: COMMIT,
    inputArchives: value.inputArchives,
    output: imageBundle,
    specs: value.specs,
    requireRootOwner: false,
  });
  const secret = 'super-secret-provider-token';
  await assert.rejects(
    produceTargetEngineEvidence({
      releaseCommit: COMMIT,
      imageBundle,
      output,
      specs: value.specs,
      runDocker: async () => { throw new Error(secret); },
      requireRootOwner: false,
    }),
    (error) => !String(error.message).includes(secret),
  );
});
