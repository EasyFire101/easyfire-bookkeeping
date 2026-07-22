import { RuntimeManifest, RuntimeService } from './contracts.js';

export const RELEASE_IMAGE_ROLES = [
  'envoy',
  'webapp',
  'server',
  'gotenberg',
  'mysql',
  'redis',
  'migration',
] as const;

export type ReleaseImageRole = (typeof RELEASE_IMAGE_ROLES)[number];
export type RuntimeRole = Exclude<ReleaseImageRole, 'migration'>;
export type ImageAuthorityKind =
  | 'engine-image-id'
  | 'engine-image-id-and-repo-digest';

export interface RuntimeRoleSpec {
  role: RuntimeRole;
  containerName: string;
  composeService: string;
  imageAuthority: ImageAuthorityKind;
  recoveryMode: RuntimeService['recoveryMode'];
}

export const RUNTIME_ROLE_SPECS: readonly RuntimeRoleSpec[] = [
  {
    role: 'envoy',
    containerName: 'easyfire-bookkeeping-envoy',
    composeService: 'envoy',
    imageAuthority: 'engine-image-id-and-repo-digest',
    recoveryMode: 'start-if-stopped',
  },
  {
    role: 'webapp',
    containerName: 'easyfire-bookkeeping-webapp',
    composeService: 'webapp',
    imageAuthority: 'engine-image-id',
    recoveryMode: 'start-if-stopped',
  },
  {
    role: 'server',
    containerName: 'easyfire-bookkeeping-server',
    composeService: 'server',
    imageAuthority: 'engine-image-id',
    recoveryMode: 'start-if-stopped',
  },
  {
    role: 'gotenberg',
    containerName: 'easyfire-bookkeeping-gotenberg',
    composeService: 'gotenberg',
    imageAuthority: 'engine-image-id-and-repo-digest',
    recoveryMode: 'start-if-stopped',
  },
  {
    role: 'mysql',
    containerName: 'easyfire-bookkeeping-mysql',
    composeService: 'mysql',
    imageAuthority: 'engine-image-id',
    recoveryMode: 'observe-only',
  },
  {
    role: 'redis',
    containerName: 'easyfire-bookkeeping-redis',
    composeService: 'redis',
    imageAuthority: 'engine-image-id',
    recoveryMode: 'observe-only',
  },
] as const;

export interface ReleaseImageEntry {
  role: ReleaseImageRole;
  reference: string;
  ociIndexDigest: string;
  linuxAmd64ManifestDigest: string;
  engineImageId: string;
}

export const RELEASE_ARTIFACT_SPECS = [
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
] as const;

export interface ReleaseFileBinding {
  fileName: string;
  sha256: string;
  bytes: number;
}

export interface ReleaseLayerBinding {
  digest: string;
  bytes: number;
  mediaType: string;
}

export interface ReleaseImageInventoryEntry {
  role: ReleaseImageRole;
  sourceReference: string;
  ociIndexDigest: string;
  ociIndexBytes: number;
  linuxAmd64ManifestDigest: string;
  linuxAmd64ManifestBytes: number;
  configDigest: string;
  configBytes: number;
  layers: ReleaseLayerBinding[];
}

export interface ReleaseArtifactBinding {
  path: string;
  sha256: string;
  bytes: number;
  mode: string;
}

export interface ReleaseManifest {
  manifestVersion: 2;
  releaseCommit: string;
  images: ReleaseImageEntry[];
  sourceArchive: ReleaseFileBinding;
  imageBundle: ReleaseFileBinding & { inventory: ReleaseImageInventoryEntry[] };
  targetEngineEvidence: ReleaseFileBinding;
  artifactModeAuthority: 'required-install-mode';
  artifacts: ReleaseArtifactBinding[];
}

export interface VerifiedRuntimeIdentity {
  role: RuntimeRole;
  containerName: string;
  containerId: string;
  configuredImageReference: string;
  actualImageId: string;
  authorityKind: ImageAuthorityKind;
  ociIndexDigest: string;
  linuxAmd64ManifestDigest: string;
  engineImageId: string;
  verifiedRepoDigest: string | null;
  state: 'running' | 'stopped' | 'created';
}

export interface RuntimeIdentityEvidenceService {
  role: RuntimeRole;
  containerName: string;
  containerId: string;
  configuredImageReference: string;
  actualImageId: string;
  authorityKind: ImageAuthorityKind;
  ociIndexDigest: string;
  linuxAmd64ManifestDigest: string;
  engineImageId: string;
  verifiedRepoDigest: string | null;
}

export interface RuntimeIdentityEvidence {
  schemaVersion: 1;
  project: 'easyfire-bookkeeping';
  generatedAt: string;
  releaseCommit: string;
  sourceReleasePath: string;
  services: RuntimeIdentityEvidenceService[];
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

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase sha256 digest.`);
  }
}

function assertFileSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash.`);
  }
}

function assertBytes(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function customReference(role: ReleaseImageRole, releaseCommit: string): string {
  const repositoryRole = role === 'mysql' ? 'mariadb' : role;
  return `easyfire-bookkeeping/${repositoryRole}:git-${releaseCommit}`;
}

export function getRequiredRepoDigest(reference: string, role: string): string {
  const separator = reference.lastIndexOf('@');
  if (separator <= 0) {
    throw new Error(`${role} reference must contain an exact sha256 repo digest.`);
  }
  const taggedName = reference.slice(0, separator);
  const digest = reference.slice(separator + 1);
  assertSha256(digest, `${role} reference digest`);
  const lastSlash = taggedName.lastIndexOf('/');
  const tagSeparator = taggedName.lastIndexOf(':');
  if (tagSeparator <= lastSlash || tagSeparator === taggedName.length - 1) {
    throw new Error(`${role} reference must contain an exact immutable tag and repo digest.`);
  }
  return `${taggedName.slice(0, tagSeparator)}@${digest}`;
}

function parseFileBinding(
  value: unknown,
  expectedFileName: string,
  label: string,
): ReleaseFileBinding {
  assertObject(value, label);
  assertExactKeys(value, ['fileName', 'sha256', 'bytes'], label);
  if (value.fileName !== expectedFileName) {
    throw new Error(`${label} fileName must be ${expectedFileName}.`);
  }
  assertFileSha256(value.sha256, `${label}.sha256`);
  assertBytes(value.bytes, `${label}.bytes`);
  return {
    fileName: expectedFileName,
    sha256: value.sha256,
    bytes: value.bytes,
  };
}

function parseImageInventory(
  value: unknown,
  images: ReleaseImageEntry[],
): ReleaseImageInventoryEntry[] {
  if (!Array.isArray(value) || value.length !== RELEASE_IMAGE_ROLES.length) {
    throw new Error('Image bundle inventory must contain exactly seven entries.');
  }
  return value.map((candidate, index): ReleaseImageInventoryEntry => {
    const role = RELEASE_IMAGE_ROLES[index];
    const image = images[index];
    assertObject(candidate, `${role} image bundle inventory`);
    assertExactKeys(
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
    const sourceReference = image.reference.split('@')[0];
    if (
      candidate.role !== role ||
      candidate.sourceReference !== sourceReference ||
      candidate.ociIndexDigest !== image.ociIndexDigest ||
      candidate.linuxAmd64ManifestDigest !== image.linuxAmd64ManifestDigest
    ) {
      throw new Error(`${role} image bundle inventory does not match the release manifest.`);
    }
    assertBytes(candidate.ociIndexBytes, `${role} inventory ociIndexBytes`);
    assertBytes(
      candidate.linuxAmd64ManifestBytes,
      `${role} inventory linuxAmd64ManifestBytes`,
    );
    assertSha256(candidate.configDigest, `${role} inventory configDigest`);
    assertBytes(candidate.configBytes, `${role} inventory configBytes`);
    if (!Array.isArray(candidate.layers)) {
      throw new Error(`${role} inventory layers must be an array.`);
    }
    const layers = candidate.layers.map((layer, layerIndex): ReleaseLayerBinding => {
      assertObject(layer, `${role} layer ${layerIndex}`);
      assertExactKeys(layer, ['digest', 'bytes', 'mediaType'], `${role} layer ${layerIndex}`);
      assertSha256(layer.digest, `${role} layer ${layerIndex}.digest`);
      assertBytes(layer.bytes, `${role} layer ${layerIndex}.bytes`);
      if (
        typeof layer.mediaType !== 'string' ||
        !layer.mediaType.startsWith('application/vnd.oci.image.layer.v1')
      ) {
        throw new Error(`${role} layer ${layerIndex} mediaType is invalid.`);
      }
      return { digest: layer.digest, bytes: layer.bytes, mediaType: layer.mediaType };
    });
    return {
      role,
      sourceReference,
      ociIndexDigest: image.ociIndexDigest,
      ociIndexBytes: candidate.ociIndexBytes,
      linuxAmd64ManifestDigest: image.linuxAmd64ManifestDigest,
      linuxAmd64ManifestBytes: candidate.linuxAmd64ManifestBytes,
      configDigest: candidate.configDigest,
      configBytes: candidate.configBytes,
      layers,
    };
  });
}

function parseArtifacts(value: unknown): ReleaseArtifactBinding[] {
  if (!Array.isArray(value) || value.length !== RELEASE_ARTIFACT_SPECS.length) {
    throw new Error(
      `Release manifest must contain exactly ${RELEASE_ARTIFACT_SPECS.length} release artifacts.`,
    );
  }
  return value.map((candidate, index): ReleaseArtifactBinding => {
    const [artifactPath, mode] = RELEASE_ARTIFACT_SPECS[index];
    assertObject(candidate, `Release artifact ${index}`);
    assertExactKeys(candidate, ['path', 'sha256', 'bytes', 'mode'], `Release artifact ${index}`);
    if (candidate.path !== artifactPath || candidate.mode !== mode) {
      throw new Error(`Release artifact set or mode is invalid at ${artifactPath}.`);
    }
    assertFileSha256(candidate.sha256, `${artifactPath} sha256`);
    assertBytes(candidate.bytes, `${artifactPath} bytes`);
    return {
      path: artifactPath,
      sha256: candidate.sha256,
      bytes: candidate.bytes,
      mode,
    };
  });
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  assertObject(value, 'Release manifest');
  assertExactKeys(
    value,
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
  if (value.manifestVersion !== 2) {
    throw new Error('Release manifest manifestVersion must be 2.');
  }
  if (
    typeof value.releaseCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.releaseCommit)
  ) {
    throw new Error('Release manifest releaseCommit must be 40 lowercase hexadecimal characters.');
  }
  if (!Array.isArray(value.images) || value.images.length !== RELEASE_IMAGE_ROLES.length) {
    throw new Error('Release manifest must contain exactly seven image entries.');
  }

  const roles = new Set<ReleaseImageRole>();
  const images = value.images.map((candidate, index): ReleaseImageEntry => {
    assertObject(candidate, `images[${index}]`);
    if ('imageId' in candidate) {
      throw new Error(`images[${index}] uses forbidden legacy imageId authority; engineImageId is required.`);
    }
    assertExactKeys(
      candidate,
      ['role', 'reference', 'ociIndexDigest', 'linuxAmd64ManifestDigest', 'engineImageId'],
      `images[${index}]`,
    );
    if (
      typeof candidate.role !== 'string' ||
      !RELEASE_IMAGE_ROLES.includes(candidate.role as ReleaseImageRole)
    ) {
      throw new Error(`Unexpected image role at images[${index}].`);
    }
    const role = candidate.role as ReleaseImageRole;
    if (roles.has(role)) {
      throw new Error(`Duplicate release image role: ${role}.`);
    }
    if (role !== RELEASE_IMAGE_ROLES[index]) {
      throw new Error(`Release image order must bind role ${RELEASE_IMAGE_ROLES[index]}.`);
    }
    roles.add(role);
    if (
      typeof candidate.reference !== 'string' ||
      candidate.reference.length < 3 ||
      candidate.reference.length > 512 ||
      /[\s\0]/.test(candidate.reference)
    ) {
      throw new Error(`${role} release image reference is invalid.`);
    }
    assertSha256(candidate.ociIndexDigest, `${role} release-manifest ociIndexDigest`);
    assertSha256(
      candidate.linuxAmd64ManifestDigest,
      `${role} release-manifest linuxAmd64ManifestDigest`,
    );
    assertSha256(candidate.engineImageId, `${role} release-manifest engineImageId`);

    const spec = RUNTIME_ROLE_SPECS.find((entry) => entry.role === role);
    if (spec?.imageAuthority === 'engine-image-id-and-repo-digest') {
      const requiredRepoDigest = getRequiredRepoDigest(candidate.reference, role);
      const taggedReference = candidate.reference.slice(0, candidate.reference.lastIndexOf('@'));
      const expectedTaggedReference = role === 'envoy'
        ? 'envoyproxy/envoy:v1.30.11'
        : 'gotenberg/gotenberg:7.10.2';
      if (requiredRepoDigest.slice(requiredRepoDigest.lastIndexOf('@') + 1) !== candidate.ociIndexDigest) {
        throw new Error(`${role} reference repo digest must equal ociIndexDigest.`);
      }
      if (taggedReference !== expectedTaggedReference) {
        throw new Error(`${role} reference must use pinned tag ${expectedTaggedReference}.`);
      }
    }
    else {
      const expectedReference = customReference(role, value.releaseCommit as string);
      if (candidate.reference !== expectedReference) {
        throw new Error(
          `${role} reference must be the final release tag ${expectedReference}.`,
        );
      }
    }
    return {
      role,
      reference: candidate.reference,
      ociIndexDigest: candidate.ociIndexDigest,
      linuxAmd64ManifestDigest: candidate.linuxAmd64ManifestDigest,
      engineImageId: candidate.engineImageId,
    };
  });

  for (const role of RELEASE_IMAGE_ROLES) {
    if (!roles.has(role)) {
      throw new Error(`Release manifest is missing image role ${role}.`);
    }
  }
  if (value.artifactModeAuthority !== 'required-install-mode') {
    throw new Error('Release artifact mode authority is invalid.');
  }
  const sourceArchive = parseFileBinding(
    value.sourceArchive,
    'source.tar.gz',
    'Source archive binding',
  );
  assertObject(value.imageBundle, 'Image bundle binding');
  assertExactKeys(
    value.imageBundle,
    ['fileName', 'sha256', 'bytes', 'inventory'],
    'Image bundle binding',
  );
  if (value.imageBundle.fileName !== 'images.tar') {
    throw new Error('Image bundle binding fileName must be images.tar.');
  }
  assertFileSha256(value.imageBundle.sha256, 'Image bundle binding.sha256');
  assertBytes(value.imageBundle.bytes, 'Image bundle binding.bytes');
  const imageBundle = {
    fileName: 'images.tar',
    sha256: value.imageBundle.sha256,
    bytes: value.imageBundle.bytes,
    inventory: parseImageInventory(value.imageBundle.inventory, images),
  };
  const targetEngineEvidence = parseFileBinding(
    value.targetEngineEvidence,
    'target-engine-evidence.json',
    'Target-engine evidence binding',
  );
  const artifacts = parseArtifacts(value.artifacts);
  return {
    manifestVersion: 2,
    releaseCommit: value.releaseCommit,
    images,
    sourceArchive,
    imageBundle,
    targetEngineEvidence,
    artifactModeAuthority: 'required-install-mode',
    artifacts,
  };
}

export function makeRuntimeManifest(
  generatedAt: string,
  identities: VerifiedRuntimeIdentity[],
): RuntimeManifest {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt,
    services: identities.map((identity) => {
      const spec = RUNTIME_ROLE_SPECS.find((entry) => entry.role === identity.role);
      if (!spec) {
        throw new Error(`Unexpected verified runtime role ${identity.role}.`);
      }
      return {
        role: identity.role,
        containerName: identity.containerName,
        containerId: identity.containerId,
        imageId: identity.actualImageId,
        requireDockerHealth: true,
        recoveryMode: spec.recoveryMode,
      };
    }),
  };
}

export function makeRuntimeIdentityEvidence(
  generatedAt: string,
  releaseCommit: string,
  sourceReleasePath: string,
  identities: VerifiedRuntimeIdentity[],
): RuntimeIdentityEvidence {
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt,
    releaseCommit,
    sourceReleasePath,
    services: identities.map(({ state: _state, ...identity }) => identity),
  };
}

export function parseRuntimeIdentityEvidence(value: unknown): RuntimeIdentityEvidence {
  assertObject(value, 'Runtime identity evidence');
  if (value.schemaVersion !== 1 || value.project !== 'easyfire-bookkeeping') {
    throw new Error('Runtime identity evidence identity is invalid.');
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error('Runtime identity evidence generatedAt is invalid.');
  }
  if (typeof value.releaseCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.releaseCommit)) {
    throw new Error('Runtime identity evidence releaseCommit is invalid.');
  }
  if (typeof value.sourceReleasePath !== 'string' || value.sourceReleasePath.length === 0) {
    throw new Error('Runtime identity evidence sourceReleasePath is invalid.');
  }
  if (!Array.isArray(value.services) || value.services.length !== RUNTIME_ROLE_SPECS.length) {
    throw new Error('Runtime identity evidence must contain exactly six services.');
  }

  const roles = new Set<RuntimeRole>();
  const services = value.services.map((candidate, index): RuntimeIdentityEvidenceService => {
    assertObject(candidate, `evidence.services[${index}]`);
    const spec = RUNTIME_ROLE_SPECS.find((entry) => entry.role === candidate.role);
    if (!spec || roles.has(spec.role)) {
      throw new Error(`Runtime identity evidence role at index ${index} is invalid or duplicate.`);
    }
    roles.add(spec.role);
    if (candidate.containerName !== spec.containerName) {
      throw new Error(`Runtime identity evidence ${spec.role} container name is invalid.`);
    }
    if (typeof candidate.containerId !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.containerId)) {
      throw new Error(`Runtime identity evidence ${spec.role} container ID is invalid.`);
    }
    if (typeof candidate.configuredImageReference !== 'string') {
      throw new Error(`Runtime identity evidence ${spec.role} image reference is invalid.`);
    }
    assertSha256(candidate.actualImageId, `${spec.role} evidence actualImageId`);
    assertSha256(candidate.ociIndexDigest, `${spec.role} evidence ociIndexDigest`);
    assertSha256(
      candidate.linuxAmd64ManifestDigest,
      `${spec.role} evidence linuxAmd64ManifestDigest`,
    );
    assertSha256(candidate.engineImageId, `${spec.role} evidence engineImageId`);
    if (candidate.authorityKind !== spec.imageAuthority) {
      throw new Error(`Runtime identity evidence ${spec.role} authority kind is invalid.`);
    }
    if (
      candidate.verifiedRepoDigest !== null &&
      (typeof candidate.verifiedRepoDigest !== 'string' ||
        !/@sha256:[a-f0-9]{64}$/.test(candidate.verifiedRepoDigest))
    ) {
      throw new Error(`Runtime identity evidence ${spec.role} repo digest is invalid.`);
    }
    if (
      (spec.imageAuthority === 'engine-image-id-and-repo-digest') !==
      (typeof candidate.verifiedRepoDigest === 'string')
    ) {
      throw new Error(`Runtime identity evidence ${spec.role} repo digest authority is incomplete.`);
    }
    return {
      role: spec.role,
      containerName: spec.containerName,
      containerId: candidate.containerId,
      configuredImageReference: candidate.configuredImageReference,
      actualImageId: candidate.actualImageId,
      authorityKind: spec.imageAuthority,
      ociIndexDigest: candidate.ociIndexDigest,
      linuxAmd64ManifestDigest: candidate.linuxAmd64ManifestDigest,
      engineImageId: candidate.engineImageId,
      verifiedRepoDigest: candidate.verifiedRepoDigest,
    };
  });
  return {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    generatedAt: value.generatedAt,
    releaseCommit: value.releaseCommit,
    sourceReleasePath: value.sourceReleasePath,
    services,
  };
}
