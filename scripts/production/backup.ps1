# EasyFire Bookkeeping -- authority-bound production backup
#
# Production calls must name one canonical Action journal, invocation role, and
# journaled backup operation. Disposable proof calls use -DisposableProof and
# are restricted to an exact temporary proof root and project identity.

[CmdletBinding()]
param(
    [switch]$SchemaOnly,

    [string]$ComposeFile = "$PSScriptRoot\..\..\docker-compose.prod.yml",
    [string]$EnvFile = "$PSScriptRoot\..\..\.env",
    [string]$ProjectName = "easyfire-bookkeeping-prod",
    [string]$BackupDir = "$PSScriptRoot\..\..\backups",
    [Parameter(Mandatory = $true)][string]$AuthorityRoot,
    [Parameter(Mandatory = $true)][string]$BackupOperationId,
    [string]$ActionId,
    [ValidateSet('Scheduled', 'Baseline', 'Emergency')]
    [string]$InvocationRole,
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
        [string]$ExactProofId,
        [Parameter(Mandatory = $true)]$SourceAuthority
    )

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
        if (@(Compare-Object $expectedNames $actualNames -CaseSensitive).Count -ne 0 -or
            [int]$document.SchemaVersion -ne 1 -or $mode -notin @('full', 'schema') -or
            [string]$document.MysqlContainerId -notmatch '^[a-f0-9]{64}$' -or
            -not [string]$document.MysqlContainerName -or -not [string]$document.MysqlImageReference -or
            [string]$document.MysqlImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
            -not [string]$document.MysqlVolumeName -or
            [string]$document.MysqlVolumeDestination -cne '/var/lib/mysql' -or
            [string]$document.BackupFile -cne [string]$pair.BackupFile -or
            [string]$document.BackupSha256 -cne [string]$pair.Sha256 -or
            [IO.Path]::GetFileName($pair.BackupFile) -notmatch "-$([regex]::Escape($mode))-$([regex]::Escape($operationId))\.sql\.gz$") {
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

    if ($Role -ceq 'DisposableProof') {
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
        [Parameter(Mandatory = $true)][int]$Count
    )

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [BACKUP STAGE: retain] Retaining $Count verified $Mode pairs..." -ForegroundColor Cyan
    $allCandidates = @(Get-ChildItem -LiteralPath $ExactBackupRoot `
        -Filter "mysql-${ExactProjectName}-${Mode}-*.sql.gz" -File | Sort-Object LastWriteTime -Descending)
    $verifiedBackups = @()
    foreach ($candidate in $allCandidates) {
        $candidateSidecar = Get-EasyFireBackupSidecarPath -BackupFile $candidate.FullName
        if ((Test-EasyFireReparsePoint -Path $candidate.FullName) -or
            (Test-EasyFireReparsePoint -Path $candidateSidecar)) {
            Write-Warning "Retention ignored unsafe reparse-point artifact '$($candidate.Name)'; it was not deleted."
            continue
        }
        $pair = Test-EasyFireBackupPair -BackupFile $candidate.FullName
        $metadata = if ($pair.Valid) { Test-EasyFireBackupMetadataBinding -BackupFile $candidate.FullName } else { $null }
        if ($pair.Valid -and $metadata.Valid) {
            $verifiedBackups += $candidate
        } else {
            $reason = if (-not $pair.Valid) { $pair.Reason } else { $metadata.Reason }
            Write-Warning "Retention ignored unverified recovery unit '$($candidate.Name)' ($reason); it was not deleted."
        }
    }
    if ($verifiedBackups.Count -le $Count) { return }

    $pinnedNames = @(Get-EasyFirePinnedBackupNames -ProductionRoot $ExactProductionRoot `
        -ExactBackupRoot $ExactBackupRoot -ExactProjectName $ExactProjectName)
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

    if ($ProjectName -notmatch $projectNameRegex) { throw 'ProjectName is invalid.' }
    $resolvedComposeFile = [IO.Path]::GetFullPath($ComposeFile)
    $resolvedEnvFile = [IO.Path]::GetFullPath($EnvFile)
    if (-not (Test-Path -LiteralPath $resolvedComposeFile -PathType Leaf) -or
        -not (Test-Path -LiteralPath $resolvedEnvFile -PathType Leaf)) {
        throw 'ComposeFile and EnvFile must be existing regular files.'
    }
    if ((Test-EasyFireReparsePoint -Path $resolvedComposeFile) -or
        (Test-EasyFireReparsePoint -Path $resolvedEnvFile)) {
        throw 'ComposeFile and EnvFile cannot be reparse points.'
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
        if ($ActionId -or $InvocationRole) {
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
    } else {
        if (-not $ActionId -or -not $InvocationRole) {
            throw 'Production backup requires ActionId and InvocationRole.'
        }
        if ($ProofId) { throw 'Production backup cannot accept a disposable ProofId.' }
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
        -CanonicalActionId $ActionId -ExactProofId $ProofId -SourceAuthority $sourceAuthority `
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
                -ExactProofId $ProofId -SourceAuthority $sourceAuthority `
                -BackupFile $compressedFile -SidecarFile $sidecarFile -MetadataFile $metadataFile `
                -PartialBackupFile $partialCompressedFile -PartialSidecarFile $partialSidecarFile `
                -PartialMetadataFile $partialMetadataFile
            $preparedMetadata = New-EasyFireBackupMetadataDocument -Pair ([pscustomobject]@{
                BackupFile = $compressedFile
                Sha256 = $preparedHash
            }) -OperationId $BackupOperationId -Mode $dumpMode -Role $publishedRole `
                -CanonicalActionId $ActionId -ExactProofId $ProofId -SourceAuthority $sourceAuthority
            if ($journalPath -and (Get-EasyFireSha256Hex -Path $journalPath) -cne $journalAuthorityHash) {
                throw 'Action journal authority changed before publication recovery.'
            }
            $recovered = Complete-EasyFirePreparedPublication -PublicationFile $publicationFile `
                -ExpectedPlan $preparedPublication -PlannedPublicationFile $plannedPublicationFile `
                -ExpectedPlannedPlan $plannedPublication -ExpectedMetadata $preparedMetadata `
                -ExactBackupRoot $BackupDir
            Invoke-EasyFireBackupRetention -ExactBackupRoot $BackupDir `
                -ExactProductionRoot $resolvedAuthorityRoot -ExactProjectName $ProjectName `
                -Mode $dumpMode -Count $RetentionCount
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
            -CanonicalActionId $ActionId -ExactProofId $ProofId -SourceAuthority $sourceAuthority
        $existingMetadata = Test-EasyFireBackupMetadataExact -BackupFile $compressedFile `
            -ExpectedDocument $expectedMetadata
        if (-not $existingMetadata.Valid) {
            throw "Backup metadata no longer matches this exact backup authority: $($existingMetadata.Reason)"
        }
        Invoke-EasyFireBackupRetention -ExactBackupRoot $BackupDir -ExactProductionRoot $resolvedAuthorityRoot `
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

    $sha256 = Get-EasyFireSha256Hex -Path $partialCompressedFile
    Set-Content -LiteralPath $partialSidecarFile `
        -Value "$sha256  $([IO.Path]::GetFileName($compressedFile))" -Encoding ascii
    $metadataDocument = New-EasyFireBackupMetadataDocument -Pair ([pscustomobject]@{
        BackupFile = $compressedFile
        Sha256 = $sha256
    }) -OperationId $BackupOperationId -Mode $dumpMode -Role $publishedRole `
        -CanonicalActionId $ActionId -ExactProofId $ProofId -SourceAuthority $sourceAuthority
    $metadataJson = ($metadataDocument | ConvertTo-Json -Depth 8) + [Environment]::NewLine
    [IO.File]::WriteAllText($partialMetadataFile, $metadataJson, (New-Object Text.UTF8Encoding($false)))
    $preparedPublication = New-EasyFirePublicationPlanDocument -State 'prepared' `
        -PreparedBackupSha256 $sha256 -OperationId $BackupOperationId `
        -Mode $dumpMode -Role $publishedRole -CanonicalActionId $ActionId `
        -ExactProofId $ProofId -SourceAuthority $sourceAuthority `
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

    Invoke-EasyFireBackupRetention -ExactBackupRoot $BackupDir -ExactProductionRoot $resolvedAuthorityRoot `
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
