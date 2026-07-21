import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const restoreVerifierPath = resolve(
  root,
  "scripts/production/restore-verify.ps1",
);
const scheduledBackupPath = resolve(
  root,
  "deploy/windows/migration-scheduled-backup.ps1",
);

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function ps(script) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );
}

const astLoader = String.raw`
function Get-EasyFireSelectedFunctionSource {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$Names
  )

  $tokens = $null
  $errors = $null
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $ast = [Management.Automation.Language.Parser]::ParseFile(
    $resolved,
    [ref]$tokens,
    [ref]$errors
  )
  if (@($errors).Count -ne 0) {
    throw "PowerShell source did not parse: $resolved"
  }
  $definitions = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst]
      }, $true))
  $source = foreach ($name in $Names) {
    $matches = @($definitions | Where-Object { [string]$_.Name -ceq $name })
    if ($matches.Count -ne 1) {
      throw "Expected one exact function definition: $name"
    }
    [string]$matches[0].Extent.Text
  }
  return ($source -join ([Environment]::NewLine + [Environment]::NewLine))
}
`;

test("MariaDB restore cleanup validates exact disposable authority before ordered removal", () => {
  const result = ps(String.raw`
    Set-StrictMode -Version 3.0
    $ErrorActionPreference = 'Stop'
    ${astLoader}
    $selected = Get-EasyFireSelectedFunctionSource -Path ${quote(restoreVerifierPath)} -Names @(
      'Get-EasyFireRestoreProperty',
      'Get-EasyFireRestoreContainer',
      'Get-EasyFireRestoreVolume',
      'Assert-EasyFireRestoreLabels',
      'Assert-EasyFireRestoreContainer',
      'Assert-EasyFireRestoreVolume',
      'Remove-EasyFireRestoreResources'
    )
    Invoke-Expression $selected

    $script:MariaDbImage = 'easyfire-bookkeeping/mariadb:test'
    $authority = [pscustomobject][ordered]@{
      ActionId = '11111111-1111-4111-8111-111111111111'
      BackupOperationId = '22222222-2222-4222-8222-222222222222'
      AuthorityToken = 'authority-token'
      ProofId = 'proof-token'
      MigrationId = '33333333-3333-4333-8333-333333333333'
      ContainerName = 'easyfire-restore-proof'
      VolumeName = 'easyfire_restore_proof'
    }
    function New-RestoreLabels {
      [pscustomobject][ordered]@{
        'easyfire.restore.action.id' = [string]$authority.ActionId
        'easyfire.restore.backup.operation.id' = [string]$authority.BackupOperationId
        'easyfire.restore.authority' = [string]$authority.AuthorityToken
        'easyfire.restore.role' = 'restore-verify'
        'easyfire.proof.id' = [string]$authority.ProofId
        'easyfire.restore.migration.id' = [string]$authority.MigrationId
      }
    }
    function New-RestoreContainer {
      [pscustomobject][ordered]@{
        Id = ('a' * 64)
        Name = "/$([string]$authority.ContainerName)"
        Config = [pscustomobject][ordered]@{
          Image = [string]$script:MariaDbImage
          Labels = New-RestoreLabels
        }
        HostConfig = [pscustomobject][ordered]@{
          NetworkMode = 'none'
          PortBindings = $null
        }
        Mounts = @([pscustomobject][ordered]@{
            Type = 'volume'
            Name = [string]$authority.VolumeName
            Destination = '/var/lib/mysql'
          })
      }
    }
    function New-RestoreVolume {
      [pscustomobject][ordered]@{
        Name = [string]$authority.VolumeName
        Driver = 'local'
        Scope = 'local'
        Labels = New-RestoreLabels
      }
    }
    function Copy-TestObject {
      param($Value)
      if ($null -eq $Value) { return $null }
      return ($Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json)
    }

    function docker {
      $parts = @($args | ForEach-Object { [string]$_ })
      $script:Calls += ('docker|' + ($parts -join '|'))
      if ($parts.Count -eq 5 -and $parts[0] -ceq 'container' -and
          $parts[1] -ceq 'inspect' -and
          $parts[2] -ceq [string]$authority.ContainerName -and
          $parts[3] -ceq '--format' -and $parts[4] -ceq '{{json .}}') {
        if ($null -eq $script:Container) {
          $global:LASTEXITCODE = 1
          return "Error: No such container: $([string]$authority.ContainerName)"
        }
        $global:LASTEXITCODE = 0
        return ($script:Container | ConvertTo-Json -Depth 20 -Compress)
      }
      if ($parts.Count -eq 5 -and $parts[0] -ceq 'volume' -and
          $parts[1] -ceq 'inspect' -and
          $parts[2] -ceq [string]$authority.VolumeName -and
          $parts[3] -ceq '--format' -and $parts[4] -ceq '{{json .}}') {
        if ($null -eq $script:Volume) {
          $global:LASTEXITCODE = 1
          return "Error: No such volume: $([string]$authority.VolumeName)"
        }
        $global:LASTEXITCODE = 0
        return ($script:Volume | ConvertTo-Json -Depth 20 -Compress)
      }
      if ($parts.Count -eq 3 -and $parts[0] -ceq 'rm' -and $parts[1] -ceq '-f') {
        $global:LASTEXITCODE = if ($script:FailContainerRemoval) { 1 } else { 0 }
        return
      }
      if ($parts.Count -eq 3 -and $parts[0] -ceq 'volume' -and $parts[1] -ceq 'rm') {
        $global:LASTEXITCODE = 0
        return
      }
      throw ('Cleanup attempted an unauthorized Docker command: ' + ($parts -join ' '))
    }
    function Invoke-RestoreCleanupCase {
      param($Container, $Volume, [bool]$FailContainerRemoval = $false)
      $script:Container = $Container
      $script:Volume = $Volume
      $script:FailContainerRemoval = $FailContainerRemoval
      $script:Calls = @()
      $message = ''
      try { Remove-EasyFireRestoreResources -Authority $authority }
      catch { $message = $_.Exception.Message }
      return [pscustomobject][ordered]@{
        Succeeded = [string]::IsNullOrEmpty($message)
        Message = $message
        Calls = @($script:Calls)
        RemovalCalls = @($script:Calls | Where-Object {
            $_ -like 'docker|rm|*' -or $_ -like 'docker|volume|rm|*'
          })
      }
    }

    $goodContainer = New-RestoreContainer
    $goodVolume = New-RestoreVolume
    $good = Invoke-RestoreCleanupCase -Container $goodContainer -Volume $goodVolume
    $failedRemoval = Invoke-RestoreCleanupCase -Container $goodContainer -Volume $goodVolume -FailContainerRemoval $true

    $invalidContainers = [ordered]@{}
    $badLabels = Copy-TestObject $goodContainer
    $badLabels.Config.Labels.'easyfire.restore.authority' = 'foreign'
    $invalidContainers.Labels = Invoke-RestoreCleanupCase -Container $badLabels -Volume $goodVolume
    $badName = Copy-TestObject $goodContainer
    $badName.Name = '/foreign-container'
    $invalidContainers.Name = Invoke-RestoreCleanupCase -Container $badName -Volume $goodVolume
    $badId = Copy-TestObject $goodContainer
    $badId.Id = 'foreign-id'
    $invalidContainers.Id = Invoke-RestoreCleanupCase -Container $badId -Volume $goodVolume
    $badMount = Copy-TestObject $goodContainer
    $badMount.Mounts[0].Name = 'foreign-volume'
    $invalidContainers.Mount = Invoke-RestoreCleanupCase -Container $badMount -Volume $goodVolume
    $badPort = Copy-TestObject $goodContainer
    $badPort.HostConfig.PortBindings = [pscustomobject]@{
      '3306/tcp' = @([pscustomobject]@{ HostIp='127.0.0.1'; HostPort='3306' })
    }
    $invalidContainers.HostPort = Invoke-RestoreCleanupCase -Container $badPort -Volume $goodVolume

    $invalidVolumes = [ordered]@{}
    $badVolumeLabels = Copy-TestObject $goodVolume
    $badVolumeLabels.Labels.'easyfire.restore.authority' = 'foreign'
    $invalidVolumes.Labels = Invoke-RestoreCleanupCase -Container $null -Volume $badVolumeLabels
    $badVolumeName = Copy-TestObject $goodVolume
    $badVolumeName.Name = 'foreign-volume'
    $invalidVolumes.Name = Invoke-RestoreCleanupCase -Container $null -Volume $badVolumeName

    [pscustomobject][ordered]@{
      Good = $good
      FailedContainerRemoval = $failedRemoval
      InvalidContainers = $invalidContainers
      InvalidVolumes = $invalidVolumes
    } | ConvertTo-Json -Depth 20 -Compress
  `);

  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  const id = "a".repeat(64);
  assert.equal(value.Good.Succeeded, true, JSON.stringify(value.Good));
  assert.deepEqual(value.Good.Calls, [
    "docker|container|inspect|easyfire-restore-proof|--format|{{json .}}",
    `docker|rm|-f|${id}`,
    "docker|volume|inspect|easyfire_restore_proof|--format|{{json .}}",
    "docker|volume|rm|easyfire_restore_proof",
  ]);
  assert.equal(value.FailedContainerRemoval.Succeeded, false);
  assert.deepEqual(value.FailedContainerRemoval.Calls, [
    "docker|container|inspect|easyfire-restore-proof|--format|{{json .}}",
    `docker|rm|-f|${id}`,
  ]);
  for (const outcome of Object.values(value.InvalidContainers)) {
    assert.equal(outcome.Succeeded, false, JSON.stringify(outcome));
    assert.deepEqual(outcome.RemovalCalls, []);
  }
  for (const outcome of Object.values(value.InvalidVolumes)) {
    assert.equal(outcome.Succeeded, false, JSON.stringify(outcome));
    assert.deepEqual(outcome.RemovalCalls, []);
  }
  for (const call of value.Good.Calls) {
    assert.doesNotMatch(call, /(?:^|\|)-v(?:\||$)/);
    assert.doesNotMatch(call, /\|(?:ps|ls)(?:\||$)/);
  }
});

test("scheduled Redis cleanup validates exact disposable authority before ordered removal", () => {
  const result = ps(String.raw`
    Set-StrictMode -Version 3.0
    $ErrorActionPreference = 'Stop'
    ${astLoader}
    $selected = Get-EasyFireSelectedFunctionSource -Path ${quote(scheduledBackupPath)} -Names @(
      'Get-EasyFireMigrationBackupDockerObject',
      'Assert-EasyFireMigrationRedisVerifierLabels',
      'Remove-EasyFireMigrationRedisVerifier'
    )
    Invoke-Expression $selected

    $authorityToken = 'redis-authority-token'
    $plan = [pscustomobject][ordered]@{
      BackupOperationId = '44444444-4444-4444-8444-444444444444'
      RuntimeAuthority = [pscustomobject][ordered]@{
        MigrationId = '55555555-5555-4555-8555-555555555555'
        Redis = [pscustomobject][ordered]@{
          ImageId = ('sha256:' + ('c' * 64))
        }
      }
      RedisPublication = [pscustomobject][ordered]@{
        VerifierContainerName = 'easyfire-redis-restore-proof'
        VerifierVolumeName = 'easyfire_redis_restore_proof'
      }
    }
    function New-RedisLabels {
      [pscustomobject][ordered]@{
        'easyfire.restore.migration.id' = [string]$plan.RuntimeAuthority.MigrationId
        'easyfire.restore.backup.operation.id' = [string]$plan.BackupOperationId
        'easyfire.restore.authority' = $authorityToken
        'easyfire.restore.role' = 'redis-restore-verify'
      }
    }
    function New-RedisContainer {
      [pscustomobject][ordered]@{
        Id = ('b' * 64)
        Name = "/$([string]$plan.RedisPublication.VerifierContainerName)"
        Image = [string]$plan.RuntimeAuthority.Redis.ImageId
        Config = [pscustomobject][ordered]@{ Labels = New-RedisLabels }
        HostConfig = [pscustomobject][ordered]@{
          NetworkMode = 'none'
          PortBindings = $null
        }
        Mounts = @([pscustomobject][ordered]@{
            Type = 'volume'
            Name = [string]$plan.RedisPublication.VerifierVolumeName
            Destination = '/data'
          })
      }
    }
    function New-RedisVolume {
      [pscustomobject][ordered]@{
        Name = [string]$plan.RedisPublication.VerifierVolumeName
        Driver = 'local'
        Scope = 'local'
        Labels = New-RedisLabels
      }
    }
    function Copy-TestObject {
      param($Value)
      if ($null -eq $Value) { return $null }
      return ($Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json)
    }

    function docker {
      $parts = @($args | ForEach-Object { [string]$_ })
      $script:Calls += ('docker|' + ($parts -join '|'))
      if ($parts.Count -eq 2 -and $parts[0] -ceq 'inspect' -and
          ($parts[1] -ceq [string]$plan.RedisPublication.VerifierContainerName -or
           ($null -ne $script:Container -and $parts[1] -ceq [string]$script:Container.Id))) {
        if ($null -eq $script:Container) {
          $global:LASTEXITCODE = 1
          return
        }
        $global:LASTEXITCODE = 0
        return ($script:Container | ConvertTo-Json -Depth 20 -Compress)
      }
      if ($parts.Count -eq 3 -and $parts[0] -ceq 'volume' -and
          $parts[1] -ceq 'inspect' -and
          $parts[2] -ceq [string]$plan.RedisPublication.VerifierVolumeName) {
        if ($null -eq $script:Volume) {
          $global:LASTEXITCODE = 1
          return
        }
        $global:LASTEXITCODE = 0
        return ($script:Volume | ConvertTo-Json -Depth 20 -Compress)
      }
      throw ('Cleanup attempted an unauthorized Docker inspection: ' + ($parts -join ' '))
    }
    function Invoke-EasyFireNative {
      param([string]$FilePath, [string[]]$ArgumentList)
      if ($FilePath -cne 'docker') { throw 'Cleanup requested a non-Docker executable.' }
      $parts = @($ArgumentList | ForEach-Object { [string]$_ })
      $script:Calls += ('native|docker|' + ($parts -join '|'))
      if ($parts.Count -eq 3 -and $parts[0] -ceq 'rm' -and $parts[1] -ceq '-f') {
        if ($script:FailContainerRemoval) { throw 'Synthetic exact container removal failure.' }
        return [pscustomobject]@{ Output=@(); Text='' }
      }
      if ($parts.Count -eq 3 -and $parts[0] -ceq 'volume' -and $parts[1] -ceq 'rm') {
        return [pscustomobject]@{ Output=@(); Text='' }
      }
      throw ('Cleanup attempted an unauthorized Docker command: ' + ($parts -join ' '))
    }
    function Invoke-RedisCleanupCase {
      param($Container, $Volume, [bool]$FailContainerRemoval = $false)
      $script:Container = $Container
      $script:Volume = $Volume
      $script:FailContainerRemoval = $FailContainerRemoval
      $script:Calls = @()
      $message = ''
      try {
        Remove-EasyFireMigrationRedisVerifier -Plan $plan -AuthorityToken $authorityToken
      } catch { $message = $_.Exception.Message }
      return [pscustomobject][ordered]@{
        Succeeded = [string]::IsNullOrEmpty($message)
        Message = $message
        Calls = @($script:Calls)
        RemovalCalls = @($script:Calls | Where-Object { $_ -like 'native|docker|*' })
      }
    }

    $goodContainer = New-RedisContainer
    $goodVolume = New-RedisVolume
    $good = Invoke-RedisCleanupCase -Container $goodContainer -Volume $goodVolume
    $failedRemoval = Invoke-RedisCleanupCase -Container $goodContainer -Volume $goodVolume -FailContainerRemoval $true

    $invalidContainers = [ordered]@{}
    $badLabels = Copy-TestObject $goodContainer
    $badLabels.Config.Labels.'easyfire.restore.authority' = 'foreign'
    $invalidContainers.Labels = Invoke-RedisCleanupCase -Container $badLabels -Volume $goodVolume
    $badName = Copy-TestObject $goodContainer
    $badName.Name = '/foreign-container'
    $invalidContainers.Name = Invoke-RedisCleanupCase -Container $badName -Volume $goodVolume
    $badId = Copy-TestObject $goodContainer
    $badId.Id = 'foreign-id'
    $invalidContainers.Id = Invoke-RedisCleanupCase -Container $badId -Volume $goodVolume
    $badMount = Copy-TestObject $goodContainer
    $badMount.Mounts[0].Name = 'foreign-volume'
    $invalidContainers.Mount = Invoke-RedisCleanupCase -Container $badMount -Volume $goodVolume
    $badPort = Copy-TestObject $goodContainer
    $badPort.HostConfig.PortBindings = [pscustomobject]@{
      '6379/tcp' = @([pscustomobject]@{ HostIp='127.0.0.1'; HostPort='6379' })
    }
    $invalidContainers.HostPort = Invoke-RedisCleanupCase -Container $badPort -Volume $goodVolume

    $invalidVolumes = [ordered]@{}
    $badVolumeLabels = Copy-TestObject $goodVolume
    $badVolumeLabels.Labels.'easyfire.restore.authority' = 'foreign'
    $invalidVolumes.Labels = Invoke-RedisCleanupCase -Container $null -Volume $badVolumeLabels
    $badVolumeName = Copy-TestObject $goodVolume
    $badVolumeName.Name = 'foreign-volume'
    $invalidVolumes.Name = Invoke-RedisCleanupCase -Container $null -Volume $badVolumeName

    [pscustomobject][ordered]@{
      Good = $good
      FailedContainerRemoval = $failedRemoval
      InvalidContainers = $invalidContainers
      InvalidVolumes = $invalidVolumes
    } | ConvertTo-Json -Depth 20 -Compress
  `);

  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  const id = "b".repeat(64);
  assert.equal(value.Good.Succeeded, true, JSON.stringify(value.Good));
  assert.deepEqual(value.Good.Calls, [
    "docker|inspect|easyfire-redis-restore-proof",
    `docker|inspect|${id}`,
    `native|docker|rm|-f|${id}`,
    "docker|volume|inspect|easyfire_redis_restore_proof",
    "native|docker|volume|rm|easyfire_redis_restore_proof",
  ]);
  assert.equal(value.FailedContainerRemoval.Succeeded, false);
  assert.deepEqual(value.FailedContainerRemoval.Calls, [
    "docker|inspect|easyfire-redis-restore-proof",
    `docker|inspect|${id}`,
    `native|docker|rm|-f|${id}`,
  ]);
  for (const outcome of Object.values(value.InvalidContainers)) {
    assert.equal(outcome.Succeeded, false, JSON.stringify(outcome));
    assert.deepEqual(outcome.RemovalCalls, []);
  }
  for (const outcome of Object.values(value.InvalidVolumes)) {
    assert.equal(outcome.Succeeded, false, JSON.stringify(outcome));
    assert.deepEqual(outcome.RemovalCalls, []);
  }
  for (const call of value.Good.Calls) {
    assert.doesNotMatch(call, /(?:^|\|)-v(?:\||$)/);
    assert.doesNotMatch(call, /\|(?:ps|ls)(?:\||$)/);
  }
});
