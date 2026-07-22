import { randomUUID } from 'node:crypto';
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

import {
  parseReleaseManifest,
  ReleaseManifest,
  RuntimeIdentityEvidence,
} from './runtime-manifest-contracts.js';
import { RuntimeManifest } from './contracts.js';

const MAX_JSON_BYTES = 1_000_000;

export interface ReleaseContext {
  manifest: ReleaseManifest;
  sourceReleasePath: string;
}

async function readJsonBounded(filePath: string, label: string): Promise<unknown> {
  const file = await stat(filePath);
  if (!file.isFile() || file.size <= 0 || file.size > MAX_JSON_BYTES) {
    throw new Error(`${label} must be a non-empty regular file no larger than 1 MB.`);
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  }
  catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function readJsonDocument(filePath: string, label: string): Promise<unknown> {
  return readJsonBounded(filePath, label);
}

export async function readReleaseContext(
  currentReleasePath: string,
  releaseManifestPath: string,
): Promise<ReleaseContext> {
  const currentLink = await lstat(currentReleasePath);
  if (!currentLink.isSymbolicLink()) {
    throw new Error('Current release path must be a symbolic link.');
  }
  const sourceReleasePath = await realpath(currentReleasePath);
  const manifest = parseReleaseManifest(
    await readJsonBounded(releaseManifestPath, 'Release manifest'),
  );
  const expectedReleasePath = path.resolve(
    path.dirname(currentReleasePath),
    'releases',
    manifest.releaseCommit,
  );
  if (path.resolve(sourceReleasePath) !== expectedReleasePath) {
    throw new Error(
      'Current release symlink does not resolve to releases/<releaseCommit>.',
    );
  }
  const manifestRealPath = await realpath(releaseManifestPath);
  if (path.dirname(manifestRealPath) !== path.resolve(sourceReleasePath)) {
    throw new Error('Release manifest is not owned by the resolved current release.');
  }
  return { manifest, sourceReleasePath: path.resolve(sourceReleasePath) };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function assertOutputsAbsent(
  runtimeManifestPath: string,
  evidencePath: string,
): Promise<void> {
  if (path.resolve(runtimeManifestPath) === path.resolve(evidencePath)) {
    throw new Error('Runtime manifest and evidence output paths must be different.');
  }
  for (const outputPath of [runtimeManifestPath, evidencePath]) {
    if (await pathExists(outputPath)) {
      throw new Error(`Refusing to replace output because it already exists: ${outputPath}`);
    }
  }
}

interface PreparedFile {
  temporaryPath: string;
  targetPath: string;
}

async function prepareFile(targetPath: string, value: unknown): Promise<PreparedFile> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.chmod(0o600);
      await handle.sync();
    }
    finally {
      await handle.close();
    }
  }
  catch (error) {
    try {
      await unlink(temporaryPath);
    }
    catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to prepare and remove temporary output ${temporaryPath}.`,
        );
      }
    }
    throw error;
  }
  return { temporaryPath, targetPath };
}

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  }
  finally {
    await handle.close();
  }
}

async function publishPrepared(prepared: PreparedFile): Promise<void> {
  try {
    await link(prepared.temporaryPath, prepared.targetPath);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `Refusing to replace output because it already exists: ${prepared.targetPath}`,
      );
    }
    throw error;
  }
  await unlink(prepared.temporaryPath);
  await syncDirectory(path.dirname(prepared.targetPath));
}

async function removeTemporary(prepared: PreparedFile | null): Promise<void> {
  if (!prepared || !(await pathExists(prepared.temporaryPath))) {
    return;
  }
  await unlink(prepared.temporaryPath);
}

export async function writeRuntimeDocumentsExclusive(
  runtimeManifestPath: string,
  runtimeManifest: RuntimeManifest,
  evidencePath: string,
  evidence: RuntimeIdentityEvidence,
): Promise<void> {
  await assertOutputsAbsent(runtimeManifestPath, evidencePath);
  let runtimePrepared: PreparedFile | null = null;
  let evidencePrepared: PreparedFile | null = null;
  try {
    evidencePrepared = await prepareFile(evidencePath, evidence);
    runtimePrepared = await prepareFile(runtimeManifestPath, runtimeManifest);
    await assertOutputsAbsent(runtimeManifestPath, evidencePath);

    // Publish evidence first and the Guardian activation manifest last. A crash
    // can therefore never expose a runtime manifest without its evidence.
    await publishPrepared(evidencePrepared);
    evidencePrepared = null;
    await publishPrepared(runtimePrepared);
    runtimePrepared = null;
  }
  finally {
    await removeTemporary(runtimePrepared);
    await removeTemporary(evidencePrepared);
  }
}
