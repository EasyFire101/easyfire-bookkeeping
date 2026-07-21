import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;

function invokeFunctions(names, body) {
  const path = resolve(root, "deploy/windows/migration-scheduled-backup.ps1");
  const script = [
    `$path=${psQuote(path)}`,
    "$tokens=$null; $errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)",
    "if($errors.Count){throw ($errors | ForEach-Object Message | Out-String)}",
    ...names.map(
      (name) =>
        `$nodes=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq '${name}'},$true)); if($nodes.Count -ne 1){throw 'missing ${name}'}; Invoke-Expression $nodes[0].Extent.Text`,
    ),
    body,
  ].join("; ");
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: root,
    encoding: "utf8",
  });
}

test("migration backup controller exposes only the three journal-bound migrated-runtime roles", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");

  assert.match(
    controller,
    /ValidateSet\('MigrationBaseline',\s*'MigrationEmergency',\s*'MigrationScheduled'\)/,
  );
  assert.match(controller, /SchemaVersion[^\n]*-ne 2/);
  assert.match(controller, /Get-EasyFireProductionMutexName/);
  assert.match(controller, /BackupReceipts/);
  assert.match(controller, /RESTORE_VERIFICATION_PASSED/);
  assert.match(controller, /BACKUP_PUBLISHED/);
  assert.match(controller, /Save-EasyFireMigrationBackupPlan/);
  assert.match(controller, /Save-EasyFireMigrationScheduledBackupReceipt/);
  assert.doesNotMatch(controller, /Service\s+'worker'|\bworkerImage\b/);
  assert.match(
    controller,
    /expectedServices\s*=\s*@\('database_migration', 'envoy', 'gotenberg', 'mysql', 'redis', 'server', 'webapp'\)/,
  );
  assert.match(controller, /expectedImage\.ImageReference/);
  assert.doesNotMatch(controller, /Remove-Item\s+-Recurse/);
});

test("the scheduled consumer accepts the exact seven-image Plan schema", () => {
  const result = invokeFunctions(
    [
      "Get-EasyFireMigrationBackupProperty",
      "Get-EasyFireMigrationBackupTargetImage",
    ],
    [
      "$services=@('database_migration','envoy','gotenberg','mysql','redis','server','webapp')",
      "$images=@($services | ForEach-Object { [pscustomobject]@{Service=$_;ImageReference=\"easyfire/$_`:release\";ImageId=('sha256:' + ('a'*64))} })",
      "$target=[pscustomobject]@{Images=$images}",
      "$references=@($services | ForEach-Object { $image=Get-EasyFireMigrationBackupTargetImage -Target $target -Service $_; [string]$image.ImageReference })",
      "[pscustomobject]@{Count=$references.Count;References=$references} | ConvertTo-Json -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(proof.Count, 7);
  assert.deepEqual(
    proof.References,
    [
      "database_migration",
      "envoy",
      "gotenberg",
      "mysql",
      "redis",
      "server",
      "webapp",
    ].map((service) => `easyfire/${service}:release`),
  );
});

test("scheduled image authority rejects every duplicate, foreign, missing, or eighth service", () => {
  const result = invokeFunctions(
    [
      "Get-EasyFireMigrationBackupProperty",
      "Get-EasyFireMigrationBackupTargetImage",
      "Assert-EasyFireMigrationBackupTargetImageSet",
    ],
    [
      "Set-StrictMode -Version 3.0",
      "$services=@('database_migration','envoy','gotenberg','mysql','redis','server','webapp')",
      "$images=@($services | ForEach-Object { [pscustomobject]@{Service=$_;ImageReference=\"easyfire/$_`:release\";ImageId=('sha256:' + ('a'*64))} })",
      "$exact=[pscustomobject]@{Images=@($images)}",
      "$accepted=@(Assert-EasyFireMigrationBackupTargetImageSet -Target $exact).Count -eq 7",
      "$cases=@()",
      "$cases += [pscustomobject]@{Name='duplicate-with-missing'; Images=@($images | Where-Object Service -cne 'webapp') + @([pscustomobject]@{Service='server';ImageReference='easyfire/server:other';ImageId=('sha256:' + ('b'*64))})}",
      "$cases += [pscustomobject]@{Name='foreign-with-missing'; Images=@($images | Where-Object Service -cne 'webapp') + @([pscustomobject]@{Service='worker';ImageReference='easyfire/worker:release';ImageId=('sha256:' + ('c'*64))})}",
      "$cases += [pscustomobject]@{Name='eighth-foreign'; Images=@($images) + @([pscustomobject]@{Service='worker';ImageReference='easyfire/worker:release';ImageId=('sha256:' + ('d'*64))})}",
      "$cases += [pscustomobject]@{Name='missing'; Images=@($images | Where-Object Service -cne 'webapp')}",
      "$rejected=@($cases | ForEach-Object { $target=[pscustomobject]@{Images=@($_.Images)}; $didReject=$false; try { $null=Assert-EasyFireMigrationBackupTargetImageSet -Target $target } catch { $didReject=$true }; [pscustomobject]@{Name=$_.Name;Rejected=$didReject} })",
      "[pscustomobject]@{Accepted=$accepted;Rejected=$rejected} | ConvertTo-Json -Depth 8 -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(proof.Accepted, true);
  assert.deepEqual(
    proof.Rejected,
    ["duplicate-with-missing", "foreign-with-missing", "eighth-foreign", "missing"].map(
      (Name) => ({ Name, Rejected: true }),
    ),
  );
});

test("scheduled data-tier authority rejects extra mounts and host ports", () => {
  const result = invokeFunctions(
    ["Assert-EasyFireMigrationBackupDataStorageAuthority"],
    [
      "$volume='easyfire_mig_c_redis_aaaaaaaaaaaa'",
      "$mount=[pscustomobject]@{Type='volume';Source=$volume;Name=$volume;Destination='/data';ReadWrite=$true;RW=$true}",
      "$inventory=[pscustomobject]@{Mounts=@($mount);PortBindings=@()}",
      "$inspect=[pscustomobject]@{Mounts=@($mount);HostConfig=[pscustomobject]@{PortBindings=$null}}",
      "$inventoryValid=$null -ne (Assert-EasyFireMigrationBackupDataStorageAuthority -Container $inventory -VolumeName $volume -Destination '/data' -Shape Inventory)",
      "$inspectValid=$null -ne (Assert-EasyFireMigrationBackupDataStorageAuthority -Container $inspect -VolumeName $volume -Destination '/data' -Shape Inspect)",
      "$extra=[pscustomobject]@{Mounts=@($mount,[pscustomobject]@{Type='bind';Source='C:\\extra';Name='';Destination='/extra'});PortBindings=@()}",
      "$extraRejected=$false; try { $null=Assert-EasyFireMigrationBackupDataStorageAuthority -Container $extra -VolumeName $volume -Destination '/data' -Shape Inventory } catch { $extraRejected=$true }",
      "$ports=[pscustomobject]@{Mounts=@($mount);PortBindings=@([pscustomobject]@{ContainerPort='6379/tcp';HostIp='127.0.0.1';HostPort='16379'})}",
      "$portsRejected=$false; try { $null=Assert-EasyFireMigrationBackupDataStorageAuthority -Container $ports -VolumeName $volume -Destination '/data' -Shape Inventory } catch { $portsRejected=$true }",
      "[pscustomobject]@{InventoryValid=$inventoryValid;InspectValid=$inspectValid;ExtraRejected=$extraRejected;PortsRejected=$portsRejected} | ConvertTo-Json -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    InventoryValid: true,
    InspectValid: true,
    ExtraRejected: true,
    PortsRejected: true,
  });
});

test("scheduled authority capture enforces the complete seven-service mount and published-port table", () => {
  const result = invokeFunctions(
    [
      "Assert-EasyFireMigrationBackupDataStorageAuthority",
      "Assert-EasyFireMigrationBackupServiceRuntimeContract",
    ],
    [
      "Set-StrictMode -Version 3.0",
      `$release=${psQuote(root)}`,
      "$loopbackPort=28481",
      "$mysqlVolume='easyfire_mig_c_mysql_aaaaaaaaaaaa'",
      "$redisVolume='easyfire_mig_c_redis_aaaaaaaaaaaa'",
      "$envoySource=[IO.Path]::GetFullPath((Join-Path $release 'docker\\envoy\\envoy.yaml'))",
      "$mysqlMount=[pscustomobject]@{Type='volume';Source=$mysqlVolume;Destination='/var/lib/mysql';Mode='rw';ReadWrite=$true;Propagation=''}",
      "$redisMount=[pscustomobject]@{Type='volume';Source=$redisVolume;Destination='/data';Mode='rw';ReadWrite=$true;Propagation=''}",
      "$envoyMount=[pscustomobject]@{Type='bind';Source=$envoySource;Destination='/etc/envoy/envoy.yaml';Mode='ro';ReadWrite=$false;Propagation='rprivate'}",
      "$envoyPort=[pscustomobject]@{ContainerPort='80/tcp';HostIp='127.0.0.1';HostPort=[string]$loopbackPort}",
      "$valid=[ordered]@{}",
      "$valid.mysql=[pscustomobject]@{Mounts=@($mysqlMount);PortBindings=@()}",
      "$valid.redis=[pscustomobject]@{Mounts=@($redisMount);PortBindings=@()}",
      "$valid.envoy=[pscustomobject]@{Mounts=@($envoyMount);PortBindings=@($envoyPort)}",
      "foreach($service in @('server','webapp','gotenberg','database_migration')) { $valid[$service]=[pscustomobject]@{Mounts=@();PortBindings=@()} }",
      "$accepted=@()",
      "foreach($service in @('database_migration','envoy','gotenberg','mysql','redis','server','webapp')) { $null=Assert-EasyFireMigrationBackupServiceRuntimeContract -Container $valid[$service] -Service $service -ReleaseDirectory $release -LoopbackPort $loopbackPort -MysqlVolumeName $mysqlVolume -RedisVolumeName $redisVolume; $accepted += $service }",
      "$invalid=@()",
      "$invalid += [pscustomobject]@{Name='mysql-read-only';Service='mysql';Container=[pscustomobject]@{Mounts=@([pscustomobject]@{Type='volume';Source=$mysqlVolume;Destination='/var/lib/mysql';Mode='ro';ReadWrite=$false;Propagation=''});PortBindings=@()}}",
      "$invalid += [pscustomobject]@{Name='mysql-extra-mount';Service='mysql';Container=[pscustomobject]@{Mounts=@($mysqlMount,[pscustomobject]@{Type='bind';Source='C:\\extra';Destination='/extra';Mode='ro';ReadWrite=$false;Propagation=''});PortBindings=@()}}",
      "$invalid += [pscustomobject]@{Name='mysql-published-port';Service='mysql';Container=[pscustomobject]@{Mounts=@($mysqlMount);PortBindings=@([pscustomobject]@{ContainerPort='3306/tcp';HostIp='127.0.0.1';HostPort='13306'})}}",
      "$invalid += [pscustomobject]@{Name='redis-wrong-volume';Service='redis';Container=[pscustomobject]@{Mounts=@([pscustomobject]@{Type='volume';Source='foreign_redis';Destination='/data';Mode='rw';ReadWrite=$true;Propagation=''});PortBindings=@()}}",
      "$invalid += [pscustomobject]@{Name='redis-wrong-destination';Service='redis';Container=[pscustomobject]@{Mounts=@([pscustomobject]@{Type='volume';Source=$redisVolume;Destination='/var/lib/redis';Mode='rw';ReadWrite=$true;Propagation=''});PortBindings=@()}}",
      "$invalid += [pscustomobject]@{Name='envoy-foreign-bind';Service='envoy';Container=[pscustomobject]@{Mounts=@([pscustomobject]@{Type='bind';Source='C:\\foreign\\envoy.yaml';Destination='/etc/envoy/envoy.yaml';Mode='ro';ReadWrite=$false;Propagation='rprivate'});PortBindings=@($envoyPort)}}",
      "$invalid += [pscustomobject]@{Name='envoy-read-write';Service='envoy';Container=[pscustomobject]@{Mounts=@([pscustomobject]@{Type='bind';Source=$envoySource;Destination='/etc/envoy/envoy.yaml';Mode='rw';ReadWrite=$true;Propagation='rprivate'});PortBindings=@($envoyPort)}}",
      "$invalid += [pscustomobject]@{Name='envoy-extra-mount';Service='envoy';Container=[pscustomobject]@{Mounts=@($envoyMount,[pscustomobject]@{Type='bind';Source='C:\\extra';Destination='/extra';Mode='ro';ReadWrite=$false;Propagation=''});PortBindings=@($envoyPort)}}",
      "$invalid += [pscustomobject]@{Name='envoy-public-host';Service='envoy';Container=[pscustomobject]@{Mounts=@($envoyMount);PortBindings=@([pscustomobject]@{ContainerPort='80/tcp';HostIp='0.0.0.0';HostPort=[string]$loopbackPort})}}",
      "$invalid += [pscustomobject]@{Name='envoy-wrong-host-port';Service='envoy';Container=[pscustomobject]@{Mounts=@($envoyMount);PortBindings=@([pscustomobject]@{ContainerPort='80/tcp';HostIp='127.0.0.1';HostPort='28482'})}}",
      "$invalid += [pscustomobject]@{Name='envoy-extra-port';Service='envoy';Container=[pscustomobject]@{Mounts=@($envoyMount);PortBindings=@($envoyPort,[pscustomobject]@{ContainerPort='9901/tcp';HostIp='127.0.0.1';HostPort='29901'})}}",
      "foreach($service in @('server','webapp','gotenberg','database_migration')) { $invalid += [pscustomobject]@{Name=\"$service-extra-mount\";Service=$service;Container=[pscustomobject]@{Mounts=@([pscustomobject]@{Type='bind';Source='C:\\extra';Destination='/extra';Mode='ro';ReadWrite=$false;Propagation=''});PortBindings=@()}}; $invalid += [pscustomobject]@{Name=\"$service-published-port\";Service=$service;Container=[pscustomobject]@{Mounts=@();PortBindings=@([pscustomobject]@{ContainerPort='3000/tcp';HostIp='127.0.0.1';HostPort='23000'})}} }",
      "$rejected=@($invalid | ForEach-Object { $didReject=$false; try { $null=Assert-EasyFireMigrationBackupServiceRuntimeContract -Container $_.Container -Service $_.Service -ReleaseDirectory $release -LoopbackPort $loopbackPort -MysqlVolumeName $mysqlVolume -RedisVolumeName $redisVolume } catch { $didReject=$true }; [pscustomobject]@{Name=$_.Name;Rejected=$didReject} })",
      "[pscustomobject]@{Accepted=$accepted;Rejected=$rejected} | ConvertTo-Json -Depth 10 -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(proof.Accepted, [
    "database_migration",
    "envoy",
    "gotenberg",
    "mysql",
    "redis",
    "server",
    "webapp",
  ]);
  assert.equal(proof.Rejected.length, 19);
  for (const item of proof.Rejected) {
    assert.equal(item.Rejected, true, item.Name);
  }
});

test("all migrated-runtime roles require the same exact app-tier stop boundary", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");
  const result = invokeFunctions(
    ["Get-EasyFireMigrationBackupRolePolicy"],
    "@('MigrationBaseline','MigrationEmergency','MigrationScheduled') | ForEach-Object { Get-EasyFireMigrationBackupRolePolicy -Role $_ } | ConvertTo-Json -Depth 5 -Compress",
  );
  assert.equal(result.status, 0, result.stderr);
  const policies = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(
    policies.map((policy) => policy.RequiredState),
    ["CuttingOver", "Completed", "Completed"],
  );
  assert.match(controller, /Strategy\s*=\s*'graceful-stop'/);
  for (const service of ["envoy", "server", "webapp", "gotenberg"]) {
    assert.match(controller, new RegExp(`'${service}'`));
  }
  const planCas = controller.indexOf("Save-EasyFireMigrationBackupPlan -JournalPath");
  const stop = controller.indexOf("Stop-EasyFireMigrationBackupApplicationTier -Plan");
  assert.ok(planCas >= 0 && stop > planCas, "plan CAS must precede app-tier mutation");
});

test("scheduled receipt construction is append-only and crash-resume aligned", () => {
  const result = invokeFunctions(
    [
      "Get-EasyFireMigrationBackupProperty",
      "New-EasyFireMigrationBackupRecord",
      "Get-EasyFireMigrationActiveScheduledRecord",
    ],
    [
      "$p1=[pscustomobject]@{BackupOperationId='11111111-1111-4111-8111-111111111111'}",
      "$r1=New-EasyFireMigrationBackupRecord -Role MigrationScheduled -Plan $p1 -RecoveryUnit $null -RestoreReceipt $null -ExistingRecord $null",
      "$active=Get-EasyFireMigrationActiveScheduledRecord -Record $r1",
      "$u1=[pscustomobject]@{BackupOperationId=$p1.BackupOperationId;Value='unit'}",
      "$r2=New-EasyFireMigrationBackupRecord -Role MigrationScheduled -Plan $p1 -RecoveryUnit $u1 -RestoreReceipt $null -ExistingRecord $r1",
      "$x1=[pscustomobject]@{BackupOperationId=$p1.BackupOperationId;Value='restore'}",
      "$r3=New-EasyFireMigrationBackupRecord -Role MigrationScheduled -Plan $p1 -RecoveryUnit $u1 -RestoreReceipt $x1 -ExistingRecord $r2",
      "[pscustomobject]@{ActiveId=$active.Plan.BackupOperationId;P=@($r3.Plan).Count;U=@($r3.RecoveryUnit).Count;R=@($r3.RestoreReceipt).Count;Done=$null -eq (Get-EasyFireMigrationActiveScheduledRecord -Record $r3)} | ConvertTo-Json -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    ActiveId: "11111111-1111-4111-8111-111111111111",
    P: 1,
    U: 1,
    R: 1,
    Done: true,
  });
});

test("Redis recovery is hash-bound, all-database, isolated, and composite-only", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");
  assert.match(controller, /redis-cli', '--raw', 'SAVE'/);
  assert.match(controller, /redis-check-rdb', '\/data\/dump\.rdb'/);
  assert.match(controller, /sha256sum', '\/data\/dump\.rdb'/);
  assert.match(controller, /CONFIG', 'GET', \$Name/);
  assert.match(controller, /for \(\$database = 0; \$database -lt/);
  assert.match(controller, /'create', '--network', 'none'/);
  assert.match(controller, /HostPortCount = 0/);
  assert.match(controller, /RdbKeysLoaded/);
  assert.match(controller, /RdbKeysExpired/);
  assert.match(controller, /SchemaVersion = 2[\s\S]*MariaDb = \$MariaDb[\s\S]*Redis = \$Redis/);
  assert.match(controller, /CaptureManifestFile/);
  assert.doesNotMatch(
    controller,
    /\$afterCounts\.TotalKeys\s+-ne\s+\$sourceCounts\.TotalKeys/,
  );
  assert.doesNotMatch(
    controller,
    /\$afterCounts\.Counts[\s\S]{0,120}\$sourceCounts\.Counts/,
  );
});

test("Redis restore proof treats source counts as observations and rejects impossible load accounting", () => {
  const result = invokeFunctions(
    ["Assert-EasyFireMigrationRedisRestoreObservations"],
    [
      "$unit=[pscustomobject]@{DatabaseCount=16;TotalKeys=[int64]10;DatabaseKeyCounts=@([pscustomobject]@{Database=0;KeyCount=[int64]10})}",
      "$load=[pscustomobject]@{KeysLoaded=[int64]8;KeysExpired=[int64]2}",
      "$current=[pscustomobject]@{DatabaseCount=16;TotalKeys=[int64]7;Counts=@([pscustomobject]@{Database=0;KeyCount=[int64]7})}",
      "$ttlAccepted=$null -ne (Assert-EasyFireMigrationRedisRestoreObservations -RedisUnit $unit -LoadEvidence $load -CurrentCounts $current)",
      "$tooMany=[pscustomobject]@{DatabaseCount=16;TotalKeys=[int64]9;Counts=@([pscustomobject]@{Database=0;KeyCount=[int64]9})}",
      "$currentRejected=$false; try { $null=Assert-EasyFireMigrationRedisRestoreObservations -RedisUnit $unit -LoadEvidence $load -CurrentCounts $tooMany } catch { $currentRejected=$true }",
      "$largerUnit=[pscustomobject]@{DatabaseCount=16;TotalKeys=[int64]11;DatabaseKeyCounts=$unit.DatabaseKeyCounts}",
      "$sourceDriftAccepted=$null -ne (Assert-EasyFireMigrationRedisRestoreObservations -RedisUnit $largerUnit -LoadEvidence $load -CurrentCounts $current)",
      "$negativeLoad=[pscustomobject]@{KeysLoaded=[int64]8;KeysExpired=[int64]-1}",
      "$negativeRejected=$false; try { $null=Assert-EasyFireMigrationRedisRestoreObservations -RedisUnit $unit -LoadEvidence $negativeLoad -CurrentCounts $current } catch { $negativeRejected=$true }",
      "[pscustomobject]@{TtlAccepted=$ttlAccepted;CurrentRejected=$currentRejected;SourceDriftAccepted=$sourceDriftAccepted;NegativeRejected=$negativeRejected} | ConvertTo-Json -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    TtlAccepted: true,
    CurrentRejected: true,
    SourceDriftAccepted: true,
    NegativeRejected: true,
  });
});

test("each retry captures a fresh immutable MariaDB and Redis attempt", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");
  const backup = read("scripts/production/backup.ps1");

  assert.match(controller, /CaptureAttemptId/);
  assert.match(controller, /NewGuid\(\)\.ToString\('D'\)\.ToLowerInvariant\(\)/);
  assert.match(controller, /ArtifactPrefix/);
  assert.match(controller, /-CaptureAttemptId \$captureAttemptId/);
  assert.match(backup, /\[string\]\$CaptureAttemptId/);
  assert.match(backup, /-capture-\$CaptureAttemptId/);
  assert.match(backup, /CaptureAttemptId\s*=\s*\[string\]\$SourceAuthority\.CaptureAttemptId/);
});

test("capture-attempt artifact authority is deterministic and retry-disjoint", () => {
  const result = invokeFunctions(
    [
      "ConvertTo-EasyFireMigrationBackupCanonicalGuid",
      "Get-EasyFireMigrationRedisAttemptPublication",
    ],
    [
      "$plan=[pscustomobject]@{RedisPublication=[pscustomobject]@{ArtifactPrefix='C:\\backups\\redis-op'}}",
      "$a=Get-EasyFireMigrationRedisAttemptPublication -Plan $plan -CaptureAttemptId '11111111-1111-4111-8111-111111111111'",
      "$b=Get-EasyFireMigrationRedisAttemptPublication -Plan $plan -CaptureAttemptId '22222222-2222-4222-8222-222222222222'",
      "[pscustomobject]@{A=$a.RdbFile;B=$b.RdbFile;Distinct=($a.RdbFile -cne $b.RdbFile)} | ConvertTo-Json -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(proof.Distinct, true);
  assert.match(proof.A, /capture-11111111-1111-4111-8111-111111111111\.rdb$/);
  assert.match(proof.B, /capture-22222222-2222-4222-8222-222222222222\.rdb$/);
});

test("composite authority is atomically published and cross-binds the exact pair", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");

  assert.match(controller, /Write-EasyFireMigrationBackupTextAtomicCreateNew/);
  assert.match(controller, /\[IO\.File\]::Move\(\$candidate, \$exactPath\)/);
  assert.match(controller, /Assert-EasyFireMigrationCompositeCaptureBinding/);
  for (const field of [
    "CaptureAttemptId",
    "MariaDbBackupFile",
    "MariaDbBackupSha256",
    "MariaDbMetadataSha256",
    "RedisRdbFile",
    "RedisRdbSha256",
    "RedisMetadataFile",
    "RedisMetadataSha256",
  ]) {
    assert.match(controller, new RegExp(field));
  }
});

test("composite binding rejects a syntactically valid mismatched Redis hash", () => {
  const result = invokeFunctions(
    [
      "Get-EasyFireMigrationBackupProperty",
      "ConvertTo-EasyFireMigrationBackupCanonicalGuid",
      "Assert-EasyFireMigrationCompositeCaptureBinding",
    ],
    [
      "$id='11111111-1111-4111-8111-111111111111'",
      "$plan=[pscustomobject]@{BackupOperationId='22222222-2222-4222-8222-222222222222'}",
      "$m=[pscustomobject]@{BackupOperationId=$plan.BackupOperationId;CaptureAttemptId=$id;BackupFile='m.sql.gz';BackupSha256=('A'*64);MetadataFile='m.json';MetadataSha256=('B'*64)}",
      "$r=[pscustomobject]@{CaptureAttemptId=$id;QuiescenceFingerprint=('C'*64);RdbArtifact='r.rdb';RdbSha256=('D'*64);RdbMetadata='r.json';RdbMetadataSha256=('E'*64)}",
      "$manifest=[pscustomobject]@{Document=[pscustomobject]@{BackupOperationId=$plan.BackupOperationId;CaptureAttemptId=$id;QuiescenceFingerprint=('C'*64);MariaDbBackupFile='m.sql.gz';MariaDbBackupSha256=('A'*64);MariaDbMetadataFile='m.json';MariaDbMetadataSha256=('B'*64);RedisRdbFile='r.rdb';RedisRdbSha256=('F'*64);RedisMetadataFile='r.json';RedisMetadataSha256=('E'*64)}}",
      "$rejected=$false; try { $null=Assert-EasyFireMigrationCompositeCaptureBinding -CaptureManifest $manifest -MariaDb $m -Redis $r -Plan $plan } catch { $rejected=$true }",
      "[pscustomobject]@{Rejected=$rejected} | ConvertTo-Json -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    Rejected: true,
  });
});

test("Redis verifier cleanup removes only a canonical ID re-inspected as the same exact authority", () => {
  const result = invokeFunctions(
    [
      "Assert-EasyFireMigrationRedisVerifierLabels",
      "Remove-EasyFireMigrationRedisVerifier",
    ],
    [
      "Set-StrictMode -Version 3.0",
      "$token=('A'*64 -join '')",
      "$migrationId='11111111-1111-4111-8111-111111111111'",
      "$operationId='22222222-2222-4222-8222-222222222222'",
      "$containerName='redis-verify-exact'",
      "$volumeName='redis-verify-volume-exact'",
      "$imageId=('sha256:' + ('b'*64))",
      "$labels=[pscustomobject][ordered]@{'easyfire.restore.migration.id'=$migrationId;'easyfire.restore.backup.operation.id'=$operationId;'easyfire.restore.authority'=$token;'easyfire.restore.role'='redis-restore-verify'}",
      "$plan=[pscustomobject]@{BackupOperationId=$operationId;RuntimeAuthority=[pscustomobject]@{MigrationId=$migrationId;Redis=[pscustomobject]@{ImageId=$imageId}};RedisPublication=[pscustomobject]@{VerifierContainerName=$containerName;VerifierVolumeName=$volumeName}}",
      "function New-TestContainer([string]$Id) { [pscustomobject]@{Id=$Id;Name=('/'+$containerName);Image=$imageId;Config=[pscustomobject]@{Labels=$labels};HostConfig=[pscustomobject]@{PortBindings=$null;NetworkMode='none'};Mounts=@([pscustomobject]@{Type='volume';Name=$volumeName;Destination='/data'})} }",
      "function Invoke-TestCase([string]$InitialId,[string]$ReadbackId) { $script:Initial=New-TestContainer -Id $InitialId; $script:Readback=New-TestContainer -Id $ReadbackId; $script:NativeCalls=0; $script:RemovedId=''; function Get-EasyFireMigrationBackupDockerObject { param($Kind,$Identity,[switch]$AllowMissing); if($Kind -ceq 'volume'){return $null}; if($Identity -ceq $containerName){return $script:Initial}; return $script:Readback }; function Invoke-EasyFireNative { param($FilePath,$ArgumentList); $script:NativeCalls++; if($ArgumentList[0] -ceq 'rm'){$script:RemovedId=[string]$ArgumentList[2]}; return [pscustomobject]@{ExitCode=0} }; $errorMessage=''; try { Remove-EasyFireMigrationRedisVerifier -Plan $plan -AuthorityToken $token } catch { $errorMessage=[string]$_.Exception.Message }; [pscustomobject]@{InitialId=$InitialId;ReadbackId=$ReadbackId;Calls=$script:NativeCalls;RemovedId=$script:RemovedId;Error=$errorMessage} }",
      "$validId=('c'*64 -join '')",
      "$otherId=('d'*64 -join '')",
      "$cases=@(Invoke-TestCase -InitialId 'not-a-container-id' -ReadbackId 'not-a-container-id'; Invoke-TestCase -InitialId $validId -ReadbackId $otherId; Invoke-TestCase -InitialId $validId -ReadbackId $validId)",
      "$cases | ConvertTo-Json -Depth 8 -Compress",
    ].join("; "),
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.match(proof[0].Error, /container identity/i);
  assert.equal(proof[0].Calls, 0);
  assert.match(proof[1].Error, /container identity/i);
  assert.equal(proof[1].Calls, 0);
  assert.equal(proof[2].Error, "");
  assert.equal(proof[2].Calls, 1);
  assert.equal(proof[2].RemovedId, "c".repeat(64));
});

test("cleanup and capture boundary exclude every unapproved writer", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");
  const backup = read("scripts/production/backup.ps1");

  assert.match(controller, /RequiredExitedServices\s*=\s*@\('database_migration'\)/);
  assert.match(backup, /RequiredExitedServices/);
  assert.match(controller, /\$hostPortCount -ne 0/);
  assert.match(backup, /\$mysqlHostPortCount -ne 0/);
  assert.match(controller, /HostConfig\.NetworkMode[^\n]*-cne 'none'/);
  assert.match(controller, /\$mounts\.Count -ne 1/);
  assert.doesNotMatch(controller, /'rm', '-f', '-v'/);
});

test("one-shot receipt retries repair both operation completion markers", () => {
  const controller = read("deploy/windows/migration-scheduled-backup.ps1");

  assert.match(controller, /Complete-EasyFireMigrationBackupOperationIfNeeded/);
  assert.match(controller, /-Name \$InvocationRole/);
  assert.match(controller, /-Name "\$\{InvocationRole\}Restore"/);
});

test("backup and restore scripts bind migrated-runtime roles without widening MigrationSource", () => {
  const backup = read("scripts/production/backup.ps1");
  const restore = read("scripts/production/restore-verify.ps1");

  for (const role of [
    "MigrationBaseline",
    "MigrationEmergency",
    "MigrationScheduled",
  ]) {
    assert.match(backup, new RegExp(role));
    assert.match(restore, new RegExp(role));
  }
  assert.match(backup, /MigrationSource/);
  assert.match(restore, /MigrationSource/);
  assert.match(restore, /RESTORE_VERIFICATION_PASSED/);
  assert.doesNotMatch(backup, /-Filter\s+["']mysql-\*\.sql\.gz/);
});
