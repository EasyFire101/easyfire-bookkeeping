import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isCanonicalMainModule } from '../scripts/production/linux-cli-entrypoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entrypoints = [
  ['direct-vm-cutover-contract.mjs', ['--broken'], 1, /E_USAGE:/],
  ['direct-vm-source-abort-contract.mjs', ['--broken'], 1, /E_ARGUMENTS:/],
  ['linux-checkpoint-authority-v2.mjs', ['--help'], 0, /^Usage:/m],
  ['linux-convert-production-env.mjs', ['--help'], 0, /^Usage:/m],
  ['linux-deploy-candidate.mjs', ['--help'], 0, /^Usage:/m],
  ['linux-release-manifest-v2.mjs', [], 1, /release-manifest-v2 refused:/],
  ['linux-rollback-lock.mjs', ['--help'], 0, /^Usage:/m],
  ['linux-activation-evidence-collect.mjs', [], 1, /E_USAGE:/],
  ['linux-guardian-promote-active.mjs', [], 1, /E_USAGE:/],
  ['linux-private-route-activate.mjs', [], 1, /E_USAGE:/],
  ['linux-native-auth-proof.mjs', ['--help'], 0, /^Usage:/m],
  ['linux-rehearsal-evidence.mjs', ['--help'], 0, /^Usage:/m],
  ['linux-oci-bundle-produce.mjs', [], 1, /oci-bundle refused:/],
  ['linux-target-engine-evidence-produce.mjs', [], 1, /target-engine-evidence refused:/],
];

test('canonical entrypoint identity fails closed when path resolution fails', async () => {
  const failCanonicalization = async () => {
    throw new Error('synthetic realpath failure');
  };
  assert.equal(
    await isCanonicalMainModule(
      import.meta.url,
      fileURLToPath(import.meta.url),
      failCanonicalization,
    ),
    false,
  );
});

test('release-owned Linux CLIs execute when current is a directory symlink', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'easyfire-cli-symlink-'));
  const current = path.join(temporaryRoot, 'current');
  await symlink(root, current, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  assert.notEqual(path.resolve(current), await realpath(current));

  for (const [fileName, args, expectedStatus, expectedOutput] of entrypoints) {
    await t.test(fileName, () => {
      const executable = path.join(current, 'scripts', 'production', fileName);
      const result = spawnSync(process.execPath, [executable, ...args], {
        cwd: temporaryRoot,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(
        result.status,
        expectedStatus,
        `${fileName} exited unexpectedly. stdout=${result.stdout} stderr=${result.stderr}`,
      );
      assert.match(`${result.stdout}${result.stderr}`, expectedOutput);
    });
  }
});
