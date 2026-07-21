# EasyFire Bookkeeping -- authority-bound production backup
#
# Production calls must name one canonical Action journal, invocation role, and
# journaled backup operation. Disposable proof calls use -DisposableProof and
# are restricted to an exact temporary proof root and project identity.

[CmdletBinding()]
param(
    [switch]$SchemaOnly,

    [string]$ComposeFile = "$PSScriptRoot\..\..\docker-compose.prod.yml",
    [string]$ComposeOverrideFile,
    [string]$EnvFile = "$PSScriptRoot\..\..\.env",
    [string]$ProjectName = "easyfire-bookkeeping-prod",
    [string]$BackupDir = "$PSScriptRoot\..\..\backups",
    [Parameter(Mandatory = $true)][string]$AuthorityRoot,
    [Parameter(Mandatory = $true)][string]$BackupOperationId,
    [string]$ActionId,
    # Legacy production role subset: ValidateSet('Scheduled', 'Baseline', 'Emergency', 'MigrationSource')
    [ValidateSet(
        'Scheduled', 'Baseline', 'Emergency', 'MigrationSource',
        'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled'
    )]
    [string]$InvocationRole,
    [string]$MigrationId,
    [string]$MigrationJournalPath,
    [string]$CaptureAttemptId,
    [string]$ExpectedMysqlContainerId,
    [string]$ExpectedMysqlImageReference,
    [string]$ExpectedMysqlImageId,
    [string]$ExpectedMysqlVolumeName,
    [string]$ExpectedMysqlVolumeDestination,
    [switch]$DisposableProof,
    [string]$ProofId,
    [ValidateRange(1, 1000000)]
    [int]$RetentionCount = 30
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\production-io.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\production-state.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'backup-integrity.psm1') -Force -ErrorAction Stop

$identifierRegex = '^[A-Za-z0-9_]+$'
$projectNameRegex = '^[A-Za-z0-9][A-Za-z0-9_.-]*$'
$dumpMode = if ($SchemaOnly) { 'schema' } else { 'full' }
$backupMutex = $null
$backupMutexAcquired = $false
$partialCompressedFile = $null
$partialSidecarFile = $null
$partialMetadataFile = $null
$journalPath = $null
$journalAuthorityHash = $null

function Get-EasyFireBackupProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function ConvertTo-EasyFireCanonicalBackupOperationId {
    param([Parameter(Mandatory = $true)][string]$Value)

    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) {
        throw 'BackupOperationId must be a canonical GUID in D format.'
    }
    $canonical = $parsed.ToString('D')
    if ($Value -cne $canonical) {
        throw "BackupOperationId must use canonical lowercase GUID form: $canonical"
    }
    return $canonical
}

function ConvertTo-EasyFireCanonicalMigrationId {
    param([Parameter(Mandatory = $true)][string]$Value)

    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) {
        throw 'MigrationId must be a canonical GUID in D format.'
    }
    $canonical = $parsed.ToString('D')
    if ($Value -cne $canonical) {
        throw "MigrationId must use canonical lowercase GUID form: $canonical"
    }
    return $canonical
}

function Test-EasyFireMigrationRuntimeBackupRole {
    param([string]$Role)

    return $Role -in @('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')
}

function Get-EasyFireBackupObjectSha256 {
    param([Parameter(Mandatory = $true)]$Value)

    $json = $Value | ConvertTo-Json -Depth 30 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha256.Dispose()
    }
}

function Get-EasyFireBackupMetadataPath {
    param([Parameter(Mandatory = $true)][string]$BackupFile)

    if ([IO.Path]::GetFileName($BackupFile) -notmatch '\.sql\.gz$') {
        throw 'Backup metadata requires an exact .sql.gz backup path.'
    }
    return ($BackupFile -replace '\.sql\.gz$', '.metadata.json')
}

function New-EasyFireBackupMetadataDocument {
    param(
        [Parameter(Mandatory = $true)]$Pair,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Role,
        [string]$CanonicalActionId,
        [string]$MigrationId,
        [string]$ExactProofId,
        [Parameter(Mandatory = $true)]$SourceAuthority
    )

    if ($Role -ceq 'MigrationSource') {
        return [ordered]@{
            SchemaVersion = 1
            MigrationId = $MigrationId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            BackupMode = $Mode
            AuthorityRoot = [string]$SourceAuthority.AuthorityRoot
            ComposeProject = [string]$SourceAuthority.ComposeProject
            ComposeFile = [string]$SourceAuthority.ComposeFile
            ComposeFileSha256 = [string]$SourceAuthority.ComposeFileSha256
            EnvFile = [string]$SourceAuthority.EnvFile
            EnvFileSha256 = [string]$SourceAuthority.EnvFileSha256
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            MysqlVolumeComposeKey = [string]$SourceAuthority.MysqlVolumeComposeKey
            BackupFile = [string]$Pair.BackupFile
            BackupSha256 = [string]$Pair.Sha256
        }
    }

    if ($Role -in @('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')) {
        return [ordered]@{
            SchemaVersion = 1
            MigrationId = $MigrationId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            CaptureAttemptId = [string]$SourceAuthority.CaptureAttemptId
            BackupMode = $Mode
            AuthorityRoot = [string]$SourceAuthority.AuthorityRoot
            MigrationJournalPath = [string]$SourceAuthority.MigrationJournalPath
            MigrationAuthorityFingerprint = [string]$SourceAuthority.MigrationAuthorityFingerprint
            MigrationJournalRevision = [int64]$SourceAuthority.MigrationJournalRevision
            MigrationBackupAuthorityFingerprint = [string]$SourceAuthority.MigrationBackupAuthorityFingerprint
            ComposeProject = [string]$SourceAuthority.ComposeProject
            ComposeFile = [string]$SourceAuthority.ComposeFile
            ComposeFileSha256 = [string]$SourceAuthority.ComposeFileSha256
            ComposeOverrideFile = [string]$SourceAuthority.ComposeOverrideFile
            ComposeOverrideSha256 = [string]$SourceAuthority.ComposeOverrideSha256
            EnvFile = [string]$SourceAuthority.EnvFile
            EnvFileSha256 = [string]$SourceAuthority.EnvFileSha256
            InventoryFingerprint = [string]$SourceAuthority.InventoryFingerprint
            DurableVolumeFingerprint = [string]$SourceAuthority.DurableVolumeFingerprint
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            MysqlVolumeComposeKey = [string]$SourceAuthority.MysqlVolumeComposeKey
            BackupFile = [string]$Pair.BackupFile
            BackupSha256 = [string]$Pair.Sha256
        }
    }

    if ($Role -ceq 'DisposableProof') {
        return [ordered]@{
            SchemaVersion = 1
            ProofId = $ExactProofId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            BackupMode = $Mode
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            BackupFile = [string]$Pair.BackupFile
            BackupSha256 = [string]$Pair.Sha256
        }
    }

    return [ordered]@{
        SchemaVersion = 1
        ActionId = $CanonicalActionId
        InvocationRole = $Role
        BackupOperationId = $OperationId
        BackupMode = $Mode
        PhaseInventoryFingerprint = [string]$SourceAuthority.PhaseInventoryFingerprint
        DurableVolumeFingerprint = [string]$SourceAuthority.DurableVolumeFingerprint
        MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
        MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
        MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
        MysqlImageId = [string]$SourceAuthority.MysqlImageId
        MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
        MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
        BackupFile = [string]$Pair.BackupFile
        BackupSha256 = [string]$Pair.Sha256
    }
}

function Test-EasyFireBackupMetadataBinding {
    param([Parameter(Mandatory = $true)][string]$BackupFile)

    try {
        $pair = Test-EasyFireBackupPair -BackupFile $BackupFile
        if (-not $pair.Valid) { throw "backup_pair_$($pair.Reason)" }
        $metadataFile = Get-EasyFireBackupMetadataPath -BackupFile $pair.BackupFile
        if (-not (Test-Path -LiteralPath $metadataFile -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $metadataFile)) {
            throw 'metadata_missing_or_unsafe'
        }
        $document = Get-Content -LiteralPath $metadataFile -Raw -Encoding utf8 | ConvertFrom-Json
        $role = [string](Get-EasyFireBackupProperty -Object $document -Name 'InvocationRole' -Default '')
        $operationId = ConvertTo-EasyFireCanonicalBackupOperationId -Value (
            [string](Get-EasyFireBackupProperty -Object $document -Name 'BackupOperationId' -Default '')
        )
        $mode = [string](Get-EasyFireBackupProperty -Object $document -Name 'BackupMode' -Default '')
        $commonNames = @(
            'SchemaVersion', 'InvocationRole', 'BackupOperationId', 'BackupMode',
            'MysqlContainerId', 'MysqlContainerName', 'MysqlImageReference', 'MysqlImageId',
            'MysqlVolumeName', 'MysqlVolumeDestination', 'BackupFile', 'BackupSha256'
        )
        if ($role -ceq 'DisposableProof') {
            $expectedNames = @($commonNames + 'ProofId' | Sort-Object)
            if ([string]$document.ProofId -notmatch '^[a-f0-9]{32}$') { throw 'proof_id_invalid' }
        } elseif ($role -ceq 'MigrationSource') {
            $expectedNames = @($commonNames + @(
                    'MigrationId', 'AuthorityRoot', 'ComposeProject', 'ComposeFile',
                    'ComposeFileSha256', 'EnvFile', 'EnvFileSha256', 'MysqlVolumeComposeKey'
                ) | Sort-Object)
            $null = ConvertTo-EasyFireCanonicalMigrationId -Value ([string]$document.MigrationId)
            $authorityRoot = [IO.Path]::GetFullPath([string]$document.AuthorityRoot)
            $composeFile = [IO.Path]::GetFullPath([string]$document.ComposeFile)
            $envFile = [IO.Path]::GetFullPath([string]$document.EnvFile)
            $authorityPrefix = $authorityRoot.TrimEnd('\') + '\'
            if ($mode -cne 'full' -or
                [string]$document.AuthorityRoot -cne $authorityRoot -or
                [string]$document.ComposeFile -cne $composeFile -or
                [string]$document.EnvFile -cne $envFile -or
                -not $composeFile.StartsWith($authorityPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                -not $envFile.StartsWith($authorityPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                [string]$document.ComposeProject -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$' -or
                [string]$document.ComposeFileSha256 -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.EnvFileSha256 -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.MysqlVolumeComposeKey -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') {
                throw 'migration_source_authority_invalid'
            }
        } elseif ($role -in @('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')) {
            $expectedNames = @($commonNames + @(
                    'MigrationId', 'AuthorityRoot', 'MigrationJournalPath', 'CaptureAttemptId',
                    'MigrationAuthorityFingerprint', 'MigrationJournalRevision',
                    'MigrationBackupAuthorityFingerprint', 'ComposeProject', 'ComposeFile',
                    'ComposeFileSha256', 'ComposeOverrideFile', 'ComposeOverrideSha256',
                    'EnvFile', 'EnvFileSha256', 'InventoryFingerprint',
                    'DurableVolumeFingerprint', 'MysqlVolumeComposeKey'
                ) | Sort-Object)
            $null = ConvertTo-EasyFireCanonicalMigrationId -Value ([string]$document.MigrationId)
            $captureAttempt = ConvertTo-EasyFireCanonicalBackupOperationId `
                -Value ([string]$document.CaptureAttemptId)
            $authorityRoot = [IO.Path]::GetFullPath([string]$document.AuthorityRoot)
            $authorityPrefix = $authorityRoot.TrimEnd('\') + '\'
            $composeFile = [IO.Path]::GetFullPath([string]$document.ComposeFile)
            $composeOverrideFile = [IO.Path]::GetFullPath([string]$document.ComposeOverrideFile)
            $envFile = [IO.Path]::GetFullPath([string]$document.EnvFile)
            $migrationJournalPath = [IO.Path]::GetFullPath([string]$document.MigrationJournalPath)
            if ($mode -cne 'full' -or
                [string]$document.AuthorityRoot -cne $authorityRoot -or
                [string]$document.ComposeFile -cne $composeFile -or
                [string]$document.ComposeOverrideFile -cne $composeOverrideFile -or
                [string]$document.EnvFile -cne $envFile -or
                [string]$document.MigrationJournalPath -cne $migrationJournalPath -or
                -not $composeFile.StartsWith($authorityPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                -not $composeOverrideFile.StartsWith($authorityPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                -not $envFile.StartsWith($authorityPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                -not $migrationJournalPath.StartsWith($authorityPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                [string]$document.ComposeProject -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$' -or
                [string]$document.ComposeFileSha256 -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.ComposeOverrideSha256 -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.EnvFileSha256 -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.MigrationAuthorityFingerprint -notmatch '^[A-F0-9]{64}$' -or
                [int64]$document.MigrationJournalRevision -lt 1 -or
                [string]$document.MigrationBackupAuthorityFingerprint -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.InventoryFingerprint -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.DurableVolumeFingerprint -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.MysqlVolumeComposeKey -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') {
                throw 'migration_runtime_authority_invalid'
            }
        } else {
            if ($role -notin @('Scheduled', 'Baseline', 'Emergency')) { throw 'role_invalid' }
            $expectedNames = @($commonNames + @('ActionId', 'PhaseInventoryFingerprint', 'DurableVolumeFingerprint') | Sort-Object)
            $null = ConvertTo-EasyFireCanonicalActionId -ActionId ([string]$document.ActionId)
            if ([string]$document.PhaseInventoryFingerprint -notmatch '^[A-F0-9]{64}$' -or
                [string]$document.DurableVolumeFingerprint -notmatch '^[A-F0-9]{64}$') {
                throw 'production_fingerprint_invalid'
            }
        }
        $actualNames = @($document.PSObject.Properties.Name | Sort-Object)
        $expectedFilePattern = if ($role -in @(
                'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled'
            )) {
            "-$([regex]::Escape($mode))-$([regex]::Escape($operationId))-capture-$([regex]::Escape($captureAttempt))\.sql\.gz$"
        } else {
            "-$([regex]::Escape($mode))-$([regex]::Escape($operationId))\.sql\.gz$"
        }
        if (@(Compare-Object $expectedNames $actualNames -CaseSensitive).Count -ne 0 -or
            [int]$document.SchemaVersion -ne 1 -or $mode -notin @('full', 'schema') -or
            [string]$document.MysqlContainerId -notmatch '^[a-f0-9]{64}$' -or
            -not [string]$document.MysqlContainerName -or -not [string]$document.MysqlImageReference -or
            [string]$document.MysqlImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
            -not [string]$document.MysqlVolumeName -or
            [string]$document.MysqlVolumeDestination -cne '/var/lib/mysql' -or
            [string]$document.BackupFile -cne [string]$pair.BackupFile -or
            [string]$document.BackupSha256 -cne [string]$pair.Sha256 -or
            [IO.Path]::GetFileName($pair.BackupFile) -notmatch $expectedFilePattern) {
            throw 'metadata_binding_invalid'
        }
        return [pscustomobject]@{
            Valid = $true
            Reason = 'verified'
            Document = $document
            MetadataFile = $metadataFile
            MetadataSha256 = Get-EasyFireSha256Hex -Path $metadataFile
        }
    } catch {
        return [pscustomobject]@{ Valid = $false; Reason = $_.Exception.Message }
    }
}

function Test-EasyFireBackupMetadataExact {
    param(
        [Parameter(Mandatory = $true)][string]$BackupFile,
        [Parameter(Mandatory = $true)]$ExpectedDocument
    )

    $binding = Test-EasyFireBackupMetadataBinding -BackupFile $BackupFile
    if (-not $binding.Valid) { return $binding }
    $actualCanonical = $binding.Document | ConvertTo-Json -Depth 8 -Compress
    $expectedCanonical = $ExpectedDocument | ConvertTo-Json -Depth 8 -Compress
    if ($actualCanonical -cne $expectedCanonical) {
        return [pscustomobject]@{ Valid = $false; Reason = 'metadata_authority_mismatch' }
    }
    return $binding
}

function New-EasyFirePublicationPlanDocument {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('planned', 'prepared')][string]$State,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Role,
        [string]$CanonicalActionId,
        [string]$MigrationId,
        [string]$ExactProofId,
        [Parameter(Mandatory = $true)]$SourceAuthority,
        [Parameter(Mandatory = $true)][string]$BackupFile,
        [Parameter(Mandatory = $true)][string]$SidecarFile,
        [Parameter(Mandatory = $true)][string]$MetadataFile,
        [Parameter(Mandatory = $true)][string]$PartialBackupFile,
        [Parameter(Mandatory = $true)][string]$PartialSidecarFile,
        [Parameter(Mandatory = $true)][string]$PartialMetadataFile,
        [string]$PreparedBackupSha256
    )

    if ($State -ceq 'prepared') {
        if ($PreparedBackupSha256 -notmatch '^[A-F0-9]{64}$') {
            throw 'A prepared publication plan requires one exact uppercase SHA-256.'
        }
    } elseif ($PreparedBackupSha256) {
        throw 'A planned publication cannot claim a prepared backup hash.'
    }

    if ($Role -ceq 'MigrationSource') {
        $document = [ordered]@{
            SchemaVersion = 1
            State = $State
            MigrationId = $MigrationId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            BackupMode = $Mode
            AuthorityRoot = [string]$SourceAuthority.AuthorityRoot
            ComposeProject = [string]$SourceAuthority.ComposeProject
            ComposeFile = [string]$SourceAuthority.ComposeFile
            ComposeFileSha256 = [string]$SourceAuthority.ComposeFileSha256
            EnvFile = [string]$SourceAuthority.EnvFile
            EnvFileSha256 = [string]$SourceAuthority.EnvFileSha256
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            MysqlVolumeComposeKey = [string]$SourceAuthority.MysqlVolumeComposeKey
            BackupFile = $BackupFile
            SidecarFile = $SidecarFile
            MetadataFile = $MetadataFile
            PartialBackupFile = $PartialBackupFile
            PartialSidecarFile = $PartialSidecarFile
            PartialMetadataFile = $PartialMetadataFile
        }
    } elseif ($Role -in @('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')) {
        $document = [ordered]@{
            SchemaVersion = 1
            State = $State
            MigrationId = $MigrationId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            CaptureAttemptId = [string]$SourceAuthority.CaptureAttemptId
            BackupMode = $Mode
            AuthorityRoot = [string]$SourceAuthority.AuthorityRoot
            MigrationJournalPath = [string]$SourceAuthority.MigrationJournalPath
            MigrationAuthorityFingerprint = [string]$SourceAuthority.MigrationAuthorityFingerprint
            MigrationJournalRevision = [int64]$SourceAuthority.MigrationJournalRevision
            MigrationBackupAuthorityFingerprint = [string]$SourceAuthority.MigrationBackupAuthorityFingerprint
            ComposeProject = [string]$SourceAuthority.ComposeProject
            ComposeFile = [string]$SourceAuthority.ComposeFile
            ComposeFileSha256 = [string]$SourceAuthority.ComposeFileSha256
            ComposeOverrideFile = [string]$SourceAuthority.ComposeOverrideFile
            ComposeOverrideSha256 = [string]$SourceAuthority.ComposeOverrideSha256
            EnvFile = [string]$SourceAuthority.EnvFile
            EnvFileSha256 = [string]$SourceAuthority.EnvFileSha256
            InventoryFingerprint = [string]$SourceAuthority.InventoryFingerprint
            DurableVolumeFingerprint = [string]$SourceAuthority.DurableVolumeFingerprint
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            MysqlVolumeComposeKey = [string]$SourceAuthority.MysqlVolumeComposeKey
            BackupFile = $BackupFile
            SidecarFile = $SidecarFile
            MetadataFile = $MetadataFile
            PartialBackupFile = $PartialBackupFile
            PartialSidecarFile = $PartialSidecarFile
            PartialMetadataFile = $PartialMetadataFile
        }
    } elseif ($Role -ceq 'DisposableProof') {
        $document = [ordered]@{
            SchemaVersion = 1
            State = $State
            ProofId = $ExactProofId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            BackupMode = $Mode
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            BackupFile = $BackupFile
            SidecarFile = $SidecarFile
            MetadataFile = $MetadataFile
            PartialBackupFile = $PartialBackupFile
            PartialSidecarFile = $PartialSidecarFile
            PartialMetadataFile = $PartialMetadataFile
        }
    } else {
        $document = [ordered]@{
            SchemaVersion = 1
            State = $State
            ActionId = $CanonicalActionId
            InvocationRole = $Role
            BackupOperationId = $OperationId
            BackupMode = $Mode
            PhaseInventoryFingerprint = [string]$SourceAuthority.PhaseInventoryFingerprint
            DurableVolumeFingerprint = [string]$SourceAuthority.DurableVolumeFingerprint
            JournalSha256 = [string]$SourceAuthority.JournalSha256
            MysqlContainerId = [string]$SourceAuthority.MysqlContainerId
            MysqlContainerName = [string]$SourceAuthority.MysqlContainerName
            MysqlImageReference = [string]$SourceAuthority.MysqlImageReference
            MysqlImageId = [string]$SourceAuthority.MysqlImageId
            MysqlVolumeName = [string]$SourceAuthority.MysqlVolumeName
            MysqlVolumeDestination = [string]$SourceAuthority.MysqlVolumeDestination
            BackupFile = $BackupFile
            SidecarFile = $SidecarFile
            MetadataFile = $MetadataFile
            PartialBackupFile = $PartialBackupFile
            PartialSidecarFile = $PartialSidecarFile
            PartialMetadataFile = $PartialMetadataFile
        }
    }
    if ($State -ceq 'prepared') {
        $document['PreparedBackupSha256'] = $PreparedBackupSha256
    }
    return $document
}

function Test-EasyFirePublicationPlanExact {
    param(
        [Parameter(Mandatory = $true)][string]$PublicationFile,
        [Parameter(Mandatory = $true)]$ExpectedDocument
    )

    try {
        if (-not (Test-Path -LiteralPath $PublicationFile -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $PublicationFile)) {
            throw 'publication_authority_missing_or_unsafe'
        }
        $actual = Get-Content -LiteralPath $PublicationFile -Raw -Encoding utf8 | ConvertFrom-Json
        $actualCanonical = $actual | ConvertTo-Json -Depth 8 -Compress
        $expectedCanonical = $ExpectedDocument | ConvertTo-Json -Depth 8 -Compress
        if ($actualCanonical -cne $expectedCanonical) {
            throw 'publication_authority_mismatch'
        }
        return [pscustomobject]@{ Valid = $true; Reason = 'verified'; Document = $actual }
    } catch {
        return [pscustomobject]@{ Valid = $false; Reason = $_.Exception.Message }
    }
}

function Reset-EasyFirePlannedPublication {
    param(
        [Parameter(Mandatory = $true)][string]$PublicationFile,
        [Parameter(Mandatory = $true)]$ExpectedPlan,
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot
    )

    $planValidation = Test-EasyFirePublicationPlanExact -PublicationFile $PublicationFile `
        -ExpectedDocument $ExpectedPlan
    if (-not $planValidation.Valid -or [string]$ExpectedPlan.State -cne 'planned') {
        throw "Cannot reset an unverified planned publication: $($planValidation.Reason)"
    }

    $finalPaths = @(
        [string]$ExpectedPlan.BackupFile,
        [string]$ExpectedPlan.SidecarFile,
        [string]$ExpectedPlan.MetadataFile
    )
    $partialPaths = @(
        [string]$ExpectedPlan.PartialBackupFile,
        [string]$ExpectedPlan.PartialSidecarFile,
        [string]$ExpectedPlan.PartialMetadataFile
    )
    foreach ($path in @($finalPaths + $partialPaths + $PublicationFile)) {
        $resolved = Resolve-EasyFireContainedPath -Path $path -AllowedRoot $ExactBackupRoot
        if ($resolved -cne [IO.Path]::GetFullPath($path)) {
            throw 'Publication authority names an artifact outside its exact backup root.'
        }
    }
    foreach ($path in $finalPaths) {
        if (Test-Path -LiteralPath $path) {
            throw 'A planned publication cannot reset after any final artifact exists.'
        }
    }
    foreach ($path in $partialPaths) {
        if (Test-Path -LiteralPath $path) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
                (Test-EasyFireReparsePoint -Path $path)) {
                throw 'A planned publication partial is not one regular operation-owned file.'
            }
        }
    }
    foreach ($path in $partialPaths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
        }
    }
}

function Complete-EasyFirePreparedPublication {
    param(
        [Parameter(Mandatory = $true)][string]$PublicationFile,
        [Parameter(Mandatory = $true)]$ExpectedPlan,
        [Parameter(Mandatory = $true)][string]$PlannedPublicationFile,
        [Parameter(Mandatory = $true)]$ExpectedPlannedPlan,
        [Parameter(Mandatory = $true)]$ExpectedMetadata,
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot
    )

    $planValidation = Test-EasyFirePublicationPlanExact -PublicationFile $PublicationFile `
        -ExpectedDocument $ExpectedPlan
    if (-not $planValidation.Valid -or [string]$ExpectedPlan.State -cne 'prepared') {
        throw "Cannot resume an unverified prepared publication: $($planValidation.Reason)"
    }
    if ([string]$ExpectedPlannedPlan.State -cne 'planned') {
        throw 'Prepared publication recovery requires its exact planned authority document.'
    }
    $plannedAuthorityExists = Test-Path -LiteralPath $PlannedPublicationFile
    if ($plannedAuthorityExists) {
        $plannedValidation = Test-EasyFirePublicationPlanExact `
            -PublicationFile $PlannedPublicationFile -ExpectedDocument $ExpectedPlannedPlan
        if (-not $plannedValidation.Valid) {
            throw "Prepared publication has invalid planned authority: $($plannedValidation.Reason)"
        }
    }
    $preparedHash = [string]$ExpectedPlan.PreparedBackupSha256
    if ($preparedHash -notmatch '^[A-F0-9]{64}$' -or
        [string]$ExpectedMetadata.BackupFile -cne [string]$ExpectedPlan.BackupFile -or
        [string]$ExpectedMetadata.BackupSha256 -cne $preparedHash) {
        throw 'Prepared publication metadata is not bound to the prepared backup authority.'
    }

    $compressedFile = [string]$ExpectedPlan.BackupFile
    $sidecarFile = [string]$ExpectedPlan.SidecarFile
    $metadataFile = [string]$ExpectedPlan.MetadataFile
    $partialCompressedFile = [string]$ExpectedPlan.PartialBackupFile
    $partialSidecarFile = [string]$ExpectedPlan.PartialSidecarFile
    $partialMetadataFile = [string]$ExpectedPlan.PartialMetadataFile
    $slots = @(
        [pscustomobject]@{ Name = 'backup'; Final = $compressedFile; Partial = $partialCompressedFile },
        [pscustomobject]@{ Name = 'sidecar'; Final = $sidecarFile; Partial = $partialSidecarFile },
        [pscustomobject]@{ Name = 'metadata'; Final = $metadataFile; Partial = $partialMetadataFile }
    )
    foreach ($path in @(
        $PublicationFile, $PlannedPublicationFile, $compressedFile, $sidecarFile, $metadataFile,
        $partialCompressedFile, $partialSidecarFile, $partialMetadataFile
    )) {
        $resolved = Resolve-EasyFireContainedPath -Path $path -AllowedRoot $ExactBackupRoot
        if ($resolved -cne [IO.Path]::GetFullPath($path)) {
            throw 'Prepared publication names an artifact outside its exact backup root.'
        }
    }
    foreach ($slot in $slots) {
        $finalExists = Test-Path -LiteralPath $slot.Final
        $partialExists = Test-Path -LiteralPath $slot.Partial
        if ([int]$finalExists + [int]$partialExists -ne 1) {
            throw "Prepared publication $($slot.Name) must exist at exactly one authorized path."
        }
        $activePath = if ($finalExists) { $slot.Final } else { $slot.Partial }
        if (-not (Test-Path -LiteralPath $activePath -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $activePath)) {
            throw "Prepared publication $($slot.Name) is not one regular file."
        }
    }
    if (-not $plannedAuthorityExists -and @($slots | Where-Object {
        Test-Path -LiteralPath $_.Partial -PathType Leaf
    }).Count -ne 0) {
        throw 'Prepared partial artifacts require the immutable planned authority record.'
    }

    $activeBackup = if (Test-Path -LiteralPath $compressedFile -PathType Leaf) {
        $compressedFile
    } else {
        $partialCompressedFile
    }
    if ((Get-Item -LiteralPath $activeBackup).Length -le 0 -or
        -not (Test-EasyFireGzipIntegrity -Path $activeBackup) -or
        (Get-EasyFireSha256Hex -Path $activeBackup) -cne $preparedHash) {
        throw 'Prepared publication backup bytes do not match their operation authority.'
    }
    $activeSidecar = if (Test-Path -LiteralPath $sidecarFile -PathType Leaf) {
        $sidecarFile
    } else {
        $partialSidecarFile
    }
    $sidecarLines = @(Get-Content -LiteralPath $activeSidecar -Encoding ascii)
    $expectedSidecar = "$preparedHash  $([IO.Path]::GetFileName($compressedFile))"
    if ($sidecarLines.Count -ne 1 -or [string]$sidecarLines[0] -cne $expectedSidecar) {
        throw 'Prepared publication sidecar does not exactly bind the final backup name and hash.'
    }
    $activeMetadata = if (Test-Path -LiteralPath $metadataFile -PathType Leaf) {
        $metadataFile
    } else {
        $partialMetadataFile
    }
    try {
        $actualMetadata = Get-Content -LiteralPath $activeMetadata -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        throw 'Prepared publication metadata is not valid JSON.'
    }
    if (($actualMetadata | ConvertTo-Json -Depth 8 -Compress) -cne
        ($ExpectedMetadata | ConvertTo-Json -Depth 8 -Compress)) {
        throw 'Prepared publication metadata does not match its exact operation authority.'
    }

    $planValidation = Test-EasyFirePublicationPlanExact -PublicationFile $PublicationFile `
        -ExpectedDocument $ExpectedPlan
    if (-not $planValidation.Valid) {
        throw 'Publication authority changed during prepared artifact validation.'
    }
    if ($plannedAuthorityExists) {
        $plannedValidation = Test-EasyFirePublicationPlanExact `
            -PublicationFile $PlannedPublicationFile -ExpectedDocument $ExpectedPlannedPlan
        if (-not $plannedValidation.Valid) {
            throw 'Planned publication authority changed during prepared artifact validation.'
        }
    }
    if (Test-Path -LiteralPath $partialCompressedFile -PathType Leaf) {
        Move-Item -LiteralPath $partialCompressedFile -Destination $compressedFile -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $partialSidecarFile -PathType Leaf) {
        Move-Item -LiteralPath $partialSidecarFile -Destination $sidecarFile -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $partialMetadataFile -PathType Leaf) {
        Move-Item -LiteralPath $partialMetadataFile -Destination $metadataFile -ErrorAction Stop
    }

    $publishedPair = Test-EasyFireBackupPair -BackupFile $compressedFile
    if (-not $publishedPair.Valid) {
        throw "Published pair verification failed: $($publishedPair.Reason)"
    }
    $publishedMetadata = Test-EasyFireBackupMetadataExact -BackupFile $compressedFile `
        -ExpectedDocument $ExpectedMetadata
    if (-not $publishedMetadata.Valid) {
        throw "Published metadata verification failed: $($publishedMetadata.Reason)"
    }
    $planValidation = Test-EasyFirePublicationPlanExact -PublicationFile $PublicationFile `
        -ExpectedDocument $ExpectedPlan
    if (-not $planValidation.Valid) {
        throw 'Prepared publication authority changed before authority closeout.'
    }
    if (Test-Path -LiteralPath $PlannedPublicationFile) {
        $plannedValidation = Test-EasyFirePublicationPlanExact `
            -PublicationFile $PlannedPublicationFile -ExpectedDocument $ExpectedPlannedPlan
        if (-not $plannedValidation.Valid) {
            throw 'Planned publication authority changed before authority closeout.'
        }
        Remove-Item -LiteralPath $PlannedPublicationFile -Force -ErrorAction Stop
    }
    Remove-Item -LiteralPath $PublicationFile -Force -ErrorAction Stop
    return [pscustomobject]@{ Pair = $publishedPair; Metadata = $publishedMetadata }
}

function Read-EasyFireEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)][string[]]$Lines,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $matches = @($Lines | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" })
    if ($matches.Count -ne 1 -or $matches[0] -notmatch '^\s*[^=]+\s*=\s*(.*)$') {
        throw "Environment must define $Name exactly once."
    }
    return $Matches[1].Trim()
}

function Resolve-EasyFirePinnedBackupPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot,
        [Parameter(Mandatory = $true)][string]$AuthorityName
    )

    $backupFile = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $ExactBackupRoot -MustExist
    if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $backupFile)) {
        throw "Journal-pinned backup is missing or unsafe: $AuthorityName"
    }
    return [IO.Path]::GetFileName($backupFile)
}

function Get-EasyFirePinnedBackupNames {
    param(
        [Parameter(Mandatory = $true)][string]$ProductionRoot,
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot,
        [Parameter(Mandatory = $true)][string]$ExactProjectName
    )

    $journalsRoot = Join-Path $ProductionRoot 'journals'
    if (-not (Test-Path -LiteralPath $journalsRoot -PathType Container)) { return @() }
    $null = Assert-EasyFireNoReparsePathChain -Path $journalsRoot -TrustedRoot $ProductionRoot
    $names = @()
    foreach ($journalFile in Get-ChildItem -LiteralPath $journalsRoot -Filter '*.json' -File) {
        if (Test-EasyFireReparsePoint -Path $journalFile.FullName) {
            throw 'Backup retention found a reparse-point journal.'
        }
        try { $document = Get-Content -LiteralPath $journalFile.FullName -Raw -Encoding utf8 | ConvertFrom-Json }
        catch { throw "Backup retention could not parse journal $($journalFile.Name)." }
        if ([string](Get-EasyFireBackupProperty -Object $document -Name 'Stage' -Default '') -cne 'Action') { continue }

        foreach ($propertyName in @('BaselineBackup', 'EmergencyBackup')) {
            $receipt = Get-EasyFireBackupProperty -Object $document -Name $propertyName
            if (-not $receipt) { continue }
            $names += Resolve-EasyFirePinnedBackupPath -Path ([string]$receipt.BackupFile) `
                -ExactBackupRoot $ExactBackupRoot -AuthorityName $propertyName
        }

        foreach ($candidateProperty in @($document.PSObject.Properties | Where-Object { $_.Name -like '*BackupCandidate' })) {
            if (-not $candidateProperty.Value) { continue }
            $candidatePath = if ($candidateProperty.Value -is [string]) {
                [string]$candidateProperty.Value
            } else {
                [string](Get-EasyFireBackupProperty -Object $candidateProperty.Value -Name 'BackupFile' -Default '')
            }
            if (-not $candidatePath) { throw "Backup candidate path is missing: $($candidateProperty.Name)" }
            $names += Resolve-EasyFirePinnedBackupPath -Path $candidatePath `
                -ExactBackupRoot $ExactBackupRoot -AuthorityName $candidateProperty.Name
        }

        foreach ($planProperty in @($document.PSObject.Properties | Where-Object { $_.Name -like '*BackupPlan' })) {
            if (-not $planProperty.Value) { continue }
            $operationId = [string](Get-EasyFireBackupProperty -Object $planProperty.Value -Name 'BackupOperationId' -Default '')
            if (-not $operationId) { continue }
            $operationId = ConvertTo-EasyFireCanonicalBackupOperationId -Value $operationId
            foreach ($plannedArtifact in Get-ChildItem -LiteralPath $ExactBackupRoot `
                -Filter "mysql-${ExactProjectName}-*-${operationId}.sql.gz" -File) {
                if (Test-EasyFireReparsePoint -Path $plannedArtifact.FullName) {
                    throw "Backup plan artifact is a reparse point: $($plannedArtifact.Name)"
                }
                $names += $plannedArtifact.Name
            }
        }
    }
    return @($names | Sort-Object -Unique)
}

function Write-EasyFirePublishedPair {
    param(
        [Parameter(Mandatory = $true)]$Pair,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$Metadata,
        [bool]$Reused = $false
    )

    $published = [ordered]@{
        BackupOperationId = $OperationId
        InvocationRole = $Role
        BackupMode = $Mode
        BackupFile = [string]$Pair.BackupFile
        SidecarFile = [string]$Pair.SidecarFile
        Sha256 = [string]$Pair.Sha256
        MetadataFile = [string]$Metadata.MetadataFile
        MetadataSha256 = [string]$Metadata.MetadataSha256
        Reused = $Reused
    }
    $metadataDocument = Get-EasyFireBackupProperty -Object $Metadata -Name 'Document'
    $captureAttempt = [string](Get-EasyFireBackupProperty -Object $metadataDocument `
        -Name 'CaptureAttemptId' -Default '')
    if ($captureAttempt) { $published['CaptureAttemptId'] = $captureAttempt }
    Write-Output ("BACKUP_PUBLISHED " + ($published | ConvertTo-Json -Compress))
}

function Assert-EasyFireJournalBackupAuthority {
    param(
        [Parameter(Mandatory = $true)][string]$ProductionRoot,
        [Parameter(Mandatory = $true)][string]$CanonicalActionId,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][string]$ExactProjectName,
        [Parameter(Mandatory = $true)][string]$ExactComposeFile,
        [Parameter(Mandatory = $true)][string]$ExactEnvFile
    )

    $allowedStatus = switch ($Role) {
        'Scheduled' { 'completed' }
        'Baseline' { 'baseline_backup_running' }
        'Emergency' { 'rollback_in_progress' }
    }
    $exactJournalPath = Get-EasyFireJournalPath -ProductionRoot $ProductionRoot -ActionId $CanonicalActionId
    $exactJournalPath = Resolve-EasyFireContainedPath -Path $exactJournalPath `
        -AllowedRoot (Join-Path $ProductionRoot 'journals') -MustExist
    if (-not (Test-Path -LiteralPath $exactJournalPath -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $exactJournalPath)) {
        throw 'The exact Action journal is missing or unsafe.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $exactJournalPath -TrustedRoot $ProductionRoot
    try { $journal = Get-Content -LiteralPath $exactJournalPath -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'The exact Action journal is not valid JSON.' }

    $validation = Test-EasyFireProductionJournal -Journal $journal -ExpectedActionId $CanonicalActionId `
        -ProductionRoot $ProductionRoot -ProjectName $ExactProjectName -AllowedStatuses @($allowedStatus)
    if (-not $validation.Valid) { throw "Backup journal authority failed: $($validation.Reason)" }

    $releaseDirectory = [string]$validation.ReleaseDirectory
    $expectedComposeFile = Join-Path $releaseDirectory 'docker-compose.prod.yml'
    $expectedEnvFile = Join-Path $releaseDirectory '.env'
    if ($ExactComposeFile -cne $expectedComposeFile -or $ExactEnvFile -cne $expectedEnvFile) {
        throw 'ComposeFile and EnvFile must be the exact sealed release files in the Action journal.'
    }

    $planName = $Role + 'BackupPlan'
    $plan = Get-EasyFireBackupProperty -Object $journal -Name $planName
    if (-not $plan -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'BackupOperationId' -Default '') -cne $OperationId -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'InvocationRole' -Default '') -cne $Role -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'BackupMode' -Default '') -cne $Mode) {
        throw "$planName must bind the exact BackupOperationId, InvocationRole, and BackupMode."
    }

    $candidateName = $Role + 'BackupCandidate'
    $candidate = Get-EasyFireBackupProperty -Object $journal -Name $candidateName
    if ($candidate) {
        $candidatePath = if ($candidate -is [string]) { [string]$candidate }
            else { [string](Get-EasyFireBackupProperty -Object $candidate -Name 'BackupFile' -Default '') }
        $expectedCandidate = Join-Path (Join-Path $ProductionRoot 'backups') `
            "mysql-${ExactProjectName}-${Mode}-${OperationId}.sql.gz"
        if ($candidatePath -cne $expectedCandidate) {
            throw "$candidateName does not match this operation's exact artifact."
        }
    }

    $phaseInventory = Get-EasyFireBackupProperty -Object $journal -Name 'PhaseInventory'
    $phaseFingerprint = [string](Get-EasyFireBackupProperty -Object $journal -Name 'PhaseInventoryFingerprint' -Default '')
    if (-not $phaseInventory -or $phaseFingerprint -notmatch '^[A-F0-9]{64}$' -or
        (Get-EasyFireInventoryFingerprint -Inventory $phaseInventory) -cne $phaseFingerprint) {
        throw 'PhaseInventoryFingerprint does not bind the exact journaled inventory.'
    }

    $expectedMysqlVolume = [string]$journal.ExpectedVolumes.MariaDb
    $expectedRedisVolume = [string]$journal.ExpectedVolumes.Redis
    if (-not $expectedMysqlVolume -or -not $expectedRedisVolume) {
        throw 'Journal expected durable-volume authority is incomplete.'
    }
    $currentInventory = Get-EasyFireComposeInventory -ProjectName $ExactProjectName `
        -ExactVolumeNames @($expectedMysqlVolume, $expectedRedisVolume)
    if ((Get-EasyFireInventoryFingerprint -Inventory $currentInventory) -cne $phaseFingerprint) {
        throw 'Current Compose inventory no longer matches PhaseInventoryFingerprint.'
    }

    $journalMysql = @($phaseInventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })
    $currentMysql = @($currentInventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })
    if ($journalMysql.Count -ne 1 -or $currentMysql.Count -ne 1) {
        throw 'Backup requires exactly one journaled MariaDB container.'
    }
    if ([string]$journalMysql[0].State -cne 'running' -or [string]$journalMysql[0].Health -cne 'healthy' -or
        [string]$currentMysql[0].State -cne 'running' -or [string]$currentMysql[0].Health -cne 'healthy') {
        throw 'Backup requires the exact journaled MariaDB container to be running and healthy.'
    }
    foreach ($identityProperty in @('Id', 'Name', 'Project', 'ImageReference', 'ImageId')) {
        if ([string]$currentMysql[0].$identityProperty -cne [string]$journalMysql[0].$identityProperty) {
            throw "MariaDB $identityProperty no longer matches journal authority."
        }
    }
    $expectedImage = "easyfire-bookkeeping/mariadb:$([string]$journal.MariaDbImageTag)"
    if ([string]$currentMysql[0].ImageReference -cne $expectedImage -or
        [string]$currentMysql[0].ImageId -notmatch '^sha256:[a-f0-9]{64}$') {
        throw 'MariaDB image does not match the exact journaled image authority.'
    }
    $mysqlMounts = @($currentMysql[0].Mounts | Where-Object { [string]$_.Type -ceq 'volume' })
    if ($mysqlMounts.Count -ne 1 -or [string]$mysqlMounts[0].Source -cne $expectedMysqlVolume -or
        [string]$mysqlMounts[0].Destination -cne '/var/lib/mysql') {
        throw 'MariaDB durable-volume mount does not match journal authority.'
    }
    $expectedVolumeNames = @($expectedMysqlVolume, $expectedRedisVolume) | Sort-Object
    $volumeNames = @($currentInventory.Volumes | ForEach-Object { [string]$_.Name } | Sort-Object)
    if (@(Compare-Object $expectedVolumeNames $volumeNames -CaseSensitive).Count -ne 0 -or
        [string]$journal.DurableVolumeFingerprint -notmatch '^[A-F0-9]{64}$' -or
        (Get-EasyFireVolumeFingerprint -Volumes @($currentInventory.Volumes)) -cne [string]$journal.DurableVolumeFingerprint) {
        throw 'Current durable volumes no longer match journal authority.'
    }

    return [pscustomobject]@{
        Journal = $journal
        JournalPath = $exactJournalPath
        JournalSha256 = Get-EasyFireSha256Hex -Path $exactJournalPath
        PhaseInventoryFingerprint = $phaseFingerprint
        DurableVolumeFingerprint = [string]$journal.DurableVolumeFingerprint
        MysqlContainerId = [string]$currentMysql[0].Id
        MysqlContainerName = [string]$currentMysql[0].Name
        MysqlImageReference = [string]$currentMysql[0].ImageReference
        MysqlImageId = [string]$currentMysql[0].ImageId
        MysqlVolumeName = [string]$mysqlMounts[0].Source
        MysqlVolumeDestination = [string]$mysqlMounts[0].Destination
    }
}

function Get-EasyFireMigrationSourceMysqlAuthority {
    param(
        [Parameter(Mandatory = $true)][string]$ExactAuthorityRoot,
        [Parameter(Mandatory = $true)][string]$ExactComposeFile,
        [Parameter(Mandatory = $true)][string]$ExactEnvFile,
        [Parameter(Mandatory = $true)][string]$ExactProjectName,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)][string]$ExpectedContainerId,
        [Parameter(Mandatory = $true)][string]$ExpectedImageReference,
        [Parameter(Mandatory = $true)][string]$ExpectedImageId,
        [Parameter(Mandatory = $true)][string]$ExpectedVolumeName,
        [Parameter(Mandatory = $true)][string]$ExpectedVolumeDestination
    )

    $null = ConvertTo-EasyFireCanonicalMigrationId -Value $CanonicalMigrationId
    if ($ExpectedContainerId -notmatch '^[a-f0-9]{64}$') {
        throw 'ExpectedMysqlContainerId must be exactly 64 lowercase hexadecimal characters.'
    }
    if (-not $ExpectedImageReference -or $ExpectedImageReference -match '[\x00-\x20]') {
        throw 'ExpectedMysqlImageReference must be one exact non-whitespace image reference.'
    }
    if ($ExpectedImageId -notmatch '^sha256:[a-f0-9]{64}$') {
        throw 'ExpectedMysqlImageId must be one exact lowercase sha256 image ID.'
    }
    if ($ExpectedVolumeName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') {
        throw 'ExpectedMysqlVolumeName is invalid.'
    }
    if ($ExpectedVolumeDestination -cne '/var/lib/mysql') {
        throw 'ExpectedMysqlVolumeDestination must be exactly /var/lib/mysql.'
    }
    if ($ExactProjectName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') {
        throw 'The migration-source Compose project is invalid.'
    }

    $authorityRoot = [IO.Path]::GetFullPath($ExactAuthorityRoot)
    if ($authorityRoot -cne $ExactAuthorityRoot -or
        -not (Test-Path -LiteralPath $authorityRoot -PathType Container) -or
        (Test-EasyFireReparsePoint -Path $authorityRoot)) {
        throw 'MigrationSource AuthorityRoot must be one exact existing regular directory.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $authorityRoot -TrustedRoot $authorityRoot
    $composeFile = Resolve-EasyFireContainedPath -Path $ExactComposeFile `
        -AllowedRoot $authorityRoot -MustExist
    $envFile = Resolve-EasyFireContainedPath -Path $ExactEnvFile `
        -AllowedRoot $authorityRoot -MustExist
    if ($composeFile -cne $ExactComposeFile -or $envFile -cne $ExactEnvFile -or
        -not (Test-Path -LiteralPath $composeFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $envFile -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $composeFile) -or
        (Test-EasyFireReparsePoint -Path $envFile)) {
        throw 'MigrationSource ComposeFile and EnvFile must be exact regular files under AuthorityRoot.'
    }

    $composeArgs = @(
        'compose', '-f', $composeFile, '--env-file', $envFile,
        '-p', $ExactProjectName, 'ps', '-q', 'mysql'
    )
    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $composeIds = @(& docker @composeArgs 2>$null | ForEach-Object {
            ([string]$_).Trim()
        } | Where-Object { $_ })
        $composeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($composeExit -ne 0 -or $composeIds.Count -ne 1 -or
        [string]$composeIds[0] -cne $ExpectedContainerId) {
        throw 'MigrationSource ComposeFile, EnvFile, project, and mysql service do not resolve to the caller-bound container ID.'
    }

    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $inspectText = @(& docker inspect $ExpectedContainerId 2>$null) -join "`n"
        $inspectExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($inspectExit -ne 0) { throw 'MigrationSource MariaDB container inspection failed.' }
    try { $parsed = $inspectText | ConvertFrom-Json }
    catch { throw 'MigrationSource MariaDB container inspection was not valid JSON.' }
    $containers = @($parsed)
    if ($containers.Count -ne 1) {
        throw 'MigrationSource MariaDB inspection did not return exactly one container.'
    }
    $container = $containers[0]
    $labels = $container.Config.Labels
    $mounts = @($container.Mounts | Where-Object {
        [string]$_.Type -ceq 'volume' -and
        [string]$_.Destination -ceq $ExpectedVolumeDestination
    })
    if ([string]$container.Id -cne $ExpectedContainerId -or
        [string]$container.Config.Image -cne $ExpectedImageReference -or
        [string]$container.Image -cne $ExpectedImageId -or
        [string]$labels.'com.docker.compose.project' -cne $ExactProjectName -or
        [string]$labels.'com.docker.compose.service' -notin @('mysql', 'mariadb') -or
        [string]$container.State.Status -cne 'running' -or
        [string]$container.State.Health.Status -cne 'healthy') {
        throw 'MigrationSource requires the exact caller-bound MariaDB container to be running and healthy.'
    }
    if ($mounts.Count -ne 1 -or [string]$mounts[0].Name -cne $ExpectedVolumeName -or
        [string]$mounts[0].Destination -cne $ExpectedVolumeDestination -or
        -not [bool]$mounts[0].RW) {
        throw 'MigrationSource MariaDB volume mount does not match caller-bound authority.'
    }

    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $volumeText = @(& docker volume inspect $ExpectedVolumeName 2>$null) -join "`n"
        $volumeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($volumeExit -ne 0) { throw 'MigrationSource MariaDB volume inspection failed.' }
    try { $parsedVolumes = $volumeText | ConvertFrom-Json }
    catch { throw 'MigrationSource MariaDB volume inspection was not valid JSON.' }
    $volumes = @($parsedVolumes)
    if ($volumes.Count -ne 1) {
        throw 'MigrationSource MariaDB volume inspection did not return exactly one volume.'
    }
    $volume = $volumes[0]
    $volumeComposeKey = [string]$volume.Labels.'com.docker.compose.volume'
    if ([string]$volume.Name -cne $ExpectedVolumeName -or
        [string]$volume.Driver -cne 'local' -or [string]$volume.Scope -cne 'local' -or
        [string]$volume.Labels.'com.docker.compose.project' -cne $ExactProjectName -or
        $volumeComposeKey -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') {
        throw 'MigrationSource MariaDB volume does not match caller-bound Compose authority.'
    }

    return [pscustomobject]@{
        MigrationId = $CanonicalMigrationId
        AuthorityRoot = $authorityRoot
        ComposeProject = $ExactProjectName
        ComposeFile = $composeFile
        ComposeFileSha256 = Get-EasyFireSha256Hex -Path $composeFile
        EnvFile = $envFile
        EnvFileSha256 = Get-EasyFireSha256Hex -Path $envFile
        MysqlContainerId = [string]$container.Id
        MysqlContainerName = ([string]$container.Name).TrimStart('/')
        MysqlImageReference = [string]$container.Config.Image
        MysqlImageId = [string]$container.Image
        MysqlVolumeName = [string]$mounts[0].Name
        MysqlVolumeDestination = [string]$mounts[0].Destination
        MysqlVolumeComposeKey = $volumeComposeKey
    }
}

function Get-EasyFireMigrationRuntimeMysqlAuthority {
    param(
        [Parameter(Mandatory = $true)][string]$ExactAuthorityRoot,
        [Parameter(Mandatory = $true)][string]$ExactComposeFile,
        [Parameter(Mandatory = $true)][string]$ExactComposeOverrideFile,
        [Parameter(Mandatory = $true)][string]$ExactEnvFile,
        [Parameter(Mandatory = $true)][string]$ExactProjectName,
        [Parameter(Mandatory = $true)][string]$CanonicalMigrationId,
        [Parameter(Mandatory = $true)][string]$ExactMigrationJournalPath,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)][string]$ExactCaptureAttemptId,
        [Parameter(Mandatory = $true)]
        [ValidateSet('MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')]
        [string]$Role
    )

    $null = ConvertTo-EasyFireCanonicalMigrationId -Value $CanonicalMigrationId
    $null = ConvertTo-EasyFireCanonicalBackupOperationId -Value $OperationId
    $null = ConvertTo-EasyFireCanonicalBackupOperationId -Value $ExactCaptureAttemptId
    $authorityRoot = [IO.Path]::GetFullPath($ExactAuthorityRoot)
    $authorityPrefix = $authorityRoot.TrimEnd('\') + '\'
    $expectedJournalPath = Join-Path (Join-Path (Join-Path $authorityRoot 'migrations') $CanonicalMigrationId) `
        'migration.journal.json'
    if ($ExactAuthorityRoot -cne $authorityRoot -or
        $ExactMigrationJournalPath -cne $expectedJournalPath -or
        -not (Test-Path -LiteralPath $authorityRoot -PathType Container) -or
        -not (Test-Path -LiteralPath $expectedJournalPath -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $authorityRoot) -or
        (Test-EasyFireReparsePoint -Path $expectedJournalPath)) {
        throw 'Migrated-runtime backup root or schema-2 journal authority is invalid.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $expectedJournalPath -TrustedRoot $authorityRoot

    $composeFile = Resolve-EasyFireContainedPath -Path $ExactComposeFile -AllowedRoot $authorityRoot -MustExist
    $composeOverrideFile = Resolve-EasyFireContainedPath -Path $ExactComposeOverrideFile `
        -AllowedRoot $authorityRoot -MustExist
    $envFile = Resolve-EasyFireContainedPath -Path $ExactEnvFile -AllowedRoot $authorityRoot -MustExist
    foreach ($file in @($composeFile, $composeOverrideFile, $envFile)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $file)) {
            throw 'Migrated-runtime Compose and environment authority must use exact regular files.'
        }
    }
    if ($composeFile -cne $ExactComposeFile -or
        $composeOverrideFile -cne $ExactComposeOverrideFile -or
        $envFile -cne $ExactEnvFile -or
        $ExactProjectName -notmatch '^easyfire-bookkeeping-mig-c-[a-f0-9]{12}$') {
        throw 'Migrated-runtime Compose path or project identity is not canonical.'
    }

    $journalSha256 = Get-EasyFireSha256Hex -Path $expectedJournalPath
    try { $journal = Get-Content -LiteralPath $expectedJournalPath -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'Migrated-runtime schema-2 journal is not valid JSON.' }
    if ((Get-EasyFireSha256Hex -Path $expectedJournalPath) -cne $journalSha256) {
        throw 'Migrated-runtime schema-2 journal changed while it was read.'
    }
    $authorityDocument = Get-EasyFireBackupProperty -Object $journal -Name 'Authority'
    $authorityFingerprint = [string](Get-EasyFireBackupProperty -Object $authorityDocument `
        -Name 'Fingerprint' -Default '')
    if ([int](Get-EasyFireBackupProperty -Object $journal -Name 'SchemaVersion' -Default 0) -ne 2 -or
        [string](Get-EasyFireBackupProperty -Object $journal -Name 'MigrationId' -Default '') -cne $CanonicalMigrationId -or
        [string](Get-EasyFireBackupProperty -Object $journal -Name 'AuthorityRoot' -Default '') -cne $authorityRoot -or
        $authorityFingerprint -notmatch '^[A-F0-9]{64}$' -or
        [int64](Get-EasyFireBackupProperty -Object $journal -Name 'Revision' -Default 0) -lt 1 -or
        (Get-EasyFireBackupProperty -Object $journal -Name 'PreserveOriginals' -Default $false) -isnot [bool] -or
        -not [bool]$journal.PreserveOriginals -or
        -not $authorityDocument) {
        throw 'Migrated-runtime backup requires one exact preservation-bound schema-2 journal.'
    }

    $currentState = [string](Get-EasyFireBackupProperty -Object $journal -Name 'CurrentState' -Default '')
    $phase = [string](Get-EasyFireBackupProperty -Object $journal -Name 'Phase' -Default '')
    switch ($Role) {
        'MigrationBaseline' {
            if ($currentState -cne 'CuttingOver' -or $phase -cne 'CutoverBaselineBackupRunning') {
                throw 'MigrationBaseline requires CuttingOver|CutoverBaselineBackupRunning authority.'
            }
        }
        'MigrationEmergency' {
            if ($currentState -cne 'Completed' -or $phase -cne 'EmergencyBackupRunning') {
                throw 'MigrationEmergency requires Completed|EmergencyBackupRunning authority.'
            }
        }
        'MigrationScheduled' {
            if ($currentState -cne 'Completed' -or $phase -cne 'Completed') {
                throw 'MigrationScheduled requires one quiescent Completed schema-2 journal.'
            }
        }
    }

    $backupReceipts = Get-EasyFireBackupProperty -Object $journal -Name 'BackupReceipts'
    $roleReceipt = if ($backupReceipts) {
        Get-EasyFireBackupProperty -Object $backupReceipts -Name $Role
    } else { $null }
    $planValue = if ($roleReceipt) { Get-EasyFireBackupProperty -Object $roleReceipt -Name 'Plan' } else { $null }
    $plan = if ($Role -ceq 'MigrationScheduled') {
        $scheduledPlans = @($planValue)
        if ($scheduledPlans.Count -gt 0) { $scheduledPlans[-1] } else { $null }
    } else { $planValue }
    $runtimeAuthority = if ($plan) { Get-EasyFireBackupProperty -Object $plan -Name 'RuntimeAuthority' } else { $null }
    $quiescence = if ($plan) { Get-EasyFireBackupProperty -Object $plan -Name 'Quiescence' } else { $null }
    if (-not $plan -or -not $runtimeAuthority -or
        [int](Get-EasyFireBackupProperty -Object $plan -Name 'SchemaVersion' -Default 0) -ne 1 -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'BackupOperationId' -Default '') -cne $OperationId -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'InvocationRole' -Default '') -cne $Role -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'BackupMode' -Default '') -cne 'full' -or
        [string](Get-EasyFireBackupProperty -Object $plan -Name 'State' -Default '') -cne 'active') {
        throw 'Migrated-runtime backup plan does not bind the exact active operation.'
    }
    $requiresQuiescence = $true
    $expectedQuiescenceStrategy = 'graceful-stop'
    $quiescenceServices = if ($quiescence) {
        @(Get-EasyFireBackupProperty -Object $quiescence -Name 'Services' -Default @())
    } else { @() }
    $requiredExitedServices = if ($quiescence) {
        @(Get-EasyFireBackupProperty -Object $quiescence -Name 'RequiredExitedServices' -Default @())
    } else { @() }
    $expectedApplicationServices = @('envoy', 'gotenberg', 'server', 'webapp')
    $actualQuiescenceServices = @($quiescenceServices | ForEach-Object {
            [string](Get-EasyFireBackupProperty -Object $_ -Name 'Service' -Default '')
        } | Sort-Object)
    if (-not $quiescence -or
        [int](Get-EasyFireBackupProperty -Object $quiescence -Name 'SchemaVersion' -Default 0) -ne 1 -or
        (Get-EasyFireBackupProperty -Object $quiescence -Name 'Required' -Default $null) -isnot [bool] -or
        [bool]$quiescence.Required -ne $requiresQuiescence -or
        [string](Get-EasyFireBackupProperty -Object $quiescence -Name 'Strategy' -Default '') -cne
            $expectedQuiescenceStrategy -or
        $quiescenceServices.Count -ne 4 -or
        $requiredExitedServices.Count -ne 1 -or
        [string]$requiredExitedServices[0] -cne 'database_migration' -or
        @(Compare-Object $expectedApplicationServices $actualQuiescenceServices -CaseSensitive).Count -ne 0) {
        throw 'Migrated-runtime backup plan lacks exact app-tier consistency-boundary authority.'
    }

    $runtimeFingerprint = Get-EasyFireBackupObjectSha256 -Value $runtimeAuthority
    $inventory = Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'Inventory'
    $mysqlAuthority = Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'Mysql'
    $redisAuthority = Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'Redis'
    if ([int](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'SchemaVersion' -Default 0) -ne 1 -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'MigrationId' -Default '') -cne $CanonicalMigrationId -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'AuthorityRoot' -Default '') -cne $authorityRoot -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'AuthorityFingerprint' -Default '') -cne
            $authorityFingerprint -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'ProjectName' -Default '') -cne $ExactProjectName -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'ComposeFile' -Default '') -cne $composeFile -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'ComposeOverrideFile' -Default '') -cne
            $composeOverrideFile -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'EnvFile' -Default '') -cne $envFile -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'ComposeFileSha256' -Default '') -cne
            (Get-EasyFireSha256Hex -Path $composeFile) -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'ComposeOverrideSha256' -Default '') -cne
            (Get-EasyFireSha256Hex -Path $composeOverrideFile) -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'EnvFileSha256' -Default '') -cne
            (Get-EasyFireSha256Hex -Path $envFile) -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'InventoryFingerprint' -Default '') -notmatch
            '^[A-F0-9]{64}$' -or
        [string](Get-EasyFireBackupProperty -Object $runtimeAuthority -Name 'DurableVolumeFingerprint' -Default '') -notmatch
            '^[A-F0-9]{64}$' -or
        -not $inventory -or -not $mysqlAuthority -or -not $redisAuthority) {
        throw 'Migrated-runtime backup plan runtime authority is incomplete or changed.'
    }

    $target = Get-EasyFireBackupProperty -Object (Get-EasyFireBackupProperty -Object $authorityDocument `
        -Name 'Document') -Name 'Target'
    $lanes = Get-EasyFireBackupProperty -Object $journal -Name 'Lanes'
    $cutoverLane = if ($lanes) { Get-EasyFireBackupProperty -Object $lanes -Name 'Cutover' } else { $null }
    if (-not $target -or -not $cutoverLane -or
        [string](Get-EasyFireBackupProperty -Object $target -Name 'ReleaseDirectory' -Default '') -cne
            [string]$runtimeAuthority.ReleaseDirectory -or
        [string](Get-EasyFireBackupProperty -Object $target -Name 'ComposeFile' -Default '') -cne $composeFile -or
        [string](Get-EasyFireBackupProperty -Object $target -Name 'ComposeFileSha256' -Default '') -cne
            [string]$runtimeAuthority.ComposeFileSha256 -or
        [string](Get-EasyFireBackupProperty -Object $cutoverLane -Name 'ProjectName' -Default '') -cne $ExactProjectName -or
        [string](Get-EasyFireBackupProperty -Object $cutoverLane -Name 'EnvironmentFile' -Default '') -cne $envFile -or
        [string](Get-EasyFireBackupProperty -Object $cutoverLane -Name 'ComposeOverrideFile' -Default '') -cne
            $composeOverrideFile -or
        [string](Get-EasyFireBackupProperty -Object $cutoverLane -Name 'MysqlVolumeName' -Default '') -cne
            [string]$mysqlAuthority.VolumeName -or
        [string](Get-EasyFireBackupProperty -Object $cutoverLane -Name 'RedisVolumeName' -Default '') -cne
            [string]$redisAuthority.VolumeName) {
        throw 'Migrated-runtime backup plan does not match immutable target and Cutover lane authority.'
    }

    if ($Role -in @('MigrationEmergency', 'MigrationScheduled')) {
        $completed = Get-EasyFireBackupProperty -Object $journal -Name 'CompletedAuthority'
        if (-not $completed -or [int]$completed.SchemaVersion -ne 1 -or
            [string]$completed.ProjectName -cne $ExactProjectName -or
            [string]$completed.ComposeFile -cne $composeFile -or
            [string]$completed.ComposeOverrideFile -cne $composeOverrideFile -or
            [string]$completed.EnvFile -cne $envFile -or
            [string]$completed.InventoryFingerprint -cne [string]$runtimeAuthority.InventoryFingerprint -or
            [string]$completed.DurableVolumeFingerprint -cne [string]$runtimeAuthority.DurableVolumeFingerprint -or
            ($completed.Inventory | ConvertTo-Json -Depth 30 -Compress) -cne
                ($inventory | ConvertTo-Json -Depth 30 -Compress) -or
            ($completed.Mysql | ConvertTo-Json -Depth 8 -Compress) -cne
                ($mysqlAuthority | ConvertTo-Json -Depth 8 -Compress) -or
            ($completed.Redis | ConvertTo-Json -Depth 8 -Compress) -cne
                ($redisAuthority | ConvertTo-Json -Depth 8 -Compress) -or
            -not (Get-EasyFireBackupProperty -Object $completed -Name 'BaselineRecoveryUnit')) {
            throw 'Migrated-runtime backup does not match immutable CompletedAuthority.'
        }
    }

    $currentInventory = Get-EasyFireComposeInventory -ProjectName $ExactProjectName `
        -ExactVolumeNames @([string]$mysqlAuthority.VolumeName, [string]$redisAuthority.VolumeName)
    $currentInventoryFingerprint = Get-EasyFireInventoryFingerprint -Inventory $currentInventory
    $currentDurableFingerprint = Get-EasyFireVolumeFingerprint -Volumes @($currentInventory.Volumes)
    if ($currentInventoryFingerprint -cne [string]$runtimeAuthority.InventoryFingerprint -or
        $currentDurableFingerprint -cne [string]$runtimeAuthority.DurableVolumeFingerprint) {
        throw 'Current migrated Compose inventory no longer matches the journaled runtime authority.'
    }

    $mysql = @($currentInventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })
    $redis = @($currentInventory.Containers | Where-Object { [string]$_.Service -ceq 'redis' })
    $mysqlMounts = if ($mysql.Count -eq 1) {
        @($mysql[0].Mounts | Where-Object { [string]$_.Type -ceq 'volume' -and
            [string]$_.Destination -ceq '/var/lib/mysql' })
    } else { @() }
    $redisMounts = if ($redis.Count -eq 1) {
        @($redis[0].Mounts | Where-Object { [string]$_.Type -ceq 'volume' })
    } else { @() }
    $mysqlHostPortCount = if ($mysql.Count -eq 1) { @($mysql[0].PortBindings).Count } else { -1 }
    $redisHostPortCount = if ($redis.Count -eq 1) { @($redis[0].PortBindings).Count } else { -1 }
    if ($mysql.Count -ne 1 -or $redis.Count -ne 1 -or
        [string]$mysql[0].State -cne 'running' -or [string]$mysql[0].Health -cne 'healthy' -or
        [string]$redis[0].State -cne 'running' -or [string]$redis[0].Health -cne 'healthy' -or
        $mysqlHostPortCount -ne 0 -or $redisHostPortCount -ne 0 -or
        $mysqlMounts.Count -ne 1 -or $redisMounts.Count -ne 1 -or
        [string]$mysql[0].Id -cne [string]$mysqlAuthority.ContainerId -or
        [string]$mysql[0].Name -cne [string]$mysqlAuthority.ContainerName -or
        [string]$mysql[0].ImageReference -cne [string]$mysqlAuthority.ImageReference -or
        [string]$mysql[0].ImageId -cne [string]$mysqlAuthority.ImageId -or
        [string]$mysqlMounts[0].Source -cne [string]$mysqlAuthority.VolumeName -or
        [string]$redis[0].Id -cne [string]$redisAuthority.ContainerId -or
        [string]$redis[0].Name -cne [string]$redisAuthority.ContainerName -or
        [string]$redis[0].ImageReference -cne [string]$redisAuthority.ImageReference -or
        [string]$redis[0].ImageId -cne [string]$redisAuthority.ImageId -or
        [string]$redisMounts[0].Source -cne [string]$redisAuthority.VolumeName) {
        throw 'Migrated-runtime MariaDB or Redis identity and health drifted from journal authority.'
    }

    foreach ($service in $expectedApplicationServices) {
        $current = @($currentInventory.Containers | Where-Object { [string]$_.Service -ceq $service })
        $planned = @($quiescenceServices | Where-Object {
                [string](Get-EasyFireBackupProperty -Object $_ -Name 'Service' -Default '') -ceq $service
            })
        if ($current.Count -ne 1 -or $planned.Count -ne 1 -or
            [string]$current[0].Id -cne [string]$planned[0].ContainerId -or
            [string]$current[0].Name -cne [string]$planned[0].ContainerName -or
            [string]$current[0].ImageReference -cne [string]$planned[0].ImageReference -or
            [string]$current[0].ImageId -cne [string]$planned[0].ImageId) {
            throw "Migrated-runtime application-tier identity drifted for service: $service"
        }
        if ([string]$current[0].State -cne 'exited') {
            throw "Migrated-runtime application tier is not quiesced for service: $service"
        }
    }
    $currentMigration = @($currentInventory.Containers | Where-Object {
            [string]$_.Service -ceq 'database_migration'
        })
    $plannedMigration = @($inventory.Containers | Where-Object {
            [string]$_.Service -ceq 'database_migration'
        })
    if ($currentMigration.Count -ne 1 -or $plannedMigration.Count -ne 1 -or
        [string]$currentMigration[0].Id -cne [string]$plannedMigration[0].Id -or
        [string]$currentMigration[0].Name -cne [string]$plannedMigration[0].Name -or
        [string]$currentMigration[0].ImageReference -cne [string]$plannedMigration[0].ImageReference -or
        [string]$currentMigration[0].ImageId -cne [string]$plannedMigration[0].ImageId -or
        [string]$currentMigration[0].State -cne 'exited') {
        throw 'Migrated-runtime database_migration service is not one exact exited non-writer.'
    }

    $composeArgs = @(
        'compose', '-f', $composeFile, '-f', $composeOverrideFile, '--env-file', $envFile,
        '-p', $ExactProjectName, 'ps', '-q', 'mysql'
    )
    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $composeIds = @(& docker @composeArgs 2>$null | ForEach-Object { ([string]$_).Trim() } |
            Where-Object { $_ })
        $composeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($composeExit -ne 0 -or $composeIds.Count -ne 1 -or
        [string]$composeIds[0] -cne [string]$mysqlAuthority.ContainerId) {
        throw 'Migrated-runtime Compose files and environment do not resolve to the journaled MariaDB.'
    }

    return [pscustomobject]@{
        MigrationId = $CanonicalMigrationId
        AuthorityRoot = $authorityRoot
        MigrationJournalPath = $expectedJournalPath
        MigrationJournalSha256 = $journalSha256
        MigrationAuthorityFingerprint = $authorityFingerprint
        MigrationJournalRevision = [int64]$journal.Revision
        MigrationBackupAuthorityFingerprint = $runtimeFingerprint
        CaptureAttemptId = $ExactCaptureAttemptId
        ComposeProject = $ExactProjectName
        ComposeFile = $composeFile
        ComposeFileSha256 = [string]$runtimeAuthority.ComposeFileSha256
        ComposeOverrideFile = $composeOverrideFile
        ComposeOverrideSha256 = [string]$runtimeAuthority.ComposeOverrideSha256
        EnvFile = $envFile
        EnvFileSha256 = [string]$runtimeAuthority.EnvFileSha256
        InventoryFingerprint = $currentInventoryFingerprint
        DurableVolumeFingerprint = $currentDurableFingerprint
        MysqlContainerId = [string]$mysql[0].Id
        MysqlContainerName = [string]$mysql[0].Name
        MysqlImageReference = [string]$mysql[0].ImageReference
        MysqlImageId = [string]$mysql[0].ImageId
        MysqlVolumeName = [string]$mysqlMounts[0].Source
        MysqlVolumeDestination = [string]$mysqlMounts[0].Destination
        MysqlVolumeComposeKey = [string]$mysqlAuthority.VolumeComposeKey
    }
}

function Get-EasyFireDisposableMysqlAuthority {
    param(
        [Parameter(Mandatory = $true)][string]$ExactComposeFile,
        [Parameter(Mandatory = $true)][string]$ExactEnvFile,
        [Parameter(Mandatory = $true)][string]$ExactProjectName,
        [Parameter(Mandatory = $true)][string]$ExactProofId,
        [Parameter(Mandatory = $true)][string]$ExpectedVolumeName
    )

    $composeArgs = @('compose', '-f', $ExactComposeFile, '--env-file', $ExactEnvFile, '-p', $ExactProjectName)
    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $ids = @(& docker @composeArgs ps -q mysql 2>$null | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
        $composeExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($composeExit -ne 0 -or $ids.Count -ne 1 -or $ids[0] -notmatch '^[a-f0-9]{64}$') {
        throw 'Disposable proof requires exactly one proof-owned MariaDB container.'
    }

    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $inspectText = @(& docker inspect $ids[0] 2>$null) -join "`n"
        $inspectExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($inspectExit -ne 0) { throw 'Disposable proof MariaDB inspection failed.' }
    $parsed = $inspectText | ConvertFrom-Json
    $container = if ($parsed -is [array]) { $parsed[0] } else { $parsed }
    $labels = $container.Config.Labels
    $mounts = @($container.Mounts | Where-Object { [string]$_.Type -ceq 'volume' })
    if ([string]$container.Id -cne $ids[0] -or
        [string]$labels.'com.docker.compose.project' -cne $ExactProjectName -or
        [string]$labels.'com.docker.compose.service' -cne 'mysql' -or
        [string]$labels.'easyfire.proof.id' -cne $ExactProofId -or
        [string]$container.State.Status -cne 'running' -or
        [string]$container.State.Health.Status -cne 'healthy' -or
        $mounts.Count -ne 1 -or [string]$mounts[0].Name -cne $ExpectedVolumeName -or
        [string]$mounts[0].Destination -cne '/var/lib/mysql') {
        throw 'Disposable proof MariaDB identity or health is not exact.'
    }
    return [pscustomobject]@{
        MysqlContainerId = [string]$container.Id
        MysqlContainerName = ([string]$container.Name).TrimStart('/')
        MysqlImageReference = [string]$container.Config.Image
        MysqlImageId = [string]$container.Image
        MysqlVolumeName = [string]$mounts[0].Name
        MysqlVolumeDestination = [string]$mounts[0].Destination
    }
}

function Invoke-EasyFireBackupRetention {
    param(
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot,
        [Parameter(Mandatory = $true)][string]$ExactProductionRoot,
        [Parameter(Mandatory = $true)][string]$ExactProjectName,
        [Parameter(Mandatory = $true)][string]$Mode,
        [string]$ExactInvocationRole,
        [Parameter(Mandatory = $true)][int]$Count
    )

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [BACKUP STAGE: retain] Retaining $Count verified $Mode pairs..." -ForegroundColor Cyan
    $allCandidates = @(Get-ChildItem -LiteralPath $ExactBackupRoot `
        -Filter "mysql-${ExactProjectName}-${Mode}-*.sql.gz" -File | Sort-Object LastWriteTime -Descending)
    $verifiedBackups = @()
    $migrationPinnedNames = @()
    foreach ($candidate in $allCandidates) {
        $candidateSidecar = Get-EasyFireBackupSidecarPath -BackupFile $candidate.FullName
        if ((Test-EasyFireReparsePoint -Path $candidate.FullName) -or
            (Test-EasyFireReparsePoint -Path $candidateSidecar)) {
            Write-Warning "Retention ignored unsafe reparse-point artifact '$($candidate.Name)'; it was not deleted."
            continue
        }
        $pair = Test-EasyFireBackupPair -BackupFile $candidate.FullName
        $metadata = if ($pair.Valid) { Test-EasyFireBackupMetadataBinding -BackupFile $candidate.FullName } else { $null }
        if ($pair.Valid -and $metadata.Valid -and
            (-not $ExactInvocationRole -or
                [string]$metadata.Document.InvocationRole -ceq $ExactInvocationRole)) {
            $verifiedBackups += $candidate
            if ([string]$metadata.Document.InvocationRole -ceq 'MigrationSource') {
                $migrationPinnedNames += $candidate.Name
            }
        } elseif (-not $pair.Valid -or -not $metadata.Valid) {
            $reason = if (-not $pair.Valid) { $pair.Reason } else { $metadata.Reason }
            Write-Warning "Retention ignored unverified recovery unit '$($candidate.Name)' ($reason); it was not deleted."
        }
    }
    if ($verifiedBackups.Count -le $Count) { return }

    $pinnedNames = @(@(
        Get-EasyFirePinnedBackupNames -ProductionRoot $ExactProductionRoot `
            -ExactBackupRoot $ExactBackupRoot -ExactProjectName $ExactProjectName
    ) + $migrationPinnedNames | Sort-Object -Unique)
    $unpinned = @($verifiedBackups | Where-Object { $_.Name -notin $pinnedNames })
        foreach ($artifact in @($unpinned | Select-Object -Skip $Count)) {
            $sidecar = Get-EasyFireBackupSidecarPath -BackupFile $artifact.FullName
            $metadataFile = Get-EasyFireBackupMetadataPath -BackupFile $artifact.FullName
            Remove-Item -LiteralPath $artifact.FullName -Force -ErrorAction Stop
            Remove-Item -LiteralPath $sidecar -Force -ErrorAction Stop
            Remove-Item -LiteralPath $metadataFile -Force -ErrorAction Stop
            Write-Host "  Removed: $($artifact.Name)" -ForegroundColor DarkGray
    }
}

function Invoke-EasyFireRoleAwareBackupRetention {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(
            'Scheduled', 'Baseline', 'Emergency', 'DisposableProof', 'MigrationSource',
            'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled'
        )]
        [string]$Role,
        [Parameter(Mandatory = $true)][string]$ExactBackupRoot,
        [Parameter(Mandatory = $true)][string]$ExactProductionRoot,
        [Parameter(Mandatory = $true)][string]$ExactProjectName,
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][int]$Count
    )

    if ($Role -in @(
            'MigrationSource', 'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled'
        )) { return }
    $roleFilter = ''
    Invoke-EasyFireBackupRetention -ExactBackupRoot $ExactBackupRoot `
        -ExactProductionRoot $ExactProductionRoot -ExactProjectName $ExactProjectName `
        -Mode $Mode -ExactInvocationRole $roleFilter -Count $Count
}

try {
    $resolvedAuthorityRoot = [IO.Path]::GetFullPath($AuthorityRoot)
    if (-not (Test-Path -LiteralPath $resolvedAuthorityRoot -PathType Container) -or
        (Test-EasyFireReparsePoint -Path $resolvedAuthorityRoot)) {
        throw 'AuthorityRoot must be one existing regular directory.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $resolvedAuthorityRoot -TrustedRoot $resolvedAuthorityRoot
    $resolvedBackupDir = Resolve-EasyFireContainedPath -Path $BackupDir -AllowedRoot $resolvedAuthorityRoot -MustExist
    $expectedBackupDir = Join-Path $resolvedAuthorityRoot 'backups'
    if ($resolvedBackupDir -cne $expectedBackupDir -or
        -not (Test-Path -LiteralPath $resolvedBackupDir -PathType Container) -or
        (Test-EasyFireReparsePoint -Path $resolvedBackupDir)) {
        throw 'BackupDir must be the exact existing backups directory under AuthorityRoot.'
    }
    $BackupDir = $resolvedBackupDir
    $BackupOperationId = ConvertTo-EasyFireCanonicalBackupOperationId -Value $BackupOperationId
    if ($CaptureAttemptId) {
        $CaptureAttemptId = ConvertTo-EasyFireCanonicalBackupOperationId -Value $CaptureAttemptId
    }

    if ($ProjectName -notmatch $projectNameRegex) { throw 'ProjectName is invalid.' }
    $resolvedComposeFile = [IO.Path]::GetFullPath($ComposeFile)
    $resolvedComposeOverrideFile = if ($ComposeOverrideFile) {
        [IO.Path]::GetFullPath($ComposeOverrideFile)
    } else { '' }
    $resolvedEnvFile = [IO.Path]::GetFullPath($EnvFile)
    if (-not (Test-Path -LiteralPath $resolvedComposeFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $resolvedEnvFile -PathType Leaf)) {
        throw 'ComposeFile and EnvFile must be existing regular files.'
    }
    if ((Test-EasyFireReparsePoint -Path $resolvedComposeFile) -or
        (Test-EasyFireReparsePoint -Path $resolvedEnvFile)) {
        throw 'ComposeFile and EnvFile cannot be reparse points.'
    }
    if ($resolvedComposeOverrideFile -and
        (-not (Test-Path -LiteralPath $resolvedComposeOverrideFile -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $resolvedComposeOverrideFile))) {
        throw 'ComposeOverrideFile must be one existing regular file.'
    }

    $backupMutex = New-Object Threading.Mutex($false, (Get-EasyFireBackupMutexName -ProductionRoot $resolvedAuthorityRoot))
    try { $backupMutexAcquired = $backupMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $backupMutexAcquired = $true }
    if (-not $backupMutexAcquired) { throw 'Another journal-aware EasyFire backup or rollback teardown is active.' }

    $envLines = @(Get-Content -LiteralPath $resolvedEnvFile)
    $systemDbName = Read-EasyFireEnvironmentValue -Lines $envLines -Name 'SYSTEM_DB_NAME'
    $tenantPrefix = Read-EasyFireEnvironmentValue -Lines $envLines -Name 'TENANT_DB_NAME_PERFIX'
    if ($systemDbName -notmatch $identifierRegex -or $tenantPrefix -notmatch $identifierRegex) {
        throw 'Application schema identifiers are invalid.'
    }

    if ($DisposableProof) {
        if ($ProjectName -ceq 'easyfire-bookkeeping-prod') {
            throw 'Disposable proof cannot target the production project.'
        }
        if ($ActionId -or $InvocationRole -or $MigrationId -or $MigrationJournalPath -or
            $CaptureAttemptId -or
            $ComposeOverrideFile -or $ExpectedMysqlContainerId -or
            $ExpectedMysqlImageReference -or $ExpectedMysqlImageId -or $ExpectedMysqlVolumeName -or
            $ExpectedMysqlVolumeDestination) {
            throw 'Disposable proof cannot accept production Action journal authority.'
        }
        if ($ProofId -notmatch '^[a-f0-9]{32}$') { throw 'Disposable proof requires its exact lowercase proof ID.' }
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if (-not $resolvedAuthorityRoot.StartsWith($temporaryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Disposable proof AuthorityRoot must be under the local temporary directory.'
        }
        if ([IO.Path]::GetFileName($resolvedAuthorityRoot) -cne $ProofId -or
            $ProjectName -cne "efbk-proof-$($ProofId.Substring(0, 12))" -or
            $resolvedComposeFile -cne (Join-Path $resolvedAuthorityRoot 'resolved-compose.yml') -or
            $resolvedEnvFile -cne (Join-Path $resolvedAuthorityRoot 'proof.env')) {
            throw 'Disposable proof root, project, Compose file, environment, and proof ID do not match.'
        }
        $environmentProofId = Read-EasyFireEnvironmentValue -Lines $envLines -Name 'EASYFIRE_PROOF_ID'
        $environmentProofVolume = Read-EasyFireEnvironmentValue -Lines $envLines -Name 'MARIADB_VOLUME_NAME'
        if ($environmentProofId -cne $ProofId -or $environmentProofVolume -cne "easyfire-proof-$ProofId-mysql") {
            throw 'Disposable proof environment identity is not exact.'
        }
        $expectedProofVolume = "${ProjectName}_mysql"
        $sourceAuthority = Get-EasyFireDisposableMysqlAuthority -ExactComposeFile $resolvedComposeFile `
            -ExactEnvFile $resolvedEnvFile -ExactProjectName $ProjectName -ExactProofId $ProofId `
            -ExpectedVolumeName $expectedProofVolume
        $mysqlContainerId = [string]$sourceAuthority.MysqlContainerId
        $publishedRole = 'DisposableProof'
    } elseif (Test-EasyFireMigrationRuntimeBackupRole -Role $InvocationRole) {
        if ($ActionId -or $ProofId -or $ExpectedMysqlContainerId -or
            $ExpectedMysqlImageReference -or $ExpectedMysqlImageId -or
            $ExpectedMysqlVolumeName -or $ExpectedMysqlVolumeDestination) {
            throw 'Migrated-runtime backup accepts authority only from its schema-2 migration journal.'
        }
        if ($SchemaOnly) {
            throw 'Migrated-runtime backup requires a full backup; SchemaOnly is not authorized.'
        }
        foreach ($requiredInput in @(
                'AuthorityRoot', 'ComposeFile', 'ComposeOverrideFile', 'EnvFile',
                'ProjectName', 'MigrationJournalPath'
            )) {
            if (-not $PSBoundParameters.ContainsKey($requiredInput)) {
                throw "Migrated-runtime backup requires caller-bound -$requiredInput."
            }
        }
        if (-not $MigrationId -or -not $MigrationJournalPath -or -not $CaptureAttemptId) {
            throw 'Migrated-runtime backup requires MigrationId, MigrationJournalPath, and CaptureAttemptId.'
        }
        $MigrationId = ConvertTo-EasyFireCanonicalMigrationId -Value $MigrationId
        $sourceAuthority = Get-EasyFireMigrationRuntimeMysqlAuthority `
            -ExactAuthorityRoot $resolvedAuthorityRoot -ExactComposeFile $resolvedComposeFile `
            -ExactComposeOverrideFile $resolvedComposeOverrideFile -ExactEnvFile $resolvedEnvFile `
            -ExactProjectName $ProjectName -CanonicalMigrationId $MigrationId `
            -ExactMigrationJournalPath ([IO.Path]::GetFullPath($MigrationJournalPath)) `
            -OperationId $BackupOperationId -ExactCaptureAttemptId $CaptureAttemptId `
            -Role $InvocationRole
        $mysqlContainerId = [string]$sourceAuthority.MysqlContainerId
        $publishedRole = $InvocationRole
        $journalPath = [string]$sourceAuthority.MigrationJournalPath
        $journalAuthorityHash = [string]$sourceAuthority.MigrationJournalSha256
    } elseif ($InvocationRole -ceq 'MigrationSource') {
        if ($ActionId -or $ProofId) {
            throw 'MigrationSource cannot accept ActionId or disposable ProofId authority.'
        }
        if ($SchemaOnly) {
            throw 'MigrationSource requires a full backup; SchemaOnly is not authorized.'
        }
        foreach ($requiredInput in @('AuthorityRoot', 'ComposeFile', 'EnvFile', 'ProjectName')) {
            if (-not $PSBoundParameters.ContainsKey($requiredInput)) {
                throw "MigrationSource requires caller-bound -$requiredInput."
            }
        }
        if ($MigrationJournalPath -or $ComposeOverrideFile -or $CaptureAttemptId) {
            throw 'MigrationSource cannot accept migrated-runtime journal or Compose override authority.'
        }
        if (-not $MigrationId -or -not $ExpectedMysqlContainerId -or
            -not $ExpectedMysqlImageReference -or -not $ExpectedMysqlImageId -or
            -not $ExpectedMysqlVolumeName -or -not $ExpectedMysqlVolumeDestination) {
            throw 'MigrationSource requires MigrationId and every exact expected MariaDB identity input.'
        }
        $MigrationId = ConvertTo-EasyFireCanonicalMigrationId -Value $MigrationId
        $sourceAuthority = Get-EasyFireMigrationSourceMysqlAuthority `
            -ExactAuthorityRoot $resolvedAuthorityRoot -ExactComposeFile $resolvedComposeFile `
            -ExactEnvFile $resolvedEnvFile -ExactProjectName $ProjectName `
            -CanonicalMigrationId $MigrationId -ExpectedContainerId $ExpectedMysqlContainerId `
            -ExpectedImageReference $ExpectedMysqlImageReference -ExpectedImageId $ExpectedMysqlImageId `
            -ExpectedVolumeName $ExpectedMysqlVolumeName `
            -ExpectedVolumeDestination $ExpectedMysqlVolumeDestination
        $mysqlContainerId = [string]$sourceAuthority.MysqlContainerId
        $publishedRole = 'MigrationSource'
    } else {
        if (-not $ActionId -or -not $InvocationRole) {
            throw 'Production backup requires ActionId and InvocationRole.'
        }
        if ($ProofId) { throw 'Production backup cannot accept a disposable ProofId.' }
        if ($MigrationId -or $MigrationJournalPath -or $ComposeOverrideFile -or $CaptureAttemptId -or
            $ExpectedMysqlContainerId -or $ExpectedMysqlImageReference -or
            $ExpectedMysqlImageId -or $ExpectedMysqlVolumeName -or $ExpectedMysqlVolumeDestination) {
            throw 'Journal-authorized production backup cannot accept MigrationSource authority.'
        }
        $ActionId = ConvertTo-EasyFireCanonicalActionId -ActionId $ActionId
        $authority = Assert-EasyFireJournalBackupAuthority -ProductionRoot $resolvedAuthorityRoot `
            -CanonicalActionId $ActionId -Role $InvocationRole -OperationId $BackupOperationId `
            -Mode $dumpMode -ExactProjectName $ProjectName -ExactComposeFile $resolvedComposeFile `
            -ExactEnvFile $resolvedEnvFile
        $journalPath = [string]$authority.JournalPath
        $journalAuthorityHash = [string]$authority.JournalSha256
        $sourceAuthority = $authority
        $mysqlContainerId = [string]$authority.MysqlContainerId
        $publishedRole = $InvocationRole
    }

    $dumpFileName = "mysql-${ProjectName}-${dumpMode}-$BackupOperationId"
    if (Test-EasyFireMigrationRuntimeBackupRole -Role $publishedRole) {
        $dumpFileName = "$dumpFileName-capture-$CaptureAttemptId"
    }
    $compressedFile = Join-Path $BackupDir "$dumpFileName.sql.gz"
    $sidecarFile = Join-Path $BackupDir "$dumpFileName.sha256"
    $metadataFile = Get-EasyFireBackupMetadataPath -BackupFile $compressedFile
    $partialCompressedFile = "$compressedFile.operation-$BackupOperationId.partial"
    $partialSidecarFile = "$sidecarFile.operation-$BackupOperationId.partial"
    $partialMetadataFile = "$metadataFile.operation-$BackupOperationId.partial"
    $publicationFile = "$compressedFile.publication.json"
    $plannedPublicationFile = "$compressedFile.publication.planned.json"
    $plannedPublication = New-EasyFirePublicationPlanDocument -State 'planned' `
        -OperationId $BackupOperationId -Mode $dumpMode -Role $publishedRole `
        -CanonicalActionId $ActionId -MigrationId $MigrationId -ExactProofId $ProofId `
        -SourceAuthority $sourceAuthority `
        -BackupFile $compressedFile -SidecarFile $sidecarFile -MetadataFile $metadataFile `
        -PartialBackupFile $partialCompressedFile -PartialSidecarFile $partialSidecarFile `
        -PartialMetadataFile $partialMetadataFile

    if (Test-Path -LiteralPath $publicationFile) {
        if (-not (Test-Path -LiteralPath $publicationFile -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $publicationFile)) {
            throw 'The exact operation publication authority is not one regular file.'
        }
        try {
            $publicationState = Get-Content -LiteralPath $publicationFile -Raw -Encoding utf8 | ConvertFrom-Json
        } catch {
            throw 'The exact operation publication authority is not valid JSON.'
        }
        $state = [string](Get-EasyFireBackupProperty -Object $publicationState -Name 'State' -Default '')
        if ($state -ceq 'prepared') {
            $preparedHash = [string](Get-EasyFireBackupProperty -Object $publicationState `
                -Name 'PreparedBackupSha256' -Default '')
            $preparedPublication = New-EasyFirePublicationPlanDocument -State 'prepared' `
                -PreparedBackupSha256 $preparedHash -OperationId $BackupOperationId `
                -Mode $dumpMode -Role $publishedRole -CanonicalActionId $ActionId `
                -MigrationId $MigrationId -ExactProofId $ProofId -SourceAuthority $sourceAuthority `
                -BackupFile $compressedFile -SidecarFile $sidecarFile -MetadataFile $metadataFile `
                -PartialBackupFile $partialCompressedFile -PartialSidecarFile $partialSidecarFile `
                -PartialMetadataFile $partialMetadataFile
            $preparedMetadata = New-EasyFireBackupMetadataDocument -Pair ([pscustomobject]@{
                BackupFile = $compressedFile
                Sha256 = $preparedHash
            }) -OperationId $BackupOperationId -Mode $dumpMode -Role $publishedRole `
                -CanonicalActionId $ActionId -MigrationId $MigrationId `
                -ExactProofId $ProofId -SourceAuthority $sourceAuthority
            if ($journalPath -and (Get-EasyFireSha256Hex -Path $journalPath) -cne $journalAuthorityHash) {
                throw 'Action journal authority changed before publication recovery.'
            }
            $recovered = Complete-EasyFirePreparedPublication -PublicationFile $publicationFile `
                -ExpectedPlan $preparedPublication -PlannedPublicationFile $plannedPublicationFile `
                -ExpectedPlannedPlan $plannedPublication -ExpectedMetadata $preparedMetadata `
                -ExactBackupRoot $BackupDir
            Invoke-EasyFireRoleAwareBackupRetention -Role $publishedRole `
                -ExactBackupRoot $BackupDir -ExactProductionRoot $resolvedAuthorityRoot `
                -ExactProjectName $ProjectName -Mode $dumpMode -Count $RetentionCount
            if ($journalPath -and (Get-EasyFireSha256Hex -Path $journalPath) -cne $journalAuthorityHash) {
                throw 'Action journal authority changed during publication recovery.'
            }
            Write-EasyFirePublishedPair -Pair $recovered.Pair -OperationId $BackupOperationId `
                -Mode $dumpMode -Role $publishedRole -Metadata $recovered.Metadata -Reused $true
            exit 0
        } else {
            throw 'The exact operation publication authority has an unsupported state.'
        }
    } elseif (Test-Path -LiteralPath $plannedPublicationFile) {
        Reset-EasyFirePlannedPublication -PublicationFile $plannedPublicationFile `
            -ExpectedPlan $plannedPublication -ExactBackupRoot $BackupDir
    } elseif ((Test-Path -LiteralPath $partialCompressedFile) -or
        (Test-Path -LiteralPath $partialSidecarFile) -or
        (Test-Path -LiteralPath $partialMetadataFile)) {
        throw 'Operation-bound partial artifacts exist without exact publication authority.'
    }

    if ((Test-Path -LiteralPath $compressedFile) -or (Test-Path -LiteralPath $sidecarFile) -or
        (Test-Path -LiteralPath $metadataFile)) {
        if ((Test-EasyFireReparsePoint -Path $compressedFile) -or
            (Test-EasyFireReparsePoint -Path $sidecarFile) -or
            (Test-EasyFireReparsePoint -Path $metadataFile)) {
            throw 'The exact operation artifact cannot be a reparse point.'
        }
        $existingPair = Test-EasyFireBackupPair -BackupFile $compressedFile
        if (-not $existingPair.Valid) {
            throw "The exact operation artifact exists but is not a valid pair: $($existingPair.Reason)"
        }
        $expectedMetadata = New-EasyFireBackupMetadataDocument -Pair $existingPair `
            -OperationId $BackupOperationId -Mode $dumpMode -Role $publishedRole `
            -CanonicalActionId $ActionId -MigrationId $MigrationId `
            -ExactProofId $ProofId -SourceAuthority $sourceAuthority
        $existingMetadata = Test-EasyFireBackupMetadataExact -BackupFile $compressedFile `
            -ExpectedDocument $expectedMetadata
        if (-not $existingMetadata.Valid) {
            throw "Backup metadata no longer matches this exact backup authority: $($existingMetadata.Reason)"
        }
        Invoke-EasyFireRoleAwareBackupRetention -Role $publishedRole `
            -ExactBackupRoot $BackupDir -ExactProductionRoot $resolvedAuthorityRoot `
            -ExactProjectName $ProjectName -Mode $dumpMode -Count $RetentionCount
        if ($journalPath -and (Get-EasyFireSha256Hex -Path $journalPath) -cne $journalAuthorityHash) {
            throw 'Action journal authority changed during retry validation; refusing publication receipt.'
        }
        Write-EasyFirePublishedPair -Pair $existingPair -OperationId $BackupOperationId `
            -Mode $dumpMode -Role $publishedRole -Metadata $existingMetadata -Reused $true
        exit 0
    }

    if (-not (Test-Path -LiteralPath $plannedPublicationFile -PathType Leaf)) {
        $null = Write-EasyFireJsonAtomic -Path $plannedPublicationFile -Value $plannedPublication `
            -AllowedRoot $BackupDir
    }
    $plannedValidation = Test-EasyFirePublicationPlanExact -PublicationFile $plannedPublicationFile `
        -ExpectedDocument $plannedPublication
    if (-not $plannedValidation.Valid) {
        throw "Planned publication authority validation failed: $($plannedValidation.Reason)"
    }
    if ($publishedRole -ceq 'MigrationSource') {
        $revalidatedSourceAuthority = Get-EasyFireMigrationSourceMysqlAuthority `
            -ExactAuthorityRoot $resolvedAuthorityRoot -ExactComposeFile $resolvedComposeFile `
            -ExactEnvFile $resolvedEnvFile -ExactProjectName $ProjectName `
            -CanonicalMigrationId $MigrationId -ExpectedContainerId $ExpectedMysqlContainerId `
            -ExpectedImageReference $ExpectedMysqlImageReference -ExpectedImageId $ExpectedMysqlImageId `
            -ExpectedVolumeName $ExpectedMysqlVolumeName `
            -ExpectedVolumeDestination $ExpectedMysqlVolumeDestination
        if (($revalidatedSourceAuthority | ConvertTo-Json -Depth 8 -Compress) -cne
            ($sourceAuthority | ConvertTo-Json -Depth 8 -Compress)) {
            throw 'MigrationSource authority changed immediately before dump.'
        }
    } elseif (Test-EasyFireMigrationRuntimeBackupRole -Role $publishedRole) {
        $revalidatedSourceAuthority = Get-EasyFireMigrationRuntimeMysqlAuthority `
            -ExactAuthorityRoot $resolvedAuthorityRoot -ExactComposeFile $resolvedComposeFile `
            -ExactComposeOverrideFile $resolvedComposeOverrideFile -ExactEnvFile $resolvedEnvFile `
            -ExactProjectName $ProjectName -CanonicalMigrationId $MigrationId `
            -ExactMigrationJournalPath $journalPath -OperationId $BackupOperationId `
            -ExactCaptureAttemptId $CaptureAttemptId -Role $publishedRole
        if (($revalidatedSourceAuthority | ConvertTo-Json -Depth 30 -Compress) -cne
            ($sourceAuthority | ConvertTo-Json -Depth 30 -Compress)) {
            throw 'Migrated-runtime authority changed immediately before dump.'
        }
    }
    $containerSql = "/tmp/$dumpFileName.sql"
    $containerGz = "/tmp/$dumpFileName.sql.gz"

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting authority-bound $dumpMode backup operation $BackupOperationId..." -ForegroundColor Cyan
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [BACKUP STAGE: discover] Discovering application schemas..." -ForegroundColor Cyan
    $savedEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $dbListResult = "SHOW DATABASES;" | docker exec -i $mysqlContainerId sh -c 'mariadb -u root -p"$MYSQL_ROOT_PASSWORD" -N' 2>$null
        $dbExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    if ($dbExit -ne 0) { throw "Failed to list databases from the exact MariaDB container (docker exit $dbExit)." }

    $allDatabases = @($dbListResult | ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and $_ -notmatch '^(information_schema|performance_schema|mysql|sys)$' })
    $appDatabases = @($allDatabases | Where-Object { $_ -eq $systemDbName -or $_ -like "${tenantPrefix}*" })
    if ($appDatabases.Count -eq 0) { throw 'No application schemas were found.' }
    foreach ($database in $appDatabases) {
        if ($database -notmatch $identifierRegex) { throw 'Schema identifier validation failed.' }
    }

    $dumpOptions = @('--single-transaction', '--routines', '--triggers', '--events', '--add-drop-database')
    if ($SchemaOnly) { $dumpOptions += '--no-data' }
    $dumpCommand = "mariadb-dump $($dumpOptions -join ' ') --databases $($appDatabases -join ' ') -u root -p`"`$MYSQL_ROOT_PASSWORD`" > $containerSql"
    try {
        $savedEap = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $null = docker exec $mysqlContainerId sh -c $dumpCommand 2>$null
            $dumpExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedEap }
        if ($dumpExit -ne 0) { throw "mariadb-dump failed in the exact container (docker exit $dumpExit)." }

        $savedEap = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $null = docker exec $mysqlContainerId gzip -f $containerSql 2>$null
            $gzipExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedEap }
        if ($gzipExit -ne 0) { throw "gzip failed in the exact container (docker exit $gzipExit)." }

        $savedEap = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $null = docker cp "${mysqlContainerId}:$containerGz" $partialCompressedFile 2>$null
            $copyExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedEap }
        if ($copyExit -ne 0) { throw "docker cp failed for the exact container (docker exit $copyExit)." }
    } finally {
        $savedEap = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $null = docker exec $mysqlContainerId rm -f $containerSql $containerGz 2>$null
        } finally { $ErrorActionPreference = $savedEap }
    }

    if (-not (Test-Path -LiteralPath $partialCompressedFile -PathType Leaf) -or
        (Get-Item -LiteralPath $partialCompressedFile).Length -le 0 -or
        -not (Test-EasyFireGzipIntegrity -Path $partialCompressedFile)) {
        throw 'Local gzip integrity verification failed.'
    }
    if ($journalPath -and (Get-EasyFireSha256Hex -Path $journalPath) -cne $journalAuthorityHash) {
        throw 'Action journal authority changed during backup; refusing publication.'
    }
    if ($publishedRole -ceq 'MigrationSource') {
        $revalidatedSourceAuthority = Get-EasyFireMigrationSourceMysqlAuthority `
            -ExactAuthorityRoot $resolvedAuthorityRoot -ExactComposeFile $resolvedComposeFile `
            -ExactEnvFile $resolvedEnvFile -ExactProjectName $ProjectName `
            -CanonicalMigrationId $MigrationId -ExpectedContainerId $ExpectedMysqlContainerId `
            -ExpectedImageReference $ExpectedMysqlImageReference -ExpectedImageId $ExpectedMysqlImageId `
            -ExpectedVolumeName $ExpectedMysqlVolumeName `
            -ExpectedVolumeDestination $ExpectedMysqlVolumeDestination
        if (($revalidatedSourceAuthority | ConvertTo-Json -Depth 8 -Compress) -cne
            ($sourceAuthority | ConvertTo-Json -Depth 8 -Compress)) {
            throw 'MigrationSource authority changed during backup; refusing publication.'
        }
    } elseif (Test-EasyFireMigrationRuntimeBackupRole -Role $publishedRole) {
        $revalidatedSourceAuthority = Get-EasyFireMigrationRuntimeMysqlAuthority `
            -ExactAuthorityRoot $resolvedAuthorityRoot -ExactComposeFile $resolvedComposeFile `
            -ExactComposeOverrideFile $resolvedComposeOverrideFile -ExactEnvFile $resolvedEnvFile `
            -ExactProjectName $ProjectName -CanonicalMigrationId $MigrationId `
            -ExactMigrationJournalPath $journalPath -OperationId $BackupOperationId `
            -ExactCaptureAttemptId $CaptureAttemptId -Role $publishedRole
        if (($revalidatedSourceAuthority | ConvertTo-Json -Depth 30 -Compress) -cne
            ($sourceAuthority | ConvertTo-Json -Depth 30 -Compress)) {
            throw 'Migrated-runtime authority changed during backup; refusing publication.'
        }
    }

    $sha256 = Get-EasyFireSha256Hex -Path $partialCompressedFile
    Set-Content -LiteralPath $partialSidecarFile `
        -Value "$sha256  $([IO.Path]::GetFileName($compressedFile))" -Encoding ascii
    $metadataDocument = New-EasyFireBackupMetadataDocument -Pair ([pscustomobject]@{
        BackupFile = $compressedFile
        Sha256 = $sha256
    }) -OperationId $BackupOperationId -Mode $dumpMode -Role $publishedRole `
        -CanonicalActionId $ActionId -MigrationId $MigrationId `
        -ExactProofId $ProofId -SourceAuthority $sourceAuthority
    $metadataJson = ($metadataDocument | ConvertTo-Json -Depth 8) + [Environment]::NewLine
    [IO.File]::WriteAllText($partialMetadataFile, $metadataJson, (New-Object Text.UTF8Encoding($false)))
    $preparedPublication = New-EasyFirePublicationPlanDocument -State 'prepared' `
        -PreparedBackupSha256 $sha256 -OperationId $BackupOperationId `
        -Mode $dumpMode -Role $publishedRole -CanonicalActionId $ActionId `
        -MigrationId $MigrationId -ExactProofId $ProofId -SourceAuthority $sourceAuthority `
        -BackupFile $compressedFile -SidecarFile $sidecarFile -MetadataFile $metadataFile `
        -PartialBackupFile $partialCompressedFile -PartialSidecarFile $partialSidecarFile `
        -PartialMetadataFile $partialMetadataFile
    $plannedValidation = Test-EasyFirePublicationPlanExact `
        -PublicationFile $plannedPublicationFile -ExpectedDocument $plannedPublication
    if (-not $plannedValidation.Valid) {
        throw 'Planned publication authority changed before prepared authority was recorded.'
    }
    $null = Write-EasyFireJsonAtomic -Path $publicationFile -Value $preparedPublication `
        -AllowedRoot $BackupDir
    $completed = Complete-EasyFirePreparedPublication -PublicationFile $publicationFile `
        -ExpectedPlan $preparedPublication -PlannedPublicationFile $plannedPublicationFile `
        -ExpectedPlannedPlan $plannedPublication -ExpectedMetadata $metadataDocument `
        -ExactBackupRoot $BackupDir
    $publishedPair = $completed.Pair
    $publishedMetadata = $completed.Metadata

    Invoke-EasyFireRoleAwareBackupRetention -Role $publishedRole `
        -ExactBackupRoot $BackupDir -ExactProductionRoot $resolvedAuthorityRoot `
        -ExactProjectName $ProjectName -Mode $dumpMode -Count $RetentionCount
    Write-EasyFirePublishedPair -Pair $publishedPair -OperationId $BackupOperationId `
        -Mode $dumpMode -Role $publishedRole -Metadata $publishedMetadata
    exit 0
} finally {
    if ($backupMutexAcquired -and $backupMutex) {
        try { $backupMutex.ReleaseMutex() } catch {}
    }
    if ($backupMutex) { $backupMutex.Dispose() }
}
