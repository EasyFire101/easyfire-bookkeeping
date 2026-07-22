import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  RELEASE_ARTIFACT_SPECS,
  RELEASE_IMAGE_ROLES,
  ReleaseArtifactBinding,
  ReleaseFileBinding,
  ReleaseManifest,
} from './runtime-manifest-contracts.js';

const MAX_JSON_BYTES = 1024 * 1024;
const ENGINE_SHA256 = /^sha256:[a-f0-9]{64}$/;

export interface RuntimeReleaseAuthorityPaths {
  sourceArchivePath: string;
  imageBundlePath: string;
  engineEvidencePath: string;
  guardianInstallRoot: string;
  systemdRoot: string;
  requireRootOwner: boolean;
}

interface FileProof {
  sha256: string;
  bytes: number;
}

interface EngineEvidenceImage {
  reference: string;
  Id: string;
  RepoTags: string[];
  RepoDigests: string[];
  externalDigestAuthority: string | null;
}

interface EngineEvidence {
  schemaVersion: 1;
  project: 'easyfire-bookkeeping';
  releaseCommit: string;
  imageBundleSha256: string;
  docker: {
    serverVersion: '29.6.2';
    operatingSystem: 'linux';
    architecture: 'amd64';
  };
  images: EngineEvidenceImage[];
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
}

function sameState(left: Awaited<ReturnType<typeof stat>>, right: Awaited<ReturnType<typeof stat>>): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

async function verifyFile(
  filePath: string,
  binding: Pick<ReleaseFileBinding, 'sha256' | 'bytes'>,
  mode: string,
  label: string,
  requireRootOwner: boolean,
): Promise<FileProof> {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if (path.resolve(await realpath(filePath)) !== path.resolve(filePath)) {
    throw new Error(`${label} must use its canonical path.`);
  }
  if (process.platform !== 'win32') {
    if (requireRootOwner && before.uid !== 0) {
      throw new Error(`${label} must be owned by root.`);
    }
    if ((before.mode & 0o777) !== Number.parseInt(mode, 8)) {
      throw new Error(`${label} mode does not match ${mode}.`);
    }
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  const after = await stat(filePath);
  if (!sameState(before, after)) {
    throw new Error(`${label} changed during verification.`);
  }
  const sha256 = hash.digest('hex');
  if (sha256 !== binding.sha256) {
    throw new Error(`${label} hash does not match the release manifest.`);
  }
  if (bytes !== binding.bytes) {
    throw new Error(`${label} byte size does not match the release manifest.`);
  }
  return { sha256, bytes };
}

function sourceReference(reference: string): string {
  return reference.split('@')[0];
}

function repositoryOf(reference: string): string {
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  if (colon <= slash) {
    throw new Error(`Image reference ${reference} has no exact tag.`);
  }
  return reference.slice(0, colon);
}

function exactArray(value: unknown, expected: string[], label: string): void {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${label} does not match the exact image authority.`);
  }
}

function parseEngineEvidence(value: unknown, manifest: ReleaseManifest): EngineEvidence {
  assertObject(value, 'Target-engine evidence');
  assertExactKeys(
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
    throw new Error('Target-engine evidence does not bind the exact release image bundle.');
  }
  assertObject(value.docker, 'Target-engine Docker identity');
  assertExactKeys(
    value.docker,
    ['serverVersion', 'operatingSystem', 'architecture'],
    'Target-engine Docker identity',
  );
  if (
    value.docker.serverVersion !== '29.6.2' ||
    value.docker.operatingSystem !== 'linux' ||
    value.docker.architecture !== 'amd64'
  ) {
    throw new Error('Target-engine Docker identity is not the pinned linux/amd64 engine.');
  }
  if (!Array.isArray(value.images) || value.images.length !== RELEASE_IMAGE_ROLES.length) {
    throw new Error('Target-engine evidence must contain exactly seven images.');
  }
  const images = value.images.map((candidate, index): EngineEvidenceImage => {
    const image = manifest.images[index];
    const role = RELEASE_IMAGE_ROLES[index];
    assertObject(candidate, `${role} target-engine evidence`);
    assertExactKeys(
      candidate,
      ['reference', 'Id', 'RepoTags', 'RepoDigests', 'externalDigestAuthority'],
      `${role} target-engine evidence`,
    );
    const taggedReference = sourceReference(image.reference);
    if (
      candidate.reference !== taggedReference ||
      candidate.Id !== image.engineImageId ||
      typeof candidate.Id !== 'string' ||
      !ENGINE_SHA256.test(candidate.Id)
    ) {
      throw new Error(`${role} target Docker Id does not match release engineImageId.`);
    }
    exactArray(candidate.RepoTags, [taggedReference], `${role} RepoTags`);
    if (image.reference.includes('@')) {
      const repoDigest = `${repositoryOf(taggedReference)}@${image.ociIndexDigest}`;
      exactArray(candidate.RepoDigests, [repoDigest], `${role} RepoDigests`);
      if (candidate.externalDigestAuthority !== repoDigest) {
        throw new Error(`${role} external digest authority is invalid.`);
      }
    }
    else {
      exactArray(candidate.RepoDigests, [], `${role} RepoDigests`);
      if (candidate.externalDigestAuthority !== null) {
        throw new Error(`${role} must not claim external digest authority.`);
      }
    }
    return {
      reference: candidate.reference,
      Id: candidate.Id,
      RepoTags: candidate.RepoTags as string[],
      RepoDigests: candidate.RepoDigests as string[],
      externalDigestAuthority: candidate.externalDigestAuthority as string | null,
    };
  });
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    releaseCommit: manifest.releaseCommit,
    imageBundleSha256: `sha256:${manifest.imageBundle.sha256}`,
    docker: {
      serverVersion: '29.6.2',
      operatingSystem: 'linux',
      architecture: 'amd64',
    },
    images,
  };
}

function installedCopies(
  paths: RuntimeReleaseAuthorityPaths,
): Array<{ source: string; target: string; label: string }> {
  return [
    {
      source: 'packages/guardian/dist/guardian.js',
      target: path.join(paths.guardianInstallRoot, 'guardian.js'),
      label: 'Installed Guardian guardian.js',
    },
    {
      source: 'packages/guardian/dist/runtime-manifest-generator.js',
      target: path.join(paths.guardianInstallRoot, 'runtime-manifest-generator.js'),
      label: 'Installed Guardian runtime-manifest-generator.js',
    },
    ...[
      'easyfire-bookkeeping-stack.service',
      'easyfire-bookkeeping-guardian.service',
      'easyfire-bookkeeping-guardian.timer',
    ].map((name) => ({
      source: `deploy/linux/${name}`,
      target: path.join(paths.systemdRoot, name),
      label: `Installed systemd ${name}`,
    })),
  ];
}

function assertReleaseRoot(releasePath: string, requireRootOwner: boolean): Promise<void> {
  return lstat(releasePath).then((metadata) => {
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Release path must be a regular non-symlink directory.');
    }
    if (process.platform !== 'win32' && requireRootOwner && metadata.uid !== 0) {
      throw new Error('Release path must be owned by root.');
    }
  });
}

export async function verifyRuntimeReleaseAuthority(
  manifest: ReleaseManifest,
  releasePath: string,
  paths: RuntimeReleaseAuthorityPaths,
): Promise<void> {
  await assertReleaseRoot(releasePath, paths.requireRootOwner);
  const artifacts = new Map<string, ReleaseArtifactBinding>(
    manifest.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  for (const artifact of manifest.artifacts) {
    const target = path.resolve(releasePath, ...artifact.path.split('/'));
    if (!target.startsWith(`${path.resolve(releasePath)}${path.sep}`)) {
      throw new Error(`Release artifact path escapes the release: ${artifact.path}.`);
    }
    await verifyFile(
      target,
      artifact,
      artifact.mode,
      `Release artifact ${artifact.path}`,
      paths.requireRootOwner,
    );
  }
  for (const copy of installedCopies(paths)) {
    const artifact = artifacts.get(copy.source);
    if (!artifact) {
      throw new Error(`Release manifest is missing installed-copy source ${copy.source}.`);
    }
    await verifyFile(
      copy.target,
      artifact,
      artifact.mode,
      copy.label,
      paths.requireRootOwner,
    );
  }
  for (const [filePath, binding, label] of [
    [paths.sourceArchivePath, manifest.sourceArchive, 'Source archive'],
    [paths.imageBundlePath, manifest.imageBundle, 'Image bundle'],
    [paths.engineEvidencePath, manifest.targetEngineEvidence, 'Target-engine evidence'],
  ] as const) {
    if (path.basename(filePath) !== binding.fileName) {
      throw new Error(`${label} path does not match manifest fileName ${binding.fileName}.`);
    }
  }
  await verifyFile(
    paths.sourceArchivePath,
    manifest.sourceArchive,
    '0600',
    'Source archive',
    paths.requireRootOwner,
  );
  await verifyFile(
    paths.imageBundlePath,
    manifest.imageBundle,
    '0600',
    'Image bundle',
    paths.requireRootOwner,
  );
  await verifyFile(
    paths.engineEvidencePath,
    manifest.targetEngineEvidence,
    '0600',
    'Target-engine evidence',
    paths.requireRootOwner,
  );
  if (manifest.targetEngineEvidence.bytes > MAX_JSON_BYTES) {
    throw new Error('Target-engine evidence exceeds 1 MiB.');
  }
  const evidenceBytes = await readFile(paths.engineEvidencePath);
  if (
    evidenceBytes.length !== manifest.targetEngineEvidence.bytes ||
    createHash('sha256').update(evidenceBytes).digest('hex') !==
      manifest.targetEngineEvidence.sha256
  ) {
    throw new Error('Target-engine evidence changed after verification.');
  }
  let evidence: unknown;
  try {
    evidence = JSON.parse(evidenceBytes.toString('utf8')) as unknown;
  }
  catch {
    throw new Error('Target-engine evidence is not valid JSON.');
  }
  parseEngineEvidence(evidence, manifest);
}
