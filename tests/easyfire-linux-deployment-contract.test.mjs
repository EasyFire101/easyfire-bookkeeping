import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

test('systemd stack unit starts only existing non-migration services', async () => {
  const unit = await text('deploy/linux/easyfire-bookkeeping-stack.service');
  assert.match(unit, /docker compose .* start --wait/);
  assert.match(unit, /start --wait --wait-timeout 180 mysql redis/);
  assert.match(unit, /start --wait --wait-timeout 180 gotenberg server webapp envoy/);
  assert.doesNotMatch(unit, /\b(up|down|build|pull|run|rm|prune)\b/);
  assert.doesNotMatch(unit, /database_migration|migration/);
  assert.doesNotMatch(unit, /ExecStop=/);
});

test('Guardian is timer-owned, bounded, hardened, and local-only', async () => {
  const service = await text('deploy/linux/easyfire-bookkeeping-guardian.service');
  const timer = await text('deploy/linux/easyfire-bookkeeping-guardian.timer');
  const config = JSON.parse(await text('deploy/linux/guardian.config.example.json'));

  assert.match(service, /Type=oneshot/);
  assert.match(service, /ExecStart=\/usr\/local\/bin\/node /);
  assert.doesNotMatch(service, /ExecStart=\/usr\/bin\/node /);
  assert.match(service, /TimeoutStartSec=25/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/easyfire-bookkeeping-guardian/);
  assert.match(timer, /OnUnitActiveSec=30s/);
  assert.equal(config.shadowMode, true);
  assert.equal(config.failureThreshold, 3);
  assert.ok(config.probes.every((probe) => new URL(probe.url).hostname === '127.0.0.1'));
});

test('VM Compose override creates a distinct Bookkeeping namespace', async () => {
  const override = await text('deploy/linux/docker-compose.vm.yml');
  for (const role of ['envoy', 'webapp', 'server', 'migration', 'mysql', 'redis', 'gotenberg']) {
    assert.match(override, new RegExp(`easyfire-bookkeeping-${role}`));
  }
  assert.match(override, /name: easyfire-bookkeeping-network/);
  assert.doesNotMatch(override, /0\.0\.0\.0|ports:/);
});

test('runtime schema makes both data services observe-only', async () => {
  const schema = JSON.parse(await text('deploy/linux/runtime-manifest.schema.json'));
  const serialized = JSON.stringify(schema);
  assert.match(serialized, /mysql/);
  assert.match(serialized, /redis/);
  assert.match(serialized, /observe-only/);
  assert.doesNotMatch(serialized, /database_migration/);
});

test('Windows migration checkpoint is no-retention and isolated-restore only', async () => {
  const script = await text('scripts/production/direct-vm-preflight-checkpoint.ps1');
  const restore = await text('scripts/production/direct-vm-checkpoint-RESTORE.md');

  assert.match(script, /--single-transaction/);
  assert.match(script, /--network none/);
  assert.match(script, /docker stop --time 30 \$restoreName/);
  assert.match(script, /E:\\EasyFire Bookkeeping Recovery/);
  assert.doesNotMatch(script, /Remove-Item|docker\s+(rm|rmi|volume rm|system prune)/i);
  assert.doesNotMatch(script, /docker compose|retention/i);
  assert.match(restore, /Do not restore into `easyfire_prod_mysql`/);
  assert.match(
    restore,
    /Never allow the Windows and VM databases\s+to accept writes simultaneously/,
  );
});

test('Linux backups use the release-owned isolated restore verifier', async () => {
  const runbook = await text('docs/easyfire/LINUX_VM_RUNBOOK.md');
  const script = await text('scripts/production/linux-backup-verify.sh');

  assert.match(runbook, /linux-backup-verify\.sh/);
  assert.match(script, /--network none/);
  assert.match(script, /mariadb-check/);
  assert.match(script, /restoreState: 'stopped-preserved'/);
  assert.doesNotMatch(script, /docker\s+(rm|rmi|system prune|volume rm)/i);
});
