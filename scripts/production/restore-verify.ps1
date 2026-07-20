# EasyFire Bookkeeping -- isolated restore verification
#
# Imports one metadata-bound, hash-verified application backup into one
# non-networked MariaDB container. A durable authority journal is published
# before Docker mutation. Both the container and its database volume have names
# derived from the exact ActionId plus BackupOperationId so a retry can inspect
# and remove only resources created by the same interrupted verification.

param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,

    [string]$EnvFile = "$PSScriptRoot\..\..\.env",

    [string]$ExpectedProofId = ""
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot 'backup-integrity.psm1') -Force -ErrorAction Stop
$MariaDbImage = "mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577"
$identifierRegex = '^[A-Za-z0-9_]+$'
$allPassed = $true
$createdContainerId = $null
$restoreAuthority = $null
$restoreJournalReady = $false
$restoreMutex = $null
$restoreMutexAcquired = $false

function Get-EasyFireRestoreProperty {
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

function ConvertTo-EasyFireRestoreCanonicalGuid {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) {
        throw "$FieldName must be a canonical GUID in D format."
    }
    $canonical = $parsed.ToString('D')
    if ($Value -cne $canonical) {
        throw "$FieldName must use canonical lowercase GUID form: $canonical"
    }
    return $canonical
}

function Test-EasyFireRestoreReparsePoint {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    return [bool]((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Get-EasyFireRestoreMetadataPath {
    param([Parameter(Mandatory = $true)][string]$BackupFile)

    if ([IO.Path]::GetFileName($BackupFile) -notmatch '\.sql\.gz$') {
        throw 'Restore verification requires an exact .sql.gz backup path.'
    }
    return ($BackupFile -replace '\.sql\.gz$', '.metadata.json')
}

function Get-EasyFireRestoreAuthorityToken {
    param(
        [Parameter(Mandatory = $true)][string]$ActionId,
        [Parameter(Mandatory = $true)][string]$BackupOperationId,
        [Parameter(Mandatory = $true)][string]$BackupSha256
    )

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes("$ActionId|$BackupOperationId|$BackupSha256")
        return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Get-EasyFireRestoreAuthority {
    param(
        [Parameter(Mandatory = $true)]$BackupPair,
        [string]$ExactExpectedProofId = ''
    )

    if (Test-EasyFireRestoreReparsePoint -Path ([string]$BackupPair.BackupFile)) {
        throw 'The restore backup cannot be a reparse point.'
    }
    $metadataFile = Get-EasyFireRestoreMetadataPath -BackupFile ([string]$BackupPair.BackupFile)
    if (-not (Test-Path -LiteralPath $metadataFile -PathType Leaf) -or
        (Test-EasyFireRestoreReparsePoint -Path $metadataFile)) {
        throw 'The exact backup metadata file is missing or unsafe.'
    }
    try {
        $metadata = Get-Content -LiteralPath $metadataFile -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        throw 'The exact backup metadata file is not valid JSON.'
    }

    $role = [string](Get-EasyFireRestoreProperty -Object $metadata -Name 'InvocationRole' -Default '')
    $backupOperationId = ConvertTo-EasyFireRestoreCanonicalGuid `
        -Value ([string](Get-EasyFireRestoreProperty -Object $metadata -Name 'BackupOperationId' -Default '')) `
        -FieldName 'BackupOperationId'
    $mode = [string](Get-EasyFireRestoreProperty -Object $metadata -Name 'BackupMode' -Default '')
    $commonNames = @(
        'SchemaVersion', 'InvocationRole', 'BackupOperationId', 'BackupMode',
        'MysqlContainerId', 'MysqlContainerName', 'MysqlImageReference', 'MysqlImageId',
        'MysqlVolumeName', 'MysqlVolumeDestination', 'BackupFile', 'BackupSha256'
    )
    $authorityKind = ''
    $proofId = ''
    $actionId = ''

    if ($role -ceq 'DisposableProof') {
        $authorityKind = 'proof'
        $expectedNames = @($commonNames + 'ProofId' | Sort-Object)
        $proofId = [string](Get-EasyFireRestoreProperty -Object $metadata -Name 'ProofId' -Default '')
        if (-not $ExactExpectedProofId -or $proofId -cne $ExactExpectedProofId -or
            $proofId -notmatch '^[a-f0-9]{32}$') {
            throw 'Disposable proof metadata does not match the exact ExpectedProofId.'
        }
        $actionId = '{0}-{1}-{2}-{3}-{4}' -f `
            $proofId.Substring(0, 8), $proofId.Substring(8, 4), $proofId.Substring(12, 4), `
            $proofId.Substring(16, 4), $proofId.Substring(20, 12)
        $actionId = ConvertTo-EasyFireRestoreCanonicalGuid -Value $actionId -FieldName 'Derived proof ActionId'
    } else {
        $authorityKind = 'production'
        if ($ExactExpectedProofId) {
            throw 'ExpectedProofId cannot be supplied for a production backup.'
        }
        if ($role -notin @('Scheduled', 'Baseline', 'Emergency')) {
            throw 'Backup metadata InvocationRole is not authorized for restore verification.'
        }
        $expectedNames = @($commonNames + @(
                'ActionId', 'PhaseInventoryFingerprint', 'DurableVolumeFingerprint'
            ) | Sort-Object)
        $actionId = ConvertTo-EasyFireRestoreCanonicalGuid `
            -Value ([string](Get-EasyFireRestoreProperty -Object $metadata -Name 'ActionId' -Default '')) `
            -FieldName 'ActionId'
        if ([string]$metadata.PhaseInventoryFingerprint -notmatch '^[A-F0-9]{64}$' -or
            [string]$metadata.DurableVolumeFingerprint -notmatch '^[A-F0-9]{64}$') {
            throw 'Production backup metadata fingerprints are invalid.'
        }
    }

    $actualNames = @($metadata.PSObject.Properties.Name | Sort-Object)
    if (@(Compare-Object $expectedNames $actualNames -CaseSensitive).Count -ne 0 -or
        [int](Get-EasyFireRestoreProperty -Object $metadata -Name 'SchemaVersion' -Default 0) -ne 1 -or
        $mode -notin @('full', 'schema') -or
        [string]$metadata.MysqlContainerId -notmatch '^[a-f0-9]{64}$' -or
        -not [string]$metadata.MysqlContainerName -or
        -not [string]$metadata.MysqlImageReference -or
        [string]$metadata.MysqlImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
        -not [string]$metadata.MysqlVolumeName -or
        [string]$metadata.MysqlVolumeDestination -cne '/var/lib/mysql' -or
        [string]$metadata.BackupFile -cne [string]$BackupPair.BackupFile -or
        [string]$metadata.BackupSha256 -cne [string]$BackupPair.Sha256 -or
        [IO.Path]::GetFileName([string]$BackupPair.BackupFile) -notmatch
            "-$([regex]::Escape($mode))-$([regex]::Escape($backupOperationId))\.sql\.gz$") {
        throw 'Backup metadata does not exactly bind this recovery unit.'
    }

    $authorityToken = Get-EasyFireRestoreAuthorityToken -ActionId $actionId `
        -BackupOperationId $backupOperationId -BackupSha256 ([string]$BackupPair.Sha256)
    $actionName = $actionId.Replace('-', '')
    $operationName = $backupOperationId.Replace('-', '')
    $containerName = "easyfire-restore-verify-$actionName-$operationName"
    $volumeName = "$containerName-data"
    $journalPath = "$([string]$BackupPair.BackupFile).restore-verify.json"
    $document = [ordered]@{
        SchemaVersion = 1
        State = 'planned'
        AuthorityKind = $authorityKind
        ActionId = $actionId
        ProofId = $proofId
        BackupOperationId = $backupOperationId
        BackupFile = [string]$BackupPair.BackupFile
        BackupSha256 = [string]$BackupPair.Sha256
        MetadataFile = $metadataFile
        MetadataSha256 = Get-EasyFireSha256Hex -Path $metadataFile
        ContainerName = $containerName
        VolumeName = $volumeName
        ImageReference = $script:MariaDbImage
        AuthorityToken = $authorityToken
    }
    return [pscustomobject]@{
        Document = $document
        JournalPath = $journalPath
        JournalCandidatePath = "$journalPath.planned"
        AuthorityKind = $authorityKind
        ActionId = $actionId
        ProofId = $proofId
        BackupOperationId = $backupOperationId
        ContainerName = $containerName
        VolumeName = $volumeName
        AuthorityToken = $authorityToken
    }
}

function Assert-EasyFireRestoreAuthorityDocument {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)]$ExpectedDocument
    )

    $expectedNames = @($ExpectedDocument.Keys | Sort-Object)
    $actualNames = @($Document.PSObject.Properties.Name | Sort-Object)
    $actualJson = $Document | ConvertTo-Json -Depth 8 -Compress
    $expectedJson = $ExpectedDocument | ConvertTo-Json -Depth 8 -Compress
    if (@(Compare-Object $expectedNames $actualNames -CaseSensitive).Count -ne 0 -or
        $actualJson -cne $expectedJson) {
        throw 'Restore-verifier journal does not match the exact backup authority.'
    }
}

function Read-EasyFireRestoreAuthorityJournal {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$ExpectedDocument
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or
        (Test-EasyFireRestoreReparsePoint -Path $Path)) {
        throw "Restore-verifier authority file is missing or unsafe: $Path"
    }
    try {
        $document = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        throw "Restore-verifier authority file is not valid JSON: $Path"
    }
    Assert-EasyFireRestoreAuthorityDocument -Document $document -ExpectedDocument $ExpectedDocument
    return $document
}

function Write-EasyFireUtf8NoBomDurable {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Text)
    $stream = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Write-EasyFireRestoreAuthorityJournal {
    param([Parameter(Mandatory = $true)]$Authority)

    $journalPath = [string]$Authority.JournalPath
    $candidatePath = [string]$Authority.JournalCandidatePath
    $journalExists = Test-Path -LiteralPath $journalPath -PathType Leaf
    $candidateExists = Test-Path -LiteralPath $candidatePath -PathType Leaf
    if ($journalExists -and $candidateExists) {
        throw 'Both restore-verifier journal authorities exist; refusing ambiguous recovery.'
    }
    if ($journalExists) {
        return Read-EasyFireRestoreAuthorityJournal -Path $journalPath -ExpectedDocument $Authority.Document
    }
    if ($candidateExists) {
        $null = Read-EasyFireRestoreAuthorityJournal -Path $candidatePath -ExpectedDocument $Authority.Document
    } else {
        $json = ($Authority.Document | ConvertTo-Json -Depth 8) + [Environment]::NewLine
        Write-EasyFireUtf8NoBomDurable -Path $candidatePath -Text $json
        $null = Read-EasyFireRestoreAuthorityJournal -Path $candidatePath -ExpectedDocument $Authority.Document
    }
    Move-Item -LiteralPath $candidatePath -Destination $journalPath -ErrorAction Stop
    return Read-EasyFireRestoreAuthorityJournal -Path $journalPath -ExpectedDocument $Authority.Document
}

function Get-EasyFireRestoreContainer {
    param([Parameter(Mandatory = $true)][string]$ContainerName)

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = docker container inspect $ContainerName --format '{{json .}}' 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($exitCode -ne 0) {
        $message = ($output -join ' ').Trim()
        if ($message -match 'No such container') { return $null }
        throw "Could not inspect exact restore-verifier container: $message"
    }
    try { return (($output | Select-Object -Last 1).Trim() | ConvertFrom-Json) }
    catch { throw 'Exact restore-verifier container inspection was not valid JSON.' }
}

function Get-EasyFireRestoreVolume {
    param([Parameter(Mandatory = $true)][string]$VolumeName)

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = docker volume inspect $VolumeName --format '{{json .}}' 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($exitCode -ne 0) {
        $message = ($output -join ' ').Trim()
        if ($message -match 'No such volume') { return $null }
        throw "Could not inspect exact restore-verifier volume: $message"
    }
    try { return (($output | Select-Object -Last 1).Trim() | ConvertFrom-Json) }
    catch { throw 'Exact restore-verifier volume inspection was not valid JSON.' }
}

function Assert-EasyFireRestoreLabels {
    param(
        [Parameter(Mandatory = $true)]$Labels,
        [Parameter(Mandatory = $true)]$Authority
    )

    if ([string](Get-EasyFireRestoreProperty -Object $Labels -Name 'easyfire.restore.action.id' -Default '') -cne
            [string]$Authority.ActionId -or
        [string](Get-EasyFireRestoreProperty -Object $Labels -Name 'easyfire.restore.backup.operation.id' -Default '') -cne
            [string]$Authority.BackupOperationId -or
        [string](Get-EasyFireRestoreProperty -Object $Labels -Name 'easyfire.restore.authority' -Default '') -cne
            [string]$Authority.AuthorityToken -or
        [string](Get-EasyFireRestoreProperty -Object $Labels -Name 'easyfire.restore.role' -Default '') -cne
            'restore-verify') {
        throw 'Restore-verifier resource labels do not match the exact journal authority.'
    }
    $actualProofId = [string](Get-EasyFireRestoreProperty -Object $Labels -Name 'easyfire.proof.id' -Default '')
    if ($actualProofId -cne [string]$Authority.ProofId) {
        throw 'Restore-verifier proof label does not match the exact journal authority.'
    }
}

function Assert-EasyFireRestoreContainer {
    param(
        [Parameter(Mandatory = $true)]$Container,
        [Parameter(Mandatory = $true)]$Authority
    )

    $mounts = @($Container.Mounts)
    if ([string]$Container.Id -notmatch '^[a-f0-9]{64}$' -or
        [string]$Container.Name -cne "/$([string]$Authority.ContainerName)" -or
        [string]$Container.Config.Image -cne $script:MariaDbImage -or
        [string]$Container.HostConfig.NetworkMode -cne 'none' -or
        $mounts.Count -ne 1 -or
        [string]$mounts[0].Type -cne 'volume' -or
        [string]$mounts[0].Name -cne [string]$Authority.VolumeName -or
        [string]$mounts[0].Destination -cne '/var/lib/mysql') {
        throw 'Restore-verifier container does not match exact journaled identity, isolation, and storage.'
    }
    Assert-EasyFireRestoreLabels -Labels $Container.Config.Labels -Authority $Authority
    return [string]$Container.Id
}

function Assert-EasyFireRestoreVolume {
    param(
        [Parameter(Mandatory = $true)]$Volume,
        [Parameter(Mandatory = $true)]$Authority
    )

    if ([string]$Volume.Name -cne [string]$Authority.VolumeName -or
        [string]$Volume.Driver -cne 'local' -or
        [string]$Volume.Scope -cne 'local') {
        throw 'Restore-verifier volume does not match the exact journaled identity.'
    }
    Assert-EasyFireRestoreLabels -Labels $Volume.Labels -Authority $Authority
}

function Remove-EasyFireRestoreResources {
    param([Parameter(Mandatory = $true)]$Authority)

    $container = Get-EasyFireRestoreContainer -ContainerName ([string]$Authority.ContainerName)
    if ($null -ne $container) {
        $createdContainerId = Assert-EasyFireRestoreContainer -Container $container -Authority $Authority
        docker rm -f -v $createdContainerId 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove exact restore-verifier container: $createdContainerId"
        }
    }
    $volume = Get-EasyFireRestoreVolume -VolumeName ([string]$Authority.VolumeName)
    if ($null -ne $volume) {
        Assert-EasyFireRestoreVolume -Volume $volume -Authority $Authority
        $VolumeName = [string]$Authority.VolumeName
        docker volume rm $VolumeName 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove exact restore-verifier volume: $VolumeName"
        }
    }
}

if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
    Write-Host "ERROR: Backup file not found: $BackupFile" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Write-Host "ERROR: Environment file not found: $EnvFile" -ForegroundColor Red
    exit 1
}
if ($ExpectedProofId -and $ExpectedProofId -notmatch '^[a-f0-9]{32}$') {
    Write-Host "ERROR: ExpectedProofId must be 32 lowercase hex characters" -ForegroundColor Red
    exit 1
}

$resolvedBackupFile = (Resolve-Path -LiteralPath $BackupFile).Path
$backupPair = Test-EasyFireBackupPair -BackupFile $resolvedBackupFile
if (-not $backupPair.Valid) {
    Write-Host "ERROR: Backup integrity verification failed ($($backupPair.Reason))" -ForegroundColor Red
    exit 1
}
$actualHash = $backupPair.Sha256

$envLines = Get-Content -LiteralPath $EnvFile
$systemDbName = $null
$tenantPrefix = $null
foreach ($line in $envLines) {
    if ($line -match '^\s*SYSTEM_DB_NAME\s*=\s*(.+)$') { $systemDbName = $Matches[1].Trim() }
    if ($line -match '^\s*TENANT_DB_NAME_PERFIX\s*=\s*(.+)$') { $tenantPrefix = $Matches[1].Trim() }
}
if (-not $systemDbName -or $systemDbName -notmatch $identifierRegex) {
    Write-Host "ERROR: SYSTEM_DB_NAME is missing or invalid" -ForegroundColor Red
    exit 1
}
if (-not $tenantPrefix -or $tenantPrefix -notmatch $identifierRegex) {
    Write-Host "ERROR: TENANT_DB_NAME_PERFIX is missing or invalid" -ForegroundColor Red
    exit 1
}

try {
    $restoreAuthority = Get-EasyFireRestoreAuthority -BackupPair $backupPair `
        -ExactExpectedProofId $ExpectedProofId
    $mutexName = "Global\EasyFireRestoreVerify-$([string]$restoreAuthority.AuthorityToken)"
    $restoreMutex = New-Object Threading.Mutex($false, $mutexName)
    try {
        $restoreMutexAcquired = $restoreMutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $restoreMutexAcquired = $true
    }
    if (-not $restoreMutexAcquired) {
        throw 'Another restore verifier owns the exact ActionId and BackupOperationId authority.'
    }

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $dockerInfo = docker info --format '{{.ServerVersion}}' 2>&1
        $dockerInfoExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($dockerInfoExit -ne 0 -or -not ($dockerInfo | Select-Object -Last 1).Trim()) {
        throw "Docker is not available for restore verification: $($dockerInfo -join ' ')"
    }

    $existingContainer = Get-EasyFireRestoreContainer `
        -ContainerName ([string]$restoreAuthority.ContainerName)
    $existingVolume = Get-EasyFireRestoreVolume `
        -VolumeName ([string]$restoreAuthority.VolumeName)
    $hasJournal = Test-Path -LiteralPath $restoreAuthority.JournalPath -PathType Leaf
    if (-not $hasJournal -and ($null -ne $existingContainer -or $null -ne $existingVolume)) {
        throw 'Refusing unjournaled restore-verifier resources with the deterministic authority names.'
    }

    $null = Write-EasyFireRestoreAuthorityJournal -Authority $restoreAuthority
    $restoreJournalReady = $true
    Remove-EasyFireRestoreResources -Authority $restoreAuthority

    $resourceLabelArguments = @(
        '--label', "easyfire.restore.action.id=$([string]$restoreAuthority.ActionId)",
        '--label', "easyfire.restore.backup.operation.id=$([string]$restoreAuthority.BackupOperationId)",
        '--label', "easyfire.restore.authority=$([string]$restoreAuthority.AuthorityToken)",
        '--label', 'easyfire.restore.role=restore-verify'
    )
    if ($restoreAuthority.ProofId) {
        $resourceLabelArguments += @('--label', "easyfire.proof.id=$([string]$restoreAuthority.ProofId)")
    }
    $volumeCreateArguments = @('volume', 'create', '--driver', 'local') +
        $resourceLabelArguments + @([string]$restoreAuthority.VolumeName)
    $volumeOutput = docker @volumeCreateArguments 2>&1
    if ($LASTEXITCODE -ne 0 -or
        ($volumeOutput | Select-Object -Last 1).Trim() -cne [string]$restoreAuthority.VolumeName) {
        throw "Failed to create exact restore-verifier volume: $($volumeOutput -join ' ')"
    }
    $createdVolume = Get-EasyFireRestoreVolume -VolumeName ([string]$restoreAuthority.VolumeName)
    if ($null -eq $createdVolume) { throw 'Docker did not return the created restore-verifier volume.' }
    Assert-EasyFireRestoreVolume -Volume $createdVolume -Authority $restoreAuthority

    $passwordBytes = New-Object byte[] 32
    $passwordGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $passwordGenerator.GetBytes($passwordBytes)
    } finally {
        $passwordGenerator.Dispose()
    }
    $tempPassword = (($passwordBytes | ForEach-Object { $_.ToString('x2') }) -join '')
    $verificationId = ([string]$restoreAuthority.AuthorityToken).Substring(0, 32)
    $tempContainerName = [string]$restoreAuthority.ContainerName
    $containerRestorePath = "/tmp/restore-$verificationId.sql.gz"
    $containerSqlPath = "/tmp/restore-$verificationId.sql"

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting isolated restore verification" -ForegroundColor Cyan
    Write-Host "  Backup:    $resolvedBackupFile"
    Write-Host "  Container: $tempContainerName (no host port)"
    Write-Host "  Volume:    $([string]$restoreAuthority.VolumeName)"
    Write-Host "  Image:     $MariaDbImage"
    Write-Host "  Action:    $([string]$restoreAuthority.ActionId)"
    Write-Host "  Operation: $([string]$restoreAuthority.BackupOperationId)"
    Write-Host "  SHA-256:   $actualHash" -ForegroundColor Green

    # Preserve the exact no-network contract: docker run --network none.
    $runArguments = @('run', '-d', '--network', 'none', '--name', $tempContainerName) +
        $resourceLabelArguments + @(
        '--mount', "type=volume,src=$([string]$restoreAuthority.VolumeName),dst=/var/lib/mysql",
        '-e', "MARIADB_ROOT_PASSWORD=$tempPassword",
        $MariaDbImage
    )
    $runOutput = docker @runArguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start temporary MariaDB: $($runOutput -join ' ')"
    }
    $createdContainerId = ($runOutput | Select-Object -Last 1).Trim()
    if ($createdContainerId -notmatch '^[a-f0-9]{64}$') {
        throw "Docker returned an invalid container ID"
    }
    $createdContainer = Get-EasyFireRestoreContainer -ContainerName $tempContainerName
    if ($null -eq $createdContainer -or
        (Assert-EasyFireRestoreContainer -Container $createdContainer -Authority $restoreAuthority) -cne
            $createdContainerId) {
        throw 'Docker container output did not match exact inspected restore-verifier authority.'
    }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Waiting for authenticated readiness" -ForegroundColor Cyan
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        $savedErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $selectResult = docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
                mariadb -u root -N --execute="SELECT 1;" 2>&1
            $selectExit = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $savedErrorActionPreference
        }
        if ($selectExit -eq 0 -and ($selectResult | Select-Object -Last 1).Trim() -eq '1') {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        throw "Temporary MariaDB did not become ready within 120 seconds"
    }

    docker cp $resolvedBackupFile "${createdContainerId}:$containerRestorePath" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker cp into restore container failed" }

    docker exec $createdContainerId gzip -t $containerRestorePath 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "gzip integrity check failed" }

    docker exec $createdContainerId gzip -d -k $containerRestorePath 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "gzip decompression failed" }

    docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
        mariadb -u root --execute="source $containerSqlPath" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "SQL import failed" }

    $dbList = docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
        mariadb -u root -N --execute="SHOW DATABASES;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Database discovery failed" }
    $applicationDatabases = @(
        $dbList |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and $_ -notmatch '^(information_schema|performance_schema|mysql|sys)$' }
    )

    if ($applicationDatabases -notcontains $systemDbName) {
        Write-Host "  FAIL: System database '$systemDbName' is missing" -ForegroundColor Red
        $allPassed = $false
    } else {
        Write-Host "  PASS: System database '$systemDbName' exists" -ForegroundColor Green
    }

    if ($applicationDatabases -contains $systemDbName) {
        $tableNames = docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
            mariadb -u root -N --execute="SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema='${systemDbName}' AND LOWER(TABLE_NAME)='tenants' AND table_type='BASE TABLE';" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Tenant table discovery failed" }
        $tableNames = @($tableNames | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        if ($tableNames.Count -ne 1 -or $tableNames[0] -notmatch $identifierRegex) {
            Write-Host "  FAIL: Exact tenants table discovery was not unique" -ForegroundColor Red
            $allPassed = $false
        } else {
            $tenantsTableName = $tableNames[0]
            $organizationIds = docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
                mariadb -u root -N --execute="SELECT organization_id FROM ${systemDbName}.${tenantsTableName} WHERE organization_id IS NOT NULL;" 2>&1
            if ($LASTEXITCODE -ne 0) { throw "Tenant topology query failed" }

            $expectedTenantDatabases = @(
                $organizationIds |
                    ForEach-Object { ($tenantPrefix + $_.Trim()) -replace '[^A-Za-z0-9_]', '' } |
                    Where-Object { $_ } |
                    Sort-Object -Unique
            )
            $actualTenantDatabases = @(
                $applicationDatabases |
                    Where-Object { $_ -like "${tenantPrefix}*" } |
                    Sort-Object -Unique
            )
            $tenantDifference = @(Compare-Object $expectedTenantDatabases $actualTenantDatabases)
            if ($tenantDifference.Count -gt 0) {
                Write-Host "  FAIL: Restored tenant database topology does not match tenants table" -ForegroundColor Red
                $allPassed = $false
            } else {
                Write-Host "  PASS: Tenant topology matched $($expectedTenantDatabases.Count) tenant(s)" -ForegroundColor Green
            }
        }
    }

    foreach ($database in $applicationDatabases) {
        if ($database -notmatch $identifierRegex) {
            Write-Host "  FAIL: Unsafe restored database identifier" -ForegroundColor Red
            $allPassed = $false
            continue
        }
        $tableCount = docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
            mariadb -u root -N --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$database' AND table_type='BASE TABLE';" 2>&1
        if ($LASTEXITCODE -ne 0 -or [int]($tableCount | Select-Object -Last 1) -le 0) {
            Write-Host "  FAIL: Database '$database' has no base tables" -ForegroundColor Red
            $allPassed = $false
            continue
        }
        docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
            mariadb-check -u root $database 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  FAIL: mariadb-check failed for '$database'" -ForegroundColor Red
            $allPassed = $false
        } else {
            Write-Host "  PASS: '$database' has tables and passed mariadb-check" -ForegroundColor Green
        }
    }

    if ($ExpectedProofId) {
        $marker = docker exec -e "MYSQL_PWD=$tempPassword" $createdContainerId `
            mariadb -u root -N --execute="SELECT proof_id FROM ${systemDbName}.easyfire_disposable_proof WHERE proof_id='${ExpectedProofId}';" 2>&1
        if ($LASTEXITCODE -ne 0 -or ($marker | Select-Object -Last 1).Trim() -ne $ExpectedProofId) {
            Write-Host "  FAIL: Exact disposable proof marker was not restored" -ForegroundColor Red
            $allPassed = $false
        } else {
            Write-Host "  PASS: Exact disposable proof marker was restored" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $_" -ForegroundColor Red
    $allPassed = $false
} finally {
    if ($restoreJournalReady) {
        $cleanupPassed = $false
        try {
            Remove-EasyFireRestoreResources -Authority $restoreAuthority
            $cleanupPassed = $true
        } catch {
            Write-Host "WARNING: exact restore-verifier resource cleanup failed: $_" -ForegroundColor Yellow
            $allPassed = $false
        }
        if ($cleanupPassed) {
            try {
                $null = Read-EasyFireRestoreAuthorityJournal `
                    -Path $restoreAuthority.JournalPath -ExpectedDocument $restoreAuthority.Document
                Remove-Item -LiteralPath $restoreAuthority.JournalPath -Force -ErrorAction Stop
            } catch {
                Write-Host "WARNING: restore-verifier journal closeout failed: $_" -ForegroundColor Yellow
                $allPassed = $false
            }
        }
    }
    if ($restoreMutexAcquired -and $restoreMutex) {
        try { $restoreMutex.ReleaseMutex() }
        catch {
            Write-Host "WARNING: restore-verifier mutex release failed: $_" -ForegroundColor Yellow
            $allPassed = $false
        }
    }
    if ($restoreMutex) { $restoreMutex.Dispose() }
}

if ($allPassed) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] RESTORE VERIFICATION PASSED" -ForegroundColor Green
    exit 0
}
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] RESTORE VERIFICATION FAILED" -ForegroundColor Red
exit 1
