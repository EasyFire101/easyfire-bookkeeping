import { pathToFileURL } from 'node:url';

import { DockerTransport } from './adapters/docker-engine.js';
import { parseRuntimeManifest } from './config.js';
import { RuntimeManifest } from './contracts.js';
import {
  makeRuntimeIdentityEvidence,
  makeRuntimeManifest,
  parseRuntimeIdentityEvidence,
  RUNTIME_ROLE_SPECS,
  RuntimeIdentityEvidence,
  VerifiedRuntimeIdentity,
} from './runtime-manifest-contracts.js';
import { RuntimeIdentityDockerClient } from './runtime-manifest-docker.js';
import {
  assertOutputsAbsent,
  readJsonDocument,
  readReleaseContext,
  writeRuntimeDocumentsExclusive,
} from './runtime-manifest-io.js';
import { verifyRuntimeReleaseAuthority } from './runtime-release-authority.js';

export { writeRuntimeDocumentsExclusive };

export interface RuntimeManifestGeneratorOptions {
  releaseManifestPath: string;
  currentReleasePath: string;
  runtimeManifestPath: string;
  evidencePath: string;
  dockerSocketPath: string;
  sourceArchivePath: string;
  imageBundlePath: string;
  engineEvidencePath: string;
  guardianInstallRoot: string;
  systemdRoot: string;
  requireRootOwner: boolean;
}

export interface RuntimeManifestGeneratorDependencies {
  transport: DockerTransport;
  now: () => Date;
}

export interface GeneratedRuntimeDocuments {
  runtimeManifest: RuntimeManifest;
  evidence: RuntimeIdentityEvidence;
}

export const DEFAULT_GENERATOR_OPTIONS: RuntimeManifestGeneratorOptions = {
  releaseManifestPath: '/opt/easyfire-bookkeeping/current/release-manifest.json',
  currentReleasePath: '/opt/easyfire-bookkeeping/current',
  runtimeManifestPath: '/etc/easyfire-bookkeeping/runtime-manifest.json',
  evidencePath: '/etc/easyfire-bookkeeping/runtime-identity-evidence.json',
  dockerSocketPath: '/var/run/docker.sock',
  sourceArchivePath: '/var/lib/easyfire-bookkeeping-staging/source.tar.gz',
  imageBundlePath: '/var/lib/easyfire-bookkeeping-staging/images.tar',
  engineEvidencePath: '/var/lib/easyfire-bookkeeping-staging/target-engine-evidence.json',
  guardianInstallRoot: '/opt/easyfire-bookkeeping/guardian',
  systemdRoot: '/etc/systemd/system',
  requireRootOwner: true,
};

function assertOptions(options: RuntimeManifestGeneratorOptions): void {
  const { requireRootOwner, ...pathOptions } = options;
  if (typeof requireRootOwner !== 'boolean') {
    throw new Error('requireRootOwner must be boolean.');
  }
  for (const [name, value] of Object.entries(pathOptions)) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
      throw new Error(`${name} must be a non-empty path.`);
    }
  }
}

function getNow(dependencies?: Partial<RuntimeManifestGeneratorDependencies>): Date {
  const now = (dependencies?.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new Error('Generator clock returned an invalid timestamp.');
  }
  return now;
}

function makeDocker(
  options: RuntimeManifestGeneratorOptions,
  dependencies?: Partial<RuntimeManifestGeneratorDependencies>,
): RuntimeIdentityDockerClient {
  return new RuntimeIdentityDockerClient(
    options.dockerSocketPath,
    dependencies?.transport,
  );
}

export async function generateRuntimeManifest(
  options: RuntimeManifestGeneratorOptions,
  dependencies?: Partial<RuntimeManifestGeneratorDependencies>,
): Promise<GeneratedRuntimeDocuments> {
  assertOptions(options);
  await assertOutputsAbsent(options.runtimeManifestPath, options.evidencePath);
  const release = await readReleaseContext(
    options.currentReleasePath,
    options.releaseManifestPath,
  );
  await verifyRuntimeReleaseAuthority(release.manifest, release.sourceReleasePath, options);
  const identities = await makeDocker(options, dependencies).verify(
    release.manifest,
    'generate',
  );
  const generatedAt = getNow(dependencies).toISOString();
  const runtimeManifest = parseRuntimeManifest(
    makeRuntimeManifest(generatedAt, identities),
  );
  const evidence = makeRuntimeIdentityEvidence(
    generatedAt,
    release.manifest.releaseCommit,
    release.sourceReleasePath,
    identities,
  );
  await writeRuntimeDocumentsExclusive(
    options.runtimeManifestPath,
    runtimeManifest,
    options.evidencePath,
    evidence,
  );
  return { runtimeManifest, evidence };
}

function identityByRole(
  identities: VerifiedRuntimeIdentity[],
  role: string,
): VerifiedRuntimeIdentity {
  const identity = identities.find((candidate) => candidate.role === role);
  if (!identity) {
    throw new Error(`Verified Docker identities are missing role ${role}.`);
  }
  return identity;
}

export async function verifyExistingRuntimeManifest(
  options: RuntimeManifestGeneratorOptions,
  dependencies?: Partial<RuntimeManifestGeneratorDependencies>,
): Promise<RuntimeIdentityEvidence> {
  assertOptions(options);
  const release = await readReleaseContext(
    options.currentReleasePath,
    options.releaseManifestPath,
  );
  await verifyRuntimeReleaseAuthority(release.manifest, release.sourceReleasePath, options);
  const runtimeManifest = parseRuntimeManifest(
    await readJsonDocument(options.runtimeManifestPath, 'Runtime manifest'),
  );
  const evidence = parseRuntimeIdentityEvidence(
    await readJsonDocument(options.evidencePath, 'Runtime identity evidence'),
  );
  if (runtimeManifest.generatedAt !== evidence.generatedAt) {
    throw new Error('Runtime manifest and identity evidence timestamps do not match.');
  }
  if (
    evidence.releaseCommit !== release.manifest.releaseCommit ||
    evidence.sourceReleasePath !== release.sourceReleasePath
  ) {
    throw new Error('Runtime identity evidence does not match the current source release.');
  }

  const identities = await makeDocker(options, dependencies).verify(
    release.manifest,
    'verify-existing',
  );
  for (const spec of RUNTIME_ROLE_SPECS) {
    const observed = identityByRole(identities, spec.role);
    const runtime = runtimeManifest.services.find((entry) => entry.role === spec.role);
    const recorded = evidence.services.find((entry) => entry.role === spec.role);
    if (!runtime || !recorded) {
      throw new Error(`Existing runtime documents are missing role ${spec.role}.`);
    }
    if (
      runtime.containerName !== observed.containerName ||
      runtime.containerId !== observed.containerId ||
      runtime.imageId !== observed.actualImageId
    ) {
      throw new Error(`${spec.role} runtime manifest identity has drifted from Docker.`);
    }
    if (
      recorded.containerName !== observed.containerName ||
      recorded.containerId !== observed.containerId ||
      recorded.configuredImageReference !== observed.configuredImageReference ||
      recorded.actualImageId !== observed.actualImageId ||
      recorded.authorityKind !== observed.authorityKind ||
      recorded.ociIndexDigest !== observed.ociIndexDigest ||
      recorded.linuxAmd64ManifestDigest !== observed.linuxAmd64ManifestDigest ||
      recorded.engineImageId !== observed.engineImageId ||
      recorded.verifiedRepoDigest !== observed.verifiedRepoDigest
    ) {
      throw new Error(`${spec.role} runtime identity evidence has drifted from Docker.`);
    }
  }
  return evidence;
}

interface ParsedCli {
  mode: 'generate' | 'verify-existing';
  options: RuntimeManifestGeneratorOptions;
  help: boolean;
}

type PathOption = Exclude<keyof RuntimeManifestGeneratorOptions, 'requireRootOwner'>;

const valueFlags: Record<string, PathOption> = {
  '--release-manifest': 'releaseManifestPath',
  '--current-release': 'currentReleasePath',
  '--output': 'runtimeManifestPath',
  '--evidence': 'evidencePath',
  '--docker-socket': 'dockerSocketPath',
  '--source-archive': 'sourceArchivePath',
  '--image-bundle': 'imageBundlePath',
  '--engine-evidence': 'engineEvidencePath',
  '--guardian-root': 'guardianInstallRoot',
  '--systemd-root': 'systemdRoot',
};

export function parseRuntimeManifestGeneratorArguments(args: string[]): ParsedCli {
  const options = { ...DEFAULT_GENERATOR_OPTIONS };
  let mode: ParsedCli['mode'] = 'generate';
  let help = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help') {
      help = true;
      continue;
    }
    if (flag === '--verify-existing') {
      if (seen.has(flag)) {
        throw new Error('Duplicate argument: --verify-existing.');
      }
      seen.add(flag);
      mode = 'verify-existing';
      continue;
    }
    const option = valueFlags[flag];
    if (!option) {
      throw new Error(`Unknown argument: ${flag}.`);
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate argument: ${flag}.`);
    }
    seen.add(flag);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Argument ${flag} requires a path value.`);
    }
    options[option] = value;
    index += 1;
  }
  assertOptions(options);
  return { mode, options, help };
}

const usage = `Usage: runtime-manifest-generator.js [--verify-existing] [options]\n\n` +
  `  --release-manifest PATH  Release manifest (default: ${DEFAULT_GENERATOR_OPTIONS.releaseManifestPath})\n` +
  `  --current-release PATH   Current release symlink (default: ${DEFAULT_GENERATOR_OPTIONS.currentReleasePath})\n` +
  `  --output PATH            Guardian runtime manifest (default: ${DEFAULT_GENERATOR_OPTIONS.runtimeManifestPath})\n` +
  `  --evidence PATH          Sanitized identity evidence (default: ${DEFAULT_GENERATOR_OPTIONS.evidencePath})\n` +
  `  --docker-socket PATH     Docker Unix socket (default: ${DEFAULT_GENERATOR_OPTIONS.dockerSocketPath})\n` +
  `  --source-archive PATH    Bound source archive (default: ${DEFAULT_GENERATOR_OPTIONS.sourceArchivePath})\n` +
  `  --image-bundle PATH      Bound OCI image bundle (default: ${DEFAULT_GENERATOR_OPTIONS.imageBundlePath})\n` +
  `  --engine-evidence PATH   Target Docker evidence (default: ${DEFAULT_GENERATOR_OPTIONS.engineEvidencePath})\n` +
  `  --guardian-root PATH     Installed Guardian root (default: ${DEFAULT_GENERATOR_OPTIONS.guardianInstallRoot})\n` +
  `  --systemd-root PATH      Installed systemd unit root (default: ${DEFAULT_GENERATOR_OPTIONS.systemdRoot})\n` +
  `  --verify-existing        Read-only pre-start identity verification; write nothing\n`;

async function runCli(): Promise<void> {
  const parsed = parseRuntimeManifestGeneratorArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage);
    return;
  }
  if (parsed.mode === 'verify-existing') {
    const evidence = await verifyExistingRuntimeManifest(parsed.options);
    process.stdout.write(
      `${JSON.stringify({ verified: true, releaseCommit: evidence.releaseCommit })}\n`,
    );
    return;
  }
  const result = await generateRuntimeManifest(parsed.options);
  process.stdout.write(
    `${JSON.stringify({ generated: true, generatedAt: result.runtimeManifest.generatedAt })}\n`,
  );
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown runtime manifest failure.';
    process.stderr.write(`Runtime manifest generator refused: ${message}\n`);
    process.exitCode = 1;
  });
}
