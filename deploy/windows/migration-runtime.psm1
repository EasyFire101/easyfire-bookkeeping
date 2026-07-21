Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'production-io.psm1') -Force -ErrorAction Stop

$script:MigrationServices = @(
    'mysql', 'redis', 'database_migration', 'server', 'webapp', 'envoy', 'gotenberg'
)
$script:MigrationApplicationServices = @('server', 'webapp', 'gotenberg', 'envoy')
$script:MigrationDataServices = @('mysql', 'redis')

function ConvertTo-EasyFireMigrationRuntimeId {
    param([Parameter(Mandatory = $true)][string]$MigrationId)

    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($MigrationId, 'D', [ref]$parsed)) {
        throw 'MigrationId must be a canonical lowercase GUID.'
    }
    $canonical = $parsed.ToString('D').ToLowerInvariant()
    if ($MigrationId -cne $canonical) {
        throw 'MigrationId must be a canonical lowercase GUID.'
    }
    return $canonical
}

function Get-EasyFireMigrationRuntimeProperty {
    param(
        $Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Get-EasyFireMigrationRuntimeTextSha256 {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
}

function Get-EasyFireMigrationRuntimeFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function New-EasyFireMigrationRuntimeLane {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$MigrationId,
        [Parameter(Mandatory = $true)][ValidateSet('Rehearsal', 'Cutover')][string]$Lane
    )

    $canonical = ConvertTo-EasyFireMigrationRuntimeId -MigrationId $MigrationId
    $token = $canonical.Replace('-', '').Substring(0, 12)
    $laneToken = if ($Lane -ceq 'Rehearsal') { 'r' } else { 'c' }
    $prefix = "easyfire-mig-$laneToken-$token"
    $port = if ($Lane -ceq 'Cutover') {
        80
    } else {
        24000 + ([Convert]::ToInt32($token.Substring(0, 4), 16) % 10000)
    }
    return [pscustomobject][ordered]@{
        Lane = $Lane
        ProjectName = "easyfire-bookkeeping-mig-$laneToken-$token"
        MysqlVolumeName = "easyfire_mig_${laneToken}_mysql_$token"
        RedisVolumeName = "easyfire_mig_${laneToken}_redis_$token"
        MysqlContainerName = "$prefix-mysql"
        RedisContainerName = "$prefix-redis"
        MigrationContainerName = "$prefix-database-migration"
        ServerContainerName = "$prefix-server"
        WebappContainerName = "$prefix-webapp"
        ProxyContainerName = "$prefix-envoy"
        GotenbergContainerName = "$prefix-gotenberg"
        LoopbackPort = $port
        AuthorityLabel = "easyfire.migration.$laneToken=$canonical"
    }
}

function New-EasyFireMigrationComposeOverride {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Lane)

    $values = @(
        [string]$Lane.ProxyContainerName,
        [string]$Lane.WebappContainerName,
        [string]$Lane.ServerContainerName,
        [string]$Lane.MigrationContainerName,
        [string]$Lane.MysqlContainerName,
        [string]$Lane.RedisContainerName,
        [string]$Lane.GotenbergContainerName
    )
    foreach ($value in $values) {
        if ($value -notmatch '^[a-z0-9][a-z0-9_.-]{0,127}$') {
            throw 'Lane contains an invalid container identity.'
        }
    }
    if ([string]$Lane.AuthorityLabel -notmatch '^easyfire\.migration\.[rc]=[a-f0-9-]{36}$') {
        throw 'Lane contains an invalid migration authority label.'
    }

    return @"
services:
  envoy:
    container_name: $($Lane.ProxyContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
    ports:
      - "127.0.0.1:`${PUBLIC_PROXY_PORT}:80"
  webapp:
    container_name: $($Lane.WebappContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
  server:
    container_name: $($Lane.ServerContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
  database_migration:
    container_name: $($Lane.MigrationContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
  mysql:
    container_name: $($Lane.MysqlContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
  redis:
    container_name: $($Lane.RedisContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
  gotenberg:
    container_name: $($Lane.GotenbergContainerName)
    labels:
      - "$($Lane.AuthorityLabel)"
volumes:
  mysql:
    name: `${MARIADB_VOLUME_NAME}
    labels:
      - "$($Lane.AuthorityLabel)"
  redis:
    name: `${REDIS_VOLUME_NAME}
    labels:
      - "$($Lane.AuthorityLabel)"
"@
}

function Get-EasyFireMigrationExpectedContainerNames {
    param([Parameter(Mandatory = $true)]$Lane)

    return [ordered]@{
        mysql = [string]$Lane.MysqlContainerName
        redis = [string]$Lane.RedisContainerName
        database_migration = [string]$Lane.MigrationContainerName
        server = [string]$Lane.ServerContainerName
        webapp = [string]$Lane.WebappContainerName
        envoy = [string]$Lane.ProxyContainerName
        gotenberg = [string]$Lane.GotenbergContainerName
    }
}

function Resolve-EasyFireMigrationExpectedServices {
    param([string[]]$ExpectedServices = $script:MigrationServices)

    if ($ExpectedServices.Count -lt 1) { throw 'ExpectedServices cannot be empty.' }
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($service in $ExpectedServices) {
        if ($service -cnotin $script:MigrationServices -or -not $seen.Add([string]$service)) {
            throw "ExpectedServices contains an invalid or duplicate service: $service"
        }
    }
    return @($script:MigrationServices | Where-Object { $seen.Contains($_) })
}

function Assert-EasyFireMigrationLaneServiceSet {
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)]$Inventory,
        [string[]]$ExpectedServices = $script:MigrationServices
    )

    $services = @(Resolve-EasyFireMigrationExpectedServices -ExpectedServices $ExpectedServices)
    $containers = @(Get-EasyFireMigrationRuntimeProperty $Inventory 'Containers' @())
    if ($containers.Count -ne $services.Count) {
        throw 'Candidate lane containers do not equal the exact expected stage.'
    }
    $expectedNames = Get-EasyFireMigrationExpectedContainerNames -Lane $Lane
    $ids = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($service in $services) {
        $matches = @($containers | Where-Object { [string]$_.Service -ceq $service })
        if ($matches.Count -ne 1) { throw "Candidate lane service is not unique: $service" }
        $item = $matches[0]
        $id = [string](Get-EasyFireMigrationRuntimeProperty $item 'Id' (
                Get-EasyFireMigrationRuntimeProperty $item 'ContainerId' ''
            ))
        $name = [string](Get-EasyFireMigrationRuntimeProperty $item 'Name' (
                Get-EasyFireMigrationRuntimeProperty $item 'ContainerName' ''
            ))
        $project = [string](Get-EasyFireMigrationRuntimeProperty $item 'Project' (
                Get-EasyFireMigrationRuntimeProperty $item 'ProjectName' ''
            ))
        if ($id -notmatch '^[a-f0-9]{64}$' -or -not $ids.Add($id) -or
            $name -cne [string]$expectedNames[$service] -or
            $project -cne [string]$Lane.ProjectName -or
            [string](Get-EasyFireMigrationRuntimeProperty $item 'AuthorityLabel' '') -cne
                [string]$Lane.AuthorityLabel) {
            throw "Candidate lane identity is invalid: $service"
        }
    }
    return $containers
}

function Assert-EasyFireMigrationLaneContainerSubset {
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [object[]]$Containers = @()
    )

    $items = @($Containers)
    if ($items.Count -gt $script:MigrationServices.Count) {
        throw 'Candidate lane contains more than the seven deterministic container identities.'
    }
    $expectedNames = Get-EasyFireMigrationExpectedContainerNames -Lane $Lane
    $seenIds = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $seenServices = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($item in $items) {
        $id = [string](Get-EasyFireMigrationRuntimeProperty $item 'Id' (
                Get-EasyFireMigrationRuntimeProperty $item 'ContainerId' ''
            ))
        $name = [string](Get-EasyFireMigrationRuntimeProperty $item 'Name' (
                Get-EasyFireMigrationRuntimeProperty $item 'ContainerName' ''
            ))
        $service = [string](Get-EasyFireMigrationRuntimeProperty $item 'Service' '')
        $project = [string](Get-EasyFireMigrationRuntimeProperty $item 'Project' (
                Get-EasyFireMigrationRuntimeProperty $item 'ProjectName' ''
            ))
        $state = [string](Get-EasyFireMigrationRuntimeProperty $item 'State' '')
        if ($service -cnotin $script:MigrationServices -or
            $name -cne [string]$expectedNames[$service] -or
            $id -notmatch '^[a-f0-9]{64}$' -or
            -not $seenIds.Add($id) -or -not $seenServices.Add($service) -or
            $project -cne [string]$Lane.ProjectName -or
            [string](Get-EasyFireMigrationRuntimeProperty $item 'AuthorityLabel' '') -cne
                [string]$Lane.AuthorityLabel -or
            $state -cnotin @('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead')) {
            throw "Candidate lane partial-container identity is invalid: $service"
        }
    }
    return $items
}

function Get-EasyFireMigrationNamedLaneContainers {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Lane)

    $expectedNames = Get-EasyFireMigrationExpectedContainerNames -Lane $Lane
    $authority = [string]$Lane.AuthorityLabel
    $separator = $authority.IndexOf('=')
    if ($separator -lt 1 -or $separator -eq ($authority.Length - 1)) {
        throw 'Lane authority label is invalid.'
    }
    $authorityKey = $authority.Substring(0, $separator)
    $containers = @()
    $seenIds = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($service in $script:MigrationServices) {
        $expectedName = [string]$expectedNames[$service]
        $filter = "name=^/$([regex]::Escape($expectedName))$"
        $matches = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'ps', '-a', '--filter', $filter, '--format', '{{.ID}}'
        )
        foreach ($candidateId in @($matches.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
            $inspect = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('inspect', $candidateId)
            $parsed = $inspect.Text | ConvertFrom-Json
            $item = if ($parsed -is [array]) { $parsed[0] } else { $parsed }
            $id = [string](Get-EasyFireMigrationRuntimeProperty $item 'Id' '')
            $name = ([string](Get-EasyFireMigrationRuntimeProperty $item 'Name' '')).TrimStart('/')
            if ($name -cne $expectedName -or -not $seenIds.Add($id)) { continue }
            $config = Get-EasyFireMigrationRuntimeProperty $item 'Config' $null
            $labels = Get-EasyFireMigrationRuntimeProperty $config 'Labels' $null
            $state = Get-EasyFireMigrationRuntimeProperty $item 'State' $null
            $authorityValue = [string](Get-EasyFireMigrationRuntimeProperty $labels $authorityKey '')
            $containers += [pscustomobject][ordered]@{
                Id = $id
                Name = $name
                Project = [string](Get-EasyFireMigrationRuntimeProperty $labels 'com.docker.compose.project' '')
                Service = [string](Get-EasyFireMigrationRuntimeProperty $labels 'com.docker.compose.service' '')
                AuthorityLabel = if ($authorityValue) { "$authorityKey=$authorityValue" } else { '' }
                State = [string](Get-EasyFireMigrationRuntimeProperty $state 'Status' 'unknown')
            }
        }
    }
    return @($containers)
}

function Assert-EasyFireMigrationFreshLanePreflight {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        $Inventory
    )

    $namedContainers = @(Get-EasyFireMigrationNamedLaneContainers -Lane $Lane)
    if ($namedContainers.Count -ne 0) {
        throw 'Fresh migration lane requires all seven deterministic container names to be globally absent before first write.'
    }
    if ($null -eq $Inventory) { $Inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane }
    if (@(Get-EasyFireMigrationRuntimeProperty $Inventory 'Containers' @()).Count -ne 0) {
        throw 'Fresh migration lane requires zero exact project containers before first write.'
    }
    $exactNames = @([string]$Lane.MysqlVolumeName, [string]$Lane.RedisVolumeName)
    $observedVolumes = @(Get-EasyFireMigrationRuntimeProperty $Inventory 'Volumes' @() |
        ForEach-Object { [string]$_.Name })
    $reservedNames = @((Get-EasyFireMigrationRuntimeProperty $Inventory 'ReservedVolumeNames' @()) |
        ForEach-Object { [string]$_ })
    if (@($exactNames | Where-Object { $_ -in $observedVolumes -or $_ -in $reservedNames }).Count -ne 0) {
        throw 'Fresh migration lane requires both deterministic volumes to be absent before first write.'
    }
    return [pscustomobject][ordered]@{
        Passed = $true
        ProjectName = [string]$Lane.ProjectName
        MysqlVolumeName = [string]$Lane.MysqlVolumeName
        RedisVolumeName = [string]$Lane.RedisVolumeName
        ObservedContainers = 0
        ObservedVolumes = 0
    }
}

function Get-EasyFireMigrationExecutionContract {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][ValidateSet('Rehearsal', 'Cutover', 'Rollback')][string]$Lane)

    if ($Lane -ceq 'Rehearsal') {
        return @(
            'VerifySourceAuthority',
            'VerifyInitialBackupRestore',
            'VerifyFreshLanePreflight',
            'CreateLaneVolumes',
            'RenderLaneEnvironment',
            'StartMysql',
            'ImportMysql',
            'StartRedis',
            'CopyRedisSnapshot',
            'RunDatabaseMigrationOnce',
            'StartApplicationTier',
            'BindExactCandidateRuntimeAuthority',
            'VerifyCandidateHealth',
            'AwaitNativeAuthentication',
            'StopExactRehearsalContainers',
            'RehearseSourceRecovery',
            'VerifySourceUnchanged'
        )
    }
    if ($Lane -ceq 'Cutover') {
        return @(
            'AcquireMigrationMutex',
            'PauseIngress',
            'FenceScheduledBackup',
            'FreezeExactSourceApplicationTier',
            'CreateFinalSourceBackup',
            'VerifyFinalSourceBackupRestore',
            'FreezeSourceDataTier',
            'VerifyFreshLanePreflight',
            'CreateCutoverVolumes',
            'StartCutoverMysql',
            'ImportFinalMysql',
            'CopyFinalRedisSnapshot',
            'RunDatabaseMigrationOnce',
            'StartCutoverApplicationTier',
            'BindExactCandidateRuntimeAuthority',
            'VerifyCutoverHealth',
            'CreateCandidateBaselineBackup',
            'VerifyCandidateBaselineRestore',
            'RepairBackupTask',
            'RetireStartupTask',
            'StartAndVerifyIngress',
            'PublishCompletedLast'
        )
    }
    return @(
        'CreateEmergencyBackupWhenCompleted',
        'VerifyEmergencyBackupRestoreWhenCompleted',
        'StopExactCutoverContainers',
        'RestoreExactTaskXml',
        'StartExactSourceDataTier',
        'StartExactSourceApplicationTier',
        'RestoreIngressPreState',
        'VerifySourceRecovery',
        'PublishRolledBack'
    )
}

function Assert-EasyFireMigrationSourceInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Inventory,
        [Parameter(Mandatory = $true)][string]$ExpectedProjectName,
        [Parameter(Mandatory = $true)][string]$ExpectedMysqlVolumeName,
        [Parameter(Mandatory = $true)][string]$ExpectedRedisVolumeName
    )

    if ([string](Get-EasyFireMigrationRuntimeProperty $Inventory 'ProjectName' '') -cne $ExpectedProjectName -or
        [string](Get-EasyFireMigrationRuntimeProperty $Inventory 'MysqlVolumeName' '') -cne $ExpectedMysqlVolumeName -or
        [string](Get-EasyFireMigrationRuntimeProperty $Inventory 'RedisVolumeName' '') -cne $ExpectedRedisVolumeName) {
        throw 'Source project or durable volume authority drifted.'
    }
    $containers = @(Get-EasyFireMigrationRuntimeProperty $Inventory 'Containers' @())
    if ($containers.Count -ne $script:MigrationServices.Count) {
        throw 'Source inventory must contain exactly the seven expected services.'
    }
    foreach ($service in $script:MigrationServices) {
        $matches = @($containers | Where-Object { [string]$_.Service -ceq $service })
        if ($matches.Count -ne 1) {
            throw "Source service identity is not unique: $service"
        }
        $containerId = [string](Get-EasyFireMigrationRuntimeProperty $matches[0] 'ContainerId' (
                Get-EasyFireMigrationRuntimeProperty $matches[0] 'Id' ''
            ))
        $project = [string](Get-EasyFireMigrationRuntimeProperty $matches[0] 'ProjectName' (
                Get-EasyFireMigrationRuntimeProperty $matches[0] 'Project' ''
            ))
        if ($containerId -notmatch '^[a-f0-9]{64}$' -or $project -cne $ExpectedProjectName) {
            throw "Source container authority is invalid: $service"
        }
    }
}

function Get-EasyFireMigrationSourceInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectName,
        [Parameter(Mandatory = $true)][string]$MysqlVolumeName,
        [Parameter(Mandatory = $true)][string]$RedisVolumeName
    )

    $raw = Get-EasyFireComposeInventory -ProjectName $ProjectName `
        -ExactVolumeNames @($MysqlVolumeName, $RedisVolumeName)
    $containers = @($raw.Containers | ForEach-Object {
            [pscustomobject][ordered]@{
                Service = [string]$_.Service
                ContainerId = [string]$_.Id
                ContainerName = [string]$_.Name
                ProjectName = [string]$_.Project
                ImageReference = [string]$_.ImageReference
                ImageId = [string]$_.ImageId
                State = [string]$_.State
                Health = [string]$_.Health
                RestartPolicy = [string]$_.RestartPolicy
                PortBindings = @($_.PortBindings)
                VolumeNames = @($_.VolumeNames)
                Mounts = @($_.Mounts)
            }
        } | Sort-Object Service)
    $result = [pscustomobject][ordered]@{
        ProjectName = $ProjectName
        MysqlVolumeName = $MysqlVolumeName
        RedisVolumeName = $RedisVolumeName
        Containers = $containers
        Networks = @($raw.Networks)
        Volumes = @($raw.Volumes)
        ForeignVolumeConsumers = @($raw.ForeignVolumeConsumers)
    }
    $null = Assert-EasyFireMigrationSourceInventory -Inventory $result `
        -ExpectedProjectName $ProjectName -ExpectedMysqlVolumeName $MysqlVolumeName `
        -ExpectedRedisVolumeName $RedisVolumeName
    if (@($result.ForeignVolumeConsumers).Count -ne 0) {
        throw 'A source durable volume has a foreign container consumer.'
    }
    return $result
}

function Get-EasyFireMigrationInventoryFingerprint {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Inventory)

    $canonical = [ordered]@{
        ProjectName = [string]$Inventory.ProjectName
        MysqlVolumeName = [string]$Inventory.MysqlVolumeName
        RedisVolumeName = [string]$Inventory.RedisVolumeName
        Containers = @($Inventory.Containers | Sort-Object Service | ForEach-Object {
                [ordered]@{
                    Service = [string]$_.Service
                    ContainerId = [string]$_.ContainerId
                    ContainerName = [string]$_.ContainerName
                    ProjectName = [string]$_.ProjectName
                    ImageReference = [string]$_.ImageReference
                    ImageId = [string]$_.ImageId
                    State = [string]$_.State
                    Health = [string]$_.Health
                    RestartPolicy = [string]$_.RestartPolicy
                    PortBindings = @($_.PortBindings)
                    VolumeNames = @($_.VolumeNames)
                    Mounts = @($_.Mounts)
                }
            })
    }
    return Get-EasyFireMigrationRuntimeTextSha256 -Text ($canonical | ConvertTo-Json -Depth 20 -Compress)
}

function Write-EasyFireMigrationExactTextFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )

    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Runtime output path must be absolute.' }
    $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $directory -Force
    }
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $current = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        if ($current -cne $Content) {
            throw "Existing runtime file does not match the exact retry authority: $Path"
        }
        return
    }
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function New-EasyFireMigrationLaneFiles {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$TemplateEnvFile,
        [Parameter(Mandatory = $true)][string]$LaneDirectory
    )

    if (-not (Test-Path -LiteralPath $TemplateEnvFile -PathType Leaf)) {
        throw 'Target environment template is missing.'
    }
    $values = [ordered]@{}
    $order = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in [IO.File]::ReadAllLines($TemplateEnvFile, [Text.Encoding]::UTF8)) {
        if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
        $key = [string]$Matches[1]
        if (-not $values.Contains($key)) { $order.Add($key) }
        $values[$key] = [string]$Matches[2]
    }
    foreach ($required in @('IMAGE_TAG', 'MARIADB_IMAGE_TAG', 'SYSTEM_DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_ROOT_PASSWORD')) {
        if (-not $values.Contains($required) -or [string]::IsNullOrWhiteSpace([string]$values[$required])) {
            throw "Target environment is missing required migration value: $required"
        }
    }
    $overrides = [ordered]@{
        MARIADB_VOLUME_NAME = [string]$Lane.MysqlVolumeName
        REDIS_VOLUME_NAME = [string]$Lane.RedisVolumeName
        PUBLIC_PROXY_PORT = [string]$Lane.LoopbackPort
    }
    foreach ($entry in $overrides.GetEnumerator()) {
        if (-not $values.Contains($entry.Key)) { $order.Add([string]$entry.Key) }
        $values[$entry.Key] = [string]$entry.Value
    }
    $lines = @($order | ForEach-Object { "$_=$([string]$values[$_])" })
    $envContent = ($lines -join "`r`n") + "`r`n"
    $overrideContent = (New-EasyFireMigrationComposeOverride -Lane $Lane).TrimEnd() + "`r`n"
    $envPath = Join-Path $LaneDirectory 'runtime.env'
    $overridePath = Join-Path $LaneDirectory 'compose.override.yml'
    Write-EasyFireMigrationExactTextFile -Path $envPath -Content $envContent
    Write-EasyFireMigrationExactTextFile -Path $overridePath -Content $overrideContent
    return [pscustomobject][ordered]@{
        EnvironmentFile = $envPath
        EnvironmentSha256 = Get-EasyFireMigrationRuntimeFileSha256 -Path $envPath
        ComposeOverrideFile = $overridePath
        ComposeOverrideSha256 = Get-EasyFireMigrationRuntimeFileSha256 -Path $overridePath
    }
}

function Invoke-EasyFireMigrationCompose {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$ComposeFile,
        [Parameter(Mandatory = $true)][string]$OverrideFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $base = @(
        'compose', '--project-name', [string]$Lane.ProjectName,
        '--file', $ComposeFile, '--file', $OverrideFile, '--env-file', $EnvFile
    )
    return Invoke-EasyFireNative -FilePath 'docker' -ArgumentList (@($base) + @($Arguments))
}

function Get-EasyFireMigrationLaneInventory {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Lane)

    $inventory = Get-EasyFireComposeInventory -ProjectName ([string]$Lane.ProjectName) `
        -ExactVolumeNames @([string]$Lane.MysqlVolumeName, [string]$Lane.RedisVolumeName)
    $authority = [string]$Lane.AuthorityLabel
    $separator = $authority.IndexOf('=')
    if ($separator -lt 1 -or $separator -eq ($authority.Length - 1)) {
        throw 'Lane authority label is invalid.'
    }
    $authorityKey = $authority.Substring(0, $separator)
    foreach ($container in @($inventory.Containers)) {
        $raw = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                'inspect', [string]$container.Id
            )).Text | ConvertFrom-Json
        $exact = if ($raw -is [array]) { $raw[0] } else { $raw }
        $labels = Get-EasyFireMigrationRuntimeProperty (
            Get-EasyFireMigrationRuntimeProperty $exact 'Config' $null
        ) 'Labels' $null
        $value = [string](Get-EasyFireMigrationRuntimeProperty $labels $authorityKey '')
        $authorityLabel = if ($value) { "$authorityKey=$value" } else { '' }
        $container | Add-Member -NotePropertyName AuthorityLabel `
            -NotePropertyValue $authorityLabel -Force
        $container | Add-Member -NotePropertyName ComposeWorkingDirectory `
            -NotePropertyValue ([string](Get-EasyFireMigrationRuntimeProperty $labels `
                    'com.docker.compose.project.working_dir' '')) -Force
    }
    foreach ($volume in @($inventory.Volumes)) {
        $raw = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                'volume', 'inspect', [string]$volume.Name
            )).Text | ConvertFrom-Json
        $exact = if ($raw -is [array]) { $raw[0] } else { $raw }
        $labels = Get-EasyFireMigrationRuntimeProperty $exact 'Labels' $null
        $value = [string](Get-EasyFireMigrationRuntimeProperty $labels $authorityKey '')
        $authorityLabel = if ($value) { "$authorityKey=$value" } else { '' }
        $volume | Add-Member -NotePropertyName AuthorityLabel `
            -NotePropertyValue $authorityLabel -Force
    }
    return $inventory
}

function ConvertTo-EasyFireMigrationCanonicalHostPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
        throw "$Name must be a non-empty absolute host path."
    }
    try {
        $full = [IO.Path]::GetFullPath($Path)
    } catch {
        throw "$Name is not a valid absolute host path."
    }
    return $full.TrimEnd([char[]]@('\', '/')).Replace('/', '\')
}

function Assert-EasyFireMigrationCandidateRuntimeAuthority {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)]$Inventory,
        [Parameter(Mandatory = $true)][object[]]$ExpectedImages,
        [Parameter(Mandatory = $true)][string]$ExpectedComposeWorkingDirectory,
        [ValidateSet('mysql', 'redis', 'database_migration', 'server', 'webapp', 'envoy', 'gotenberg')]
        [string[]]$ExpectedServices = $script:MigrationServices
    )

    $canonicalExpectedComposeWorkingDirectory = ConvertTo-EasyFireMigrationCanonicalHostPath `
        -Path $ExpectedComposeWorkingDirectory -Name 'Expected Compose working directory'
    $services = @(Resolve-EasyFireMigrationExpectedServices -ExpectedServices $ExpectedServices)
    $containers = @(Assert-EasyFireMigrationLaneServiceSet -Lane $Lane -Inventory $Inventory `
        -ExpectedServices $services)
    if ($ExpectedImages.Count -ne $script:MigrationServices.Count) {
        throw 'Candidate image authority must contain exactly all seven services.'
    }
    foreach ($service in $script:MigrationServices) {
        $expected = @($ExpectedImages | Where-Object { [string]$_.Service -ceq $service })
        if ($expected.Count -ne 1 -or -not [string]$expected[0].ImageReference -or
            [string]$expected[0].ImageId -notmatch '^sha256:[a-f0-9]{64}$') {
            throw "Candidate image authority is invalid or non-unique: $service"
        }
    }
    $proofContainers = @()
    foreach ($service in $services) {
        $item = @($containers | Where-Object { [string]$_.Service -ceq $service })[0]
        $expected = @($ExpectedImages | Where-Object { [string]$_.Service -ceq $service })
        if ($expected.Count -ne 1) { throw "Candidate image authority is not unique: $service" }
        $imageReference = [string](Get-EasyFireMigrationRuntimeProperty $item 'ImageReference' '')
        $imageId = [string](Get-EasyFireMigrationRuntimeProperty $item 'ImageId' '')
        if (-not $imageReference -or $imageId -notmatch '^sha256:[a-f0-9]{64}$' -or
            $imageReference -cne [string]$expected[0].ImageReference -or
            $imageId -cne [string]$expected[0].ImageId) {
            throw "Candidate image authority drifted: $service"
        }
        $mounts = @(Get-EasyFireMigrationRuntimeProperty $item 'Mounts' @())
        $volumeNames = @(Get-EasyFireMigrationRuntimeProperty $item 'VolumeNames' @())
        if ($service -cin @('mysql', 'redis')) {
            $expectedVolume = if ($service -ceq 'mysql') {
                [string]$Lane.MysqlVolumeName
            } else { [string]$Lane.RedisVolumeName }
            $expectedDestination = if ($service -ceq 'mysql') { '/var/lib/mysql' } else { '/data' }
            $exactMount = @($mounts | Where-Object {
                    [string]$_.Type -ceq 'volume' -and
                    [string]$_.Source -ceq $expectedVolume -and
                    [string]$_.Destination -ceq $expectedDestination -and
                    [bool]$_.ReadWrite
                })
            if ($mounts.Count -ne 1 -or $exactMount.Count -ne 1 -or
                $volumeNames.Count -ne 1 -or [string]$volumeNames[0] -cne $expectedVolume) {
                throw "Candidate durable mount authority drifted: $service"
            }
        } elseif ($service -ceq 'envoy') {
            $workingDirectory = [string](Get-EasyFireMigrationRuntimeProperty $item `
                    'ComposeWorkingDirectory' '')
            $canonicalWorkingDirectory = ConvertTo-EasyFireMigrationCanonicalHostPath `
                -Path $workingDirectory -Name 'Envoy Compose working directory'
            if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
                    $canonicalWorkingDirectory,
                    $canonicalExpectedComposeWorkingDirectory
                )) {
                throw 'Candidate Envoy Compose working directory drifted.'
            }
            $expectedConfigSource = ConvertTo-EasyFireMigrationCanonicalHostPath `
                -Path (Join-Path $canonicalExpectedComposeWorkingDirectory 'docker\envoy\envoy.yaml') `
                -Name 'Expected Envoy config source'
            $exactMount = @($mounts | Where-Object {
                    if ([string]$_.Type -cne 'bind' -or
                        [string]$_.Destination -cne '/etc/envoy/envoy.yaml' -or
                        [string]$_.Mode -cne 'ro' -or [bool]$_.ReadWrite) {
                        return $false
                    }
                    try {
                        $source = ConvertTo-EasyFireMigrationCanonicalHostPath `
                            -Path ([string]$_.Source) -Name 'Envoy config bind source'
                        return [StringComparer]::OrdinalIgnoreCase.Equals($source, $expectedConfigSource)
                    } catch { return $false }
                })
            if ($mounts.Count -ne 1 -or $exactMount.Count -ne 1 -or $volumeNames.Count -ne 0) {
                throw 'Candidate Envoy config bind authority drifted.'
            }
        } elseif ($mounts.Count -ne 0 -or $volumeNames.Count -ne 0) {
            throw "Candidate non-data service must have zero mounts: $service"
        }

        $portBindings = @(Get-EasyFireMigrationRuntimeProperty $item 'PortBindings' @())
        if ($service -ceq 'envoy') {
            $exactPort = @($portBindings | Where-Object {
                    [string]$_.ContainerPort -ceq '80/tcp' -and
                    [string]$_.HostIp -ceq '127.0.0.1' -and
                    [string]$_.HostPort -ceq ([string][int]$Lane.LoopbackPort)
                })
            if ($portBindings.Count -ne 1 -or $exactPort.Count -ne 1) {
                throw 'Candidate Envoy loopback port authority drifted.'
            }
        } elseif ($portBindings.Count -ne 0) {
            throw "Candidate non-Envoy service must have zero published host ports: $service"
        }
        $proofContainers += [pscustomobject][ordered]@{
            Service = $service
            ContainerId = [string](Get-EasyFireMigrationRuntimeProperty $item 'Id' (
                    Get-EasyFireMigrationRuntimeProperty $item 'ContainerId' ''
                ))
            ContainerName = [string](Get-EasyFireMigrationRuntimeProperty $item 'Name' (
                    Get-EasyFireMigrationRuntimeProperty $item 'ContainerName' ''
                ))
            ProjectName = [string]$Lane.ProjectName
            ImageReference = $imageReference
            ImageId = $imageId
            AuthorityLabel = [string]$Lane.AuthorityLabel
            ComposeWorkingDirectory = [string](Get-EasyFireMigrationRuntimeProperty $item `
                    'ComposeWorkingDirectory' '')
            Mounts = $mounts
            PortBindings = $portBindings
        }
    }

    $expectedVolumeDefinitions = @()
    if ('mysql' -cin $services) {
        $expectedVolumeDefinitions += ,@('mysql', [string]$Lane.MysqlVolumeName)
    }
    if ('redis' -cin $services) {
        $expectedVolumeDefinitions += ,@('redis', [string]$Lane.RedisVolumeName)
    }
    $volumes = @(Get-EasyFireMigrationRuntimeProperty $Inventory 'Volumes' @())
    if ($volumes.Count -ne $expectedVolumeDefinitions.Count -or
        @(Get-EasyFireMigrationRuntimeProperty $Inventory 'ForeignVolumeConsumers' @()).Count -ne 0) {
        throw 'Candidate durable volume inventory does not equal the exact expected stage.'
    }
    $proofVolumes = @()
    foreach ($definition in $expectedVolumeDefinitions) {
        $matches = @($volumes | Where-Object { [string]$_.Name -ceq [string]$definition[1] })
        if ($matches.Count -ne 1 -or [string]$matches[0].Project -cne [string]$Lane.ProjectName -or
            [string]$matches[0].LogicalName -cne [string]$definition[0] -or
            [string](Get-EasyFireMigrationRuntimeProperty $matches[0] 'AuthorityLabel' '') -cne
                [string]$Lane.AuthorityLabel) {
            throw "Candidate durable volume authority drifted: $($definition[0])"
        }
        $proofVolumes += [pscustomobject][ordered]@{
            LogicalName = [string]$definition[0]
            VolumeName = [string]$definition[1]
            ProjectName = [string]$Lane.ProjectName
            AuthorityLabel = [string]$Lane.AuthorityLabel
        }
    }
    return [pscustomobject][ordered]@{
        ProjectName = [string]$Lane.ProjectName
        AuthorityLabel = [string]$Lane.AuthorityLabel
        Containers = $proofContainers
        Volumes = $proofVolumes
    }
}

function Get-EasyFireMigrationLaneInventoryFingerprint {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Inventory)
    return Get-EasyFireInventoryFingerprint -Inventory $Inventory
}

function Get-EasyFireMigrationLaneVolumeFingerprint {
    [CmdletBinding()]
    param([object[]]$Volumes = @())
    return Get-EasyFireVolumeFingerprint -Volumes @($Volumes)
}

function Get-EasyFireMigrationLaneService {
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$Service
    )

    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $matches = @($inventory.Containers | Where-Object { [string]$_.Service -ceq $Service })
    if ($matches.Count -ne 1 -or [string]$matches[0].Project -cne [string]$Lane.ProjectName) {
        throw "Lane service identity is not unique: $Service"
    }
    return $matches[0]
}

function Wait-EasyFireMigrationServiceState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$Service,
        [ValidateSet('Healthy', 'Running', 'ExitedZero')][string]$Condition = 'Healthy',
        [ValidateRange(1, 900)][int]$TimeoutSeconds = 300
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $item = Get-EasyFireMigrationLaneService -Lane $Lane -Service $Service
        if ($Condition -ceq 'Healthy' -and [string]$item.State -ceq 'running' -and [string]$item.Health -ceq 'healthy') {
            return $item
        }
        if ($Condition -ceq 'Running' -and [string]$item.State -ceq 'running') { return $item }
        if ($Condition -ceq 'ExitedZero' -and [string]$item.State -ceq 'exited') {
            $inspect = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('inspect', [string]$item.Id)).Text | ConvertFrom-Json
            $exact = if ($inspect -is [array]) { $inspect[0] } else { $inspect }
            if ([int]$exact.State.ExitCode -eq 0) { return $item }
            throw "$Service exited nonzero: $([int]$exact.State.ExitCode)"
        }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for $Service to become $Condition."
}

function Start-EasyFireMigrationMysql {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$ComposeFile,
        [Parameter(Mandatory = $true)][string]$OverrideFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][object[]]$ExpectedImages,
        [Parameter(Mandatory = $true)][string]$ExpectedComposeWorkingDirectory
    )

    $null = Invoke-EasyFireMigrationCompose -Lane $Lane -ComposeFile $ComposeFile `
        -OverrideFile $OverrideFile -EnvFile $EnvFile `
        -Arguments @('create', '--no-build', '--no-recreate', 'mysql')
    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $inventory -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -ExpectedServices @('mysql')
    $mysql = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })[0]
    if ([string]$mysql.State -cne 'running') {
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$mysql.Id)
    }
    $healthy = Wait-EasyFireMigrationServiceState -Lane $Lane -Service 'mysql' `
        -Condition Healthy -TimeoutSeconds 300
    $readback = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $readback -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -ExpectedServices @('mysql')
    return $healthy
}

function Import-EasyFireMigrationMysqlBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$BackupFile,
        [Parameter(Mandatory = $true)][string]$ExpectedBackupSha256,
        [Parameter(Mandatory = $true)][string]$OperationId
    )

    if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf) -or
        (Get-EasyFireMigrationRuntimeFileSha256 -Path $BackupFile) -cne $ExpectedBackupSha256) {
        throw 'Migration import backup does not match exact authority.'
    }
    $mysql = Get-EasyFireMigrationLaneService -Lane $Lane -Service 'mysql'
    if ([string]$mysql.State -cne 'running' -or [string]$mysql.Health -cne 'healthy') {
        throw 'Candidate MariaDB must be healthy before import.'
    }
    $token = (ConvertTo-EasyFireMigrationRuntimeId -MigrationId $OperationId).Replace('-', '')
    $containerArchive = "/tmp/easyfire-migration-$token.sql.gz"
    $containerSql = "/tmp/easyfire-migration-$token.sql"
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('cp', $BackupFile, "$([string]$mysql.Id):$containerArchive")
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('exec', [string]$mysql.Id, 'gzip', '-t', $containerArchive)
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('exec', [string]$mysql.Id, 'gzip', '-d', '-k', $containerArchive)
    $command = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb --user=root --execute=''source ' + $containerSql + ''''
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('exec', [string]$mysql.Id, 'sh', '-c', $command)
    $check = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', [string]$mysql.Id, 'sh', '-c',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb --user=root --batch --skip-column-names --execute=''SHOW DATABASES;'''
    )
    if (@($check.Output | Where-Object { $_.Trim() -and $_.Trim() -notmatch '^(information_schema|performance_schema|mysql|sys)$' }).Count -eq 0) {
        throw 'Migration import produced no application databases.'
    }
    return [pscustomobject]@{ MysqlContainerId = [string]$mysql.Id; BackupSha256 = $ExpectedBackupSha256; Imported = $true }
}

function Assert-EasyFireMigrationRedisRdbIntegrity {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerId,
        [string]$RdbPath = '/data/dump.rdb'
    )

    $check = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $ContainerId, 'redis-check-rdb', $RdbPath
    )
    if ([string]$check.Text -notmatch '(?m)RDB looks OK!') {
        throw 'Redis RDB structural integrity proof failed.'
    }
    return [pscustomobject][ordered]@{
        Passed = $true
        OutputSha256 = Get-EasyFireMigrationRuntimeTextSha256 -Text ([string]$check.Text)
    }
}

function Export-EasyFireMigrationRedisSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceRedisContainerId,
        [Parameter(Mandatory = $true)][string]$SnapshotPath
    )

    if ($SourceRedisContainerId -notmatch '^[a-f0-9]{64}$') { throw 'Source Redis container identity is invalid.' }
    if (Test-Path -LiteralPath $SnapshotPath -PathType Leaf) {
        throw 'Redis snapshot path already exists without fresh export authority.'
    }
    $save = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('exec', $SourceRedisContainerId, 'redis-cli', 'SAVE')
    if (($save.Output | Select-Object -Last 1).Trim() -cne 'OK') { throw 'Source Redis SAVE did not succeed.' }
    $integrity = Assert-EasyFireMigrationRedisRdbIntegrity -ContainerId $SourceRedisContainerId
    $sourceCountText = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'exec', $SourceRedisContainerId, 'redis-cli', 'DBSIZE'
        )).Output | Select-Object -Last 1
    if ([string]$sourceCountText -notmatch '^\d+$') { throw 'Source Redis key-count observation is invalid.' }
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('cp', "${SourceRedisContainerId}:/data/dump.rdb", $SnapshotPath)
    if (-not (Test-Path -LiteralPath $SnapshotPath -PathType Leaf)) { throw 'Redis snapshot was not published.' }
    return [pscustomobject]@{
        SnapshotPath = $SnapshotPath
        SnapshotSha256 = Get-EasyFireMigrationRuntimeFileSha256 -Path $SnapshotPath
        StructuralIntegrity = [bool]$integrity.Passed
        StructuralCheckSha256 = [string]$integrity.OutputSha256
        SourceObservedKeyCount = [int64]$sourceCountText
        SourceKeyCount = [int64]$sourceCountText
        Reused = $false
    }
}

function Import-EasyFireMigrationRedisSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$ComposeFile,
        [Parameter(Mandatory = $true)][string]$OverrideFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][string]$SnapshotPath,
        [Parameter(Mandatory = $true)][string]$ExpectedSnapshotSha256,
        [Parameter(Mandatory = $true)][object[]]$ExpectedImages,
        [Parameter(Mandatory = $true)][string]$ExpectedComposeWorkingDirectory,
        [Alias('ExpectedKeyCount')][int64]$SourceObservedKeyCount = -1
    )

    if ($ExpectedSnapshotSha256 -notmatch '^[A-F0-9]{64}$' -or
        -not (Test-Path -LiteralPath $SnapshotPath -PathType Leaf) -or
        (Get-EasyFireMigrationRuntimeFileSha256 -Path $SnapshotPath) -cne $ExpectedSnapshotSha256) {
        throw 'Redis snapshot does not match exact migration authority.'
    }
    $null = Invoke-EasyFireMigrationCompose -Lane $Lane -ComposeFile $ComposeFile `
        -OverrideFile $OverrideFile -EnvFile $EnvFile `
        -Arguments @('create', '--no-build', '--no-recreate', 'redis')
    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $inventory -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -ExpectedServices @('mysql', 'redis')
    $redis = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'redis' })[0]
    if ([string]$redis.State -eq 'running') { throw 'Candidate Redis must be stopped while its snapshot is copied.' }
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('cp', $SnapshotPath, "$([string]$redis.Id):/data/dump.rdb")
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$redis.Id)
    $redis = Wait-EasyFireMigrationServiceState -Lane $Lane -Service 'redis' -Condition Healthy -TimeoutSeconds 180
    $integrity = Assert-EasyFireMigrationRedisRdbIntegrity -ContainerId ([string]$redis.Id)
    $count = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'exec', [string]$redis.Id, 'redis-cli', 'DBSIZE'
        )).Output | Select-Object -Last 1
    if ([string]$count -notmatch '^\d+$') { throw 'Candidate Redis key-count observation is invalid.' }
    $readback = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $readback -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -ExpectedServices @('mysql', 'redis')
    return [pscustomobject]@{
        RedisContainerId = [string]$redis.Id
        SnapshotPath = $SnapshotPath
        SnapshotSha256 = $ExpectedSnapshotSha256
        StructuralIntegrity = [bool]$integrity.Passed
        StructuralCheckSha256 = [string]$integrity.OutputSha256
        SourceObservedKeyCount = $SourceObservedKeyCount
        CandidateObservedKeyCount = [int64]$count
        KeyCount = [int64]$count
    }
}

function Copy-EasyFireMigrationRedisSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceRedisContainerId,
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$ComposeFile,
        [Parameter(Mandatory = $true)][string]$OverrideFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][string]$SnapshotPath,
        [Parameter(Mandatory = $true)][object[]]$ExpectedImages,
        [Parameter(Mandatory = $true)][string]$ExpectedComposeWorkingDirectory
    )

    $export = Export-EasyFireMigrationRedisSnapshot -SourceRedisContainerId $SourceRedisContainerId `
        -SnapshotPath $SnapshotPath
    return Import-EasyFireMigrationRedisSnapshot -Lane $Lane -ComposeFile $ComposeFile `
        -OverrideFile $OverrideFile -EnvFile $EnvFile -SnapshotPath $SnapshotPath `
        -ExpectedSnapshotSha256 ([string]$export.SnapshotSha256) `
        -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -SourceObservedKeyCount ([int64]$export.SourceObservedKeyCount)
}

function Start-EasyFireMigrationDatabaseMigrationOnce {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$ComposeFile,
        [Parameter(Mandatory = $true)][string]$OverrideFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][object[]]$ExpectedImages,
        [Parameter(Mandatory = $true)][string]$ExpectedComposeWorkingDirectory
    )

    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $matches = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'database_migration' })
    if ($matches.Count -eq 0) {
        $null = Invoke-EasyFireMigrationCompose -Lane $Lane -ComposeFile $ComposeFile `
            -OverrideFile $OverrideFile -EnvFile $EnvFile `
            -Arguments @('create', '--no-build', '--no-recreate', 'database_migration')
        $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
        $matches = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'database_migration' })
    }
    if ($matches.Count -ne 1) {
        throw 'Migration container identity is not unique.'
    }
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $inventory -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -ExpectedServices @('mysql', 'redis', 'database_migration')
    $migration = $matches[0]
    if ([string]$migration.State -ceq 'created') {
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$migration.Id)
    } elseif ([string]$migration.State -cne 'exited') {
        throw 'Migration container is neither an unstarted retry nor a completed one-shot.'
    }
    $result = Wait-EasyFireMigrationServiceState -Lane $Lane -Service 'database_migration' `
        -Condition ExitedZero -TimeoutSeconds 600
    $readback = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $readback -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory `
        -ExpectedServices @('mysql', 'redis', 'database_migration')
    return $result
}

function Start-EasyFireMigrationApplicationTier {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)][string]$ComposeFile,
        [Parameter(Mandatory = $true)][string]$OverrideFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][object[]]$ExpectedImages,
        [Parameter(Mandatory = $true)][string]$ExpectedComposeWorkingDirectory
    )

    $null = Invoke-EasyFireMigrationCompose -Lane $Lane -ComposeFile $ComposeFile `
        -OverrideFile $OverrideFile -EnvFile $EnvFile `
        -Arguments @('create', '--no-build', '--no-recreate', 'server', 'webapp', 'gotenberg', 'envoy')
    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $null = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $inventory -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory
    $appServices = @('server', 'webapp', 'gotenberg', 'envoy')
    if (@($inventory.Containers | Where-Object {
                [string]$_.Service -in $appServices -and [string]$_.State -ceq 'running'
            }).Count -ne 0) {
        throw 'Candidate application containers must all be stopped for pre-start authority proof.'
    }
    foreach ($service in @('server', 'webapp', 'gotenberg')) {
        $item = @($inventory.Containers | Where-Object { [string]$_.Service -ceq $service })[0]
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$item.Id)
        $null = Wait-EasyFireMigrationServiceState -Lane $Lane -Service $service -Condition Healthy -TimeoutSeconds 600
    }
    $envoy = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'envoy' })[0]
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$envoy.Id)
    $null = Wait-EasyFireMigrationServiceState -Lane $Lane -Service 'envoy' -Condition Healthy -TimeoutSeconds 300
    $readback = Get-EasyFireMigrationLaneInventory -Lane $Lane
    return Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $readback -ExpectedImages $ExpectedImages `
        -ExpectedComposeWorkingDirectory $ExpectedComposeWorkingDirectory
}

function Test-EasyFireMigrationCandidateHealth {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Lane)

    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    foreach ($service in @('mysql', 'redis', 'server', 'webapp', 'envoy', 'gotenberg')) {
        $matches = @($inventory.Containers | Where-Object { [string]$_.Service -ceq $service })
        if ($matches.Count -ne 1 -or [string]$matches[0].State -cne 'running' -or
            [string]$matches[0].Health -cne 'healthy') {
            throw "Candidate health proof failed: $service"
        }
    }
    $migration = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'database_migration' })
    if ($migration.Count -ne 1 -or [string]$migration[0].State -cne 'exited') {
        throw 'Candidate migration one-shot is not complete.'
    }
    $login = Test-EasyFireHttp -Uri ("http://127.0.0.1:{0}/auth/login" -f [int]$Lane.LoopbackPort)
    $meta = Test-EasyFireHttp -Uri ("http://127.0.0.1:{0}/api/auth/meta" -f [int]$Lane.LoopbackPort)
    if (-not $login.Reachable -or [int]$login.StatusCode -ne 200 -or
        -not $meta.Reachable -or [int]$meta.StatusCode -ne 200) {
        throw 'Candidate native login surface is not healthy.'
    }
    return [pscustomobject][ordered]@{
        Passed = $true
        ProjectName = [string]$Lane.ProjectName
        LoopbackPort = [int]$Lane.LoopbackPort
        LoginStatus = [int]$login.StatusCode
        AuthMetaStatus = [int]$meta.StatusCode
        InventoryFingerprint = Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $inventory
    }
}

function Stop-EasyFireMigrationLaneContainers {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Lane)

    $containers = @(Get-EasyFireMigrationNamedLaneContainers -Lane $Lane)
    $null = Assert-EasyFireMigrationLaneContainerSubset -Lane $Lane -Containers $containers
    $stoppable = @($containers | Where-Object {
            [string]$_.State -cin @('running', 'restarting', 'paused')
        })
    foreach ($service in @('envoy', 'server', 'webapp', 'gotenberg', 'database_migration', 'redis', 'mysql')) {
        $item = @($stoppable | Where-Object { [string]$_.Service -ceq $service })
        if ($item.Count -eq 1) {
            if ([string]$item[0].State -ceq 'paused') {
                $null = Invoke-EasyFireNative -FilePath 'docker' `
                    -ArgumentList @('unpause', [string]$item[0].Id)
            }
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('stop', '--time', '30', [string]$item[0].Id)
        } elseif ($item.Count -gt 1) {
            throw "Refusing to stop non-unique lane service: $service"
        }
    }
    $readback = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $readbackContainers = @(Get-EasyFireMigrationRuntimeProperty $readback 'Containers' @())
    $null = Assert-EasyFireMigrationLaneContainerSubset -Lane $Lane -Containers $readbackContainers
    $initialIds = @($containers | ForEach-Object { [string]$_.Id } | Sort-Object)
    $readbackIds = @($readbackContainers | ForEach-Object { [string]$_.Id } | Sort-Object)
    if (@(Compare-Object $initialIds $readbackIds -CaseSensitive).Count -ne 0) {
        throw 'Stopped migration lane container identity drifted across the stop boundary.'
    }
    $unsafeStates = @($readbackContainers | Where-Object {
            [string]$_.State -cnotin @('created', 'exited', 'dead')
        })
    if ($unsafeStates.Count -ne 0) {
        throw 'Stopped migration lane must prove every deterministic container identity is non-running.'
    }
    return $readback
}

function Stop-EasyFireMigrationSourceServices {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$SourceInventory,
        [Parameter(Mandatory = $true)][ValidateSet('Application', 'Data')][string]$Tier
    )

    $services = if ($Tier -ceq 'Application') { $script:MigrationApplicationServices } else { $script:MigrationDataServices }
    foreach ($service in $services) {
        $matches = @($SourceInventory.Containers | Where-Object { [string]$_.Service -ceq $service })
        if ($matches.Count -ne 1) { throw "Source service identity is not unique: $service" }
        if ([string]$matches[0].State -ceq 'running') {
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('stop', '--time', '30', [string]$matches[0].ContainerId)
        }
    }
}

function Start-EasyFireMigrationSourceServices {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$SourceInventory,
        [Parameter(Mandatory = $true)][ValidateSet('Application', 'Data')][string]$Tier
    )

    $services = if ($Tier -ceq 'Application') { @('server', 'webapp', 'gotenberg', 'envoy') } else { @('mysql', 'redis') }
    foreach ($service in $services) {
        $matches = @($SourceInventory.Containers | Where-Object { [string]$_.Service -ceq $service })
        if ($matches.Count -ne 1) { throw "Source service identity is not unique: $service" }
        $inspect = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('inspect', [string]$matches[0].ContainerId)).Text | ConvertFrom-Json
        $exact = if ($inspect -is [array]) { $inspect[0] } else { $inspect }
        if ([string]$exact.State.Status -ne 'running') {
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$matches[0].ContainerId)
        }
        $deadline = [DateTime]::UtcNow.AddMinutes(10)
        do {
            $readback = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('inspect', [string]$matches[0].ContainerId)).Text | ConvertFrom-Json
            $current = if ($readback -is [array]) { $readback[0] } else { $readback }
            $status = [string]$current.State.Status
            $health = [string](Get-EasyFireMigrationRuntimeProperty $current.State.Health 'Status' 'none')
            if ($status -ceq 'running' -and $health -ceq 'healthy') { break }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($status -cne 'running' -or $health -cne 'healthy') {
            throw "Exact source service did not recover healthy: $service"
        }
    }
}

Export-ModuleMember -Function `
    New-EasyFireMigrationRuntimeLane, `
    New-EasyFireMigrationComposeOverride, `
    Assert-EasyFireMigrationFreshLanePreflight, `
    Get-EasyFireMigrationExecutionContract, `
    Assert-EasyFireMigrationSourceInventory, `
    Get-EasyFireMigrationSourceInventory, `
    Get-EasyFireMigrationInventoryFingerprint, `
    New-EasyFireMigrationLaneFiles, `
    Invoke-EasyFireMigrationCompose, `
    Get-EasyFireMigrationLaneInventory, `
    Assert-EasyFireMigrationCandidateRuntimeAuthority, `
    Get-EasyFireMigrationLaneInventoryFingerprint, `
    Get-EasyFireMigrationLaneVolumeFingerprint, `
    Get-EasyFireMigrationLaneService, `
    Wait-EasyFireMigrationServiceState, `
    Start-EasyFireMigrationMysql, `
    Import-EasyFireMigrationMysqlBackup, `
    Export-EasyFireMigrationRedisSnapshot, `
    Import-EasyFireMigrationRedisSnapshot, `
    Copy-EasyFireMigrationRedisSnapshot, `
    Start-EasyFireMigrationDatabaseMigrationOnce, `
    Start-EasyFireMigrationApplicationTier, `
    Test-EasyFireMigrationCandidateHealth, `
    Stop-EasyFireMigrationLaneContainers, `
    Stop-EasyFireMigrationSourceServices, `
    Start-EasyFireMigrationSourceServices
