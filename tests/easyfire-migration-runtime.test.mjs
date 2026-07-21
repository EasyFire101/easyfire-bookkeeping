import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(root, "deploy/windows/migration-runtime.psm1");

function ps(script) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function powerShellFunction(source, name) {
  const marker = `function ${name} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing PowerShell function ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/\r?\nfunction |\r?\nExport-ModuleMember /);
  return next === -1 ? tail : tail.slice(0, next);
}

test("runtime source has no destructive Docker or filesystem cleanup surface", () => {
  const source = readFileSync(modulePath, "utf8");
  assert.doesNotMatch(source, /docker(?:\.exe)?\s+(?:container\s+)?rm\b/i);
  assert.doesNotMatch(source, /docker(?:\.exe)?\s+volume\s+rm\b/i);
  assert.doesNotMatch(source, /docker(?:\.exe)?\s+compose\b[^\r\n]*\bdown\b/i);
  assert.doesNotMatch(source, /\bRemove-Item\b|\bClear-Content\b|\bMove-Item\b/i);
  assert.doesNotMatch(source, /--volumes?\b|\s-v\s/i);
  assert.doesNotMatch(source, /SourceKeyCount\s*=\s*-1/);
});

test("lane files hash successfully in Windows PowerShell without Get-FileHash", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "easyfire-runtime-files-"));
  const template = resolve(fixture, "template.env");
  writeFileSync(
    template,
    [
      "IMAGE_TAG=test",
      "MARIADB_IMAGE_TAG=db-test",
      "SYSTEM_DB_NAME=easyfire_system",
      "DB_USER=easyfire",
      "DB_PASSWORD=test-secret",
      "DB_ROOT_PASSWORD=test-root-secret",
    ].join("\n") + "\n",
    "utf8",
  );
  try {
    const result = ps(`
      Import-Module ${quote(modulePath)} -Force
      $lane = New-EasyFireMigrationRuntimeLane -MigrationId 'd1722b19-1ca2-46b5-a040-0e303e6fd13f' -Lane Rehearsal
      New-EasyFireMigrationLaneFiles -Lane $lane -TemplateEnvFile ${quote(template)} -LaneDirectory ${quote(fixture)} | ConvertTo-Json -Compress
    `);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.match(value.EnvironmentSha256, /^[A-F0-9]{64}$/);
    assert.match(value.ComposeOverrideSha256, /^[A-F0-9]{64}$/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("rehearsal and cutover identities are disjoint and migration-derived", () => {
  const migrationId = "d1722b19-1ca2-46b5-a040-0e303e6fd13f";
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $r = New-EasyFireMigrationRuntimeLane -MigrationId '${migrationId}' -Lane Rehearsal
    $c = New-EasyFireMigrationRuntimeLane -MigrationId '${migrationId}' -Lane Cutover
    [pscustomobject]@{ Rehearsal = $r; Cutover = $c } | ConvertTo-Json -Depth 8 -Compress
  `);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.notEqual(value.Rehearsal.ProjectName, value.Cutover.ProjectName);
  assert.notEqual(value.Rehearsal.MysqlVolumeName, value.Cutover.MysqlVolumeName);
  assert.notEqual(value.Rehearsal.RedisVolumeName, value.Cutover.RedisVolumeName);
  assert.notEqual(value.Rehearsal.ProxyContainerName, value.Cutover.ProxyContainerName);
  assert.notEqual(value.Rehearsal.LoopbackPort, value.Cutover.LoopbackPort);
  assert.equal(value.Cutover.LoopbackPort, 80);
  for (const lane of [value.Rehearsal, value.Cutover]) {
    assert.match(lane.ProjectName, /^easyfire-bookkeeping-mig-[rc]-[0-9a-f]{12}$/);
    assert.match(lane.MigrationContainerName, /-database-migration$/);
    assert.match(lane.AuthorityLabel, /^easyfire\.migration\./);
  }
});

test("lane override names every service and binds only lane-owned volumes and loopback port", () => {
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $lane = New-EasyFireMigrationRuntimeLane -MigrationId 'd1722b19-1ca2-46b5-a040-0e303e6fd13f' -Lane Rehearsal
    New-EasyFireMigrationComposeOverride -Lane $lane
  `);
  assert.equal(result.status, 0, result.stderr);
  const yaml = result.stdout;
  for (const service of [
    "envoy",
    "webapp",
    "server",
    "database_migration",
    "mysql",
    "redis",
    "gotenberg",
  ]) {
    assert.match(yaml, new RegExp(`^  ${service}:$`, "m"));
  }
  assert.match(yaml, /127\.0\.0\.1:\$\{PUBLIC_PROXY_PORT\}:80/);
  assert.match(yaml, /MARIADB_VOLUME_NAME/);
  assert.match(yaml, /REDIS_VOLUME_NAME/);
  assert.doesNotMatch(yaml, /easyfire_prod_mysql|easyfire_prod_redis/);
  const authorityLabel =
    "easyfire.migration.r=d1722b19-1ca2-46b5-a040-0e303e6fd13f";
  assert.equal(yaml.split(authorityLabel).length - 1, 9);
  assert.match(
    yaml,
    /volumes:\s+mysql:\s+name:[^\r\n]+\s+labels:\s+- "easyfire\.migration\.r=/,
  );
  assert.match(
    yaml,
    /\sredis:\s+name:[^\r\n]+\s+labels:\s+- "easyfire\.migration\.r=/,
  );
});

test("fresh-lane preflight rejects project resources and global deterministic-name collisions", () => {
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $module = Get-Module | Where-Object { $_.Path -ceq ${quote(modulePath)} }
    & $module {
      $lane = New-EasyFireMigrationRuntimeLane -MigrationId 'd1722b19-1ca2-46b5-a040-0e303e6fd13f' -Lane Rehearsal
      $empty = [pscustomobject]@{ Containers=@(); Volumes=@(); ReservedVolumeNames=@(); ForeignVolumeConsumers=@() }
      $script:RuntimeGlobalCollision = $false
      $script:RuntimeNativeCalls = @()
      function script:Invoke-EasyFireNative {
        param($FilePath,$ArgumentList)
        $script:RuntimeNativeCalls += ,@($ArgumentList)
        if ([string]$ArgumentList[0] -ceq 'ps') {
          $serverFilter = 'name=^/' + $lane.ServerContainerName + '$'
          if ($script:RuntimeGlobalCollision -and $ArgumentList -contains $serverFilter) {
            return [pscustomobject]@{ Output=@('abc123'); Text='abc123' }
          }
          return [pscustomobject]@{ Output=@(); Text='' }
        }
        if ([string]$ArgumentList[0] -ceq 'inspect') {
          $foreign = [ordered]@{
            Id=('a' * 64)
            Name=('/' + $lane.ServerContainerName)
            Config=[ordered]@{ Labels=[ordered]@{
              'com.docker.compose.project'='foreign-project'
              'com.docker.compose.service'='server'
              'easyfire.migration.r'='foreign-authority'
            } }
            State=[ordered]@{ Status='exited' }
          }
          return [pscustomobject]@{ Output=@(); Text=($foreign | ConvertTo-Json -Depth 8 -Compress) }
        }
        throw 'Unexpected native test call.'
      }
      $pass = Assert-EasyFireMigrationFreshLanePreflight -Lane $lane -Inventory $empty
      $containerMessage = ''
      try {
        $withContainer = [pscustomobject]@{ Containers=@([pscustomobject]@{ Service='mysql' }); Volumes=@(); ReservedVolumeNames=@(); ForeignVolumeConsumers=@() }
        $null = Assert-EasyFireMigrationFreshLanePreflight -Lane $lane -Inventory $withContainer
      } catch { $containerMessage = $_.Exception.Message }
      $volumeMessage = ''
      try {
        $withVolume = [pscustomobject]@{ Containers=@(); Volumes=@([pscustomobject]@{ Name=$lane.RedisVolumeName }); ReservedVolumeNames=@($lane.RedisVolumeName); ForeignVolumeConsumers=@() }
        $null = Assert-EasyFireMigrationFreshLanePreflight -Lane $lane -Inventory $withVolume
      } catch { $volumeMessage = $_.Exception.Message }
      $script:RuntimeGlobalCollision = $true
      $collisionMessage = ''
      try { $null = Assert-EasyFireMigrationFreshLanePreflight -Lane $lane -Inventory $empty }
      catch { $collisionMessage = $_.Exception.Message }
      $filters = @($script:RuntimeNativeCalls | Where-Object { $_[0] -ceq 'ps' } | ForEach-Object { $_[3] })
      [pscustomobject]@{
        Passed=$pass.Passed
        ProjectName=$pass.ProjectName
        Containers=$containerMessage
        Volume=$volumeMessage
        Collision=$collisionMessage
        UsedExactGlobalFilter=($filters -contains ('name=^/' + $lane.ServerContainerName + '$'))
        UniqueGlobalFilterCount=@($filters | Sort-Object -Unique).Count
      } | ConvertTo-Json -Compress
    }
  `);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(value.Passed, true);
  assert.match(value.Containers, /zero.*container|fresh.*container/i);
  assert.match(value.Volume, /volume.*absent|fresh.*volume/i);
  assert.match(value.Collision, /deterministic.*container|globally.*absent/i);
  assert.equal(value.UsedExactGlobalFilter, true);
  assert.equal(value.UniqueGlobalFilterCount, 7);
});

test("candidate authority binds all seven services, images, labels, and durable mounts", () => {
  const result = ps(`
    $ErrorActionPreference = 'Stop'
    Import-Module ${quote(modulePath)} -Force
    $lane = New-EasyFireMigrationRuntimeLane -MigrationId 'd1722b19-1ca2-46b5-a040-0e303e6fd13f' -Lane Rehearsal
    $names = [ordered]@{
      mysql=$lane.MysqlContainerName; redis=$lane.RedisContainerName
      database_migration=$lane.MigrationContainerName; server=$lane.ServerContainerName
      webapp=$lane.WebappContainerName; envoy=$lane.ProxyContainerName
      gotenberg=$lane.GotenbergContainerName
    }
    $containers = @()
    $images = @()
    $index = 0
    $workingDirectory = 'C:/sealed/easyfire-release'
    foreach ($service in @('mysql','redis','database_migration','server','webapp','envoy','gotenberg')) {
      $index++
      $mounts = @()
      $ports = @()
      if ($service -ceq 'mysql') { $mounts = @([pscustomobject]@{ Type='volume'; Source=$lane.MysqlVolumeName; Destination='/var/lib/mysql'; ReadWrite=$true }) }
      if ($service -ceq 'redis') { $mounts = @([pscustomobject]@{ Type='volume'; Source=$lane.RedisVolumeName; Destination='/data'; ReadWrite=$true }) }
      if ($service -ceq 'envoy') {
        $mounts = @([pscustomobject]@{ Type='bind'; Source=(Join-Path $workingDirectory 'docker/envoy/envoy.yaml'); Destination='/etc/envoy/envoy.yaml'; Mode='ro'; ReadWrite=$false })
        $ports = @([pscustomobject]@{ ContainerPort='80/tcp'; HostIp='127.0.0.1'; HostPort=([string]$lane.LoopbackPort) })
      }
      $reference = 'image-' + $service + ':test'
      $imageId = 'sha256:' + ([string]$index * 64)
      $containers += [pscustomobject]@{ Id=([string]$index * 64); Name=$names[$service]; Project=$lane.ProjectName; Service=$service; ImageReference=$reference; ImageId=$imageId; AuthorityLabel=$lane.AuthorityLabel; ComposeWorkingDirectory=$workingDirectory; Mounts=$mounts; VolumeNames=@($mounts | Where-Object { $_.Type -ceq 'volume' } | ForEach-Object { $_.Source }); PortBindings=$ports; State='running' }
      $images += [pscustomobject]@{ Service=$service; ImageReference=$reference; ImageId=$imageId }
    }
    $inventory = [pscustomobject]@{
      Containers=$containers
      Volumes=@(
        [pscustomobject]@{ Name=$lane.MysqlVolumeName; Project=$lane.ProjectName; LogicalName='mysql'; AuthorityLabel=$lane.AuthorityLabel },
        [pscustomobject]@{ Name=$lane.RedisVolumeName; Project=$lane.ProjectName; LogicalName='redis'; AuthorityLabel=$lane.AuthorityLabel }
      )
      ReservedVolumeNames=@($lane.MysqlVolumeName,$lane.RedisVolumeName)
      ForeignVolumeConsumers=@()
    }
    $proof = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $lane -Inventory $inventory -ExpectedImages $images -ExpectedComposeWorkingDirectory $workingDirectory
    $mysqlInventory = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $mysqlInventory.Containers = @($mysqlInventory.Containers | Where-Object { $_.Service -ceq 'mysql' })
    $mysqlInventory.Volumes = @($mysqlInventory.Volumes | Where-Object { $_.LogicalName -ceq 'mysql' })
    $mysqlInventory.ReservedVolumeNames = @($lane.MysqlVolumeName)
    $mysqlProof = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $lane -Inventory $mysqlInventory -ExpectedImages $images -ExpectedComposeWorkingDirectory $workingDirectory -ExpectedServices @('mysql')
    function Test-Rejected([object]$CandidateInventory, [object[]]$CandidateImages) {
      try { $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $lane -Inventory $CandidateInventory -ExpectedImages $CandidateImages -ExpectedComposeWorkingDirectory $workingDirectory; return $false }
      catch { return $true }
    }
    $badLabel = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $badLabel.Containers[2].AuthorityLabel = 'foreign=true'
    $badMount = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $badMount.Containers[0].Mounts[0].Source = 'foreign_mysql'
    $extraMysqlBind = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $extraMysqlBind.Containers[0].Mounts += [pscustomobject]@{ Type='bind'; Source='C:/foreign'; Destination='/foreign'; Mode='rw'; ReadWrite=$true }
    $extraServerBind = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $extraServerBind.Containers[3].Mounts = @([pscustomobject]@{ Type='bind'; Source='C:/foreign'; Destination='/foreign'; Mode='ro'; ReadWrite=$false })
    $wrongEnvoyBind = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $wrongEnvoyBind.Containers[5].Mounts[0].Source = 'C:/foreign/envoy.yaml'
    $writableEnvoyBind = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $writableEnvoyBind.Containers[5].Mounts[0].ReadWrite = $true
    $extraEnvoyBind = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $extraEnvoyBind.Containers[5].Mounts += [pscustomobject]@{ Type='bind'; Source='C:/foreign'; Destination='/foreign'; Mode='ro'; ReadWrite=$false }
    $relativeEnvoyWorkingDirectory = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $relativeEnvoyWorkingDirectory.Containers[5].ComposeWorkingDirectory = 'relative/release'
    $coordinatedEnvoyDrift = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $coordinatedEnvoyDrift.Containers[5].ComposeWorkingDirectory = 'C:/foreign/release'
    $coordinatedEnvoyDrift.Containers[5].Mounts[0].Source = 'C:/foreign/release/docker/envoy/envoy.yaml'
    $serverPort = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $serverPort.Containers[3].PortBindings = @([pscustomobject]@{ ContainerPort='3000/tcp'; HostIp='127.0.0.1'; HostPort='3000' })
    $wrongEnvoyPort = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $wrongEnvoyPort.Containers[5].PortBindings[0].HostIp = '0.0.0.0'
    $extraEnvoyPort = $inventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $extraEnvoyPort.Containers[5].PortBindings += [pscustomobject]@{ ContainerPort='443/tcp'; HostIp='127.0.0.1'; HostPort='443' }
    $badImage = $images | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $badImage[4].ImageId = 'sha256:' + ('f' * 64)
    $extraStageVolume = $mysqlInventory | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $extraStageVolume.Volumes = @($inventory.Volumes)
    $extraStageRejected = $false
    try { $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $lane -Inventory $extraStageVolume -ExpectedImages $images -ExpectedComposeWorkingDirectory $workingDirectory -ExpectedServices @('mysql') }
    catch { $extraStageRejected = $true }
    [pscustomobject]@{
      ServiceCount=@($proof.Containers).Count
      VolumeCount=@($proof.Volumes).Count
      MysqlServiceCount=@($mysqlProof.Containers).Count
      MysqlVolumeCount=@($mysqlProof.Volumes).Count
      LabelRejected=(Test-Rejected $badLabel $images)
      MountRejected=(Test-Rejected $badMount $images)
      ExtraMysqlBindRejected=(Test-Rejected $extraMysqlBind $images)
      ExtraServerBindRejected=(Test-Rejected $extraServerBind $images)
      WrongEnvoyBindRejected=(Test-Rejected $wrongEnvoyBind $images)
      WritableEnvoyBindRejected=(Test-Rejected $writableEnvoyBind $images)
      ExtraEnvoyBindRejected=(Test-Rejected $extraEnvoyBind $images)
      RelativeEnvoyWorkingDirectoryRejected=(Test-Rejected $relativeEnvoyWorkingDirectory $images)
      CoordinatedEnvoyDriftRejected=(Test-Rejected $coordinatedEnvoyDrift $images)
      ServerPortRejected=(Test-Rejected $serverPort $images)
      WrongEnvoyPortRejected=(Test-Rejected $wrongEnvoyPort $images)
      ExtraEnvoyPortRejected=(Test-Rejected $extraEnvoyPort $images)
      ImageRejected=(Test-Rejected $inventory $badImage)
      ExtraStageVolumeRejected=$extraStageRejected
    } | ConvertTo-Json -Compress
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    ServiceCount: 7,
    VolumeCount: 2,
    MysqlServiceCount: 1,
    MysqlVolumeCount: 1,
    LabelRejected: true,
    MountRejected: true,
    ExtraMysqlBindRejected: true,
    ExtraServerBindRejected: true,
    WrongEnvoyBindRejected: true,
    WritableEnvoyBindRejected: true,
    ExtraEnvoyBindRejected: true,
    RelativeEnvoyWorkingDirectoryRejected: true,
    CoordinatedEnvoyDriftRejected: true,
    ServerPortRejected: true,
    WrongEnvoyPortRejected: true,
    ExtraEnvoyPortRejected: true,
    ImageRejected: true,
    ExtraStageVolumeRejected: true,
  });
});

test("stage executors validate exact stopped identities before every first start", () => {
  const source = readFileSync(modulePath, "utf8");
  const assertions = (body) => [
    ...body.matchAll(/Assert-EasyFireMigrationCandidateRuntimeAuthority/g),
  ].map((match) => match.index);

  const mysql = powerShellFunction(source, "Start-EasyFireMigrationMysql");
  const mysqlChecks = assertions(mysql);
  assert.match(mysql, /\$ExpectedImages/);
  assert.match(mysql, /\$ExpectedComposeWorkingDirectory/);
  assert.equal(
    mysql.match(/-ExpectedComposeWorkingDirectory\s+\$ExpectedComposeWorkingDirectory/g)
      ?.length,
    2,
  );
  assert.match(mysql, /Arguments\s+@\('create'/);
  assert.equal(mysqlChecks.length, 2);
  assert.ok(mysql.indexOf("@('create'") < mysqlChecks[0]);
  assert.ok(mysqlChecks[0] < mysql.indexOf("@('start'"));
  assert.ok(mysql.indexOf("@('start'") < mysqlChecks[1]);
  assert.doesNotMatch(mysql, /Arguments\s+@\('up'/);

  const redis = powerShellFunction(
    source,
    "Import-EasyFireMigrationRedisSnapshot",
  );
  const redisChecks = assertions(redis);
  assert.match(redis, /\$ExpectedImages/);
  assert.match(redis, /\$ExpectedComposeWorkingDirectory/);
  assert.equal(
    redis.match(/-ExpectedComposeWorkingDirectory\s+\$ExpectedComposeWorkingDirectory/g)
      ?.length,
    2,
  );
  assert.equal(redisChecks.length, 2);
  assert.ok(redis.indexOf("@('create'") < redisChecks[0]);
  assert.ok(redisChecks[0] < redis.indexOf("@('cp'"));
  assert.ok(redis.indexOf("@('start'") < redisChecks[1]);

  const copyRedis = powerShellFunction(
    source,
    "Copy-EasyFireMigrationRedisSnapshot",
  );
  assert.match(copyRedis, /\[Parameter\(Mandatory\s*=\s*\$true\)\]\[object\[\]\]\$ExpectedImages/);
  assert.match(
    copyRedis,
    /\[Parameter\(Mandatory\s*=\s*\$true\)\]\[string\]\$ExpectedComposeWorkingDirectory/,
  );
  assert.match(
    copyRedis,
    /Import-EasyFireMigrationRedisSnapshot[\s\S]*-ExpectedImages\s+\$ExpectedImages/,
  );
  assert.match(
    copyRedis,
    /Import-EasyFireMigrationRedisSnapshot[\s\S]*-ExpectedComposeWorkingDirectory\s+\$ExpectedComposeWorkingDirectory/,
  );

  const migration = powerShellFunction(
    source,
    "Start-EasyFireMigrationDatabaseMigrationOnce",
  );
  const migrationChecks = assertions(migration);
  assert.match(migration, /\$ExpectedImages/);
  assert.match(migration, /\$ExpectedComposeWorkingDirectory/);
  assert.equal(
    migration.match(/-ExpectedComposeWorkingDirectory\s+\$ExpectedComposeWorkingDirectory/g)
      ?.length,
    2,
  );
  assert.equal(migrationChecks.length, 2);
  assert.ok(migration.indexOf("@('create'") < migrationChecks[0]);
  assert.ok(migrationChecks[0] < migration.indexOf("@('start'"));
  assert.ok(migration.indexOf("Condition ExitedZero") < migrationChecks[1]);

  const app = powerShellFunction(
    source,
    "Start-EasyFireMigrationApplicationTier",
  );
  const appChecks = assertions(app);
  assert.match(app, /\$ExpectedImages/);
  assert.match(app, /\$ExpectedComposeWorkingDirectory/);
  assert.equal(
    app.match(/-ExpectedComposeWorkingDirectory\s+\$ExpectedComposeWorkingDirectory/g)
      ?.length,
    2,
  );
  assert.match(
    app,
    /Arguments\s+@\('create',[\s\S]*'server',[\s\S]*'webapp',[\s\S]*'gotenberg',[\s\S]*'envoy'/,
  );
  assert.equal(appChecks.length, 2);
  assert.ok(app.indexOf("@('create'") < appChecks[0]);
  assert.ok(appChecks[0] < app.indexOf("@('start'"));
  assert.ok(app.indexOf("Condition Healthy") < appChecks[1]);
  assert.doesNotMatch(app, /Arguments\s+@\('up'/);
});

test("Redis continuity gates on exact RDB bytes and structural integrity, not expiring key equality", () => {
  const source = readFileSync(modulePath, "utf8");
  assert.match(source, /redis-check-rdb/);
  assert.match(source, /SourceObservedKeyCount/);
  assert.match(source, /CandidateObservedKeyCount/);
  assert.doesNotMatch(source, /key count does not match/i);
  assert.doesNotMatch(
    source,
    /(?:Expected|SourceObserved)KeyCount[^\r\n]*(?:-ne|-eq)[^\r\n]*(?:count|KeyCount)/i,
  );
});

test("lane stop safely accepts every partial count and quiesces running, restarting, and paused containers", () => {
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $module = Get-Module | Where-Object { $_.Path -ceq ${quote(modulePath)} }
    & $module {
      $lane = New-EasyFireMigrationRuntimeLane -MigrationId 'd1722b19-1ca2-46b5-a040-0e303e6fd13f' -Lane Rehearsal
      $names = [ordered]@{ mysql=$lane.MysqlContainerName; redis=$lane.RedisContainerName; database_migration=$lane.MigrationContainerName; server=$lane.ServerContainerName; webapp=$lane.WebappContainerName; envoy=$lane.ProxyContainerName; gotenberg=$lane.GotenbergContainerName }
      $services = @('mysql','redis','database_migration','server','webapp','envoy','gotenberg')
      $states = @('running','restarting','paused','exited','running','restarting','paused')
      $results = foreach ($count in 0..7) {
        $index = 0
        $initial = @($services | Select-Object -First $count | ForEach-Object {
          $index++
          $state = $states[$index - 1]
          [pscustomobject]@{ Id=([string]$index * 64); Name=$names[$_]; Project=$lane.ProjectName; Service=$_; AuthorityLabel=$lane.AuthorityLabel; State=$state }
        })
        $after = @($initial | ForEach-Object { [pscustomobject]@{ Id=$_.Id; Name=$_.Name; Project=$_.Project; Service=$_.Service; AuthorityLabel=$_.AuthorityLabel; State='exited' } })
        $script:RuntimeNamedReads = @($initial,$after)
        $script:RuntimeNamedReadIndex = 0
        $script:RuntimeNativeOperations = @()
        function script:Get-EasyFireMigrationNamedLaneContainers {
          param($Lane)
          $value = @($script:RuntimeNamedReads[$script:RuntimeNamedReadIndex])
          $script:RuntimeNamedReadIndex++
          return $value
        }
        function script:Invoke-EasyFireNative {
          param($FilePath,$ArgumentList)
          if ($FilePath -cne 'docker' -or [string]$ArgumentList[0] -cnotin @('stop','unpause')) { throw 'Unexpected native stop test call.' }
          $script:RuntimeNativeOperations += [pscustomobject]@{ Command=[string]$ArgumentList[0]; Id=[string]$ArgumentList[-1] }
          return [pscustomobject]@{ Output=@(); Text='' }
        }
        $readback = Stop-EasyFireMigrationLaneContainers -Lane $lane
        [pscustomobject]@{
          ContainerCount=$count
          StopCount=@($script:RuntimeNativeOperations | Where-Object { $_.Command -ceq 'stop' }).Count
          UnpauseCount=@($script:RuntimeNativeOperations | Where-Object { $_.Command -ceq 'unpause' }).Count
          ReadbackCount=@($readback.Containers).Count
          UnsafeReadbackCount=@($readback.Containers | Where-Object { $_.State -cnotin @('created','exited','dead') }).Count
        }
      }
      @($results) | ConvertTo-Json -Compress
    }
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), [
    { ContainerCount: 0, StopCount: 0, UnpauseCount: 0, ReadbackCount: 0, UnsafeReadbackCount: 0 },
    { ContainerCount: 1, StopCount: 1, UnpauseCount: 0, ReadbackCount: 1, UnsafeReadbackCount: 0 },
    { ContainerCount: 2, StopCount: 2, UnpauseCount: 0, ReadbackCount: 2, UnsafeReadbackCount: 0 },
    { ContainerCount: 3, StopCount: 3, UnpauseCount: 1, ReadbackCount: 3, UnsafeReadbackCount: 0 },
    { ContainerCount: 4, StopCount: 3, UnpauseCount: 1, ReadbackCount: 4, UnsafeReadbackCount: 0 },
    { ContainerCount: 5, StopCount: 4, UnpauseCount: 1, ReadbackCount: 5, UnsafeReadbackCount: 0 },
    { ContainerCount: 6, StopCount: 5, UnpauseCount: 1, ReadbackCount: 6, UnsafeReadbackCount: 0 },
    { ContainerCount: 7, StopCount: 6, UnpauseCount: 2, ReadbackCount: 7, UnsafeReadbackCount: 0 },
  ]);
});

test("lane stop validates before mutation, propagates native failure, and rejects unsafe readback", () => {
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $module = Get-Module | Where-Object { $_.Path -ceq ${quote(modulePath)} }
    & $module {
      $lane = New-EasyFireMigrationRuntimeLane -MigrationId 'd1722b19-1ca2-46b5-a040-0e303e6fd13f' -Lane Rehearsal
      $valid = [pscustomobject]@{ Id=('a' * 64); Name=$lane.MysqlContainerName; Project=$lane.ProjectName; Service='mysql'; AuthorityLabel=$lane.AuthorityLabel; State='restarting' }
      $foreign = [pscustomobject]@{ Id=('b' * 64); Name=$lane.ServerContainerName; Project='foreign-project'; Service='server'; AuthorityLabel='foreign=true'; State='running' }
      $script:RuntimeNativeCalls = @()
      $script:RuntimeFailStop = $false
      function script:Invoke-EasyFireNative {
        param($FilePath,$ArgumentList)
        $script:RuntimeNativeCalls += ,@($ArgumentList)
        if ($script:RuntimeFailStop -and [string]$ArgumentList[0] -ceq 'stop') { throw 'simulated exact stop failure' }
        [pscustomobject]@{ Output=@(); Text='' }
      }

      $script:RuntimeNamedMode = 'foreign'
      $script:RuntimeNamedReadIndex = 0
      function script:Get-EasyFireMigrationNamedLaneContainers {
        param($Lane)
        $script:RuntimeNamedReadIndex++
        if ($script:RuntimeNamedMode -ceq 'foreign') { return @($valid,$foreign) }
        if ($script:RuntimeNamedMode -ceq 'paused-readback' -and $script:RuntimeNamedReadIndex -eq 2) {
          return @([pscustomobject]@{ Id=$valid.Id; Name=$valid.Name; Project=$valid.Project; Service=$valid.Service; AuthorityLabel=$valid.AuthorityLabel; State='paused' })
        }
        return @($valid)
      }
      $foreignMessage = ''
      try { $null = Stop-EasyFireMigrationLaneContainers -Lane $lane }
      catch { $foreignMessage = $_.Exception.Message }
      $callsBeforeFailureCase = @($script:RuntimeNativeCalls).Count

      $script:RuntimeNamedMode = 'native-failure'
      $script:RuntimeNamedReadIndex = 0
      $script:RuntimeNativeCalls = @()
      $script:RuntimeFailStop = $true
      $nativeMessage = ''
      try { $null = Stop-EasyFireMigrationLaneContainers -Lane $lane }
      catch { $nativeMessage = $_.Exception.Message }
      $nativeCallCount = @($script:RuntimeNativeCalls).Count

      $script:RuntimeNamedMode = 'paused-readback'
      $script:RuntimeNamedReadIndex = 0
      $script:RuntimeNativeCalls = @()
      $script:RuntimeFailStop = $false
      $pausedMessage = ''
      try { $null = Stop-EasyFireMigrationLaneContainers -Lane $lane }
      catch { $pausedMessage = $_.Exception.Message }
      [pscustomobject]@{
        ForeignMessage=$foreignMessage
        ForeignNativeCallCount=$callsBeforeFailureCase
        NativeMessage=$nativeMessage
        NativeCallCount=$nativeCallCount
        PausedMessage=$pausedMessage
        PausedStopCount=@($script:RuntimeNativeCalls | Where-Object { [string]$_[0] -ceq 'stop' }).Count
      } | ConvertTo-Json -Compress
    }
  `);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.match(value.ForeignMessage, /identity.*invalid|authority.*invalid/i);
  assert.equal(value.ForeignNativeCallCount, 0);
  assert.match(value.NativeMessage, /simulated exact stop failure/i);
  assert.match(value.PausedMessage, /non-running|zero running/i);
  assert.equal(value.PausedStopCount, 1);
});

test("execution contracts preserve the required proof order and automatic rollback boundary", () => {
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    [pscustomobject]@{
      Rehearsal = @(Get-EasyFireMigrationExecutionContract -Lane Rehearsal)
      Cutover = @(Get-EasyFireMigrationExecutionContract -Lane Cutover)
      Rollback = @(Get-EasyFireMigrationExecutionContract -Lane Rollback)
    } | ConvertTo-Json -Depth 8 -Compress
  `);
  assert.equal(result.status, 0, result.stderr);
  const contract = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(contract.Rehearsal, [
    "VerifySourceAuthority",
    "VerifyInitialBackupRestore",
    "VerifyFreshLanePreflight",
    "CreateLaneVolumes",
    "RenderLaneEnvironment",
    "StartMysql",
    "ImportMysql",
    "StartRedis",
    "CopyRedisSnapshot",
    "RunDatabaseMigrationOnce",
    "StartApplicationTier",
    "BindExactCandidateRuntimeAuthority",
    "VerifyCandidateHealth",
    "AwaitNativeAuthentication",
    "StopExactRehearsalContainers",
    "RehearseSourceRecovery",
    "VerifySourceUnchanged",
  ]);
  assert.deepEqual(contract.Cutover, [
    "AcquireMigrationMutex",
    "PauseIngress",
    "FenceScheduledBackup",
    "FreezeExactSourceApplicationTier",
    "CreateFinalSourceBackup",
    "VerifyFinalSourceBackupRestore",
    "FreezeSourceDataTier",
    "VerifyFreshLanePreflight",
    "CreateCutoverVolumes",
    "StartCutoverMysql",
    "ImportFinalMysql",
    "CopyFinalRedisSnapshot",
    "RunDatabaseMigrationOnce",
    "StartCutoverApplicationTier",
    "BindExactCandidateRuntimeAuthority",
    "VerifyCutoverHealth",
    "CreateCandidateBaselineBackup",
    "VerifyCandidateBaselineRestore",
    "RepairBackupTask",
    "RetireStartupTask",
    "StartAndVerifyIngress",
    "PublishCompletedLast",
  ]);
  assert.deepEqual(contract.Rollback, [
    "CreateEmergencyBackupWhenCompleted",
    "VerifyEmergencyBackupRestoreWhenCompleted",
    "StopExactCutoverContainers",
    "RestoreExactTaskXml",
    "StartExactSourceDataTier",
    "StartExactSourceApplicationTier",
    "RestoreIngressPreState",
    "VerifySourceRecovery",
    "PublishRolledBack",
  ]);
});

test("source inventory rejects duplicate services, foreign projects, and source volume drift", () => {
  const good = {
    ProjectName: "easyfire-bookkeeping-prod",
    MysqlVolumeName: "easyfire_prod_mysql",
    RedisVolumeName: "easyfire_prod_redis",
    Containers: [
      ["mysql", "a"],
      ["redis", "b"],
      ["server", "c"],
      ["webapp", "d"],
      ["envoy", "e"],
      ["gotenberg", "f"],
      ["database_migration", "1"],
    ].map(([Service, token]) => ({
      Service,
      ContainerId: token.repeat(64),
      ProjectName: "easyfire-bookkeeping-prod",
    })),
  };
  const cases = [
    good,
    { ...good, ProjectName: "foreign" },
    { ...good, MysqlVolumeName: "wrong" },
    { ...good, Containers: [...good.Containers, good.Containers[0]] },
  ];
  const encoded = Buffer.from(JSON.stringify(cases), "utf8").toString("base64");
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $cases = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
    $results = foreach ($item in $cases) {
      try {
        Assert-EasyFireMigrationSourceInventory -Inventory $item -ExpectedProjectName 'easyfire-bookkeeping-prod' -ExpectedMysqlVolumeName 'easyfire_prod_mysql' -ExpectedRedisVolumeName 'easyfire_prod_redis'
        $true
      } catch { $false }
    }
    @($results) | ConvertTo-Json -Compress
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), [
    true,
    false,
    false,
    false,
  ]);
});

test("lane inventory and durable-volume fingerprints are exported and deterministic", () => {
  const result = ps(`
    Import-Module ${quote(modulePath)} -Force
    $inventory = [pscustomobject]@{
      Containers = @([pscustomobject]@{ Id=('a' * 64); Name='mysql'; Project='lane'; Service='mysql'; ComposeConfigHash='c'; ComposeOneOff='False'; ImageReference='db:test'; ImageId=('sha256:' + ('b' * 64)); RestartPolicy='unless-stopped'; RestartMaximumRetryCount=0; Mounts=@(); Networks=@(); PortBindings=@() })
      Networks = @()
      Volumes = @([pscustomobject]@{ Name='lane_mysql'; CreatedAt='2026-07-20T00:00:00Z'; Driver='local'; Scope='local'; Project='lane'; LogicalName='mysql'; Options=@() })
      ReservedVolumeNames = @('lane_mysql')
      ForeignVolumeConsumers = @()
    }
    [pscustomobject]@{
      Inventory1 = Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $inventory
      Inventory2 = Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $inventory
      Volumes1 = Get-EasyFireMigrationLaneVolumeFingerprint -Volumes $inventory.Volumes
      Volumes2 = Get-EasyFireMigrationLaneVolumeFingerprint -Volumes $inventory.Volumes
    } | ConvertTo-Json -Compress
  `);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.match(value.Inventory1, /^[A-F0-9]{64}$/);
  assert.match(value.Volumes1, /^[A-F0-9]{64}$/);
  assert.equal(value.Inventory1, value.Inventory2);
  assert.equal(value.Volumes1, value.Volumes2);
});
