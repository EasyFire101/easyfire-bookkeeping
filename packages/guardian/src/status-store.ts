import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  GuardianState,
  GuardianStatus,
  INITIAL_STATE,
} from './contracts.js';

export async function readGuardianState(statePath: string): Promise<GuardianState> {
  try {
    await access(statePath, constants.R_OK);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(INITIAL_STATE);
    }
    throw error;
  }
  const parsed = JSON.parse(await readFile(statePath, 'utf8')) as GuardianState;
  if (
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.recoveryAttempts) ||
    !Number.isInteger(parsed.consecutiveFailures) ||
    (parsed.failureFingerprint !== null &&
      typeof parsed.failureFingerprint !== 'string')
  ) {
    throw new Error('Guardian state file is invalid; automatic recovery refused.');
  }
  return parsed;
}

export async function writeJsonAtomic(
  targetPath: string,
  value: GuardianState | GuardianStatus,
): Promise<void> {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    }
    finally {
      await handle.close();
    }
  }
  catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await rename(temporaryPath, targetPath);
  await chmod(targetPath, 0o600);
  if (process.platform !== 'win32') {
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    }
    finally {
      await directoryHandle.close();
    }
  }
}
