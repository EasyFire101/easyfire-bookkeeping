import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { verifySourceArchiveProvenance } from '../scripts/production/linux-source-archive-authority.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const producerPath = path.join(
  root,
  'scripts',
  'production',
  'linux-release-manifest-v2.mjs',
);

const commit = 'a'.repeat(40);
const ROLE_SPECS = [
  ['envoy', 'envoyproxy/envoy:v1.30.11', true],
  ['webapp', `easyfire-bookkeeping/webapp:git-${commit}`, false],
  ['server', `easyfire-bookkeeping/server:git-${commit}`, false],
  ['gotenberg', 'gotenberg/gotenberg:7.10.2', true],
  ['mysql', `easyfire-bookkeeping/mariadb:git-${commit}`, false],
  ['redis', `easyfire-bookkeeping/redis:git-${commit}`, false],
  ['migration', `easyfire-bookkeeping/migration:git-${commit}`, false],
];

const RELEASE_ARTIFACTS = [
  'packages/guardian/dist/guardian.js',
  'packages/guardian/dist/runtime-manifest-generator.js',
  'scripts/production/linux-deploy-candidate.mjs',
  'scripts/production/linux-deploy-authority.mjs',
  'scripts/production/linux-release-authority-verify.mjs',
  'scripts/production/linux-release-manifest-v2.mjs',
  'scripts/production/linux-cli-entrypoint.mjs',
  'scripts/production/linux-oci-bundle-produce.mjs',
  'scripts/production/linux-target-engine-evidence-produce.mjs',
  'scripts/production/linux-native-auth-proof.mjs',
  'scripts/production/linux-rehearsal-evidence.mjs',
  'scripts/production/linux-source-archive-authority.mjs',
  'scripts/production/linux-deploy-docker.mjs',
  'scripts/production/linux-deploy-plan.mjs',
  'scripts/production/linux-convert-production-env.mjs',
  'scripts/production/linux-checkpoint-authority-v2.mjs',
  'scripts/production/direct-vm-checkpoint-v2-contract.mjs',
  'scripts/production/direct-vm-cutover-contract.mjs',
  'scripts/production/direct-vm-source-abort-contract.mjs',
  'scripts/production/direct-vm-cutover-authority.ps1',
  'scripts/production/direct-vm-preflight-checkpoint.ps1',
  'scripts/production/linux-final-quiescence-contract.mjs',
  'scripts/production/linux-activation-evidence-collect.mjs',
  'scripts/production/linux-guardian-promote-active.mjs',
  'scripts/production/linux-private-route-activate.mjs',
  'scripts/production/linux-backup-verify.sh',
  'scripts/production/linux-rollback-lock.mjs',
  'deploy/linux/easyfire-bookkeeping-stack.service',
  'deploy/linux/easyfire-bookkeeping-guardian.service',
  'deploy/linux/easyfire-bookkeeping-guardian.timer',
  'docker-compose.prod.yml',
  'deploy/linux/docker-compose.vm.yml',
  'deploy/linux/docker-compose.candidate.yml',
  'deploy/linux/guardian.config.example.json',
  'deploy/linux/runtime-manifest.schema.json',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function descriptor(bytes, mediaType, extra = {}) {
  return {
    mediaType,
    digest: `sha256:${sha256(bytes)}`,
    size: bytes.length,
    ...extra,
  };
}

function writeOctal(header, start, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0') + '\0';
  header.write(encoded, start, length, 'ascii');
}

function tarHeader(name, size, type = '0', mode = 0o644) {
  assert.ok(Buffer.byteLength(name) <= 100);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, mode);
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

function makeTar(entries, includeEndMarkers = true) {
  const chunks = [];
  for (const [name, bytes, type, mode] of entries) {
    chunks.push(tarHeader(name, bytes.length, type, mode), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  if (includeEndMarkers) chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function paxRecord(key, value) {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (Buffer.byteLength(`${length} ${body}`) !== length) {
    length = Buffer.byteLength(`${length} ${body}`);
  }
  return Buffer.from(`${length} ${body}`);
}

function artifactMode(artifactPath) {
  return artifactPath === 'scripts/production/linux-backup-verify.sh' ? 0o755 : 0o644;
}

function buildGitSourceArchive(artifactBytes, {
  embeddedCommit = commit,
  duplicateArtifact = false,
  pathTraversal = false,
  linkEntry = false,
  caseAlias = false,
  modeMismatch = false,
  omitArtifact = false,
  tarTruncated = false,
} = {}) {
  const archivedArtifacts = [...artifactBytes.entries()].filter(([artifactPath]) =>
    !(omitArtifact && artifactPath === 'scripts/production/linux-private-route-activate.mjs'));
  const entries = [
    ['pax_global_header', paxRecord('comment', embeddedCommit), 'g', 0o644],
    ...archivedArtifacts.map(([artifactPath, bytes]) => [
      artifactPath,
      bytes,
      '0',
      modeMismatch && artifactPath === 'scripts/production/direct-vm-cutover-authority.ps1'
        ? 0o755
        : artifactMode(artifactPath),
    ]),
  ];
  if (duplicateArtifact) {
    const duplicate = 'scripts/production/linux-private-route-activate.mjs';
    entries.push([duplicate, artifactBytes.get(duplicate), '0', 0o644]);
  }
  if (pathTraversal) entries.push(['../escape.txt', Buffer.from('escape'), '0', 0o644]);
  if (linkEntry) entries.push(['unsafe-link', Buffer.alloc(0), '2', 0o644]);
  if (caseAlias) {
    entries.push([
      'Scripts/production/linux-private-route-activate.mjs',
      Buffer.from('ambiguous alias'),
      '0',
      0o644,
    ]);
  }
  return gzipSync(makeTar(entries, !tarTruncated), { level: 9, mtime: 0 });
}

function repositoryOf(reference) {
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  assert.ok(colon > slash);
  return reference.slice(0, colon);
}

function buildOciBundle({
  extraRoot = false,
  duplicateRoot = false,
  shuffledRoot = false,
  corruptBlob = false,
  missingLinux = false,
  duplicateLinux = false,
  invalidNonRunnable,
  shorthandRoot = false,
} = {}) {
  const blobs = new Map();
  const images = [];
  let corruptPath;

  for (const [role, reference, external] of ROLE_SPECS) {
    const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', role }));
    const configDescriptor = descriptor(
      config,
      'application/vnd.oci.image.config.v1+json',
    );
    blobs.set(`blobs/sha256/${configDescriptor.digest.slice(7)}`, config);

    const layer = Buffer.from(`synthetic-layer-for-${role}`);
    const layerDescriptor = descriptor(
      layer,
      'application/vnd.oci.image.layer.v1.tar',
    );
    blobs.set(`blobs/sha256/${layerDescriptor.digest.slice(7)}`, layer);

    const manifest = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: configDescriptor,
        layers: [layerDescriptor],
      }),
    );
    const manifestDescriptor = descriptor(
      manifest,
      'application/vnd.oci.image.manifest.v1+json',
      {
        platform: {
          os: missingLinux && role === 'server' ? 'windows' : 'linux',
          architecture: 'amd64',
        },
      },
    );
    blobs.set(`blobs/sha256/${manifestDescriptor.digest.slice(7)}`, manifest);

    const indexManifests = [manifestDescriptor];
    if (external) {
      const alternateConfig = Buffer.from(
        JSON.stringify({ architecture: 'arm64', os: 'linux', role }),
      );
      const alternateConfigDescriptor = descriptor(
        alternateConfig,
        'application/vnd.oci.image.config.v1+json',
      );
      blobs.set(
        `blobs/sha256/${alternateConfigDescriptor.digest.slice(7)}`,
        alternateConfig,
      );
      const alternateLayer = Buffer.from(`synthetic-arm64-layer-for-${role}`);
      const alternateLayerDescriptor = descriptor(
        alternateLayer,
        'application/vnd.oci.image.layer.v1.tar',
      );
      blobs.set(
        `blobs/sha256/${alternateLayerDescriptor.digest.slice(7)}`,
        alternateLayer,
      );
      const alternateManifest = Buffer.from(
        JSON.stringify({
          schemaVersion: 2,
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          config: alternateConfigDescriptor,
          layers: [alternateLayerDescriptor],
        }),
      );
      const alternateManifestDescriptor = descriptor(
        alternateManifest,
        'application/vnd.oci.image.manifest.v1+json',
        {
          platform: invalidNonRunnable === 'missing-architecture' && role === 'envoy'
            ? { os: 'linux' }
            : { os: 'linux', architecture: 'arm64' },
        },
      );
      blobs.set(
        `blobs/sha256/${alternateManifestDescriptor.digest.slice(7)}`,
        alternateManifest,
      );
      indexManifests.push(alternateManifestDescriptor);

      if (role === 'gotenberg') {
        const attestationConfig = Buffer.from('{}');
        const attestationConfigDescriptor = descriptor(
          attestationConfig,
          'application/vnd.oci.image.config.v1+json',
        );
        blobs.set(
          `blobs/sha256/${attestationConfigDescriptor.digest.slice(7)}`,
          attestationConfig,
        );
        const attestationLayer = Buffer.from(
          JSON.stringify({ predicateType: 'https://slsa.dev/provenance/v0.2' }),
        );
        const attestationLayerDescriptor = descriptor(
          attestationLayer,
          'application/vnd.in-toto+json',
          {
            annotations: {
              'in-toto.io/predicate-type': 'https://slsa.dev/provenance/v0.2',
            },
          },
        );
        blobs.set(
          `blobs/sha256/${attestationLayerDescriptor.digest.slice(7)}`,
          attestationLayer,
        );
        const attestationManifest = Buffer.from(
          JSON.stringify({
            schemaVersion: 2,
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            config: attestationConfigDescriptor,
            layers: [attestationLayerDescriptor],
          }),
        );
        const attestationDescriptor = descriptor(
          attestationManifest,
          'application/vnd.oci.image.manifest.v1+json',
          {
            platform: { os: 'unknown', architecture: 'unknown' },
            annotations: invalidNonRunnable === 'bad-attestation'
              ? { 'vnd.docker.reference.type': 'not-an-attestation' }
              : {
                'vnd.docker.reference.digest': manifestDescriptor.digest,
                'vnd.docker.reference.type': 'attestation-manifest',
              },
          },
        );
        blobs.set(
          `blobs/sha256/${attestationDescriptor.digest.slice(7)}`,
          attestationManifest,
        );
        indexManifests.push(attestationDescriptor);
      }
    }
    if (duplicateLinux && role === 'server') {
      indexManifests.push({ ...manifestDescriptor });
    }

    const imageIndex = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: indexManifests,
      }),
    );
    const imageIndexDescriptor = descriptor(
      imageIndex,
      'application/vnd.oci.image.index.v1+json',
      {
        annotations: {
          'io.containerd.image.name': shorthandRoot ? reference : `docker.io/${reference}`,
        },
      },
    );
    blobs.set(`blobs/sha256/${imageIndexDescriptor.digest.slice(7)}`, imageIndex);
    images.push({
      role,
      reference,
      indexDigest: imageIndexDescriptor.digest,
      manifestDigest: manifestDescriptor.digest,
      configDigest: configDescriptor.digest,
      indexManifestCount: indexManifests.length,
      rootDescriptor: imageIndexDescriptor,
    });
    if (role === 'envoy') corruptPath = `blobs/sha256/${configDescriptor.digest.slice(7)}`;
  }

  const rootDescriptors = images.map(({ rootDescriptor }) => rootDescriptor);
  if (extraRoot) {
    rootDescriptors.push({
      ...rootDescriptors[0],
      annotations: { 'io.containerd.image.name': 'docker.io/undeclared/example:latest' },
    });
  }
  if (duplicateRoot) rootDescriptors[rootDescriptors.length - 1] = rootDescriptors[0];
  if (shuffledRoot) {
    [rootDescriptors[0], rootDescriptors[1]] = [rootDescriptors[1], rootDescriptors[0]];
  }
  const index = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: rootDescriptors,
    }),
  );
  if (corruptBlob) blobs.set(corruptPath, Buffer.from('corrupted-after-digest'));

  const entries = [
    ['blobs/', Buffer.alloc(0), '5'],
    ['blobs/sha256/', Buffer.alloc(0), '5'],
    ['oci-layout', Buffer.from('{"imageLayoutVersion":"1.0.0"}')],
    ['index.json', index],
    ...[...blobs.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ];
  return { bundle: makeTar(entries), images };
}

async function createFixture(t, bundleOptions = {}, evidenceMutator, sourceOptions = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'easyfire-release-manifest-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(temp, { recursive: true, force: true });
  });
  const sourceRoot = path.join(temp, 'source');
  await mkdir(sourceRoot, { recursive: true });
  const { bundle, images } = buildOciBundle(bundleOptions);
  const artifactBytes = new Map();
  for (const artifact of RELEASE_ARTIFACTS) {
    const bytes = artifact === 'docker-compose.prod.yml'
      ? Buffer.from(
        `services:\n  envoy:\n    image: ${ROLE_SPECS[0][1]}@${images[0].indexDigest}\n  gotenberg:\n    image: ${ROLE_SPECS[3][1]}@${images[3].indexDigest}\n`,
      )
      : Buffer.from(`fixture:${artifact}\n`);
    artifactBytes.set(artifact, bytes);
    const target = path.join(sourceRoot, ...artifact.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (process.platform !== 'win32') await chmod(target, artifactMode(artifact));
  }
  const sourceArchive = path.join(temp, 'source.tar.gz');
  const sourceArchiveBytes = buildGitSourceArchive(artifactBytes, sourceOptions);
  await writeFile(sourceArchive, sourceArchiveBytes);
  const imageBundle = path.join(temp, 'images.tar');
  await writeFile(imageBundle, bundle);
  const bundleDigest = `sha256:${sha256(bundle)}`;
  const evidence = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    releaseCommit: commit,
    imageBundleSha256: bundleDigest,
    docker: {
      serverVersion: '29.6.2',
      operatingSystem: 'linux',
      architecture: 'amd64',
    },
    images: images.map((image, index) => {
      const external = ROLE_SPECS[index][2];
      const repoDigest = `${repositoryOf(image.reference)}@${image.indexDigest}`;
      return {
        reference: image.reference,
        Id: image.indexDigest,
        RepoTags: [image.reference],
        RepoDigests: [repoDigest],
        externalDigestAuthority: external ? repoDigest : null,
      };
    }),
  };
  if (evidenceMutator) evidenceMutator(evidence, images);
  const engineEvidence = path.join(temp, 'target-engine-evidence.json');
  await writeFile(engineEvidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return {
    temp,
    sourceRoot,
    sourceArchive,
    imageBundle,
    engineEvidence,
    output: path.join(temp, 'release-manifest.json'),
    bundle,
    images,
    sourceArchiveBytes,
  };
}

async function runProducer(fixture) {
  return execFileAsync(process.execPath, [
    producerPath,
    '--release-commit',
    commit,
    '--source-root',
    fixture.sourceRoot,
    '--source-archive',
    fixture.sourceArchive,
    '--image-bundle',
    fixture.imageBundle,
    '--engine-evidence',
    fixture.engineEvidence,
    '--output',
    fixture.output,
  ]);
}

test('accepts an actual Git archive with a commit header and exact --add-file output', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'easyfire-real-git-archive-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(temp, { recursive: true, force: true });
  });
  const trackedPath = 'scripts/production/example.mjs';
  const addedPath = 'packages/guardian/dist/guardian.js';
  for (const [relativePath, bytes] of [
    [trackedPath, Buffer.from('export const exact = true;\n')],
    [addedPath, Buffer.from('export const bundled = true;\n')],
  ]) {
    const target = path.join(temp, ...relativePath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (process.platform !== 'win32') await chmod(target, 0o644);
  }
  await execFileAsync('git', ['init', '--quiet'], { cwd: temp });
  await execFileAsync('git', ['config', 'user.name', 'Release Test'], { cwd: temp });
  await execFileAsync('git', ['config', 'user.email', 'release@example.invalid'], { cwd: temp });
  await execFileAsync('git', ['add', trackedPath], { cwd: temp });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'release'], { cwd: temp });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: temp });
  const releaseCommit = stdout.trim();
  const sourceArchivePath = path.join(temp, 'source.tar.gz');
  await execFileAsync('git', [
    '-c',
    'tar.umask=0022',
    'archive',
    '--format=tar.gz',
    `--output=${sourceArchivePath}`,
    '--prefix=packages/guardian/dist/',
    `--add-file=${addedPath}`,
    '--prefix=',
    releaseCommit,
  ], { cwd: temp });
  const extracted = path.join(temp, 'extracted');
  await mkdir(extracted);
  await execFileAsync('tar', ['-xzf', sourceArchivePath, '-C', extracted]);
  const proof = await verifySourceArchiveProvenance({
    sourceArchivePath,
    sourceRoot: extracted,
    releaseCommit,
    artifactSpecs: [[trackedPath, '0644'], [addedPath, '0644']],
  });
  assert.equal(proof.artifacts.length, 2);
  assert.equal(proof.sourceArchive.sha256, sha256(await readFile(sourceArchivePath)));
});

test('stream-verifies the OCI archive and emits a deterministic manifest-v2 authority', async (t) => {
  const fixture = await createFixture(t);
  const result = await runProducer(fixture);
  assert.match(result.stdout, /^release-manifest-v2 sha256:[a-f0-9]{64}\n$/);
  assert.equal(result.stderr, '');

  const raw = await readFile(fixture.output, 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifestVersion, 2);
  assert.equal(manifest.releaseCommit, commit);
  assert.equal(manifest.sourceArchive.sha256, sha256(fixture.sourceArchiveBytes));
  assert.deepEqual(manifest.images.map(({ role }) => role), ROLE_SPECS.map(([role]) => role));
  assert.equal(manifest.images[0].reference, `${ROLE_SPECS[0][1]}@${fixture.images[0].indexDigest}`);
  assert.equal(manifest.images[1].reference, ROLE_SPECS[1][1]);
  assert.equal(manifest.images[1].engineImageId, fixture.images[1].indexDigest);
  assert.equal(manifest.imageBundle.sha256, sha256(fixture.bundle));
  assert.equal(manifest.imageBundle.bytes, fixture.bundle.length);
  assert.equal(manifest.imageBundle.inventory.length, 7);
  assert.ok(fixture.images[0].indexManifestCount > 1);
  assert.ok(fixture.images[3].indexManifestCount > 1);
  assert.equal(
    manifest.imageBundle.inventory[0].linuxAmd64ManifestDigest,
    fixture.images[0].manifestDigest,
  );
  assert.equal(manifest.imageBundle.inventory[0].configDigest, fixture.images[0].configDigest);
  assert.equal(manifest.artifacts.length, RELEASE_ARTIFACTS.length);
  assert.deepEqual(manifest.artifacts.map(({ path: artifact }) => artifact), RELEASE_ARTIFACTS);
  assert.ok(manifest.artifacts.every(({ sha256: hash }) => /^[a-f0-9]{64}$/.test(hash)));
  assert.equal(manifest.artifacts.find(({ path: artifact }) => artifact.endsWith('.service')).mode, '0644');
  assert.equal(manifest.artifacts.find(({ path: artifact }) => artifact.endsWith('.sh')).mode, '0755');
  assert.equal(raw, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal((await stat(fixture.output)).isFile(), true);
  assert.doesNotMatch(raw, /synthetic-layer|fixture:/);
});

test('rejects a Git archive whose embedded commit differs from releaseCommit', async (t) => {
  const fixture = await createFixture(t, {}, undefined, { embeddedCommit: 'b'.repeat(40) });
  await assert.rejects(runProducer(fixture), /embedded Git commit.*releaseCommit|commit.*mismatch/i);
});

test('rejects sourceRoot bytes or archive modes that differ from the exact archive entries', async (t) => {
  const bytesDrift = await createFixture(t);
  await writeFile(
    path.join(bytesDrift.sourceRoot, 'scripts/production/linux-private-route-activate.mjs'),
    'mutable checkout drift',
  );
  await assert.rejects(runProducer(bytesDrift), /linux-private-route-activate.*archive/i);

  const modeDrift = await createFixture(t, {}, undefined, { modeMismatch: true });
  await assert.rejects(runProducer(modeDrift), /direct-vm-cutover-authority.*mode/i);

  const missing = await createFixture(t, {}, undefined, { omitArtifact: true });
  await assert.rejects(runProducer(missing), /missing bound release artifact.*private-route/i);
});

test('rejects traversal, duplicates, links, and case-ambiguous archive paths', async (t) => {
  for (const [option, expected] of [
    ['pathTraversal', /unsafe|canonical|traversal/i],
    ['duplicateArtifact', /duplicate/i],
    ['linkEntry', /link|unsupported.*type/i],
    ['caseAlias', /case|ambiguous/i],
  ]) {
    const fixture = await createFixture(t, {}, undefined, { [option]: true });
    await assert.rejects(runProducer(fixture), expected);
  }
});

test('rejects gzip and decompressed tar truncation', async (t) => {
  const gzipTruncated = await createFixture(t);
  await writeFile(
    gzipTruncated.sourceArchive,
    gzipTruncated.sourceArchiveBytes.subarray(0, gzipTruncated.sourceArchiveBytes.length - 8),
  );
  await assert.rejects(runProducer(gzipTruncated), /gzip|unexpected end|truncated/i);

  const tarTruncated = await createFixture(t, {}, undefined, { tarTruncated: true });
  await assert.rejects(runProducer(tarTruncated), /tar.*truncated|end marker/i);
});

test('rejects an undeclared extra root image/tag', async (t) => {
  const fixture = await createFixture(t, { extraRoot: true });
  await assert.rejects(runProducer(fixture), /exactly seven|undeclared/i);
});

test('rejects a shorthand aggregate root name that Docker cannot resolve canonically', async (t) => {
  const fixture = await createFixture(t, { shorthandRoot: true });
  await assert.rejects(runProducer(fixture), /canonical|docker\.io|root.*image.*name/i);
});

test('rejects a duplicate root image/tag even when the root count stays seven', async (t) => {
  const fixture = await createFixture(t, { duplicateRoot: true });
  await assert.rejects(runProducer(fixture), /duplicate image\/tag/i);
});

test('rejects shuffled root image descriptors instead of silently reordering them', async (t) => {
  const fixture = await createFixture(t, { shuffledRoot: true });
  await assert.rejects(runProducer(fixture), /fixed role order/i);
});

test('rejects a tar blob whose sha256 filename does not match its bytes', async (t) => {
  const fixture = await createFixture(t, { corruptBlob: true });
  await assert.rejects(runProducer(fixture), /blob.*digest|digest.*blob/i);
});

test('rejects wrong target-engine evidence instead of deriving an engine ID', async (t) => {
  const fixture = await createFixture(t, {}, (evidence) => {
    evidence.images[0].externalDigestAuthority =
      `envoyproxy/envoy@sha256:${'f'.repeat(64)}`;
  });
  await assert.rejects(runProducer(fixture), /external.*digest.*authority/i);
});

test('requires the full target Docker Id and has no config-digest fallback', async (t) => {
  const fixture = await createFixture(t, {}, (evidence) => {
    evidence.images[1].Id = 'sha256:not-an-engine-id';
  });
  await assert.rejects(runProducer(fixture), /Docker Id.*sha256 digest/i);
});

test('requires each target Docker Id to equal the observed root OCI index digest', async (t) => {
  const fixture = await createFixture(t, {}, (evidence) => {
    evidence.images[1].Id = `sha256:${'f'.repeat(64)}`;
  });
  await assert.rejects(runProducer(fixture), /Docker Id.*root OCI index digest/i);
});

test('accepts either exact or absent external RepoDigests while preserving source authority', async (t) => {
  const fixture = await createFixture(t, {}, (evidence) => {
    evidence.images[0].RepoDigests = [];
    evidence.images[3].RepoDigests = [];
  });
  await runProducer(fixture);
  const manifest = JSON.parse(await readFile(fixture.output, 'utf8'));
  assert.equal(manifest.images[0].engineImageId, fixture.images[0].indexDigest);
  assert.equal(manifest.images[3].engineImageId, fixture.images[3].indexDigest);
});

test('accepts only an exact derived custom RepoDigest without claiming external authority', async (t) => {
  const accepted = await createFixture(t);
  await runProducer(accepted);

  const absent = await createFixture(t, {}, (evidence) => {
    evidence.images[1].RepoDigests = [];
  });
  await runProducer(absent);

  const rejected = await createFixture(t, {}, (evidence) => {
    evidence.images[1].RepoDigests = [
      `easyfire-bookkeeping/webapp@sha256:${'f'.repeat(64)}`,
    ];
  });
  await assert.rejects(runProducer(rejected), /webapp.*RepoDigests|repo digest/i);
});

test('rejects shuffled target-engine evidence instead of reordering it silently', async (t) => {
  const fixture = await createFixture(t, {}, (evidence) => {
    [evidence.images[0], evidence.images[1]] = [evidence.images[1], evidence.images[0]];
  });
  await assert.rejects(runProducer(fixture), /fixed role order/i);
});

test('rejects an image index without an exact linux/amd64 platform', async (t) => {
  const fixture = await createFixture(t, { missingLinux: true });
  await assert.rejects(runProducer(fixture), /linux\/amd64/i);
});

test('rejects duplicate runnable linux/amd64 descriptors in one image index', async (t) => {
  const fixture = await createFixture(t, { duplicateLinux: true });
  await assert.rejects(runProducer(fixture), /exactly one runnable linux\/amd64/i);
});

test('rejects malformed non-runnable platform and attestation descriptors', async (t) => {
  for (const [invalidNonRunnable, expected] of [
    ['missing-architecture', /non-runnable.*platform|platform.*architecture/i],
    ['bad-attestation', /attestation/i],
  ]) {
    const fixture = await createFixture(t, { invalidNonRunnable });
    await assert.rejects(runProducer(fixture), expected);
  }
});

test('publishes exclusively and never overwrites an existing manifest', async (t) => {
  const fixture = await createFixture(t);
  const sentinel = 'preserve-existing-authority\n';
  await writeFile(fixture.output, sentinel, 'utf8');
  await assert.rejects(runProducer(fixture), /already exists|EEXIST/i);
  assert.equal(await readFile(fixture.output, 'utf8'), sentinel);
});
