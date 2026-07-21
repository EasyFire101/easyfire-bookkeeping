# EasyFire Bookkeeping -- journaled live blue/green migration controller.
# Original releases, volumes, backups, journals, and recovery checkpoints are
# preservation-bound. The executor never removes a Docker volume or release.

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Plan', 'Rehearse', 'AcceptAuthentication', 'Cutover', 'Rollback')]
    [string]$Mode,

    [Parameter(Mandatory = $true)][string]$MigrationId,
    [Parameter(Mandatory = $true)][string]$AuthorityRoot,
    [Parameter(Mandatory = $true)][string]$ProductionRoot,

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
    [Parameter(Mandatory = $true)][string]$SourceInventoryFile,
    [Parameter(Mandatory = $true)][string]$SourceInventorySha256,

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
    [Parameter(Mandatory = $true)][string]$TargetEnvoyImageReference,
    [Parameter(Mandatory = $true)][string]$TargetEnvoyImageId,
    [Parameter(Mandatory = $true)][string]$TargetGotenbergImageReference,
    [Parameter(Mandatory = $true)][string]$TargetGotenbergImageId,
    [Parameter(Mandatory = $true)][string]$TargetMigrationImageReference,
    [Parameter(Mandatory = $true)][string]$TargetMigrationImageId,
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
    [Parameter(Mandatory = $true)][string]$BackupSidecarFile,
    [Parameter(Mandatory = $true)][string]$BackupSidecarSha256,
    [Parameter(Mandatory = $true)][string]$CloudflareCredentialFile,
    [Parameter(Mandatory = $true)][string]$CloudflareCredentialSha256,
    [Parameter(Mandatory = $true)][string]$AuthorityOwnerSid,

    [string]$NativeAuthenticationReceiptFile,
    [string]$NativeAuthenticationReceiptSha256,
    [switch]$ExecuteLive
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'migration-state.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'migration-runtime.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'migration-windows.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'production-io.psm1') -Force -ErrorAction Stop

$script:MetadataFields = @(
    'AuthorityRoot', 'BackupFile', 'BackupMode', 'BackupOperationId', 'BackupSha256',
    'ComposeFile', 'ComposeFileSha256', 'ComposeProject', 'EnvFile', 'EnvFileSha256',
    'InvocationRole', 'MigrationId', 'MysqlContainerId', 'MysqlContainerName',
    'MysqlImageId', 'MysqlImageReference', 'MysqlVolumeComposeKey',
    'MysqlVolumeDestination', 'MysqlVolumeName', 'SchemaVersion'
) | Sort-Object
$script:JournalRead = $null
$script:JournalPath = $null
$script:AuthorityFingerprint = $null
$script:CutoverMutationStarted = $false

function Get-EasyFireMigrationProperty {
    param($Object, [Parameter(Mandatory = $true)][string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function ConvertTo-EasyFireMigrationCanonicalGuid {
    param([Parameter(Mandatory = $true)][string]$Value, [Parameter(Mandatory = $true)][string]$Name)
    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed)) { throw "$Name must be a canonical lowercase GUID." }
    $canonical = $parsed.ToString('D').ToLowerInvariant()
    if ($Value -cne $canonical) { throw "$Name must be a canonical lowercase GUID." }
    return $canonical
}

function Assert-EasyFireMigrationHash {
    param([Parameter(Mandatory = $true)][string]$Value, [Parameter(Mandatory = $true)][string]$Name)
    if ($Value -notmatch '^[A-F0-9]{64}$') { throw "$Name must be a canonical uppercase SHA-256." }
}

function Get-EasyFireMigrationPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [ValidateSet('Leaf', 'Container')][string]$Kind,
        [string]$AllowedRoot
    )
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -cne [IO.Path]::GetFullPath($Path)) {
        throw "$Name must already be a canonical absolute path."
    }
    if ($Kind -and -not (Test-Path -LiteralPath $Path -PathType $Kind)) { throw "$Name is missing: $Path" }
    $current = if (Test-Path -LiteralPath $Path) { $Path } else { [IO.Path]::GetDirectoryName($Path) }
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "$Name path chain contains a reparse point: $current"
            }
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = $parent.FullName
    }
    if ($AllowedRoot) {
        $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
        $rootPrefix = $root + '\'
        if (-not [string]::Equals($Path, $root, [StringComparison]::OrdinalIgnoreCase) -and
            -not $Path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "$Name is outside its allowed root."
        }
    }
    return $Path
}

function Assert-EasyFireMigrationFileHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$Name
    )
    Assert-EasyFireMigrationHash -Value $ExpectedSha256 -Name $Name
    if ((Get-EasyFireMigrationFileSha256 -Path $Path) -cne $ExpectedSha256) {
        throw "$Name changed from exact authority."
    }
}

function Get-EasyFireMigrationFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    }
    finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Read-EasyFireMigrationJson {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Name)
    try { return Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw "$Name is not valid JSON." }
}

function Assert-EasyFireMigrationMetadata {
    param([Parameter(Mandatory = $true)]$Metadata)
    $actual = @($Metadata.PSObject.Properties.Name | Sort-Object)
    if (@(Compare-Object $script:MetadataFields $actual -CaseSensitive).Count -ne 0) {
        throw 'MigrationSource metadata property set is not exact.'
    }
    if ([int]$Metadata.SchemaVersion -ne 1 -or [string]$Metadata.InvocationRole -cne 'MigrationSource' -or
        [string]$Metadata.MigrationId -cne $MigrationId -or [string]$Metadata.BackupMode -cne 'full' -or
        [string]$Metadata.AuthorityRoot -cne $AuthorityRoot -or
        [string]$Metadata.ComposeProject -cne $SourceProjectName -or
        [string]$Metadata.ComposeFile -cne $SourceComposeFile -or
        [string]$Metadata.ComposeFileSha256 -cne $SourceComposeSha256 -or
        [string]$Metadata.EnvFile -cne $SourceEnvFile -or
        [string]$Metadata.EnvFileSha256 -cne $SourceEnvSha256 -or
        [string]$Metadata.MysqlContainerId -cne $SourceMysqlContainerId -or
        [string]$Metadata.MysqlContainerName -cne $SourceMysqlContainerName -or
        [string]$Metadata.MysqlImageReference -cne $SourceMysqlImageReference -or
        [string]$Metadata.MysqlImageId -cne $SourceMysqlImageId -or
        [string]$Metadata.MysqlVolumeName -cne $SourceMysqlVolumeName -or
        [string]$Metadata.MysqlVolumeComposeKey -cne $SourceMysqlVolumeComposeKey -or
        [string]$Metadata.MysqlVolumeDestination -cne '/var/lib/mysql') {
        throw 'MigrationSource metadata does not bind the exact source runtime.'
    }
    $null = ConvertTo-EasyFireMigrationCanonicalGuid -Value ([string]$Metadata.BackupOperationId) -Name 'BackupOperationId'
    $backupFile = Get-EasyFireMigrationPath -Path ([string]$Metadata.BackupFile) -Name 'BackupFile' -Kind Leaf -AllowedRoot $AuthorityRoot
    Assert-EasyFireMigrationFileHash -Path $backupFile -ExpectedSha256 ([string]$Metadata.BackupSha256) -Name 'BackupSha256'
    return $backupFile
}

function Assert-EasyFireMigrationTargetImages {
    param([Parameter(Mandatory = $true)][object[]]$Images, [switch]$InspectDocker)
    $expectedServices = @('database_migration', 'envoy', 'gotenberg', 'mysql', 'redis', 'server', 'webapp')
    foreach ($image in $Images) {
        if ([string]$image.Service -notin $expectedServices -or
            [string]::IsNullOrWhiteSpace([string]$image.ImageReference) -or
            [string]$image.ImageId -notmatch '^sha256:[a-f0-9]{64}$') {
            throw 'Target image authority is incomplete.'
        }
        if ($InspectDocker) {
            $inspect = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('image', 'inspect', [string]$image.ImageReference)).Text | ConvertFrom-Json
            $item = if ($inspect -is [array]) { $inspect[0] } else { $inspect }
            if ([string]$item.Id -cne [string]$image.ImageId) { throw "Target image ID drifted: $([string]$image.Service)" }
        }
    }
    $actualServices = @($Images | ForEach-Object { [string]$_.Service } | Sort-Object)
    if (@(Compare-Object $expectedServices $actualServices -CaseSensitive).Count -ne 0) {
        throw 'Target image authority must contain each of the seven exact services once.'
    }
}

function Refresh-EasyFireMigrationJournal {
    $script:JournalRead = Read-EasyFireMigrationJournal -JournalPath $script:JournalPath `
        -ExpectedMigrationId $MigrationId -ExpectedAuthorityFingerprint $script:AuthorityFingerprint
    if ([string]$script:JournalRead.Journal.AuthorityRoot -cne $AuthorityRoot) {
        throw 'Migration journal AuthorityRoot drifted from exact invocation authority.'
    }
    return $script:JournalRead
}

function Move-EasyFireMigrationPhase {
    param(
        [Parameter(Mandatory = $true)][string]$State,
        [Parameter(Mandatory = $true)][string]$Phase,
        $Receipt,
        $CompletedAuthority,
        [ValidateSet('InitialSource', 'FinalSource', 'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')]
        [string]$BackupReceiptRole,
        $BackupReceipt
    )
    $arguments = @{
        JournalPath = $script:JournalPath
        ExpectedJournalSha256 = [string]$script:JournalRead.Sha256
        ToState = $State
        ToPhase = $Phase
    }
    if ($null -ne $Receipt) { $arguments.ReceiptBinding = $Receipt }
    if ($null -ne $CompletedAuthority) { $arguments.CompletedAuthority = $CompletedAuthority }
    if ([bool]$BackupReceiptRole -ne ($null -ne $BackupReceipt)) {
        throw 'BackupReceiptRole and BackupReceipt must be supplied together.'
    }
    if ($BackupReceiptRole) {
        $arguments.BackupReceiptRole = $BackupReceiptRole
        $arguments.BackupReceipt = $BackupReceipt
    }
    $script:JournalRead = Save-EasyFireMigrationJournalTransition @arguments
    return $script:JournalRead
}

function New-EasyFireMigrationBackupPlanRecord {
    param(
        [Parameter(Mandatory = $true)][string]$BackupOperationId,
        [Parameter(Mandatory = $true)][string]$InvocationRole,
        [ValidateSet('active', 'completed')][string]$State = 'active',
        [string]$CompletedAtUtc = ''
    )
    return [pscustomobject][ordered]@{
        SchemaVersion = 1
        BackupOperationId = $BackupOperationId
        InvocationRole = $InvocationRole
        BackupMode = 'full'
        State = $State
        CompletedAtUtc = $CompletedAtUtc
    }
}

function Complete-EasyFireMigrationBackupPlanRecord {
    param([Parameter(Mandatory = $true)]$Plan)
    $completed = $Plan | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $completed.State = 'completed'
    $completed.CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
    return $completed
}

function New-EasyFireMigrationRecoveryUnitFromPublishedBackup {
    param(
        [Parameter(Mandatory = $true)]$Published,
        [Parameter(Mandatory = $true)][string]$BackupOperationId,
        [Parameter(Mandatory = $true)][string]$InvocationRole
    )
    $sha = [string](Get-EasyFireMigrationProperty $Published 'Sha256' '')
    if (-not $sha) { $sha = [string](Get-EasyFireMigrationProperty $Published 'BackupSha256' '') }
    return [pscustomobject][ordered]@{
        SchemaVersion = 1
        BackupOperationId = $BackupOperationId
        InvocationRole = $InvocationRole
        BackupMode = 'full'
        BackupFile = [string](Get-EasyFireMigrationProperty $Published 'BackupFile' '')
        SidecarFile = [string](Get-EasyFireMigrationProperty $Published 'SidecarFile' '')
        BackupSha256 = $sha
        MetadataFile = [string](Get-EasyFireMigrationProperty $Published 'MetadataFile' '')
        MetadataSha256 = [string](Get-EasyFireMigrationProperty $Published 'MetadataSha256' '')
    }
}

function Start-EasyFireMigrationOperation {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet('Rehearsal', 'Cutover', 'Global')][string]$Lane
    )
    $result = Get-OrCreate-EasyFireMigrationOperation -JournalPath $script:JournalPath `
        -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) -Name $Name -Lane $Lane
    $script:JournalRead = $result
    $operation = $result.Operation
    if ([string]$operation.State -ceq 'Planned') {
        $result = Set-EasyFireMigrationOperationState -JournalPath $script:JournalPath `
            -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) `
            -OperationId ([string]$operation.OperationId) -ToState Authorized
        $script:JournalRead = $result
        $operation = $result.Operation
    }
    if ([string]$operation.State -ceq 'Authorized') {
        $result = Set-EasyFireMigrationOperationState -JournalPath $script:JournalPath `
            -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) `
            -OperationId ([string]$operation.OperationId) -ToState Started
        $script:JournalRead = $result
        $operation = $result.Operation
    }
    if ([string]$operation.State -notin @('Started', 'Completed')) {
        throw "Migration operation cannot execute from state: $Name|$([string]$operation.State)"
    }
    return $operation
}

function Complete-EasyFireMigrationOperation {
    param(
        [Parameter(Mandatory = $true)]$Operation,
        [Parameter(Mandatory = $true)][ValidateSet('Rehearsal', 'Cutover', 'Global')][string]$Lane,
        [Parameter(Mandatory = $true)]$Evidence
    )
    if ([string]$Operation.State -ceq 'Started') {
        $result = Set-EasyFireMigrationOperationState -JournalPath $script:JournalPath `
            -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) `
            -OperationId ([string]$Operation.OperationId) -ToState Completed
        $script:JournalRead = $result
        $Operation = $result.Operation
    }
    return Write-EasyFireMigrationReceipt -AuthorityRoot $AuthorityRoot -MigrationId $MigrationId `
        -AuthorityFingerprint $script:AuthorityFingerprint -Lane $Lane -Kind ([string]$Operation.Name) `
        -OperationId ([string]$Operation.OperationId) -Evidence $Evidence
}

function Add-EasyFireMigrationPreservedBackup {
    param([Parameter(Mandatory = $true)][string]$Path)
    $result = Add-EasyFireMigrationPreservedResource -JournalPath $script:JournalPath `
        -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) -Category Backups -Identity $Path
    $script:JournalRead = $result
}

function Add-EasyFireMigrationPreservedVolume {
    param([Parameter(Mandatory = $true)][string]$Name)
    $result = Add-EasyFireMigrationPreservedResource -JournalPath $script:JournalPath `
        -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) -Category Volumes -Identity $Name
    $script:JournalRead = $result
}

function Stop-EasyFireMigrationLaneAndVerify {
    param([Parameter(Mandatory = $true)]$Lane)
    $inventory = Stop-EasyFireMigrationLaneContainers -Lane $Lane
    $unsafe = @($inventory.Containers | Where-Object {
            [string]$_.State -cnotin @('created', 'exited', 'dead')
        })
    if ($unsafe.Count -ne 0) {
        throw 'Exact migration lane still contains a non-quiescent container after the stop boundary.'
    }
    return $inventory
}

function Get-EasyFireMigrationReceiptDocument {
    param([Parameter(Mandatory = $true)][string]$Kind)
    $matches = @($script:JournalRead.Journal.Receipts | Where-Object { [string]$_.Kind -ceq $Kind })
    if ($matches.Count -ne 1) { throw "Migration receipt authority is not unique: $Kind" }
    $binding = $matches[0]
    Assert-EasyFireMigrationFileHash -Path ([string]$binding.Path) `
        -ExpectedSha256 ([string]$binding.Sha256) -Name "$Kind receipt"
    return Read-EasyFireMigrationJson -Path ([string]$binding.Path) -Name "$Kind receipt"
}

function Invoke-EasyFireMigrationChildScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $bundle = Assert-EasyFireMigrationControllerBundleAuthority
    if (-not [IO.Path]::IsPathRooted($ScriptPath) -or
        $ScriptPath -cne [IO.Path]::GetFullPath($ScriptPath) -or
        -not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        throw 'Migration child script must be one existing canonical bundle file.'
    }
    $allowedChildren = @(
        'deploy/windows/migration-scheduled-backup.ps1',
        'scripts/production/backup.ps1',
        'scripts/production/restore-verify.ps1'
    )
    $binding = @($bundle.Files | Where-Object {
            [string]$_.Path -ceq $ScriptPath -and [string]$_.Name -cin $allowedChildren
        })
    if ($binding.Count -ne 1) {
        throw 'Migration child script is outside the exact target-release controller bundle.'
    }
    $powerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    return Invoke-EasyFireNative -FilePath $powerShell `
        -ArgumentList (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + @($Arguments))
}

function Get-EasyFireMigrationStructuredOutput {
    param($Result, [Parameter(Mandatory = $true)][string]$Prefix, [Parameter(Mandatory = $true)][string]$Name)
    $matches = @($Result.Output | ForEach-Object { [string]$_ } | Where-Object {
            $_.StartsWith($Prefix, [StringComparison]::Ordinal)
        })
    if ($matches.Count -ne 1) { throw "$Name did not emit one exact structured receipt." }
    try { return $matches[0].Substring($Prefix.Length) | ConvertFrom-Json }
    catch { throw "$Name structured receipt is invalid JSON." }
}

function Get-EasyFireMigrationSourceRedisId {
    param([Parameter(Mandatory = $true)]$Inventory)
    $matches = @($Inventory.Containers | Where-Object { [string]$_.Service -ceq 'redis' })
    if ($matches.Count -ne 1) { throw 'Source Redis identity is not unique.' }
    return [string]$matches[0].ContainerId
}

function Assert-EasyFireMigrationLiveSource {
    $live = Get-EasyFireMigrationSourceInventory -ProjectName $SourceProjectName `
        -MysqlVolumeName $SourceMysqlVolumeName -RedisVolumeName $SourceRedisVolumeName
    $expectedFingerprint = Get-EasyFireMigrationInventoryFingerprint -Inventory $script:JournalRead.Journal.SourceInventory
    $actualFingerprint = Get-EasyFireMigrationInventoryFingerprint -Inventory $live
    if ($actualFingerprint -cne $expectedFingerprint) { throw 'Exact source runtime inventory drifted from migration authority.' }
    return $live
}

function Get-EasyFireMigrationStoppedSourceProof {
    param([Parameter(Mandatory = $true)]$SourceInventory, [Parameter(Mandatory = $true)][string[]]$StoppedServices)
    $proof = @()
    foreach ($service in $StoppedServices) {
        $item = @($SourceInventory.Containers | Where-Object { [string]$_.Service -ceq $service })
        if ($item.Count -ne 1) { throw "Source service identity is not unique: $service" }
        $inspect = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('inspect', [string]$item[0].ContainerId)).Text | ConvertFrom-Json
        $exact = if ($inspect -is [array]) { $inspect[0] } else { $inspect }
        if ([string]$exact.State.Status -ne 'exited') { throw "Source freeze did not stop exact service: $service" }
        $proof += [pscustomobject]@{ Service=$service; ContainerId=[string]$item[0].ContainerId; State='exited' }
    }
    return $proof
}

function Assert-EasyFireMigrationAuthenticationReceipt {
    param([Parameter(Mandatory = $true)]$Receipt, [Parameter(Mandatory = $true)]$Lane)
    $expected = @(
        'SchemaVersion', 'MigrationId', 'Lane', 'ProjectName', 'LoopbackPort',
        'ObservedAtUtc', 'HttpStatus', 'NativeLoginSucceeded', 'TokenPresent',
        'UserPresent', 'TenantPresent', 'OrganizationPresent'
    ) | Sort-Object
    $actual = @($Receipt.PSObject.Properties.Name | Sort-Object)
    if (@(Compare-Object $expected $actual -CaseSensitive).Count -ne 0 -or
        [int]$Receipt.SchemaVersion -ne 1 -or [string]$Receipt.MigrationId -cne $MigrationId -or
        [string]$Receipt.Lane -cne 'Rehearsal' -or [string]$Receipt.ProjectName -cne [string]$Lane.ProjectName -or
        [int]$Receipt.LoopbackPort -ne [int]$Lane.LoopbackPort -or [int]$Receipt.HttpStatus -lt 200 -or
        [int]$Receipt.HttpStatus -ge 300) { throw 'Native authentication receipt identity is invalid.' }
    foreach ($field in @('NativeLoginSucceeded', 'TokenPresent', 'UserPresent', 'TenantPresent', 'OrganizationPresent')) {
        if ((Get-EasyFireMigrationProperty $Receipt $field $false) -isnot [bool] -or -not [bool]$Receipt.$field) {
            throw "Native authentication proof gate failed: $field"
        }
    }
    $observed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$Receipt.ObservedAtUtc, [ref]$observed) -or
        $observed.UtcDateTime -lt [DateTime]::UtcNow.AddHours(-1) -or
        $observed.UtcDateTime -gt [DateTime]::UtcNow.AddMinutes(5)) {
        throw 'Native authentication receipt is expired or future-dated.'
    }
}

function Get-EasyFireMigrationControllerBundleAuthority {
    $releaseRoot = [IO.Path]::GetFullPath($TargetReleaseDirectory)
    $expectedActionPath = [IO.Path]::GetFullPath((Join-Path $releaseRoot 'deploy\windows\migration-action.ps1'))
    $executingActionPath = [IO.Path]::GetFullPath($PSCommandPath)
    $expectedScriptRoot = [IO.Path]::GetDirectoryName($expectedActionPath)
    if ($executingActionPath -cne $expectedActionPath -or
        [IO.Path]::GetFullPath($PSScriptRoot) -cne $expectedScriptRoot) {
        throw 'Migration controller must execute from the exact TargetReleaseDirectory bundle.'
    }
    $definitions = @(
        [ordered]@{ Name='deploy/windows/migration-action.ps1'; RelativePath='deploy\windows\migration-action.ps1' },
        [ordered]@{ Name='deploy/windows/migration-state.psm1'; RelativePath='deploy\windows\migration-state.psm1' },
        [ordered]@{ Name='deploy/windows/migration-runtime.psm1'; RelativePath='deploy\windows\migration-runtime.psm1' },
        [ordered]@{ Name='deploy/windows/migration-windows.psm1'; RelativePath='deploy\windows\migration-windows.psm1' },
        [ordered]@{ Name='deploy/windows/migration-scheduled-backup.ps1'; RelativePath='deploy\windows\migration-scheduled-backup.ps1' },
        [ordered]@{ Name='deploy/windows/production-io.psm1'; RelativePath='deploy\windows\production-io.psm1' },
        [ordered]@{ Name='deploy/windows/production-state.psm1'; RelativePath='deploy\windows\production-state.psm1' },
        [ordered]@{ Name='scripts/production/backup.ps1'; RelativePath='scripts\production\backup.ps1' },
        [ordered]@{ Name='scripts/production/restore-verify.ps1'; RelativePath='scripts\production\restore-verify.ps1' },
        [ordered]@{ Name='scripts/production/backup-integrity.psm1'; RelativePath='scripts\production\backup-integrity.psm1' }
    )
    $files = @($definitions | ForEach-Object {
            $path = [IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$_.RelativePath)))
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                throw "Migration controller bundle file is missing: $([string]$_.Name)"
            }
            [ordered]@{ Name=[string]$_.Name; Path=$path; Sha256=(Get-EasyFireMigrationFileSha256 -Path $path) }
        })
    $document = [ordered]@{
        SchemaVersion=1; Root=$releaseRoot; ExecutingActionPath=$executingActionPath; Files=$files
    }
    $document['Fingerprint'] = Get-EasyFireMigrationRuntimeTextSha256Compat -Value $document
    return [pscustomobject]$document
}

function Assert-EasyFireMigrationControllerBundleAuthority {
    $expected = Get-EasyFireMigrationProperty `
        $script:JournalRead.Journal.Authority.Document 'ControllerBundleAuthority' $null
    if ($null -eq $expected) { throw 'Planned controller bundle authority is missing.' }
    $current = Get-EasyFireMigrationControllerBundleAuthority
    if (($expected | ConvertTo-Json -Depth 30 -Compress) -cne
        ($current | ConvertTo-Json -Depth 30 -Compress)) {
        throw 'The executing migration controller bundle drifted from the exact Plan.'
    }
    return $current
}

function Get-EasyFireMigrationRuntimeTextSha256Compat {
    param([Parameter(Mandatory = $true)]$Value)
    $json = $Value | ConvertTo-Json -Depth 30 -Compress
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($json)))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Get-EasyFireMigrationCompletedAuthority {
    param(
        [Parameter(Mandatory = $true)]$Lane,
        [Parameter(Mandatory = $true)]$CompletionReceipt,
        [Parameter(Mandatory = $true)]$BaselineRecoveryUnit
    )
    $inventory = Get-EasyFireMigrationLaneInventory -Lane $Lane
    $runtimeAuthority = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $Lane `
        -Inventory $inventory -ExpectedImages @($script:JournalRead.Journal.Authority.Document.Target.Images) `
        -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $mysql = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })
    $redis = @($inventory.Containers | Where-Object { [string]$_.Service -ceq 'redis' })
    $mysqlVolume = @($inventory.Volumes | Where-Object { [string]$_.Name -ceq [string]$Lane.MysqlVolumeName })
    $redisVolume = @($inventory.Volumes | Where-Object { [string]$_.Name -ceq [string]$Lane.RedisVolumeName })
    $mysqlMount = if ($mysql.Count -eq 1) { @($mysql[0].Mounts | Where-Object { [string]$_.Destination -ceq '/var/lib/mysql' }) } else { @() }
    $redisMount = if ($redis.Count -eq 1) { @($redis[0].Mounts | Where-Object { [string]$_.Destination -ceq '/data' }) } else { @() }
    if ($mysql.Count -ne 1 -or $redis.Count -ne 1 -or $mysqlVolume.Count -ne 1 -or $redisVolume.Count -ne 1 -or
        $mysqlMount.Count -ne 1 -or $redisMount.Count -ne 1) { throw 'Completed data-service authority is not unique.' }
    return [pscustomobject][ordered]@{
        SchemaVersion=1; Lane='Cutover'; ProjectName=[string]$Lane.ProjectName
        ReleaseId=$TargetReleaseId; ReleaseDirectory=$TargetReleaseDirectory
        ComposeFile=$TargetComposeFile; ComposeFileSha256=$TargetComposeSha256
        ComposeOverrideFile=[string]$Lane.ComposeOverrideFile
        ComposeOverrideSha256=(Get-EasyFireMigrationFileSha256 -Path ([string]$Lane.ComposeOverrideFile))
        EnvFile=[string]$Lane.EnvironmentFile
        EnvFileSha256=(Get-EasyFireMigrationFileSha256 -Path ([string]$Lane.EnvironmentFile))
        Inventory=$inventory
        InventoryFingerprint=Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $inventory
        CandidateRuntimeAuthority=$runtimeAuthority
        DurableVolumeFingerprint=Get-EasyFireMigrationLaneVolumeFingerprint -Volumes @($inventory.Volumes)
        Mysql=[pscustomobject][ordered]@{
            ContainerId=[string]$mysql[0].Id; ContainerName=[string]$mysql[0].Name
            ImageReference=[string]$mysql[0].ImageReference; ImageId=[string]$mysql[0].ImageId
            VolumeName=[string]$mysqlMount[0].Source; VolumeComposeKey=[string]$mysqlVolume[0].LogicalName
            VolumeDestination='/var/lib/mysql'
        }
        Redis=[pscustomobject][ordered]@{
            ContainerId=[string]$redis[0].Id; ContainerName=[string]$redis[0].Name
            ImageReference=[string]$redis[0].ImageReference; ImageId=[string]$redis[0].ImageId
            VolumeName=[string]$redisMount[0].Source; VolumeComposeKey=[string]$redisVolume[0].LogicalName
            VolumeDestination='/data'
        }
        ControllerBundleAuthority=Assert-EasyFireMigrationControllerBundleAuthority
        BaselineRecoveryUnit=$BaselineRecoveryUnit
        MigrationReceipt=$CompletionReceipt
        AuthorityOwnerSid=$AuthorityOwnerSid
        CompletedAtUtc=[DateTime]::UtcNow.ToString('o')
    }
}

function Invoke-EasyFireMigrationRehearsal {
    if ([string]$script:JournalRead.Journal.CurrentState -ceq 'Rehearsing' -and
        [string]$script:JournalRead.Journal.Phase -ceq 'AwaitingNativeAuthentication') {
        return [pscustomobject]@{ State='AwaitingNativeAuthentication'; Lane=$script:JournalRead.Journal.Lanes.Rehearsal; JournalPath=$script:JournalPath }
    }
    if ([string]$script:JournalRead.Journal.CurrentState -cne 'Planned') { throw 'Rehearse requires Planned migration authority.' }
    $null = Assert-EasyFireMigrationControllerBundleAuthority
    $lane = $script:JournalRead.Journal.Lanes.Rehearsal
    $source = Assert-EasyFireMigrationLiveSource
    $targetImages = @($script:JournalRead.Journal.Authority.Document.Target.Images)
    $null = Assert-EasyFireMigrationTargetImages -Images $targetImages -InspectDocker
    $freshLanePreflight = Assert-EasyFireMigrationFreshLanePreflight -Lane $lane
    foreach ($volumeName in @([string]$lane.MysqlVolumeName, [string]$lane.RedisVolumeName)) {
        Add-EasyFireMigrationPreservedVolume -Name $volumeName
    }

    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase InitialRestoreRunning
    $operation = Start-EasyFireMigrationOperation -Name InitialRestore -Lane Rehearsal
    $restoreScript = Join-Path $TargetReleaseDirectory 'scripts\production\restore-verify.ps1'
    $restore = Invoke-EasyFireMigrationChildScript -ScriptPath $restoreScript `
        -Arguments @('-BackupFile', [string]$script:JournalRead.Journal.Authority.Document.InitialBackup.File, '-EnvFile', $SourceEnvFile)
    $restoreReceipt = Get-EasyFireMigrationStructuredOutput -Result $restore `
        -Prefix 'RESTORE_VERIFICATION_PASSED ' -Name 'Initial restore verifier'
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal `
        -Evidence ([ordered]@{ RestoreVerification=$restoreReceipt; FreshLanePreflight=$freshLanePreflight })
    $initialBackupEntry = $script:JournalRead.Journal.BackupReceipts.InitialSource
    $initialRestoreRecord = [pscustomobject][ordered]@{
        Plan = $initialBackupEntry.Plan
        RecoveryUnit = $initialBackupEntry.RecoveryUnit
        RestoreReceipt = [pscustomobject][ordered]@{
            BackupOperationId = [string]$initialBackupEntry.Plan.BackupOperationId
            Passed = $true
            Verification = $restoreReceipt
        }
    }
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase InitialRestoreVerified `
        -Receipt $receipt -BackupReceiptRole InitialSource -BackupReceipt $initialRestoreRecord

    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalDataStarting
    $laneFiles = New-EasyFireMigrationLaneFiles -Lane $lane -TemplateEnvFile $TargetEnvFile -LaneDirectory ([string]$lane.Directory)
    if ([string]$laneFiles.EnvironmentFile -cne [string]$lane.EnvironmentFile -or
        [string]$laneFiles.ComposeOverrideFile -cne [string]$lane.ComposeOverrideFile) { throw 'Rehearsal lane files drifted from state authority.' }
    $mysql = Start-EasyFireMigrationMysql -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -ExpectedImages $targetImages -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalMysqlReady

    $operation = Start-EasyFireMigrationOperation -Name RehearsalImport -Lane Rehearsal
    $import = Import-EasyFireMigrationMysqlBackup -Lane $lane `
        -BackupFile ([string]$script:JournalRead.Journal.Authority.Document.InitialBackup.File) `
        -ExpectedBackupSha256 ([string]$script:JournalRead.Journal.Authority.Document.InitialBackup.Sha256) `
        -OperationId ([string]$operation.OperationId)
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal -Evidence $import
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalImported -Receipt $receipt

    $operation = Start-EasyFireMigrationOperation -Name RehearsalRedisSnapshot -Lane Rehearsal
    $snapshotPath = Join-Path ([string]$lane.Directory) "redis-source-$([string]$operation.OperationId).rdb"
    Add-EasyFireMigrationPreservedBackup -Path $snapshotPath
    $redis = Copy-EasyFireMigrationRedisSnapshot -SourceRedisContainerId (Get-EasyFireMigrationSourceRedisId $source) `
        -Lane $lane -ComposeFile $TargetComposeFile -OverrideFile ([string]$lane.ComposeOverrideFile) `
        -EnvFile ([string]$lane.EnvironmentFile) -SnapshotPath $snapshotPath -ExpectedImages $targetImages `
        -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal -Evidence $redis
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalRedisReady -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalMigrationPrepared
    $operation = Start-EasyFireMigrationOperation -Name RehearsalMigration -Lane Rehearsal
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalMigrationRunning
    $migration = Start-EasyFireMigrationDatabaseMigrationOnce -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -ExpectedImages $targetImages -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal `
        -Evidence ([ordered]@{ ContainerId=[string]$migration.Id; ExitCode=0; StartedAtMostOnce=$true })
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalMigrationComplete -Receipt $receipt

    $operation = Start-EasyFireMigrationOperation -Name RehearsalHealth -Lane Rehearsal
    Start-EasyFireMigrationApplicationTier -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -ExpectedImages $targetImages -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $health = Test-EasyFireMigrationCandidateHealth -Lane $lane
    $runtimeAuthority = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $lane `
        -Inventory (Get-EasyFireMigrationLaneInventory -Lane $lane) -ExpectedImages $targetImages `
        -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal `
        -Evidence ([ordered]@{ Health=$health; RuntimeAuthority=$runtimeAuthority })
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalAppReady -Receipt $receipt
    $null = Assert-EasyFireMigrationLiveSource
    $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase AwaitingNativeAuthentication
    return [pscustomobject]@{
        State='AwaitingNativeAuthentication'; JournalPath=$script:JournalPath
        Lane=$lane; CandidateUrl=("http://127.0.0.1:{0}/auth/login" -f [int]$lane.LoopbackPort)
        RequiresHumanAuthentication=$true; PreserveOriginals=$true
    }
}

function Invoke-EasyFireMigrationAcceptAuthentication {
    if ([string]$script:JournalRead.Journal.CurrentState -ceq 'RehearsalVerified' -and
        [string]$script:JournalRead.Journal.Phase -ceq 'RehearsalRollbackVerified') {
        return [pscustomobject]@{ State='RehearsalVerified'; Phase='RehearsalRollbackVerified'; JournalPath=$script:JournalPath; Reused=$true; PreserveOriginals=$true }
    }
    $null = Assert-EasyFireMigrationControllerBundleAuthority
    $lane = $script:JournalRead.Journal.Lanes.Rehearsal
    if ([string]$script:JournalRead.Journal.CurrentState -ceq 'Rehearsing' -and
        [string]$script:JournalRead.Journal.Phase -ceq 'AwaitingNativeAuthentication') {
        if (-not $NativeAuthenticationReceiptFile -or -not $NativeAuthenticationReceiptSha256) {
            throw 'AcceptAuthentication requires one exact hash-bound native receipt.'
        }
        $receiptFile = Get-EasyFireMigrationPath -Path $NativeAuthenticationReceiptFile `
            -Name 'NativeAuthenticationReceiptFile' -Kind Leaf -AllowedRoot $AuthorityRoot
        Assert-EasyFireMigrationFileHash -Path $receiptFile `
            -ExpectedSha256 $NativeAuthenticationReceiptSha256 -Name 'NativeAuthenticationReceiptSha256'
        $external = Read-EasyFireMigrationJson -Path $receiptFile -Name 'Native authentication receipt'
        Assert-EasyFireMigrationAuthenticationReceipt -Receipt $external -Lane $lane
        $null = Test-EasyFireMigrationCandidateHealth -Lane $lane
        $operation = Start-EasyFireMigrationOperation -Name NativeAuthentication -Lane Rehearsal
        $evidence = [ordered]@{
            ExternalReceiptPath=$receiptFile; ExternalReceiptSha256=$NativeAuthenticationReceiptSha256
            HttpStatus=[int]$external.HttpStatus; NativeLoginSucceeded=$true
            TokenPresent=$true; UserPresent=$true; TenantPresent=$true; OrganizationPresent=$true
        }
        $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal -Evidence $evidence
        $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalAuthenticated -Receipt $receipt
    }
    if ([string]$script:JournalRead.Journal.CurrentState -cne 'Rehearsing' -or
        [string]$script:JournalRead.Journal.Phase -notin @('RehearsalAuthenticated', 'RehearsalRollbackPrepared')) {
        throw 'AcceptAuthentication cannot continue from the current rehearsal authority.'
    }

    if ([string]$script:JournalRead.Journal.Phase -ceq 'RehearsalAuthenticated') {
        $preState = Get-EasyFireMigrationIngressPreState
        $sourceBefore = Assert-EasyFireMigrationLiveSource
        $null = Assert-EasyFireMigrationCheckpointTask -Kind Backup `
            -CheckpointXmlPath $BackupTaskXmlPath -CheckpointXmlSha256 $BackupTaskXmlSha256
        $null = Assert-EasyFireMigrationCheckpointTask -Kind Startup `
            -CheckpointXmlPath $StartupTaskXmlPath -CheckpointXmlSha256 $StartupTaskXmlSha256
        $operation = Start-EasyFireMigrationOperation -Name RehearsalRollbackPlan -Lane Rehearsal
        $planEvidence = [ordered]@{
            IngressPreState=$preState
            SourceInventoryFingerprint=Get-EasyFireMigrationInventoryFingerprint -Inventory $sourceBefore
            BackupTaskCheckpointSha256=$BackupTaskXmlSha256
            StartupTaskCheckpointSha256=$StartupTaskXmlSha256
            SourceRecoveryDrillRequired=$true
        }
        $planReceipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal -Evidence $planEvidence
        $null = Move-EasyFireMigrationPhase -State Rehearsing -Phase RehearsalRollbackPrepared -Receipt $planReceipt
    }

    $planDocument = Get-EasyFireMigrationReceiptDocument -Kind RehearsalRollbackPlan
    $preState = $planDocument.Evidence.IngressPreState
    $operation = Start-EasyFireMigrationOperation -Name RehearsalRollback -Lane Rehearsal
    $sourceBefore = $script:JournalRead.Journal.SourceInventory
    try {
        $null = Stop-EasyFireMigrationIngress
        Stop-EasyFireMigrationSourceServices -SourceInventory $sourceBefore -Tier Application
        Stop-EasyFireMigrationSourceServices -SourceInventory $sourceBefore -Tier Data
        Start-EasyFireMigrationSourceServices -SourceInventory $sourceBefore -Tier Data
        Start-EasyFireMigrationSourceServices -SourceInventory $sourceBefore -Tier Application
        $null = Restore-EasyFireMigrationCheckpointTask -Kind Backup `
            -CheckpointXmlPath $BackupTaskXmlPath -CheckpointXmlSha256 $BackupTaskXmlSha256
        $null = Restore-EasyFireMigrationCheckpointTask -Kind Startup `
            -CheckpointXmlPath $StartupTaskXmlPath -CheckpointXmlSha256 $StartupTaskXmlSha256
        $null = Restore-EasyFireMigrationIngressPreState -PreState $preState
        $sourceAfter = Assert-EasyFireMigrationLiveSource
        $stopped = Stop-EasyFireMigrationLaneAndVerify -Lane $lane
    } catch {
        $original = $_
        $recoveryFailures = @()
        try { Start-EasyFireMigrationSourceServices -SourceInventory $sourceBefore -Tier Data } catch { $recoveryFailures += $_.Exception.Message }
        try { Start-EasyFireMigrationSourceServices -SourceInventory $sourceBefore -Tier Application } catch { $recoveryFailures += $_.Exception.Message }
        try { $null = Restore-EasyFireMigrationCheckpointTask -Kind Backup -CheckpointXmlPath $BackupTaskXmlPath -CheckpointXmlSha256 $BackupTaskXmlSha256 } catch { $recoveryFailures += $_.Exception.Message }
        try { $null = Restore-EasyFireMigrationCheckpointTask -Kind Startup -CheckpointXmlPath $StartupTaskXmlPath -CheckpointXmlSha256 $StartupTaskXmlSha256 } catch { $recoveryFailures += $_.Exception.Message }
        try { $null = Restore-EasyFireMigrationIngressPreState -PreState $preState } catch { $recoveryFailures += $_.Exception.Message }
        if ($recoveryFailures.Count -ne 0) {
            throw "Rehearsal rollback drill failed and source recovery was incomplete: $($recoveryFailures -join ' | ')"
        }
        throw $original
    }
    $evidence = [ordered]@{
        CandidateStopped=$true; CandidateVolumesPreserved=$true; SourceRecovered=$true
        SourceInventoryFingerprint=Get-EasyFireMigrationInventoryFingerprint -Inventory $sourceAfter
        SourceRecoveryDrill=[ordered]@{ IngressRestored=$true; DataTierRestarted=$true; ApplicationTierRestarted=$true; TasksRestored=$true }
        StoppedLaneInventoryFingerprint=Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $stopped
    }
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal -Evidence $evidence
    $null = Move-EasyFireMigrationPhase -State RehearsalVerified -Phase RehearsalRollbackVerified -Receipt $receipt
    return [pscustomobject]@{ State='RehearsalVerified'; Phase='RehearsalRollbackVerified'; JournalPath=$script:JournalPath; SourceRecoveryDrillPassed=$true; PreserveOriginals=$true }
}

function Invoke-EasyFireMigrationAbortRehearsal {
    param([Parameter(Mandatory = $true)]$Failure)
    $null = Refresh-EasyFireMigrationJournal
    if ([string]$script:JournalRead.Journal.CurrentState -cne 'Rehearsing') {
        throw 'Rehearsal abort is available only from a persisted Rehearsing state.'
    }
    $lane = $script:JournalRead.Journal.Lanes.Rehearsal
    $stopped = Stop-EasyFireMigrationLaneAndVerify -Lane $lane
    $source = Assert-EasyFireMigrationLiveSource
    $operation = Start-EasyFireMigrationOperation -Name RehearsalAbort -Lane Rehearsal
    $evidence = [ordered]@{
        FailureType=[string]$Failure.Exception.GetType().FullName
        CandidateStopped=$true; CandidateVolumesPreserved=$true; SourceUnchanged=$true
        SourceInventoryFingerprint=Get-EasyFireMigrationInventoryFingerprint -Inventory $source
        StoppedLaneInventoryFingerprint=Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $stopped
    }
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Rehearsal -Evidence $evidence
    $null = Move-EasyFireMigrationPhase -State RehearsalAborted -Phase RehearsalAborted -Receipt $receipt
    return [pscustomobject]@{ State='RehearsalAborted'; RetryRequiresNewMigrationId=$true; CandidateVolumesPreserved=$true; JournalPath=$script:JournalPath }
}

function Invoke-EasyFireMigrationAutomaticRollback {
    param([Parameter(Mandatory = $true)]$Failure)
    $null = Refresh-EasyFireMigrationJournal
    $null = Assert-EasyFireMigrationControllerBundleAuthority
    $startingState = [string]$script:JournalRead.Journal.CurrentState
    $startingPhase = [string]$script:JournalRead.Journal.Phase
    $emergencyRecoveryUnit = $null
    if ($startingState -ceq 'Completed') {
        if ($startingPhase -ceq 'Completed') {
            $null = Move-EasyFireMigrationPhase -State Completed -Phase EmergencyBackupRunning
        } elseif ($startingPhase -notin @('EmergencyBackupRunning', 'EmergencyBackupReady', 'EmergencyRestoreVerified')) {
            throw "Completed rollback cannot continue from phase: $startingPhase"
        }
        if ([string]$script:JournalRead.Journal.Phase -cne 'EmergencyRestoreVerified') {
            $scheduledController = Join-Path $TargetReleaseDirectory 'deploy\windows\migration-scheduled-backup.ps1'
            $emergencyResult = Invoke-EasyFireMigrationChildScript -ScriptPath $scheduledController -Arguments @(
                '-MigrationId', $MigrationId, '-AuthorityRoot', $AuthorityRoot,
                '-InvocationRole', 'MigrationEmergency', '-AuthorityOwnerSid', $AuthorityOwnerSid
            )
            $null = Get-EasyFireMigrationStructuredOutput -Result $emergencyResult `
                -Prefix 'MIGRATION_BACKUP_PASSED ' -Name 'Migration emergency backup'
            $null = Refresh-EasyFireMigrationJournal
        }
        if ([string]$script:JournalRead.Journal.CurrentState -cne 'Completed' -or
            [string]$script:JournalRead.Journal.Phase -cne 'EmergencyRestoreVerified') {
            throw 'Completed rollback requires an isolated-restore-verified emergency recovery unit.'
        }
        $emergencyEntry = $script:JournalRead.Journal.BackupReceipts.MigrationEmergency
        $emergencyRecoveryUnit = Get-EasyFireMigrationProperty $emergencyEntry 'RecoveryUnit' $null
        if ($null -eq $emergencyRecoveryUnit) { throw 'Migration emergency recovery unit is missing.' }
        $null = Move-EasyFireMigrationPhase -State RollingBack -Phase RollbackInProgress
    } elseif ($startingState -ceq 'CuttingOver') {
        $null = Move-EasyFireMigrationPhase -State RollingBack -Phase RollbackInProgress
    }
    if ([string]$script:JournalRead.Journal.CurrentState -cne 'RollingBack') {
        throw "Automatic rollback is unavailable from state: $([string]$script:JournalRead.Journal.CurrentState)"
    }
    $rollbackTransition = @($script:JournalRead.Journal.Transitions | Where-Object {
            [string]$_.ToState -ceq 'RollingBack' -and [string]$_.ToPhase -ceq 'RollbackInProgress'
        }) | Select-Object -Last 1
    if ($null -eq $rollbackTransition) { throw 'Rollback origin transition authority is missing.' }
    $originState = [string]$rollbackTransition.FromState
    $originPhase = [string]$rollbackTransition.FromPhase
    $lane = $script:JournalRead.Journal.Lanes.Cutover
    $stopped = Stop-EasyFireMigrationLaneAndVerify -Lane $lane
    $null = Restore-EasyFireMigrationCheckpointTask -Kind Backup -CheckpointXmlPath $BackupTaskXmlPath `
        -CheckpointXmlSha256 $BackupTaskXmlSha256
    $null = Restore-EasyFireMigrationCheckpointTask -Kind Startup -CheckpointXmlPath $StartupTaskXmlPath `
        -CheckpointXmlSha256 $StartupTaskXmlSha256
    $source = $script:JournalRead.Journal.SourceInventory
    Start-EasyFireMigrationSourceServices -SourceInventory $source -Tier Data
    Start-EasyFireMigrationSourceServices -SourceInventory $source -Tier Application
    $ingressPlanBindings = @($script:JournalRead.Journal.Receipts | Where-Object { [string]$_.Kind -ceq 'IngressPausePlan' })
    if ($ingressPlanBindings.Count -gt 1) { throw 'Ingress pause pre-state authority is not unique.' }
    if ($ingressPlanBindings.Count -eq 1) {
        $document = Get-EasyFireMigrationReceiptDocument -Kind IngressPausePlan
        $null = Restore-EasyFireMigrationIngressPreState -PreState $document.Evidence.PreState
        $ingressDisposition = 'RestoredFromHashBoundPreState'
    } elseif ($originState -ceq 'CuttingOver' -and $originPhase -ceq 'IngressPausePending') {
        $ingressDisposition = 'UnchangedBeforeMutation'
    } else {
        throw 'Rollback cannot infer ingress pre-state after the mutation boundary.'
    }
    $live = Assert-EasyFireMigrationLiveSource
    $operation = Start-EasyFireMigrationOperation -Name Rollback -Lane Global
    $evidence = [ordered]@{
        FailureType=[string]$Failure.Exception.GetType().FullName
        CutoverContainersStopped=$true; CutoverVolumesPreserved=$true
        StoppedLaneInventoryFingerprint=Get-EasyFireMigrationLaneInventoryFingerprint -Inventory $stopped
        TasksRestored=$true; SourceRecovered=$true; IngressDisposition=$ingressDisposition
        EmergencyRecoveryUnit=$emergencyRecoveryUnit
        SourceInventoryFingerprint=Get-EasyFireMigrationInventoryFingerprint -Inventory $live
    }
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global -Evidence $evidence
    $null = Move-EasyFireMigrationPhase -State RolledBack -Phase RolledBack -Receipt $receipt
    return [pscustomobject]@{ State='RolledBack'; RollbackVerified=$true; OriginalFailure=[string]$Failure.Exception.Message; JournalPath=$script:JournalPath }
}

function Invoke-EasyFireMigrationCutover {
    if ([string]$script:JournalRead.Journal.CurrentState -ceq 'Completed' -and
        [string]$script:JournalRead.Journal.Phase -ceq 'Completed') {
        return [pscustomobject]@{ State='Completed'; Phase='Completed'; JournalPath=$script:JournalPath; Reused=$true; PreserveOriginals=$true }
    }
    if ([string]$script:JournalRead.Journal.CurrentState -cne 'RehearsalVerified' -or
        [string]$script:JournalRead.Journal.Phase -cne 'RehearsalRollbackVerified') {
        throw 'Cutover requires RehearsalVerified|RehearsalRollbackVerified authority.'
    }
    $null = Assert-EasyFireMigrationControllerBundleAuthority
    $source = Assert-EasyFireMigrationLiveSource
    $lane = $script:JournalRead.Journal.Lanes.Cutover
    $targetImages = @($script:JournalRead.Journal.Authority.Document.Target.Images)
    $null = Assert-EasyFireMigrationTargetImages -Images $targetImages -InspectDocker
    $freshLanePreflight = Assert-EasyFireMigrationFreshLanePreflight -Lane $lane
    foreach ($volumeName in @([string]$lane.MysqlVolumeName, [string]$lane.RedisVolumeName)) {
        Add-EasyFireMigrationPreservedVolume -Name $volumeName
    }
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase IngressPausePending
    $script:CutoverMutationStarted = $true

    $operation = Start-EasyFireMigrationOperation -Name IngressPausePlan -Lane Global
    $preState = Get-EasyFireMigrationIngressPreState
    $null = Assert-EasyFireMigrationCheckpointTask -Kind Backup -CheckpointXmlPath $BackupTaskXmlPath -CheckpointXmlSha256 $BackupTaskXmlSha256
    $null = Assert-EasyFireMigrationCheckpointTask -Kind Startup -CheckpointXmlPath $StartupTaskXmlPath -CheckpointXmlSha256 $StartupTaskXmlSha256
    $planReceipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global `
        -Evidence ([ordered]@{
            PreState=$preState; BackupTaskCheckpointSha256=$BackupTaskXmlSha256
            StartupTaskCheckpointSha256=$StartupTaskXmlSha256
            SourceInventoryFingerprint=Get-EasyFireMigrationInventoryFingerprint -Inventory $source
            FreshLanePreflight=$freshLanePreflight
        })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase IngressPausePrepared -Receipt $planReceipt

    $operation = Start-EasyFireMigrationOperation -Name IngressPause -Lane Global
    $null = Stop-EasyFireMigrationIngress
    $fence = Disable-EasyFireMigrationBackupTaskFence -CheckpointXmlPath $BackupTaskXmlPath -CheckpointXmlSha256 $BackupTaskXmlSha256
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global `
        -Evidence ([ordered]@{ PreStateReceiptSha256=[string]$planReceipt.Sha256; BackupTaskFence=$fence; IngressStopped=$true })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase IngressPaused -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase SourceFreezePending
    $operation = Start-EasyFireMigrationOperation -Name SourceFreeze -Lane Global
    Stop-EasyFireMigrationSourceServices -SourceInventory $source -Tier Application
    $freezeProof = Get-EasyFireMigrationStoppedSourceProof -SourceInventory $source `
        -StoppedServices @('server', 'webapp', 'gotenberg', 'envoy')
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global `
        -Evidence ([ordered]@{ ApplicationTier=$freezeProof; MysqlStillRunning=$true; RedisStillRunning=$true })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase SourceFrozen -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase FinalBackupRunning
    $operation = Start-EasyFireMigrationOperation -Name FinalBackup -Lane Global
    $finalBackupPlan = New-EasyFireMigrationBackupPlanRecord `
        -BackupOperationId ([string]$operation.OperationId) -InvocationRole MigrationSource
    $script:JournalRead = Save-EasyFireMigrationBackupPlan -JournalPath $script:JournalPath `
        -ExpectedJournalSha256 ([string]$script:JournalRead.Sha256) `
        -BackupReceiptRole FinalSource -Plan $finalBackupPlan
    $backupScript = Join-Path $TargetReleaseDirectory 'scripts\production\backup.ps1'
    $backupResult = Invoke-EasyFireMigrationChildScript -ScriptPath $backupScript -Arguments @(
        '-ComposeFile', $SourceComposeFile, '-EnvFile', $SourceEnvFile,
        '-ProjectName', $SourceProjectName, '-BackupDir', (Join-Path $ProductionRoot 'backups'),
        '-AuthorityRoot', $AuthorityRoot, '-BackupOperationId', [string]$operation.OperationId,
        '-InvocationRole', 'MigrationSource', '-MigrationId', $MigrationId,
        '-ExpectedMysqlContainerId', $SourceMysqlContainerId,
        '-ExpectedMysqlImageReference', $SourceMysqlImageReference,
        '-ExpectedMysqlImageId', $SourceMysqlImageId,
        '-ExpectedMysqlVolumeName', $SourceMysqlVolumeName,
        '-ExpectedMysqlVolumeDestination', '/var/lib/mysql'
    )
    $finalBackup = Get-EasyFireMigrationStructuredOutput -Result $backupResult `
        -Prefix 'BACKUP_PUBLISHED ' -Name 'Final source backup'
    foreach ($artifact in @($finalBackup.BackupFile, $finalBackup.SidecarFile, $finalBackup.MetadataFile)) {
        if ([string]$artifact) { Add-EasyFireMigrationPreservedBackup -Path ([string]$artifact) }
    }
    $finalRecoveryUnit = New-EasyFireMigrationRecoveryUnitFromPublishedBackup `
        -Published $finalBackup -BackupOperationId ([string]$operation.OperationId) `
        -InvocationRole MigrationSource
    $finalBackupRecord = [pscustomobject][ordered]@{
        Plan = Complete-EasyFireMigrationBackupPlanRecord -Plan $finalBackupPlan
        RecoveryUnit = $finalRecoveryUnit
        RestoreReceipt = $null
    }
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global -Evidence $finalBackup
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase FinalBackupReady `
        -Receipt $receipt -BackupReceiptRole FinalSource -BackupReceipt $finalBackupRecord

    $operation = Start-EasyFireMigrationOperation -Name FinalRestore -Lane Global
    $restoreScript = Join-Path $TargetReleaseDirectory 'scripts\production\restore-verify.ps1'
    $restoreResult = Invoke-EasyFireMigrationChildScript -ScriptPath $restoreScript `
        -Arguments @('-BackupFile', [string]$finalBackup.BackupFile, '-EnvFile', $SourceEnvFile)
    $finalRestore = Get-EasyFireMigrationStructuredOutput -Result $restoreResult `
        -Prefix 'RESTORE_VERIFICATION_PASSED ' -Name 'Final source restore verifier'
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global -Evidence $finalRestore
    $finalRestoreRecord = [pscustomobject][ordered]@{
        Plan = $finalBackupRecord.Plan
        RecoveryUnit = $finalRecoveryUnit
        RestoreReceipt = [pscustomobject][ordered]@{
            BackupOperationId = [string]$finalBackupPlan.BackupOperationId
            Passed = $true
            Verification = $finalRestore
        }
    }
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase FinalRestoreVerified `
        -Receipt $receipt -BackupReceiptRole FinalSource -BackupReceipt $finalRestoreRecord

    $operation = Start-EasyFireMigrationOperation -Name SourceDataFreeze -Lane Global
    $redisSnapshotPath = Join-Path ([string]$lane.Directory) "redis-final-$([string]$operation.OperationId).rdb"
    Add-EasyFireMigrationPreservedBackup -Path $redisSnapshotPath
    $redisExport = Export-EasyFireMigrationRedisSnapshot `
        -SourceRedisContainerId (Get-EasyFireMigrationSourceRedisId $source) -SnapshotPath $redisSnapshotPath
    Stop-EasyFireMigrationSourceServices -SourceInventory $source -Tier Data
    $dataFreezeProof = Get-EasyFireMigrationStoppedSourceProof -SourceInventory $source -StoppedServices @('mysql', 'redis')
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global `
        -Evidence ([ordered]@{ DataTier=$dataFreezeProof; RedisSnapshot=$redisExport; SourceVolumesPreserved=$true })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase SourceDataFrozen -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverDataStarting
    $laneFiles = New-EasyFireMigrationLaneFiles -Lane $lane -TemplateEnvFile $TargetEnvFile -LaneDirectory ([string]$lane.Directory)
    $null = Start-EasyFireMigrationMysql -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -ExpectedImages $targetImages -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverMysqlReady

    $operation = Start-EasyFireMigrationOperation -Name CutoverImport -Lane Cutover
    $import = Import-EasyFireMigrationMysqlBackup -Lane $lane -BackupFile ([string]$finalBackup.BackupFile) `
        -ExpectedBackupSha256 ([string]$finalBackup.Sha256) -OperationId ([string]$operation.OperationId)
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Cutover -Evidence $import
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverImported -Receipt $receipt

    $operation = Start-EasyFireMigrationOperation -Name CutoverRedisSnapshot -Lane Cutover
    $redis = Import-EasyFireMigrationRedisSnapshot -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -SnapshotPath $redisSnapshotPath -ExpectedSnapshotSha256 ([string]$redisExport.SnapshotSha256) `
        -SourceObservedKeyCount ([int64]$redisExport.SourceObservedKeyCount) -ExpectedImages $targetImages `
        -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Cutover -Evidence $redis
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverRedisReady -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverMigrationPrepared
    $operation = Start-EasyFireMigrationOperation -Name CutoverMigration -Lane Cutover
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverMigrationRunning
    $migration = Start-EasyFireMigrationDatabaseMigrationOnce -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -ExpectedImages $targetImages -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Cutover `
        -Evidence ([ordered]@{ ContainerId=[string]$migration.Id; ExitCode=0; StartedAtMostOnce=$true })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverMigrationComplete -Receipt $receipt

    $operation = Start-EasyFireMigrationOperation -Name CutoverHealth -Lane Cutover
    Start-EasyFireMigrationApplicationTier -Lane $lane -ComposeFile $TargetComposeFile `
        -OverrideFile ([string]$lane.ComposeOverrideFile) -EnvFile ([string]$lane.EnvironmentFile) `
        -ExpectedImages $targetImages -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $health = Test-EasyFireMigrationCandidateHealth -Lane $lane
    $runtimeAuthority = Assert-EasyFireMigrationCandidateRuntimeAuthority -Lane $lane `
        -Inventory (Get-EasyFireMigrationLaneInventory -Lane $lane) -ExpectedImages $targetImages `
        -ExpectedComposeWorkingDirectory $TargetReleaseDirectory
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Cutover `
        -Evidence ([ordered]@{ Health=$health; RuntimeAuthority=$runtimeAuthority })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverAppReady -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase CutoverBaselineBackupRunning
    $scheduledController = Join-Path $TargetReleaseDirectory 'deploy\windows\migration-scheduled-backup.ps1'
    $baselineResult = Invoke-EasyFireMigrationChildScript -ScriptPath $scheduledController -Arguments @(
        '-MigrationId', $MigrationId, '-AuthorityRoot', $AuthorityRoot,
        '-InvocationRole', 'MigrationBaseline', '-AuthorityOwnerSid', $AuthorityOwnerSid
    )
    $null = Refresh-EasyFireMigrationJournal
    if ([string]$script:JournalRead.Journal.CurrentState -cne 'CuttingOver' -or
        [string]$script:JournalRead.Journal.Phase -cne 'CutoverBaselineRestoreVerified') {
        throw 'MigrationBaseline did not finish backup and isolated restore proof.'
    }
    $baselineEntry = $script:JournalRead.Journal.BackupReceipts.MigrationBaseline
    $baselineRecoveryUnit = Get-EasyFireMigrationProperty $baselineEntry 'RecoveryUnit' $null
    if ($null -eq $baselineRecoveryUnit) { throw 'MigrationBaseline recovery unit is missing.' }

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase TasksMutationPending
    $operation = Start-EasyFireMigrationOperation -Name TasksMigrated -Lane Global
    $null = Assert-EasyFireMigrationControllerBundleAuthority
    $taskScript = Join-Path $TargetReleaseDirectory 'deploy\windows\migration-scheduled-backup.ps1'
    $definition = Get-EasyFireMigrationBackupTaskDefinition -ScriptPath $taskScript `
        -MigrationId $MigrationId -AuthorityRoot $AuthorityRoot -AuthorityOwnerSid $AuthorityOwnerSid
    $null = Assert-EasyFireMigrationControllerBundleAuthority
    $backupTask = Register-EasyFireMigrationBackupTask -Definition $definition
    $startupTask = Unregister-EasyFireMigrationStartupTask -CheckpointXmlPath $StartupTaskXmlPath `
        -CheckpointXmlSha256 $StartupTaskXmlSha256
    $receipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global `
        -Evidence ([ordered]@{ BackupTask=$backupTask; StartupTask=$startupTask; Exact=$true })
    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase TasksMigrated -Receipt $receipt

    $null = Move-EasyFireMigrationPhase -State CuttingOver -Phase EdgeStarting
    $null = Start-EasyFireMigrationIngress
    $edge = Get-EasyFireMigrationVerifiedIngress -CredentialFile $CloudflareCredentialFile
    $operation = Start-EasyFireMigrationOperation -Name Completion -Lane Global
    $completionEvidence = [ordered]@{
        PublishCompletedLast=$true; CandidateHealth=$health; BaselineRecoveryUnit=$baselineRecoveryUnit
        TasksExact=$true; Edge=$edge; SourceVolumesPreserved=$true; RedisContinuityVerified=$true
    }
    $completionReceipt = Complete-EasyFireMigrationOperation -Operation $operation -Lane Global -Evidence $completionEvidence
    $completedAuthority = Get-EasyFireMigrationCompletedAuthority -Lane $lane `
        -CompletionReceipt $completionReceipt -BaselineRecoveryUnit $baselineRecoveryUnit
    $null = Move-EasyFireMigrationPhase -State Completed -Phase Completed `
        -Receipt $completionReceipt -CompletedAuthority $completedAuthority
    return [pscustomobject]@{
        State='Completed'; Phase='Completed'; JournalPath=$script:JournalPath
        PublicUrl='https://bookkeeping.easyfire.fyi/'; BackupRestoreVerified=$true
        RedisContinuityVerified=$true; RollbackAuthorityPreserved=$true
    }
}

$mutex = $null
$mutexAcquired = $false
try {
    $MigrationId = ConvertTo-EasyFireMigrationCanonicalGuid -Value $MigrationId -Name 'MigrationId'
    $ProductionRoot = Get-EasyFireMigrationPath -Path $ProductionRoot -Name 'ProductionRoot' -Kind Container
    $AuthorityRoot = Get-EasyFireMigrationPath -Path $AuthorityRoot -Name 'AuthorityRoot' -Kind Container -AllowedRoot $ProductionRoot
    $SourceReleaseDirectory = Get-EasyFireMigrationPath -Path $SourceReleaseDirectory -Name 'SourceReleaseDirectory' -Kind Container -AllowedRoot $ProductionRoot
    $TargetReleaseDirectory = Get-EasyFireMigrationPath -Path $TargetReleaseDirectory -Name 'TargetReleaseDirectory' -Kind Container -AllowedRoot $AuthorityRoot
    $SourceComposeFile = Get-EasyFireMigrationPath -Path $SourceComposeFile -Name 'SourceComposeFile' -Kind Leaf -AllowedRoot $SourceReleaseDirectory
    $SourceEnvFile = Get-EasyFireMigrationPath -Path $SourceEnvFile -Name 'SourceEnvFile' -Kind Leaf -AllowedRoot $SourceReleaseDirectory
    $TargetComposeFile = Get-EasyFireMigrationPath -Path $TargetComposeFile -Name 'TargetComposeFile' -Kind Leaf -AllowedRoot $TargetReleaseDirectory
    $TargetEnvFile = Get-EasyFireMigrationPath -Path $TargetEnvFile -Name 'TargetEnvFile' -Kind Leaf -AllowedRoot $TargetReleaseDirectory
    $BackupTaskXmlPath = Get-EasyFireMigrationPath -Path $BackupTaskXmlPath -Name 'BackupTaskXmlPath' -Kind Leaf -AllowedRoot $AuthorityRoot
    $StartupTaskXmlPath = Get-EasyFireMigrationPath -Path $StartupTaskXmlPath -Name 'StartupTaskXmlPath' -Kind Leaf -AllowedRoot $AuthorityRoot
    $BackupMetadataFile = Get-EasyFireMigrationPath -Path $BackupMetadataFile -Name 'BackupMetadataFile' -Kind Leaf -AllowedRoot $AuthorityRoot
    $BackupSidecarFile = Get-EasyFireMigrationPath -Path $BackupSidecarFile -Name 'BackupSidecarFile' -Kind Leaf -AllowedRoot $AuthorityRoot
    $SourceInventoryFile = Get-EasyFireMigrationPath -Path $SourceInventoryFile -Name 'SourceInventoryFile' -Kind Leaf -AllowedRoot $AuthorityRoot
    $CloudflareCredentialFile = Get-EasyFireMigrationPath -Path $CloudflareCredentialFile -Name 'CloudflareCredentialFile' -Kind Leaf -AllowedRoot $ProductionRoot
    foreach ($binding in @(
            @($SourceComposeFile, $SourceComposeSha256, 'SourceComposeSha256'),
            @($SourceEnvFile, $SourceEnvSha256, 'SourceEnvSha256'),
            @($TargetComposeFile, $TargetComposeSha256, 'TargetComposeSha256'),
            @($TargetEnvFile, $TargetEnvSha256, 'TargetEnvSha256'),
            @($BackupTaskXmlPath, $BackupTaskXmlSha256, 'BackupTaskXmlSha256'),
            @($StartupTaskXmlPath, $StartupTaskXmlSha256, 'StartupTaskXmlSha256'),
            @($BackupMetadataFile, $BackupMetadataSha256, 'BackupMetadataSha256'),
            @($BackupSidecarFile, $BackupSidecarSha256, 'BackupSidecarSha256'),
            @($SourceInventoryFile, $SourceInventorySha256, 'SourceInventorySha256'),
            @($CloudflareCredentialFile, $CloudflareCredentialSha256, 'CloudflareCredentialSha256')
        )) {
        Assert-EasyFireMigrationFileHash -Path ([string]$binding[0]) `
            -ExpectedSha256 ([string]$binding[1]) -Name ([string]$binding[2])
    }
    if ($SourceMysqlContainerId -notmatch '^[a-f0-9]{64}$' -or $SourceMysqlImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
        $SourceMysqlVolumeDestination -cne '/var/lib/mysql' -or $AuthorityOwnerSid -notmatch '^S-1-5-21-(?:\d+-){3}\d+$') {
        throw 'Source container, volume, or owner authority is invalid.'
    }
    $metadata = Read-EasyFireMigrationJson -Path $BackupMetadataFile -Name 'MigrationSource metadata'
    $initialBackupFile = Assert-EasyFireMigrationMetadata -Metadata $metadata
    $sidecarText = (Get-Content -LiteralPath $BackupSidecarFile -Raw).Trim()
    $expectedSidecar = "{0}  {1}" -f [string]$metadata.BackupSha256, [IO.Path]::GetFileName($initialBackupFile)
    if ($sidecarText -cne $expectedSidecar) {
        throw 'Initial backup SHA-256 sidecar does not bind the metadata backup artifact.'
    }
    $sourceInventory = Read-EasyFireMigrationJson -Path $SourceInventoryFile -Name 'Source inventory'
    $null = Assert-EasyFireMigrationSourceInventory -Inventory $sourceInventory `
        -ExpectedProjectName $SourceProjectName -ExpectedMysqlVolumeName $SourceMysqlVolumeName `
        -ExpectedRedisVolumeName $SourceRedisVolumeName
    $inventoryMysql = @($sourceInventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })
    if ($inventoryMysql.Count -ne 1 -or [string]$inventoryMysql[0].ContainerId -cne $SourceMysqlContainerId) {
        throw 'Source inventory does not bind the metadata-bound MariaDB container.'
    }
    $targetImages = @(
        [pscustomobject][ordered]@{ Service='server'; ImageReference=$TargetServerImageReference; ImageId=$TargetServerImageId },
        [pscustomobject][ordered]@{ Service='webapp'; ImageReference=$TargetWebappImageReference; ImageId=$TargetWebappImageId },
        [pscustomobject][ordered]@{ Service='envoy'; ImageReference=$TargetEnvoyImageReference; ImageId=$TargetEnvoyImageId },
        [pscustomobject][ordered]@{ Service='gotenberg'; ImageReference=$TargetGotenbergImageReference; ImageId=$TargetGotenbergImageId },
        [pscustomobject][ordered]@{ Service='database_migration'; ImageReference=$TargetMigrationImageReference; ImageId=$TargetMigrationImageId },
        [pscustomobject][ordered]@{ Service='mysql'; ImageReference=$TargetMysqlImageReference; ImageId=$TargetMysqlImageId },
        [pscustomobject][ordered]@{ Service='redis'; ImageReference=$TargetRedisImageReference; ImageId=$TargetRedisImageId }
    )
    $null = Assert-EasyFireMigrationTargetImages -Images $targetImages
    $authorityDocument = [pscustomobject][ordered]@{
        SchemaVersion=1; MigrationId=$MigrationId; ProductionRoot=$ProductionRoot; AuthorityOwnerSid=$AuthorityOwnerSid
        Source=[pscustomobject][ordered]@{
            ReleaseId=$SourceReleaseId; ReleaseDirectory=$SourceReleaseDirectory
            ComposeFile=$SourceComposeFile; ComposeFileSha256=$SourceComposeSha256
            EnvFile=$SourceEnvFile; EnvFileSha256=$SourceEnvSha256; ProjectName=$SourceProjectName
            MysqlContainerId=$SourceMysqlContainerId; MysqlContainerName=$SourceMysqlContainerName
            MysqlImageReference=$SourceMysqlImageReference; MysqlImageId=$SourceMysqlImageId
            MysqlVolumeName=$SourceMysqlVolumeName; MysqlVolumeComposeKey=$SourceMysqlVolumeComposeKey
            MysqlVolumeDestination=$SourceMysqlVolumeDestination; RedisVolumeName=$SourceRedisVolumeName
            InventoryFile=$SourceInventoryFile; InventorySha256=$SourceInventorySha256
        }
        Target=[pscustomobject][ordered]@{
            ReleaseId=$TargetReleaseId; ReleaseDirectory=$TargetReleaseDirectory
            ComposeFile=$TargetComposeFile; ComposeFileSha256=$TargetComposeSha256
            EnvTemplateFile=$TargetEnvFile; EnvTemplateSha256=$TargetEnvSha256; Images=$targetImages
        }
        InitialBackup=[pscustomobject][ordered]@{
            File=$initialBackupFile; Sha256=[string]$metadata.BackupSha256
            SidecarFile=$BackupSidecarFile; SidecarSha256=$BackupSidecarSha256
            MetadataFile=$BackupMetadataFile; MetadataSha256=$BackupMetadataSha256
            BackupOperationId=[string]$metadata.BackupOperationId; RestoreVerificationRequired=$true
        }
        TaskBackups=[pscustomobject][ordered]@{
            Backup=[pscustomobject][ordered]@{ Path=$BackupTaskXmlPath; Sha256=$BackupTaskXmlSha256 }
            Startup=[pscustomobject][ordered]@{ Path=$StartupTaskXmlPath; Sha256=$StartupTaskXmlSha256 }
        }
        Edge=[pscustomobject][ordered]@{ CredentialFile=$CloudflareCredentialFile; CredentialSha256=$CloudflareCredentialSha256; ServiceName='EasyFireBookkeepingCloudflared' }
        ControllerBundleAuthority=Get-EasyFireMigrationControllerBundleAuthority
        ExecutionContracts=[pscustomobject][ordered]@{
            Rehearsal=@(Get-EasyFireMigrationExecutionContract -Lane Rehearsal)
            Cutover=@(Get-EasyFireMigrationExecutionContract -Lane Cutover)
            Rollback=@(Get-EasyFireMigrationExecutionContract -Lane Rollback)
        }
    }
    $journal = New-EasyFireMigrationJournal -MigrationId $MigrationId -AuthorityRoot $AuthorityRoot `
        -AuthorityDocument $authorityDocument -SourceInventory $sourceInventory `
        -PreservedVolumes @($SourceMysqlVolumeName, $SourceRedisVolumeName) `
        -PreservedReleases @($SourceReleaseDirectory, $TargetReleaseDirectory) `
        -PreservedBackups @($initialBackupFile, $BackupSidecarFile, $BackupMetadataFile) `
        -PreservedTaskBackups @($BackupTaskXmlPath, $StartupTaskXmlPath)
    $initialPlan = New-EasyFireMigrationBackupPlanRecord `
        -BackupOperationId ([string]$metadata.BackupOperationId) -InvocationRole MigrationSource `
        -State completed -CompletedAtUtc ((Get-Item -LiteralPath $initialBackupFile).LastWriteTimeUtc.ToString('o'))
    $journal.BackupReceipts.InitialSource = [pscustomobject][ordered]@{
        Plan = $initialPlan
        RecoveryUnit = New-EasyFireMigrationRecoveryUnitFromPublishedBackup `
            -Published ([pscustomobject][ordered]@{
                BackupFile=$initialBackupFile; Sha256=[string]$metadata.BackupSha256
                SidecarFile=$BackupSidecarFile; MetadataFile=$BackupMetadataFile; MetadataSha256=$BackupMetadataSha256
            }) -BackupOperationId ([string]$metadata.BackupOperationId) -InvocationRole MigrationSource
        RestoreReceipt = $null
    }
    $script:JournalPath = Get-EasyFireMigrationJournalPath -AuthorityRoot $AuthorityRoot -MigrationId $MigrationId
    $script:AuthorityFingerprint = [string]$journal.Authority.Fingerprint

    $mutexToken = $script:AuthorityFingerprint.Substring(0, 32)
    $mutex = New-Object Threading.Mutex($false, "Global\EasyFireMigrationAction_$mutexToken")
    try { $mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(10)) }
    catch [Threading.AbandonedMutexException] { $mutexAcquired = $true }
    if (-not $mutexAcquired) { throw 'Another process owns this exact migration authority.' }

    if ($Mode -ceq 'Plan') {
        if ($WhatIfPreference) {
            $planJournal = $journal
        } else {
            $initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $script:JournalPath
            $planJournal = $initialized.Journal
        }
        [pscustomobject]@{
            SchemaVersion=2; MigrationId=$MigrationId; CurrentState='Planned'; JournalPath=$script:JournalPath
            Authority=$authorityDocument; AuthorityFingerprint=$script:AuthorityFingerprint
            Lanes=$planJournal.Lanes; Operations=$authorityDocument.ExecutionContracts
            PreserveOriginals=$true
        } | ConvertTo-Json -Depth 40 -Compress
        exit 0
    }

    $null = Refresh-EasyFireMigrationJournal
    if ($WhatIfPreference) {
        [pscustomobject]@{
            Mode=$Mode; CurrentState=[string]$script:JournalRead.Journal.CurrentState
            Phase=[string]$script:JournalRead.Journal.Phase; JournalPath=$script:JournalPath
            Contract=if($Mode -ceq 'Rehearse'){@(Get-EasyFireMigrationExecutionContract -Lane Rehearsal)}else{@(Get-EasyFireMigrationExecutionContract -Lane Cutover)}
            WouldExecuteLive=$false; PreserveOriginals=$true
        } | ConvertTo-Json -Depth 20 -Compress
        exit 0
    }
    if (-not $ExecuteLive) { throw "$Mode requires -ExecuteLive after an exact approved Plan." }

    $result = switch ($Mode) {
        'Rehearse' {
            if ([string]$script:JournalRead.Journal.CurrentState -ceq 'Rehearsing' -and
                [string]$script:JournalRead.Journal.Phase -cne 'AwaitingNativeAuthentication') {
                if ([string]$script:JournalRead.Journal.Phase -in @('RehearsalAuthenticated', 'RehearsalRollbackPrepared')) {
                    throw 'The source-recovery drill must be resumed with AcceptAuthentication; it is not safe to abort it as a pre-auth rehearsal.'
                }
                Invoke-EasyFireMigrationAbortRehearsal -Failure ([Management.Automation.ErrorRecord]::new(
                    [Exception]::new('A prior rehearsal stopped at a partial persisted phase.'),
                    'InterruptedRehearsal', [Management.Automation.ErrorCategory]::OperationStopped, $null))
                break
            }
            try { Invoke-EasyFireMigrationRehearsal }
            catch {
                $original = $_
                $null = Refresh-EasyFireMigrationJournal
                if ([string]$script:JournalRead.Journal.CurrentState -ceq 'Rehearsing' -and
                    [string]$script:JournalRead.Journal.Phase -cne 'AwaitingNativeAuthentication') {
                    try {
                        $aborted = Invoke-EasyFireMigrationAbortRehearsal -Failure $original
                    } catch {
                        throw "REHEARSAL_ABORT_FAILED: original=$([string]$original.Exception.Message); abort=$([string]$_.Exception.Message); journal=$script:JournalPath"
                    }
                    throw "REHEARSAL_ABORTED: $([string]$original.Exception.Message); journal=$([string]$aborted.JournalPath)"
                }
                throw
            }
        }
        'AcceptAuthentication' { Invoke-EasyFireMigrationAcceptAuthentication }
        'Cutover' {
            if ([string]$script:JournalRead.Journal.CurrentState -in @('CuttingOver', 'RollingBack')) {
                Invoke-EasyFireMigrationAutomaticRollback -Failure ([Management.Automation.ErrorRecord]::new(
                    [Exception]::new('A prior cutover stopped at a partial persisted phase.'),
                    'InterruptedCutover', [Management.Automation.ErrorCategory]::OperationStopped, $null))
                break
            }
            try { Invoke-EasyFireMigrationCutover }
            catch {
                if ($script:CutoverMutationStarted) {
                    $rollback = Invoke-EasyFireMigrationAutomaticRollback -Failure $_
                    throw "CUTOVER_ROLLED_BACK: $($rollback.OriginalFailure)"
                }
                throw
            }
        }
        'Rollback' { Invoke-EasyFireMigrationAutomaticRollback -Failure ([Management.Automation.ErrorRecord]::new([Exception]::new('Explicit rollback requested.'), 'ExplicitRollback', [Management.Automation.ErrorCategory]::OperationStopped, $null)) }
    }
    $result | ConvertTo-Json -Depth 40 -Compress
    exit 0
} catch {
    Write-Error -ErrorRecord $_
    exit 1
} finally {
    if ($mutexAcquired -and $null -ne $mutex) { try { $mutex.ReleaseMutex() } catch { } }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
