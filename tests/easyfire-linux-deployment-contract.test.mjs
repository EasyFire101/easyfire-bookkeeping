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
  assert.match(unit, /ConditionPathExists=\/etc\/easyfire-bookkeeping\/runtime-manifest\.json/);
  assert.match(unit, /ConditionPathExists=\/etc\/easyfire-bookkeeping\/deployment-plan\.json/);
  assert.match(unit, /ConditionPathExists=\/etc\/easyfire-bookkeeping\/migration-receipt\.json/);
  assert.match(unit, /ConditionPathExists=\/etc\/easyfire-bookkeeping\/deployment-receipt\.json/);
  assert.match(unit, /ConditionPathExists=\/etc\/easyfire-bookkeeping\/runtime-identity-evidence\.json/);
  assert.match(unit, /ConditionPathExists=!\/etc\/easyfire-bookkeeping\/rollback\.lock/);
  assert.match(unit, /PartOf=docker\.service/);
  assert.match(
    unit,
    /ExecStartPre=\/usr\/local\/bin\/node \/opt\/easyfire-bookkeeping\/current\/scripts\/production\/linux-deploy-candidate\.mjs --verify-existing --plan \/etc\/easyfire-bookkeeping\/deployment-plan\.json/,
  );
  assert.match(unit, /RuntimeDirectory=easyfire-bookkeeping-stack/);
  assert.match(unit, /docker-compose\.candidate\.yml/);
  assert.match(unit, /ExecStartPost=\/usr\/bin\/touch \/run\/easyfire-bookkeeping-stack\/ready/);
  assert.doesNotMatch(
    unit,
    /docker compose [^\n]*\b(up|down|build|pull|run|rm|prune)\b/,
  );
  assert.doesNotMatch(unit, /ExecStart=[^\n]*database_migration/);
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
  assert.match(service, /ConditionPathExists=!\/etc\/easyfire-bookkeeping\/rollback\.lock/);
  assert.match(service, /ConditionPathExists=\/run\/easyfire-bookkeeping-stack\/ready/);
  assert.match(service, /Requires=.*easyfire-bookkeeping-stack\.service/);
  assert.doesNotMatch(service, /Wants=.*easyfire-bookkeeping-stack\.service/);
  assert.match(timer, /ConditionPathExists=!\/etc\/easyfire-bookkeeping\/rollback\.lock/);
  assert.match(timer, /OnUnitActiveSec=30s/);
  assert.equal(config.shadowMode, true);
  assert.equal(config.failureThreshold, 3);
  assert.ok(config.probes.every((probe) => new URL(probe.url).hostname === '127.0.0.1'));
});

test('VM Compose override creates a distinct Bookkeeping namespace', async () => {
  const override = await text('deploy/linux/docker-compose.vm.yml');
  const candidate = await text('deploy/linux/docker-compose.candidate.yml');
  for (const role of ['envoy', 'webapp', 'server', 'migration', 'mysql', 'redis', 'gotenberg']) {
    assert.match(override, new RegExp(`easyfire-bookkeeping-${role}`));
  }
  assert.match(override, /name: easyfire-bookkeeping-network/);
  assert.doesNotMatch(override, /0\.0\.0\.0|ports:/);
  for (const role of ['envoy', 'webapp', 'server', 'database_migration', 'mysql', 'redis', 'gotenberg']) {
    assert.match(candidate, new RegExp(`${role}:[\\s\\S]*?restart: "no"`));
  }
  assert.doesNotMatch(candidate, /unless-stopped/);
  assert.doesNotMatch(candidate, /ports:|volumes:|image:|build:/);
});

test('runtime schema makes both data services observe-only', async () => {
  const schema = JSON.parse(await text('deploy/linux/runtime-manifest.schema.json'));
  const serialized = JSON.stringify(schema);
  assert.match(serialized, /mysql/);
  assert.match(serialized, /redis/);
  assert.match(serialized, /observe-only/);
  assert.doesNotMatch(serialized, /database_migration/);
});

test('Guardian build emits separate runnable Guardian and runtime identity artifacts', async () => {
  const packageManifest = JSON.parse(await text('packages/guardian/package.json'));
  const build = packageManifest.scripts.build;

  assert.match(build, /--entry\.index\s+src\/index\.ts/);
  assert.match(build, /--entry\.guardian\s+src\/index\.ts/);
  assert.match(
    build,
    /--entry\.runtime-manifest-generator\s+src\/runtime-manifest-generator\.ts/,
  );
  assert.equal(packageManifest.main, 'dist/index.js');
  assert.equal(packageManifest.bin['easyfire-bookkeeping-guardian'], 'dist/index.js');
  assert.match(build, /--no-splitting/);
  const generator = await text('packages/guardian/src/runtime-manifest-generator.ts');
  assert.match(generator, /--verify-existing/);
  assert.doesNotMatch(generator, /node:child_process|execFile|spawn|docker\s+inspect/);
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
  assert.match(script, /restoreProof:\s*{[\s\S]*state: 'stopped-preserved'/);
  assert.doesNotMatch(script, /docker\s+(rm|rmi|system prune|volume rm)/i);
});

test('runbook supplies every fail-closed environment materializer argument', async () => {
  const runbook = await text('docs/easyfire/LINUX_VM_RUNBOOK.md');
  assert.match(runbook, /linux-convert-production-env\.mjs/);
  for (const option of [
    '--source',
    '--target',
    '--release-commit',
    '--mysql-volume',
    '--redis-volume',
    '--base-url',
  ]) {
    assert.match(runbook, new RegExp(option));
  }
  assert.match(
    runbook,
    /https:\/\/easyfire-bookkeeping-newsec\.taild63e9b\.ts\.net/,
  );
});

test('runbook uses the release-owned rollback controller for reboot proof', async () => {
  const runbook = await text('docs/easyfire/LINUX_VM_RUNBOOK.md');
  assert.match(runbook, /linux-rollback-lock\.mjs[\s\S]*--arm --reason rehearsal/);
  assert.match(runbook, /linux-rollback-lock\.mjs[\s\S]*--verify-locked/);
  assert.match(runbook, /linux-rollback-lock\.mjs[\s\S]*--rearm/);
  assert.match(runbook, /--arm --reason rollback/);
  assert.match(runbook, /restart `no`/);
  assert.doesNotMatch(runbook, /printf "createdAt=.*rollback\.lock/);
});

test('runbook invokes the deployment controller and never authorizes raw deployment', async () => {
  const runbook = await text('docs/easyfire/LINUX_VM_RUNBOOK.md');
  assert.match(
    runbook,
    /linux-deploy-candidate\.mjs[\s\S]*--plan \/var\/lib\/easyfire-bookkeeping-staging\/deployment-plan\.json/,
  );
  assert.match(
    runbook,
    /linux-deploy-candidate\.mjs[\s\S]*--verify-existing[\s\S]*--plan \/etc\/easyfire-bookkeeping\/deployment-plan\.json/,
  );
  assert.doesNotMatch(runbook, /sudo docker (?:compose|start|update)/);
  assert.doesNotMatch(runbook, /unless-stopped/);
});
