# EasyFire Bookkeeping -- legacy-runtime blue/green migration authority
#
# This controller is deliberately an authority and proof gate, not an implicit
# Docker or Scheduled Tasks executor. It binds one exact legacy source and one
# verified MigrationSource recovery unit, derives all candidate write targets
# from the canonical MigrationId, and emits the only operations an approved
# executor may perform. Rehearse records only caller planning evidence; Cutover
# is unconditionally blocked until a live executor receipt contract exists.
# No state is inferred from process exit alone. Original releases, volumes,
# journals, and backups are read-only inputs and are never deleted or renamed.

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Plan', 'Rehearse', 'Cutover', 'Rollback')]
    [string]$Mode,

    [Parameter(Mandatory = $true)][string]$MigrationId,
    [Parameter(Mandatory = $true)][string]$AuthorityRoot,

    [Parameter(Mandatory = $true)][string]$SourceReleaseId,
    [Parameter(Mandatory = $true)][string]$SourceReleaseDirectory,
    [Parameter(Mandatory = $true)][string]$SourceComposeFile,
    [Parameter(Mandatory = $true)][string]$SourceComposeSha256,
    [Parameter(Mandatory = $true)][string]$SourceEnvFile,
    [Parameter(Mandatory = $true)][string]$SourceEnvSha256,
    [Parameter(Mandatory = $true)][string]$SourceProjectName,
    [Parameter(Mandatory = $true)][string]$SourceMysqlContainerId,
    [Parameter(Mandatory = $true)][string]$SourceMysqlContainerName,
    [Parameter(Mandatory = $true)][string]$SourceMysqlImageReference,
    [Parameter(Mandatory = $true)][string]$SourceMysqlImageId,
    [Parameter(Mandatory = $true)][string]$SourceMysqlVolumeName,
    [Parameter(Mandatory = $true)][string]$SourceMysqlVolumeComposeKey,
    [Parameter(Mandatory = $true)][string]$SourceMysqlVolumeDestination,
    [Parameter(Mandatory = $true)][string]$SourceRedisVolumeName,

    [Parameter(Mandatory = $true)][string]$TargetReleaseId,
    [Parameter(Mandatory = $true)][string]$TargetReleaseDirectory,
    [Parameter(Mandatory = $true)][string]$TargetComposeFile,
    [Parameter(Mandatory = $true)][string]$TargetComposeSha256,
    [Parameter(Mandatory = $true)][string]$TargetEnvFile,
    [Parameter(Mandatory = $true)][string]$TargetEnvSha256,
    [Parameter(Mandatory = $true)][string]$TargetServerImageReference,
    [Parameter(Mandatory = $true)][string]$TargetServerImageId,
    [Parameter(Mandatory = $true)][string]$TargetWebappImageReference,
    [Parameter(Mandatory = $true)][string]$TargetWebappImageId,
    [Parameter(Mandatory = $true)][string]$TargetWorkerImageReference,
    [Parameter(Mandatory = $true)][string]$TargetWorkerImageId,
    [Parameter(Mandatory = $true)][string]$TargetMysqlImageReference,
    [Parameter(Mandatory = $true)][string]$TargetMysqlImageId,
    [Parameter(Mandatory = $true)][string]$TargetRedisImageReference,
    [Parameter(Mandatory = $true)][string]$TargetRedisImageId,

    [Parameter(Mandatory = $true)][string]$BackupTaskXmlPath,
    [Parameter(Mandatory = $true)][string]$BackupTaskXmlSha256,
    [Parameter(Mandatory = $true)][string]$StartupTaskXmlPath,
    [Parameter(Mandatory = $true)][string]$StartupTaskXmlSha256,

    [Parameter(Mandatory = $true)][string]$BackupMetadataFile,
    [Parameter(Mandatory = $true)][string]$BackupMetadataSha256,

    [string]$EvidenceFile,
    [string]$EvidenceSha256,
    [ValidateSet('NotRun', 'Passed', 'Failed')]
    [string]$NativeAuthProbeResult = 'NotRun'
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:MetadataFields = @(
    'AuthorityRoot', 'BackupFile', 'BackupMode', 'BackupOperationId', 'BackupSha256',
    'ComposeFile', 'ComposeFileSha256', 'ComposeProject', 'EnvFile', 'EnvFileSha256',
    'InvocationRole', 'MigrationId', 'MysqlContainerId', 'MysqlContainerName',
    'MysqlImageId', 'MysqlImageReference', 'MysqlVolumeComposeKey', 'MysqlVolumeDestination', 'MysqlVolumeName',
    'SchemaVersion'
) | Sort-Object

function Get-EasyFireMigrationProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = @($Object.PSObject.Properties | Where-Object { $_.Name -ceq $Name })
    if ($property.Count -ne 1) {
        throw "Required exact property is missing: $Name"
    }
    return $property[0].Value
}

function Assert-EasyFireMigrationExactProperties {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    $actual = @($Object.PSObject.Properties.Name | Sort-Object)
    if (@(Compare-Object -ReferenceObject $Expected -DifferenceObject $actual -CaseSensitive).Count -ne 0) {
        throw "$Kind property set is not exact."
    }
}

function ConvertTo-EasyFireMigrationCanonicalGuid {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) {
        throw "$FieldName must be a canonical lowercase GUID."
    }
    $canonical = $parsed.ToString('D').ToLowerInvariant()
    if ($Value -cne $canonical) {
        throw "$FieldName must be a canonical lowercase GUID."
    }
    return $canonical
}

function Assert-EasyFireMigrationHash {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    if ($Value -notmatch '^[A-F0-9]{64}$') {
        throw "$FieldName must be a canonical uppercase SHA-256."
    }
}

function Get-EasyFireMigrationSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Get-EasyFireMigrationTextSha256 {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha256.Dispose()
    }
}

function Get-EasyFireMigrationFullPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
        throw "$FieldName must be an absolute path."
    }
    $fullPath = [IO.Path]::GetFullPath($Path)
    if ($Path -cne $fullPath) {
        throw "$FieldName must already be a canonical full path."
    }
    return $fullPath
}

function Assert-EasyFireMigrationSafeItem {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet('Leaf', 'Container')][string]$Kind
    )

    if (-not (Test-Path -LiteralPath $Path -PathType $Kind)) {
        throw "Required migration input is missing: $Path"
    }
    if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Migration input cannot be a reparse point: $Path"
    }
    Assert-EasyFireMigrationNoReparseChain -Path $Path
}

function Assert-EasyFireMigrationNoReparseChain {
    param([Parameter(Mandatory = $true)][string]$Path)

    $current = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $current)) {
        $current = [IO.Path]::GetDirectoryName($current)
    }
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Migration path chain contains a reparse point: $current"
            }
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = $parent.FullName
    }
}

function Test-EasyFireMigrationContainedPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $rootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    return $Path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-EasyFireMigrationName {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    if ($Value -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$') {
        throw "$FieldName is not a canonical Docker identity."
    }
}

function Read-EasyFireMigrationJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    Assert-EasyFireMigrationSafeItem -Path $Path -Kind Leaf
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        throw "$Kind is not valid JSON: $Path"
    }
}

function Get-EasyFireMigrationCandidate {
    param([Parameter(Mandatory = $true)][string]$CanonicalMigrationId)

    $token = $CanonicalMigrationId.Replace('-', '')
    $portOffset = [Convert]::ToInt32($token.Substring(0, 4), 16) % 10000
    $prefix = "easyfire-mig-$token"
    return [ordered]@{
        ProjectName = "easyfire-bookkeeping-mig-$token"
        MysqlVolumeName = "easyfire_mig_mysql_$token"
        RedisVolumeName = "easyfire_mig_redis_$token"
        MysqlContainerName = "$prefix-mysql"
        RedisContainerName = "$prefix-redis"
        ServerContainerName = "$prefix-server"
        WebappContainerName = "$prefix-webapp"
        ProxyContainerName = "$prefix-proxy"
        GotenbergContainerName = "$prefix-gotenberg"
        MigrationContainerName = "$prefix-migration"
        RehearsalLoopbackPort = 20000 + $portOffset
        PublicLoopbackPort = 80
        AuthorityLabel = "easyfire.migration.id=$CanonicalMigrationId"
    }
}

function Get-EasyFireMigrationOperations {
    param(
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)]$Source,
        [Parameter(Mandatory = $true)]$Backup,
        [Parameter(Mandatory = $true)]$Candidate,
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)]$TaskBackups,
        [Parameter(Mandatory = $true)][string]$MigrationDirectory
    )

    return @(
        [ordered]@{ Phase = 'Rehearse'; Kind = 'CreateCandidateVolume'; WriteTarget = $Candidate.MysqlVolumeName; AuthorityLabel = $Candidate.AuthorityLabel },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'CreateCandidateVolume'; WriteTarget = $Candidate.RedisVolumeName; AuthorityLabel = $Candidate.AuthorityLabel },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'PrepareCandidateEnvironment'; TargetTemplatePath = $Target.EnvFile; LegacyCompatibilitySource = $Source.EnvFile; WriteTarget = (Join-Path $MigrationDirectory 'candidate.env'); Overrides = [ordered]@{ MARIADB_VOLUME_NAME = $Candidate.MysqlVolumeName; REDIS_VOLUME_NAME = $Candidate.RedisVolumeName; PUBLIC_PROXY_PORT = [string]$Candidate.RehearsalLoopbackPort } },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'RenderCandidateComposeOverride'; WriteTarget = (Join-Path $MigrationDirectory 'candidate-compose.override.yml'); ContainerNames = @($Candidate.MysqlContainerName, $Candidate.RedisContainerName, $Candidate.ServerContainerName, $Candidate.WebappContainerName, $Candidate.ProxyContainerName, $Candidate.GotenbergContainerName, $Candidate.MigrationContainerName) },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'ImportMigrationBackup'; ReadSource = $Backup.File; BackupSha256 = $Backup.Sha256; WriteTarget = $Candidate.MysqlVolumeName; TargetComposeVolumeKey = $Source.MysqlVolumeComposeKey; Destination = '/var/lib/mysql'; SourceVolumeAccess = 'Forbidden' },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'StartCandidate'; ProjectName = $Candidate.ProjectName; ReleaseDirectory = $Target.ReleaseDirectory; ComposeFile = $Target.ComposeFile; EnvFile = $Target.EnvFile; Images = $Target.Images; LoopbackPort = $Candidate.RehearsalLoopbackPort; WriteVolumes = @($Candidate.MysqlVolumeName, $Candidate.RedisVolumeName) },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'VerifyBackupRestore'; Required = $true; BackupSha256 = $Backup.Sha256 },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'VerifyCandidateHealth'; Required = $true; ProjectName = $Candidate.ProjectName },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'ProbeNativeAuthentication'; Required = $true; ResultAuthority = 'CallerSuppliedExactReceipt' },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'VerifyMigration'; Required = $true; SourceVolumePreservation = 'HashOrIdentityProofRequired' },
        [ordered]@{ Phase = 'Rehearse'; Kind = 'RehearseRollback'; Required = $true; StopProject = $Candidate.ProjectName; RestartProject = $Source.ProjectName },
        [ordered]@{ Phase = 'Cutover'; Kind = 'StopExactSourceProject'; ProjectName = $Source.ProjectName; MysqlContainerId = $Source.MysqlContainerId; MysqlVolumeName = $Source.MysqlVolumeName; PreserveVolumes = $true },
        [ordered]@{ Phase = 'Cutover'; Kind = 'StartCandidateAtPublicPort'; ProjectName = $Candidate.ProjectName; ReleaseDirectory = $Target.ReleaseDirectory; ComposeFile = $Target.ComposeFile; EnvFile = $Target.EnvFile; Images = $Target.Images; LoopbackPort = $Candidate.PublicLoopbackPort; PreserveSource = $true },
        [ordered]@{ Phase = 'Cutover'; Kind = 'VerifyCutover'; Required = $true; BackupRollbackAuthMigrationGates = 'AllRequired' },
        [ordered]@{ Phase = 'Cutover'; Kind = 'RepairScheduledTask'; TaskName = 'easyfire-bookkeeping-prod-backup'; Execution = 'ExternalIdentityBoundOnly'; RequiresExactXmlBackup = $true; RequiredBackupPath = $TaskBackups.Backup.Path; XmlBackupSha256 = $TaskBackups.Backup.Sha256 },
        [ordered]@{ Phase = 'Cutover'; Kind = 'RetireScheduledTask'; TaskName = 'easyfire-bookkeeping-prod-startup'; Execution = 'ExternalIdentityBoundOnly'; RequiresExactXmlBackup = $true; RequiredBackupPath = $TaskBackups.Startup.Path; XmlBackupSha256 = $TaskBackups.Startup.Sha256 },
        [ordered]@{ Phase = 'Rollback'; Kind = 'StopCandidate'; ProjectName = $Candidate.ProjectName; PreserveVolumes = $true },
        [ordered]@{ Phase = 'Rollback'; Kind = 'RestartExactSourceProject'; ProjectName = $Source.ProjectName; ComposeFile = $Source.ComposeFile; EnvFile = $Source.EnvFile; MysqlContainerId = $Source.MysqlContainerId; MysqlVolumeName = $Source.MysqlVolumeName; MysqlVolumeComposeKey = $Source.MysqlVolumeComposeKey; RedisVolumeName = $Source.RedisVolumeName; PreserveVolumes = $true },
        [ordered]@{ Phase = 'Rollback'; Kind = 'RestoreScheduledTask'; TaskName = 'easyfire-bookkeeping-prod-backup'; Execution = 'ExternalIdentityBoundOnly'; XmlBackupPath = $TaskBackups.Backup.Path; XmlBackupSha256 = $TaskBackups.Backup.Sha256 },
        [ordered]@{ Phase = 'Rollback'; Kind = 'RestoreScheduledTask'; TaskName = 'easyfire-bookkeeping-prod-startup'; Execution = 'ExternalIdentityBoundOnly'; XmlBackupPath = $TaskBackups.Startup.Path; XmlBackupSha256 = $TaskBackups.Startup.Sha256 }
    )
}

function Assert-EasyFireMigrationMetadata {
    param(
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)][string]$CanonicalAuthorityRoot
    )

    Assert-EasyFireMigrationExactProperties -Object $Metadata -Expected $script:MetadataFields -Kind 'MigrationSource metadata'
    if ([int](Get-EasyFireMigrationProperty -Object $Metadata -Name 'SchemaVersion') -ne 1 -or
        [string](Get-EasyFireMigrationProperty -Object $Metadata -Name 'InvocationRole') -cne 'MigrationSource' -or
        [string](Get-EasyFireMigrationProperty -Object $Metadata -Name 'MigrationId') -cne $CanonicalMigrationId -or
        [string](Get-EasyFireMigrationProperty -Object $Metadata -Name 'BackupMode') -cne 'full' -or
        [string](Get-EasyFireMigrationProperty -Object $Metadata -Name 'AuthorityRoot') -cne $CanonicalAuthorityRoot) {
        throw 'MigrationSource metadata role, mode, migration, or authority identity is invalid.'
    }
    $null = ConvertTo-EasyFireMigrationCanonicalGuid -Value ([string]$Metadata.BackupOperationId) -FieldName 'BackupOperationId'
    foreach ($hashField in @('ComposeFileSha256', 'EnvFileSha256', 'BackupSha256')) {
        Assert-EasyFireMigrationHash -Value ([string](Get-EasyFireMigrationProperty -Object $Metadata -Name $hashField)) -FieldName $hashField
    }

    $metadataBindings = [ordered]@{
        ComposeProject = $SourceProjectName
        ComposeFile = $SourceComposeFile
        ComposeFileSha256 = $SourceComposeSha256
        EnvFile = $SourceEnvFile
        EnvFileSha256 = $SourceEnvSha256
        MysqlContainerId = $SourceMysqlContainerId
        MysqlContainerName = $SourceMysqlContainerName
        MysqlImageReference = $SourceMysqlImageReference
        MysqlImageId = $SourceMysqlImageId
        MysqlVolumeName = $SourceMysqlVolumeName
        MysqlVolumeComposeKey = $SourceMysqlVolumeComposeKey
        MysqlVolumeDestination = $SourceMysqlVolumeDestination
    }
    foreach ($entry in $metadataBindings.GetEnumerator()) {
        if ([string](Get-EasyFireMigrationProperty -Object $Metadata -Name $entry.Key) -cne [string]$entry.Value) {
            throw "MigrationSource metadata does not bind exact source field: $($entry.Key)"
        }
    }

    $backupFile = Get-EasyFireMigrationFullPath -Path ([string]$Metadata.BackupFile) -FieldName 'BackupFile'
    if (-not (Test-EasyFireMigrationContainedPath -Root $CanonicalAuthorityRoot -Path $backupFile)) {
        throw 'MigrationSource backup must be contained by AuthorityRoot.'
    }
    Assert-EasyFireMigrationSafeItem -Path $backupFile -Kind Leaf
    if ((Get-EasyFireMigrationSha256 -Path $backupFile) -cne [string]$Metadata.BackupSha256) {
        throw 'MigrationSource backup hash does not match its metadata.'
    }
    return $backupFile
}

function Assert-EasyFireMigrationBooleanTrue {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    $value = Get-EasyFireMigrationProperty -Object $Object -Name $Name
    if ($value -isnot [bool] -or -not $value) {
        throw "$Kind proof gate failed: $Name"
    }
}

function Assert-EasyFireMigrationEvidence {
    param(
        [Parameter(Mandatory = $true)]$Evidence,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)]$Backup,
        [Parameter(Mandatory = $true)]$Candidate,
        [Parameter(Mandatory = $true)][string]$CallerNativeAuthResult
    )

    Assert-EasyFireMigrationExactProperties -Object $Evidence -Expected @(
        'BackupRestore', 'CandidateHealth', 'MigrationId', 'MigrationProof',
        'NativeAuthentication', 'RollbackRehearsal', 'SchemaVersion'
    ) -Kind 'Rehearsal evidence'
    if ([int]$Evidence.SchemaVersion -ne 1 -or [string]$Evidence.MigrationId -cne $CanonicalMigrationId) {
        throw 'Rehearsal evidence identity is invalid.'
    }
    if ($CallerNativeAuthResult -cne 'Passed') {
        throw 'Native authentication must be explicitly reported Passed by the caller.'
    }

    Assert-EasyFireMigrationExactProperties -Object $Evidence.BackupRestore -Expected @(
        'BackupMetadataSha256', 'BackupSha256', 'Passed'
    ) -Kind 'Backup restore evidence'
    Assert-EasyFireMigrationBooleanTrue -Object $Evidence.BackupRestore -Name 'Passed' -Kind 'Backup restore'
    if ([string]$Evidence.BackupRestore.BackupSha256 -cne [string]$Backup.Sha256 -or
        [string]$Evidence.BackupRestore.BackupMetadataSha256 -cne [string]$Backup.MetadataSha256) {
        throw 'Backup restore evidence does not bind the exact recovery unit.'
    }

    Assert-EasyFireMigrationExactProperties -Object $Evidence.CandidateHealth -Expected @(
        'MysqlVolumeName', 'Passed', 'ProjectName', 'RedisVolumeName'
    ) -Kind 'Candidate health evidence'
    Assert-EasyFireMigrationBooleanTrue -Object $Evidence.CandidateHealth -Name 'Passed' -Kind 'Candidate health'
    if ([string]$Evidence.CandidateHealth.ProjectName -cne [string]$Candidate.ProjectName -or
        [string]$Evidence.CandidateHealth.MysqlVolumeName -cne [string]$Candidate.MysqlVolumeName -or
        [string]$Evidence.CandidateHealth.RedisVolumeName -cne [string]$Candidate.RedisVolumeName) {
        throw 'Candidate health evidence targets a different candidate.'
    }

    Assert-EasyFireMigrationExactProperties -Object $Evidence.NativeAuthentication -Expected @(
        'Passed', 'Result'
    ) -Kind 'Native authentication evidence'
    Assert-EasyFireMigrationBooleanTrue -Object $Evidence.NativeAuthentication -Name 'Passed' -Kind 'Native authentication'
    if ([string]$Evidence.NativeAuthentication.Result -cne 'Passed') {
        throw 'Native authentication evidence is not Passed.'
    }

    Assert-EasyFireMigrationExactProperties -Object $Evidence.MigrationProof -Expected @(
        'ImportedOnlyIntoCandidate', 'Passed', 'SourceVolumeUnchanged'
    ) -Kind 'Migration proof'
    foreach ($field in @('Passed', 'ImportedOnlyIntoCandidate', 'SourceVolumeUnchanged')) {
        Assert-EasyFireMigrationBooleanTrue -Object $Evidence.MigrationProof -Name $field -Kind 'Migration'
    }

    Assert-EasyFireMigrationExactProperties -Object $Evidence.RollbackRehearsal -Expected @(
        'CandidateStopped', 'Passed', 'SourceProjectRestarted', 'SourceVolumeUnchanged'
    ) -Kind 'Rollback rehearsal proof'
    foreach ($field in @('Passed', 'CandidateStopped', 'SourceProjectRestarted', 'SourceVolumeUnchanged')) {
        Assert-EasyFireMigrationBooleanTrue -Object $Evidence.RollbackRehearsal -Name $field -Kind 'Rollback rehearsal'
    }
}

function Write-EasyFireMigrationJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $directory = [IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $directory -Force
    }
    $json = $Value | ConvertTo-Json -Depth 30
    $partial = "$Path.partial.$PID.$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText($partial, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $preservedPrior = "$Path.previous.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')).$([Guid]::NewGuid().ToString('N'))"
            [IO.File]::Replace($partial, $Path, $preservedPrior, $true)
        } else {
            [IO.File]::Move($partial, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $partial -PathType Leaf) {
            Remove-Item -LiteralPath $partial -Force
        }
    }
}

function Save-EasyFireMigrationTransition {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$From,
        [Parameter(Mandatory = $true)][string]$To,
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalHash,
        [string]$EvidenceHash = ''
    )

    $allowed = @{
        '' = @('Planned')
        'Planned' = @('RehearsalEvidenceRecorded', 'RollbackAuthorized')
        'RehearsalEvidenceRecorded' = @('RollbackAuthorized')
    }
    if (-not $allowed.ContainsKey($From) -or $To -notin $allowed[$From]) {
        throw "Migration journal transition is not allowed: $From -> $To"
    }

    $actualHash = if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
        Get-EasyFireMigrationSha256 -Path $JournalPath
    } else { 'ABSENT' }
    if ($actualHash -cne $ExpectedJournalHash) {
        throw 'Migration journal compare-and-swap authority changed.'
    }

    $sequence = @($Journal.Transitions).Count + 1
    $historyPath = Join-Path ([IO.Path]::GetDirectoryName($JournalPath)) (
        'transition-{0:D4}-{1}.json' -f $sequence, $To
    )
    if (Test-Path -LiteralPath $historyPath) {
        Assert-EasyFireMigrationNoReparseChain -Path $historyPath
        $snapshot = Read-EasyFireMigrationJson -Path $historyPath -Kind 'Migration transition snapshot'
        $last = @($snapshot.Transitions)[-1]
        if ([int]$last.Sequence -ne $sequence -or [string]$last.From -cne $From -or
            [string]$last.To -cne $To -or [string]$last.EvidenceSha256 -cne $EvidenceHash -or
            [string]$snapshot.State -cne $To -or
            [string]$snapshot.AuthorityFingerprint -cne [string]$Journal.AuthorityFingerprint -or
            [string]$snapshot.OperationsSha256 -cne [string]$Journal.OperationsSha256) {
            throw 'Existing transition snapshot does not match the retry authority.'
        }
        $beforeRetryPointerWrite = if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
            Get-EasyFireMigrationSha256 -Path $JournalPath
        } else { 'ABSENT' }
        if ($beforeRetryPointerWrite -cne $ExpectedJournalHash) {
            throw 'Migration journal changed before crash-window recovery.'
        }
        Write-EasyFireMigrationJsonAtomic -Path $JournalPath -Value $snapshot
        return $snapshot
    }

    $transition = [ordered]@{
        Sequence = $sequence
        From = $From
        To = $To
        AtUtc = [DateTime]::UtcNow.ToString('o')
        EvidenceSha256 = $EvidenceHash
    }
    $Journal.State = $To
    $Journal.UpdatedAtUtc = $transition.AtUtc
    $Journal.Transitions = @($Journal.Transitions) + @($transition)
    Write-EasyFireMigrationJsonAtomic -Path $historyPath -Value $Journal

    $beforePointerWrite = if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
        Get-EasyFireMigrationSha256 -Path $JournalPath
    } else { 'ABSENT' }
    if ($beforePointerWrite -cne $ExpectedJournalHash) {
        throw 'Migration journal changed after transition snapshot publication.'
    }
    Write-EasyFireMigrationJsonAtomic -Path $JournalPath -Value $Journal
    return $Journal
}

function Assert-EasyFireMigrationJournalAuthority {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$ExpectedMigrationId,
        [Parameter(Mandatory = $true)][string]$ExpectedAuthorityFingerprint,
        [Parameter(Mandatory = $true)][string]$ExpectedOperationsSha256
    )

    if ([int]$Journal.SchemaVersion -ne 1 -or
        [string]$Journal.MigrationId -cne $ExpectedMigrationId -or
        [string]$Journal.AuthorityFingerprint -cne $ExpectedAuthorityFingerprint -or
        [string]$Journal.OperationsSha256 -cne $ExpectedOperationsSha256 -or
        [string]$Journal.State -notin @('Planned', 'RehearsalEvidenceRecorded', 'RollbackAuthorized') -or
        $Journal.PreserveOriginals -isnot [bool] -or -not $Journal.PreserveOriginals) {
        throw 'Existing migration journal does not match exact immutable authority.'
    }
}

$mutex = $null
$mutexAcquired = $false
try {
    $MigrationId = ConvertTo-EasyFireMigrationCanonicalGuid -Value $MigrationId -FieldName 'MigrationId'
    $AuthorityRoot = Get-EasyFireMigrationFullPath -Path $AuthorityRoot -FieldName 'AuthorityRoot'
    $SourceReleaseDirectory = Get-EasyFireMigrationFullPath -Path $SourceReleaseDirectory -FieldName 'SourceReleaseDirectory'
    $SourceComposeFile = Get-EasyFireMigrationFullPath -Path $SourceComposeFile -FieldName 'SourceComposeFile'
    $SourceEnvFile = Get-EasyFireMigrationFullPath -Path $SourceEnvFile -FieldName 'SourceEnvFile'
    $TargetReleaseDirectory = Get-EasyFireMigrationFullPath -Path $TargetReleaseDirectory -FieldName 'TargetReleaseDirectory'
    $TargetComposeFile = Get-EasyFireMigrationFullPath -Path $TargetComposeFile -FieldName 'TargetComposeFile'
    $TargetEnvFile = Get-EasyFireMigrationFullPath -Path $TargetEnvFile -FieldName 'TargetEnvFile'
    $BackupTaskXmlPath = Get-EasyFireMigrationFullPath -Path $BackupTaskXmlPath -FieldName 'BackupTaskXmlPath'
    $StartupTaskXmlPath = Get-EasyFireMigrationFullPath -Path $StartupTaskXmlPath -FieldName 'StartupTaskXmlPath'
    $BackupMetadataFile = Get-EasyFireMigrationFullPath -Path $BackupMetadataFile -FieldName 'BackupMetadataFile'

    Assert-EasyFireMigrationSafeItem -Path $AuthorityRoot -Kind Container
    Assert-EasyFireMigrationSafeItem -Path $SourceReleaseDirectory -Kind Container
    Assert-EasyFireMigrationSafeItem -Path $TargetReleaseDirectory -Kind Container
    foreach ($file in @(
            $SourceComposeFile, $SourceEnvFile, $TargetComposeFile, $TargetEnvFile,
            $BackupTaskXmlPath, $StartupTaskXmlPath, $BackupMetadataFile
        )) {
        Assert-EasyFireMigrationSafeItem -Path $file -Kind Leaf
    }
    if (-not (Test-EasyFireMigrationContainedPath -Root $SourceReleaseDirectory -Path $SourceComposeFile) -or
        -not (Test-EasyFireMigrationContainedPath -Root $SourceReleaseDirectory -Path $SourceEnvFile)) {
        throw 'Source compose and environment files must be contained by the exact source release.'
    }
    if (-not (Test-EasyFireMigrationContainedPath -Root $TargetReleaseDirectory -Path $TargetComposeFile) -or
        -not (Test-EasyFireMigrationContainedPath -Root $TargetReleaseDirectory -Path $TargetEnvFile)) {
        throw 'Target compose and environment files must be contained by the exact target release.'
    }
    foreach ($authorityFile in @($BackupMetadataFile, $BackupTaskXmlPath, $StartupTaskXmlPath)) {
        if (-not (Test-EasyFireMigrationContainedPath -Root $AuthorityRoot -Path $authorityFile)) {
            throw 'Backup metadata and exact task XML backups must be contained by AuthorityRoot.'
        }
    }

    foreach ($hashBinding in @(
            @($SourceComposeSha256, 'SourceComposeSha256', $SourceComposeFile),
            @($SourceEnvSha256, 'SourceEnvSha256', $SourceEnvFile),
            @($TargetComposeSha256, 'TargetComposeSha256', $TargetComposeFile),
            @($TargetEnvSha256, 'TargetEnvSha256', $TargetEnvFile),
            @($BackupTaskXmlSha256, 'BackupTaskXmlSha256', $BackupTaskXmlPath),
            @($StartupTaskXmlSha256, 'StartupTaskXmlSha256', $StartupTaskXmlPath),
            @($BackupMetadataSha256, 'BackupMetadataSha256', $BackupMetadataFile)
        )) {
        Assert-EasyFireMigrationHash -Value ([string]$hashBinding[0]) -FieldName ([string]$hashBinding[1])
        if ((Get-EasyFireMigrationSha256 -Path ([string]$hashBinding[2])) -cne [string]$hashBinding[0]) {
            throw "$([string]$hashBinding[1]) does not match the exact file."
        }
    }

    foreach ($nameBinding in @(
            @($SourceReleaseId, 'SourceReleaseId'),
            @($TargetReleaseId, 'TargetReleaseId'),
            @($SourceProjectName, 'SourceProjectName'),
            @($SourceMysqlContainerName, 'SourceMysqlContainerName'),
            @($SourceMysqlVolumeName, 'SourceMysqlVolumeName'),
            @($SourceRedisVolumeName, 'SourceRedisVolumeName')
        )) {
        Assert-EasyFireMigrationName -Value ([string]$nameBinding[0]) -FieldName ([string]$nameBinding[1])
    }
    if ($SourceMysqlContainerId -notmatch '^[a-f0-9]{64}$' -or
        $SourceMysqlImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
        [string]::IsNullOrWhiteSpace($SourceMysqlImageReference) -or
        $SourceMysqlVolumeComposeKey -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' -or
        $SourceMysqlVolumeDestination -cne '/var/lib/mysql') {
        throw 'Source MySQL container, image, or volume destination identity is invalid.'
    }
    $targetImageBindings = @(
        @('server', $TargetServerImageReference, $TargetServerImageId),
        @('webapp', $TargetWebappImageReference, $TargetWebappImageId),
        @('worker', $TargetWorkerImageReference, $TargetWorkerImageId),
        @('mysql', $TargetMysqlImageReference, $TargetMysqlImageId),
        @('redis', $TargetRedisImageReference, $TargetRedisImageId)
    )
    foreach ($imageBinding in $targetImageBindings) {
        if ([string]::IsNullOrWhiteSpace([string]$imageBinding[1]) -or
            [string]$imageBinding[2] -notmatch '^sha256:[a-f0-9]{64}$') {
            throw "Target image authority is invalid for $([string]$imageBinding[0])."
        }
    }

    $metadata = Read-EasyFireMigrationJson -Path $BackupMetadataFile -Kind 'MigrationSource metadata'
    $backupFile = Assert-EasyFireMigrationMetadata -Metadata $metadata `
        -CanonicalMigrationId $MigrationId -CanonicalAuthorityRoot $AuthorityRoot

    $migrationDirectory = Join-Path (Join-Path $AuthorityRoot 'migrations') $MigrationId
    $journalPath = Join-Path $migrationDirectory 'migration.journal.json'
    Assert-EasyFireMigrationNoReparseChain -Path $journalPath
    $candidate = Get-EasyFireMigrationCandidate -CanonicalMigrationId $MigrationId
    $source = [ordered]@{
        ReleaseId = $SourceReleaseId
        ReleaseDirectory = $SourceReleaseDirectory
        ComposeFile = $SourceComposeFile
        ComposeSha256 = $SourceComposeSha256
        EnvFile = $SourceEnvFile
        EnvSha256 = $SourceEnvSha256
        ProjectName = $SourceProjectName
        MysqlContainerId = $SourceMysqlContainerId
        MysqlContainerName = $SourceMysqlContainerName
        MysqlImageReference = $SourceMysqlImageReference
        MysqlImageId = $SourceMysqlImageId
        MysqlVolumeName = $SourceMysqlVolumeName
        MysqlVolumeComposeKey = $SourceMysqlVolumeComposeKey
        MysqlVolumeDestination = $SourceMysqlVolumeDestination
        RedisVolumeName = $SourceRedisVolumeName
        Preservation = 'ReadOnlyPreserve'
    }
    $backup = [ordered]@{
        MetadataFile = $BackupMetadataFile
        MetadataSha256 = $BackupMetadataSha256
        OperationId = [string]$metadata.BackupOperationId
        File = $backupFile
        Sha256 = [string]$metadata.BackupSha256
        InvocationRole = 'MigrationSource'
        RestoreVerificationRequired = $true
    }
    $target = [ordered]@{
        ReleaseId = $TargetReleaseId
        ReleaseDirectory = $TargetReleaseDirectory
        ComposeFile = $TargetComposeFile
        ComposeSha256 = $TargetComposeSha256
        EnvFile = $TargetEnvFile
        EnvSha256 = $TargetEnvSha256
        Images = @($targetImageBindings | ForEach-Object {
                [ordered]@{ Service = [string]$_[0]; Reference = [string]$_[1]; ImageId = [string]$_[2] }
            })
    }
    $taskBackups = [ordered]@{
        Backup = [ordered]@{ Path = $BackupTaskXmlPath; Sha256 = $BackupTaskXmlSha256 }
        Startup = [ordered]@{ Path = $StartupTaskXmlPath; Sha256 = $StartupTaskXmlSha256 }
    }
    $operations = Get-EasyFireMigrationOperations -CanonicalMigrationId $MigrationId `
        -Source $source -Backup $backup -Candidate $candidate -Target $target `
        -TaskBackups $taskBackups -MigrationDirectory $migrationDirectory
    $authority = [ordered]@{
        MigrationId = $MigrationId
        AuthorityRoot = $AuthorityRoot
        Source = $source
        Target = $target
        Backup = $backup
        TaskBackups = $taskBackups
        Candidate = $candidate
        PreserveOriginals = $true
        OriginalMutationPolicy = 'NoDeleteNoRenameNoVolumeWrites'
    }
    $authorityFingerprint = Get-EasyFireMigrationTextSha256 -Text (
        $authority | ConvertTo-Json -Depth 30 -Compress
    )
    $operationsSha256 = Get-EasyFireMigrationTextSha256 -Text (
        $operations | ConvertTo-Json -Depth 30 -Compress
    )

    $mutexToken = (Get-EasyFireMigrationTextSha256 -Text $journalPath).Substring(0, 32)
    $mutex = New-Object Threading.Mutex($false, "Local\EasyFireMigration_$mutexToken")
    $mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(10))
    if (-not $mutexAcquired) {
        throw 'Another process owns this exact migration journal authority.'
    }

    $journal = $null
    $journalHash = 'ABSENT'
    if (Test-Path -LiteralPath $journalPath -PathType Leaf) {
        $journalHash = Get-EasyFireMigrationSha256 -Path $journalPath
        $journal = Read-EasyFireMigrationJson -Path $journalPath -Kind 'Migration journal'
        if ((Get-EasyFireMigrationSha256 -Path $journalPath) -cne $journalHash) {
            throw 'Migration journal changed while it was read.'
        }
        Assert-EasyFireMigrationJournalAuthority -Journal $journal `
            -ExpectedMigrationId $MigrationId `
            -ExpectedAuthorityFingerprint $authorityFingerprint `
            -ExpectedOperationsSha256 $operationsSha256
    }

    if ($null -eq $journal) {
        $journal = [pscustomobject][ordered]@{
            SchemaVersion = 1
            MigrationId = $MigrationId
            State = ''
            AuthorityFingerprint = $authorityFingerprint
            OperationsSha256 = $operationsSha256
            PreserveOriginals = $true
            Source = $source
            Target = $target
            Backup = $backup
            TaskBackups = $taskBackups
            Candidate = $candidate
            Operations = $operations
            Evidence = $null
            Transitions = @()
            UpdatedAtUtc = ''
        }
    }

    if ($Mode -ceq 'Plan') {
        if ([string]$journal.State -ceq '') {
            if ($PSCmdlet.ShouldProcess($journalPath, 'Publish immutable blue/green migration plan')) {
                $journal = Save-EasyFireMigrationTransition -Journal $journal -From '' -To 'Planned' `
                    -JournalPath $journalPath -ExpectedJournalHash $journalHash
            } else {
                $journal.State = 'Planned'
            }
        }
        [pscustomobject]@{
            MigrationId = $MigrationId
            State = [string]$journal.State
            JournalPath = $journalPath
            AuthorityFingerprint = $authorityFingerprint
            Source = $source
            Target = $target
            Backup = $backup
            Candidate = $candidate
            Operations = $operations
            PreserveOriginals = $true
        } | ConvertTo-Json -Depth 30 -Compress
        exit 0
    }

    if ($Mode -ceq 'Cutover') {
        throw 'LIVE_EXECUTOR_PROOF_REQUIRED: Caller-authored evidence cannot authorize Cutover. An executor-generated live identity receipt contract is not implemented.'
    }

    if ($Mode -ceq 'Rehearse') {
        if ([string]::IsNullOrWhiteSpace($EvidenceFile) -or [string]::IsNullOrWhiteSpace($EvidenceSha256)) {
            throw "$Mode requires an exact hash-bound EvidenceFile."
        }
        $EvidenceFile = Get-EasyFireMigrationFullPath -Path $EvidenceFile -FieldName 'EvidenceFile'
        if (-not (Test-EasyFireMigrationContainedPath -Root $AuthorityRoot -Path $EvidenceFile)) {
            throw 'EvidenceFile must be contained by AuthorityRoot.'
        }
        Assert-EasyFireMigrationNoReparseChain -Path $EvidenceFile
        Assert-EasyFireMigrationHash -Value $EvidenceSha256 -FieldName 'EvidenceSha256'
        if ((Get-EasyFireMigrationSha256 -Path $EvidenceFile) -cne $EvidenceSha256) {
            throw 'EvidenceSha256 does not match the exact evidence file.'
        }
        $evidence = Read-EasyFireMigrationJson -Path $EvidenceFile -Kind 'Rehearsal evidence'
        Assert-EasyFireMigrationEvidence -Evidence $evidence -CanonicalMigrationId $MigrationId `
            -Backup $backup -Candidate $candidate -CallerNativeAuthResult $NativeAuthProbeResult
    }

    if ($Mode -ceq 'Rehearse') {
        if ([string]$journal.State -ceq 'Planned') {
            $journal.Evidence = [pscustomobject][ordered]@{
                Path = $EvidenceFile
                Sha256 = $EvidenceSha256
                NativeAuthProbeResult = $NativeAuthProbeResult
                EvidenceKind = 'CallerPlanningReceipt'
                VerifiedAtUtc = [DateTime]::UtcNow.ToString('o')
            }
            if ($PSCmdlet.ShouldProcess($journalPath, 'Record caller-supplied rehearsal planning evidence')) {
                $journal = Save-EasyFireMigrationTransition -Journal $journal -From 'Planned' -To 'RehearsalEvidenceRecorded' `
                    -JournalPath $journalPath -ExpectedJournalHash $journalHash -EvidenceHash $EvidenceSha256
            } else {
                $journal.State = 'RehearsalEvidenceRecorded'
            }
        } elseif ([string]$journal.State -cne 'RehearsalEvidenceRecorded') {
            throw "Rehearse cannot run from migration state: $([string]$journal.State)"
        }
        [pscustomobject]@{
            MigrationId = $MigrationId
            State = [string]$journal.State
            JournalPath = $journalPath
            EvidenceSha256 = $EvidenceSha256
            Candidate = $candidate
            PreserveOriginals = $true
        } | ConvertTo-Json -Depth 20 -Compress
        exit 0
    }

    if ($Mode -ceq 'Rollback') {
        if ([string]$journal.State -notin @('Planned', 'RehearsalEvidenceRecorded')) {
            throw "Rollback cannot run from migration state: $([string]$journal.State)"
        }
        $from = [string]$journal.State
        if ($PSCmdlet.ShouldProcess($journalPath, 'Authorize exact candidate-only rollback operations')) {
            $journal = Save-EasyFireMigrationTransition -Journal $journal -From $from -To 'RollbackAuthorized' `
                -JournalPath $journalPath -ExpectedJournalHash $journalHash
        } else {
            $journal.State = 'RollbackAuthorized'
        }
        [pscustomobject]@{
            MigrationId = $MigrationId
            State = [string]$journal.State
            JournalPath = $journalPath
            AuthorizedOperations = @($operations | Where-Object { $_.Phase -ceq 'Rollback' })
            Source = $source
            Candidate = $candidate
            PreserveOriginals = $true
        } | ConvertTo-Json -Depth 30 -Compress
        exit 0
    }
} catch {
    Write-Error -ErrorRecord $_
    exit 1
} finally {
    if ($mutexAcquired -and $null -ne $mutex) {
        try { $mutex.ReleaseMutex() } catch { }
    }
    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}
