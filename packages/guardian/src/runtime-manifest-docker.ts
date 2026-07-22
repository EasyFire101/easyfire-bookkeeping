import {
  DockerResponse,
  DockerTransport,
  requestDockerSocket,
} from './adapters/docker-engine.js';
import {
  getRequiredRepoDigest,
  ReleaseManifest,
  RUNTIME_ROLE_SPECS,
  VerifiedRuntimeIdentity,
} from './runtime-manifest-contracts.js';

type VerificationMode = 'generate' | 'verify-existing';

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase sha256 digest.`);
  }
}

function parseDockerJson(response: DockerResponse, label: string): Record<string, unknown> {
  if (response.statusCode !== 200) {
    throw new Error(`${label} returned Docker HTTP ${response.statusCode}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(response.body) as unknown;
  }
  catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  assertObject(value, label);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} must be a string array.`);
  }
  return value;
}

function verifyContainerState(
  state: Record<string, unknown>,
  role: string,
  mode: VerificationMode,
): VerifiedRuntimeIdentity['state'] {
  const health = state.Health;
  const healthStatus = health !== null && typeof health === 'object' && !Array.isArray(health)
    ? (health as Record<string, unknown>).Status
    : undefined;
  if (state.Running === true && state.Status === 'running' && healthStatus === 'healthy') {
    return 'running';
  }
  if (
    mode === 'verify-existing' &&
    state.Running === false &&
    (state.Status === 'exited' || state.Status === 'created')
  ) {
    return state.Status === 'created' ? 'created' : 'stopped';
  }
  const allowance = mode === 'verify-existing'
    ? 'running and healthy, or stopped/created'
    : 'running and healthy';
  throw new Error(`${role} container must be ${allowance}.`);
}

export class RuntimeIdentityDockerClient {
  private readonly transport: DockerTransport;

  constructor(socketPath: string, transport?: DockerTransport) {
    this.transport = transport ?? ((method, requestPath) =>
      requestDockerSocket(socketPath, method, requestPath));
  }

  private async get(requestPath: string): Promise<DockerResponse> {
    return this.transport('GET', requestPath);
  }

  async verify(
    releaseManifest: ReleaseManifest,
    mode: VerificationMode,
  ): Promise<VerifiedRuntimeIdentity[]> {
    const ping = await this.get('/_ping');
    if (ping.statusCode !== 200 || ping.body.trim() !== 'OK') {
      throw new Error('Docker Engine ping failed; runtime identity verification refused.');
    }

    const releaseEntries = new Map(
      releaseManifest.images.map((entry) => [entry.role, entry]),
    );
    const identities: VerifiedRuntimeIdentity[] = [];
    for (const spec of RUNTIME_ROLE_SPECS) {
      const releaseEntry = releaseEntries.get(spec.role);
      if (!releaseEntry) {
        throw new Error(`Release manifest is missing runtime role ${spec.role}.`);
      }
      const container = parseDockerJson(
        await this.get(`/containers/${encodeURIComponent(spec.containerName)}/json`),
        `${spec.role} container inspect`,
      );
      if (container.Name !== `/${spec.containerName}`) {
        throw new Error(`${spec.role} container inspect returned the wrong exact name.`);
      }
      if (typeof container.Id !== 'string' || !/^[a-f0-9]{64}$/.test(container.Id)) {
        throw new Error(`${spec.role} container inspect returned an invalid Id.`);
      }
      assertSha256(container.Image, `${spec.role} container .Image`);
      assertObject(container.Config, `${spec.role} container Config`);
      if (container.Config.Image !== releaseEntry.reference) {
        throw new Error(
          `${spec.role} container .Config.Image does not match its exact release reference.`,
        );
      }
      assertObject(container.Config.Labels, `${spec.role} container Config.Labels`);
      if (container.Config.Labels['com.docker.compose.service'] !== spec.composeService) {
        throw new Error(`${spec.role} container Compose service role does not match.`);
      }
      if (container.Config.Labels['com.docker.compose.project'] !== 'easyfire-bookkeeping-prod') {
        throw new Error(`${spec.role} container Compose project does not match.`);
      }
      assertObject(container.State, `${spec.role} container State`);
      const state = verifyContainerState(container.State, spec.role, mode);

      const image = parseDockerJson(
        await this.get(`/images/${encodeURIComponent(releaseEntry.reference)}/json`),
        `${spec.role} local image inspect`,
      );
      assertSha256(image.Id, `${spec.role} local image Id`);
      if (image.Id !== container.Image) {
        throw new Error(
          `${spec.role} container .Image does not match the exact local image object.`,
        );
      }
      if (image.Id !== releaseEntry.engineImageId) {
        throw new Error(
          `${spec.role} local image does not match the release-manifest engineImageId.`,
        );
      }

      let verifiedRepoDigest: string | null = null;
      if (spec.imageAuthority === 'engine-image-id') {
        const repoTags = stringArray(image.RepoTags ?? [], `${spec.role} local image RepoTags`);
        if (!repoTags.includes(releaseEntry.reference)) {
          throw new Error(`${spec.role} local image does not own the exact final release tag.`);
        }
      }
      else {
        verifiedRepoDigest = getRequiredRepoDigest(releaseEntry.reference, spec.role);
        const repoDigests = stringArray(
          image.RepoDigests ?? [],
          `${spec.role} local image RepoDigests`,
        );
        if (!repoDigests.includes(verifiedRepoDigest)) {
          throw new Error(`${spec.role} local image does not prove the required repo digest.`);
        }
      }

      identities.push({
        role: spec.role,
        containerName: spec.containerName,
        containerId: container.Id,
        configuredImageReference: releaseEntry.reference,
        actualImageId: container.Image,
        authorityKind: spec.imageAuthority,
        ociIndexDigest: releaseEntry.ociIndexDigest,
        linuxAmd64ManifestDigest: releaseEntry.linuxAmd64ManifestDigest,
        engineImageId: releaseEntry.engineImageId,
        verifiedRepoDigest,
        state,
      });
    }
    return identities;
  }
}
