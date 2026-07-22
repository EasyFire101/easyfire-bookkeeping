import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function isCanonicalMainModule(
  moduleUrl,
  invokedPath = process.argv[1],
  canonicalize = realpath,
) {
  if (!invokedPath) return false;
  try {
    const [invokedRealPath, moduleRealPath] = await Promise.all([
      canonicalize(path.resolve(invokedPath)),
      canonicalize(fileURLToPath(moduleUrl)),
    ]);
    return (
      typeof invokedRealPath === 'string' &&
      typeof moduleRealPath === 'string' &&
      invokedRealPath === moduleRealPath
    );
  } catch {
    return false;
  }
}
