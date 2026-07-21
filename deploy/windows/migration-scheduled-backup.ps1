# EasyFire Bookkeeping -- schema-2 migrated-runtime recovery-unit controller
#
# This controller is the only backup entry point for a blue/green Cutover
# runtime. It persists one exact operation plan before backup mutation, reuses
# that operation after interruption, requires an isolated restore receipt, and
# never selects or retains recovery units from the preserved source project.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$MigrationId,
    [Parameter(Mandatory = $true)][string]$AuthorityRoot,
    [Parameter(Mandatory = $true)]
    [ValidateSet('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')]
    [string]$InvocationRole,
    [Parameter(Mandatory = $true)][string]$AuthorityOwnerSid,
    [ValidateRange(1, 1000000)][int]$RetentionCount = 30
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'production-io.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'production-state.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'migration-state.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot '..\..\scripts\production\backup-integrity.psm1') -Force -ErrorAction Stop

function Get-EasyFireMigrationBackupProperty {
    param(
        $Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) { return $Default }
    $property = @($Object.PSObject.Properties | Where-Object { $_.Name -ceq $Name })
    if ($property.Count -eq 0) { return $Default }
    if ($property.Count -ne 1) { throw "Duplicate exact property: $Name" }
    return $property[0].Value
}

function Set-EasyFireMigrationBackupProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )

    $property = @($Object.PSObject.Properties | Where-Object { $_.Name -ceq $Name })
    if ($property.Count -gt 1) { throw "Duplicate exact property: $Name" }
    if ($property.Count -eq 1) { $property[0].Value = $Value }
    else { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}

function ConvertTo-EasyFireMigrationBackupCanonicalGuid {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) {
        throw "$FieldName must be a canonical lowercase GUID."
    }
    $canonical = $parsed.ToString('D').ToLowerInvariant()
    if ($Value -cne $canonical) { throw "$FieldName must be a canonical lowercase GUID." }
    return $canonical
}

function ConvertTo-EasyFireMigrationBackupCanonicalSid {
    param([Parameter(Mandatory = $true)][string]$Value)

    try { $sid = New-Object Security.Principal.SecurityIdentifier($Value) }
    catch { throw 'AuthorityOwnerSid must be one canonical Windows SID.' }
    if ($sid.Value -cne $Value) { throw 'AuthorityOwnerSid must be one canonical Windows SID.' }
    return $sid.Value
}

function Get-EasyFireMigrationBackupObjectSha256 {
    param([Parameter(Mandatory = $true)]$Value)

    $json = $Value | ConvertTo-Json -Depth 40 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha256.Dispose() }
}

function Assert-EasyFireMigrationBackupHash {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    if ($Value -notmatch '^[A-F0-9]{64}$') {
        throw "$FieldName must be one canonical uppercase SHA-256."
    }
}

function Assert-EasyFireMigrationBackupAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Migrated-runtime backup controller requires an elevated administrator token.'
        }
    } finally {
        $identity.Dispose()
    }
}

function Get-EasyFireMigrationBackupRolePolicy {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')]
        [string]$Role
    )

    switch ($Role) {
        'MigrationBaseline' {
            return [pscustomobject]@{
                RequiredState = 'CuttingOver'
                StartPhase = 'CutoverBaselineBackupRunning'
                BackupReadyPhase = 'CutoverBaselineBackupReady'
                RestoreVerifiedPhase = 'CutoverBaselineRestoreVerified'
                OneShot = $true
            }
        }
        'MigrationEmergency' {
            return [pscustomobject]@{
                RequiredState = 'Completed'
                StartPhase = 'EmergencyBackupRunning'
                BackupReadyPhase = 'EmergencyBackupReady'
                RestoreVerifiedPhase = 'EmergencyRestoreVerified'
                OneShot = $true
            }
        }
        'MigrationScheduled' {
            return [pscustomobject]@{
                RequiredState = 'Completed'
                StartPhase = 'Completed'
                BackupReadyPhase = 'Completed'
                RestoreVerifiedPhase = 'Completed'
                OneShot = $false
            }
        }
    }
}

function Get-EasyFireMigrationBackupJournalPath {
    param(
        [Parameter(Mandatory = $true)][string]$ExactAuthorityRoot,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId
    )

    return Join-Path (Join-Path (Join-Path $ExactAuthorityRoot 'migrations') $CanonicalMigrationId) `
        'migration.journal.json'
}

function Read-EasyFireMigrationBackupJournal {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExactAuthorityRoot
    )

    $resolved = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $ExactAuthorityRoot -MustExist
    if ($resolved -cne $Path) { throw 'Schema-2 migration journal path is not canonical.' }
    $read = Read-EasyFireMigrationJournal -JournalPath $resolved
    if ([string]$read.Journal.AuthorityRoot -cne $ExactAuthorityRoot) {
        throw 'Schema-2 migration journal AuthorityRoot does not match exact caller authority.'
    }
    return $read
}

function Assert-EasyFireMigrationBackupJournalBase {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)][string]$ExactAuthorityRoot,
        [Parameter(Mandatory = $true)]$Policy
    )

    $authority = Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'Authority'
    $authorityFingerprint = [string](Get-EasyFireMigrationBackupProperty -Object $authority `
        -Name 'Fingerprint' -Default '')
    if ([int](Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'SchemaVersion' -Default 0) -ne 2 -or
        [string](Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'MigrationId' -Default '') -cne
            $CanonicalMigrationId -or
        [string](Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'AuthorityRoot' -Default '') -cne
            $ExactAuthorityRoot -or
        [int64](Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'Revision' -Default 0) -lt 1 -or
        $authorityFingerprint -notmatch '^[A-F0-9]{64}$' -or
        -not $authority -or
        (Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'PreserveOriginals' -Default $false) -isnot [bool] -or
        -not [bool]$Journal.PreserveOriginals -or
        [string](Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'CurrentState' -Default '') -cne
            [string]$Policy.RequiredState) {
        throw 'Migrated-runtime backup requires one exact preservation-bound schema-2 journal.'
    }
    $phase = [string](Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'Phase' -Default '')
    if ($phase -notin @(
            [string]$Policy.StartPhase,
            [string]$Policy.BackupReadyPhase,
            [string]$Policy.RestoreVerifiedPhase
        )) {
        throw "Migrated-runtime backup role cannot run from phase: $phase"
    }
    return $authorityFingerprint
}

function Get-EasyFireMigrationBackupTargetImage {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][string]$Service
    )

    $images = @(Get-EasyFireMigrationBackupProperty -Object $Target -Name 'Images' -Default @())
    $matchingImages = @($images | Where-Object {
        [string](Get-EasyFireMigrationBackupProperty -Object $_ -Name 'Service' -Default '') -ceq $Service
    })
    if ($matchingImages.Count -ne 1 -or
        -not [string](Get-EasyFireMigrationBackupProperty -Object $matchingImages[0] -Name 'ImageReference' -Default '') -or
        [string](Get-EasyFireMigrationBackupProperty -Object $matchingImages[0] -Name 'ImageId' -Default '') -notmatch
            '^sha256:[a-f0-9]{64}$') {
        throw "Immutable target image authority is invalid for service: $Service"
    }
    return $matchingImages[0]
}

function Assert-EasyFireMigrationBackupTargetImageSet {
    param([Parameter(Mandatory = $true)]$Target)

    $expectedServices = @(
        'database_migration', 'envoy', 'gotenberg', 'mysql', 'redis', 'server', 'webapp'
    )
    $images = @(Get-EasyFireMigrationBackupProperty -Object $Target -Name 'Images' -Default @())
    $actualServices = @($images | ForEach-Object {
            [string](Get-EasyFireMigrationBackupProperty -Object $_ -Name 'Service' -Default '')
        } | Sort-Object)
    if ($images.Count -ne $expectedServices.Count -or
        @(Compare-Object $expectedServices $actualServices -CaseSensitive).Count -ne 0) {
        throw 'Immutable target image authority must contain exactly the seven expected services once.'
    }

    return @($expectedServices | ForEach-Object {
            Get-EasyFireMigrationBackupTargetImage -Target $Target -Service $_
        })
}

function Assert-EasyFireMigrationBackupDataStorageAuthority {
    param(
        [Parameter(Mandatory = $true)]$Container,
        [Parameter(Mandatory = $true)][string]$VolumeName,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Inventory', 'Inspect')][string]$Shape
    )

    $mounts = @($Container.Mounts)
    $hostPortCount = 0
    $mountSource = ''
    $mountReadWrite = $false
    if ($Shape -ceq 'Inventory') {
        $hostPortCount = @($Container.PortBindings | Where-Object { $null -ne $_ }).Count
        if ($mounts.Count -eq 1) {
            $mountSource = [string]$mounts[0].Source
            $mountReadWrite = [bool]$mounts[0].ReadWrite
        }
    } else {
        if ($null -eq $Container.HostConfig) {
            throw 'Migrated data-tier container is missing Docker host configuration.'
        }
        if ($Container.HostConfig.PortBindings) {
            foreach ($property in @($Container.HostConfig.PortBindings.PSObject.Properties)) {
                $hostPortCount += @($property.Value | Where-Object { $null -ne $_ }).Count
            }
        }
        if ($mounts.Count -eq 1) {
            $mountSource = [string]$mounts[0].Name
            $mountReadWrite = [bool]$mounts[0].RW
        }
    }
    if ($mounts.Count -ne 1 -or
        [string]$mounts[0].Type -cne 'volume' -or
        $mountSource -cne $VolumeName -or
        [string]$mounts[0].Destination -cne $Destination -or
        -not $mountReadWrite -or
        $hostPortCount -ne 0) {
        throw 'Migrated data-tier storage or host-port authority is not exact.'
    }
    return $mounts[0]
}

function Assert-EasyFireMigrationBackupServiceRuntimeContract {
    param(
        [Parameter(Mandatory = $true)]$Container,
        [Parameter(Mandatory = $true)]
        [ValidateSet('database_migration', 'envoy', 'gotenberg', 'mysql', 'redis', 'server', 'webapp')]
        [string]$Service,
        [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
        [Parameter(Mandatory = $true)][int]$LoopbackPort,
        [Parameter(Mandatory = $true)][string]$MysqlVolumeName,
        [Parameter(Mandatory = $true)][string]$RedisVolumeName
    )

    $canonicalReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
    if ($ReleaseDirectory -cne $canonicalReleaseDirectory -or
        $LoopbackPort -lt 1 -or $LoopbackPort -gt 65535) {
        throw 'Scheduled runtime topology requires one canonical release and valid loopback port.'
    }
    $mounts = @($Container.Mounts)
    $ports = @($Container.PortBindings | Where-Object { $null -ne $_ })
    $mount = $null

    switch ($Service) {
        'mysql' {
            $mount = Assert-EasyFireMigrationBackupDataStorageAuthority -Container $Container `
                -VolumeName $MysqlVolumeName -Destination '/var/lib/mysql' -Shape Inventory
        }
        'redis' {
            $mount = Assert-EasyFireMigrationBackupDataStorageAuthority -Container $Container `
                -VolumeName $RedisVolumeName -Destination '/data' -Shape Inventory
        }
        'envoy' {
            $expectedSource = [IO.Path]::GetFullPath(
                (Join-Path $canonicalReleaseDirectory 'docker\envoy\envoy.yaml')
            )
            if ($mounts.Count -ne 1 -or
                [string]$mounts[0].Type -cne 'bind' -or
                [string]$mounts[0].Source -cne $expectedSource -or
                [string]$mounts[0].Destination -cne '/etc/envoy/envoy.yaml' -or
                [string]$mounts[0].Mode -cne 'ro' -or
                [bool]$mounts[0].ReadWrite -or
                $ports.Count -ne 1 -or
                [string]$ports[0].ContainerPort -cne '80/tcp' -or
                [string]$ports[0].HostIp -cne '127.0.0.1' -or
                [string]$ports[0].HostPort -cne [string]$LoopbackPort) {
                throw 'Scheduled Envoy bind mount or loopback publication authority is not exact.'
            }
            $mount = $mounts[0]
        }
        default {
            if ($mounts.Count -ne 0 -or $ports.Count -ne 0) {
                throw "Scheduled service must have zero mounts and published ports: $Service"
            }
        }
    }

    return [pscustomobject][ordered]@{
        Service = $Service
        Mount = $mount
        PortBindings = $ports
    }
}

function Get-EasyFireMigrationBackupRuntimeAuthority {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)][string]$ExactAuthorityRoot,
        [Parameter(Mandatory = $true)][string]$AuthorityFingerprint,
        [Parameter(Mandatory = $true)][string]$ExactAuthorityOwnerSid,
        [Parameter(Mandatory = $true)][string]$Role
    )

    $authority = Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'Authority'
    $document = Get-EasyFireMigrationBackupProperty -Object $authority -Name 'Document'
    $target = if ($document) { Get-EasyFireMigrationBackupProperty -Object $document -Name 'Target' } else { $null }
    $source = if ($document) { Get-EasyFireMigrationBackupProperty -Object $document -Name 'Source' } else { $null }
    $lanes = Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'Lanes'
    $lane = if ($lanes) { Get-EasyFireMigrationBackupProperty -Object $lanes -Name 'Cutover' } else { $null }
    if (-not $target -or -not $lane) {
        throw 'Schema-2 journal is missing immutable target or Cutover lane authority.'
    }

    $projectName = [string](Get-EasyFireMigrationBackupProperty -Object $lane -Name 'ProjectName' -Default '')
    $token = $CanonicalMigrationId.Replace('-', '').Substring(0, 12)
    $expectedProjectName = "easyfire-bookkeeping-mig-c-$token"
    $sourceProjectName = [string](Get-EasyFireMigrationBackupProperty -Object $source -Name 'ProjectName' -Default '')
    if ($projectName -cne $expectedProjectName -or $projectName -ceq $sourceProjectName) {
        throw 'Cutover project identity is not the migration-derived, source-disjoint project.'
    }

    $releaseDirectory = [IO.Path]::GetFullPath(
        [string](Get-EasyFireMigrationBackupProperty -Object $target -Name 'ReleaseDirectory' -Default '')
    )
    $composeFile = [IO.Path]::GetFullPath(
        [string](Get-EasyFireMigrationBackupProperty -Object $target -Name 'ComposeFile' -Default '')
    )
    $composeOverrideFile = [IO.Path]::GetFullPath(
        [string](Get-EasyFireMigrationBackupProperty -Object $lane -Name 'ComposeOverrideFile' -Default '')
    )
    $envFile = [IO.Path]::GetFullPath(
        [string](Get-EasyFireMigrationBackupProperty -Object $lane -Name 'EnvironmentFile' -Default '')
    )
    $laneDirectory = [IO.Path]::GetFullPath(
        [string](Get-EasyFireMigrationBackupProperty -Object $lane -Name 'Directory' -Default '')
    )
    foreach ($directory in @($releaseDirectory, $laneDirectory)) {
        $resolved = Resolve-EasyFireContainedPath -Path $directory -AllowedRoot $ExactAuthorityRoot -MustExist
        if ($resolved -cne $directory -or -not (Test-Path -LiteralPath $directory -PathType Container) -or
            (Test-EasyFireReparsePoint -Path $directory)) {
            throw 'Migrated-runtime release or Cutover lane directory is unsafe.'
        }
    }
    foreach ($file in @($composeFile, $composeOverrideFile, $envFile)) {
        $resolved = Resolve-EasyFireContainedPath -Path $file -AllowedRoot $ExactAuthorityRoot -MustExist
        if ($resolved -cne $file -or -not (Test-Path -LiteralPath $file -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $file)) {
            throw 'Migrated-runtime Compose or environment file is unsafe.'
        }
    }
    $lanePrefix = $laneDirectory.TrimEnd('\') + '\'
    if (-not $composeOverrideFile.StartsWith($lanePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $envFile.StartsWith($lanePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $composeFile.StartsWith($releaseDirectory.TrimEnd('\') + '\',
            [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Migrated-runtime files are not contained by their immutable release and Cutover lane.'
    }
    $composeSha256 = Get-EasyFireSha256Hex -Path $composeFile
    $overrideSha256 = Get-EasyFireSha256Hex -Path $composeOverrideFile
    $envSha256 = Get-EasyFireSha256Hex -Path $envFile
    if ($composeSha256 -cne [string](Get-EasyFireMigrationBackupProperty -Object $target `
            -Name 'ComposeFileSha256' -Default '')) {
        throw 'Cutover ComposeFile no longer matches immutable target authority.'
    }

    $mysqlVolumeName = [string](Get-EasyFireMigrationBackupProperty -Object $lane `
        -Name 'MysqlVolumeName' -Default '')
    $redisVolumeName = [string](Get-EasyFireMigrationBackupProperty -Object $lane `
        -Name 'RedisVolumeName' -Default '')
    if ($mysqlVolumeName -cne "easyfire_mig_c_mysql_$token" -or
        $redisVolumeName -cne "easyfire_mig_c_redis_$token") {
        throw 'Cutover durable-volume names are not exact migration-derived authority.'
    }
    $inventory = Get-EasyFireComposeInventory -ProjectName $projectName `
        -ExactVolumeNames @($mysqlVolumeName, $redisVolumeName)
    if (@($inventory.ForeignVolumeConsumers).Count -ne 0) {
        throw 'Cutover durable volumes have foreign consumers.'
    }
    $expectedServices = @('database_migration', 'envoy', 'gotenberg', 'mysql', 'redis', 'server', 'webapp')
    $targetImages = @(Assert-EasyFireMigrationBackupTargetImageSet -Target $target)
    $actualServices = @($inventory.Containers | ForEach-Object { [string]$_.Service } | Sort-Object)
    if (@(Compare-Object $expectedServices $actualServices -CaseSensitive).Count -ne 0) {
        throw 'Cutover inventory does not contain exactly one container for every expected service.'
    }
    $volumeNames = @($inventory.Volumes | ForEach-Object { [string]$_.Name } | Sort-Object)
    $expectedVolumeNames = @($mysqlVolumeName, $redisVolumeName) | Sort-Object
    if (@(Compare-Object $expectedVolumeNames $volumeNames `
            -CaseSensitive).Count -ne 0) {
        throw 'Cutover inventory does not contain exactly the two migration-derived volumes.'
    }

    $laneContainers = Get-EasyFireMigrationBackupProperty -Object $lane -Name 'Containers'
    $containerProperties = [ordered]@{
        mysql = 'Mysql'
        redis = 'Redis'
        database_migration = 'DatabaseMigration'
        server = 'Server'
        webapp = 'Webapp'
        envoy = 'Envoy'
        gotenberg = 'Gotenberg'
    }
    foreach ($entry in $containerProperties.GetEnumerator()) {
        $container = @($inventory.Containers | Where-Object { [string]$_.Service -ceq [string]$entry.Key })
        $expectedName = [string](Get-EasyFireMigrationBackupProperty -Object $laneContainers `
            -Name ([string]$entry.Value) -Default '')
        if ($container.Count -ne 1 -or [string]$container[0].Name -cne $expectedName -or
            [string]$container[0].Project -cne $projectName) {
            throw "Cutover container identity drifted for service: $([string]$entry.Key)"
        }
    }

    foreach ($service in $expectedServices) {
        $expectedImage = @($targetImages | Where-Object {
                [string]$_.Service -ceq $service
            })[0]
        $container = @($inventory.Containers | Where-Object { [string]$_.Service -ceq $service })[0]
        if ([string]$container.ImageReference -cne [string]$expectedImage.ImageReference -or
            [string]$container.ImageId -cne [string]$expectedImage.ImageId) {
            throw "Cutover image identity drifted for service: $service"
        }
    }

    $loopbackPort = [int](Get-EasyFireMigrationBackupProperty -Object $lane -Name 'LoopbackPort' -Default 0)
    $envoyConfigFile = [IO.Path]::GetFullPath(
        (Join-Path $releaseDirectory 'docker\envoy\envoy.yaml')
    )
    $resolvedEnvoyConfig = Resolve-EasyFireContainedPath -Path $envoyConfigFile `
        -AllowedRoot $releaseDirectory -MustExist
    if ($resolvedEnvoyConfig -cne $envoyConfigFile -or
        -not (Test-Path -LiteralPath $envoyConfigFile -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $envoyConfigFile)) {
        throw 'Immutable release Envoy configuration authority is unsafe.'
    }
    $serviceContracts = [ordered]@{}
    foreach ($service in $expectedServices) {
        $container = @($inventory.Containers | Where-Object { [string]$_.Service -ceq $service })[0]
        $serviceContracts[$service] = Assert-EasyFireMigrationBackupServiceRuntimeContract `
            -Container $container -Service $service -ReleaseDirectory $releaseDirectory `
            -LoopbackPort $loopbackPort -MysqlVolumeName $mysqlVolumeName `
            -RedisVolumeName $redisVolumeName
    }

    $mysql = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })[0]
    $redis = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'redis' })[0]
    $mysqlMount = $serviceContracts['mysql'].Mount
    $redisMount = $serviceContracts['redis'].Mount
    $mysqlVolume = @($inventory.Volumes | Where-Object { [string]$_.Name -ceq $mysqlVolumeName })
    $redisVolume = @($inventory.Volumes | Where-Object { [string]$_.Name -ceq $redisVolumeName })
    if ([string]$mysql.State -cne 'running' -or [string]$mysql.Health -cne 'healthy' -or
        [string]$redis.State -cne 'running' -or [string]$redis.Health -cne 'healthy' -or
        $mysqlVolume.Count -ne 1 -or $redisVolume.Count -ne 1 -or
        [string]$mysqlVolume[0].Project -cne $projectName -or
        [string]$redisVolume[0].Project -cne $projectName -or
        [string]$mysqlVolume[0].LogicalName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$' -or
        [string]$redisVolume[0].LogicalName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') {
        throw 'Cutover MariaDB or Redis health and volume authority is not exact.'
    }

    $runtimeAuthority = [pscustomobject][ordered]@{
        SchemaVersion = 1
        MigrationId = $CanonicalMigrationId
        AuthorityRoot = $ExactAuthorityRoot
        AuthorityFingerprint = $AuthorityFingerprint
        AuthorityOwnerSid = $ExactAuthorityOwnerSid
        ProjectName = $projectName
        ReleaseId = [string](Get-EasyFireMigrationBackupProperty -Object $target -Name 'ReleaseId' -Default '')
        ReleaseDirectory = $releaseDirectory
        ComposeFile = $composeFile
        ComposeFileSha256 = $composeSha256
        ComposeOverrideFile = $composeOverrideFile
        ComposeOverrideSha256 = $overrideSha256
        EnvFile = $envFile
        EnvFileSha256 = $envSha256
        Inventory = $inventory
        InventoryFingerprint = Get-EasyFireInventoryFingerprint -Inventory $inventory
        DurableVolumeFingerprint = Get-EasyFireVolumeFingerprint -Volumes @($inventory.Volumes)
        Mysql = [pscustomobject][ordered]@{
            ContainerId = [string]$mysql.Id
            ContainerName = [string]$mysql.Name
            ImageReference = [string]$mysql.ImageReference
            ImageId = [string]$mysql.ImageId
            VolumeName = $mysqlVolumeName
            VolumeComposeKey = [string]$mysqlVolume[0].LogicalName
            VolumeDestination = [string]$mysqlMount.Destination
        }
        Redis = [pscustomobject][ordered]@{
            ContainerId = [string]$redis.Id
            ContainerName = [string]$redis.Name
            ImageReference = [string]$redis.ImageReference
            ImageId = [string]$redis.ImageId
            VolumeName = $redisVolumeName
            VolumeComposeKey = [string]$redisVolume[0].LogicalName
            VolumeDestination = [string]$redisMount.Destination
        }
    }

    if ($Role -in @('MigrationEmergency', 'MigrationScheduled')) {
        $completed = Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'CompletedAuthority'
        if (-not $completed -or [int]$completed.SchemaVersion -ne 1 -or
            [string]$completed.AuthorityOwnerSid -cne $ExactAuthorityOwnerSid -or
            [string]$completed.ProjectName -cne $projectName -or
            [string]$completed.ReleaseDirectory -cne $releaseDirectory -or
            [string]$completed.ComposeFile -cne $composeFile -or
            [string]$completed.ComposeFileSha256 -cne $composeSha256 -or
            [string]$completed.ComposeOverrideFile -cne $composeOverrideFile -or
            [string]$completed.ComposeOverrideSha256 -cne $overrideSha256 -or
            [string]$completed.EnvFile -cne $envFile -or
            [string]$completed.EnvFileSha256 -cne $envSha256 -or
            [string]$completed.InventoryFingerprint -cne [string]$runtimeAuthority.InventoryFingerprint -or
            [string]$completed.DurableVolumeFingerprint -cne [string]$runtimeAuthority.DurableVolumeFingerprint -or
            ($completed.Mysql | ConvertTo-Json -Depth 8 -Compress) -cne
                ($runtimeAuthority.Mysql | ConvertTo-Json -Depth 8 -Compress) -or
            ($completed.Redis | ConvertTo-Json -Depth 8 -Compress) -cne
                ($runtimeAuthority.Redis | ConvertTo-Json -Depth 8 -Compress) -or
            -not (Get-EasyFireMigrationBackupProperty -Object $completed -Name 'BaselineRecoveryUnit')) {
            throw 'Current runtime no longer matches immutable CompletedAuthority.'
        }
    }
    return $runtimeAuthority
}

function Get-EasyFireMigrationBackupEntry {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$Role
    )

    $receipts = Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'BackupReceipts'
    if (-not $receipts) {
        $receipts = [pscustomobject]@{}
        Set-EasyFireMigrationBackupProperty -Object $Journal -Name 'BackupReceipts' -Value $receipts
    }
    return Get-EasyFireMigrationBackupProperty -Object $receipts -Name $Role
}

function Set-EasyFireMigrationBackupEntry {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$Entry
    )

    $receipts = Get-EasyFireMigrationBackupProperty -Object $Journal -Name 'BackupReceipts'
    if (-not $receipts) {
        $receipts = [pscustomobject]@{}
        Set-EasyFireMigrationBackupProperty -Object $Journal -Name 'BackupReceipts' -Value $receipts
    }
    Set-EasyFireMigrationBackupProperty -Object $receipts -Name $Role -Value $Entry
}

function New-EasyFireMigrationBackupRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$Plan,
        $RecoveryUnit,
        $RestoreReceipt,
        $ExistingRecord
    )

    if ($Role -ceq 'MigrationScheduled') {
        $plans = @(if ($ExistingRecord) { @($ExistingRecord.Plan) } else { @() })
        $units = @(if ($ExistingRecord) { @($ExistingRecord.RecoveryUnit) } else { @() })
        $restores = @(if ($ExistingRecord) { @($ExistingRecord.RestoreReceipt) } else { @() })
        $operationId = [string]$Plan.BackupOperationId
        $index = -1
        for ($i = 0; $i -lt $plans.Count; $i++) {
            $candidateId = [string](Get-EasyFireMigrationBackupProperty -Object ($plans[$i]) `
                -Name 'BackupOperationId' -Default '')
            if ($candidateId -ceq $operationId) { $index = $i; break }
        }
        if ($index -lt 0) {
            if ($RecoveryUnit -or $RestoreReceipt) {
                throw 'Scheduled recovery evidence cannot precede its immutable plan.'
            }
            $plans += @($Plan)
        } else {
            $plans = @($plans | ForEach-Object {
                    $candidateId = [string](Get-EasyFireMigrationBackupProperty -Object $_ `
                        -Name 'BackupOperationId' -Default '')
                    if ($candidateId -ceq $operationId) { $Plan } else { $_ }
                })
            if ($RecoveryUnit) {
                if ($index -gt $units.Count) { throw 'Scheduled RecoveryUnit indexes are not aligned.' }
                if ($index -eq $units.Count) { $units += @($RecoveryUnit) }
                else {
                    $units = @($units | ForEach-Object {
                            $candidateId = [string](Get-EasyFireMigrationBackupProperty -Object $_ `
                                -Name 'BackupOperationId' -Default '')
                            if ($candidateId -ceq $operationId) { $RecoveryUnit } else { $_ }
                        })
                }
            }
            if ($RestoreReceipt) {
                if ($index -gt $restores.Count) { throw 'Scheduled RestoreReceipt indexes are not aligned.' }
                if ($index -eq $restores.Count) { $restores += @($RestoreReceipt) }
                else {
                    $restores = @($restores | ForEach-Object {
                            $candidateId = [string](Get-EasyFireMigrationBackupProperty -Object $_ `
                                -Name 'BackupOperationId' -Default '')
                            if ($candidateId -ceq $operationId) { $RestoreReceipt } else { $_ }
                        })
                }
            }
        }
        return [pscustomobject][ordered]@{
            Plan = @($plans)
            RecoveryUnit = @($units)
            RestoreReceipt = @($restores)
        }
    }

    return [pscustomobject][ordered]@{
        Plan = $Plan
        RecoveryUnit = $RecoveryUnit
        RestoreReceipt = $RestoreReceipt
    }
}

function Get-EasyFireMigrationActiveScheduledRecord {
    param($Record)

    if (-not $Record) { return $null }
    $plans = @($Record.Plan)
    $units = @($Record.RecoveryUnit)
    $restores = @($Record.RestoreReceipt)
    if ($plans.Count -eq 0 -or $plans.Count -eq $restores.Count) { return $null }
    if ($plans.Count -gt ($restores.Count + 1) -or $units.Count -gt $plans.Count -or
        $units.Count -lt $restores.Count) {
        throw 'Scheduled backup receipt arrays are not crash-resume aligned.'
    }
    $index = $plans.Count - 1
    return [pscustomobject]@{
        Plan = $plans[$index]
        RecoveryUnit = if ($units.Count -gt $index) { $units[$index] } else { $null }
        RestoreReceipt = if ($restores.Count -gt $index) { $restores[$index] } else { $null }
    }
}

function New-EasyFireMigrationBackupPlan {
    param(
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$RuntimeAuthority,
        [Parameter(Mandatory = $true)][string]$OperationId
    )

    $operation = ConvertTo-EasyFireMigrationBackupCanonicalGuid -Value $OperationId `
        -FieldName 'BackupOperationId'
    $applicationServices = @('envoy', 'gotenberg', 'server', 'webapp')
    $serviceAuthority = @()
    foreach ($service in $applicationServices) {
        $matches = @($RuntimeAuthority.Inventory.Containers | Where-Object {
                [string]$_.Service -ceq $service
            })
        if ($matches.Count -ne 1 -or [string]$matches[0].State -cne 'running' -or
            [string]$matches[0].Health -cne 'healthy') {
            throw "A new recovery plan requires one healthy running app service: $service"
        }
        $serviceAuthority += [pscustomobject][ordered]@{
            Service = $service
            ContainerId = [string]$matches[0].Id
            ContainerName = [string]$matches[0].Name
            ImageReference = [string]$matches[0].ImageReference
            ImageId = [string]$matches[0].ImageId
        }
    }
    $backupRoot = Join-Path ([string]$RuntimeAuthority.AuthorityRoot) 'backups'
    $projectName = [string]$RuntimeAuthority.ProjectName
    $rdbFile = Join-Path $backupRoot "redis-$projectName-full-$operation.rdb"
    $operationToken = $operation.Replace('-', '')
    $migrationToken = ([string]$RuntimeAuthority.MigrationId).Replace('-', '').Substring(0, 12)
    $verifierName = "easyfire-mig-redis-verify-$migrationToken-$($operationToken.Substring(0, 12))"
    return [pscustomobject][ordered]@{
        SchemaVersion = 1
        BackupOperationId = $operation
        InvocationRole = $Role
        BackupMode = 'full'
        State = 'active'
        StartedAtUtc = [DateTime]::UtcNow.ToString('o')
        CompletedAtUtc = ''
        RuntimeAuthority = $RuntimeAuthority
        RuntimeAuthorityFingerprint = Get-EasyFireMigrationBackupObjectSha256 -Value $RuntimeAuthority
        Quiescence = [pscustomobject][ordered]@{
            SchemaVersion = 1
            Required = $true
            Strategy = 'graceful-stop'
            Services = @($serviceAuthority | Sort-Object Service)
            RequiredExitedServices = @('database_migration')
        }
        RedisPublication = [pscustomobject][ordered]@{
            SchemaVersion = 1
            ArtifactPrefix = $rdbFile.Substring(0, $rdbFile.Length - 4)
            CaptureManifestFile = "$($rdbFile.Substring(0, $rdbFile.Length - 4)).composite.capture.json"
            VerifierContainerName = $verifierName
            VerifierVolumeName = "$verifierName-data"
        }
    }
}

function Assert-EasyFireMigrationBackupPlan {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$ExpectedRuntimeAuthority,
        [ValidateSet('active', 'completed')][string[]]$AllowedStates = @('active')
    )

    $operationId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string](Get-EasyFireMigrationBackupProperty -Object $Plan `
            -Name 'BackupOperationId' -Default '')) -FieldName 'BackupOperationId'
    $runtimeAuthority = Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'RuntimeAuthority'
    $runtimeFingerprint = [string](Get-EasyFireMigrationBackupProperty -Object $Plan `
        -Name 'RuntimeAuthorityFingerprint' -Default '')
    $quiescence = Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'Quiescence'
    $redisPublication = Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'RedisPublication'
    Assert-EasyFireMigrationBackupHash -Value $runtimeFingerprint `
        -FieldName 'RuntimeAuthorityFingerprint'
    if ([int](Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'SchemaVersion' -Default 0) -ne 1 -or
        [string](Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'InvocationRole' -Default '') -cne $Role -or
        [string](Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'BackupMode' -Default '') -cne 'full' -or
        [string](Get-EasyFireMigrationBackupProperty -Object $Plan -Name 'State' -Default '') -notin $AllowedStates -or
        -not $runtimeAuthority -or
        $runtimeFingerprint -cne (Get-EasyFireMigrationBackupObjectSha256 -Value $runtimeAuthority) -or
        ($runtimeAuthority | ConvertTo-Json -Depth 40 -Compress) -cne
            ($ExpectedRuntimeAuthority | ConvertTo-Json -Depth 40 -Compress)) {
        throw 'Migration backup plan does not match the exact role and runtime authority.'
    }
    $services = if ($quiescence) { @($quiescence.Services) } else { @() }
    $requiredExited = if ($quiescence) { @($quiescence.RequiredExitedServices) } else { @() }
    $serviceNames = @($services | ForEach-Object { [string]$_.Service } | Sort-Object)
    if (-not $quiescence -or [int]$quiescence.SchemaVersion -ne 1 -or
        $quiescence.Required -isnot [bool] -or -not [bool]$quiescence.Required -or
        [string]$quiescence.Strategy -cne 'graceful-stop' -or $services.Count -ne 4 -or
        $requiredExited.Count -ne 1 -or [string]$requiredExited[0] -cne 'database_migration' -or
        @(Compare-Object @('envoy', 'gotenberg', 'server', 'webapp') $serviceNames `
                -CaseSensitive).Count -ne 0 -or
        -not $redisPublication -or [int]$redisPublication.SchemaVersion -ne 1) {
        throw 'Migration backup plan consistency-boundary authority is invalid.'
    }
    foreach ($service in $services) {
        if ([string]$service.ContainerId -notmatch '^[a-f0-9]{64}$' -or
            -not [string]$service.ContainerName -or -not [string]$service.ImageReference -or
            [string]$service.ImageId -notmatch '^sha256:[a-f0-9]{64}$') {
            throw 'Migration backup plan app-tier identity is invalid.'
        }
    }
    $expectedBackupRoot = Join-Path ([string]$runtimeAuthority.AuthorityRoot) 'backups'
    foreach ($pathName in @('ArtifactPrefix', 'CaptureManifestFile')) {
        $path = [IO.Path]::GetFullPath([string]$redisPublication.$pathName)
        if (-not $path.StartsWith($expectedBackupRoot.TrimEnd('\') + '\',
                [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Migration Redis artifact authority escapes the exact backup root.'
        }
    }
    $expectedPrefix = Join-Path $expectedBackupRoot `
        "redis-$([string]$runtimeAuthority.ProjectName)-full-$operationId"
    if ([string]$redisPublication.ArtifactPrefix -cne $expectedPrefix -or
        [string]$redisPublication.CaptureManifestFile -cne "$expectedPrefix.composite.capture.json" -or
        [string]$redisPublication.VerifierContainerName -notmatch '^easyfire-mig-redis-verify-[a-f0-9]{12}-[a-f0-9]{12}$' -or
        [string]$redisPublication.VerifierVolumeName -cne
            "$([string]$redisPublication.VerifierContainerName)-data") {
        throw 'Migration Redis publication authority is not operation-derived.'
    }
    if ([string]$Plan.State -ceq 'active' -and [string]$Plan.CompletedAtUtc) {
        throw 'An active migration backup plan cannot have CompletedAtUtc.'
    }
    if ([string]$Plan.State -ceq 'completed') {
        try { $completed = [DateTimeOffset]::Parse([string]$Plan.CompletedAtUtc) }
        catch { throw 'A completed migration backup plan requires a valid CompletedAtUtc.' }
        if ($completed.Offset -ne [TimeSpan]::Zero) {
            throw 'CompletedAtUtc must be UTC.'
        }
    }
    return $operationId
}

function Complete-EasyFireMigrationBackupPlan {
    param([Parameter(Mandatory = $true)]$Plan)

    $completed = $Plan | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    Set-EasyFireMigrationBackupProperty -Object $completed -Name 'State' -Value 'completed'
    Set-EasyFireMigrationBackupProperty -Object $completed -Name 'CompletedAtUtc' `
        -Value ([DateTime]::UtcNow.ToString('o'))
    return $completed
}

function Assert-EasyFireMigrationRecoveryUnit {
    param(
        [Parameter(Mandatory = $true)]$RecoveryUnit,
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot
    )

    $operationId = [string]$Plan.BackupOperationId
    $mysqlUnit = Get-EasyFireMigrationBackupProperty -Object $RecoveryUnit -Name 'MariaDb'
    $redisUnit = Get-EasyFireMigrationBackupProperty -Object $RecoveryUnit -Name 'Redis'
    $boundary = Get-EasyFireMigrationBackupProperty -Object $RecoveryUnit -Name 'ConsistencyBoundary'
    $captureManifest = Get-EasyFireMigrationBackupProperty -Object $RecoveryUnit -Name 'CaptureManifest'
    $captureAttemptId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string](Get-EasyFireMigrationBackupProperty -Object $RecoveryUnit `
            -Name 'CaptureAttemptId' -Default '')) -FieldName 'CaptureAttemptId'
    $backupFile = [string](Get-EasyFireMigrationBackupProperty -Object $mysqlUnit `
        -Name 'BackupFile' -Default '')
    $expectedBackupFile = Join-Path $ExactBackupRoot `
        "mysql-$([string]$Plan.RuntimeAuthority.ProjectName)-full-$operationId-capture-$captureAttemptId.sql.gz"
    $metadataFile = $backupFile -replace '\.sql\.gz$', '.metadata.json'
    $pair = Test-EasyFireBackupPair -BackupFile $backupFile
    if (-not $pair.Valid -or $backupFile -cne $expectedBackupFile -or
        [string]$mysqlUnit.SidecarFile -cne [string]$pair.SidecarFile -or
        [string]$mysqlUnit.BackupSha256 -cne [string]$pair.Sha256 -or
        [string]$mysqlUnit.MetadataFile -cne $metadataFile -or
        -not (Test-Path -LiteralPath $metadataFile -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $metadataFile) -or
        [string]$mysqlUnit.MetadataSha256 -cne (Get-EasyFireSha256Hex -Path $metadataFile) -or
        [int](Get-EasyFireMigrationBackupProperty -Object $RecoveryUnit -Name 'SchemaVersion' -Default 0) -ne 2 -or
        [string]$RecoveryUnit.BackupOperationId -cne $operationId -or
        [string]$mysqlUnit.CaptureAttemptId -cne $captureAttemptId -or
        [string]$redisUnit.CaptureAttemptId -cne $captureAttemptId -or
        [string]$RecoveryUnit.InvocationRole -cne $Role -or
        [string]$RecoveryUnit.RuntimeAuthorityFingerprint -cne [string]$Plan.RuntimeAuthorityFingerprint -or
        -not $redisUnit -or -not $boundary -or -not $captureManifest -or
        [string]$captureManifest.Path -cne [string]$Plan.RedisPublication.CaptureManifestFile -or
        -not (Test-Path -LiteralPath ([string]$captureManifest.Path) -PathType Leaf) -or
        [string]$captureManifest.Sha256 -cne
            (Get-EasyFireSha256Hex -Path ([string]$captureManifest.Path))) {
        throw 'Migration recovery unit is incomplete or outside its exact candidate-project authority.'
    }
    try { $metadata = Get-Content -LiteralPath $metadataFile -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'Migration recovery-unit metadata is not valid JSON.' }
    if ([string]$metadata.InvocationRole -cne $Role -or
        [string]$metadata.BackupOperationId -cne $operationId -or
        [string]$metadata.CaptureAttemptId -cne $captureAttemptId -or
        [string]$metadata.ComposeProject -cne [string]$Plan.RuntimeAuthority.ProjectName -or
        [string]$metadata.MigrationId -cne [string]$Plan.RuntimeAuthority.MigrationId -or
        [string]$metadata.MigrationAuthorityFingerprint -cne
            [string]$Plan.RuntimeAuthority.AuthorityFingerprint -or
        [string]$metadata.MigrationBackupAuthorityFingerprint -cne
            [string]$Plan.RuntimeAuthorityFingerprint -or
        [string]$metadata.InventoryFingerprint -cne [string]$Plan.RuntimeAuthority.InventoryFingerprint -or
        [string]$metadata.DurableVolumeFingerprint -cne
            [string]$Plan.RuntimeAuthority.DurableVolumeFingerprint -or
        [string]$metadata.BackupFile -cne [string]$pair.BackupFile -or
        [string]$metadata.BackupSha256 -cne [string]$pair.Sha256) {
        throw 'Migration recovery-unit metadata does not match its exact journaled plan.'
    }
    $redisValidation = Assert-EasyFireMigrationRedisArtifact -RedisUnit $redisUnit -Plan $Plan -Role $Role
    $manifestValidation = Read-EasyFireMigrationCompositeCaptureManifest -Plan $Plan
    if (-not $manifestValidation -or [string]$manifestValidation.Sha256 -cne
        [string]$captureManifest.Sha256) {
        throw 'Migration recovery unit composite manifest authority is missing or changed.'
    }
    $null = Assert-EasyFireMigrationCompositeCaptureBinding `
        -CaptureManifest $manifestValidation -MariaDb $mysqlUnit -Redis $redisUnit -Plan $Plan
    if ([int](Get-EasyFireMigrationBackupProperty -Object $boundary -Name 'SchemaVersion' -Default 0) -ne 1 -or
        [string]$boundary.Kind -cne 'application-tier-stopped-v1' -or
        $boundary.ApplicationQuiesced -isnot [bool] -or -not [bool]$boundary.ApplicationQuiesced -or
        $boundary.RuntimeRestored -isnot [bool] -or -not [bool]$boundary.RuntimeRestored -or
        [string]$boundary.QuiescenceFingerprint -notmatch '^[A-F0-9]{64}$' -or
        [string]$boundary.QuiescenceFingerprint -cne [string]$redisUnit.QuiescenceFingerprint) {
        throw 'Migration recovery unit lacks exact quiescence and runtime-restoration evidence.'
    }
    return [pscustomobject]@{ Pair = $pair; Metadata = $metadata; Redis = $redisValidation }
}

function Assert-EasyFireMigrationRestoreReceipt {
    param(
        [Parameter(Mandatory = $true)]$Receipt,
        [Parameter(Mandatory = $true)]$RecoveryUnit,
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role
    )

    $mysqlReceipt = Get-EasyFireMigrationBackupProperty -Object $Receipt -Name 'MariaDb'
    $redisReceipt = Get-EasyFireMigrationBackupProperty -Object $Receipt -Name 'Redis'
    if ([int](Get-EasyFireMigrationBackupProperty -Object $Receipt -Name 'SchemaVersion' -Default 0) -ne 2 -or
        (Get-EasyFireMigrationBackupProperty -Object $Receipt -Name 'Passed' -Default $false) -isnot [bool] -or
        -not [bool]$Receipt.Passed -or [string]$Receipt.InvocationRole -cne $Role -or
        [string]$Receipt.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$Receipt.CaptureAttemptId -cne [string]$RecoveryUnit.CaptureAttemptId -or
        -not $mysqlReceipt -or -not $redisReceipt -or
        [string]$mysqlReceipt.Result -cne 'Passed' -or
        [string]$mysqlReceipt.AuthorityKind -cne 'migration-runtime' -or
        [string]$mysqlReceipt.MigrationId -cne [string]$Plan.RuntimeAuthority.MigrationId -or
        [string]$mysqlReceipt.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$mysqlReceipt.CaptureAttemptId -cne [string]$RecoveryUnit.CaptureAttemptId -or
        [string]$mysqlReceipt.BackupFile -cne [string]$RecoveryUnit.MariaDb.BackupFile -or
        [string]$mysqlReceipt.BackupSha256 -cne [string]$RecoveryUnit.MariaDb.BackupSha256 -or
        [string]$mysqlReceipt.MetadataFile -cne [string]$RecoveryUnit.MariaDb.MetadataFile -or
        [string]$mysqlReceipt.MetadataSha256 -cne [string]$RecoveryUnit.MariaDb.MetadataSha256 -or
        [string]$mysqlReceipt.NetworkMode -cne 'none' -or
        [string]$mysqlReceipt.VerifierImage -cne
            'mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577' -or
        (Get-EasyFireMigrationBackupProperty -Object $mysqlReceipt -Name 'CleanupPassed' -Default $false) -isnot [bool] -or
        -not [bool]$mysqlReceipt.CleanupPassed -or
        [string]$redisReceipt.Result -cne 'Passed' -or
        [string]$redisReceipt.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$redisReceipt.CaptureAttemptId -cne [string]$RecoveryUnit.CaptureAttemptId -or
        [string]$redisReceipt.RdbSha256 -cne [string]$RecoveryUnit.Redis.RdbSha256 -or
        [string]$redisReceipt.ImageId -cne [string]$Plan.RuntimeAuthority.Redis.ImageId -or
        [string]$redisReceipt.NetworkMode -cne 'none' -or [int]$redisReceipt.HostPortCount -ne 0 -or
        [int64]$redisReceipt.SourceTotalKeysObservation -ne [int64]$RecoveryUnit.Redis.TotalKeys -or
        (Get-EasyFireMigrationBackupProperty -Object $redisReceipt -Name 'CleanupPassed' -Default $false) -isnot [bool] -or
        -not [bool]$redisReceipt.CleanupPassed) {
        throw 'Isolated restore receipt does not match the exact migration recovery unit.'
    }
    $restoreObservations = Assert-EasyFireMigrationRedisRestoreObservations `
        -RedisUnit $RecoveryUnit.Redis `
        -LoadEvidence ([pscustomobject]@{
            KeysLoaded = [int64]$redisReceipt.RdbKeysLoaded
            KeysExpired = [int64]$redisReceipt.RdbKeysExpired
        }) -CurrentCounts ([pscustomobject]@{
            DatabaseCount = [int]$redisReceipt.DatabaseCount
            TotalKeys = [int64]$redisReceipt.TotalKeys
        })
    if ([int64]$redisReceipt.RdbKeysProcessed -ne [int64]$restoreObservations.RdbKeysProcessed -or
        (Get-EasyFireMigrationBackupProperty -Object $redisReceipt `
            -Name 'TtlExpiryObserved' -Default $null) -isnot [bool] -or
        [bool]$redisReceipt.TtlExpiryObserved -ne [bool]$restoreObservations.TtlExpiryObserved) {
        throw 'Isolated Redis restore receipt load accounting is not exact.'
    }
}

function Get-EasyFireMigrationStructuredOutput {
    param(
        [Parameter(Mandatory = $true)][object[]]$Output,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    $matches = @($Output | ForEach-Object { [string]$_ } | Where-Object {
        $_.StartsWith($Prefix, [StringComparison]::Ordinal)
    })
    if ($matches.Count -ne 1) { throw "$Kind did not emit one exact structured receipt." }
    try { return $matches[0].Substring($Prefix.Length) | ConvertFrom-Json }
    catch { throw "$Kind structured receipt is not valid JSON." }
}

function Get-EasyFireMigrationBackupWindowsPowerShell {
    $systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $path = [IO.Path]::GetFullPath(
        (Join-Path $systemDirectory 'WindowsPowerShell\v1.0\powershell.exe')
    )
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $path)) {
        throw 'Canonical Windows PowerShell is missing or unsafe.'
    }
    return $path
}

function Get-EasyFireMigrationBackupDockerObject {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('container', 'volume')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Identity,
        [switch]$AllowMissing
    )

    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $arguments = if ($Kind -ceq 'volume') {
            @('volume', 'inspect', $Identity)
        } else { @('inspect', $Identity) }
        $output = @(& docker @arguments 2>$null)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $saved }
    if ($exitCode -ne 0) {
        if ($AllowMissing) { return $null }
        throw "Exact Docker $Kind is missing: $Identity"
    }
    try { $parsed = ($output -join "`n") | ConvertFrom-Json }
    catch { throw "Docker $Kind inspect returned invalid JSON: $Identity" }
    $items = @($parsed)
    if ($items.Count -ne 1) { throw "Docker $Kind inspect was not unique: $Identity" }
    return $items[0]
}

function Assert-EasyFireMigrationAppServiceIdentity {
    param(
        [Parameter(Mandatory = $true)]$ServiceAuthority,
        [Parameter(Mandatory = $true)]$RuntimeAuthority,
        [ValidateSet('running', 'exited')][string]$ExpectedState
    )

    $item = Get-EasyFireMigrationBackupDockerObject -Kind container `
        -Identity ([string]$ServiceAuthority.ContainerId)
    $labels = $item.Config.Labels
    $health = [string](Get-EasyFireMigrationBackupProperty -Object $item.State.Health `
        -Name 'Status' -Default 'none')
    if ([string]$item.Id -cne [string]$ServiceAuthority.ContainerId -or
        ([string]$item.Name).TrimStart('/') -cne [string]$ServiceAuthority.ContainerName -or
        [string]$item.Config.Image -cne [string]$ServiceAuthority.ImageReference -or
        [string]$item.Image -cne [string]$ServiceAuthority.ImageId -or
        [string]$labels.'com.docker.compose.project' -cne [string]$RuntimeAuthority.ProjectName -or
        [string]$labels.'com.docker.compose.service' -cne [string]$ServiceAuthority.Service -or
        [string]$item.State.Status -cne $ExpectedState) {
        throw "App-tier authority or state drifted for service: $([string]$ServiceAuthority.Service)"
    }
    if ($ExpectedState -ceq 'running' -and $health -cne 'healthy') {
        throw "Restarted app-tier service is not healthy: $([string]$ServiceAuthority.Service)"
    }
    return $item
}

function Assert-EasyFireMigrationDataTierRunning {
    param([Parameter(Mandatory = $true)]$RuntimeAuthority)

    foreach ($name in @('Mysql', 'Redis')) {
        $authority = $RuntimeAuthority.$name
        $item = Get-EasyFireMigrationBackupDockerObject -Kind container `
            -Identity ([string]$authority.ContainerId)
        $labels = $item.Config.Labels
        $health = [string](Get-EasyFireMigrationBackupProperty -Object $item.State.Health `
            -Name 'Status' -Default 'none')
        $null = Assert-EasyFireMigrationBackupDataStorageAuthority -Container $item `
            -VolumeName ([string]$authority.VolumeName) `
            -Destination ([string]$authority.VolumeDestination) -Shape Inspect
        if ([string]$item.Id -cne [string]$authority.ContainerId -or
            ([string]$item.Name).TrimStart('/') -cne [string]$authority.ContainerName -or
            [string]$item.Config.Image -cne [string]$authority.ImageReference -or
            [string]$item.Image -cne [string]$authority.ImageId -or
            [string]$labels.'com.docker.compose.project' -cne [string]$RuntimeAuthority.ProjectName -or
            [string]$item.State.Status -cne 'running' -or $health -cne 'healthy') {
            throw "Migrated data-tier authority is not exact and healthy: $name"
        }
    }
    $expectedContainerIds = @($RuntimeAuthority.Inventory.Containers | ForEach-Object {
            [string]$_.Id
        } | Sort-Object -Unique)
    foreach ($networkAuthority in @($RuntimeAuthority.Inventory.Networks)) {
        # Network inspect is handled directly because container/volume are the only
        # resource kinds that the generic exact-cleanup helper is allowed to remove.
        $result = Invoke-EasyFireNative -FilePath 'docker' `
            -ArgumentList @('network', 'inspect', [string]$networkAuthority.Id)
        $parsed = @($result.Text | ConvertFrom-Json)
        if ($parsed.Count -ne 1 -or [string]$parsed[0].Name -cne [string]$networkAuthority.Name) {
            throw 'Migrated runtime network authority changed.'
        }
        $attached = @()
        if ($parsed[0].Containers) {
            foreach ($property in @($parsed[0].Containers.PSObject.Properties)) {
                $attached += [string]$property.Name
            }
        }
        if (@($attached | Where-Object { $_ -notin $expectedContainerIds }).Count -ne 0) {
            throw 'Migrated runtime network has a foreign endpoint during consistency capture.'
        }
    }
}

function Get-EasyFireMigrationQuiescenceFingerprint {
    param([Parameter(Mandatory = $true)]$Plan)

    $rows = @()
    foreach ($service in @($Plan.Quiescence.Services | Sort-Object Service)) {
        $item = Assert-EasyFireMigrationAppServiceIdentity -ServiceAuthority $service `
            -RuntimeAuthority $Plan.RuntimeAuthority -ExpectedState exited
        $rows += "$([string]$service.Service)|$([string]$item.Id)|$([string]$item.State.Status)|$([string]$item.State.FinishedAt)"
    }
    foreach ($serviceName in @($Plan.Quiescence.RequiredExitedServices | Sort-Object)) {
        $planned = @($Plan.RuntimeAuthority.Inventory.Containers | Where-Object {
                [string]$_.Service -ceq [string]$serviceName
            })
        if ($planned.Count -ne 1) {
            throw "Required exited service authority is not unique: $serviceName"
        }
        $authority = [pscustomobject]@{
            Service = [string]$planned[0].Service
            ContainerId = [string]$planned[0].Id
            ContainerName = [string]$planned[0].Name
            ImageReference = [string]$planned[0].ImageReference
            ImageId = [string]$planned[0].ImageId
        }
        $item = Assert-EasyFireMigrationAppServiceIdentity -ServiceAuthority $authority `
            -RuntimeAuthority $Plan.RuntimeAuthority -ExpectedState exited
        $rows += "$serviceName|$([string]$item.Id)|$([string]$item.State.Status)|$([string]$item.State.FinishedAt)"
    }
    Assert-EasyFireMigrationDataTierRunning -RuntimeAuthority $Plan.RuntimeAuthority
    $rows += "mysql|$([string]$Plan.RuntimeAuthority.Mysql.ContainerId)|running"
    $rows += "redis|$([string]$Plan.RuntimeAuthority.Redis.ContainerId)|running"
    return Get-EasyFireMigrationBackupObjectSha256 -Value @($rows)
}

function Stop-EasyFireMigrationBackupApplicationTier {
    param([Parameter(Mandatory = $true)]$Plan)

    foreach ($name in @('envoy', 'server', 'webapp', 'gotenberg')) {
        $service = @($Plan.Quiescence.Services | Where-Object { [string]$_.Service -ceq $name })
        if ($service.Count -ne 1) { throw "Quiescence service authority is not unique: $name" }
        $item = Get-EasyFireMigrationBackupDockerObject -Kind container `
            -Identity ([string]$service[0].ContainerId)
        if ([string]$item.State.Status -ceq 'running') {
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                'stop', '--time', '30', [string]$service[0].ContainerId
            )
        } elseif ([string]$item.State.Status -cne 'exited') {
            throw "Cannot safely quiesce app-tier service in state $([string]$item.State.Status): $name"
        }
        $null = Assert-EasyFireMigrationAppServiceIdentity -ServiceAuthority $service[0] `
            -RuntimeAuthority $Plan.RuntimeAuthority -ExpectedState exited
    }
    return Get-EasyFireMigrationQuiescenceFingerprint -Plan $Plan
}

function Start-EasyFireMigrationBackupApplicationTier {
    param([Parameter(Mandatory = $true)]$Plan)

    foreach ($name in @('gotenberg', 'webapp', 'server', 'envoy')) {
        $service = @($Plan.Quiescence.Services | Where-Object { [string]$_.Service -ceq $name })
        if ($service.Count -ne 1) { throw "Restart service authority is not unique: $name" }
        $item = Get-EasyFireMigrationBackupDockerObject -Kind container `
            -Identity ([string]$service[0].ContainerId)
        if ([string]$item.State.Status -ceq 'exited') {
            $null = Invoke-EasyFireNative -FilePath 'docker' `
                -ArgumentList @('start', [string]$service[0].ContainerId)
        } elseif ([string]$item.State.Status -cne 'running') {
            throw "Cannot safely restart app-tier service in state $([string]$item.State.Status): $name"
        }
        $deadline = [DateTime]::UtcNow.AddMinutes(5)
        do {
            $item = Get-EasyFireMigrationBackupDockerObject -Kind container `
                -Identity ([string]$service[0].ContainerId)
            $health = [string](Get-EasyFireMigrationBackupProperty -Object $item.State.Health `
                -Name 'Status' -Default 'none')
            if ([string]$item.State.Status -ceq 'running' -and $health -ceq 'healthy') { break }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        $null = Assert-EasyFireMigrationAppServiceIdentity -ServiceAuthority $service[0] `
            -RuntimeAuthority $Plan.RuntimeAuthority -ExpectedState running
    }
    Assert-EasyFireMigrationDataTierRunning -RuntimeAuthority $Plan.RuntimeAuthority
}

function Write-EasyFireMigrationBackupTextCreateNew {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Text)
    $stream = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
            [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Write-EasyFireMigrationBackupTextAtomicCreateNew {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$CandidateToken
    )

    $null = ConvertTo-EasyFireMigrationBackupCanonicalGuid -Value $CandidateToken `
        -FieldName 'CandidateToken'
    $exactPath = [IO.Path]::GetFullPath($Path)
    $candidate = "$exactPath.candidate-$CandidateToken.tmp"
    if ((Test-Path -LiteralPath $exactPath) -or (Test-Path -LiteralPath $candidate)) {
        throw 'Atomic CreateNew publication path already exists.'
    }
    Write-EasyFireMigrationBackupTextCreateNew -Path $candidate -Text $Text
    if ((Test-EasyFireReparsePoint -Path $candidate) -or
        [IO.File]::ReadAllText($candidate, [Text.Encoding]::UTF8) -cne $Text) {
        throw 'Atomic CreateNew candidate failed durable readback.'
    }
    [IO.File]::Move($candidate, $exactPath)
    if (-not (Test-Path -LiteralPath $exactPath -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $exactPath) -or
        [IO.File]::ReadAllText($exactPath, [Text.Encoding]::UTF8) -cne $Text) {
        throw 'Atomic CreateNew final file failed readback.'
    }
    return Get-EasyFireSha256Hex -Path $exactPath
}

function Get-EasyFireMigrationRedisAttemptPublication {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$CaptureAttemptId
    )

    $attempt = ConvertTo-EasyFireMigrationBackupCanonicalGuid -Value $CaptureAttemptId `
        -FieldName 'CaptureAttemptId'
    $prefix = [string]$Plan.RedisPublication.ArtifactPrefix
    $rdb = "$prefix.capture-$attempt.rdb"
    return [pscustomobject][ordered]@{
        CaptureAttemptId = $attempt
        RdbFile = $rdb
        SidecarFile = "$rdb.sha256"
        MetadataFile = "$rdb.redis.metadata.json"
    }
}

function Get-EasyFireMigrationRedisConfigValue {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerId,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $ContainerId, 'redis-cli', '--raw', 'CONFIG', 'GET', $Name
    )
    $lines = @($result.Output | ForEach-Object { [string]$_ })
    if ($lines.Count -ne 2 -or [string]$lines[0] -cne $Name) {
        throw "Redis CONFIG GET was not exact for: $Name"
    }
    return [string]$lines[1]
}

function Get-EasyFireMigrationRedisBoundary {
    param([Parameter(Mandatory = $true)][string]$ContainerId)

    $lua = "local c=redis.call('DBSIZE'); local i=redis.call('INFO','persistence'); return tostring(c)..'\n'..i"
    $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $ContainerId, 'redis-cli', '--raw', 'EVAL', $lua, '0'
    )
    $lines = @($result.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    if ($lines.Count -lt 2 -or [string]$lines[0] -notmatch '^\d+$') {
        throw 'Redis consistency-boundary output is malformed.'
    }
    $values = @{}
    foreach ($line in @($lines | Select-Object -Skip 1)) {
        if ($line -match '^([a-z0-9_]+):(.+)$') { $values[$Matches[1]] = $Matches[2] }
    }
    foreach ($required in @(
            'loading', 'rdb_changes_since_last_save', 'rdb_bgsave_in_progress',
            'rdb_last_bgsave_status', 'rdb_last_save_time'
        )) {
        if (-not $values.ContainsKey($required)) {
            throw "Redis consistency-boundary field is missing: $required"
        }
    }
    if ([string]$values.loading -notmatch '^[01]$' -or
        [string]$values.rdb_changes_since_last_save -notmatch '^\d+$' -or
        [string]$values.rdb_bgsave_in_progress -notmatch '^[01]$' -or
        [string]$values.rdb_last_save_time -notmatch '^\d+$') {
        throw 'Redis consistency-boundary numeric evidence is malformed.'
    }
    return [pscustomobject][ordered]@{
        KeyCountDb0 = [int64]$lines[0]
        Loading = [int]$values.loading
        ChangesSinceLastSave = [int64]$values.rdb_changes_since_last_save
        BackgroundSaveInProgress = [int]$values.rdb_bgsave_in_progress
        LastBackgroundSaveStatus = [string]$values.rdb_last_bgsave_status
        LastSaveUnix = [int64]$values.rdb_last_save_time
        ObservedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
}

function Get-EasyFireMigrationRedisDatabaseCounts {
    param([Parameter(Mandatory = $true)][string]$ContainerId)

    $databaseCountText = Get-EasyFireMigrationRedisConfigValue -ContainerId $ContainerId -Name 'databases'
    if ($databaseCountText -notmatch '^\d+$' -or [int]$databaseCountText -lt 1 -or
        [int]$databaseCountText -gt 1024) {
        throw 'Redis database-count authority is invalid.'
    }
    $counts = @()
    $total = [int64]0
    for ($database = 0; $database -lt [int]$databaseCountText; $database++) {
        $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'exec', $ContainerId, 'redis-cli', '--raw', '-n', [string]$database, 'DBSIZE'
        )
        $value = [string]($result.Output | Select-Object -Last 1)
        if ($value -notmatch '^\d+$') { throw "Redis DBSIZE is invalid for database $database." }
        $count = [int64]$value
        $total += $count
        $counts += [pscustomobject][ordered]@{ Database = $database; KeyCount = $count }
    }
    return [pscustomobject]@{
        DatabaseCount = [int]$databaseCountText
        Counts = @($counts)
        TotalKeys = $total
    }
}

function Read-EasyFireMigrationRedisMetadata {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $Path)) {
        throw 'Redis recovery metadata is missing or unsafe.'
    }
    try { $metadata = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'Redis recovery metadata is not valid JSON.' }
    $runtime = $Plan.RuntimeAuthority
    $captureAttemptId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string](Get-EasyFireMigrationBackupProperty -Object $metadata `
            -Name 'CaptureAttemptId' -Default '')) -FieldName 'CaptureAttemptId'
    $publication = Get-EasyFireMigrationRedisAttemptPublication -Plan $Plan `
        -CaptureAttemptId $captureAttemptId
    if ([int](Get-EasyFireMigrationBackupProperty -Object $metadata -Name 'SchemaVersion' -Default 0) -ne 1 -or
        [string]$metadata.MigrationId -cne [string]$runtime.MigrationId -or
        [string]$metadata.InvocationRole -cne $Role -or
        [string]$metadata.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$metadata.CaptureAttemptId -cne $captureAttemptId -or
        [string]$metadata.AuthorityRoot -cne [string]$runtime.AuthorityRoot -or
        [string]$metadata.MigrationJournalPath -cne
            (Get-EasyFireMigrationBackupJournalPath -ExactAuthorityRoot ([string]$runtime.AuthorityRoot) `
                -CanonicalMigrationId ([string]$runtime.MigrationId)) -or
        [string]$metadata.MigrationAuthorityFingerprint -cne [string]$runtime.AuthorityFingerprint -or
        [string]$metadata.MigrationBackupAuthorityFingerprint -cne [string]$Plan.RuntimeAuthorityFingerprint -or
        [string]$metadata.ComposeProject -cne [string]$runtime.ProjectName -or
        [string]$metadata.RedisContainerId -cne [string]$runtime.Redis.ContainerId -or
        [string]$metadata.RedisContainerName -cne [string]$runtime.Redis.ContainerName -or
        [string]$metadata.RedisImageReference -cne [string]$runtime.Redis.ImageReference -or
        [string]$metadata.RedisImageId -cne [string]$runtime.Redis.ImageId -or
        [string]$metadata.RedisVolumeName -cne [string]$runtime.Redis.VolumeName -or
        [string]$metadata.RedisVolumeDestination -cne [string]$runtime.Redis.VolumeDestination -or
        [string]$metadata.RedisVolumeComposeKey -cne [string]$runtime.Redis.VolumeComposeKey -or
        [string]$metadata.RdbFile -cne [string]$publication.RdbFile -or
        [string]$metadata.SidecarFile -cne [string]$publication.SidecarFile -or
        [string]$metadata.MetadataFile -cne [string]$publication.MetadataFile -or
        [string]$metadata.RdbSha256 -notmatch '^[A-F0-9]{64}$' -or
        [string]$metadata.QuiescenceFingerprint -notmatch '^[A-F0-9]{64}$') {
        throw 'Redis recovery metadata does not match the exact plan authority.'
    }
    return $metadata
}

function Get-EasyFireMigrationRedisContainerSha256 {
    param([Parameter(Mandatory = $true)][string]$ContainerId)

    $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $ContainerId, 'sha256sum', '/data/dump.rdb'
    )
    $line = [string]($result.Output | Select-Object -Last 1)
    if ($line -notmatch '^([a-f0-9]{64})\s+/data/dump\.rdb$') {
        throw 'Redis in-container RDB SHA-256 output is invalid.'
    }
    return $Matches[1].ToUpperInvariant()
}

function Publish-EasyFireMigrationRedisArtifact {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)][string]$QuiescenceFingerprint,
        [Parameter(Mandatory = $true)][string]$CaptureAttemptId
    )

    $runtime = $Plan.RuntimeAuthority
    $publication = Get-EasyFireMigrationRedisAttemptPublication -Plan $Plan `
        -CaptureAttemptId $CaptureAttemptId
    $backupRoot = Join-Path ([string]$runtime.AuthorityRoot) 'backups'
    foreach ($path in @($publication.RdbFile, $publication.SidecarFile, $publication.MetadataFile)) {
        $resolved = Resolve-EasyFireContainedPath -Path ([string]$path) -AllowedRoot $backupRoot
        if ($resolved -cne [string]$path) { throw 'Redis publication path is not canonical.' }
        if (Test-Path -LiteralPath $path) { throw 'Fresh Redis capture-attempt path already exists.' }
    }

    $redisId = [string]$runtime.Redis.ContainerId
    if ((Get-EasyFireMigrationRedisConfigValue -ContainerId $redisId -Name 'dir') -cne '/data' -or
        (Get-EasyFireMigrationRedisConfigValue -ContainerId $redisId -Name 'dbfilename') -cne 'dump.rdb' -or
        (Get-EasyFireMigrationRedisConfigValue -ContainerId $redisId -Name 'appendonly') -cne 'no') {
        throw 'Redis persistence configuration is not the exact RDB-only authority.'
    }
    $save = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $redisId, 'redis-cli', '--raw', 'SAVE'
    )
    if (@($save.Output).Count -ne 1 -or [string]$save.Output[0] -cne 'OK') {
        throw 'Redis synchronous SAVE did not emit one exact OK.'
    }
    $before = Get-EasyFireMigrationRedisBoundary -ContainerId $redisId
    if ($before.Loading -ne 0 -or $before.ChangesSinceLastSave -ne 0 -or
        $before.BackgroundSaveInProgress -ne 0 -or
        [string]$before.LastBackgroundSaveStatus -cne 'ok' -or $before.LastSaveUnix -le 0) {
        throw 'Redis did not establish a clean post-SAVE consistency boundary.'
    }
    $sourceCounts = Get-EasyFireMigrationRedisDatabaseCounts -ContainerId $redisId
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $redisId, 'redis-check-rdb', '/data/dump.rdb'
    )
    $containerHashBefore = Get-EasyFireMigrationRedisContainerSha256 -ContainerId $redisId
    $stagingFile = "$([string]$publication.RdbFile).partial"
    if (Test-Path -LiteralPath $stagingFile) {
        throw 'Capture-specific Redis staging path unexpectedly exists.'
    }
    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'cp', "${redisId}:/data/dump.rdb", $stagingFile
    )
    if (-not (Test-Path -LiteralPath $stagingFile -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $stagingFile)) {
        throw 'Redis RDB staging copy was not published safely.'
    }
    $localHash = Get-EasyFireSha256Hex -Path $stagingFile
    $containerHashAfter = Get-EasyFireMigrationRedisContainerSha256 -ContainerId $redisId
    $after = Get-EasyFireMigrationRedisBoundary -ContainerId $redisId
    $afterCounts = Get-EasyFireMigrationRedisDatabaseCounts -ContainerId $redisId
    if ($containerHashBefore -cne $localHash -or $containerHashAfter -cne $localHash -or
        $after.Loading -ne 0 -or $after.BackgroundSaveInProgress -ne 0 -or
        [string]$after.LastBackgroundSaveStatus -cne 'ok' -or
        $after.LastSaveUnix -ne $before.LastSaveUnix -or
        $after.ChangesSinceLastSave -ne 0) {
        throw 'Redis RDB or its quiesced persistence boundary changed during copy.'
    }
    [IO.File]::Move($stagingFile, [string]$publication.RdbFile)
    if ((Get-EasyFireSha256Hex -Path ([string]$publication.RdbFile)) -cne $localHash) {
        throw 'Atomically published Redis RDB failed hash readback.'
    }
    $sidecarText = "$localHash  $([IO.Path]::GetFileName([string]$publication.RdbFile))" +
        [Environment]::NewLine
    $null = Write-EasyFireMigrationBackupTextAtomicCreateNew `
        -Path ([string]$publication.SidecarFile) -Text $sidecarText `
        -CandidateToken ([string]$publication.CaptureAttemptId)
    $metadata = [pscustomobject][ordered]@{
        SchemaVersion = 1
        MigrationId = [string]$runtime.MigrationId
        InvocationRole = $Role
        BackupOperationId = [string]$Plan.BackupOperationId
        CaptureAttemptId = [string]$publication.CaptureAttemptId
        AuthorityRoot = [string]$runtime.AuthorityRoot
        MigrationJournalPath = Get-EasyFireMigrationBackupJournalPath `
            -ExactAuthorityRoot ([string]$runtime.AuthorityRoot) `
            -CanonicalMigrationId ([string]$runtime.MigrationId)
        MigrationAuthorityFingerprint = [string]$runtime.AuthorityFingerprint
        MigrationBackupAuthorityFingerprint = [string]$Plan.RuntimeAuthorityFingerprint
        ComposeProject = [string]$runtime.ProjectName
        RedisContainerId = [string]$runtime.Redis.ContainerId
        RedisContainerName = [string]$runtime.Redis.ContainerName
        RedisImageReference = [string]$runtime.Redis.ImageReference
        RedisImageId = [string]$runtime.Redis.ImageId
        RedisVolumeName = [string]$runtime.Redis.VolumeName
        RedisVolumeDestination = [string]$runtime.Redis.VolumeDestination
        RedisVolumeComposeKey = [string]$runtime.Redis.VolumeComposeKey
        RdbFile = [string]$publication.RdbFile
        SidecarFile = [string]$publication.SidecarFile
        MetadataFile = [string]$publication.MetadataFile
        RdbSha256 = $localHash
        RedisDatabaseCount = [int]$sourceCounts.DatabaseCount
        DatabaseKeyCounts = @($sourceCounts.Counts)
        TotalKeys = [int64]$sourceCounts.TotalKeys
        DatabaseKeyCountsAfterCopyObservation = @($afterCounts.Counts)
        TotalKeysAfterCopyObservation = [int64]$afterCounts.TotalKeys
        SourceLastSaveUnix = [int64]$before.LastSaveUnix
        QuiescenceFingerprint = $QuiescenceFingerprint
        BoundaryBeforeCopy = $before
        BoundaryAfterCopy = $after
        CapturedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    $metadataText = ($metadata | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    $null = Write-EasyFireMigrationBackupTextAtomicCreateNew `
        -Path ([string]$publication.MetadataFile) -Text $metadataText `
        -CandidateToken ([string]$publication.CaptureAttemptId)
    return Assert-EasyFireMigrationRedisArtifact -RedisUnit ([pscustomobject]@{
            CaptureAttemptId = [string]$publication.CaptureAttemptId
            RdbArtifact = [string]$publication.RdbFile
            RdbSidecar = [string]$publication.SidecarFile
            RdbMetadata = [string]$publication.MetadataFile
            RdbSha256 = $localHash
            RdbMetadataSha256 = Get-EasyFireSha256Hex -Path ([string]$publication.MetadataFile)
            ImageId = [string]$runtime.Redis.ImageId
            DatabaseCount = [int]$metadata.RedisDatabaseCount
            DatabaseKeyCounts = @($metadata.DatabaseKeyCounts)
            TotalKeys = [int64]$metadata.TotalKeys
            SourceLastSaveUnix = [int64]$metadata.SourceLastSaveUnix
            QuiescenceFingerprint = [string]$metadata.QuiescenceFingerprint
        }) -Plan $Plan -Role $Role
}

function Assert-EasyFireMigrationRedisArtifact {
    param(
        [Parameter(Mandatory = $true)]$RedisUnit,
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role
    )

    $captureAttemptId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string](Get-EasyFireMigrationBackupProperty -Object $RedisUnit `
            -Name 'CaptureAttemptId' -Default '')) -FieldName 'CaptureAttemptId'
    $publication = Get-EasyFireMigrationRedisAttemptPublication -Plan $Plan `
        -CaptureAttemptId $captureAttemptId
    $rdbFile = [string]$RedisUnit.RdbArtifact
    $sidecar = [string]$RedisUnit.RdbSidecar
    $metadataFile = [string]$RedisUnit.RdbMetadata
    if ($rdbFile -cne [string]$publication.RdbFile -or
        $sidecar -cne [string]$publication.SidecarFile -or
        $metadataFile -cne [string]$publication.MetadataFile -or
        -not (Test-Path -LiteralPath $rdbFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $sidecar -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $rdbFile) -or
        (Test-EasyFireReparsePoint -Path $sidecar)) {
        throw 'Redis recovery artifact set is missing or unsafe.'
    }
    $metadata = Read-EasyFireMigrationRedisMetadata -Path $metadataFile -Plan $Plan -Role $Role
    $actualHash = Get-EasyFireSha256Hex -Path $rdbFile
    $sidecarText = (Get-Content -LiteralPath $sidecar -Raw -Encoding utf8).Trim()
    $expectedSidecar = "$actualHash  $([IO.Path]::GetFileName($rdbFile))"
    if ($actualHash -cne [string]$metadata.RdbSha256 -or
        [string]$RedisUnit.CaptureAttemptId -cne $captureAttemptId -or
        [string]$metadata.CaptureAttemptId -cne $captureAttemptId -or
        $actualHash -cne [string]$RedisUnit.RdbSha256 -or
        $sidecarText -cne $expectedSidecar -or
        [string]$RedisUnit.RdbMetadataSha256 -cne (Get-EasyFireSha256Hex -Path $metadataFile) -or
        [string]$RedisUnit.ImageId -cne [string]$Plan.RuntimeAuthority.Redis.ImageId -or
        [int]$RedisUnit.DatabaseCount -ne [int]$metadata.RedisDatabaseCount -or
        [int64]$RedisUnit.TotalKeys -ne [int64]$metadata.TotalKeys -or
        (($RedisUnit.DatabaseKeyCounts | ConvertTo-Json -Compress) -cne
            ($metadata.DatabaseKeyCounts | ConvertTo-Json -Compress)) -or
        [string]$RedisUnit.QuiescenceFingerprint -cne [string]$metadata.QuiescenceFingerprint) {
        throw 'Redis recovery artifact hashes or metadata bindings do not match.'
    }
    return $RedisUnit
}

function Assert-EasyFireMigrationRedisVerifierLabels {
    param(
        [Parameter(Mandatory = $true)]$Labels,
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$AuthorityToken
    )

    if ([string]$Labels.'easyfire.restore.migration.id' -cne
            [string]$Plan.RuntimeAuthority.MigrationId -or
        [string]$Labels.'easyfire.restore.backup.operation.id' -cne
            [string]$Plan.BackupOperationId -or
        [string]$Labels.'easyfire.restore.authority' -cne $AuthorityToken -or
        [string]$Labels.'easyfire.restore.role' -cne 'redis-restore-verify') {
        throw 'Redis verifier labels do not match the exact recovery authority.'
    }
}

function Remove-EasyFireMigrationRedisVerifier {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$AuthorityToken
    )

    $containerName = [string]$Plan.RedisPublication.VerifierContainerName
    $volumeName = [string]$Plan.RedisPublication.VerifierVolumeName
    $container = Get-EasyFireMigrationBackupDockerObject -Kind container -Identity $containerName `
        -AllowMissing
    if ($container) {
        $containerId = [string]$container.Id
        if ($containerId -notmatch '^[a-f0-9]{64}$') {
            throw 'Existing Redis verifier container identity is not one canonical Docker ID.'
        }
        $containerReadback = Get-EasyFireMigrationBackupDockerObject -Kind container `
            -Identity $containerId
        if (-not $containerReadback -or [string]$containerReadback.Id -cne $containerId) {
            throw 'Existing Redis verifier container identity changed during exact readback.'
        }
        $container = $containerReadback
        Assert-EasyFireMigrationRedisVerifierLabels -Labels $container.Config.Labels `
            -Plan $Plan -AuthorityToken $AuthorityToken
        $mounts = @($container.Mounts)
        $hostPortCount = 0
        if ($container.HostConfig.PortBindings) {
            foreach ($property in @($container.HostConfig.PortBindings.PSObject.Properties)) {
                $hostPortCount += @($property.Value | Where-Object { $null -ne $_ }).Count
            }
        }
        if ([string]$container.Image -cne [string]$Plan.RuntimeAuthority.Redis.ImageId -or
            ([string]$container.Name).TrimStart('/') -cne $containerName -or
            [string]$container.HostConfig.NetworkMode -cne 'none' -or
            $hostPortCount -ne 0 -or $mounts.Count -ne 1 -or
            [string]$mounts[0].Type -cne 'volume' -or
            [string]$mounts[0].Name -cne $volumeName -or
            [string]$mounts[0].Destination -cne '/data') {
            throw 'Existing Redis verifier container identity is unsafe to remove.'
        }
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'rm', '-f', $containerId
        )
    }
    $volume = Get-EasyFireMigrationBackupDockerObject -Kind volume -Identity $volumeName -AllowMissing
    if ($volume) {
        Assert-EasyFireMigrationRedisVerifierLabels -Labels $volume.Labels `
            -Plan $Plan -AuthorityToken $AuthorityToken
        if ([string]$volume.Name -cne $volumeName -or [string]$volume.Driver -cne 'local' -or
            [string]$volume.Scope -cne 'local') {
            throw 'Existing Redis verifier volume identity is unsafe to remove.'
        }
        $null = Invoke-EasyFireNative -FilePath 'docker' `
            -ArgumentList @('volume', 'rm', $volumeName)
    }
}

function Get-EasyFireMigrationRedisLoadEvidence {
    param([Parameter(Mandatory = $true)][string]$ContainerId)

    $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'exec', $ContainerId, 'redis-cli', '--raw', 'INFO', 'persistence'
    )
    $values = @{}
    foreach ($line in @($result.Output | ForEach-Object { ([string]$_).Trim() })) {
        if ($line -match '^([a-z0-9_]+):(.+)$') { $values[$Matches[1]] = $Matches[2] }
    }
    foreach ($name in @('loading', 'rdb_last_load_keys_loaded', 'rdb_last_load_keys_expired')) {
        if (-not $values.ContainsKey($name) -or [string]$values[$name] -notmatch '^\d+$') {
            throw "Redis restore load evidence is missing or malformed: $name"
        }
    }
    if ([int]$values.loading -ne 0) { throw 'Redis verifier is still loading its RDB.' }
    return [pscustomobject]@{
        KeysLoaded = [int64]$values.rdb_last_load_keys_loaded
        KeysExpired = [int64]$values.rdb_last_load_keys_expired
    }
}

function Assert-EasyFireMigrationRedisRestoreObservations {
    param(
        [Parameter(Mandatory = $true)]$RedisUnit,
        [Parameter(Mandatory = $true)]$LoadEvidence,
        [Parameter(Mandatory = $true)]$CurrentCounts
    )

    $sourceObservedTotal = [int64]$RedisUnit.TotalKeys
    $keysLoaded = [int64]$LoadEvidence.KeysLoaded
    $keysExpired = [int64]$LoadEvidence.KeysExpired
    $currentObservedTotal = [int64]$CurrentCounts.TotalKeys
    if ([int]$CurrentCounts.DatabaseCount -ne [int]$RedisUnit.DatabaseCount -or
        $sourceObservedTotal -lt 0 -or $keysLoaded -lt 0 -or $keysExpired -lt 0 -or
        $currentObservedTotal -lt 0 -or
        $keysLoaded -gt ([int64]::MaxValue - $keysExpired)) {
        throw 'Redis restore observations are malformed or use incompatible database authority.'
    }
    $processedRdbKeys = $keysLoaded + $keysExpired
    if ($currentObservedTotal -gt $keysLoaded) {
        throw 'Redis restore load and expiry observations are internally inconsistent.'
    }
    return [pscustomobject][ordered]@{
        SourceTotalKeysObservation = $sourceObservedTotal
        RdbKeysProcessed = $processedRdbKeys
        CurrentTotalKeysObservation = $currentObservedTotal
        TtlExpiryObserved = [bool]($keysExpired -gt 0 -or $currentObservedTotal -lt $keysLoaded)
    }
}

function Invoke-EasyFireMigrationRedisRestoreVerification {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)]$RedisUnit
    )

    $null = Assert-EasyFireMigrationRedisArtifact -RedisUnit $RedisUnit -Plan $Plan `
        -Role ([string]$Plan.InvocationRole)
    $authorityToken = (Get-EasyFireMigrationBackupObjectSha256 -Value ([pscustomobject][ordered]@{
            MigrationId = [string]$Plan.RuntimeAuthority.MigrationId
            BackupOperationId = [string]$Plan.BackupOperationId
            RdbSha256 = [string]$RedisUnit.RdbSha256
        })).ToLowerInvariant()
    $containerName = [string]$Plan.RedisPublication.VerifierContainerName
    $volumeName = [string]$Plan.RedisPublication.VerifierVolumeName
    $labelArguments = @(
        '--label', "easyfire.restore.migration.id=$([string]$Plan.RuntimeAuthority.MigrationId)",
        '--label', "easyfire.restore.backup.operation.id=$([string]$Plan.BackupOperationId)",
        '--label', "easyfire.restore.authority=$authorityToken",
        '--label', 'easyfire.restore.role=redis-restore-verify'
    )
    $created = $false
    $cleanupPassed = $false
    $receipt = $null
    try {
        Remove-EasyFireMigrationRedisVerifier -Plan $Plan -AuthorityToken $authorityToken
        $volumeOutput = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList (
            @('volume', 'create', '--driver', 'local') + $labelArguments + @($volumeName)
        )
        if ([string]($volumeOutput.Output | Select-Object -Last 1) -cne $volumeName) {
            throw 'Redis verifier volume creation did not return the exact name.'
        }
        $volume = Get-EasyFireMigrationBackupDockerObject -Kind volume -Identity $volumeName
        Assert-EasyFireMigrationRedisVerifierLabels -Labels $volume.Labels -Plan $Plan `
            -AuthorityToken $authorityToken
        $create = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList (
            @('create', '--network', 'none', '--name', $containerName) + $labelArguments + @(
                '--mount', "type=volume,src=$volumeName,dst=/data",
                [string]$Plan.RuntimeAuthority.Redis.ImageId
            )
        )
        $containerId = [string]($create.Output | Select-Object -Last 1)
        if ($containerId -notmatch '^[a-f0-9]{64}$') {
            throw 'Redis verifier creation returned an invalid container ID.'
        }
        $created = $true
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'cp', [string]$RedisUnit.RdbArtifact, "${containerId}:/data/dump.rdb"
        )
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', $containerId)
        $ready = $false
        $deadline = [DateTime]::UtcNow.AddMinutes(2)
        do {
            $saved = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $ping = @(& docker exec $containerId redis-cli --raw PING 2>$null)
                $pingExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $saved }
            if ($pingExit -eq 0 -and @($ping).Count -eq 1 -and [string]$ping[0] -ceq 'PONG') {
                $ready = $true
                break
            }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not $ready) { throw 'Isolated Redis verifier did not become ready.' }
        $container = Get-EasyFireMigrationBackupDockerObject -Kind container -Identity $containerId
        Assert-EasyFireMigrationRedisVerifierLabels -Labels $container.Config.Labels -Plan $Plan `
            -AuthorityToken $authorityToken
        $allMounts = @($container.Mounts)
        $mounts = @($allMounts | Where-Object {
                [string]$_.Type -ceq 'volume' -and [string]$_.Destination -ceq '/data'
            })
        $hostPortCount = 0
        if ($container.HostConfig.PortBindings) {
            foreach ($property in @($container.HostConfig.PortBindings.PSObject.Properties)) {
                $hostPortCount += @($property.Value | Where-Object { $null -ne $_ }).Count
            }
        }
        if ([string]$container.Id -cne $containerId -or
            [string]$container.Image -cne [string]$Plan.RuntimeAuthority.Redis.ImageId -or
            [string]$container.HostConfig.NetworkMode -cne 'none' -or $hostPortCount -ne 0 -or
            $allMounts.Count -ne 1 -or $mounts.Count -ne 1 -or
            [string]$mounts[0].Name -cne $volumeName) {
            throw 'Redis verifier is not isolated by exact image, volume, and no-network authority.'
        }
        $load = Get-EasyFireMigrationRedisLoadEvidence -ContainerId $containerId
        $counts = Get-EasyFireMigrationRedisDatabaseCounts -ContainerId $containerId
        $observations = Assert-EasyFireMigrationRedisRestoreObservations -RedisUnit $RedisUnit `
            -LoadEvidence $load -CurrentCounts $counts
        $receipt = [pscustomobject][ordered]@{
            SchemaVersion = 1
            Result = 'Passed'
            BackupOperationId = [string]$Plan.BackupOperationId
            CaptureAttemptId = [string]$RedisUnit.CaptureAttemptId
            RdbArtifact = [string]$RedisUnit.RdbArtifact
            RdbSha256 = [string]$RedisUnit.RdbSha256
            ImageId = [string]$Plan.RuntimeAuthority.Redis.ImageId
            NetworkMode = 'none'
            HostPortCount = 0
            RdbKeysLoaded = [int64]$load.KeysLoaded
            RdbKeysExpired = [int64]$load.KeysExpired
            RdbKeysProcessed = [int64]$observations.RdbKeysProcessed
            SourceTotalKeysObservation = [int64]$observations.SourceTotalKeysObservation
            DatabaseCount = [int]$counts.DatabaseCount
            DatabaseKeyCounts = @($counts.Counts)
            TotalKeys = [int64]$counts.TotalKeys
            TtlExpiryObserved = [bool]$observations.TtlExpiryObserved
            VerifierContainerName = $containerName
            VerifierVolumeName = $volumeName
            CleanupPassed = $false
            VerifiedAtUtc = [DateTime]::UtcNow.ToString('o')
        }
    } finally {
        if ($created -or
            (Get-EasyFireMigrationBackupDockerObject -Kind container -Identity $containerName -AllowMissing) -or
            (Get-EasyFireMigrationBackupDockerObject -Kind volume -Identity $volumeName -AllowMissing)) {
            Remove-EasyFireMigrationRedisVerifier -Plan $Plan -AuthorityToken $authorityToken
        }
        $cleanupPassed = $true
    }
    if (-not $cleanupPassed -or -not $receipt) {
        throw 'Redis verifier did not complete exact cleanup and proof.'
    }
    Set-EasyFireMigrationBackupProperty -Object $receipt -Name 'CleanupPassed' -Value $true
    return $receipt
}

function Assert-EasyFireMigrationRuntimeAuthorityStable {
    param(
        [Parameter(Mandatory = $true)]$Planned,
        [Parameter(Mandatory = $true)]$Current
    )

    foreach ($name in @(
            'SchemaVersion', 'MigrationId', 'AuthorityRoot', 'AuthorityFingerprint',
            'AuthorityOwnerSid', 'ProjectName', 'ReleaseId', 'ReleaseDirectory',
            'ComposeFile', 'ComposeFileSha256', 'ComposeOverrideFile',
            'ComposeOverrideSha256', 'EnvFile', 'EnvFileSha256',
            'InventoryFingerprint', 'DurableVolumeFingerprint'
        )) {
        if ([string]$Planned.$name -cne [string]$Current.$name) {
            throw "Migrated runtime authority changed after the plan was persisted: $name"
        }
    }
    if (($Planned.Mysql | ConvertTo-Json -Depth 10 -Compress) -cne
            ($Current.Mysql | ConvertTo-Json -Depth 10 -Compress) -or
        ($Planned.Redis | ConvertTo-Json -Depth 10 -Compress) -cne
            ($Current.Redis | ConvertTo-Json -Depth 10 -Compress)) {
        throw 'Migrated data-tier authority changed after the plan was persisted.'
    }
    return $Planned
}

function Get-EasyFireMigrationBackupOperationStarted {
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)]$JournalRead,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $operationResult = Get-OrCreate-EasyFireMigrationOperation -JournalPath $JournalPath `
        -ExpectedJournalSha256 ([string]$JournalRead.Sha256) -Name $Name -Lane Cutover
    $operation = $operationResult.Operation
    $read = [pscustomobject]@{
        Journal = $operationResult.Journal
        Sha256 = $operationResult.Sha256
        Path = $operationResult.Path
    }
    if ([string]$operation.State -ceq 'Planned') {
        $authorized = Set-EasyFireMigrationOperationState -JournalPath $JournalPath `
            -ExpectedJournalSha256 ([string]$read.Sha256) `
            -OperationId ([string]$operation.OperationId) -ToState Authorized
        $operation = $authorized.Operation
        $read = [pscustomobject]@{ Journal=$authorized.Journal; Sha256=$authorized.Sha256; Path=$authorized.Path }
    }
    if ([string]$operation.State -ceq 'Authorized') {
        $started = Set-EasyFireMigrationOperationState -JournalPath $JournalPath `
            -ExpectedJournalSha256 ([string]$read.Sha256) `
            -OperationId ([string]$operation.OperationId) -ToState Started
        $operation = $started.Operation
        $read = [pscustomobject]@{ Journal=$started.Journal; Sha256=$started.Sha256; Path=$started.Path }
    }
    if ([string]$operation.State -notin @('Started', 'Completed')) {
        throw "Migration operation cannot resume from state: $([string]$operation.State)"
    }
    return [pscustomobject]@{ Read=$read; Operation=$operation }
}

function Complete-EasyFireMigrationBackupOperationIfNeeded {
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)]$JournalRead,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $result = Get-EasyFireMigrationBackupOperationStarted -JournalPath $JournalPath `
        -JournalRead $JournalRead -Name $Name
    if ([string]$result.Operation.State -ceq 'Completed') { return $result.Read }
    $completed = Set-EasyFireMigrationOperationState -JournalPath $JournalPath `
        -ExpectedJournalSha256 ([string]$result.Read.Sha256) `
        -OperationId ([string]$result.Operation.OperationId) -ToState Completed
    return [pscustomobject]@{
        Journal = $completed.Journal
        Sha256 = $completed.Sha256
        Path = $completed.Path
    }
}

function Get-EasyFireMigrationExistingReceiptEvidence {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Kind,
        [Parameter(Mandatory = $true)][string]$OperationId
    )

    $receiptRoot = Join-Path (Join-Path (Join-Path (Join-Path `
        ([string]$Plan.RuntimeAuthority.AuthorityRoot) 'migrations') `
        ([string]$Plan.RuntimeAuthority.MigrationId)) 'receipts') `
        "$($Kind.ToLowerInvariant())-$OperationId.json"
    if (-not (Test-Path -LiteralPath $receiptRoot -PathType Leaf)) { return $null }
    if (Test-EasyFireReparsePoint -Path $receiptRoot) {
        throw 'Existing migration receipt is a reparse point.'
    }
    try { $document = Get-Content -LiteralPath $receiptRoot -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'Existing migration receipt is not valid JSON.' }
    if ([string]$document.MigrationId -cne [string]$Plan.RuntimeAuthority.MigrationId -or
        [string]$document.AuthorityFingerprint -cne [string]$Plan.RuntimeAuthority.AuthorityFingerprint -or
        [string]$document.Lane -cne 'Cutover' -or [string]$document.Kind -cne $Kind -or
        [string]$document.OperationId -cne $OperationId -or
        $document.Passed -isnot [bool] -or -not [bool]$document.Passed) {
        throw 'Existing migration receipt does not match retry authority.'
    }
    return $document.Evidence
}

function Invoke-EasyFireMigrationMariaDbBackup {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][int]$ExactRetentionCount,
        [Parameter(Mandatory = $true)][string]$CaptureAttemptId
    )

    $runtime = $Plan.RuntimeAuthority
    $scriptPath = Join-Path $PSScriptRoot '..\..\scripts\production\backup.ps1'
    $powershell = Get-EasyFireMigrationBackupWindowsPowerShell
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath,
        '-ComposeFile', [string]$runtime.ComposeFile,
        '-ComposeOverrideFile', [string]$runtime.ComposeOverrideFile,
        '-EnvFile', [string]$runtime.EnvFile,
        '-ProjectName', [string]$runtime.ProjectName,
        '-BackupDir', (Join-Path ([string]$runtime.AuthorityRoot) 'backups'),
        '-AuthorityRoot', [string]$runtime.AuthorityRoot,
        '-BackupOperationId', [string]$Plan.BackupOperationId,
        '-InvocationRole', [string]$Plan.InvocationRole,
        '-MigrationId', [string]$runtime.MigrationId,
        '-MigrationJournalPath', $JournalPath,
        '-CaptureAttemptId', $CaptureAttemptId,
        '-RetentionCount', [string]$ExactRetentionCount
    )
    $output = @(& $powershell @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "MariaDB migrated-runtime backup failed (exit $exitCode): $($output -join ' ')"
    }
    $published = Get-EasyFireMigrationStructuredOutput -Output $output `
        -Prefix 'BACKUP_PUBLISHED ' -Kind 'MariaDB backup'
    if ([string]$published.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$published.CaptureAttemptId -cne $CaptureAttemptId -or
        [string]$published.InvocationRole -cne [string]$Plan.InvocationRole -or
        [string]$published.BackupMode -cne 'full' -or
        [string]$published.Sha256 -notmatch '^[A-F0-9]{64}$' -or
        [string]$published.MetadataSha256 -notmatch '^[A-F0-9]{64}$') {
        throw 'MariaDB backup structured receipt does not match the exact plan.'
    }
    $expectedBackupFile = Join-Path (Join-Path ([string]$runtime.AuthorityRoot) 'backups') `
        "mysql-$([string]$runtime.ProjectName)-full-$([string]$Plan.BackupOperationId)-capture-$CaptureAttemptId.sql.gz"
    if ([string]$published.BackupFile -cne $expectedBackupFile) {
        throw 'MariaDB backup path does not match the exact composite capture attempt.'
    }
    return [pscustomobject][ordered]@{
        BackupOperationId = [string]$published.BackupOperationId
        CaptureAttemptId = $CaptureAttemptId
        InvocationRole = [string]$published.InvocationRole
        BackupMode = [string]$published.BackupMode
        BackupFile = [string]$published.BackupFile
        SidecarFile = [string]$published.SidecarFile
        BackupSha256 = [string]$published.Sha256
        MetadataFile = [string]$published.MetadataFile
        MetadataSha256 = [string]$published.MetadataSha256
        Reused = [bool]$published.Reused
    }
}

function Get-OrCreate-EasyFireMigrationCompositeCaptureManifest {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)]$MariaDb,
        [Parameter(Mandatory = $true)]$Redis,
        [Parameter(Mandatory = $true)][string]$QuiescenceFingerprint,
        [Parameter(Mandatory = $true)][string]$CaptureAttemptId
    )

    $path = [string]$Plan.RedisPublication.CaptureManifestFile
    $expected = [pscustomobject][ordered]@{
        SchemaVersion = 1
        MigrationId = [string]$Plan.RuntimeAuthority.MigrationId
        BackupOperationId = [string]$Plan.BackupOperationId
        CaptureAttemptId = $CaptureAttemptId
        InvocationRole = [string]$Plan.InvocationRole
        RuntimeAuthorityFingerprint = [string]$Plan.RuntimeAuthorityFingerprint
        QuiescenceFingerprint = $QuiescenceFingerprint
        MariaDbBackupFile = [string]$MariaDb.BackupFile
        MariaDbBackupSha256 = [string]$MariaDb.BackupSha256
        MariaDbMetadataFile = [string]$MariaDb.MetadataFile
        MariaDbMetadataSha256 = [string]$MariaDb.MetadataSha256
        RedisRdbFile = [string]$Redis.RdbArtifact
        RedisRdbSha256 = [string]$Redis.RdbSha256
        RedisMetadataFile = [string]$Redis.RdbMetadata
        RedisMetadataSha256 = [string]$Redis.RdbMetadataSha256
        CapturedAtUtc = ''
    }
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        if (Test-EasyFireReparsePoint -Path $path) { throw 'Composite capture manifest is unsafe.' }
        try { $existing = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json }
        catch { throw 'Composite capture manifest is not valid JSON.' }
        foreach ($name in @($expected.PSObject.Properties.Name | Where-Object { $_ -cne 'CapturedAtUtc' })) {
            if ([string]$existing.$name -cne [string]$expected.$name) {
                throw "Composite capture manifest changed: $name"
            }
        }
        return [pscustomobject]@{ Document=$existing; Path=$path; Sha256=Get-EasyFireSha256Hex -Path $path; Reused=$true }
    }
    Set-EasyFireMigrationBackupProperty -Object $expected -Name 'CapturedAtUtc' `
        -Value ([DateTime]::UtcNow.ToString('o'))
    $null = Write-EasyFireMigrationBackupTextAtomicCreateNew -Path $path `
        -Text (($expected | ConvertTo-Json -Depth 8) + [Environment]::NewLine) `
        -CandidateToken $CaptureAttemptId
    return [pscustomobject]@{ Document=$expected; Path=$path; Sha256=Get-EasyFireSha256Hex -Path $path; Reused=$false }
}

function Read-EasyFireMigrationCompositeCaptureManifest {
    param([Parameter(Mandatory = $true)]$Plan)

    $path = [string]$Plan.RedisPublication.CaptureManifestFile
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    if (Test-EasyFireReparsePoint -Path $path) { throw 'Composite capture manifest is unsafe.' }
    try { $document = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'Composite capture manifest is not valid JSON.' }
    $captureAttemptId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string](Get-EasyFireMigrationBackupProperty -Object $document `
            -Name 'CaptureAttemptId' -Default '')) -FieldName 'CaptureAttemptId'
    $redisPublication = Get-EasyFireMigrationRedisAttemptPublication -Plan $Plan `
        -CaptureAttemptId $captureAttemptId
    $expectedMariaDb = Join-Path (Join-Path ([string]$Plan.RuntimeAuthority.AuthorityRoot) 'backups') `
        "mysql-$([string]$Plan.RuntimeAuthority.ProjectName)-full-$([string]$Plan.BackupOperationId)-capture-$captureAttemptId.sql.gz"
    $expectedMariaMetadata = $expectedMariaDb -replace '\.sql\.gz$', '.metadata.json'
    if ([int]$document.SchemaVersion -ne 1 -or
        [string]$document.MigrationId -cne [string]$Plan.RuntimeAuthority.MigrationId -or
        [string]$document.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$document.CaptureAttemptId -cne $captureAttemptId -or
        [string]$document.InvocationRole -cne [string]$Plan.InvocationRole -or
        [string]$document.RuntimeAuthorityFingerprint -cne [string]$Plan.RuntimeAuthorityFingerprint -or
        [string]$document.QuiescenceFingerprint -notmatch '^[A-F0-9]{64}$' -or
        [string]$document.MariaDbBackupSha256 -notmatch '^[A-F0-9]{64}$' -or
        [string]$document.MariaDbBackupFile -cne $expectedMariaDb -or
        [string]$document.MariaDbMetadataFile -cne $expectedMariaMetadata -or
        [string]$document.MariaDbMetadataSha256 -notmatch '^[A-F0-9]{64}$' -or
        [string]$document.RedisRdbFile -cne [string]$redisPublication.RdbFile -or
        [string]$document.RedisMetadataFile -cne [string]$redisPublication.MetadataFile -or
        [string]$document.RedisRdbSha256 -notmatch '^[A-F0-9]{64}$' -or
        [string]$document.RedisMetadataSha256 -notmatch '^[A-F0-9]{64}$') {
        throw 'Composite capture manifest does not match the exact plan.'
    }
    return [pscustomobject]@{ Document=$document; Path=$path; Sha256=Get-EasyFireSha256Hex -Path $path; Reused=$true }
}

function Assert-EasyFireMigrationCompositeCaptureBinding {
    param(
        [Parameter(Mandatory = $true)]$CaptureManifest,
        [Parameter(Mandatory = $true)]$MariaDb,
        [Parameter(Mandatory = $true)]$Redis,
        [Parameter(Mandatory = $true)]$Plan
    )

    $document = $CaptureManifest.Document
    $captureAttemptId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string]$document.CaptureAttemptId) -FieldName 'CaptureAttemptId'
    if ([string]$document.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$MariaDb.BackupOperationId -cne [string]$Plan.BackupOperationId -or
        [string]$MariaDb.CaptureAttemptId -cne $captureAttemptId -or
        [string]$Redis.CaptureAttemptId -cne $captureAttemptId -or
        [string]$document.QuiescenceFingerprint -cne [string]$Redis.QuiescenceFingerprint -or
        [string]$document.MariaDbBackupFile -cne [string]$MariaDb.BackupFile -or
        [string]$document.MariaDbBackupSha256 -cne [string]$MariaDb.BackupSha256 -or
        [string]$document.MariaDbMetadataFile -cne [string]$MariaDb.MetadataFile -or
        [string]$document.MariaDbMetadataSha256 -cne [string]$MariaDb.MetadataSha256 -or
        [string]$document.RedisRdbFile -cne [string]$Redis.RdbArtifact -or
        [string]$document.RedisRdbSha256 -cne [string]$Redis.RdbSha256 -or
        [string]$document.RedisMetadataFile -cne [string]$Redis.RdbMetadata -or
        [string]$document.RedisMetadataSha256 -cne [string]$Redis.RdbMetadataSha256) {
        throw 'Composite capture manifest does not bind the exact MariaDB and Redis attempt.'
    }
    return $CaptureManifest
}

function Get-EasyFireMigrationRedisUnitFromPublication {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$CaptureManifest
    )

    $document = $CaptureManifest.Document
    $publication = Get-EasyFireMigrationRedisAttemptPublication -Plan $Plan `
        -CaptureAttemptId ([string]$document.CaptureAttemptId)
    $metadata = Read-EasyFireMigrationRedisMetadata `
        -Path ([string]$publication.MetadataFile) -Plan $Plan -Role $Role
    $unit = [pscustomobject][ordered]@{
        CaptureAttemptId = [string]$document.CaptureAttemptId
        RdbArtifact = [string]$publication.RdbFile
        RdbSidecar = [string]$publication.SidecarFile
        RdbMetadata = [string]$publication.MetadataFile
        RdbSha256 = [string]$metadata.RdbSha256
        RdbMetadataSha256 = Get-EasyFireSha256Hex -Path ([string]$publication.MetadataFile)
        ImageId = [string]$Plan.RuntimeAuthority.Redis.ImageId
        DatabaseCount = [int]$metadata.RedisDatabaseCount
        DatabaseKeyCounts = @($metadata.DatabaseKeyCounts)
        TotalKeys = [int64]$metadata.TotalKeys
        SourceLastSaveUnix = [int64]$metadata.SourceLastSaveUnix
        QuiescenceFingerprint = [string]$metadata.QuiescenceFingerprint
    }
    return Assert-EasyFireMigrationRedisArtifact -RedisUnit $unit -Plan $Plan -Role $Role
}

function Get-EasyFireMigrationMariaDbUnitFromManifest {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)]$CaptureManifest
    )

    $document = $CaptureManifest.Document
    $captureAttemptId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value ([string]$document.CaptureAttemptId) -FieldName 'CaptureAttemptId'
    $backupFile = [string]$document.MariaDbBackupFile
    $expected = Join-Path (Join-Path ([string]$Plan.RuntimeAuthority.AuthorityRoot) 'backups') `
        "mysql-$([string]$Plan.RuntimeAuthority.ProjectName)-full-$([string]$Plan.BackupOperationId)-capture-$captureAttemptId.sql.gz"
    $pair = Test-EasyFireBackupPair -BackupFile $backupFile
    $metadataFile = $backupFile -replace '\.sql\.gz$', '.metadata.json'
    if (-not $pair.Valid -or $backupFile -cne $expected -or
        [string]$pair.Sha256 -cne [string]$document.MariaDbBackupSha256 -or
        -not (Test-Path -LiteralPath $metadataFile -PathType Leaf) -or
        (Get-EasyFireSha256Hex -Path $metadataFile) -cne [string]$document.MariaDbMetadataSha256) {
        throw 'Composite capture manifest MariaDB artifact is incomplete or changed.'
    }
    return [pscustomobject][ordered]@{
        BackupOperationId = [string]$Plan.BackupOperationId
        CaptureAttemptId = $captureAttemptId
        InvocationRole = [string]$Plan.InvocationRole
        BackupMode = 'full'
        BackupFile = $backupFile
        SidecarFile = [string]$pair.SidecarFile
        BackupSha256 = [string]$pair.Sha256
        MetadataFile = $metadataFile
        MetadataSha256 = Get-EasyFireSha256Hex -Path $metadataFile
        Reused = $true
    }
}

function New-EasyFireMigrationCompositeRecoveryUnit {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)]$MariaDb,
        [Parameter(Mandatory = $true)]$Redis,
        [Parameter(Mandatory = $true)][string]$QuiescenceFingerprint,
        [Parameter(Mandatory = $true)][string]$EnteredAtUtc,
        [Parameter(Mandatory = $true)][string]$ReleasedAtUtc,
        [Parameter(Mandatory = $true)]$CaptureManifest
    )

    if ([string]$MariaDb.CaptureAttemptId -cne [string]$Redis.CaptureAttemptId) {
        throw 'Composite recovery artifacts do not share one capture attempt.'
    }
    return [pscustomobject][ordered]@{
        SchemaVersion = 2
        BackupOperationId = [string]$Plan.BackupOperationId
        CaptureAttemptId = [string]$MariaDb.CaptureAttemptId
        InvocationRole = [string]$Plan.InvocationRole
        RuntimeAuthorityFingerprint = [string]$Plan.RuntimeAuthorityFingerprint
        MariaDb = $MariaDb
        Redis = $Redis
        CaptureManifest = [pscustomobject][ordered]@{
            Path = [string]$CaptureManifest.Path
            Sha256 = [string]$CaptureManifest.Sha256
        }
        ConsistencyBoundary = [pscustomobject][ordered]@{
            SchemaVersion = 1
            Kind = 'application-tier-stopped-v1'
            ApplicationQuiesced = $true
            QuiescenceFingerprint = $QuiescenceFingerprint
            RuntimeRestored = $true
            EnteredAtUtc = $EnteredAtUtc
            ReleasedAtUtc = $ReleasedAtUtc
        }
    }
}

function Invoke-EasyFireMigrationCompositeRestoreVerification {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)]$RecoveryUnit
    )

    $null = Assert-EasyFireMigrationRecoveryUnit -RecoveryUnit $RecoveryUnit -Plan $Plan `
        -Role ([string]$Plan.InvocationRole) `
        -ExactBackupRoot (Join-Path ([string]$Plan.RuntimeAuthority.AuthorityRoot) 'backups')
    $scriptPath = Join-Path $PSScriptRoot '..\..\scripts\production\restore-verify.ps1'
    $powershell = Get-EasyFireMigrationBackupWindowsPowerShell
    $output = @(& $powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath `
        -BackupFile ([string]$RecoveryUnit.MariaDb.BackupFile) `
        -EnvFile ([string]$Plan.RuntimeAuthority.EnvFile) 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "MariaDB isolated restore verification failed (exit $exitCode): $($output -join ' ')"
    }
    $mysqlReceipt = Get-EasyFireMigrationStructuredOutput -Output $output `
        -Prefix 'RESTORE_VERIFICATION_PASSED ' -Kind 'MariaDB restore verifier'
    $redisReceipt = Invoke-EasyFireMigrationRedisRestoreVerification -Plan $Plan `
        -RedisUnit $RecoveryUnit.Redis
    $receipt = [pscustomobject][ordered]@{
        SchemaVersion = 2
        BackupOperationId = [string]$Plan.BackupOperationId
        CaptureAttemptId = [string]$RecoveryUnit.CaptureAttemptId
        InvocationRole = [string]$Plan.InvocationRole
        Passed = $true
        MariaDb = $mysqlReceipt
        Redis = $redisReceipt
        VerifiedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    Assert-EasyFireMigrationRestoreReceipt -Receipt $receipt -RecoveryUnit $RecoveryUnit `
        -Plan $Plan -Role ([string]$Plan.InvocationRole)
    return $receipt
}

$productionMutex = $null
$productionMutexAcquired = $false
try {
    Assert-EasyFireMigrationBackupAdministrator
    $canonicalMigrationId = ConvertTo-EasyFireMigrationBackupCanonicalGuid `
        -Value $MigrationId -FieldName 'MigrationId'
    $exactAuthorityOwnerSid = ConvertTo-EasyFireMigrationBackupCanonicalSid `
        -Value $AuthorityOwnerSid
    $exactAuthorityRoot = [IO.Path]::GetFullPath($AuthorityRoot)
    if ($AuthorityRoot -cne $exactAuthorityRoot -or
        -not (Test-Path -LiteralPath $exactAuthorityRoot -PathType Container) -or
        (Test-EasyFireReparsePoint -Path $exactAuthorityRoot)) {
        throw 'AuthorityRoot must be one canonical existing regular directory.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $exactAuthorityRoot `
        -TrustedRoot $exactAuthorityRoot
    $backupRoot = Join-Path $exactAuthorityRoot 'backups'
    if (-not (Test-Path -LiteralPath $backupRoot -PathType Container) -or
        (Test-EasyFireReparsePoint -Path $backupRoot)) {
        throw 'The exact migrated-runtime backup root is missing or unsafe.'
    }
    $journalPath = Get-EasyFireMigrationBackupJournalPath -ExactAuthorityRoot $exactAuthorityRoot `
        -CanonicalMigrationId $canonicalMigrationId
    $policy = Get-EasyFireMigrationBackupRolePolicy -Role $InvocationRole

    $mutexName = Get-EasyFireProductionMutexName -ProductionRoot $exactAuthorityRoot
    $productionMutex = New-Object Threading.Mutex($false, $mutexName)
    try { $productionMutexAcquired = $productionMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $productionMutexAcquired = $true }
    if (-not $productionMutexAcquired) {
        throw 'Another production or migration controller owns the exact authority root.'
    }

    $read = Read-EasyFireMigrationBackupJournal -Path $journalPath `
        -ExactAuthorityRoot $exactAuthorityRoot
    $authorityFingerprint = Assert-EasyFireMigrationBackupJournalBase -Journal $read.Journal `
        -CanonicalMigrationId $canonicalMigrationId -ExactAuthorityRoot $exactAuthorityRoot `
        -Policy $policy
    $existingRecord = Get-EasyFireMigrationBackupEntry -Journal $read.Journal -Role $InvocationRole
    $active = if ($InvocationRole -ceq 'MigrationScheduled') {
        Get-EasyFireMigrationActiveScheduledRecord -Record $existingRecord
    } elseif ($existingRecord) {
        [pscustomobject]@{
            Plan = $existingRecord.Plan
            RecoveryUnit = $existingRecord.RecoveryUnit
            RestoreReceipt = $existingRecord.RestoreReceipt
        }
    } else { $null }

    $backupOperation = $null
    if (-not $active) {
        if ($InvocationRole -ceq 'MigrationScheduled') {
            $operationId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
        } else {
            $operationResult = Get-EasyFireMigrationBackupOperationStarted `
                -JournalPath $journalPath -JournalRead $read -Name $InvocationRole
            $backupOperation = $operationResult.Operation
            $read = $operationResult.Read
            $operationId = [string]$backupOperation.OperationId
        }
        $runtimeAuthority = Get-EasyFireMigrationBackupRuntimeAuthority -Journal $read.Journal `
            -CanonicalMigrationId $canonicalMigrationId -ExactAuthorityRoot $exactAuthorityRoot `
            -AuthorityFingerprint $authorityFingerprint -ExactAuthorityOwnerSid $exactAuthorityOwnerSid `
            -Role $InvocationRole
        $plan = New-EasyFireMigrationBackupPlan -Role $InvocationRole `
            -RuntimeAuthority $runtimeAuthority -OperationId $operationId
        $null = Assert-EasyFireMigrationBackupPlan -Plan $plan -Role $InvocationRole `
            -ExpectedRuntimeAuthority $runtimeAuthority -AllowedStates active
        $plannedRecord = New-EasyFireMigrationBackupRecord -Role $InvocationRole `
            -Plan $plan -RecoveryUnit $null -RestoreReceipt $null -ExistingRecord $existingRecord
        if ($InvocationRole -ceq 'MigrationScheduled') {
            $saved = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) -BackupReceipt $plannedRecord
        } else {
            $saved = Save-EasyFireMigrationBackupPlan -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) `
                -BackupReceiptRole $InvocationRole -Plan $plan
        }
        $read = [pscustomobject]@{ Journal=$saved.Journal; Sha256=$saved.Sha256; Path=$saved.Path }
        $existingRecord = Get-EasyFireMigrationBackupEntry -Journal $read.Journal -Role $InvocationRole
        $active = [pscustomobject]@{ Plan=$plan; RecoveryUnit=$null; RestoreReceipt=$null }
    } else {
        $plan = $active.Plan
        $currentAuthority = Get-EasyFireMigrationBackupRuntimeAuthority -Journal $read.Journal `
            -CanonicalMigrationId $canonicalMigrationId -ExactAuthorityRoot $exactAuthorityRoot `
            -AuthorityFingerprint $authorityFingerprint -ExactAuthorityOwnerSid $exactAuthorityOwnerSid `
            -Role $InvocationRole
        $null = Assert-EasyFireMigrationRuntimeAuthorityStable `
            -Planned $plan.RuntimeAuthority -Current $currentAuthority
        $null = Assert-EasyFireMigrationBackupPlan -Plan $plan -Role $InvocationRole `
            -ExpectedRuntimeAuthority $plan.RuntimeAuthority -AllowedStates @('active', 'completed')
        if ($InvocationRole -cne 'MigrationScheduled') {
            $operationResult = Get-EasyFireMigrationBackupOperationStarted `
                -JournalPath $journalPath -JournalRead $read -Name $InvocationRole
            $backupOperation = $operationResult.Operation
            $read = $operationResult.Read
            if ([string]$backupOperation.OperationId -cne [string]$plan.BackupOperationId) {
                throw 'Journaled backup operation no longer matches the immutable plan.'
            }
        }
    }

    if ($active.RestoreReceipt) {
        $null = Assert-EasyFireMigrationRecoveryUnit -RecoveryUnit $active.RecoveryUnit `
            -Plan $plan -Role $InvocationRole -ExactBackupRoot $backupRoot
        Assert-EasyFireMigrationRestoreReceipt -Receipt $active.RestoreReceipt `
            -RecoveryUnit $active.RecoveryUnit -Plan $plan -Role $InvocationRole
        if ($InvocationRole -cne 'MigrationScheduled') {
            $read = Complete-EasyFireMigrationBackupOperationIfNeeded -JournalPath $journalPath `
                -JournalRead $read -Name $InvocationRole
            $read = Complete-EasyFireMigrationBackupOperationIfNeeded -JournalPath $journalPath `
                -JournalRead $read -Name "${InvocationRole}Restore"
        }
        $result = [pscustomobject][ordered]@{
            SchemaVersion = 1
            MigrationId = $canonicalMigrationId
            InvocationRole = $InvocationRole
            BackupOperationId = [string]$plan.BackupOperationId
            RecoveryUnit = $active.RecoveryUnit
            RestoreReceipt = $active.RestoreReceipt
            Reused = $true
        }
        Write-Output ('MIGRATION_BACKUP_PASSED ' + ($result | ConvertTo-Json -Depth 20 -Compress))
        return
    }

    $recoveryUnit = $active.RecoveryUnit
    if (-not $recoveryUnit) {
        $captureManifest = Read-EasyFireMigrationCompositeCaptureManifest -Plan $plan
        $enteredAtUtc = [DateTime]::UtcNow.ToString('o')
        $releasedAtUtc = ''
        $quiesced = $false
        $captureFailure = $null
        $restartFailure = $null
            try {
                if ($captureManifest) {
                    $captureAttemptId = [string]$captureManifest.Document.CaptureAttemptId
                    $quiescenceFingerprint = [string]$captureManifest.Document.QuiescenceFingerprint
                    $redisUnit = Get-EasyFireMigrationRedisUnitFromPublication -Plan $plan `
                        -Role $InvocationRole -CaptureManifest $captureManifest
                    $mariaDbUnit = Get-EasyFireMigrationMariaDbUnitFromManifest -Plan $plan `
                        -CaptureManifest $captureManifest
                    $null = Assert-EasyFireMigrationCompositeCaptureBinding `
                        -CaptureManifest $captureManifest -MariaDb $mariaDbUnit `
                        -Redis $redisUnit -Plan $plan
                } else {
                    $captureAttemptId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
                    $quiescenceFingerprint = Stop-EasyFireMigrationBackupApplicationTier -Plan $plan
                    $quiesced = $true
                    $redisUnit = Publish-EasyFireMigrationRedisArtifact -Plan $plan `
                        -Role $InvocationRole -QuiescenceFingerprint $quiescenceFingerprint `
                        -CaptureAttemptId $captureAttemptId
                    $mariaDbUnit = Invoke-EasyFireMigrationMariaDbBackup -Plan $plan `
                        -JournalPath $journalPath -ExactRetentionCount $RetentionCount `
                        -CaptureAttemptId $captureAttemptId
                    $captureManifest = Get-OrCreate-EasyFireMigrationCompositeCaptureManifest `
                        -Plan $plan -MariaDb $mariaDbUnit -Redis $redisUnit `
                        -QuiescenceFingerprint $quiescenceFingerprint `
                        -CaptureAttemptId $captureAttemptId
                    $null = Assert-EasyFireMigrationCompositeCaptureBinding `
                        -CaptureManifest $captureManifest -MariaDb $mariaDbUnit `
                        -Redis $redisUnit -Plan $plan
            }
        } catch { $captureFailure = $_ }
        finally {
            try {
                Start-EasyFireMigrationBackupApplicationTier -Plan $plan
                $releasedAtUtc = [DateTime]::UtcNow.ToString('o')
            } catch { $restartFailure = $_ }
        }
        if ($restartFailure) {
            throw "App-tier fail-safe restart proof failed: $($restartFailure.Exception.Message)"
        }
        if ($captureFailure) { throw $captureFailure }
        if (-not $captureManifest -or -not $releasedAtUtc) {
            throw 'Composite capture did not prove both artifacts and runtime restoration.'
        }
        if (-not $quiesced) {
            $enteredAtUtc = [string]$redisUnit.QuiescenceFingerprint
                try {
                    $redisMetadata = Read-EasyFireMigrationRedisMetadata `
                        -Path ([string]$redisUnit.RdbMetadata) -Plan $plan -Role $InvocationRole
                $enteredAtUtc = [string]$redisMetadata.BoundaryBeforeCopy.ObservedAtUtc
            } catch { throw 'Recovered composite capture lacks its original boundary timestamp.' }
        }
        $recoveryUnit = New-EasyFireMigrationCompositeRecoveryUnit -Plan $plan `
            -MariaDb $mariaDbUnit -Redis $redisUnit `
            -QuiescenceFingerprint $quiescenceFingerprint `
            -EnteredAtUtc $enteredAtUtc -ReleasedAtUtc $releasedAtUtc `
            -CaptureManifest $captureManifest
        $null = Assert-EasyFireMigrationRecoveryUnit -RecoveryUnit $recoveryUnit `
            -Plan $plan -Role $InvocationRole -ExactBackupRoot $backupRoot

        $recordWithRecovery = New-EasyFireMigrationBackupRecord -Role $InvocationRole `
            -Plan $plan -RecoveryUnit $recoveryUnit -RestoreReceipt $null `
            -ExistingRecord $existingRecord
        if ($InvocationRole -ceq 'MigrationScheduled') {
            $saved = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) -BackupReceipt $recordWithRecovery
        } else {
            $existingEvidence = Get-EasyFireMigrationExistingReceiptEvidence -Plan $plan `
                -Kind $InvocationRole -OperationId ([string]$backupOperation.OperationId)
            $evidence = if ($existingEvidence) { $existingEvidence } else { $recoveryUnit }
            if (($evidence | ConvertTo-Json -Depth 30 -Compress) -cne
                ($recoveryUnit | ConvertTo-Json -Depth 30 -Compress)) {
                throw 'Existing backup transition receipt differs from the composite recovery unit.'
            }
            $binding = Write-EasyFireMigrationReceipt -AuthorityRoot $exactAuthorityRoot `
                -MigrationId $canonicalMigrationId -AuthorityFingerprint $authorityFingerprint `
                -Lane Cutover -Kind $InvocationRole `
                -OperationId ([string]$backupOperation.OperationId) -Evidence $recoveryUnit
            $saved = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) `
                -ToState ([string]$policy.RequiredState) `
                -ToPhase ([string]$policy.BackupReadyPhase) -ReceiptBinding $binding `
                -BackupReceiptRole $InvocationRole -BackupReceipt $recordWithRecovery
        }
        $read = [pscustomobject]@{ Journal=$saved.Journal; Sha256=$saved.Sha256; Path=$saved.Path }
        $existingRecord = Get-EasyFireMigrationBackupEntry -Journal $read.Journal -Role $InvocationRole
    } else {
        $null = Assert-EasyFireMigrationRecoveryUnit -RecoveryUnit $recoveryUnit `
            -Plan $plan -Role $InvocationRole -ExactBackupRoot $backupRoot
    }
    if ($InvocationRole -cne 'MigrationScheduled') {
        $read = Complete-EasyFireMigrationBackupOperationIfNeeded -JournalPath $journalPath `
            -JournalRead $read -Name $InvocationRole
    }

    $restoreReceipt = $active.RestoreReceipt
    if (-not $restoreReceipt) {
        $restoreOperation = $null
        if ($InvocationRole -cne 'MigrationScheduled') {
            $restoreName = "${InvocationRole}Restore"
            $operationResult = Get-EasyFireMigrationBackupOperationStarted `
                -JournalPath $journalPath -JournalRead $read -Name $restoreName
            $restoreOperation = $operationResult.Operation
            $read = $operationResult.Read
        }
        $existingRestoreEvidence = if ($restoreOperation) {
            Get-EasyFireMigrationExistingReceiptEvidence -Plan $plan `
                -Kind $restoreName -OperationId ([string]$restoreOperation.OperationId)
        } else { $null }
        if ($existingRestoreEvidence) {
            $restoreReceipt = $existingRestoreEvidence
            Assert-EasyFireMigrationRestoreReceipt -Receipt $restoreReceipt `
                -RecoveryUnit $recoveryUnit -Plan $plan -Role $InvocationRole
        } else {
            $restoreReceipt = Invoke-EasyFireMigrationCompositeRestoreVerification `
                -Plan $plan -RecoveryUnit $recoveryUnit
        }
        $completedPlan = Complete-EasyFireMigrationBackupPlan -Plan $plan
        $null = Assert-EasyFireMigrationBackupPlan -Plan $completedPlan -Role $InvocationRole `
            -ExpectedRuntimeAuthority $plan.RuntimeAuthority -AllowedStates completed
        $recordWithRestore = New-EasyFireMigrationBackupRecord -Role $InvocationRole `
            -Plan $completedPlan -RecoveryUnit $recoveryUnit -RestoreReceipt $restoreReceipt `
            -ExistingRecord $existingRecord
        if ($InvocationRole -ceq 'MigrationScheduled') {
            $saved = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) -BackupReceipt $recordWithRestore
        } else {
            $binding = Write-EasyFireMigrationReceipt -AuthorityRoot $exactAuthorityRoot `
                -MigrationId $canonicalMigrationId -AuthorityFingerprint $authorityFingerprint `
                -Lane Cutover -Kind $restoreName `
                -OperationId ([string]$restoreOperation.OperationId) -Evidence $restoreReceipt
            $saved = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) `
                -ToState ([string]$policy.RequiredState) `
                -ToPhase ([string]$policy.RestoreVerifiedPhase) -ReceiptBinding $binding `
                -BackupReceiptRole $InvocationRole -BackupReceipt $recordWithRestore
        }
        $read = [pscustomobject]@{ Journal=$saved.Journal; Sha256=$saved.Sha256; Path=$saved.Path }
        if ($restoreOperation -and [string]$restoreOperation.State -cne 'Completed') {
            $completedOperation = Set-EasyFireMigrationOperationState -JournalPath $journalPath `
                -ExpectedJournalSha256 ([string]$read.Sha256) `
                -OperationId ([string]$restoreOperation.OperationId) -ToState Completed
            $read = [pscustomobject]@{
                Journal=$completedOperation.Journal; Sha256=$completedOperation.Sha256; Path=$completedOperation.Path
            }
        }
        $plan = $completedPlan
    }

    $result = [pscustomobject][ordered]@{
        SchemaVersion = 1
        MigrationId = $canonicalMigrationId
        InvocationRole = $InvocationRole
        BackupOperationId = [string]$plan.BackupOperationId
        RecoveryUnit = $recoveryUnit
        RestoreReceipt = $restoreReceipt
        Reused = $false
    }
    Write-Output ('MIGRATION_BACKUP_PASSED ' + ($result | ConvertTo-Json -Depth 20 -Compress))
} finally {
    if ($productionMutexAcquired -and $productionMutex) {
        try { $productionMutex.ReleaseMutex() } catch {}
    }
    if ($productionMutex) { $productionMutex.Dispose() }
}
