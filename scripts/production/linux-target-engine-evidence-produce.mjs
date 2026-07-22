#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import { isCanonicalMainModule } from './linux-cli-entrypoint.mjs';
import { DEFAULT_IMAGE_SPECS } from './linux-oci-bundle-produce.mjs';
import { inspectOciImageBundle } from './linux-release-manifest-v2.mjs';

const COMMIT = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PINNED_DOCKER_VERSION = '29.6.2';
const DOCKER_BINARY = '/usr/bin/docker';
export const DOCKER_SOCKET = 'unix:///var/run/docker.sock';
const MAX_DOCKER_OUTPUT_BYTES = 64 * 1024;
const DOCKER_TIMEOUT_MS = 30_000;
const ROLES = Object.freeze([
  'envoy',
  'webapp',
  'server',
  'gotenberg',
  'mysql',
  'redis',
  'migration',
]);
const INSPECT_FORMAT = '{{json .Id}}\n{{json .RepoTags}}\n{{json .RepoDigests}}';

function refuse(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    refuse(`${label} must be a lowercase sha256 digest.`);
  }
  return value;
}

function exactArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) refuse(`${label} does not match the exact target-engine inventory.`);
}

function sameFileState(left, right) {
  return left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev;
}

function validateSpecs(specs) {
  if (!Array.isArray(specs) || specs.length !== ROLES.length) {
    refuse('Image specification must contain exactly seven roles in release order.');
  }
  return specs.map((candidate, index) => {
    const role = ROLES[index];
    if (
      !isObject(candidate) ||
      candidate.role !== role ||
      typeof candidate.sourceReference !== 'string' ||
      candidate.sourceReference.length < 3 ||
      candidate.sourceReference.length > 512 ||
      /[\s\0@]/.test(candidate.sourceReference) ||
      candidate.external !== ['envoy', 'gotenberg'].includes(role)
    ) refuse(`${role} image specification is invalid.`);
    if (candidate.external) {
      requireDigest(candidate.expectedOciIndexDigest, `${role} expected OCI index digest`);
    }
    return candidate;
  });
}

async function assertInputBundle(filePath, requireRootOwner) {
  if (!path.isAbsolute(filePath) || path.basename(filePath) !== 'images.tar') {
    refuse('Image bundle must be an absolute path named images.tar.');
  }
  const state = await lstat(filePath);
  if (state.isSymbolicLink() || !state.isFile()) {
    refuse('Image bundle must be a regular non-symlink file.');
  }
  if (path.resolve(await realpath(filePath)) !== path.resolve(filePath)) {
    refuse('Image bundle path must be canonical.');
  }
  if (process.platform !== 'win32') {
    if (requireRootOwner && state.uid !== 0) refuse('Image bundle must be owned by root.');
    if ((state.mode & 0o777) !== 0o600) refuse('Image bundle mode must be 0600.');
  }
  return state;
}

async function assertOutputTarget(output) {
  if (!path.isAbsolute(output) || path.basename(output) !== 'target-engine-evidence.json') {
    refuse('Output must be an absolute path named target-engine-evidence.json.');
  }
  if (await lstat(output).catch(() => null)) {
    refuse('target-engine-evidence.json already exists; overwrite is forbidden.');
  }
  const parent = path.dirname(output);
  const state = await lstat(parent);
  if (
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    path.resolve(await realpath(parent)) !== path.resolve(parent)
  ) refuse('Output parent must be a canonical non-symlink directory.');
}

function repositoryOf(reference) {
  const lastSlash = reference.lastIndexOf('/');
  const tagSeparator = reference.lastIndexOf(':');
  if (tagSeparator <= lastSlash) refuse(`Image reference for ${reference} has no exact tag.`);
  return reference.slice(0, tagSeparator);
}

function runDockerCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER_BINARY, args, {
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        PATH: '/usr/bin:/bin',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let refused = false;
    const failClosed = () => {
      refused = true;
      child.kill('SIGKILL');
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_DOCKER_OUTPUT_BYTES) failClosed();
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_DOCKER_OUTPUT_BYTES) failClosed();
    });
    const timer = setTimeout(failClosed, DOCKER_TIMEOUT_MS);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Docker invocation failed.'));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (refused || code !== 0 || signal) reject(new Error('Docker invocation failed.'));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

async function queryDocker(runDocker, args, label) {
  let result;
  try {
    result = await runDocker(['--host', DOCKER_SOCKET, ...args]);
  } catch {
    refuse(`Target Docker query failed for ${label}.`);
  }
  if (typeof result !== 'string' || Buffer.byteLength(result) > MAX_DOCKER_OUTPUT_BYTES) {
    refuse(`Target Docker query returned invalid output for ${label}.`);
  }
  return result;
}

function parseEngineIdentity(output) {
  if (output !== `${PINNED_DOCKER_VERSION}|linux|amd64\n`) {
    refuse('Target Docker Engine must be exactly Docker 29.6.2 on linux/amd64.');
  }
  return {
    serverVersion: PINNED_DOCKER_VERSION,
    operatingSystem: 'linux',
    architecture: 'amd64',
  };
}

function parseInspectOutput(output, spec, inventory) {
  const lines = output.endsWith('\n') ? output.slice(0, -1).split('\n') : [];
  if (lines.length !== 3) refuse(`${spec.role} Docker inspection output is malformed.`);
  let Id;
  let RepoTags;
  let RepoDigests;
  try {
    Id = JSON.parse(lines[0]);
    RepoTags = JSON.parse(lines[1]);
    RepoDigests = JSON.parse(lines[2]);
  } catch {
    refuse(`${spec.role} Docker inspection output is malformed.`);
  }
  requireDigest(Id, `${spec.role} Docker Id`);
  if (Id !== inventory.ociIndexDigest) {
    refuse(`${spec.role} Docker Id does not match the OCI root index digest.`);
  }
  exactArray(RepoTags, [spec.sourceReference], `${spec.role} RepoTags`);
  const derivedRepoDigest = `${repositoryOf(spec.sourceReference)}@${inventory.ociIndexDigest}`;
  const exactDerived = Array.isArray(RepoDigests) &&
    (RepoDigests.length === 0 ||
      (RepoDigests.length === 1 && RepoDigests[0] === derivedRepoDigest));
  if (!exactDerived) {
    refuse(`${spec.role} RepoDigests contains a digest outside the exact OCI image authority.`);
  }
  return {
    reference: spec.sourceReference,
    Id,
    RepoTags,
    RepoDigests,
    externalDigestAuthority: spec.external ? derivedRepoDigest : null,
  };
}

async function publishExclusive(output, bytes) {
  const temporary = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, output);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        refuse('target-engine-evidence.json already exists; overwrite is forbidden.');
      }
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export async function produceTargetEngineEvidence({
  releaseCommit,
  imageBundle,
  output,
  specs = DEFAULT_IMAGE_SPECS(releaseCommit),
  runDocker = runDockerCommand,
  requireRootOwner = true,
}) {
  if (!COMMIT.test(releaseCommit)) {
    refuse('releaseCommit must be 40 lowercase hexadecimal characters.');
  }
  if (typeof runDocker !== 'function') refuse('runDocker must be a function.');
  if (typeof requireRootOwner !== 'boolean') refuse('requireRootOwner must be boolean.');
  const validatedSpecs = validateSpecs(specs);
  const before = await assertInputBundle(imageBundle, requireRootOwner);
  await assertOutputTarget(output);
  const bundle = await inspectOciImageBundle(imageBundle, validatedSpecs);
  const docker = parseEngineIdentity(await queryDocker(
    runDocker,
    ['version', '--format', '{{.Server.Version}}|{{.Server.Os}}|{{.Server.Arch}}'],
    'engine identity',
  ));
  const images = [];
  for (let index = 0; index < validatedSpecs.length; index += 1) {
    const spec = validatedSpecs[index];
    const outputText = await queryDocker(
      runDocker,
      ['image', 'inspect', '--format', INSPECT_FORMAT, bundle.inventory[index].ociIndexDigest],
      `${spec.role} image`,
    );
    images.push(parseInspectOutput(outputText, spec, bundle.inventory[index]));
  }
  const after = await lstat(imageBundle);
  if (!sameFileState(before, after)) refuse('Image bundle changed during target-engine inspection.');
  const readback = await inspectOciImageBundle(imageBundle, validatedSpecs);
  if (readback.sha256 !== bundle.sha256 || readback.bytes !== bundle.bytes) {
    refuse('Image bundle changed during target-engine inspection.');
  }
  const evidence = {
    schemaVersion: 1,
    project: 'easyfire-bookkeeping',
    releaseCommit,
    imageBundleSha256: `sha256:${bundle.sha256}`,
    docker,
    images,
  };
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await publishExclusive(output, bytes);
  return {
    evidence,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

export function parseTargetEngineEvidenceArguments(argv) {
  const flags = ['--release-commit', '--image-bundle', '--output'];
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
  if (Object.keys(parsed).length !== flags.length) {
    refuse(`Required arguments: ${flags.join(', ')}.`);
  }
  return {
    releaseCommit: parsed['--release-commit'],
    imageBundle: parsed['--image-bundle'],
    output: parsed['--output'],
  };
}

function ensureLinuxRoot() {
  if (process.platform !== 'linux') refuse('Target-engine evidence producer runs only on Linux.');
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    refuse('Target-engine evidence producer must run as root.');
  }
}

async function main() {
  ensureLinuxRoot();
  const result = await produceTargetEngineEvidence(
    parseTargetEngineEvidenceArguments(process.argv.slice(2)),
  );
  process.stdout.write(`target-engine-evidence sha256:${result.sha256}\n`);
}

if (await isCanonicalMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`target-engine-evidence refused: ${error.message}\n`);
    process.exitCode = 1;
  });
}
