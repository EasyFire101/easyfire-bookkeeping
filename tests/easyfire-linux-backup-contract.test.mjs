import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Linux backup proves an append-only network-isolated restore', async () => {
  const script = await readFile(
    path.join(root, 'scripts/production/linux-backup-verify.sh'),
    'utf8',
  );

  assert.match(script, /^#!\/usr\/bin\/env bash/);
  assert.match(script, /set -Eeuo pipefail/);
  assert.match(script, /umask 077/);
  assert.match(script, /\/var\/backups\/easyfire-bookkeeping/);
  assert.match(script, /mariadb-dump .*--single-transaction/);
  assert.match(script, /--routines/);
  assert.match(script, /--triggers/);
  assert.match(script, /--events/);
  assert.match(script, /--hex-blob/);
  assert.match(script, /docker volume create/);
  assert.match(script, /--network none/);
  assert.match(script, /--env MYSQL_ROOT_PASSWORD/);
  assert.doesNotMatch(script, /docker create[\s\S]{0,300}--env-file/);
  assert.match(script, /mariadb-check/);
  assert.match(script, /EXPECTED_SYSTEM_TABLES:-17/);
  assert.match(script, /EXPECTED_TENANT_TABLES:-70/);
  assert.match(script, /EXPECTED_IDENTITY_COUNTS.*1\\t1\\t1\\t1/);
  assert.match(script, /SHA256SUMS/);
  assert.match(script, /restoreState.*stopped-preserved/);
  assert.match(script, /docker stop --time 30 "\$\{RESTORE_CONTAINER\}"/);
  assert.doesNotMatch(script, /docker\s+(rm|rmi|system prune|volume rm)/i);
  assert.doesNotMatch(script, /docker\s+compose\s+(down|up)/i);
  assert.doesNotMatch(script, /find .*-(delete|exec rm)/i);
});
