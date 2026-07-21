Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'production-state.psm1') -Force -ErrorAction Stop

$script:PreservationCategories = @(
    'Volumes', 'Releases', 'Backups', 'Journals', 'TaskBackups', 'ServiceBackups'
)

$script:AllowedTransitions = @{
    'Planned|Planned' = @(
        'Rehearsing|InitialRestoreRunning',
        'Rehearsing|InitialRestoreVerified'
    )
    'Rehearsing|InitialRestoreRunning' = @('Rehearsing|InitialRestoreVerified')
    'Rehearsing|InitialRestoreVerified' = @('Rehearsing|RehearsalDataStarting')
    'Rehearsing|RehearsalDataStarting' = @('Rehearsing|RehearsalMysqlReady')
    'Rehearsing|RehearsalMysqlReady' = @('Rehearsing|RehearsalImported')
    'Rehearsing|RehearsalImported' = @('Rehearsing|RehearsalRedisReady')
    'Rehearsing|RehearsalRedisReady' = @('Rehearsing|RehearsalMigrationPrepared')
    'Rehearsing|RehearsalMigrationPrepared' = @('Rehearsing|RehearsalMigrationRunning')
    'Rehearsing|RehearsalMigrationRunning' = @('Rehearsing|RehearsalMigrationComplete')
    'Rehearsing|RehearsalMigrationComplete' = @('Rehearsing|RehearsalAppReady')
    'Rehearsing|RehearsalAppReady' = @('Rehearsing|AwaitingNativeAuthentication')
    'Rehearsing|AwaitingNativeAuthentication' = @('Rehearsing|RehearsalAuthenticated')
    'Rehearsing|RehearsalAuthenticated' = @('Rehearsing|RehearsalRollbackPrepared')
    'Rehearsing|RehearsalRollbackPrepared' = @('RehearsalVerified|RehearsalRollbackVerified')
    'RehearsalVerified|RehearsalRollbackVerified' = @('CuttingOver|IngressPausePending')
    'CuttingOver|IngressPausePending' = @(
        'CuttingOver|IngressPausePrepared',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|IngressPausePrepared' = @(
        'CuttingOver|IngressPaused',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|IngressPaused' = @(
        'CuttingOver|SourceFreezePending',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|SourceFreezePending' = @(
        'CuttingOver|SourceFrozen',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|SourceFrozen' = @(
        'CuttingOver|FinalBackupRunning',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|FinalBackupRunning' = @(
        'CuttingOver|FinalBackupReady',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|FinalBackupReady' = @(
        'CuttingOver|FinalRestoreVerified',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|FinalRestoreVerified' = @(
        'CuttingOver|SourceDataFrozen',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|SourceDataFrozen' = @(
        'CuttingOver|CutoverDataStarting',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverDataStarting' = @(
        'CuttingOver|CutoverMysqlReady',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverMysqlReady' = @(
        'CuttingOver|CutoverImported',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverImported' = @(
        'CuttingOver|CutoverRedisReady',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverRedisReady' = @(
        'CuttingOver|CutoverMigrationPrepared',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverMigrationPrepared' = @(
        'CuttingOver|CutoverMigrationRunning',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverMigrationRunning' = @(
        'CuttingOver|CutoverMigrationComplete',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverMigrationComplete' = @(
        'CuttingOver|CutoverAppReady',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverAppReady' = @(
        'CuttingOver|CutoverBaselineBackupRunning',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverBaselineBackupRunning' = @(
        'CuttingOver|CutoverBaselineBackupReady',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverBaselineBackupReady' = @(
        'CuttingOver|CutoverBaselineRestoreVerified',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|CutoverBaselineRestoreVerified' = @(
        'CuttingOver|TasksMutationPending',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|TasksMutationPending' = @(
        'CuttingOver|TasksMigrated',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|TasksMigrated' = @(
        'CuttingOver|EdgeStarting',
        'RollingBack|RollbackInProgress'
    )
    'CuttingOver|EdgeStarting' = @(
        'Completed|Completed',
        'RollingBack|RollbackInProgress'
    )
    'Completed|Completed' = @('Completed|EmergencyBackupRunning')
    'Completed|EmergencyBackupRunning' = @('Completed|EmergencyBackupReady')
    'Completed|EmergencyBackupReady' = @('Completed|EmergencyRestoreVerified')
    'Completed|EmergencyRestoreVerified' = @('RollingBack|RollbackInProgress')
    'RollingBack|RollbackInProgress' = @('RolledBack|RolledBack')
    'RolledBack|RolledBack' = @()
}

foreach ($key in @($script:AllowedTransitions.Keys | Where-Object { $_ -like 'Rehearsing|*' })) {
    if ('RehearsalAborted|RehearsalAborted' -notin @($script:AllowedTransitions[$key])) {
        $script:AllowedTransitions[$key] = @($script:AllowedTransitions[$key]) + @('RehearsalAborted|RehearsalAborted')
    }
}
$script:AllowedTransitions['RehearsalAborted|RehearsalAborted'] = @()

$script:RequiredReceiptKinds = @{
    'Rehearsing|InitialRestoreVerified' = 'InitialRestore'
    'Rehearsing|RehearsalImported' = 'RehearsalImport'
    'Rehearsing|RehearsalMigrationComplete' = 'RehearsalMigration'
    'Rehearsing|RehearsalAppReady' = 'RehearsalHealth'
    'Rehearsing|RehearsalAuthenticated' = 'NativeAuthentication'
    'Rehearsing|RehearsalRollbackPrepared' = 'RehearsalRollbackPlan'
    'RehearsalAborted|RehearsalAborted' = 'RehearsalAbort'
    'RehearsalVerified|RehearsalRollbackVerified' = 'RehearsalRollback'
    'CuttingOver|IngressPausePrepared' = 'IngressPausePlan'
    'CuttingOver|IngressPaused' = 'IngressPause'
    'CuttingOver|SourceFrozen' = 'SourceFreeze'
    'CuttingOver|FinalBackupReady' = 'FinalBackup'
    'CuttingOver|FinalRestoreVerified' = 'FinalRestore'
    'CuttingOver|SourceDataFrozen' = 'SourceDataFreeze'
    'CuttingOver|CutoverImported' = 'CutoverImport'
    'CuttingOver|CutoverMigrationComplete' = 'CutoverMigration'
    'CuttingOver|CutoverAppReady' = 'CutoverHealth'
    'CuttingOver|CutoverBaselineBackupReady' = 'MigrationBaseline'
    'CuttingOver|CutoverBaselineRestoreVerified' = 'MigrationBaselineRestore'
    'CuttingOver|TasksMigrated' = 'TasksMigrated'
    'Completed|Completed' = 'Completion'
    'Completed|EmergencyBackupReady' = 'MigrationEmergency'
    'Completed|EmergencyRestoreVerified' = 'MigrationEmergencyRestore'
    'RolledBack|RolledBack' = 'Rollback'
}

$script:BackupPlanAuthority = @{
    InitialSource = 'Planned|Planned'
    FinalSource = 'CuttingOver|FinalBackupRunning'
    MigrationBaseline = 'CuttingOver|CutoverBaselineBackupRunning'
    MigrationEmergency = 'Completed|EmergencyBackupRunning'
}

function Get-EasyFireMigrationMember {
    param(
        $Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null,
        [switch]$Required
    )

    if ($null -eq $Object) {
        if ($Required) { throw "Required migration state property is missing: $Name" }
        return $Default
    }
    if ($Object -is [Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
    } else {
        $property = $Object.PSObject.Properties[$Name]
        if ($null -ne $property) { return $property.Value }
    }
    if ($Required) { throw "Required migration state property is missing: $Name" }
    return $Default
}

function Set-EasyFireMigrationMember {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )

    if ($Object -is [Collections.IDictionary]) {
        $Object[$Name] = $Value
        return
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    } else {
        $property.Value = $Value
    }
}

function Assert-EasyFireMigrationExactProperties {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    $actual = if ($Object -is [Collections.IDictionary]) {
        @($Object.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    } else {
        @($Object.PSObject.Properties.Name | Sort-Object)
    }
    $expectedSorted = @($Expected | Sort-Object)
    if ($actual.Count -ne $expectedSorted.Count -or
        @(Compare-Object $expectedSorted $actual -CaseSensitive).Count -ne 0) {
        throw "$Kind properties do not match the schema."
    }
}

function ConvertTo-EasyFireCanonicalMigrationId {
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

function ConvertTo-EasyFireCanonicalOperationId {
    param([Parameter(Mandatory = $true)][string]$OperationId)

    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId $OperationId
    if ($canonical.Substring(14, 1) -cne '4') {
        throw 'OperationId must be a canonical version-4 GUID.'
    }
    return $canonical
}

function Get-EasyFireMigrationUtcNow {
    return [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
}

function Assert-EasyFireMigrationUtcTimestamp {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParseExact(
            $Value,
            'o',
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind,
            [ref]$parsed
        )) {
        throw "$FieldName is not an exact round-trip timestamp."
    }
}

function Get-EasyFireMigrationTextSha256 {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
}

function Get-EasyFireMigrationFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $Path)) {
        throw "Migration state file is missing or unsafe: $Path"
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($Path)
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
}

function Get-EasyFireMigrationJsonSha256 {
    param([Parameter(Mandatory = $true)]$Value)

    return Get-EasyFireMigrationTextSha256 -Text (
        $Value | ConvertTo-Json -Depth 50 -Compress
    )
}

function Get-EasyFireMigrationCanonicalRoot {
    param([Parameter(Mandatory = $true)][string]$AuthorityRoot)

    $full = [IO.Path]::GetFullPath($AuthorityRoot)
    if (-not (Test-Path -LiteralPath $full -PathType Container) -or
        (Test-EasyFireReparsePoint -Path $full)) {
        throw 'AuthorityRoot must be one existing regular directory.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $full -TrustedRoot $full
    return $full
}

function Get-EasyFireMigrationJournalPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$AuthorityRoot,
        [Parameter(Mandatory = $true)][string]$MigrationId
    )

    $root = Get-EasyFireMigrationCanonicalRoot -AuthorityRoot $AuthorityRoot
    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId $MigrationId
    $migrationRoot = Join-Path (Join-Path $root 'migrations') $canonical
    return Resolve-EasyFireContainedPath -Path (Join-Path $migrationRoot 'migration.journal.json') -AllowedRoot $root
}

function New-EasyFireMigrationLaneIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$MigrationId,
        [Parameter(Mandatory = $true)][string]$AuthorityRoot,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Rehearsal', 'Cutover')]
        [string]$Lane
    )

    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId $MigrationId
    $root = Get-EasyFireMigrationCanonicalRoot -AuthorityRoot $AuthorityRoot
    $token = $canonical.Replace('-', '').Substring(0, 12)
    $laneToken = if ($Lane -ceq 'Rehearsal') { 'r' } else { 'c' }
    $laneDirectoryName = if ($Lane -ceq 'Rehearsal') { 'rehearsal' } else { 'cutover' }
    $prefix = "easyfire-mig-$laneToken-$token"
    $directory = Resolve-EasyFireContainedPath -Path (
        Join-Path (Join-Path (Join-Path $root 'migrations') $canonical) $laneDirectoryName
    ) -AllowedRoot $root
    $port = if ($Lane -ceq 'Cutover') {
        80
    } else {
        24000 + ([Convert]::ToInt32($token.Substring(0, 4), 16) % 10000)
    }
    $containers = [pscustomobject][ordered]@{
        Mysql = "$prefix-mysql"
        Redis = "$prefix-redis"
        DatabaseMigration = "$prefix-database-migration"
        Server = "$prefix-server"
        Webapp = "$prefix-webapp"
        Envoy = "$prefix-envoy"
        Gotenberg = "$prefix-gotenberg"
    }
    return [pscustomobject][ordered]@{
        SchemaVersion = 1
        Lane = $Lane
        ProjectName = "easyfire-bookkeeping-mig-$laneToken-$token"
        MysqlVolumeName = "easyfire_mig_${laneToken}_mysql_$token"
        RedisVolumeName = "easyfire_mig_${laneToken}_redis_$token"
        MysqlContainerName = [string]$containers.Mysql
        RedisContainerName = [string]$containers.Redis
        MigrationContainerName = [string]$containers.DatabaseMigration
        ServerContainerName = [string]$containers.Server
        WebappContainerName = [string]$containers.Webapp
        ProxyContainerName = [string]$containers.Envoy
        GotenbergContainerName = [string]$containers.Gotenberg
        Containers = $containers
        LoopbackPort = $port
        AuthorityLabel = "easyfire.migration.$laneToken=$canonical"
        Directory = $directory
        EnvironmentFile = Join-Path $directory 'runtime.env'
        ComposeOverrideFile = Join-Path $directory 'compose.override.yml'
    }
}

function Get-EasyFireMigrationOrderedStrings {
    param([object[]]$Values = @())

    $set = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($value in @($Values)) {
        $text = [string]$value
        if ([string]::IsNullOrWhiteSpace($text) -or $text -match '[\x00-\x1F]') {
            throw 'A preservation identity is empty or contains a control character.'
        }
        $null = $set.Add($text)
    }
    $result = @($set)
    [Array]::Sort($result, [StringComparer]::Ordinal)
    return $result
}

function New-EasyFireMigrationPreservationSet {
    param(
        [object[]]$Volumes = @(),
        [object[]]$Releases = @(),
        [object[]]$Backups = @(),
        [object[]]$Journals = @(),
        [object[]]$TaskBackups = @(),
        [object[]]$ServiceBackups = @()
    )

    return [pscustomobject][ordered]@{
        Volumes = @(Get-EasyFireMigrationOrderedStrings -Values $Volumes)
        Releases = @(Get-EasyFireMigrationOrderedStrings -Values $Releases)
        Backups = @(Get-EasyFireMigrationOrderedStrings -Values $Backups)
        Journals = @(Get-EasyFireMigrationOrderedStrings -Values $Journals)
        TaskBackups = @(Get-EasyFireMigrationOrderedStrings -Values $TaskBackups)
        ServiceBackups = @(Get-EasyFireMigrationOrderedStrings -Values $ServiceBackups)
    }
}

function Assert-EasyFireMigrationPreservationSet {
    param([Parameter(Mandatory = $true)]$PreservationSet)

    Assert-EasyFireMigrationExactProperties -Object $PreservationSet -Expected $script:PreservationCategories -Kind 'PreservationSet'
    foreach ($category in $script:PreservationCategories) {
        $values = @((Get-EasyFireMigrationMember -Object $PreservationSet -Name $category -Required))
        $normalized = @(Get-EasyFireMigrationOrderedStrings -Values $values)
        if ($values.Count -ne $normalized.Count -or
            @(Compare-Object $normalized $values -CaseSensitive -SyncWindow 0).Count -ne 0) {
            throw "PreservationSet category is not an exact ordered set: $category"
        }
    }
}

function Assert-EasyFireMigrationPreservationMonotonic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Before,
        [Parameter(Mandatory = $true)]$After
    )

    $beforeSet = Get-EasyFireMigrationMember -Object $Before -Name 'PreservationSet' -Required
    $afterSet = Get-EasyFireMigrationMember -Object $After -Name 'PreservationSet' -Required
    Assert-EasyFireMigrationPreservationSet -PreservationSet $beforeSet
    Assert-EasyFireMigrationPreservationSet -PreservationSet $afterSet
    foreach ($category in $script:PreservationCategories) {
        $prior = @((Get-EasyFireMigrationMember -Object $beforeSet -Name $category -Required))
        $next = @((Get-EasyFireMigrationMember -Object $afterSet -Name $category -Required))
        foreach ($identity in $prior) {
            if ([Array]::IndexOf([string[]]$next, [string]$identity) -lt 0) {
                throw "A migration journal update cannot remove a preserved $category identity: $identity"
            }
        }
    }
    return $true
}

function Get-EasyFireMigrationAuthorityFingerprint {
    param(
        [Parameter(Mandatory = $true)]$AuthorityDocument,
        [Parameter(Mandatory = $true)]$SourceInventory,
        [Parameter(Mandatory = $true)]$Lanes
    )

    $documentSha256 = Get-EasyFireMigrationJsonSha256 -Value $AuthorityDocument
    $sourceInventoryFingerprint = Get-EasyFireMigrationJsonSha256 -Value $SourceInventory
    $fingerprintDocument = [pscustomobject][ordered]@{
        SchemaVersion = 1
        DocumentSha256 = $documentSha256
        SourceInventoryFingerprint = $sourceInventoryFingerprint
        Lanes = $Lanes
    }
    return [pscustomobject][ordered]@{
        Fingerprint = Get-EasyFireMigrationJsonSha256 -Value $fingerprintDocument
        DocumentSha256 = $documentSha256
        SourceInventoryFingerprint = $sourceInventoryFingerprint
    }
}

function New-EasyFireMigrationJournal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$MigrationId,
        [Parameter(Mandatory = $true)][string]$AuthorityRoot,
        [Parameter(Mandatory = $true)]$AuthorityDocument,
        [Parameter(Mandatory = $true)]$SourceInventory,
        [string[]]$PreservedVolumes = @(),
        [string[]]$PreservedReleases = @(),
        [string[]]$PreservedBackups = @(),
        [string[]]$PreservedJournals = @(),
        [string[]]$PreservedTaskBackups = @(),
        [string[]]$PreservedServiceBackups = @()
    )

    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId $MigrationId
    $root = Get-EasyFireMigrationCanonicalRoot -AuthorityRoot $AuthorityRoot
    $rehearsal = New-EasyFireMigrationLaneIdentity -MigrationId $canonical -AuthorityRoot $root -Lane Rehearsal
    $cutover = New-EasyFireMigrationLaneIdentity -MigrationId $canonical -AuthorityRoot $root -Lane Cutover
    $lanes = [pscustomobject][ordered]@{
        Rehearsal = $rehearsal
        Cutover = $cutover
    }
    $authorityHashes = Get-EasyFireMigrationAuthorityFingerprint -AuthorityDocument $AuthorityDocument -SourceInventory $SourceInventory -Lanes $lanes
    $authority = [pscustomobject][ordered]@{
        SchemaVersion = 1
        Fingerprint = [string]$authorityHashes.Fingerprint
        DocumentSha256 = [string]$authorityHashes.DocumentSha256
        SourceInventoryFingerprint = [string]$authorityHashes.SourceInventoryFingerprint
        Document = $AuthorityDocument
    }
    $journalPath = Get-EasyFireMigrationJournalPath -AuthorityRoot $root -MigrationId $canonical
    $initialSnapshot = Join-Path (Join-Path ([IO.Path]::GetDirectoryName($journalPath)) 'transitions') 'transition-0001-Planned-Planned.json'
    $volumeSet = @($PreservedVolumes) + @(
        $rehearsal.MysqlVolumeName,
        $rehearsal.RedisVolumeName,
        $cutover.MysqlVolumeName,
        $cutover.RedisVolumeName
    )
    $journalSet = @($PreservedJournals) + @($journalPath, $initialSnapshot)
    $preservationSet = New-EasyFireMigrationPreservationSet -Volumes $volumeSet -Releases $PreservedReleases -Backups $PreservedBackups -Journals $journalSet -TaskBackups $PreservedTaskBackups -ServiceBackups $PreservedServiceBackups
    $now = Get-EasyFireMigrationUtcNow
    return [pscustomobject][ordered]@{
        SchemaVersion = 2
        MigrationId = $canonical
        AuthorityRoot = $root
        CurrentState = 'Planned'
        Phase = 'Planned'
        Authority = $authority
        Lanes = $lanes
        SourceInventory = $SourceInventory
        BackupReceipts = [pscustomobject][ordered]@{
            InitialSource = $null
            FinalSource = $null
            MigrationBaseline = $null
            MigrationEmergency = $null
            MigrationScheduled = $null
        }
        AuthenticationReceipt = $null
        TaskReceipts = [pscustomobject][ordered]@{
            Checkpoint = $null
            Desired = $null
            Rollback = $null
        }
        ServiceReceipt = $null
        PreservationSet = $preservationSet
        Operations = @()
        Receipts = @()
        Transitions = @(
            [pscustomobject][ordered]@{
                Sequence = 1
                FromState = ''
                FromPhase = ''
                ToState = 'Planned'
                ToPhase = 'Planned'
                AtUtc = $now
                ReceiptSha256 = ''
            }
        )
        Revision = 1
        PreserveOriginals = $true
        CreatedAtUtc = $now
        UpdatedAtUtc = $now
        CompletedAuthority = $null
    }
}

function Get-EasyFireMigrationStateKey {
    param(
        [Parameter(Mandatory = $true)][string]$State,
        [Parameter(Mandatory = $true)][string]$Phase
    )
    return "$State|$Phase"
}

function Test-EasyFireMigrationTransitionAllowed {
    param(
        [Parameter(Mandatory = $true)][string]$FromState,
        [Parameter(Mandatory = $true)][string]$FromPhase,
        [Parameter(Mandatory = $true)][string]$ToState,
        [Parameter(Mandatory = $true)][string]$ToPhase
    )

    $from = Get-EasyFireMigrationStateKey -State $FromState -Phase $FromPhase
    $to = Get-EasyFireMigrationStateKey -State $ToState -Phase $ToPhase
    return $script:AllowedTransitions.ContainsKey($from) -and $to -cin @($script:AllowedTransitions[$from])
}

function Assert-EasyFireMigrationLaneIdentity {
    param(
        [Parameter(Mandatory = $true)]$Observed,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    if (($Observed | ConvertTo-Json -Depth 20 -Compress) -cne
        ($Expected | ConvertTo-Json -Depth 20 -Compress)) {
        throw "$Kind lane identity does not match its exact derivation."
    }
}

function Assert-EasyFireMigrationOperation {
    param([Parameter(Mandatory = $true)]$Operation)

    Assert-EasyFireMigrationExactProperties -Object $Operation -Expected @(
        'SchemaVersion', 'Name', 'Lane', 'OperationId', 'State', 'CreatedAtUtc', 'UpdatedAtUtc'
    ) -Kind 'Migration operation'
    if ([int]$Operation.SchemaVersion -ne 1 -or
        [string]$Operation.Name -notmatch '^[A-Z][A-Za-z0-9]{0,63}$' -or
        [string]$Operation.Lane -notin @('Rehearsal', 'Cutover', 'Global') -or
        [string]$Operation.State -notin @('Planned', 'Authorized', 'Started', 'Completed', 'Failed')) {
        throw 'Migration operation authority is invalid.'
    }
    $null = ConvertTo-EasyFireCanonicalOperationId -OperationId ([string]$Operation.OperationId)
    Assert-EasyFireMigrationUtcTimestamp -Value ([string]$Operation.CreatedAtUtc) -FieldName 'Operation.CreatedAtUtc'
    Assert-EasyFireMigrationUtcTimestamp -Value ([string]$Operation.UpdatedAtUtc) -FieldName 'Operation.UpdatedAtUtc'
}

function Assert-EasyFireMigrationReceiptBinding {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Binding,
        [Parameter(Mandatory = $true)][string]$ExpectedMigrationId,
        [Parameter(Mandatory = $true)][string]$ExpectedAuthorityFingerprint
    )

    Assert-EasyFireMigrationExactProperties -Object $Binding -Expected @(
        'SchemaVersion', 'MigrationId', 'AuthorityFingerprint', 'Lane', 'Kind',
        'OperationId', 'Path', 'Sha256'
    ) -Kind 'Migration receipt binding'
    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId $ExpectedMigrationId
    if ([int]$Binding.SchemaVersion -ne 1 -or
        [string]$Binding.MigrationId -cne $canonical -or
        [string]$Binding.AuthorityFingerprint -cne $ExpectedAuthorityFingerprint -or
        [string]$Binding.AuthorityFingerprint -notmatch '^[A-F0-9]{64}$' -or
        [string]$Binding.Lane -notin @('Rehearsal', 'Cutover', 'Global') -or
        [string]$Binding.Kind -notmatch '^[A-Z][A-Za-z0-9]{0,63}$' -or
        [string]$Binding.Sha256 -notmatch '^[A-F0-9]{64}$') {
        throw 'Migration receipt binding identity is invalid.'
    }
    $operationId = ConvertTo-EasyFireCanonicalOperationId -OperationId ([string]$Binding.OperationId)
    $path = [IO.Path]::GetFullPath([string]$Binding.Path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $path)) {
        throw 'Migration receipt file is missing or unsafe.'
    }
    $actualSha256 = Get-EasyFireMigrationFileSha256 -Path $path
    if ($actualSha256 -cne [string]$Binding.Sha256) {
        throw 'Migration receipt hash changed after binding.'
    }
    try { $receipt = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'Migration receipt is not valid JSON.' }
    Assert-EasyFireMigrationExactProperties -Object $receipt -Expected @(
        'SchemaVersion', 'MigrationId', 'AuthorityFingerprint', 'Lane', 'Kind',
        'OperationId', 'Passed', 'Evidence', 'RecordedAtUtc'
    ) -Kind 'Migration receipt'
    if ([int]$receipt.SchemaVersion -ne 1 -or
        [string]$receipt.MigrationId -cne $canonical -or
        [string]$receipt.AuthorityFingerprint -cne $ExpectedAuthorityFingerprint -or
        [string]$receipt.Lane -cne [string]$Binding.Lane -or
        [string]$receipt.Kind -cne [string]$Binding.Kind -or
        [string]$receipt.OperationId -cne $operationId -or
        $receipt.Passed -isnot [bool] -or -not [bool]$receipt.Passed) {
        throw 'Migration receipt document does not match its binding.'
    }
    Assert-EasyFireMigrationUtcTimestamp -Value ([string]$receipt.RecordedAtUtc) -FieldName 'Receipt.RecordedAtUtc'
    return $true
}

function Get-EasyFireMigrationBackupPlanOperationId {
    param([Parameter(Mandatory = $true)]$Plan)

    $operationId = ConvertTo-EasyFireCanonicalOperationId -OperationId (
        [string](Get-EasyFireMigrationMember -Object $Plan -Name 'BackupOperationId' -Required)
    )
    $stateProperty = if ($Plan -is [Collections.IDictionary]) {
        if ($Plan.Contains('State')) { $Plan['State'] } else { $null }
    } else {
        $property = $Plan.PSObject.Properties['State']
        if ($null -ne $property) { $property.Value } else { $null }
    }
    if ($null -ne $stateProperty) {
        $state = [string]$stateProperty
        $completedAt = [string](Get-EasyFireMigrationMember -Object $Plan -Name 'CompletedAtUtc' -Required)
        if ($state -ceq 'active') {
            if ($completedAt) { throw 'Active migration backup plan cannot have CompletedAtUtc.' }
        } elseif ($state -ceq 'completed') {
            Assert-EasyFireMigrationUtcTimestamp -Value $completedAt -FieldName 'BackupPlan.CompletedAtUtc'
        } else {
            throw 'Migration backup plan state must be active or completed.'
        }
    }
    return $operationId
}

function Test-EasyFireMigrationBackupPlanMonotonic {
    param(
        [Parameter(Mandatory = $true)]$ExistingPlan,
        [Parameter(Mandatory = $true)]$CandidatePlan
    )

    if ((Get-EasyFireMigrationJsonSha256 -Value $ExistingPlan) -ceq
        (Get-EasyFireMigrationJsonSha256 -Value $CandidatePlan)) {
        return $true
    }
    $existingNames = if ($ExistingPlan -is [Collections.IDictionary]) {
        @($ExistingPlan.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    } else { @($ExistingPlan.PSObject.Properties.Name | Sort-Object) }
    $candidateNames = if ($CandidatePlan -is [Collections.IDictionary]) {
        @($CandidatePlan.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    } else { @($CandidatePlan.PSObject.Properties.Name | Sort-Object) }
    if (($existingNames -join "`0") -cne ($candidateNames -join "`0") -or
        'State' -cnotin $existingNames -or 'CompletedAtUtc' -cnotin $existingNames -or
        [string](Get-EasyFireMigrationMember -Object $ExistingPlan -Name 'State') -cne 'active' -or
        [string](Get-EasyFireMigrationMember -Object $ExistingPlan -Name 'CompletedAtUtc')) {
        return $false
    }
    if ([string](Get-EasyFireMigrationMember -Object $CandidatePlan -Name 'State') -cne 'completed') {
        return $false
    }
    Assert-EasyFireMigrationUtcTimestamp -Value (
        [string](Get-EasyFireMigrationMember -Object $CandidatePlan -Name 'CompletedAtUtc' -Required)
    ) -FieldName 'BackupPlan.CompletedAtUtc'
    $normalized = $CandidatePlan | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    Set-EasyFireMigrationMember -Object $normalized -Name 'State' -Value 'active'
    Set-EasyFireMigrationMember -Object $normalized -Name 'CompletedAtUtc' -Value ''
    return (Get-EasyFireMigrationJsonSha256 -Value $ExistingPlan) -ceq
        (Get-EasyFireMigrationJsonSha256 -Value $normalized)
}

function Assert-EasyFireMigrationBackupReceiptRecord {
    param(
        [Parameter(Mandatory = $true)]$Record,
        $ExistingRecord,
        [Parameter(Mandatory = $true)][string]$Role
    )

    Assert-EasyFireMigrationExactProperties -Object $Record -Expected @(
        'Plan', 'RecoveryUnit', 'RestoreReceipt'
    ) -Kind "BackupReceipts.$Role"
    if ($Role -ceq 'MigrationScheduled') {
        $plans = $null
        $units = $null
        $restores = $null
        if ($Record -is [Collections.IDictionary]) {
            $plans = $Record['Plan']
            $units = $Record['RecoveryUnit']
            $restores = $Record['RestoreReceipt']
        } else {
            $plans = $Record.PSObject.Properties['Plan'].Value
            $units = $Record.PSObject.Properties['RecoveryUnit'].Value
            $restores = $Record.PSObject.Properties['RestoreReceipt'].Value
        }
        if ($plans -isnot [Array] -or $units -isnot [Array] -or $restores -isnot [Array]) {
            throw 'BackupReceipts.MigrationScheduled members must be append-only arrays.'
        }
        $plans = @($plans)
        $units = @($units)
        $restores = @($restores)
        if ($plans.Count -lt 1 -or $units.Count -gt $plans.Count -or
            $restores.Count -gt $units.Count -or ($plans.Count - $units.Count) -gt 1 -or
            ($units.Count - $restores.Count) -gt 1) {
            throw 'BackupReceipts.MigrationScheduled arrays are not aligned by staged operation.'
        }
        $operationIds = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        for ($index = 0; $index -lt $plans.Count; $index++) {
            $operationId = Get-EasyFireMigrationBackupPlanOperationId -Plan $plans[$index]
            if (-not $operationIds.Add($operationId)) {
                throw 'BackupReceipts.MigrationScheduled contains a duplicate operation.'
            }
            if ($index -lt $units.Count -and
                [string](Get-EasyFireMigrationMember -Object $units[$index] -Name 'BackupOperationId' -Required) -cne $operationId) {
                throw 'BackupReceipts.MigrationScheduled recovery unit is not aligned to its plan.'
            }
            if ($index -lt $restores.Count -and
                [string](Get-EasyFireMigrationMember -Object $restores[$index] -Name 'BackupOperationId' -Required) -cne $operationId) {
                throw 'BackupReceipts.MigrationScheduled restore receipt is not aligned to its plan.'
            }
        }
        if ($null -ne $ExistingRecord) {
            $null = Assert-EasyFireMigrationBackupReceiptRecord -Record $ExistingRecord -Role $Role
            foreach ($name in @('Plan', 'RecoveryUnit', 'RestoreReceipt')) {
                if ($ExistingRecord -is [Collections.IDictionary]) {
                    $existingItems = @($ExistingRecord[$name])
                } else {
                    $existingItems = @($ExistingRecord.PSObject.Properties[$name].Value)
                }
                if ($Record -is [Collections.IDictionary]) {
                    $candidateItems = @($Record[$name])
                } else {
                    $candidateItems = @($Record.PSObject.Properties[$name].Value)
                }
                if ($candidateItems.Count -lt $existingItems.Count) {
                    throw "BackupReceipts.MigrationScheduled $name history must be append-only."
                }
                for ($index = 0; $index -lt $existingItems.Count; $index++) {
                    $preserved = if ($name -ceq 'Plan') {
                        Test-EasyFireMigrationBackupPlanMonotonic `
                            -ExistingPlan $existingItems[$index] -CandidatePlan $candidateItems[$index]
                    } else {
                        (Get-EasyFireMigrationJsonSha256 -Value $candidateItems[$index]) -ceq
                            (Get-EasyFireMigrationJsonSha256 -Value $existingItems[$index])
                    }
                    if (-not $preserved) {
                        throw "BackupReceipts.MigrationScheduled $name history must preserve its exact prefix."
                    }
                }
            }
        }
        return $Record
    }

    $present = 0
    foreach ($name in @('Plan', 'RecoveryUnit', 'RestoreReceipt')) {
        if ($null -ne (Get-EasyFireMigrationMember -Object $Record -Name $name)) {
            $present++
        }
    }
    if ($present -eq 0) {
        throw "BackupReceipts.$Role must preserve at least one recovery artifact."
    }
    $plan = Get-EasyFireMigrationMember -Object $Record -Name 'Plan'
    if ($null -eq $plan) {
        throw "BackupReceipts.$Role requires its crash-safe Plan authority."
    }
    $operationId = Get-EasyFireMigrationBackupPlanOperationId -Plan $plan
    $recoveryUnit = Get-EasyFireMigrationMember -Object $Record -Name 'RecoveryUnit'
    $restoreReceipt = Get-EasyFireMigrationMember -Object $Record -Name 'RestoreReceipt'
    if ($null -ne $recoveryUnit -and
        [string](Get-EasyFireMigrationMember -Object $recoveryUnit -Name 'BackupOperationId' -Required) -cne $operationId) {
        throw "BackupReceipts.$Role recovery unit is not aligned to its plan."
    }
    if ($null -ne $restoreReceipt -and ($null -eq $recoveryUnit -or
        [string](Get-EasyFireMigrationMember -Object $restoreReceipt -Name 'BackupOperationId' -Required) -cne $operationId)) {
        throw "BackupReceipts.$Role restore receipt is not aligned to its plan."
    }
    if ($null -eq $ExistingRecord) { return $Record }

    Assert-EasyFireMigrationExactProperties -Object $ExistingRecord -Expected @(
        'Plan', 'RecoveryUnit', 'RestoreReceipt'
    ) -Kind "Existing BackupReceipts.$Role"
    foreach ($name in @('Plan', 'RecoveryUnit', 'RestoreReceipt')) {
        $existing = Get-EasyFireMigrationMember -Object $ExistingRecord -Name $name
        if ($null -eq $existing) { continue }
        $candidate = Get-EasyFireMigrationMember -Object $Record -Name $name
        $preserved = if ($null -eq $candidate) {
            $false
        } elseif ($name -ceq 'Plan') {
            Test-EasyFireMigrationBackupPlanMonotonic -ExistingPlan $existing -CandidatePlan $candidate
        } else {
            (Get-EasyFireMigrationJsonSha256 -Value $existing) -ceq
                (Get-EasyFireMigrationJsonSha256 -Value $candidate)
        }
        if (-not $preserved) {
            throw "BackupReceipts.$Role cannot remove or replace existing $name authority."
        }
    }
    return $Record
}

function Assert-EasyFireMigrationCompletedAuthority {
    param(
        [Parameter(Mandatory = $true)]$CompletedAuthority,
        [Parameter(Mandatory = $true)]$Journal
    )

    $expectedNames = @(
        'SchemaVersion', 'Lane', 'ProjectName', 'ReleaseId', 'ReleaseDirectory',
        'ComposeFile', 'ComposeFileSha256', 'ComposeOverrideFile', 'ComposeOverrideSha256',
        'EnvFile', 'EnvFileSha256', 'Inventory', 'InventoryFingerprint',
        'DurableVolumeFingerprint', 'Mysql', 'Redis', 'ControllerBundleAuthority',
        'BaselineRecoveryUnit', 'MigrationReceipt', 'AuthorityOwnerSid', 'CompletedAtUtc'
    )
    Assert-EasyFireMigrationExactProperties -Object $CompletedAuthority -Expected $expectedNames -Kind 'CompletedAuthority'
    $cutover = $Journal.Lanes.Cutover
    if ([int]$CompletedAuthority.SchemaVersion -ne 1 -or
        [string]$CompletedAuthority.Lane -cne 'Cutover' -or
        [string]$CompletedAuthority.ProjectName -cne [string]$cutover.ProjectName -or
        [string]$CompletedAuthority.ComposeOverrideFile -cne [string]$cutover.ComposeOverrideFile -or
        [string]$CompletedAuthority.EnvFile -cne [string]$cutover.EnvironmentFile) {
        throw 'CompletedAuthority does not bind the exact cutover lane.'
    }
    foreach ($hashName in @(
            'ComposeFileSha256', 'ComposeOverrideSha256', 'EnvFileSha256',
            'InventoryFingerprint', 'DurableVolumeFingerprint'
        )) {
        if ([string](Get-EasyFireMigrationMember -Object $CompletedAuthority -Name $hashName -Required) -notmatch '^[A-F0-9]{64}$') {
            throw "CompletedAuthority hash is invalid: $hashName"
        }
    }
    foreach ($binding in @(
            @($CompletedAuthority.Mysql, $cutover.MysqlContainerName, $cutover.MysqlVolumeName, '/var/lib/mysql'),
            @($CompletedAuthority.Redis, $cutover.RedisContainerName, $cutover.RedisVolumeName, '/data')
        )) {
        $item = $binding[0]
        Assert-EasyFireMigrationExactProperties -Object $item -Expected @(
            'ContainerId', 'ContainerName', 'ImageReference', 'ImageId',
            'VolumeName', 'VolumeComposeKey', 'VolumeDestination'
        ) -Kind 'Completed data-service authority'
        if ([string]$item.ContainerId -notmatch '^[a-f0-9]{64}$' -or
            [string]$item.ContainerName -cne [string]$binding[1] -or
            [string]$item.ImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
            [string]$item.VolumeName -cne [string]$binding[2] -or
            [string]$item.VolumeDestination -cne [string]$binding[3]) {
            throw 'Completed data-service authority does not match its lane.'
        }
    }
    if (-not $CompletedAuthority.BaselineRecoveryUnit -or -not $CompletedAuthority.ControllerBundleAuthority) {
        throw 'CompletedAuthority requires baseline recovery and controller bundle authority.'
    }
    $baselineRecord = Get-EasyFireMigrationMember -Object $Journal.BackupReceipts -Name 'MigrationBaseline'
    if ($null -eq $baselineRecord -or $null -eq $baselineRecord.RecoveryUnit -or
        (Get-EasyFireMigrationJsonSha256 -Value $CompletedAuthority.BaselineRecoveryUnit) -cne
            (Get-EasyFireMigrationJsonSha256 -Value $baselineRecord.RecoveryUnit)) {
        throw 'CompletedAuthority baseline recovery unit does not match the verified migration baseline receipt.'
    }
    $null = Assert-EasyFireMigrationReceiptBinding -Binding $CompletedAuthority.MigrationReceipt -ExpectedMigrationId $Journal.MigrationId -ExpectedAuthorityFingerprint $Journal.Authority.Fingerprint
    try {
        $sid = New-Object Security.Principal.SecurityIdentifier([string]$CompletedAuthority.AuthorityOwnerSid)
        if ([string]$sid.Value -cne [string]$CompletedAuthority.AuthorityOwnerSid) {
            throw 'noncanonical'
        }
    } catch {
        throw 'CompletedAuthority AuthorityOwnerSid is invalid.'
    }
    Assert-EasyFireMigrationUtcTimestamp -Value ([string]$CompletedAuthority.CompletedAtUtc) -FieldName 'CompletedAuthority.CompletedAtUtc'
}

function Assert-EasyFireMigrationJournalAuthority {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [string]$ExpectedMigrationId,
        [string]$ExpectedAuthorityRoot,
        [string]$ExpectedAuthorityFingerprint
    )

    Assert-EasyFireMigrationExactProperties -Object $Journal -Expected @(
        'SchemaVersion', 'MigrationId', 'AuthorityRoot', 'CurrentState', 'Phase',
        'Authority', 'Lanes', 'SourceInventory', 'BackupReceipts',
        'AuthenticationReceipt', 'TaskReceipts', 'ServiceReceipt', 'PreservationSet',
        'Operations', 'Receipts', 'Transitions', 'Revision', 'PreserveOriginals',
        'CreatedAtUtc', 'UpdatedAtUtc', 'CompletedAuthority'
    ) -Kind 'Migration journal'
    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId ([string]$Journal.MigrationId)
    if ($ExpectedMigrationId -and $canonical -cne (ConvertTo-EasyFireCanonicalMigrationId -MigrationId $ExpectedMigrationId)) {
        throw 'Migration journal MigrationId does not match expected authority.'
    }
    $root = Get-EasyFireMigrationCanonicalRoot -AuthorityRoot ([string]$Journal.AuthorityRoot)
    if ($ExpectedAuthorityRoot -and $root -cne (Get-EasyFireMigrationCanonicalRoot -AuthorityRoot $ExpectedAuthorityRoot)) {
        throw 'Migration journal AuthorityRoot does not match expected authority.'
    }
    if ([int]$Journal.SchemaVersion -ne 2 -or
        $Journal.PreserveOriginals -isnot [bool] -or -not [bool]$Journal.PreserveOriginals -or
        [int]$Journal.Revision -lt 1) {
        throw 'Migration journal schema, revision, or preservation flag is invalid.'
    }
    Assert-EasyFireMigrationUtcTimestamp -Value ([string]$Journal.CreatedAtUtc) -FieldName 'Journal.CreatedAtUtc'
    Assert-EasyFireMigrationUtcTimestamp -Value ([string]$Journal.UpdatedAtUtc) -FieldName 'Journal.UpdatedAtUtc'

    Assert-EasyFireMigrationExactProperties -Object $Journal.Authority -Expected @(
        'SchemaVersion', 'Fingerprint', 'DocumentSha256', 'SourceInventoryFingerprint', 'Document'
    ) -Kind 'Migration Authority'
    Assert-EasyFireMigrationExactProperties -Object $Journal.Lanes -Expected @('Rehearsal', 'Cutover') -Kind 'Migration Lanes'
    $expectedLanes = [pscustomobject][ordered]@{
        Rehearsal = New-EasyFireMigrationLaneIdentity -MigrationId $canonical -AuthorityRoot $root -Lane Rehearsal
        Cutover = New-EasyFireMigrationLaneIdentity -MigrationId $canonical -AuthorityRoot $root -Lane Cutover
    }
    Assert-EasyFireMigrationLaneIdentity -Observed $Journal.Lanes.Rehearsal -Expected $expectedLanes.Rehearsal -Kind 'Rehearsal'
    Assert-EasyFireMigrationLaneIdentity -Observed $Journal.Lanes.Cutover -Expected $expectedLanes.Cutover -Kind 'Cutover'
    $authorityHashes = Get-EasyFireMigrationAuthorityFingerprint -AuthorityDocument $Journal.Authority.Document -SourceInventory $Journal.SourceInventory -Lanes $expectedLanes
    if ([int]$Journal.Authority.SchemaVersion -ne 1 -or
        [string]$Journal.Authority.Fingerprint -cne [string]$authorityHashes.Fingerprint -or
        [string]$Journal.Authority.DocumentSha256 -cne [string]$authorityHashes.DocumentSha256 -or
        [string]$Journal.Authority.SourceInventoryFingerprint -cne [string]$authorityHashes.SourceInventoryFingerprint -or
        ($ExpectedAuthorityFingerprint -and [string]$Journal.Authority.Fingerprint -cne $ExpectedAuthorityFingerprint)) {
        throw 'Migration journal immutable authority fingerprint changed.'
    }

    Assert-EasyFireMigrationExactProperties -Object $Journal.BackupReceipts -Expected @(
        'InitialSource', 'FinalSource', 'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled'
    ) -Kind 'BackupReceipts'
    foreach ($backupRole in @(
            'InitialSource', 'FinalSource', 'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled'
        )) {
        $backupRecord = Get-EasyFireMigrationMember -Object $Journal.BackupReceipts -Name $backupRole
        if ($null -ne $backupRecord) {
            $null = Assert-EasyFireMigrationBackupReceiptRecord -Record $backupRecord -Role $backupRole
        }
    }
    Assert-EasyFireMigrationExactProperties -Object $Journal.TaskReceipts -Expected @(
        'Checkpoint', 'Desired', 'Rollback'
    ) -Kind 'TaskReceipts'
    Assert-EasyFireMigrationPreservationSet -PreservationSet $Journal.PreservationSet
    foreach ($requiredVolume in @(
            $expectedLanes.Rehearsal.MysqlVolumeName,
            $expectedLanes.Rehearsal.RedisVolumeName,
            $expectedLanes.Cutover.MysqlVolumeName,
            $expectedLanes.Cutover.RedisVolumeName
        )) {
        if ([Array]::IndexOf([string[]]@($Journal.PreservationSet.Volumes), [string]$requiredVolume) -lt 0) {
            throw "Migration journal does not preserve a lane volume: $requiredVolume"
        }
    }

    $operationKeys = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($operation in @($Journal.Operations)) {
        Assert-EasyFireMigrationOperation -Operation $operation
        $key = "$([string]$operation.Lane)|$([string]$operation.Name)"
        if (-not $operationKeys.Add($key)) { throw "Duplicate migration operation authority: $key" }
    }
    foreach ($receipt in @($Journal.Receipts)) {
        $null = Assert-EasyFireMigrationReceiptBinding -Binding $receipt -ExpectedMigrationId $canonical -ExpectedAuthorityFingerprint $Journal.Authority.Fingerprint
        $operation = @($Journal.Operations | Where-Object {
                [string]$_.OperationId -ceq [string]$receipt.OperationId -and
                [string]$_.Name -ceq [string]$receipt.Kind -and
                [string]$_.Lane -ceq [string]$receipt.Lane
            })
        if ($operation.Count -ne 1) { throw 'A receipt is not bound to one exact journal operation.' }
    }

    $transitions = @($Journal.Transitions)
    if ($transitions.Count -lt 1 -or [int]$Journal.Revision -lt $transitions.Count) {
        throw 'Migration transition or revision history is incomplete.'
    }
    $previousState = ''
    $previousPhase = ''
    for ($index = 0; $index -lt $transitions.Count; $index++) {
        $transition = $transitions[$index]
        Assert-EasyFireMigrationExactProperties -Object $transition -Expected @(
            'Sequence', 'FromState', 'FromPhase', 'ToState', 'ToPhase', 'AtUtc', 'ReceiptSha256'
        ) -Kind 'Migration transition'
        if ([int]$transition.Sequence -ne ($index + 1) -or
            [string]$transition.FromState -cne $previousState -or
            [string]$transition.FromPhase -cne $previousPhase) {
            throw 'Migration transition sequence or prior state is invalid.'
        }
        if ($index -eq 0) {
            if ([string]$transition.ToState -cne 'Planned' -or [string]$transition.ToPhase -cne 'Planned') {
                throw 'Migration journal must begin at Planned|Planned.'
            }
        } elseif (-not (Test-EasyFireMigrationTransitionAllowed -FromState $previousState -FromPhase $previousPhase -ToState ([string]$transition.ToState) -ToPhase ([string]$transition.ToPhase))) {
            throw 'Migration transition history contains a disallowed transition.'
        }
        if ([string]$transition.ReceiptSha256 -and [string]$transition.ReceiptSha256 -notmatch '^[A-F0-9]{64}$') {
            throw 'Migration transition receipt hash is invalid.'
        }
        Assert-EasyFireMigrationUtcTimestamp -Value ([string]$transition.AtUtc -as [string]) -FieldName 'Transition.AtUtc'
        $previousState = [string]$transition.ToState
        $previousPhase = [string]$transition.ToPhase
    }
    if ([string]$Journal.CurrentState -cne $previousState -or [string]$Journal.Phase -cne $previousPhase) {
        throw 'Migration journal current state does not match transition history.'
    }
    if ([string]$Journal.CurrentState -ceq 'Completed') {
        if (-not $Journal.CompletedAuthority) { throw 'Completed migration journal lacks CompletedAuthority.' }
        Assert-EasyFireMigrationCompletedAuthority -CompletedAuthority $Journal.CompletedAuthority -Journal $Journal
    } elseif ($Journal.CompletedAuthority) {
        throw 'CompletedAuthority cannot exist before completion.'
    }
    return $true
}

function Get-EasyFireMigrationJournalMutexName {
    param([Parameter(Mandatory = $true)][string]$JournalPath)

    $identity = Get-EasyFireMigrationTextSha256 -Text ([IO.Path]::GetFullPath($JournalPath).ToUpperInvariant())
    return "Global\EasyFireMigrationState-$($identity.Substring(0, 40))"
}

function Enter-EasyFireMigrationJournalMutex {
    param([Parameter(Mandatory = $true)][string]$JournalPath)

    $mutex = New-Object Threading.Mutex($false, (Get-EasyFireMigrationJournalMutexName -JournalPath $JournalPath))
    $acquired = $false
    try {
        try { $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(10)) }
        catch [Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { throw 'Another writer owns this exact migration journal.' }
        return $mutex
    } catch {
        $mutex.Dispose()
        throw
    }
}

function Exit-EasyFireMigrationJournalMutex {
    param($Mutex)

    if ($null -eq $Mutex) { return }
    try { $Mutex.ReleaseMutex() } catch { }
    $Mutex.Dispose()
}

function Write-EasyFireMigrationJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$AuthorityRoot
    )

    $root = Get-EasyFireMigrationCanonicalRoot -AuthorityRoot $AuthorityRoot
    $full = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $root
    $directory = [IO.Path]::GetDirectoryName($full)
    $null = Assert-EasyFireNoReparsePathChain -Path $directory -TrustedRoot $root
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        $null = [IO.Directory]::CreateDirectory($directory)
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $directory -TrustedRoot $root
    $actual = if (Test-Path -LiteralPath $full -PathType Leaf) {
        Get-EasyFireMigrationFileSha256 -Path $full
    } else { 'ABSENT' }
    if ($actual -cne $ExpectedSha256) {
        throw 'Migration journal compare-and-swap authority changed.'
    }
    $json = ($Value | ConvertTo-Json -Depth 50) + [Environment]::NewLine
    $partial = "$full.partial.$PID.$([Guid]::NewGuid().ToString('N'))"
    [IO.File]::WriteAllText($partial, $json, (New-Object Text.UTF8Encoding($false)))
    if ($actual -ceq 'ABSENT') {
        [IO.File]::Move($partial, $full)
    } else {
        $previous = "$full.previous.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')).$([Guid]::NewGuid().ToString('N'))"
        [IO.File]::Replace($partial, $full, $previous, $true)
    }
    return Get-EasyFireMigrationFileSha256 -Path $full
}

function Read-EasyFireMigrationJournal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [string]$ExpectedMigrationId,
        [string]$ExpectedAuthorityFingerprint
    )

    $full = [IO.Path]::GetFullPath($JournalPath)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $full)) {
        throw 'The exact migration journal is missing or unsafe.'
    }
    $before = Get-EasyFireMigrationFileSha256 -Path $full
    try { $journal = Get-Content -LiteralPath $full -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw 'The exact migration journal is not valid JSON.' }
    $after = Get-EasyFireMigrationFileSha256 -Path $full
    if ($after -cne $before) { throw 'Migration journal changed while it was read.' }
    $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal -ExpectedMigrationId $ExpectedMigrationId -ExpectedAuthorityFingerprint $ExpectedAuthorityFingerprint
    $expectedPath = Get-EasyFireMigrationJournalPath -AuthorityRoot ([string]$journal.AuthorityRoot) -MigrationId ([string]$journal.MigrationId)
    if ($full -cne $expectedPath) { throw 'Migration journal path is not derived from its authority.' }
    return [pscustomobject]@{ Journal = $journal; Sha256 = $after; Path = $full }
}

function Initialize-EasyFireMigrationJournal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$JournalPath
    )

    $null = Assert-EasyFireMigrationJournalAuthority -Journal $Journal
    $expectedPath = Get-EasyFireMigrationJournalPath -AuthorityRoot ([string]$Journal.AuthorityRoot) -MigrationId ([string]$Journal.MigrationId)
    if ([IO.Path]::GetFullPath($JournalPath) -cne $expectedPath) {
        throw 'Initialization path does not match migration authority.'
    }
    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $expectedPath
    try {
        if (Test-Path -LiteralPath $expectedPath -PathType Leaf) {
            $existing = Read-EasyFireMigrationJournal -JournalPath $expectedPath -ExpectedMigrationId $Journal.MigrationId -ExpectedAuthorityFingerprint $Journal.Authority.Fingerprint
            return [pscustomobject]@{ Journal=$existing.Journal; Sha256=$existing.Sha256; Path=$existing.Path; Reused=$true }
        }
        $snapshotPath = Join-Path (Join-Path ([IO.Path]::GetDirectoryName($expectedPath)) 'transitions') 'transition-0001-Planned-Planned.json'
        $snapshot = $Journal
        if (Test-Path -LiteralPath $snapshotPath -PathType Leaf) {
            try { $snapshot = Get-Content -LiteralPath $snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json }
            catch { throw 'Initial migration transition snapshot is not valid JSON.' }
            $null = Assert-EasyFireMigrationJournalAuthority -Journal $snapshot -ExpectedMigrationId $Journal.MigrationId -ExpectedAuthorityFingerprint $Journal.Authority.Fingerprint
        } else {
            $null = Write-EasyFireMigrationJsonAtomic -Path $snapshotPath -Value $snapshot -ExpectedSha256 'ABSENT' -AuthorityRoot $Journal.AuthorityRoot
        }
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $expectedPath -Value $snapshot -ExpectedSha256 'ABSENT' -AuthorityRoot $Journal.AuthorityRoot
        return [pscustomobject]@{ Journal=$snapshot; Sha256=$sha256; Path=$expectedPath; Reused=$false }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Get-EasyFireMigrationJournalForWrite {
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256
    )

    $full = [IO.Path]::GetFullPath($JournalPath)
    $actual = Get-EasyFireMigrationFileSha256 -Path $full
    if ($actual -cne $ExpectedJournalSha256) {
        throw 'Migration journal compare-and-swap authority changed.'
    }
    $read = Read-EasyFireMigrationJournal -JournalPath $full
    if ($read.Sha256 -cne $ExpectedJournalSha256) {
        throw 'Migration journal compare-and-swap authority changed.'
    }
    return $read
}

function Add-EasyFireMigrationPreservedResource {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Volumes', 'Releases', 'Backups', 'Journals', 'TaskBackups', 'ServiceBackups')]
        [string]$Category,
        [Parameter(Mandatory = $true)][string]$Identity
    )

    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $JournalPath
    try {
        $read = Get-EasyFireMigrationJournalForWrite -JournalPath $JournalPath -ExpectedJournalSha256 $ExpectedJournalSha256
        $journal = $read.Journal
        $current = @((Get-EasyFireMigrationMember -Object $journal.PreservationSet -Name $Category -Required))
        $updated = @(Get-EasyFireMigrationOrderedStrings -Values (@($current) + @($Identity)))
        if ($updated.Count -eq $current.Count -and
            @(Compare-Object $current $updated -CaseSensitive -SyncWindow 0).Count -eq 0) {
            return [pscustomobject]@{ Journal=$journal; Sha256=$read.Sha256; Path=$read.Path; Reused=$true }
        }
        $before = $journal | ConvertTo-Json -Depth 50 | ConvertFrom-Json
        Set-EasyFireMigrationMember -Object $journal.PreservationSet -Name $Category -Value $updated
        Set-EasyFireMigrationMember -Object $journal -Name 'Revision' -Value ([int]$journal.Revision + 1)
        Set-EasyFireMigrationMember -Object $journal -Name 'UpdatedAtUtc' -Value (Get-EasyFireMigrationUtcNow)
        $null = Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $journal
        $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $read.Path -Value $journal -ExpectedSha256 $read.Sha256 -AuthorityRoot $journal.AuthorityRoot
        return [pscustomobject]@{ Journal=$journal; Sha256=$sha256; Path=$read.Path; Reused=$false }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Get-OrCreate-EasyFireMigrationOperation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Z][A-Za-z0-9]{0,63}$')][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet('Rehearsal', 'Cutover', 'Global')][string]$Lane
    )

    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $JournalPath
    try {
        $read = Get-EasyFireMigrationJournalForWrite -JournalPath $JournalPath -ExpectedJournalSha256 $ExpectedJournalSha256
        $journal = $read.Journal
        $matches = @($journal.Operations | Where-Object { [string]$_.Name -ceq $Name })
        if ($matches.Count -gt 1) { throw "Duplicate operation name in migration journal: $Name" }
        if ($matches.Count -eq 1) {
            if ([string]$matches[0].Lane -cne $Lane) { throw "Operation lane changed for: $Name" }
            return [pscustomobject]@{ Journal=$journal; Operation=$matches[0]; Sha256=$read.Sha256; Path=$read.Path; Reused=$true }
        }
        $before = $journal | ConvertTo-Json -Depth 50 | ConvertFrom-Json
        $now = Get-EasyFireMigrationUtcNow
        $operation = [pscustomobject][ordered]@{
            SchemaVersion = 1
            Name = $Name
            Lane = $Lane
            OperationId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
            State = 'Planned'
            CreatedAtUtc = $now
            UpdatedAtUtc = $now
        }
        Set-EasyFireMigrationMember -Object $journal -Name 'Operations' -Value (@($journal.Operations) + @($operation))
        Set-EasyFireMigrationMember -Object $journal -Name 'Revision' -Value ([int]$journal.Revision + 1)
        Set-EasyFireMigrationMember -Object $journal -Name 'UpdatedAtUtc' -Value $now
        $null = Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $journal
        $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $read.Path -Value $journal -ExpectedSha256 $read.Sha256 -AuthorityRoot $journal.AuthorityRoot
        return [pscustomobject]@{ Journal=$journal; Operation=$operation; Sha256=$sha256; Path=$read.Path; Reused=$false }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Set-EasyFireMigrationOperationState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)][ValidateSet('Authorized', 'Started', 'Completed', 'Failed')][string]$ToState
    )

    $operationId = ConvertTo-EasyFireCanonicalOperationId -OperationId $OperationId
    $allowed = @{
        Planned = @('Authorized', 'Failed')
        Authorized = @('Started', 'Failed')
        Started = @('Completed', 'Failed')
        Completed = @()
        Failed = @()
    }
    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $JournalPath
    try {
        $read = Get-EasyFireMigrationJournalForWrite -JournalPath $JournalPath -ExpectedJournalSha256 $ExpectedJournalSha256
        $journal = $read.Journal
        $matches = @($journal.Operations | Where-Object { [string]$_.OperationId -ceq $operationId })
        if ($matches.Count -ne 1) { throw 'Operation state update requires one exact operation.' }
        $operation = $matches[0]
        if ([string]$operation.State -ceq $ToState) {
            return [pscustomobject]@{ Journal=$journal; Operation=$operation; Sha256=$read.Sha256; Path=$read.Path; Reused=$true }
        }
        if ($ToState -cnotin @($allowed[[string]$operation.State])) {
            throw "Operation transition is not allowed: $($operation.State) -> $ToState"
        }
        $before = $journal | ConvertTo-Json -Depth 50 | ConvertFrom-Json
        Set-EasyFireMigrationMember -Object $operation -Name 'State' -Value $ToState
        Set-EasyFireMigrationMember -Object $operation -Name 'UpdatedAtUtc' -Value (Get-EasyFireMigrationUtcNow)
        Set-EasyFireMigrationMember -Object $journal -Name 'Revision' -Value ([int]$journal.Revision + 1)
        Set-EasyFireMigrationMember -Object $journal -Name 'UpdatedAtUtc' -Value (Get-EasyFireMigrationUtcNow)
        $null = Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $journal
        $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $read.Path -Value $journal -ExpectedSha256 $read.Sha256 -AuthorityRoot $journal.AuthorityRoot
        return [pscustomobject]@{ Journal=$journal; Operation=$operation; Sha256=$sha256; Path=$read.Path; Reused=$false }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Write-EasyFireMigrationReceipt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$AuthorityRoot,
        [Parameter(Mandatory = $true)][string]$MigrationId,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-F0-9]{64}$')][string]$AuthorityFingerprint,
        [Parameter(Mandatory = $true)][ValidateSet('Rehearsal', 'Cutover', 'Global')][string]$Lane,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Z][A-Za-z0-9]{0,63}$')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)]$Evidence
    )

    $root = Get-EasyFireMigrationCanonicalRoot -AuthorityRoot $AuthorityRoot
    $canonical = ConvertTo-EasyFireCanonicalMigrationId -MigrationId $MigrationId
    $operation = ConvertTo-EasyFireCanonicalOperationId -OperationId $OperationId
    $journalPath = Get-EasyFireMigrationJournalPath -AuthorityRoot $root -MigrationId $canonical
    $receiptRoot = Join-Path ([IO.Path]::GetDirectoryName($journalPath)) 'receipts'
    $receiptPath = Resolve-EasyFireContainedPath -Path (
        Join-Path $receiptRoot "$($Kind.ToLowerInvariant())-$operation.json"
    ) -AllowedRoot $root
    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $receiptPath
    try {
        if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
            $sha256 = Get-EasyFireMigrationFileSha256 -Path $receiptPath
            try { $existing = Get-Content -LiteralPath $receiptPath -Raw -Encoding utf8 | ConvertFrom-Json }
            catch { throw 'Existing migration receipt is not valid JSON.' }
            if ([string]$existing.MigrationId -cne $canonical -or
                [string]$existing.AuthorityFingerprint -cne $AuthorityFingerprint -or
                [string]$existing.Lane -cne $Lane -or
                [string]$existing.Kind -cne $Kind -or
                [string]$existing.OperationId -cne $operation -or
                (($existing.Evidence | ConvertTo-Json -Depth 30 -Compress) -cne
                    ($Evidence | ConvertTo-Json -Depth 30 -Compress))) {
                throw 'Existing migration receipt does not match retry authority.'
            }
        } else {
            $document = [pscustomobject][ordered]@{
                SchemaVersion = 1
                MigrationId = $canonical
                AuthorityFingerprint = $AuthorityFingerprint
                Lane = $Lane
                Kind = $Kind
                OperationId = $operation
                Passed = $true
                Evidence = $Evidence
                RecordedAtUtc = Get-EasyFireMigrationUtcNow
            }
            $sha256 = Write-EasyFireMigrationJsonAtomic -Path $receiptPath -Value $document -ExpectedSha256 'ABSENT' -AuthorityRoot $root
        }
        $binding = [pscustomobject][ordered]@{
            SchemaVersion = 1
            MigrationId = $canonical
            AuthorityFingerprint = $AuthorityFingerprint
            Lane = $Lane
            Kind = $Kind
            OperationId = $operation
            Path = $receiptPath
            Sha256 = $sha256
        }
        $null = Assert-EasyFireMigrationReceiptBinding -Binding $binding -ExpectedMigrationId $canonical -ExpectedAuthorityFingerprint $AuthorityFingerprint
        return $binding
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Save-EasyFireMigrationJournalTransition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256,
        [Parameter(Mandatory = $true)][string]$ToState,
        [Parameter(Mandatory = $true)][string]$ToPhase,
        $ReceiptBinding,
        [ValidateSet('InitialSource', 'FinalSource', 'MigrationBaseline', 'MigrationEmergency', 'MigrationScheduled')]
        [string]$BackupReceiptRole,
        $BackupReceipt,
        $CompletedAuthority
    )

    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $JournalPath
    try {
        $read = Get-EasyFireMigrationJournalForWrite -JournalPath $JournalPath -ExpectedJournalSha256 $ExpectedJournalSha256
        $journal = $read.Journal
        $fromState = [string]$journal.CurrentState
        $fromPhase = [string]$journal.Phase
        $hasBackupRole = -not [string]::IsNullOrWhiteSpace($BackupReceiptRole)
        $hasBackupReceipt = $null -ne $BackupReceipt
        if ($hasBackupRole -ne $hasBackupReceipt) {
            throw 'BackupReceiptRole and BackupReceipt must be supplied together.'
        }
        if ($hasBackupRole) {
            $existingBackupReceipt = Get-EasyFireMigrationMember -Object $journal.BackupReceipts -Name $BackupReceiptRole
            $null = Assert-EasyFireMigrationBackupReceiptRecord -Record $BackupReceipt `
                -ExistingRecord $existingBackupReceipt -Role $BackupReceiptRole
        }
        if (-not (Test-EasyFireMigrationTransitionAllowed -FromState $fromState -FromPhase $fromPhase -ToState $ToState -ToPhase $ToPhase)) {
            throw "Migration journal transition is not allowed: $fromState|$fromPhase -> $ToState|$ToPhase"
        }
        $targetKey = Get-EasyFireMigrationStateKey -State $ToState -Phase $ToPhase
        $requiredReceiptKind = if ($script:RequiredReceiptKinds.ContainsKey($targetKey)) {
            [string]$script:RequiredReceiptKinds[$targetKey]
        } else { '' }
        if ($requiredReceiptKind -and $null -eq $ReceiptBinding) {
            throw "Migration transition requires receipt kind: $requiredReceiptKind"
        }
        if ($null -ne $ReceiptBinding) {
            $null = Assert-EasyFireMigrationReceiptBinding -Binding $ReceiptBinding -ExpectedMigrationId $journal.MigrationId -ExpectedAuthorityFingerprint $journal.Authority.Fingerprint
            if ($requiredReceiptKind -and [string]$ReceiptBinding.Kind -cne $requiredReceiptKind) {
                throw "Migration transition requires receipt kind: $requiredReceiptKind"
            }
            $operation = @($journal.Operations | Where-Object {
                    [string]$_.OperationId -ceq [string]$ReceiptBinding.OperationId -and
                    [string]$_.Name -ceq [string]$ReceiptBinding.Kind -and
                    [string]$_.Lane -ceq [string]$ReceiptBinding.Lane
                })
            if ($operation.Count -ne 1) { throw 'Transition receipt is not bound to one exact operation.' }
        }
        if ($ToState -ceq 'Completed') {
            if ($null -eq $CompletedAuthority) { throw 'Completion requires exact CompletedAuthority.' }
        } elseif ($null -ne $CompletedAuthority) {
            throw 'CompletedAuthority can be supplied only for completion.'
        }

        $before = $journal | ConvertTo-Json -Depth 50 | ConvertFrom-Json
        if ($hasBackupRole) {
            Set-EasyFireMigrationMember -Object $journal.BackupReceipts -Name $BackupReceiptRole -Value $BackupReceipt
        }
        $sequence = @($journal.Transitions).Count + 1
        $now = Get-EasyFireMigrationUtcNow
        $transition = [pscustomobject][ordered]@{
            Sequence = $sequence
            FromState = $fromState
            FromPhase = $fromPhase
            ToState = $ToState
            ToPhase = $ToPhase
            AtUtc = $now
            ReceiptSha256 = if ($null -ne $ReceiptBinding) { [string]$ReceiptBinding.Sha256 } else { '' }
        }
        Set-EasyFireMigrationMember -Object $journal -Name 'CurrentState' -Value $ToState
        Set-EasyFireMigrationMember -Object $journal -Name 'Phase' -Value $ToPhase
        Set-EasyFireMigrationMember -Object $journal -Name 'Transitions' -Value (@($journal.Transitions) + @($transition))
        if ($null -ne $ReceiptBinding) {
            Set-EasyFireMigrationMember -Object $journal -Name 'Receipts' -Value (@($journal.Receipts) + @($ReceiptBinding))
            if ([string]$ReceiptBinding.Kind -ceq 'NativeAuthentication') {
                Set-EasyFireMigrationMember -Object $journal -Name 'AuthenticationReceipt' -Value $ReceiptBinding
            }
        }
        if ($ToState -ceq 'Completed') {
            Set-EasyFireMigrationMember -Object $journal -Name 'CompletedAuthority' -Value $CompletedAuthority
        }
        Set-EasyFireMigrationMember -Object $journal -Name 'Revision' -Value ([int]$journal.Revision + 1)
        Set-EasyFireMigrationMember -Object $journal -Name 'UpdatedAtUtc' -Value $now
        $transitionRoot = Join-Path ([IO.Path]::GetDirectoryName($read.Path)) 'transitions'
        $snapshotName = 'transition-{0:D4}-{1}-{2}.json' -f $sequence, $ToState, $ToPhase
        $snapshotPath = Join-Path $transitionRoot $snapshotName
        $journalIdentities = @(Get-EasyFireMigrationOrderedStrings -Values (@($journal.PreservationSet.Journals) + @($snapshotPath)))
        Set-EasyFireMigrationMember -Object $journal.PreservationSet -Name 'Journals' -Value $journalIdentities
        $null = Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $journal
        $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal

        if (Test-Path -LiteralPath $snapshotPath -PathType Leaf) {
            try { $snapshot = Get-Content -LiteralPath $snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json }
            catch { throw 'Migration transition snapshot is not valid JSON.' }
            $null = Assert-EasyFireMigrationJournalAuthority -Journal $snapshot -ExpectedMigrationId $journal.MigrationId -ExpectedAuthorityFingerprint $journal.Authority.Fingerprint
            $last = @($snapshot.Transitions)[-1]
            if ([int]$last.Sequence -ne $sequence -or
                [string]$last.FromState -cne $fromState -or [string]$last.FromPhase -cne $fromPhase -or
                [string]$last.ToState -cne $ToState -or [string]$last.ToPhase -cne $ToPhase -or
                [string]$last.ReceiptSha256 -cne [string]$transition.ReceiptSha256) {
                throw 'Existing transition snapshot does not match crash-recovery authority.'
            }
            if ($hasBackupRole) {
                $snapshotBackupReceipt = Get-EasyFireMigrationMember -Object $snapshot.BackupReceipts -Name $BackupReceiptRole
                if ($null -eq $snapshotBackupReceipt -or
                    (Get-EasyFireMigrationJsonSha256 -Value $snapshotBackupReceipt) -cne
                        (Get-EasyFireMigrationJsonSha256 -Value $BackupReceipt)) {
                    throw 'Existing transition snapshot does not match backup-receipt authority.'
                }
            }
            $journal = $snapshot
        } else {
            $null = Write-EasyFireMigrationJsonAtomic -Path $snapshotPath -Value $journal -ExpectedSha256 'ABSENT' -AuthorityRoot $journal.AuthorityRoot
        }
        $currentSha256 = Get-EasyFireMigrationFileSha256 -Path $read.Path
        if ($currentSha256 -cne $read.Sha256) {
            throw 'Migration journal changed after transition snapshot publication.'
        }
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $read.Path -Value $journal -ExpectedSha256 $read.Sha256 -AuthorityRoot $journal.AuthorityRoot
        return [pscustomobject]@{
            Journal = $journal
            Sha256 = $sha256
            Path = $read.Path
            TransitionSnapshotPath = $snapshotPath
        }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Save-EasyFireMigrationBackupPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256,
        [Parameter(Mandatory = $true)]
        [ValidateSet('InitialSource', 'FinalSource', 'MigrationBaseline', 'MigrationEmergency')]
        [string]$BackupReceiptRole,
        [Parameter(Mandatory = $true)]$Plan
    )

    $null = Get-EasyFireMigrationBackupPlanOperationId -Plan $Plan
    if ([string](Get-EasyFireMigrationMember -Object $Plan -Name 'State' -Required) -cne 'active') {
        throw 'Pre-mutation migration backup plan must be active.'
    }
    $record = [pscustomobject][ordered]@{
        Plan = $Plan
        RecoveryUnit = $null
        RestoreReceipt = $null
    }
    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $JournalPath
    try {
        $read = Get-EasyFireMigrationJournalForWrite -JournalPath $JournalPath `
            -ExpectedJournalSha256 $ExpectedJournalSha256
        $journal = $read.Journal
        $currentKey = Get-EasyFireMigrationStateKey -State ([string]$journal.CurrentState) `
            -Phase ([string]$journal.Phase)
        if ([string]$script:BackupPlanAuthority[$BackupReceiptRole] -cne $currentKey) {
            throw "Backup plan role $BackupReceiptRole is not authorized at $currentKey."
        }
        $existing = Get-EasyFireMigrationMember -Object $journal.BackupReceipts `
            -Name $BackupReceiptRole
        if ($null -ne $existing -and
            ($null -ne (Get-EasyFireMigrationMember -Object $existing -Name 'RecoveryUnit') -or
             $null -ne (Get-EasyFireMigrationMember -Object $existing -Name 'RestoreReceipt'))) {
            throw "BackupReceipts.$BackupReceiptRole already contains post-plan recovery authority."
        }
        $null = Assert-EasyFireMigrationBackupReceiptRecord -Record $record `
            -ExistingRecord $existing -Role $BackupReceiptRole
        if ($null -ne $existing -and
            (Get-EasyFireMigrationJsonSha256 -Value $existing) -ceq
                (Get-EasyFireMigrationJsonSha256 -Value $record)) {
            return [pscustomobject]@{
                Journal = $journal
                Sha256 = $read.Sha256
                Path = $read.Path
                Reused = $true
            }
        }

        $before = $journal | ConvertTo-Json -Depth 50 | ConvertFrom-Json
        Set-EasyFireMigrationMember -Object $journal.BackupReceipts `
            -Name $BackupReceiptRole -Value $record
        Set-EasyFireMigrationMember -Object $journal -Name 'Revision' `
            -Value ([int]$journal.Revision + 1)
        Set-EasyFireMigrationMember -Object $journal -Name 'UpdatedAtUtc' `
            -Value (Get-EasyFireMigrationUtcNow)
        $null = Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $journal
        $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $read.Path -Value $journal `
            -ExpectedSha256 $read.Sha256 -AuthorityRoot $journal.AuthorityRoot
        return [pscustomobject]@{
            Journal = $journal
            Sha256 = $sha256
            Path = $read.Path
            Reused = $false
        }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

function Save-EasyFireMigrationScheduledBackupReceipt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$JournalPath,
        [Parameter(Mandatory = $true)][string]$ExpectedJournalSha256,
        [Parameter(Mandatory = $true)]$BackupReceipt
    )

    $mutex = Enter-EasyFireMigrationJournalMutex -JournalPath $JournalPath
    try {
        $read = Get-EasyFireMigrationJournalForWrite -JournalPath $JournalPath `
            -ExpectedJournalSha256 $ExpectedJournalSha256
        $journal = $read.Journal
        if ([string]$journal.CurrentState -cne 'Completed' -or
            [string]$journal.Phase -cne 'Completed') {
            throw 'Scheduled backup receipt publication requires quiescent Completed|Completed authority.'
        }
        $existing = Get-EasyFireMigrationMember -Object $journal.BackupReceipts `
            -Name 'MigrationScheduled'
        $null = Assert-EasyFireMigrationBackupReceiptRecord -Record $BackupReceipt `
            -ExistingRecord $existing -Role 'MigrationScheduled'
        if ($null -ne $existing -and
            (Get-EasyFireMigrationJsonSha256 -Value $existing) -ceq
                (Get-EasyFireMigrationJsonSha256 -Value $BackupReceipt)) {
            return [pscustomobject]@{
                Journal = $journal
                Sha256 = $read.Sha256
                Path = $read.Path
                Reused = $true
            }
        }

        $before = $journal | ConvertTo-Json -Depth 50 | ConvertFrom-Json
        Set-EasyFireMigrationMember -Object $journal.BackupReceipts `
            -Name 'MigrationScheduled' -Value $BackupReceipt
        Set-EasyFireMigrationMember -Object $journal -Name 'Revision' `
            -Value ([int]$journal.Revision + 1)
        Set-EasyFireMigrationMember -Object $journal -Name 'UpdatedAtUtc' `
            -Value (Get-EasyFireMigrationUtcNow)
        $null = Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $journal
        $null = Assert-EasyFireMigrationJournalAuthority -Journal $journal
        $sha256 = Write-EasyFireMigrationJsonAtomic -Path $read.Path -Value $journal `
            -ExpectedSha256 $read.Sha256 -AuthorityRoot $journal.AuthorityRoot
        return [pscustomobject]@{
            Journal = $journal
            Sha256 = $sha256
            Path = $read.Path
            Reused = $false
        }
    } finally {
        Exit-EasyFireMigrationJournalMutex -Mutex $mutex
    }
}

Export-ModuleMember -Function @(
    'New-EasyFireMigrationLaneIdentity',
    'Get-EasyFireMigrationJournalPath',
    'New-EasyFireMigrationJournal',
    'Initialize-EasyFireMigrationJournal',
    'Read-EasyFireMigrationJournal',
    'Save-EasyFireMigrationJournalTransition',
    'Save-EasyFireMigrationBackupPlan',
    'Save-EasyFireMigrationScheduledBackupReceipt',
    'Add-EasyFireMigrationPreservedResource',
    'Assert-EasyFireMigrationJournalAuthority',
    'Assert-EasyFireMigrationPreservationMonotonic',
    'Get-OrCreate-EasyFireMigrationOperation',
    'Set-EasyFireMigrationOperationState',
    'Write-EasyFireMigrationReceipt',
    'Assert-EasyFireMigrationReceiptBinding',
    'Get-EasyFireMigrationFileSha256'
)
