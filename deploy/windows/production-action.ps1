# EasyFire Bookkeeping production controller.
# FRESH_INSTALL_ONLY: an existing database volume always requires a separate migration action.
# VERIFY_ONLY_EDGE: Cloudflare, DNS, Access, tunnel, binary, and service state are never mutated.
# The only rollback removals are exact ActionId-created scheduled tasks and Compose containers/network.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Preflight', 'Action', 'Postcheck', 'ScheduledBackup', 'Rollback')]
    [string]$Stage,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseArchive,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedArchiveSha256,

    [Parameter(Mandatory = $true)]
    [string]$ProductionRoot,

    [Parameter(Mandatory = $true)]
    [string]$CloudflareCredentialFile,

    [Parameter(Mandatory = $true)]
    [string]$ActionId,

    [string]$ConfirmActionId,
    [string]$PriorActionId,
    [string]$TargetImageTag,
    [string]$AuthorityOwnerSid
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Import-Module (Join-Path $PSScriptRoot 'production-io.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'production-state.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot '..\..\scripts\production\backup-integrity.psm1') -Force -ErrorAction Stop

$script:ProjectName = 'easyfire-bookkeeping-prod'
$script:Domain = 'bookkeeping.easyfire.fyi'
$script:TaskBackupName = 'easyfire-bookkeeping-prod-backup'
$script:RetiredTaskNames = @('easyfire-bookkeeping-prod-startup')
$script:LegacyVolumeNames = @('bigcapital_prod_mysql', 'bigcapital_prod_redis')
$script:AllServices = @('mysql', 'redis', 'database_migration', 'server', 'webapp', 'envoy', 'gotenberg')
$script:RuntimeServices = @('mysql', 'redis', 'server', 'webapp', 'envoy', 'gotenberg')
$script:ServiceNames = @{
    mysql = 'easyfire-mysql'
    redis = 'easyfire-redis'
    database_migration = 'easyfire-database-migration'
    server = 'easyfire-server'
    webapp = 'easyfire-webapp'
    envoy = 'easyfire-proxy'
    gotenberg = 'easyfire-gotenberg'
}
$script:PhaseOrder = @(
    'initialized',
    'extracting',
    'extracted',
    'env_writing',
    'env_written',
    'images_building',
    'images_built',
    'data_tier_starting',
    'data_tier_ready',
    'migration_preparing',
    'migration_running',
    'migration_complete',
    'baseline_backup_running',
    'baseline_backup_ready',
    'app_tier_starting',
    'app_tier_ready',
    'tasks_registering',
    'action_completed_pending_postcheck',
    'completed'
)
$script:AllowedTransitions = @{
    initialized = @('initialized', 'extracting', 'rollback_in_progress')
    extracting = @('extracting', 'extracted', 'rollback_in_progress')
    extracted = @('extracted', 'env_writing', 'rollback_in_progress')
    env_writing = @('env_writing', 'env_written', 'rollback_in_progress')
    env_written = @('env_written', 'images_building', 'rollback_in_progress')
    images_building = @('images_building', 'images_built', 'rollback_in_progress')
    images_built = @('images_built', 'data_tier_starting', 'rollback_in_progress')
    data_tier_starting = @('data_tier_starting', 'data_tier_ready', 'rollback_in_progress')
    data_tier_ready = @('data_tier_ready', 'migration_preparing', 'rollback_in_progress')
    migration_preparing = @('migration_preparing', 'migration_running', 'rollback_in_progress')
    migration_running = @('migration_running', 'migration_complete', 'rollback_in_progress')
    migration_complete = @('migration_complete', 'baseline_backup_running', 'rollback_in_progress')
    baseline_backup_running = @('baseline_backup_running', 'baseline_backup_ready', 'rollback_in_progress')
    baseline_backup_ready = @('baseline_backup_ready', 'app_tier_starting', 'rollback_in_progress')
    app_tier_starting = @('app_tier_starting', 'app_tier_ready', 'rollback_in_progress')
    app_tier_ready = @('app_tier_ready', 'tasks_registering', 'rollback_in_progress')
    tasks_registering = @('tasks_registering', 'action_completed_pending_postcheck', 'rollback_in_progress')
    action_completed_pending_postcheck = @('action_completed_pending_postcheck', 'completed', 'rollback_in_progress')
    completed = @('completed', 'rollback_in_progress')
    rollback_in_progress = @('rollback_in_progress', 'rolled_back')
    rolled_back = @('rolled_back')
}

function Set-EasyFireProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value -Force
}

function Get-EasyFireProperty {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Get-EasyFireUtcNow {
    return (Get-Date).ToUniversalTime().ToString('o')
}

function Assert-EasyFireAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Production stages require an elevated Administrator shell.'
        }
    } finally {
        $identity.Dispose()
    }
}

function Get-EasyFireAllowedSids {
    if (-not $script:AuthorityOwnerSid) {
        throw 'Authority owner SID has not been bound to this controller invocation.'
    }
    return @(
        'S-1-5-18',
        'S-1-5-32-544',
        $script:AuthorityOwnerSid
    ) | Sort-Object -Unique
}

function ConvertTo-EasyFireCanonicalAuthorityOwnerSid {
    param([Parameter(Mandatory = $true)][string]$Value)

    try {
        $sid = New-Object Security.Principal.SecurityIdentifier($Value)
    } catch {
        throw 'AuthorityOwnerSid must be one valid Windows security identifier.'
    }
    $canonical = [string]$sid.Value
    if ($Value -cne $canonical) {
        throw "AuthorityOwnerSid must use canonical SID form: $canonical"
    }
    return $canonical
}

function Protect-EasyFireAuthorityDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        [IO.Directory]::CreateDirectory($Path) | Out-Null
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Authority path is not a directory: $Path"
    }
    if (Test-EasyFireReparsePoint -Path $Path) {
        throw "Authority directory cannot be a reparse point: $Path"
    }
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        $null = $acl.RemoveAccessRuleAll($rule)
    }
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    foreach ($sidText in Get-EasyFireAllowedSids) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $acl.SetOwner($identity.User) }
    finally { $identity.Dispose() }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Assert-EasyFireAuthorityTree {
    param([Parameter(Mandatory = $true)][string]$Path)

    $allowed = @{}
    foreach ($sid in Get-EasyFireAllowedSids) { $allowed[$sid] = $true }
    $items = @((Get-Item -LiteralPath $Path -Force)) + @(Get-ChildItem -LiteralPath $Path -Recurse -Force)
    foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Authority tree contains a reparse point: $($item.FullName)"
        }
        $acl = Get-Acl -LiteralPath $item.FullName
        $ownerSid = $acl.Owner
        try {
            $ownerSid = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate(
                [Security.Principal.SecurityIdentifier]
            ).Value
        } catch {
            $ownerSid = [string]$acl.Owner
        }
        if (-not $allowed.ContainsKey([string]$ownerSid)) {
            throw "Authority tree has an unapproved owner: $($item.FullName)"
        }
        foreach ($rule in @($acl.Access)) {
            try {
                $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            } catch {
                throw "Authority ACL identity cannot be resolved: $($item.FullName)"
            }
            if (-not $allowed.ContainsKey([string]$sid)) {
                throw "Authority tree grants access outside the approved principals: $($item.FullName)"
            }
        }
    }
}

function Assert-EasyFireAuthorityPathChain {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$TrustedRoot
    )
    $target = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $TrustedRoot -MustExist
    $root = Resolve-EasyFireContainedPath -Path $TrustedRoot -AllowedRoot $TrustedRoot -MustExist
    $null = Assert-EasyFireNoReparsePathChain -Path $target -TrustedRoot $root
    $allowed = @{}
    foreach ($sid in Get-EasyFireAllowedSids) { $allowed[$sid] = $true }
    $relative = $target.Substring($root.Length).TrimStart('\')
    $paths = @($root)
    $cursor = $root
    foreach ($segment in @($relative.Split('\') | Where-Object { $_ })) {
        $cursor = Join-Path $cursor $segment
        $paths += $cursor
    }
    $writeRights = [Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::Modify -bor
        [Security.AccessControl.FileSystemRights]::FullControl -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($itemPath in $paths) {
        $item = Get-Item -LiteralPath $itemPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Credential authority chain contains a reparse point: $itemPath"
        }
        $acl = Get-Acl -LiteralPath $itemPath
        try {
            $ownerSid = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate(
                [Security.Principal.SecurityIdentifier]
            ).Value
        } catch { $ownerSid = [string]$acl.Owner }
        if (-not $allowed.ContainsKey([string]$ownerSid)) {
            throw "Credential authority chain has an unapproved owner: $itemPath"
        }
        foreach ($rule in @($acl.Access | Where-Object {
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
        })) {
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if (-not $allowed.ContainsKey([string]$sid) -and
                (($rule.FileSystemRights -band $writeRights) -ne 0)) {
                throw "Credential authority chain grants replacement authority outside approved principals: $itemPath"
            }
        }
    }
    return $target
}

function Get-EasyFireCredentialSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    $exactPath = Join-Path $script:ResolvedProductionRoot 'credentials\cloudflare.json'
    $resolved = Assert-EasyFireAuthorityPathChain -Path $Path -TrustedRoot $script:ResolvedProductionRoot
    if ($resolved -cne $exactPath -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Cloudflare credential must be the exact protected file: $exactPath"
    }
    $stream = [IO.File]::Open(
        $resolved,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    try {
        if ($stream.Length -le 0 -or $stream.Length -gt 1048576) {
            throw 'Cloudflare credential size is invalid.'
        }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($read -le 0) { throw 'Cloudflare credential read ended unexpectedly.' }
            $offset += $read
        }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
        finally { $sha.Dispose() }
        $encoding = New-Object Text.UTF8Encoding($false, $true)
        $credential = $encoding.GetString($bytes) | ConvertFrom-Json
        if (-not $credential) { throw 'Cloudflare credential file is empty or invalid.' }
        return [pscustomobject]@{ Path = $resolved; Sha256 = $hash; Credential = $credential }
    } finally {
        $stream.Dispose()
    }
}

function Protect-EasyFireSecretFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        $null = $acl.RemoveAccessRuleAll($rule)
    }
    foreach ($sidText in Get-EasyFireAllowedSids) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    $allowed = @{}
    foreach ($sidText in Get-EasyFireAllowedSids) { $allowed[$sidText] = $true }
    $verified = Get-Acl -LiteralPath $Path
    foreach ($rule in @($verified.Access)) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if (-not $allowed.ContainsKey([string]$sid)) {
            throw 'Secret file ACL includes an unapproved principal.'
        }
    }
}

function Get-EasyFireFileAuthorityHash {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 'ABSENT' }
    return Get-EasyFireSha256Hex -Path $Path
}

function Assert-EasyFireTransition {
    param([string]$From, [string]$To)
    if (-not $script:AllowedTransitions.ContainsKey($From) -or $To -notin $script:AllowedTransitions[$From]) {
        throw "Journal transition is not allowed: $From -> $To"
    }
}

function Read-EasyFireTrackedJournal {
    $before = Get-EasyFireFileAuthorityHash -Path $script:JournalPath
    if ($before -eq 'ABSENT') {
        $script:JournalAuthorityHash = 'ABSENT'
        return $null
    }
    $journal = Read-EasyFireJson -Path $script:JournalPath -AllowedRoot $script:JournalsRoot
    $after = Get-EasyFireFileAuthorityHash -Path $script:JournalPath
    if ($before -cne $after) { throw 'Journal changed while it was being read.' }
    $script:JournalAuthorityHash = $after
    return $journal
}

function Write-EasyFireTrackedJournal {
    param([Parameter(Mandatory = $true)]$Journal)
    $current = Get-EasyFireFileAuthorityHash -Path $script:JournalPath
    if ($current -cne $script:JournalAuthorityHash) {
        throw 'Journal compare-and-swap authority changed; refusing overwrite.'
    }
    Set-EasyFireProperty -Object $Journal -Name 'UpdatedAtUtc' -Value (Get-EasyFireUtcNow)
    $null = Write-EasyFireJsonAtomic -Path $script:JournalPath -Value $Journal -AllowedRoot $script:JournalsRoot
    $script:JournalAuthorityHash = Get-EasyFireFileAuthorityHash -Path $script:JournalPath
}

function Set-EasyFireJournalStatus {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$Status,
        $Inventory = $null
    )
    $currentStatus = [string](Get-EasyFireProperty -Object $Journal -Name 'status' -Default '')
    Assert-EasyFireTransition -From $currentStatus -To $Status
    Set-EasyFireProperty -Object $Journal -Name 'status' -Value $Status
    if ($null -ne $Inventory) {
        Set-EasyFireProperty -Object $Journal -Name 'PhaseInventory' -Value $Inventory
        Set-EasyFireProperty -Object $Journal -Name 'PhaseInventoryFingerprint' -Value (
            Get-EasyFireInventoryFingerprint -Inventory $Inventory
        )
    }
    Write-EasyFireTrackedJournal -Journal $Journal
}

function Test-EasyFireAtOrAfter {
    param([string]$Current, [string]$Target)
    $currentIndex = [Array]::IndexOf($script:PhaseOrder, $Current)
    $targetIndex = [Array]::IndexOf($script:PhaseOrder, $Target)
    return ($currentIndex -ge 0 -and $targetIndex -ge 0 -and $currentIndex -ge $targetIndex)
}

function Get-EasyFireZipManifest {
    param([Parameter(Mandatory = $true)][string]$ArchivePath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = New-Object 'System.Collections.Generic.List[object]'
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $count = 0
        [int64]$expanded = 0
        foreach ($entry in $archive.Entries) {
            $count++
            if ($count -gt 25000) { throw 'Release archive contains too many entries.' }
            $name = $entry.FullName.Replace('\', '/')
            $segments = @($name.Split('/') | Where-Object { $_ })
            $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            $directory = $name.EndsWith('/')
            if (-not $name -or [IO.Path]::IsPathRooted($name) -or $name -match ':' -or
                $segments -contains '..' -or $unixType -eq 0xA000) {
                throw 'Release archive contains an unsafe entry.'
            }
            $relative = $name.TrimEnd('/')
            if (-not $relative) { continue }
            if (-not $seen.Add($relative)) { throw 'Release archive has duplicate or case-colliding entries.' }
            if ($relative -ieq '.env') { throw 'Release archive must not contain a runtime .env file.' }
            if ($directory) { continue }
            if ([int64]$entry.Length -gt 536870912) { throw 'Release archive entry exceeds the size limit.' }
            $expanded += [int64]$entry.Length
            if ($expanded -gt 2147483648) { throw 'Release archive exceeds the expanded-size limit.' }
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
            finally { $sha.Dispose(); $stream.Dispose() }
            $entries.Add([pscustomobject]@{ Path = $relative; Length = [int64]$entry.Length; Sha256 = $hash })
        }
        $entries = @($entries | Sort-Object Path)
        $canonical = ($entries | ForEach-Object { "$($_.Sha256)  $($_.Length)  $($_.Path)" }) -join [char]10
        $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $manifestHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
        finally { $sha.Dispose() }
        return [pscustomobject]@{
            SchemaVersion = 1
            FileCount = $entries.Count
            Sha256 = $manifestHash
        }
    } finally {
        $archive.Dispose()
    }
}

function Get-EasyFireInventory {
    return Get-EasyFireComposeInventory -ProjectName $script:ProjectName -ExactVolumeNames @(
        $script:ExpectedMysqlVolume,
        $script:ExpectedRedisVolume
    ) -LegacyVolumeNames $script:LegacyVolumeNames
}

function Get-EasyFireBuiltImageReferences {
    return @(
        "easyfire-bookkeeping/mariadb:$($script:MariaDbImageTag)",
        "easyfire-bookkeeping/redis:$($script:TargetTag)",
        "easyfire-bookkeeping/migration:$($script:TargetTag)",
        "easyfire-bookkeeping/server:$($script:TargetTag)",
        "easyfire-bookkeeping/webapp:$($script:TargetTag)"
    )
}

function Assert-EasyFireBuiltImageTagsAbsent {
    foreach ($reference in @(Get-EasyFireBuiltImageReferences)) {
        $inspect = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('image', 'inspect', $reference) -AllowFailure
        if ($inspect.ExitCode -eq 0) {
            throw "Fresh image authority refuses an existing release tag: $reference"
        }
        if ($inspect.Text -notmatch '(?i)no such (?:image|object)') {
            throw "Docker could not prove release-tag absence: $reference"
        }
    }
}

function Remove-EasyFireJournalOwnedImageTags {
    param([Parameter(Mandatory = $true)][string[]]$ImageReferences)

    $expected = @(Get-EasyFireBuiltImageReferences)
    if ($ImageReferences.Count -ne $expected.Count -or
        @(Compare-Object @($expected | Sort-Object) @($ImageReferences | Sort-Object) -CaseSensitive).Count -ne 0) {
        throw 'Image cleanup authority does not match the exact release image set.'
    }
    foreach ($reference in $ImageReferences) {
        $inspect = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('image', 'inspect', $reference) -AllowFailure
        if ($inspect.ExitCode -ne 0) {
            if ($inspect.Text -notmatch '(?i)no such (?:image|object)') {
                throw "Docker could not inspect a journal-owned release tag: $reference"
            }
            continue
        }
        $consumers = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'ps', '-a', '--filter', "ancestor=$reference", '--format', '{{.ID}}'
        )).Output | Where-Object { $_ })
        if ($consumers.Count -ne 0) {
            throw "A journal-owned partial image tag has a container consumer: $reference"
        }
        $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('image', 'rm', $reference)
        $after = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('image', 'inspect', $reference) -AllowFailure
        if ($after.ExitCode -eq 0 -or $after.Text -notmatch '(?i)no such (?:image|object)') {
            throw "Docker did not prove removal of a journal-owned partial image tag: $reference"
        }
    }
}

function Assert-EasyFireBuiltImageAuthority {
    param([Parameter(Mandatory = $true)]$Journal)
    $established = Get-EasyFireProperty -Object $Journal -Name 'BuiltImageAuthority'
    if (-not $established) { throw 'Built-image authority is missing.' }
    $observed = Get-EasyFireExpectedImageAuthority -ImageReferences (Get-EasyFireBuiltImageReferences)
    if (-not (Test-EasyFireExpectedImageAuthorityEqual -EstablishedAuthority $established -ObservedAuthority $observed)) {
        throw 'A release image tag was removed, replaced, or rebound.'
    }
}

function Get-EasyFireAllowedServicesForStatus {
    param([string]$Status)
    switch ($Status) {
        'data_tier_starting' { return @('mysql', 'redis') }
        'data_tier_ready' { return @('mysql', 'redis') }
        'migration_preparing' { return @('mysql', 'redis', 'database_migration') }
        'migration_running' { return @('mysql', 'redis', 'database_migration') }
        'migration_complete' { return @('mysql', 'redis', 'database_migration') }
        'baseline_backup_running' { return @('mysql', 'redis', 'database_migration') }
        'baseline_backup_ready' { return @('mysql', 'redis', 'database_migration') }
        'app_tier_starting' { return $script:AllServices }
        'app_tier_ready' { return $script:AllServices }
        'tasks_registering' { return $script:AllServices }
        'action_completed_pending_postcheck' { return $script:AllServices }
        'completed' { return $script:AllServices }
        'rollback_in_progress' { return $script:AllServices }
        default { return @() }
    }
}

function Assert-EasyFireNamedResourceIsolation {
    $expectedNames = @($script:ServiceNames.Values)
    $lines = (Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'ps', '-a', '--format', '{{.ID}}|{{.Names}}|{{.Label "com.docker.compose.project"}}'
    )).Output
    foreach ($line in @($lines)) {
        $parts = ([string]$line).Split('|')
        if ($parts.Count -ne 3) { continue }
        if ($parts[1] -in $expectedNames -and $parts[2] -cne $script:ProjectName) {
            throw "A fixed EasyFire container name is owned by another project: $($parts[1])"
        }
    }

    $networkInspect = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'network', 'inspect', $script:ExpectedNetworkName
    ) -AllowFailure
    if ($networkInspect.ExitCode -eq 0) {
        $parsed = $networkInspect.Text | ConvertFrom-Json
        $network = if ($parsed -is [array]) { $parsed[0] } else { $parsed }
        $labels = Get-EasyFireProperty -Object $network -Name 'Labels'
        $project = [string](Get-EasyFireProperty -Object $labels -Name 'com.docker.compose.project' -Default '')
        if ($project -cne $script:ProjectName) {
            throw 'The fixed EasyFire Compose network name is owned by another project.'
        }
    }
}

function Assert-EasyFireInventoryCompatible {
    param(
        [Parameter(Mandatory = $true)]$Inventory,
        [Parameter(Mandatory = $true)][string]$Status,
        $Journal = $null
    )

    $allowedServices = @(Get-EasyFireAllowedServicesForStatus -Status $Status)
    $services = @($Inventory.Containers | ForEach-Object { [string]$_.Service })
    if (@($services | Sort-Object -Unique).Count -ne $services.Count) {
        throw 'Compose inventory has duplicate service identities.'
    }
    foreach ($service in $services) {
        if ($service -notin $allowedServices) {
            throw "Compose inventory has a service that is not allowed in phase $Status."
        }
    }
    $foreignConsumers = @((Get-EasyFireProperty -Object $Inventory -Name 'ForeignVolumeConsumers' -Default @()))
    if ($foreignConsumers.Count -gt 0) {
        throw 'A foreign container consumes an Action-owned durable volume.'
    }

    $expectedVolumeNames = @($script:ExpectedMysqlVolume, $script:ExpectedRedisVolume) | Sort-Object
    $reservedVolumeNames = @((Get-EasyFireProperty -Object $Inventory -Name 'ReservedVolumeNames' -Default @()) | Sort-Object -Unique)
    $foreignVolumeNames = @($reservedVolumeNames | Where-Object { $_ -notin $expectedVolumeNames })
    if ($foreignVolumeNames.Count -gt 0) {
        throw "DATABASE_ENGINE_MIGRATION_REQUIRED: historical or foreign EasyFire durable volumes exist: $($foreignVolumeNames -join ', ')"
    }
    $dataWasCreated = [bool](Get-EasyFireProperty -Object $Journal -Name 'DataTierCreated' -Default $false)
    $durableVolumePlan = Get-EasyFireProperty -Object $Journal -Name 'DurableVolumePlan'
    $partialDataWasCreated = $durableVolumePlan -and @($durableVolumePlan.ObservedVolumes).Count -gt 0
    $exactVolumesMayExist = $Status -in @(
        'data_tier_starting', 'data_tier_ready', 'migration_preparing', 'migration_running', 'migration_complete',
        'baseline_backup_running', 'baseline_backup_ready', 'app_tier_starting',
        'app_tier_ready', 'tasks_registering', 'action_completed_pending_postcheck', 'completed'
    ) -or ($Status -eq 'rollback_in_progress' -and ($dataWasCreated -or $partialDataWasCreated))
    if (-not $exactVolumesMayExist -and $reservedVolumeNames.Count -gt 0) {
        throw 'DATABASE_ENGINE_MIGRATION_REQUIRED: a fresh action cannot adopt existing durable volumes.'
    }

    $subsetPhases = @('data_tier_starting', 'migration_preparing', 'migration_running', 'app_tier_starting', 'rollback_in_progress')
    if ($Status -notin $subsetPhases) {
        $expected = @()
        switch ($Status) {
            'data_tier_ready' { $expected = @('mysql', 'redis') }
            'migration_complete' { $expected = @('mysql', 'redis', 'database_migration') }
            'baseline_backup_running' { $expected = @('mysql', 'redis', 'database_migration') }
            'baseline_backup_ready' { $expected = @('mysql', 'redis', 'database_migration') }
            'app_tier_ready' { $expected = $script:AllServices }
            'tasks_registering' { $expected = $script:AllServices }
            'action_completed_pending_postcheck' { $expected = $script:AllServices }
            'completed' { $expected = $script:AllServices }
        }
        if (@(Compare-Object @($expected | Sort-Object) @($services | Sort-Object)).Count -ne 0) {
            throw "Compose service set does not match phase $Status."
        }
    } elseif ($Status -in @('migration_preparing', 'migration_running', 'app_tier_starting')) {
        foreach ($required in @('mysql', 'redis')) {
            if ($required -notin $services) { throw "Phase $Status is missing required service $required." }
        }
    }

    $expectedImageReferences = @{
        mysql = "easyfire-bookkeeping/mariadb:$($script:MariaDbImageTag)"
        redis = "easyfire-bookkeeping/redis:$($script:TargetTag)"
        database_migration = "easyfire-bookkeeping/migration:$($script:TargetTag)"
        server = "easyfire-bookkeeping/server:$($script:TargetTag)"
        webapp = "easyfire-bookkeeping/webapp:$($script:TargetTag)"
        envoy = 'envoyproxy/envoy:v1.30.11@sha256:b5cc70f5fe5503858817e897ae1da5d873dc32cbc493790b4e330b8a42c4af9d'
        gotenberg = 'gotenberg/gotenberg:7.10.2@sha256:d03b8a04c6e6c5e568b38f57352266dee4674849b71818774025f8f48d869a9a'
    }
    $networkIds = @($Inventory.Networks | ForEach-Object { [string]$_.Id })
    foreach ($container in @($Inventory.Containers)) {
        $service = [string]$container.Service
        if ([string]$container.Project -cne $script:ProjectName -or
            [string]$container.Name -cne [string]$script:ServiceNames[$service] -or
            [string]$container.ComposeConfigHash -notmatch '^[a-f0-9]{64}$' -or
            [string]$container.ComposeOneOff -ine 'False' -or
            [string]$container.ImageReference -cne [string]$expectedImageReferences[$service] -or
            [string]$container.ImageId -notmatch '^sha256:[a-f0-9]{64}$') {
            throw "Container identity is incompatible for service $service."
        }
        $portBindings = @((Get-EasyFireProperty -Object $container -Name 'PortBindings' -Default @()))
        if ($service -eq 'envoy') {
            if ($portBindings.Count -ne 1 -or
                [string]$portBindings[0].ContainerPort -cne '80/tcp' -or
                [string]$portBindings[0].HostIp -cne '127.0.0.1' -or
                [string]$portBindings[0].HostPort -cne '80') {
                throw 'Envoy must exclusively publish 127.0.0.1:80 to 80/tcp.'
            }
        } elseif ($portBindings.Count -ne 0) {
            throw "Only Envoy may publish a host port; found one on $service."
        }
        $builtAuthority = Get-EasyFireProperty -Object $Journal -Name 'BuiltImageAuthority'
        if ($builtAuthority -and $service -in @('mysql','redis','database_migration','server','webapp')) {
            $expectedImageId = Get-EasyFireProperty -Object $builtAuthority.ReferenceToImageId -Name ([string]$container.ImageReference) -Default ''
            if ([string]$expectedImageId -cne [string]$container.ImageId) {
                throw "Container image ID does not match built-image authority for service $service."
            }
        }
        $expectedRestart = if ($service -eq 'database_migration') { 'no' } else { 'unless-stopped' }
        if ([string]$container.RestartPolicy -cne $expectedRestart) {
            throw "Container restart policy is incompatible for service $service."
        }
        if (@($container.Networks).Count -ne 1 -or
            [string]$container.Networks[0].Name -cne $script:ExpectedNetworkName -or
            [string]$container.Networks[0].NetworkId -notin $networkIds) {
            throw "Container network identity is incompatible for service $service."
        }
        $volumeMounts = @($container.Mounts | Where-Object { $_.Type -eq 'volume' })
        $bindMounts = @($container.Mounts | Where-Object { $_.Type -eq 'bind' })
        if ($service -eq 'mysql') {
            if ($volumeMounts.Count -ne 1 -or $volumeMounts[0].Source -cne $script:ExpectedMysqlVolume -or
                $volumeMounts[0].Destination -cne '/var/lib/mysql') {
                throw 'MariaDB mount identity is incompatible.'
            }
        } elseif ($service -eq 'redis') {
            if ($volumeMounts.Count -ne 1 -or $volumeMounts[0].Source -cne $script:ExpectedRedisVolume -or
                $volumeMounts[0].Destination -cne '/data') {
                throw 'Redis mount identity is incompatible.'
            }
        } elseif ($volumeMounts.Count -ne 0) {
            throw "Unexpected named-volume mount on service $service."
        }
        if ($service -eq 'envoy') {
            if ($bindMounts.Count -ne 1 -or $bindMounts[0].Destination -cne '/etc/envoy/envoy.yaml' -or
                [bool]$bindMounts[0].ReadWrite) {
                throw 'Envoy bind-mount identity is incompatible.'
            }
        } elseif ($bindMounts.Count -ne 0) {
            throw "Unexpected bind mount on service $service."
        }
    }

    if (@($Inventory.Networks).Count -gt 1) { throw 'More than one Compose network exists.' }
    if (@($Inventory.Networks).Count -eq 1) {
        $network = $Inventory.Networks[0]
        if ([string]$network.Name -cne $script:ExpectedNetworkName -or
            [string]$network.Project -cne $script:ProjectName -or
            [string]$network.LogicalName -cne 'bigcapital_network' -or
            [string]$network.Driver -cne 'bridge' -or [bool]$network.Internal) {
            throw 'Compose network identity is incompatible.'
        }
        if ($services.Count -eq 0 -and $Status -notin @('data_tier_starting', 'rollback_in_progress')) {
            throw "Compose network is not allowed without containers in phase $Status."
        }
    } elseif ($services.Count -gt 0) {
        throw 'Compose containers exist without their exact project network.'
    }

    $volumeNames = @($Inventory.Volumes | ForEach-Object { [string]$_.Name })
    foreach ($volume in @($Inventory.Volumes)) {
        $logical = if ($volume.Name -ceq $script:ExpectedMysqlVolume) { 'mysql' }
            elseif ($volume.Name -ceq $script:ExpectedRedisVolume) { 'redis' }
            else { '' }
        if (-not $logical -or [string]$volume.Project -cne $script:ProjectName -or
            [string]$volume.LogicalName -cne $logical -or [string]$volume.Driver -cne 'local' -or
            [string]$volume.Scope -cne 'local') {
            throw 'Durable-volume identity is incompatible.'
        }
    }
    $dataCanBePartial = $Status -in @('data_tier_starting', 'rollback_in_progress')
    if ($dataWasCreated -or $Status -in @(
        'data_tier_ready', 'migration_preparing', 'migration_running', 'migration_complete', 'baseline_backup_running',
        'baseline_backup_ready', 'app_tier_starting', 'app_tier_ready', 'tasks_registering',
        'action_completed_pending_postcheck', 'completed'
    )) {
        if (@(Compare-Object $expectedVolumeNames @($volumeNames | Sort-Object)).Count -ne 0) {
            throw 'Both exact ActionId-derived durable volumes are required.'
        }
    } elseif (-not $dataCanBePartial -and $volumeNames.Count -ne 0) {
        throw "Durable volumes are not allowed in phase $Status."
    }
    $volumeAuthority = Get-EasyFireProperty -Object $Journal -Name 'DurableVolumeFingerprint' -Default ''
    if ($dataWasCreated) {
        if ([string]$volumeAuthority -notmatch '^[A-F0-9]{64}$') {
            throw 'Journal durable-volume authority is missing.'
        }
        if ((Get-EasyFireVolumeFingerprint -Volumes @($Inventory.Volumes)) -cne [string]$volumeAuthority) {
            throw 'Durable-volume identity no longer matches the journal authority.'
        }
    }
}

function Initialize-EasyFireDurableVolumePlan {
    param([Parameter(Mandatory = $true)]$Journal)
    $existing = Get-EasyFireProperty -Object $Journal -Name 'DurableVolumePlan'
    if ($existing) { return $existing }
    $plan = [pscustomobject]@{
        ExpectedNames = @(@($script:ExpectedMysqlVolume, $script:ExpectedRedisVolume) | Sort-Object)
        ObservedVolumes = @()
        ObservedFingerprint = Get-EasyFireVolumeFingerprint -Volumes @()
        PlannedAtUtc = Get-EasyFireUtcNow
    }
    Set-EasyFireProperty -Object $Journal -Name 'DurableVolumePlan' -Value $plan
    Write-EasyFireTrackedJournal -Journal $Journal
    return $plan
}

function Update-EasyFireDurableVolumePlan {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)]$Inventory
    )
    $plan = Get-EasyFireProperty -Object $Journal -Name 'DurableVolumePlan'
    if (-not $plan) { throw 'Durable-volume creation has no journaled plan.' }
    $expectedNames = @(@($script:ExpectedMysqlVolume, $script:ExpectedRedisVolume) | Sort-Object)
    if (@(Compare-Object $expectedNames @($plan.ExpectedNames | Sort-Object)).Count -ne 0) {
        throw 'Durable-volume plan names drifted.'
    }
    $current = @($Inventory.Volumes | Where-Object { [string]$_.Name -in $expectedNames } | Sort-Object Name)
    $recorded = @($plan.ObservedVolumes | Sort-Object Name)
    foreach ($volume in $recorded) {
        $match = @($current | Where-Object { [string]$_.Name -ceq [string]$volume.Name })
        if ($match.Count -ne 1 -or
            (Get-EasyFireVolumeFingerprint -Volumes @($match[0])) -cne
            (Get-EasyFireVolumeFingerprint -Volumes @($volume))) {
            throw 'A journaled durable volume is missing or was recreated.'
        }
    }
    $changed = $false
    foreach ($volume in $current) {
        if (-not @($recorded | Where-Object { [string]$_.Name -ceq [string]$volume.Name })) {
            $recorded += $volume
            $changed = $true
        }
    }
    $recorded = @($recorded | Sort-Object Name)
    $fingerprint = Get-EasyFireVolumeFingerprint -Volumes $recorded
    if ([string]$plan.ObservedFingerprint -cne $fingerprint) { $changed = $true }
    if ($changed) {
        Set-EasyFireProperty -Object $plan -Name 'ObservedVolumes' -Value $recorded
        Set-EasyFireProperty -Object $plan -Name 'ObservedFingerprint' -Value $fingerprint
        Write-EasyFireTrackedJournal -Journal $Journal
    }
    return $plan
}

function Assert-EasyFirePreservedPlannedVolumes {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)]$Inventory
    )
    $plan = Get-EasyFireProperty -Object $Journal -Name 'DurableVolumePlan'
    if (-not $plan) {
        if (@($Inventory.Volumes).Count -ne 0) { throw 'Rollback found durable volumes without a journaled plan.' }
        return
    }
    $observed = @($plan.ObservedVolumes | Sort-Object Name)
    $current = @($Inventory.Volumes | Sort-Object Name)
    if (@(Compare-Object @($observed | ForEach-Object Name) @($current | ForEach-Object Name)).Count -ne 0 -or
        (Get-EasyFireVolumeFingerprint -Volumes $current) -cne [string]$plan.ObservedFingerprint) {
        throw 'Rollback did not preserve the exact journaled durable-volume subset.'
    }
}

function Get-EasyFireComposeArguments {
    param([Parameter(Mandatory = $true)][string]$ReleaseDirectory)
    return @(
        'compose',
        '-f', (Join-Path $ReleaseDirectory 'docker-compose.prod.yml'),
        '--env-file', (Join-Path $ReleaseDirectory '.env'),
        '-p', $script:ProjectName
    )
}

function Invoke-EasyFireCompose {
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $allArguments = @(Get-EasyFireComposeArguments -ReleaseDirectory $ReleaseDirectory) + $Arguments
    return Invoke-EasyFireNative -FilePath 'docker' -ArgumentList $allArguments -AllowFailure:$AllowFailure
}

function Wait-EasyFireServicesHealthy {
    param(
        [Parameter(Mandatory = $true)][string[]]$Services,
        [int]$TimeoutSeconds = 180
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $inventory = Get-EasyFireInventory
        $healthy = $true
        foreach ($service in $Services) {
            $container = @($inventory.Containers | Where-Object { $_.Service -eq $service })
            if ($container.Count -ne 1 -or $container[0].State -cne 'running' -or
                $container[0].Health -cne 'healthy') {
                $healthy = $false
                break
            }
        }
        if ($healthy) { return $inventory }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    throw "Services did not become healthy within $TimeoutSeconds seconds."
}

function Assert-EasyFireMigrationSucceeded {
    param([Parameter(Mandatory = $true)]$Inventory)
    $migration = @($Inventory.Containers | Where-Object { $_.Service -eq 'database_migration' })
    if ($migration.Count -ne 1 -or $migration[0].State -cne 'exited') {
        throw 'Migration container is not in its exact completed state.'
    }
    $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'inspect', '--format={{.State.ExitCode}}', [string]$migration[0].Id
    )
    if ($result.Text.Trim() -cne '0') { throw 'Migration container did not exit successfully.' }
}

function Get-EasyFireMigrationContainerAuthority {
    param([Parameter(Mandatory = $true)]$Container)
    return [pscustomobject]@{
        Id = [string]$Container.Id
        Name = [string]$Container.Name
        Project = [string]$Container.Project
        Service = [string]$Container.Service
        ComposeConfigHash = [string]$Container.ComposeConfigHash
        ImageReference = [string]$Container.ImageReference
        ImageId = [string]$Container.ImageId
    }
}

function Assert-EasyFireMigrationContainerAuthority {
    param(
        [Parameter(Mandatory = $true)]$Container,
        [Parameter(Mandatory = $true)]$Expected
    )
    $observed = Get-EasyFireMigrationContainerAuthority -Container $Container
    if (($observed | ConvertTo-Json -Depth 4 -Compress) -cne
        ($Expected | ConvertTo-Json -Depth 4 -Compress)) {
        throw 'Migration container no longer matches its journaled pre-start authority.'
    }
}

function Wait-EasyFireMigrationTerminal {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [int]$TimeoutSeconds = 900
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $inventory = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'migration_running' -Journal $Journal
        $migration = @($inventory.Containers | Where-Object { $_.Service -eq 'database_migration' })
        if ($migration.Count -ne 1) {
            throw 'Migration resume requires exactly one journal-owned migration container.'
        }
        $attempt = Get-EasyFireProperty -Object $Journal -Name 'MigrationAttempt'
        if (-not $attempt -or -not $attempt.ContainerAuthority) {
            throw 'Migration container authority is missing.'
        }
        Assert-EasyFireMigrationContainerAuthority -Container $migration[0] -Expected $attempt.ContainerAuthority
        if ($migration[0].State -ceq 'exited') {
            Assert-EasyFireMigrationSucceeded -Inventory $inventory
            return $inventory
        }
        if ($migration[0].State -cne 'running') {
            throw "Migration container entered an unsafe state: $($migration[0].State)"
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    throw "Migration container did not reach a terminal state within $TimeoutSeconds seconds."
}

function Assert-EasyFireReleaseSeal {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [switch]$RequireEnvironment
    )
    $releaseDirectory = [string]$Journal.ReleaseArchive.ExtractDir
    $manifest = Get-EasyFireProperty -Object $Journal -Name 'ReleaseManifest'
    if ($null -eq $manifest) { throw 'Release manifest authority is missing.' }
    $null = Assert-EasyFireNoReparsePathChain -Path $releaseDirectory -TrustedRoot $script:ResolvedProductionRoot
    Assert-EasyFireAuthorityTree -Path $releaseDirectory
    $manifestMatches = Test-EasyFireReleaseManifest -ReleaseDirectory $releaseDirectory -ExpectedManifestSha256 ([string]$manifest.Sha256) -ExpectedFileCount ([int]$manifest.FileCount)
    if (-not $manifestMatches) {
        throw 'Release contents no longer match the sealed manifest.'
    }
    foreach ($relative in @(
        'docker-compose.prod.yml',
        'scripts\production\backup.ps1',
        'scripts\production\restore-verify.ps1'
    )) {
        $required = Resolve-EasyFireContainedPath -Path (Join-Path $releaseDirectory $relative) -AllowedRoot $releaseDirectory -MustExist
        $null = Assert-EasyFireNoReparsePathChain -Path $required -TrustedRoot $releaseDirectory
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Sealed release file is missing: $relative"
        }
    }
    $envFile = Join-Path $releaseDirectory '.env'
    if ($RequireEnvironment -and -not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        throw 'Runtime environment file is missing.'
    }
    if ($RequireEnvironment) {
        $null = Assert-EasyFireEnvironment -Path $envFile
        Assert-EasyFireAuthorityTree -Path $envFile
        $expectedEnvironmentHash = [string](Get-EasyFireProperty -Object $Journal -Name 'EnvironmentSha256' -Default '')
        if ($expectedEnvironmentHash -notmatch '^[A-F0-9]{64}$' -or
            (Get-EasyFireSha256Hex -Path $envFile) -cne $expectedEnvironmentHash) {
            throw 'Runtime environment no longer matches the journal authority.'
        }
    }
}

function Write-EasyFireReleaseManifestAuthority {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)]$ExpectedArchiveManifest
    )
    $releaseDirectory = [string]$Journal.ReleaseArchive.ExtractDir
    $actual = Get-EasyFireReleaseManifest -ReleaseDirectory $releaseDirectory
    if ($actual.Sha256 -cne [string]$ExpectedArchiveManifest.Sha256 -or
        $actual.FileCount -ne [int]$ExpectedArchiveManifest.FileCount) {
        throw 'Extracted release does not match the archive-derived manifest.'
    }
    $manifestPath = Join-Path $script:JournalsRoot "$ActionId.release-manifest.json"
    $document = [pscustomobject]@{
        SchemaVersion = 1
        ActionId = $ActionId
        ArchiveSha256 = [string]$Journal.ReleaseArchive.Sha256
        Manifest = $actual
    }
    $null = Write-EasyFireJsonAtomic -Path $manifestPath -Value $document -AllowedRoot $script:JournalsRoot
    Set-EasyFireProperty -Object $Journal -Name 'ReleaseManifest' -Value ([pscustomobject]@{
        SchemaVersion = 1
        Path = $manifestPath
        Sha256 = [string]$actual.Sha256
        FileCount = [int]$actual.FileCount
    })
    Write-EasyFireTrackedJournal -Journal $Journal
}

function New-EasyFireSecretHex {
    param([int]$ByteCount = 32)
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-EasyFireEnvironmentMap {
    param([Parameter(Mandatory = $true)][string]$Path)
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding ascii) {
        if (-not $line -or $line.TrimStart().StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { throw 'Runtime environment contains an invalid line.' }
        $name = $line.Substring(0, $separator)
        $value = $line.Substring($separator + 1)
        if ($name -notmatch '^[A-Z][A-Z0-9_]*$' -or $map.ContainsKey($name)) {
            throw 'Runtime environment contains an invalid or duplicate key.'
        }
        $map[$name] = $value
    }
    return $map
}

function Assert-EasyFireEnvironment {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Test-EasyFireReparsePoint -Path $Path)) {
        throw 'Runtime environment is missing or unsafe.'
    }
    $map = Get-EasyFireEnvironmentMap -Path $Path
    $exact = @{
        IMAGE_TAG = $script:TargetTag
        MARIADB_IMAGE_TAG = $script:MariaDbImageTag
        MARIADB_VOLUME_NAME = $script:ExpectedMysqlVolume
        REDIS_VOLUME_NAME = $script:ExpectedRedisVolume
        MARIADB_ENGINE_VERSION = '11.8.6'
        BASE_URL = 'https://bookkeeping.easyfire.fyi'
        SIGNUP_DISABLED = 'true'
        SIGNUP_ALLOWED_DOMAINS = ''
        SIGNUP_ALLOWED_EMAILS = ''
        SIGNUP_EMAIL_CONFIRMATION = 'false'
        DB_HOST = 'mysql'
        DB_USER = 'easyfire_prod'
        DB_CHARSET = 'utf8mb4'
        SYSTEM_DB_NAME = 'easyfire_system'
        TENANT_DB_NAME_PERFIX = 'easyfire_tenant_'
        PUBLIC_PROXY_PORT = '80'
        REDIS_HOST = 'redis'
        REDIS_PORT = '6379'
        QUEUE_HOST = 'redis'
        QUEUE_PORT = '6379'
        GOTENBERG_URL = 'http://gotenberg:3000'
        GOTENBERG_DOCS_URL = 'http://server:3000/public/'
        MAIL_HOST = ''
        MAIL_USERNAME = ''
        MAIL_PASSWORD = ''
        MAIL_PORT = '587'
        MAIL_SECURE = 'false'
        MAIL_FROM_NAME = 'EasyFire Bookkeeping'
        MAIL_FROM_ADDRESS = 'noreply@easyfire.fyi'
        EXCHANGE_RATE_SERVICE = ''
        OPEN_EXCHANGE_RATE_APP_ID = ''
        BANK_FEED_ENABLED = 'false'
        PLAID_ENV = 'sandbox'
        PLAID_CLIENT_ID = ''
        PLAID_SECRET = ''
        PLAID_LINK_WEBHOOK = ''
        LEMONSQUEEZY_API_KEY = ''
        LEMONSQUEEZY_STORE_ID = ''
        LEMONSQUEEZY_WEBHOOK_SECRET = ''
        HOSTED_ON_BIGCAPITAL_CLOUD = 'false'
        NEW_RELIC_DISTRIBUTED_TRACING_ENABLED = 'false'
        NEW_RELIC_LOG = 'stdout'
        NEW_RELIC_AI_MONITORING_ENABLED = 'false'
        NEW_RELIC_CUSTOM_INSIGHTS_EVENTS_MAX_SAMPLES_STORED = '0'
        NEW_RELIC_SPAN_EVENTS_MAX_SAMPLES_STORED = '0'
        NEW_RELIC_LICENSE_KEY = ''
        NEW_RELIC_APP_NAME = 'EasyFire Bookkeeping'
        S3_REGION = 'auto'
        S3_ACCESS_KEY_ID = ''
        S3_SECRET_ACCESS_KEY = ''
        S3_ENDPOINT = ''
        S3_BUCKET = ''
        STRIPE_PAYMENT_SECRET_KEY = ''
        STRIPE_PAYMENT_PUBLISHABLE_KEY = ''
        STRIPE_PAYMENT_CLIENT_ID = ''
        STRIPE_PAYMENT_WEBHOOKS_SECRET = ''
        STRIPE_PAYMENT_REDIRECT_URL = 'https://bookkeeping.easyfire.fyi/preferences/payment-methods/stripe/callback'
    }
    foreach ($entry in $exact.GetEnumerator()) {
        if (-not $map.ContainsKey($entry.Key) -or [string]$map[$entry.Key] -cne [string]$entry.Value) {
            throw "Runtime environment invariant failed for $($entry.Key)."
        }
    }
    foreach ($secretName in @('DB_PASSWORD', 'DB_ROOT_PASSWORD')) {
        if (-not $map.ContainsKey($secretName) -or [string]$map[$secretName] -notmatch '^[a-f0-9]{64}$') {
            throw "Runtime secret shape is invalid for $secretName."
        }
    }
    if (-not $map.ContainsKey('APP_JWT_SECRET')) { throw 'APP_JWT_SECRET is missing.' }
    try { $jwtBytes = [Convert]::FromBase64String([string]$map.APP_JWT_SECRET) }
    catch { throw 'APP_JWT_SECRET is not valid base64.' }
    if ($jwtBytes.Length -lt 64) { throw 'APP_JWT_SECRET must decode to at least 64 bytes.' }
    $requiredKeys = @(
        'IMAGE_TAG','MARIADB_IMAGE_TAG','MARIADB_VOLUME_NAME','REDIS_VOLUME_NAME','MARIADB_ENGINE_VERSION',
        'BASE_URL','SIGNUP_DISABLED','SIGNUP_ALLOWED_DOMAINS','SIGNUP_ALLOWED_EMAILS','SIGNUP_EMAIL_CONFIRMATION',
        'MAIL_HOST','MAIL_USERNAME','MAIL_PASSWORD','MAIL_PORT','MAIL_SECURE','MAIL_FROM_NAME','MAIL_FROM_ADDRESS',
        'DB_HOST','DB_USER','DB_PASSWORD','DB_ROOT_PASSWORD','DB_CHARSET','SYSTEM_DB_NAME','TENANT_DB_NAME_PERFIX',
        'APP_JWT_SECRET','PUBLIC_PROXY_PORT','REDIS_HOST','REDIS_PORT','QUEUE_HOST','QUEUE_PORT','GOTENBERG_URL',
        'GOTENBERG_DOCS_URL','EXCHANGE_RATE_SERVICE','OPEN_EXCHANGE_RATE_APP_ID','BANK_FEED_ENABLED','PLAID_ENV',
        'PLAID_CLIENT_ID','PLAID_SECRET','PLAID_LINK_WEBHOOK','LEMONSQUEEZY_API_KEY','LEMONSQUEEZY_STORE_ID',
        'LEMONSQUEEZY_WEBHOOK_SECRET','HOSTED_ON_BIGCAPITAL_CLOUD','NEW_RELIC_DISTRIBUTED_TRACING_ENABLED',
        'NEW_RELIC_LOG','NEW_RELIC_AI_MONITORING_ENABLED','NEW_RELIC_CUSTOM_INSIGHTS_EVENTS_MAX_SAMPLES_STORED',
        'NEW_RELIC_SPAN_EVENTS_MAX_SAMPLES_STORED','NEW_RELIC_LICENSE_KEY','NEW_RELIC_APP_NAME','S3_REGION',
        'S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_ENDPOINT','S3_BUCKET','STRIPE_PAYMENT_SECRET_KEY',
        'STRIPE_PAYMENT_PUBLISHABLE_KEY','STRIPE_PAYMENT_CLIENT_ID','STRIPE_PAYMENT_WEBHOOKS_SECRET',
        'STRIPE_PAYMENT_REDIRECT_URL'
    )
    if (@(Compare-Object @($requiredKeys | Sort-Object) @($map.Keys | Sort-Object)).Count -ne 0) {
        throw 'Runtime environment key set is not exact.'
    }
    return $map
}

function Assert-EasyFireEnvironmentOperationAuthority {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$OperationId
    )
    if ($OperationId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') {
        throw 'Runtime environment operation ID must be a canonical lowercase version-4 GUID.'
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Test-EasyFireReparsePoint -Path $Path)) {
        throw 'Runtime environment operation artifact is missing or unsafe.'
    }
    $firstLine = @(Get-Content -LiteralPath $Path -Encoding ascii -TotalCount 1)
    if ($firstLine.Count -ne 1 -or [string]$firstLine[0] -cne "# EASYFIRE_ENV_OPERATION_ID=$OperationId") {
        throw 'Runtime environment operation artifact does not match its journal authority.'
    }
}

function New-EasyFireEnvironmentCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$CandidatePath,
        [Parameter(Mandatory = $true)][string]$PartialPath,
        [Parameter(Mandatory = $true)][string]$OperationId
    )

    if ($OperationId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') {
        throw 'Runtime environment operation ID must be a canonical lowercase version-4 GUID.'
    }
    if ($PartialPath -cne "$CandidatePath.$OperationId.partial") {
        throw 'Runtime environment partial path is not operation-derived.'
    }
    if (Test-Path -LiteralPath $CandidatePath) {
        throw 'Refusing to overwrite an existing runtime environment candidate.'
    }
    if (Test-Path -LiteralPath $PartialPath) {
        if (-not (Test-Path -LiteralPath $PartialPath -PathType Leaf) -or (Test-EasyFireReparsePoint -Path $PartialPath)) {
            throw 'Runtime environment partial artifact is unsafe.'
        }
        [IO.File]::Delete($PartialPath)
        if (Test-Path -LiteralPath $PartialPath) {
            throw 'Runtime environment partial artifact could not be retired.'
        }
    }

    $dbPassword = New-EasyFireSecretHex -ByteCount 32
    $dbRootPassword = New-EasyFireSecretHex -ByteCount 32
    $jwtBytes = New-Object byte[] 64
    $jwtRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $jwtRng.GetBytes($jwtBytes) }
    finally { $jwtRng.Dispose() }
    $jwtSecret = [Convert]::ToBase64String($jwtBytes)
    $lines = @(
        "# EASYFIRE_ENV_OPERATION_ID=$OperationId",
        "IMAGE_TAG=$($script:TargetTag)",
        "MARIADB_IMAGE_TAG=$($script:MariaDbImageTag)",
        "MARIADB_VOLUME_NAME=$($script:ExpectedMysqlVolume)",
        "REDIS_VOLUME_NAME=$($script:ExpectedRedisVolume)",
        'MARIADB_ENGINE_VERSION=11.8.6',
        'BASE_URL=https://bookkeeping.easyfire.fyi',
        'SIGNUP_DISABLED=true',
        'SIGNUP_ALLOWED_DOMAINS=',
        'SIGNUP_ALLOWED_EMAILS=',
        'SIGNUP_EMAIL_CONFIRMATION=false',
        'MAIL_HOST=',
        'MAIL_USERNAME=',
        'MAIL_PASSWORD=',
        'MAIL_PORT=587',
        'MAIL_SECURE=false',
        'MAIL_FROM_NAME=EasyFire Bookkeeping',
        'MAIL_FROM_ADDRESS=noreply@easyfire.fyi',
        'DB_HOST=mysql',
        'DB_USER=easyfire_prod',
        "DB_PASSWORD=$dbPassword",
        "DB_ROOT_PASSWORD=$dbRootPassword",
        'DB_CHARSET=utf8mb4',
        'SYSTEM_DB_NAME=easyfire_system',
        'TENANT_DB_NAME_PERFIX=easyfire_tenant_',
        "APP_JWT_SECRET=$jwtSecret",
        'PUBLIC_PROXY_PORT=80',
        'REDIS_HOST=redis',
        'REDIS_PORT=6379',
        'QUEUE_HOST=redis',
        'QUEUE_PORT=6379',
        'GOTENBERG_URL=http://gotenberg:3000',
        'GOTENBERG_DOCS_URL=http://server:3000/public/',
        'EXCHANGE_RATE_SERVICE=',
        'OPEN_EXCHANGE_RATE_APP_ID=',
        'BANK_FEED_ENABLED=false',
        'PLAID_ENV=sandbox',
        'PLAID_CLIENT_ID=',
        'PLAID_SECRET=',
        'PLAID_LINK_WEBHOOK=',
        'LEMONSQUEEZY_API_KEY=',
        'LEMONSQUEEZY_STORE_ID=',
        'LEMONSQUEEZY_WEBHOOK_SECRET=',
        'HOSTED_ON_BIGCAPITAL_CLOUD=false',
        'NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=false',
        'NEW_RELIC_LOG=stdout',
        'NEW_RELIC_AI_MONITORING_ENABLED=false',
        'NEW_RELIC_CUSTOM_INSIGHTS_EVENTS_MAX_SAMPLES_STORED=0',
        'NEW_RELIC_SPAN_EVENTS_MAX_SAMPLES_STORED=0',
        'NEW_RELIC_LICENSE_KEY=',
        'NEW_RELIC_APP_NAME=EasyFire Bookkeeping',
        'S3_REGION=auto',
        'S3_ACCESS_KEY_ID=',
        'S3_SECRET_ACCESS_KEY=',
        'S3_ENDPOINT=',
        'S3_BUCKET=',
        'STRIPE_PAYMENT_SECRET_KEY=',
        'STRIPE_PAYMENT_PUBLISHABLE_KEY=',
        'STRIPE_PAYMENT_CLIENT_ID=',
        'STRIPE_PAYMENT_WEBHOOKS_SECRET=',
        'STRIPE_PAYMENT_REDIRECT_URL=https://bookkeeping.easyfire.fyi/preferences/payment-methods/stripe/callback'
    )
    [IO.File]::WriteAllText($PartialPath, (($lines -join [Environment]::NewLine) + [Environment]::NewLine), [Text.Encoding]::ASCII)
    Protect-EasyFireSecretFile -Path $PartialPath
    Assert-EasyFireEnvironmentOperationAuthority -Path $PartialPath -OperationId $OperationId
    $null = Assert-EasyFireEnvironment -Path $PartialPath
    Move-Item -LiteralPath $PartialPath -Destination $CandidatePath -ErrorAction Stop
    Protect-EasyFireSecretFile -Path $CandidatePath
    Assert-EasyFireEnvironmentOperationAuthority -Path $CandidatePath -OperationId $OperationId
    $null = Assert-EasyFireEnvironment -Path $CandidatePath
    return [pscustomobject]@{
        Path = $CandidatePath
        Sha256 = Get-EasyFireSha256Hex -Path $CandidatePath
    }
}

function Get-EasyFireControllerBundlePaths {
    param([Parameter(Mandatory = $true)][string]$ControllerPath)

    $resolvedController = [IO.Path]::GetFullPath($ControllerPath)
    $controllerDirectory = [IO.Path]::GetDirectoryName($resolvedController)
    return @(
        $resolvedController,
        (Join-Path $controllerDirectory 'production-io.psm1'),
        (Join-Path $controllerDirectory 'production-state.psm1'),
        (Join-Path $controllerDirectory '..\..\scripts\production\backup-integrity.psm1')
    )
}

function Assert-EasyFireControllerBundleContentEqual {
    param(
        [Parameter(Mandatory = $true)]$Left,
        [Parameter(Mandatory = $true)]$Right
    )

    $leftFiles = @($Left.Files)
    $rightFiles = @($Right.Files)
    if ($leftFiles.Count -ne $rightFiles.Count) {
        throw 'Installed controller bundle file count differs from the deployment controller.'
    }
    $rightByName = @{}
    foreach ($file in $rightFiles) {
        $name = [IO.Path]::GetFileName([string]$file.Path)
        if ($rightByName.ContainsKey($name)) {
            throw "Installed controller bundle has a duplicate component name: $name"
        }
        $rightByName[$name] = [string]$file.Sha256
    }
    foreach ($file in $leftFiles) {
        $name = [IO.Path]::GetFileName([string]$file.Path)
        if (-not $rightByName.ContainsKey($name) -or
            [string]$file.Sha256 -cne [string]$rightByName[$name]) {
            throw "Installed controller bundle component differs from deployment authority: $name"
        }
    }
}

function Get-EasyFireWindowsPowerShellPath {
    $systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    if (-not $systemDirectory) { throw 'Windows system directory is unavailable.' }
    $executable = [IO.Path]::GetFullPath(
        (Join-Path $systemDirectory 'WindowsPowerShell\v1.0\powershell.exe')
    )
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $executable)) {
        throw 'The canonical Windows PowerShell executable is missing or unsafe.'
    }
    return $executable
}

function Get-EasyFireTaskDefinitions {
    param([Parameter(Mandatory = $true)][string]$ReleaseDirectory)
    $installedController = Join-Path $ReleaseDirectory 'deploy\windows\production-action.ps1'
    $backupArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Stage ScheduledBackup -ReleaseArchive "N/A" -ExpectedArchiveSha256 "N/A" -ProductionRoot "{1}" -CloudflareCredentialFile "N/A" -ActionId "{2}" -AuthorityOwnerSid "{3}"' -f
        $installedController, $script:ResolvedProductionRoot, $ActionId, $script:AuthorityOwnerSid
    return @(
        [pscustomobject]@{
            Name = $script:TaskBackupName
            TaskPath = '\'
            Execute = Get-EasyFireWindowsPowerShellPath
            Arguments = $backupArguments
            WorkingDirectory = [IO.Path]::GetDirectoryName($installedController)
            TriggerType = 'MSFT_TaskDailyTrigger'
            TriggerHour = 2
            TriggerMinute = 0
            Description = 'EasyFire Bookkeeping -- daily application-schema backup'
        }
    )
}

function Test-EasyFireTaskExact {
    param([Parameter(Mandatory = $true)]$Definition)
    $task = Get-ScheduledTask -TaskPath $Definition.TaskPath -TaskName $Definition.Name -ErrorAction SilentlyContinue
    if (-not $task) { return $false }
    $actions = @($task.Actions)
    $triggers = @($task.Triggers)
    if ($actions.Count -ne 1 -or $triggers.Count -ne 1) { return $false }
    $triggerClass = [string]$triggers[0].CimClass.CimClassName
    try { $triggerLocal = ([DateTimeOffset]::Parse([string]$triggers[0].StartBoundary)).ToLocalTime() }
    catch { return $false }
    $repetition = Get-EasyFireProperty -Object $triggers[0] -Name 'Repetition'
    $networkSettings = Get-EasyFireProperty -Object $task.Settings -Name 'NetworkSettings'
    $emptyDurations = @('', 'PT0S')
    return (
        [string]$task.TaskPath -ceq [string]$Definition.TaskPath -and
        [string]$actions[0].Execute -ceq [string]$Definition.Execute -and
        [string]$actions[0].Arguments -ceq [string]$Definition.Arguments -and
        [string]$actions[0].WorkingDirectory -ceq [string]$Definition.WorkingDirectory -and
        [string]$task.Principal.UserId -ieq 'SYSTEM' -and
        [string]$task.Principal.LogonType -ceq 'ServiceAccount' -and
        [string]$task.Principal.RunLevel -ceq 'Limited' -and
        $triggerClass -ceq [string]$Definition.TriggerType -and
        [int]$triggers[0].DaysInterval -eq 1 -and
        [bool]$triggers[0].Enabled -and
        [string](Get-EasyFireProperty -Object $triggers[0] -Name 'EndBoundary' -Default '') -ceq '' -and
        [string](Get-EasyFireProperty -Object $triggers[0] -Name 'RandomDelay' -Default '') -in $emptyDurations -and
        [string](Get-EasyFireProperty -Object $repetition -Name 'Interval' -Default '') -in $emptyDurations -and
        [string](Get-EasyFireProperty -Object $repetition -Name 'Duration' -Default '') -in $emptyDurations -and
        -not [bool](Get-EasyFireProperty -Object $repetition -Name 'StopAtDurationEnd' -Default $false) -and
        $triggerLocal.Hour -eq [int]$Definition.TriggerHour -and
        $triggerLocal.Minute -eq [int]$Definition.TriggerMinute -and
        [bool]$task.Settings.Enabled -and
        -not [bool]$task.Settings.DisallowStartIfOnBatteries -and
        -not [bool]$task.Settings.StopIfGoingOnBatteries -and
        [bool]$task.Settings.StartWhenAvailable -and
        [string]$task.Settings.MultipleInstances -ceq 'IgnoreNew' -and
        [int]$task.Settings.RestartCount -eq 0 -and
        [string](Get-EasyFireProperty -Object $task.Settings -Name 'RestartInterval' -Default '') -in $emptyDurations -and
        [string]$task.Settings.ExecutionTimeLimit -ceq 'PT2H' -and
        [string](Get-EasyFireProperty -Object $task.Settings -Name 'DeleteExpiredTaskAfter' -Default '') -in $emptyDurations -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'Hidden' -Default $false) -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'RunOnlyIfIdle' -Default $false) -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'RunOnlyIfNetworkAvailable' -Default $false) -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'WakeToRun' -Default $false) -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'DisallowStartOnRemoteAppSession' -Default $false) -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'UseUnifiedSchedulingEngine' -Default $false) -and
        -not [bool](Get-EasyFireProperty -Object $task.Settings -Name 'Volatile' -Default $false) -and
        [string](Get-EasyFireProperty -Object $networkSettings -Name 'Id' -Default '') -ceq '' -and
        [string](Get-EasyFireProperty -Object $networkSettings -Name 'Name' -Default '') -ceq '' -and
        [string]$task.Description -ceq [string]$Definition.Description
    )
}

function Assert-EasyFireRetiredTasksAbsent {
    foreach ($retiredName in $script:RetiredTaskNames) {
        $matches = @(Get-ScheduledTask -TaskName $retiredName -ErrorAction SilentlyContinue)
        if ($matches.Count -gt 0) {
            $paths = @($matches | ForEach-Object { "$($_.TaskPath)$($_.TaskName)" }) -join ', '
            throw "Retired scheduled task must be absent from every Task Scheduler path: $paths"
        }
    }
}

function Assert-EasyFireTasksForPhase {
    param(
        [Parameter(Mandatory = $true)][string]$Status,
        [Parameter(Mandatory = $true)][string]$ReleaseDirectory
    )
    $definitions = @(Get-EasyFireTaskDefinitions -ReleaseDirectory $ReleaseDirectory)
    $requiresAll = $Status -in @('action_completed_pending_postcheck', 'completed')
    $allowsSubset = $Status -in @('tasks_registering', 'rollback_in_progress')
    Assert-EasyFireRetiredTasksAbsent
    foreach ($definition in $definitions) {
        $exists = $null -ne (Get-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -ErrorAction SilentlyContinue)
        if ($exists -and -not (Test-EasyFireTaskExact -Definition $definition)) {
            throw "Scheduled task identity drifted: $($definition.Name)"
        }
        if ($requiresAll -and -not $exists) { throw "Required scheduled task is absent: $($definition.Name)" }
        if (-not $requiresAll -and -not $allowsSubset -and $exists) {
            throw "Scheduled task exists before its authorized phase: $($definition.Name)"
        }
    }
    return $definitions
}

function Register-EasyFireTasks {
    param([Parameter(Mandatory = $true)][object[]]$Definitions)
    foreach ($definition in $Definitions) {
        if (Get-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -ErrorAction SilentlyContinue) {
            if (-not (Test-EasyFireTaskExact -Definition $definition)) {
                throw "Refusing to overwrite a scheduled task: $($definition.Name)"
            }
            continue
        }
        $action = New-ScheduledTaskAction -Execute $definition.Execute -Argument $definition.Arguments -WorkingDirectory $definition.WorkingDirectory
        $trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount
        Register-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $definition.Description -ErrorAction Stop | Out-Null
        if (-not (Test-EasyFireTaskExact -Definition $definition)) {
            throw "Scheduled task readback failed: $($definition.Name)"
        }
    }
}

function Remove-EasyFireActionTasks {
    param([Parameter(Mandatory = $true)][object[]]$Definitions)
    foreach ($definition in $Definitions) {
        $task = Get-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -ErrorAction SilentlyContinue
        if (-not $task) { continue }
        if (-not (Test-EasyFireTaskExact -Definition $definition)) {
            throw "Refusing to remove a scheduled task whose identity drifted: $($definition.Name)"
        }
        Unregister-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -Confirm:$false -ErrorAction Stop
    }
}

function Get-EasyFireBackupNames {
    if (-not (Test-Path -LiteralPath $script:BackupsRoot -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $script:BackupsRoot -Filter "mysql-$($script:ProjectName)-full-*.sql.gz" |
        ForEach-Object { $_.Name } | Sort-Object)
}

function Get-EasyFireVerifiedBackupReceipt {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][ValidateSet('Scheduled', 'Baseline', 'Emergency')][string]$Kind
    )
    $receiptProperty = $Kind + 'Backup'
    $planProperty = $Kind + 'BackupPlan'
    $candidateProperty = $Kind + 'BackupCandidate'
    $plan = Get-EasyFireProperty -Object $Journal -Name $planProperty
    if (-not $plan) {
        $plan = [pscustomobject]@{
            BackupOperationId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
            InvocationRole = $Kind
            BackupMode = 'full'
            StartedAtUtc = Get-EasyFireUtcNow
            State = 'active'
        }
        Set-EasyFireProperty -Object $Journal -Name $planProperty -Value $plan
    }
    if ([string]$plan.BackupOperationId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or
        [string]$plan.InvocationRole -cne $Kind -or [string]$plan.BackupMode -cne 'full') {
        throw "$Kind backup plan authority is invalid."
    }
    $artifactStem = "mysql-$($script:ProjectName)-full-$([string]$plan.BackupOperationId)"
    $candidatePath = Join-Path $script:BackupsRoot "$artifactStem.sql.gz"
    $metadataPath = Join-Path $script:BackupsRoot "$artifactStem.metadata.json"
    $candidate = Get-EasyFireProperty -Object $Journal -Name $candidateProperty
    if (-not $candidate) {
        $candidate = [pscustomobject]@{
            BackupFile = $candidatePath
            SidecarFile = Join-Path $script:BackupsRoot "$artifactStem.sha256"
            MetadataFile = $metadataPath
            BackupOperationId = [string]$plan.BackupOperationId
        }
        Set-EasyFireProperty -Object $Journal -Name $candidateProperty -Value $candidate
        Write-EasyFireTrackedJournal -Journal $Journal
    } elseif ([string]$candidate.BackupFile -cne $candidatePath -or
        [string]$candidate.SidecarFile -cne (Join-Path $script:BackupsRoot "$artifactStem.sha256") -or
        [string]$candidate.MetadataFile -cne $metadataPath -or
        [string]$candidate.BackupOperationId -cne [string]$plan.BackupOperationId) {
        throw "$Kind backup candidate does not match its operation authority."
    }
    Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
    $backupScript = Join-Path $Journal.ReleaseArchive.ExtractDir 'scripts\production\backup.ps1'
    $backupResult = Invoke-EasyFireNative -FilePath (Get-EasyFireWindowsPowerShellPath) -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $backupScript,
        '-ComposeFile', (Join-Path $Journal.ReleaseArchive.ExtractDir 'docker-compose.prod.yml'),
        '-EnvFile', (Join-Path $Journal.ReleaseArchive.ExtractDir '.env'),
        '-ProjectName', $script:ProjectName,
        '-BackupDir', $script:BackupsRoot,
        '-AuthorityRoot', $script:ResolvedProductionRoot,
        '-ActionId', $ActionId,
        '-InvocationRole', $Kind,
        '-BackupOperationId', ([string]$plan.BackupOperationId),
        '-RetentionCount', '30'
    )
    $publishedLines = @($backupResult.Output | ForEach-Object { [string]$_ } |
        Where-Object { $_.StartsWith('BACKUP_PUBLISHED ', [StringComparison]::Ordinal) })
    if ($publishedLines.Count -ne 1) { throw "$Kind backup did not emit one exact publication receipt." }
    try { $published = $publishedLines[0].Substring(17) | ConvertFrom-Json }
    catch { throw "$Kind backup publication receipt is invalid JSON." }
    $pair = Test-EasyFireBackupPair -BackupFile $candidatePath
    if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $metadataPath)) {
        throw "$Kind backup metadata is missing or unsafe."
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $metadataPath -TrustedRoot $script:BackupsRoot
    $metadataSha256 = Get-EasyFireSha256Hex -Path $metadataPath
    try { $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw "$Kind backup metadata is invalid JSON." }
    $expectedMetadataNames = @(
        'ActionId', 'BackupFile', 'BackupMode', 'BackupOperationId', 'BackupSha256',
        'DurableVolumeFingerprint', 'InvocationRole', 'MysqlContainerId', 'MysqlContainerName',
        'MysqlImageId', 'MysqlImageReference', 'MysqlVolumeDestination', 'MysqlVolumeName',
        'PhaseInventoryFingerprint', 'SchemaVersion'
    ) | Sort-Object
    $actualMetadataNames = @($metadata.PSObject.Properties.Name | Sort-Object)
    $mysql = @($Journal.PhaseInventory.Containers | Where-Object { [string]$_.Service -ceq 'mysql' })
    $mysqlMounts = if ($mysql.Count -eq 1) {
        @($mysql[0].Mounts | Where-Object { [string]$_.Type -ceq 'volume' })
    } else { @() }
    if (-not $pair.Valid -or [string]$published.BackupOperationId -cne [string]$plan.BackupOperationId -or
        [string]$published.InvocationRole -cne $Kind -or [string]$published.BackupMode -cne 'full' -or
        [string]$published.BackupFile -cne [string]$pair.BackupFile -or
        [string]$published.SidecarFile -cne [string]$pair.SidecarFile -or
        [string]$published.Sha256 -cne [string]$pair.Sha256 -or
        [string]$published.MetadataFile -cne $metadataPath -or
        [string]$published.MetadataSha256 -cne $metadataSha256 -or
        @(Compare-Object $expectedMetadataNames $actualMetadataNames -CaseSensitive).Count -ne 0 -or
        [int]$metadata.SchemaVersion -ne 1 -or [string]$metadata.ActionId -cne $ActionId -or
        [string]$metadata.InvocationRole -cne $Kind -or
        [string]$metadata.BackupOperationId -cne [string]$plan.BackupOperationId -or
        [string]$metadata.BackupMode -cne 'full' -or
        [string]$metadata.PhaseInventoryFingerprint -cne [string]$Journal.PhaseInventoryFingerprint -or
        [string]$metadata.DurableVolumeFingerprint -cne [string]$Journal.DurableVolumeFingerprint -or
        $mysql.Count -ne 1 -or $mysqlMounts.Count -ne 1 -or
        [string]$metadata.MysqlContainerId -cne [string]$mysql[0].Id -or
        [string]$metadata.MysqlContainerName -cne [string]$mysql[0].Name -or
        [string]$metadata.MysqlImageReference -cne [string]$mysql[0].ImageReference -or
        [string]$metadata.MysqlImageId -cne [string]$mysql[0].ImageId -or
        [string]$metadata.MysqlVolumeName -cne [string]$mysqlMounts[0].Source -or
        [string]$metadata.MysqlVolumeDestination -cne [string]$mysqlMounts[0].Destination -or
        [string]$metadata.BackupFile -cne [string]$pair.BackupFile -or
        [string]$metadata.BackupSha256 -cne [string]$pair.Sha256) {
        throw "$Kind backup publication receipt or metadata does not match its exact recovery unit."
    }
    $restoreVerifier = Join-Path $Journal.ReleaseArchive.ExtractDir 'scripts\production\restore-verify.ps1'
    $null = Invoke-EasyFireNative -FilePath (Get-EasyFireWindowsPowerShellPath) -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $restoreVerifier,
        '-BackupFile', $pair.BackupFile,
        '-EnvFile', (Join-Path $Journal.ReleaseArchive.ExtractDir '.env')
    )
    $receipt = [pscustomobject]@{
        BackupFile = [string]$pair.BackupFile
        SidecarFile = [string]$pair.SidecarFile
        Sha256 = [string]$pair.Sha256
        MetadataFile = $metadataPath
        MetadataSha256 = $metadataSha256
        MetadataAuthority = $metadata
        BackupOperationId = [string]$plan.BackupOperationId
        InvocationRole = $Kind
        BackupMode = 'full'
        NetworkMode = 'none'
        VerifierImage = 'mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577'
        VerifiedAtUtc = Get-EasyFireUtcNow
    }
    Set-EasyFireProperty -Object $Journal -Name $receiptProperty -Value $receipt
    Set-EasyFireProperty -Object $plan -Name 'State' -Value 'completed'
    Set-EasyFireProperty -Object $plan -Name 'CompletedAtUtc' -Value (Get-EasyFireUtcNow)
    Write-EasyFireTrackedJournal -Journal $Journal
    return $receipt
}

function Assert-EasyFireBackupReceiptRecoveryUnit {
    param(
        [Parameter(Mandatory = $true)]$Receipt,
        [Parameter(Mandatory = $true)][ValidateSet('Scheduled', 'Baseline', 'Emergency')][string]$ExpectedRole
    )

    $backupFile = [string](Get-EasyFireProperty -Object $Receipt -Name 'BackupFile' -Default '')
    $expectedMetadataFile = $backupFile -replace '\.sql\.gz$', '.metadata.json'
    $metadataFile = [string](Get-EasyFireProperty -Object $Receipt -Name 'MetadataFile' -Default '')
    $metadataAuthority = Get-EasyFireProperty -Object $Receipt -Name 'MetadataAuthority'
    $pair = Test-EasyFireBackupPair -BackupFile $backupFile
    if (-not $pair.Valid -or [string]$pair.SidecarFile -cne [string]$Receipt.SidecarFile -or
        [string]$pair.Sha256 -cne [string]$Receipt.Sha256 -or
        [string]$Receipt.InvocationRole -cne $ExpectedRole -or
        [string]$Receipt.BackupMode -cne 'full' -or [string]$Receipt.NetworkMode -cne 'none' -or
        $expectedMetadataFile -ceq $backupFile -or $metadataFile -cne $expectedMetadataFile -or
        -not $metadataAuthority -or -not (Test-Path -LiteralPath $metadataFile -PathType Leaf) -or
        (Test-EasyFireReparsePoint -Path $metadataFile)) {
        throw "$ExpectedRole backup recovery-unit receipt is incomplete or invalid."
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $metadataFile -TrustedRoot $script:BackupsRoot
    $metadataSha256 = Get-EasyFireSha256Hex -Path $metadataFile
    if ($metadataSha256 -cne [string]$Receipt.MetadataSha256) {
        throw "$ExpectedRole backup metadata hash changed after publication."
    }
    try { $metadata = Get-Content -LiteralPath $metadataFile -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw "$ExpectedRole backup metadata is no longer valid JSON." }
    if (($metadata | ConvertTo-Json -Depth 8 -Compress) -cne
        ($metadataAuthority | ConvertTo-Json -Depth 8 -Compress) -or
        [int]$metadata.SchemaVersion -ne 1 -or [string]$metadata.ActionId -cne $ActionId -or
        [string]$metadata.InvocationRole -cne $ExpectedRole -or
        [string]$metadata.BackupOperationId -cne [string]$Receipt.BackupOperationId -or
        [string]$metadata.BackupMode -cne 'full' -or
        [string]$metadata.BackupFile -cne [string]$pair.BackupFile -or
        [string]$metadata.BackupSha256 -cne [string]$pair.Sha256) {
        throw "$ExpectedRole backup metadata no longer matches its journaled authority."
    }
    return $pair
}

function Test-EasyFireEdgeIdentityEqual {
    param($Left, $Right)
    if (-not $Left -or -not $Right) { return $false }
    foreach ($field in @(
        'Mode','AccessAppId','AccessPolicyId','TunnelId','DnsRecordId',
        'ServiceName','ServiceExecutable','ServiceExecutableSha256',
        'ServiceCommandIdentity','ServiceProcessCreatedAtUtc',
        'TunnelHostname','TunnelOriginService','TunnelFallbackService',
        'TunnelConfigurationFingerprint','ConnectorClientId','ConnectorRunAtUtc',
        'ConnectorVersion','ConnectorArchitecture','ConnectorActiveConnectionCount',
        'ConnectorIdentityFingerprint'
    )) {
        if ([string](Get-EasyFireProperty -Object $Left -Name $field -Default '') -cne
            [string](Get-EasyFireProperty -Object $Right -Name $field -Default '')) {
            return $false
        }
    }
    return $true
}

function Assert-EasyFireJournalIdentity {
    param([Parameter(Mandatory = $true)]$Journal)
    if ([int](Get-EasyFireProperty -Object $Journal -Name 'SchemaVersion' -Default 0) -ne 2 -or
        [string]$Journal.ActionId -cne $ActionId -or
        [string]$Journal.ProjectName -cne $script:ProjectName -or
        [string]$Journal.Stage -cne 'Action' -or
        -not $script:AllowedTransitions.ContainsKey([string]$Journal.status)) {
        throw 'Journal identity or status is invalid.'
    }
    if ([string]$Journal.ControllerSha256 -cne $script:ControllerSha256 -or
        [string](Get-EasyFireProperty -Object $Journal -Name 'AuthorityOwnerSid' -Default '') -cne $script:AuthorityOwnerSid -or
        [string]$Journal.ReleaseArchive.Sha256 -cne $script:ActualArchiveSha256 -or
        [string]$Journal.ReleaseArchive.Path -cne $script:ResolvedReleaseArchive -or
        [string]$Journal.ReleaseArchive.ExtractDir -cne $script:ReleaseDirectory -or
        [string]$Journal.TargetImageTag -cne $script:TargetTag -or
        [string]$Journal.MariaDbImageTag -cne $script:MariaDbImageTag -or
        [string]$Journal.ExpectedVolumes.MariaDb -cne $script:ExpectedMysqlVolume -or
        [string]$Journal.ExpectedVolumes.Redis -cne $script:ExpectedRedisVolume -or
        [string]$Journal.CredentialEvidence.Path -cne $script:ResolvedCredentialFile -or
        [string]$Journal.CredentialEvidence.Sha256 -cne $script:CredentialSha256) {
        throw 'Journal authority is not bound to the current immutable inputs.'
    }
    $installedController = Join-Path $script:ReleaseDirectory 'deploy\windows\production-action.ps1'
    $isInstalledController = [string]::Equals(
        [IO.Path]::GetFullPath($script:ControllerPath),
        [IO.Path]::GetFullPath($installedController),
        [StringComparison]::OrdinalIgnoreCase
    )
    if ($Stage -eq 'ScheduledBackup' -and -not $isInstalledController) {
        throw 'Scheduled backup must run through the exact sealed installed controller.'
    }
    $bundleProperty = if ($isInstalledController) {
        'ScheduledControllerBundleAuthority'
    } else {
        'ControllerBundleAuthority'
    }
    $bundle = Get-EasyFireProperty -Object $Journal -Name $bundleProperty
    if (-not $bundle) { throw "Journal $bundleProperty is missing." }
    $null = Assert-EasyFireExecutableBundleAuthority -ExpectedAuthority $bundle -Paths $script:ControllerBundlePaths
}

function Get-EasyFireVerifiedCredential {
    $snapshot = Get-EasyFireCredentialSnapshot -Path $script:ResolvedCredentialFile
    if ([string]$snapshot.Sha256 -cne $script:CredentialSha256) {
        throw 'Cloudflare credential file changed after input binding.'
    }
    return $snapshot.Credential
}

function Write-EasyFirePreflightReceipt {
    param([Parameter(Mandatory = $true)]$Receipt)
    $path = Join-Path $script:JournalsRoot "$ActionId.preflight.json"
    $null = Write-EasyFireJsonAtomic -Path $path -Value $Receipt -AllowedRoot $script:JournalsRoot
    return $path
}

function Read-EasyFirePreflightReceipt {
    $path = Join-Path $script:JournalsRoot "$ActionId.preflight.json"
    return Read-EasyFireJson -Path $path -AllowedRoot $script:JournalsRoot
}

function Invoke-EasyFirePreflightStage {
    param($Journal)

    $status = if ($Journal) { [string]$Journal.status } else { 'none' }
    if ($PriorActionId) { throw 'DATABASE_ENGINE_MIGRATION_REQUIRED: PriorActionId is outside this fresh-install action.' }
    if ($Journal) {
        Assert-EasyFireJournalIdentity -Journal $Journal
        if ($status -eq 'rolled_back') { throw 'A rolled-back ActionId cannot be reused.' }
    } elseif (Test-Path -LiteralPath $script:ReleaseDirectory) {
        throw 'Release directory exists without this ActionId journal; refusing adoption.'
    }

    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('info')
    Assert-EasyFireNamedResourceIsolation
    $inventory = Get-EasyFireInventory
    Assert-EasyFireInventoryCompatible -Inventory $inventory -Status $status -Journal $Journal
    $releaseForTasks = if ($Journal) { [string]$Journal.ReleaseArchive.ExtractDir } else { $script:ReleaseDirectory }
    $null = Assert-EasyFireTasksForPhase -Status $status -ReleaseDirectory $releaseForTasks

    if ($Journal -and (Test-EasyFireAtOrAfter -Current $status -Target 'extracted')) {
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment:(
            Test-EasyFireAtOrAfter -Current $status -Target 'env_written'
        )
    }
    if ($Journal -and (Test-EasyFireAtOrAfter -Current $status -Target 'images_built')) {
        Assert-EasyFireBuiltImageAuthority -Journal $Journal
    }
    $archiveManifest = Get-EasyFireZipManifest -ArchivePath $script:ResolvedReleaseArchive
    if ($Journal -and (Test-EasyFireAtOrAfter -Current $status -Target 'extracted')) {
        if ([string]$Journal.ReleaseManifest.Sha256 -cne [string]$archiveManifest.Sha256 -or
            [int]$Journal.ReleaseManifest.FileCount -ne [int]$archiveManifest.FileCount) {
            throw 'Journal release manifest is not bound to the current archive.'
        }
    }

    $credential = Get-EasyFireVerifiedCredential
    $edge = Get-EasyFireVerifiedEdgeState -Credential $credential -Domain $script:Domain
    if ($Journal -and -not (Test-EasyFireEdgeIdentityEqual -Left $Journal.EdgeState -Right $edge)) {
        throw 'Verified edge identity drifted from the Action journal.'
    }
    $issued = (Get-Date).ToUniversalTime()
    $receipt = [pscustomobject]@{
        SchemaVersion = 2
        ActionId = $ActionId
        AuthorityOwnerSid = $script:AuthorityOwnerSid
        IssuedAtUtc = $issued.ToString('o')
        ExpiresAtUtc = $issued.AddMinutes(15).ToString('o')
        ControllerSha256 = $script:ControllerSha256
        ControllerBundleAuthority = $script:ControllerBundleAuthority
        ProductionRoot = $script:ResolvedProductionRoot
        ReleaseArchivePath = $script:ResolvedReleaseArchive
        ReleaseArchiveSha256 = $script:ActualArchiveSha256
        ArchiveManifest = $archiveManifest
        ReleaseDirectory = $script:ReleaseDirectory
        CredentialFile = $script:ResolvedCredentialFile
        CredentialSha256 = $script:CredentialSha256
        TargetImageTag = $script:TargetTag
        MariaDbImageTag = $script:MariaDbImageTag
        ExpectedMysqlVolume = $script:ExpectedMysqlVolume
        ExpectedRedisVolume = $script:ExpectedRedisVolume
        JournalStatus = $status
        InventoryFingerprint = Get-EasyFireInventoryFingerprint -Inventory $inventory
        EdgeState = $edge
    }
    $receiptPath = Write-EasyFirePreflightReceipt -Receipt $receipt
    Write-Host "PREFLIGHT_PASSED ActionId=$ActionId Receipt=$receiptPath"
}

function Assert-EasyFireActionReceipt {
    param($Journal)
    if (-not $ConfirmActionId) { throw 'ConfirmActionId is required for Stage Action.' }
    $canonicalConfirm = ConvertTo-EasyFireCanonicalActionId -ActionId $ConfirmActionId
    if ($canonicalConfirm -cne $ActionId) { throw 'ConfirmActionId must exactly match ActionId for Stage Action.' }
    if ($PriorActionId) { throw 'DATABASE_ENGINE_MIGRATION_REQUIRED: PriorActionId is outside this fresh-install action.' }
    $receipt = Read-EasyFirePreflightReceipt
    if (-not $receipt -or [int]$receipt.SchemaVersion -ne 2) { throw 'A current Preflight receipt is required.' }
    if ([DateTime]::Parse([string]$receipt.ExpiresAtUtc).ToUniversalTime() -lt (Get-Date).ToUniversalTime()) {
        throw 'Preflight receipt expired; run Preflight again.'
    }
    $receiptBundle = Get-EasyFireProperty -Object $receipt -Name 'ControllerBundleAuthority'
    if (-not $receiptBundle) { throw 'Preflight receipt controller-bundle authority is missing.' }
    $null = Assert-EasyFireExecutableBundleAuthority -ExpectedAuthority $receiptBundle -Paths $script:ControllerBundlePaths
    $status = if ($Journal) { [string]$Journal.status } else { 'none' }
    $inventory = Get-EasyFireInventory
    Assert-EasyFireNamedResourceIsolation
    Assert-EasyFireInventoryCompatible -Inventory $inventory -Status $status -Journal $Journal
    $archiveManifest = Get-EasyFireZipManifest -ArchivePath $script:ResolvedReleaseArchive
    $fieldsMatch = (
        [string]$receipt.ActionId -ceq $ActionId -and
        [string](Get-EasyFireProperty -Object $receipt -Name 'AuthorityOwnerSid' -Default '') -ceq $script:AuthorityOwnerSid -and
        [string]$receipt.ControllerSha256 -ceq $script:ControllerSha256 -and
        [string]$receipt.ProductionRoot -ceq $script:ResolvedProductionRoot -and
        [string]$receipt.ReleaseArchivePath -ceq $script:ResolvedReleaseArchive -and
        [string]$receipt.ReleaseArchiveSha256 -ceq $script:ActualArchiveSha256 -and
        [string]$receipt.ReleaseDirectory -ceq $script:ReleaseDirectory -and
        [string]$receipt.CredentialFile -ceq $script:ResolvedCredentialFile -and
        [string]$receipt.CredentialSha256 -ceq $script:CredentialSha256 -and
        [string]$receipt.TargetImageTag -ceq $script:TargetTag -and
        [string]$receipt.MariaDbImageTag -ceq $script:MariaDbImageTag -and
        [string]$receipt.ExpectedMysqlVolume -ceq $script:ExpectedMysqlVolume -and
        [string]$receipt.ExpectedRedisVolume -ceq $script:ExpectedRedisVolume -and
        [string]$receipt.JournalStatus -ceq $status -and
        [string]$receipt.InventoryFingerprint -ceq (Get-EasyFireInventoryFingerprint -Inventory $inventory) -and
        [string]$receipt.ArchiveManifest.Sha256 -ceq [string]$archiveManifest.Sha256 -and
        [int]$receipt.ArchiveManifest.FileCount -eq [int]$archiveManifest.FileCount
    )
    if (-not $fieldsMatch) { throw 'Preflight receipt no longer matches current authority.' }
    $credential = Get-EasyFireVerifiedCredential
    $edge = Get-EasyFireVerifiedEdgeState -Credential $credential -Domain $script:Domain
    if (-not (Test-EasyFireEdgeIdentityEqual -Left $receipt.EdgeState -Right $edge)) {
        throw 'Edge identity changed after Preflight.'
    }
    if ($Journal) {
        Assert-EasyFireJournalIdentity -Journal $Journal
        if (-not (Test-EasyFireEdgeIdentityEqual -Left $Journal.EdgeState -Right $edge)) {
            throw 'Journal edge identity changed after Preflight.'
        }
    }
    return $receipt
}

function New-EasyFireActionJournal {
    param([Parameter(Mandatory = $true)]$Receipt)
    $journal = [pscustomobject]@{
        SchemaVersion = 2
        ActionId = $ActionId
        AuthorityOwnerSid = [string]$Receipt.AuthorityOwnerSid
        ProjectName = $script:ProjectName
        Stage = 'Action'
        status = 'initialized'
        CreatedAtUtc = Get-EasyFireUtcNow
        UpdatedAtUtc = Get-EasyFireUtcNow
        ControllerSha256 = $script:ControllerSha256
        ControllerBundleAuthority = $script:ControllerBundleAuthority
        TargetImageTag = $script:TargetTag
        MariaDbImageTag = $script:MariaDbImageTag
        DatabaseMode = 'fresh'
        ReleaseArchive = [pscustomobject]@{
            Path = $script:ResolvedReleaseArchive
            Sha256 = $script:ActualArchiveSha256
            ExtractDir = $script:ReleaseDirectory
        }
        CredentialEvidence = [pscustomobject]@{
            Path = $script:ResolvedCredentialFile
            Sha256 = $script:CredentialSha256
        }
        ExpectedVolumes = [pscustomobject]@{
            MariaDb = $script:ExpectedMysqlVolume
            Redis = $script:ExpectedRedisVolume
        }
        EdgeState = $Receipt.EdgeState
        DataTierCreated = $false
        AppStarted = $false
    }
    Write-EasyFireTrackedJournal -Journal $journal
    return $journal
}

function Invoke-EasyFireActionStage {
    param($Journal)

    $receipt = Assert-EasyFireActionReceipt -Journal $Journal
    if (-not $Journal) {
        $Journal = New-EasyFireActionJournal -Receipt $receipt
    }
    $status = [string]$Journal.status
    if ($status -in @('action_completed_pending_postcheck', 'completed')) {
        Write-Host "ACTION_ALREADY_COMPLETE ActionId=$ActionId Status=$status"
        return
    }
    if ($status -in @('rollback_in_progress', 'rolled_back')) {
        throw 'Action cannot resume after rollback has begun.'
    }
    if (Test-EasyFireAtOrAfter -Current $status -Target 'images_built') {
        Assert-EasyFireBuiltImageAuthority -Journal $Journal
    }

    if ($status -in @('initialized', 'extracting')) {
        if ($status -eq 'initialized') {
            Set-EasyFireJournalStatus -Journal $Journal -Status 'extracting' -Inventory (Get-EasyFireInventory)
        }
        if (Test-Path -LiteralPath $script:ReleasesRoot) {
            Assert-EasyFireAuthorityTree -Path $script:ReleasesRoot
        } else {
            Protect-EasyFireAuthorityDirectory -Path $script:ReleasesRoot
        }
        if (-not (Test-Path -LiteralPath $script:ReleaseDirectory)) {
            $null = Expand-EasyFireZipRelease -ArchivePath $script:ResolvedReleaseArchive -DestinationPath $script:ReleaseDirectory -ReleasesRoot $script:ReleasesRoot -ActionId $ActionId
        }
        Assert-EasyFireAuthorityTree -Path $script:ReleaseDirectory
        Write-EasyFireReleaseManifestAuthority -Journal $Journal -ExpectedArchiveManifest $receipt.ArchiveManifest
        Set-EasyFireJournalStatus -Journal $Journal -Status 'extracted' -Inventory (Get-EasyFireInventory)
        $status = 'extracted'
    }

    if ($status -in @('extracted', 'env_writing')) {
        if ($status -eq 'extracted') {
            if (Test-Path -LiteralPath (Join-Path $script:ReleaseDirectory '.env')) {
                throw 'Unexpected runtime environment exists before env_writing authority.'
            }
            Set-EasyFireJournalStatus -Journal $Journal -Status 'env_writing' -Inventory (Get-EasyFireInventory)
        }
        $envFile = Join-Path $script:ReleaseDirectory '.env'
        $expectedCandidatePath = Join-Path $script:ReleasesRoot "env-candidate-$ActionId"
        $environmentPlan = Get-EasyFireProperty -Object $Journal -Name 'EnvironmentPlan'
        if (-not $environmentPlan) {
            if (Test-Path -LiteralPath $envFile) {
                throw 'Runtime environment exists without journaled publication authority.'
            }
            if (Test-Path -LiteralPath $expectedCandidatePath) {
                throw 'Runtime environment candidate exists without journaled authority.'
            }
            $environmentOperationId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
            $environmentPlan = [pscustomobject]@{
                SchemaVersion = 1
                OperationId = $environmentOperationId
                CandidatePath = $expectedCandidatePath
                PartialPath = "$expectedCandidatePath.$environmentOperationId.partial"
                TargetPath = $envFile
                Sha256 = ''
                State = 'planned'
                Published = $false
            }
            Set-EasyFireProperty -Object $Journal -Name 'EnvironmentPlan' -Value $environmentPlan
            Write-EasyFireTrackedJournal -Journal $Journal
        }
        $environmentOperationId = [string](Get-EasyFireProperty -Object $environmentPlan -Name 'OperationId' -Default '')
        $environmentState = [string](Get-EasyFireProperty -Object $environmentPlan -Name 'State' -Default '')
        $environmentHashAuthority = [string](Get-EasyFireProperty -Object $environmentPlan -Name 'Sha256' -Default '')
        $expectedPartialPath = "$expectedCandidatePath.$environmentOperationId.partial"
        if ([int](Get-EasyFireProperty -Object $environmentPlan -Name 'SchemaVersion' -Default 0) -ne 1 -or
            $environmentOperationId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or
            [string](Get-EasyFireProperty -Object $environmentPlan -Name 'TargetPath' -Default '') -cne $envFile -or
            [string](Get-EasyFireProperty -Object $environmentPlan -Name 'CandidatePath' -Default '') -cne $expectedCandidatePath -or
            [string](Get-EasyFireProperty -Object $environmentPlan -Name 'PartialPath' -Default '') -cne $expectedPartialPath -or
            $environmentState -notin @('planned', 'prepared', 'publishing', 'published') -or
            ($environmentState -ne 'planned' -and $environmentHashAuthority -notmatch '^[A-F0-9]{64}$') -or
            ($environmentState -eq 'planned' -and $environmentHashAuthority) -or
            ($environmentState -eq 'published') -ne [bool](Get-EasyFireProperty -Object $environmentPlan -Name 'Published' -Default $false)) {
            throw 'Runtime environment publication plan is invalid.'
        }
        $candidateExists = Test-Path -LiteralPath $expectedCandidatePath -PathType Leaf
        $partialExists = Test-Path -LiteralPath $expectedPartialPath -PathType Leaf
        $targetExists = Test-Path -LiteralPath $envFile -PathType Leaf
        if ($candidateExists -and $targetExists) {
            throw 'Runtime environment publication is ambiguous because candidate and target both exist.'
        }
        if ($environmentState -eq 'planned') {
            if ($targetExists -or ($candidateExists -and $partialExists)) {
                throw 'Planned runtime environment artifacts are ambiguous.'
            }
            if (-not $candidateExists) {
                $candidate = New-EasyFireEnvironmentCandidate -CandidatePath $expectedCandidatePath `
                    -PartialPath $expectedPartialPath -OperationId $environmentOperationId
                $candidateExists = $true
                $partialExists = $false
                $environmentHashAuthority = [string]$candidate.Sha256
            } else {
                Protect-EasyFireSecretFile -Path $expectedCandidatePath
                Assert-EasyFireEnvironmentOperationAuthority -Path $expectedCandidatePath -OperationId $environmentOperationId
                $null = Assert-EasyFireEnvironment -Path $expectedCandidatePath
                $environmentHashAuthority = Get-EasyFireSha256Hex -Path $expectedCandidatePath
            }
            Set-EasyFireProperty -Object $environmentPlan -Name 'Sha256' -Value $environmentHashAuthority
            Set-EasyFireProperty -Object $environmentPlan -Name 'State' -Value 'prepared'
            Write-EasyFireTrackedJournal -Journal $Journal
            $environmentState = 'prepared'
        }
        if ($environmentState -eq 'prepared') {
            if (-not $candidateExists -or $targetExists -or $partialExists) {
                throw 'Prepared runtime environment candidate is missing or ambiguous.'
            }
            Assert-EasyFireEnvironmentOperationAuthority -Path $expectedCandidatePath -OperationId $environmentOperationId
            $null = Assert-EasyFireEnvironment -Path $expectedCandidatePath
            if ((Get-EasyFireSha256Hex -Path $expectedCandidatePath) -cne $environmentHashAuthority) {
                throw 'Journaled runtime environment candidate is missing or changed.'
            }
            Set-EasyFireProperty -Object $environmentPlan -Name 'State' -Value 'publishing'
            Write-EasyFireTrackedJournal -Journal $Journal
            $environmentState = 'publishing'
        }
        if ($environmentState -eq 'publishing') {
            $candidateExists = Test-Path -LiteralPath $expectedCandidatePath -PathType Leaf
            $partialExists = Test-Path -LiteralPath $expectedPartialPath -PathType Leaf
            $targetExists = Test-Path -LiteralPath $envFile -PathType Leaf
            if ($partialExists -or ($candidateExists -and $targetExists) -or (-not $candidateExists -and -not $targetExists)) {
                throw 'Publishing runtime environment artifacts are missing or ambiguous.'
            }
            if ($candidateExists) {
                Assert-EasyFireEnvironmentOperationAuthority -Path $expectedCandidatePath -OperationId $environmentOperationId
                $null = Assert-EasyFireEnvironment -Path $expectedCandidatePath
                if ((Get-EasyFireSha256Hex -Path $expectedCandidatePath) -cne $environmentHashAuthority) {
                    throw 'Journaled runtime environment candidate is missing or changed.'
                }
                Move-Item -LiteralPath $expectedCandidatePath -Destination $envFile -ErrorAction Stop
            }
            Protect-EasyFireSecretFile -Path $envFile
            Assert-EasyFireEnvironmentOperationAuthority -Path $envFile -OperationId $environmentOperationId
            $null = Assert-EasyFireEnvironment -Path $envFile
            $environmentHash = Get-EasyFireSha256Hex -Path $envFile
            if ($environmentHash -cne $environmentHashAuthority) {
                throw 'Published runtime environment does not match its journaled candidate.'
            }
            $boundEnvironmentHash = [string](Get-EasyFireProperty -Object $Journal -Name 'EnvironmentSha256' -Default '')
            if ($boundEnvironmentHash -and $boundEnvironmentHash -cne $environmentHash) {
                throw 'Runtime environment changed during env_writing.'
            }
            Set-EasyFireProperty -Object $environmentPlan -Name 'State' -Value 'published'
            Set-EasyFireProperty -Object $environmentPlan -Name 'Published' -Value $true
            Set-EasyFireProperty -Object $Journal -Name 'EnvironmentSha256' -Value $environmentHash
            Write-EasyFireTrackedJournal -Journal $Journal
            $environmentState = 'published'
        }
        if ($environmentState -ne 'published' -or
            -not [bool](Get-EasyFireProperty -Object $environmentPlan -Name 'Published' -Default $false) -or
            (Test-Path -LiteralPath $expectedCandidatePath) -or
            (Test-Path -LiteralPath $expectedPartialPath)) {
            throw 'Runtime environment publication did not reach exact published authority.'
        }
        Assert-EasyFireEnvironmentOperationAuthority -Path $envFile -OperationId $environmentOperationId
        $null = Assert-EasyFireEnvironment -Path $envFile
        $environmentHash = Get-EasyFireSha256Hex -Path $envFile
        if ($environmentHash -cne $environmentHashAuthority) {
            throw 'Published runtime environment does not match its journaled candidate.'
        }
        $boundEnvironmentHash = [string](Get-EasyFireProperty -Object $Journal -Name 'EnvironmentSha256' -Default '')
        if ($boundEnvironmentHash -cne $environmentHash) {
            throw 'Published runtime environment is not bound to the journal.'
        }
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        Set-EasyFireJournalStatus -Journal $Journal -Status 'env_written' -Inventory (Get-EasyFireInventory)
        $status = 'env_written'
    }

    if ($status -in @('env_written', 'images_building')) {
        $expectedImageReferences = @(Get-EasyFireBuiltImageReferences)
        $imageBuildPlan = Get-EasyFireProperty -Object $Journal -Name 'ImageBuildPlan'
        if ($status -eq 'env_written') {
            if (-not $imageBuildPlan) {
                Assert-EasyFireBuiltImageTagsAbsent
                $imageBuildPlan = [pscustomobject]@{
                    SchemaVersion = 1
                    ActionId = $ActionId
                    ArchiveSha256 = [string]$Journal.ReleaseArchive.Sha256
                    ImageReferences = $expectedImageReferences
                    State = 'planned'
                }
                Set-EasyFireProperty -Object $Journal -Name 'ImageBuildPlan' -Value $imageBuildPlan
                Write-EasyFireTrackedJournal -Journal $Journal
            }
            Set-EasyFireJournalStatus -Journal $Journal -Status 'images_building' -Inventory (Get-EasyFireInventory)
        }
        if (-not $imageBuildPlan) {
            throw 'Journal image-build plan is missing or invalid.'
        }
        $plannedImageReferences = @((Get-EasyFireProperty -Object $imageBuildPlan -Name 'ImageReferences' -Default @()))
        $imageBuildState = [string](Get-EasyFireProperty -Object $imageBuildPlan -Name 'State' -Default '')
        if ([int](Get-EasyFireProperty -Object $imageBuildPlan -Name 'SchemaVersion' -Default 0) -ne 1 -or
            [string](Get-EasyFireProperty -Object $imageBuildPlan -Name 'ActionId' -Default '') -cne $ActionId -or
            [string](Get-EasyFireProperty -Object $imageBuildPlan -Name 'ArchiveSha256' -Default '') -cne [string]$Journal.ReleaseArchive.Sha256 -or
            $plannedImageReferences.Count -ne $expectedImageReferences.Count -or
            @(Compare-Object @($plannedImageReferences | Sort-Object) @($expectedImageReferences | Sort-Object) -CaseSensitive).Count -ne 0 -or
            $imageBuildState -notin @('planned', 'completed')) {
            throw 'Journal image-build plan is missing or invalid.'
        }
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        $establishedImageAuthority = Get-EasyFireProperty -Object $Journal -Name 'BuiltImageAuthority'
        if (-not $establishedImageAuthority) {
            if ($imageBuildState -cne 'planned') {
                throw 'Completed image-build plan is missing its built-image authority.'
            }
            Remove-EasyFireJournalOwnedImageTags -ImageReferences $plannedImageReferences
            $null = Invoke-EasyFireCompose -ReleaseDirectory $script:ReleaseDirectory -Arguments @('config')
            $null = Invoke-EasyFireCompose -ReleaseDirectory $script:ReleaseDirectory -Arguments @('build', '--pull', '--no-cache')
            $observedImageAuthority = Get-EasyFireExpectedImageAuthority -ImageReferences $plannedImageReferences
            Set-EasyFireProperty -Object $Journal -Name 'BuiltImageAuthority' -Value $observedImageAuthority
            Set-EasyFireProperty -Object $imageBuildPlan -Name 'State' -Value 'completed'
            Write-EasyFireTrackedJournal -Journal $Journal
            $establishedImageAuthority = $observedImageAuthority
            $imageBuildState = 'completed'
        }
        if ($imageBuildState -cne 'completed') {
            throw 'Built-image authority cannot exist before the image-build plan completes.'
        }
        $observedImageAuthority = Get-EasyFireExpectedImageAuthority -ImageReferences $plannedImageReferences
        if (-not (Test-EasyFireExpectedImageAuthorityEqual -EstablishedAuthority $establishedImageAuthority -ObservedAuthority $observedImageAuthority)) {
            throw 'Built-image authority cannot be rewritten on resume.'
        }
        $inventory = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'images_built' -Journal $Journal
        Set-EasyFireJournalStatus -Journal $Journal -Status 'images_built' -Inventory $inventory
        $status = 'images_built'
    }

    if ($status -in @('images_built', 'data_tier_starting')) {
        Assert-EasyFireBuiltImageAuthority -Journal $Journal
        if ($status -eq 'images_built') {
            $null = Initialize-EasyFireDurableVolumePlan -Journal $Journal
            Set-EasyFireJournalStatus -Journal $Journal -Status 'data_tier_starting' -Inventory (Get-EasyFireInventory)
        }
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        $beforeDataStart = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $beforeDataStart -Status 'data_tier_starting' -Journal $Journal
        $null = Update-EasyFireDurableVolumePlan -Journal $Journal -Inventory $beforeDataStart
        $null = Invoke-EasyFireCompose -ReleaseDirectory $script:ReleaseDirectory -Arguments @('up', '-d', 'mysql', 'redis')
        $afterDataStart = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $afterDataStart -Status 'data_tier_starting' -Journal $Journal
        $null = Update-EasyFireDurableVolumePlan -Journal $Journal -Inventory $afterDataStart
        $inventory = Wait-EasyFireServicesHealthy -Services @('mysql', 'redis')
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'data_tier_ready' -Journal $Journal
        $plan = Update-EasyFireDurableVolumePlan -Journal $Journal -Inventory $inventory
        if (@($plan.ObservedVolumes).Count -ne 2) {
            throw 'Data tier did not bind both exact durable volumes.'
        }
        Set-EasyFireProperty -Object $Journal -Name 'DurableVolumeFingerprint' -Value (
            Get-EasyFireVolumeFingerprint -Volumes @($inventory.Volumes)
        )
        Set-EasyFireProperty -Object $Journal -Name 'DataTierCreated' -Value $true
        Set-EasyFireJournalStatus -Journal $Journal -Status 'data_tier_ready' -Inventory $inventory
        $status = 'data_tier_ready'
    }

    if ($status -in @('data_tier_ready', 'migration_preparing', 'migration_running')) {
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        if ($status -eq 'data_tier_ready') {
            if (Get-EasyFireProperty -Object $Journal -Name 'MigrationAttempt') {
                throw 'Migration attempt authority exists before its preparing phase.'
            }
            Set-EasyFireProperty -Object $Journal -Name 'MigrationAttempt' -Value ([pscustomobject]@{
                AttemptId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
                PreparedAtUtc = Get-EasyFireUtcNow
                ContainerAuthority = $null
                StartAuthorizedAtUtc = $null
            })
            Set-EasyFireJournalStatus -Journal $Journal -Status 'migration_preparing' -Inventory (Get-EasyFireInventory)
            $status = 'migration_preparing'
        }
        $attempt = Get-EasyFireProperty -Object $Journal -Name 'MigrationAttempt'
        if (-not $attempt -or [string]$attempt.AttemptId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') {
            throw 'Migration attempt authority is invalid.'
        }
        $current = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $current -Status $status -Journal $Journal
        $migration = @($current.Containers | Where-Object { $_.Service -eq 'database_migration' })
        if ($status -eq 'migration_preparing') {
            if (-not $attempt.ContainerAuthority) {
                if ($migration.Count -eq 0) {
                    $null = Invoke-EasyFireCompose -ReleaseDirectory $script:ReleaseDirectory -Arguments @(
                        'create', '--no-build', 'database_migration'
                    )
                    $current = Get-EasyFireInventory
                    Assert-EasyFireInventoryCompatible -Inventory $current -Status 'migration_preparing' -Journal $Journal
                    $migration = @($current.Containers | Where-Object { $_.Service -eq 'database_migration' })
                }
                if ($migration.Count -ne 1 -or [string]$migration[0].State -cne 'created') {
                    throw 'Migration preparation requires one exact never-started container.'
                }
                Set-EasyFireProperty -Object $attempt -Name 'ContainerAuthority' -Value (
                    Get-EasyFireMigrationContainerAuthority -Container $migration[0]
                )
                Write-EasyFireTrackedJournal -Journal $Journal
            } else {
                if ($migration.Count -ne 1) {
                    throw 'Journaled migration container is missing; it will never be recreated.'
                }
                Assert-EasyFireMigrationContainerAuthority -Container $migration[0] -Expected $attempt.ContainerAuthority
            }
            Set-EasyFireJournalStatus -Journal $Journal -Status 'migration_running' -Inventory $current
            $status = 'migration_running'
        }
        $current = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $current -Status 'migration_running' -Journal $Journal
        $migration = @($current.Containers | Where-Object { $_.Service -eq 'database_migration' })
        if ($migration.Count -ne 1) {
            throw 'Journaled migration container is missing; replay is forbidden.'
        }
        Assert-EasyFireMigrationContainerAuthority -Container $migration[0] -Expected $attempt.ContainerAuthority
        if ([string]$migration[0].State -ceq 'created') {
            if (-not $attempt.StartAuthorizedAtUtc) {
                Set-EasyFireProperty -Object $attempt -Name 'StartAuthorizedAtUtc' -Value (Get-EasyFireUtcNow)
                Write-EasyFireTrackedJournal -Journal $Journal
            }
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('start', [string]$attempt.ContainerAuthority.Id)
            $inventory = Wait-EasyFireMigrationTerminal -Journal $Journal
        } elseif ([string]$migration[0].State -ceq 'running') {
            if (-not $attempt.StartAuthorizedAtUtc) { throw 'Running migration lacks start authority.' }
            $inventory = Wait-EasyFireMigrationTerminal -Journal $Journal
        } elseif ([string]$migration[0].State -ceq 'exited') {
            if (-not $attempt.StartAuthorizedAtUtc) { throw 'Exited migration lacks start authority.' }
            Assert-EasyFireMigrationSucceeded -Inventory $current
            $inventory = $current
        } else {
            throw 'Migration resume found an ambiguous or unsafe migration container state.'
        }
        Assert-EasyFireMigrationSucceeded -Inventory $inventory
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'migration_complete' -Journal $Journal
        Set-EasyFireJournalStatus -Journal $Journal -Status 'migration_complete' -Inventory $inventory
        $status = 'migration_complete'
    }

    if ($status -in @('migration_complete', 'baseline_backup_running')) {
        if ($status -eq 'migration_complete') {
            if (Test-Path -LiteralPath $script:BackupsRoot) {
                Assert-EasyFireAuthorityTree -Path $script:BackupsRoot
            } else {
                Protect-EasyFireAuthorityDirectory -Path $script:BackupsRoot
            }
            Set-EasyFireJournalStatus -Journal $Journal -Status 'baseline_backup_running' -Inventory (Get-EasyFireInventory)
        }
        $null = Get-EasyFireVerifiedBackupReceipt -Journal $Journal -Kind 'Baseline'
        $inventory = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'baseline_backup_ready' -Journal $Journal
        Set-EasyFireJournalStatus -Journal $Journal -Status 'baseline_backup_ready' -Inventory $inventory
        $status = 'baseline_backup_ready'
    }

    if ($status -in @('baseline_backup_ready', 'app_tier_starting')) {
        if ($status -eq 'baseline_backup_ready') {
            Set-EasyFireJournalStatus -Journal $Journal -Status 'app_tier_starting' -Inventory (Get-EasyFireInventory)
        }
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        $null = Invoke-EasyFireCompose -ReleaseDirectory $script:ReleaseDirectory -Arguments @(
            'up','-d','--no-deps','server','webapp','envoy','gotenberg'
        )
        $inventory = Wait-EasyFireServicesHealthy -Services $script:RuntimeServices
        Assert-EasyFireMigrationSucceeded -Inventory $inventory
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'app_tier_ready' -Journal $Journal
        $fingerprint = Get-EasyFireInventoryFingerprint -Inventory $inventory
        $existingApproved = Get-EasyFireProperty -Object $Journal -Name 'ApprovedInventoryFingerprint' -Default ''
        if ($existingApproved -and [string]$existingApproved -cne $fingerprint) {
            throw 'Approved container identity cannot be rewritten.'
        }
        if (-not $existingApproved) {
            Set-EasyFireProperty -Object $Journal -Name 'ApprovedInventory' -Value $inventory
            Set-EasyFireProperty -Object $Journal -Name 'ApprovedInventoryFingerprint' -Value $fingerprint
        }
        Set-EasyFireProperty -Object $Journal -Name 'AppStarted' -Value $true
        Set-EasyFireJournalStatus -Journal $Journal -Status 'app_tier_ready' -Inventory $inventory
        $status = 'app_tier_ready'
    }

    if ($status -in @('app_tier_ready', 'tasks_registering')) {
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        $installedController = Join-Path $script:ReleaseDirectory 'deploy\windows\production-action.ps1'
        $installedBundlePaths = @(Get-EasyFireControllerBundlePaths -ControllerPath $installedController)
        $installedBundle = Get-EasyFireExecutableBundleAuthority -Paths $installedBundlePaths
        Assert-EasyFireControllerBundleContentEqual -Left $script:ControllerBundleAuthority -Right $installedBundle
        $establishedInstalledBundle = Get-EasyFireProperty -Object $Journal -Name 'ScheduledControllerBundleAuthority'
        if ($establishedInstalledBundle) {
            $null = Assert-EasyFireExecutableBundleAuthority `
                -ExpectedAuthority $establishedInstalledBundle -Paths $installedBundlePaths
        } else {
            Set-EasyFireProperty -Object $Journal -Name 'ScheduledControllerBundleAuthority' -Value $installedBundle
            Write-EasyFireTrackedJournal -Journal $Journal
        }
        $definitions = @(Get-EasyFireTaskDefinitions -ReleaseDirectory $script:ReleaseDirectory)
        if ($status -eq 'app_tier_ready') {
            Set-EasyFireProperty -Object $Journal -Name 'ScheduledTasks' -Value $definitions
            Write-EasyFireTrackedJournal -Journal $Journal
            Set-EasyFireJournalStatus -Journal $Journal -Status 'tasks_registering' -Inventory (Get-EasyFireInventory)
        }
        Register-EasyFireTasks -Definitions $definitions
        $null = Assert-EasyFireTasksForPhase -Status 'action_completed_pending_postcheck' -ReleaseDirectory $script:ReleaseDirectory
        $inventory = Get-EasyFireInventory
        Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'action_completed_pending_postcheck' -Journal $Journal
        if ((Get-EasyFireInventoryFingerprint -Inventory $inventory) -cne [string]$Journal.ApprovedInventoryFingerprint) {
            throw 'Container identity changed during scheduled-task registration.'
        }
        Set-EasyFireJournalStatus -Journal $Journal -Status 'action_completed_pending_postcheck' -Inventory $inventory
    }
    Write-Host "ACTION_PASSED_PENDING_POSTCHECK ActionId=$ActionId"
}

function Assert-EasyFireRuntimeSignupLock {
    param([Parameter(Mandatory = $true)]$Inventory)
    $server = @($Inventory.Containers | Where-Object { $_.Service -eq 'server' })
    if ($server.Count -ne 1) { throw 'Exact server container is unavailable.' }
    $result = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'inspect', '--format={{range .Config.Env}}{{println .}}{{end}}', [string]$server[0].Id
    )
    $environment = @{}
    foreach ($line in @($result.Output)) {
        $text = ([string]$line).Trim()
        $separator = $text.IndexOf('=')
        if ($separator -gt 0) {
            $environment[$text.Substring(0, $separator)] = $text.Substring($separator + 1)
        }
    }
    if ([string]$environment.SIGNUP_DISABLED -cne 'true' -or
        [string]$environment.SIGNUP_ALLOWED_DOMAINS -cne '' -or
        [string]$environment.SIGNUP_ALLOWED_EMAILS -cne '') {
        throw 'Server runtime signup lock is not exact.'
    }
}

function Assert-EasyFireLocalHealth {
    foreach ($uri in @('http://127.0.0.1:80/api/system_db', 'http://127.0.0.1:80/')) {
        $result = Test-EasyFireHttp -Uri $uri -TimeoutSec 20
        if (-not $result.Reachable -or $result.StatusCode -lt 200 -or $result.StatusCode -ge 400) {
            throw "Local health failed for $uri."
        }
    }
}

function Invoke-EasyFirePostcheckStage {
    param([Parameter(Mandatory = $true)]$Journal)
    Assert-EasyFireJournalIdentity -Journal $Journal
    if ([string]$Journal.status -notin @('action_completed_pending_postcheck', 'completed')) {
        throw 'Postcheck requires an Action-complete journal.'
    }
    $validation = Test-EasyFireProductionJournal -Journal $Journal -ExpectedActionId $ActionId -ProductionRoot $script:ResolvedProductionRoot -ProjectName $script:ProjectName -AllowedStatuses @('action_completed_pending_postcheck', 'completed')
    if (-not $validation.Valid) { throw "Journal release validation failed: $($validation.Reason)" }
    Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
    Assert-EasyFireBuiltImageAuthority -Journal $Journal
    $null = Assert-EasyFireEnvironment -Path (Join-Path $script:ReleaseDirectory '.env')
    $inventory = Get-EasyFireInventory
    Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'action_completed_pending_postcheck' -Journal $Journal
    $fingerprint = Get-EasyFireInventoryFingerprint -Inventory $inventory
    if ($fingerprint -cne [string]$Journal.ApprovedInventoryFingerprint) {
        throw 'Postcheck refuses to adopt changed container, image, network, or mount identities.'
    }
    foreach ($service in $script:RuntimeServices) {
        $container = @($inventory.Containers | Where-Object { $_.Service -eq $service })
        if ($container.Count -ne 1 -or $container[0].State -cne 'running' -or
            $container[0].Health -cne 'healthy') {
            throw "Runtime service is not healthy: $service"
        }
    }
    Assert-EasyFireMigrationSucceeded -Inventory $inventory
    $null = Assert-EasyFireTasksForPhase -Status 'action_completed_pending_postcheck' -ReleaseDirectory $script:ReleaseDirectory
    Assert-EasyFireRuntimeSignupLock -Inventory $inventory
    Assert-EasyFireLocalHealth

    Assert-EasyFireAuthorityTree -Path $script:BackupsRoot
    $baseline = Get-EasyFireProperty -Object $Journal -Name 'BaselineBackup'
    if (-not $baseline) { throw 'Baseline backup receipt is missing.' }
    $pair = Assert-EasyFireBackupReceiptRecoveryUnit -Receipt $baseline -ExpectedRole 'Baseline'

    $credential = Get-EasyFireVerifiedCredential
    $edge = Get-EasyFireVerifiedEdgeState -Credential $credential -Domain $script:Domain
    if (-not (Test-EasyFireEdgeIdentityEqual -Left $Journal.EdgeState -Right $edge)) {
        throw 'Postcheck edge identity drifted.'
    }
    $public = Test-EasyFireHttp -Uri "https://$($script:Domain)/" -TimeoutSec 20 -NoRedirect
    try { $accessUri = [Uri]([string]$public.Location) }
    catch { $accessUri = $null }
    if (-not $public.Reachable -or $public.StatusCode -notin @(301, 302, 303, 307, 308) -or
        -not $accessUri -or -not $accessUri.IsAbsoluteUri -or
        $accessUri.Scheme -cne 'https' -or $accessUri.Port -ne 443 -or
        $accessUri.Host -notmatch '^[a-z0-9-]+\.cloudflareaccess\.com$' -or
        -not $accessUri.AbsolutePath.StartsWith('/cdn-cgi/access/', [StringComparison]::Ordinal)) {
        throw 'Unauthenticated public request is not protected by the exact Access redirect.'
    }

    if ([string]$Journal.status -ne 'completed') {
        Set-EasyFireProperty -Object $Journal -Name 'Postcheck' -Value ([pscustomobject]@{
            CompletedAtUtc = Get-EasyFireUtcNow
            InventoryFingerprint = $fingerprint
            EdgeState = $edge
            LocalHealth = 'passed'
            AccessRedirect = 'passed'
            SignupLock = 'passed'
            BaselineBackupSha256 = [string]$pair.Sha256
            BaselineBackupMetadataSha256 = [string]$baseline.MetadataSha256
        })
        Set-EasyFireJournalStatus -Journal $Journal -Status 'completed' -Inventory $inventory
    }
    Write-Host "POSTCHECK_PASSED ActionId=$ActionId"
}

function Invoke-EasyFireScheduledBackupStage {
    param([Parameter(Mandatory = $true)]$Journal)
    Assert-EasyFireJournalIdentity -Journal $Journal
    if ([string]$Journal.status -cne 'completed') {
        throw 'Scheduled backup requires one completed Action journal.'
    }
    $validation = Test-EasyFireProductionJournal -Journal $Journal -ExpectedActionId $ActionId `
        -ProductionRoot $script:ResolvedProductionRoot -ProjectName $script:ProjectName -AllowedStatuses @('completed')
    if (-not $validation.Valid) { throw "Scheduled backup journal validation failed: $($validation.Reason)" }
    Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
    $inventory = Get-EasyFireInventory
    Assert-EasyFireInventoryCompatible -Inventory $inventory -Status 'completed' -Journal $Journal
    if ((Get-EasyFireInventoryFingerprint -Inventory $inventory) -cne
        [string]$Journal.ApprovedInventoryFingerprint) {
        throw 'Scheduled backup refuses changed production inventory.'
    }
    $mysql = @($inventory.Containers | Where-Object { $_.Service -eq 'mysql' })
    if ($mysql.Count -ne 1 -or [string]$mysql[0].State -cne 'running' -or
        [string]$mysql[0].Health -cne 'healthy') {
        throw 'Scheduled backup requires the exact healthy MariaDB container.'
    }
    $null = Assert-EasyFireTasksForPhase -Status 'completed' -ReleaseDirectory $script:ReleaseDirectory

    Assert-EasyFireAuthorityTree -Path $script:BackupsRoot
    $plan = Get-EasyFireProperty -Object $Journal -Name 'ScheduledBackupPlan'
    if (-not $plan -or [string]$plan.State -cne 'active') {
        $plan = [pscustomobject]@{
            BackupOperationId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
            InvocationRole = 'Scheduled'
            BackupMode = 'full'
            StartedAtUtc = Get-EasyFireUtcNow
            State = 'active'
        }
        Set-EasyFireProperty -Object $Journal -Name 'ScheduledBackupPlan' -Value $plan
        Set-EasyFireProperty -Object $Journal -Name 'ScheduledBackupCandidate' -Value $null
        Write-EasyFireTrackedJournal -Journal $Journal
    }
    $receipt = Get-EasyFireVerifiedBackupReceipt -Journal $Journal -Kind 'Scheduled'
    Write-Host "SCHEDULED_BACKUP_PASSED ActionId=$ActionId BackupOperationId=$($receipt.BackupOperationId)"
}

function Test-EasyFireInventorySubsetOfApproved {
    param(
        [Parameter(Mandatory = $true)]$Current,
        [Parameter(Mandatory = $true)]$Approved
    )
    $approvedContainers = @{}
    foreach ($container in @($Approved.Containers)) { $approvedContainers[[string]$container.Id] = $true }
    foreach ($container in @($Current.Containers)) {
        if (-not $approvedContainers.ContainsKey([string]$container.Id)) { return $false }
    }
    $approvedNetworks = @{}
    foreach ($network in @($Approved.Networks)) { $approvedNetworks[[string]$network.Id] = $true }
    foreach ($network in @($Current.Networks)) {
        if (-not $approvedNetworks.ContainsKey([string]$network.Id)) { return $false }
    }
    $approvedVolumes = @{}
    foreach ($volume in @($Approved.Volumes)) { $approvedVolumes[[string]$volume.Name] = $true }
    foreach ($volume in @($Current.Volumes)) {
        if (-not $approvedVolumes.ContainsKey([string]$volume.Name)) { return $false }
    }
    if ((Get-EasyFireVolumeFingerprint -Volumes @($Current.Volumes)) -cne
        (Get-EasyFireVolumeFingerprint -Volumes @($Approved.Volumes))) { return $false }
    return $true
}

function Enter-EasyFireBackupFence {
    if ($script:BackupMutexAcquired) { return }
    $backupMutexName = Get-EasyFireBackupMutexName -ProductionRoot $script:ResolvedProductionRoot
    $script:BackupMutex = New-Object Threading.Mutex($false, $backupMutexName)
    try {
        $script:BackupMutexAcquired = $script:BackupMutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $script:BackupMutexAcquired = $true
    }
    if (-not $script:BackupMutexAcquired) {
        throw 'A journal-aware EasyFire backup is still running; rollback teardown is fenced.'
    }
}

function Assert-EasyFireRollbackReadback {
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)]$Inventory
    )
    if (@($Inventory.Containers).Count -ne 0 -or @($Inventory.Networks).Count -ne 0) {
        throw 'Rolled-back readback found surviving Action containers or network.'
    }
    $expectedNames = @($script:ExpectedMysqlVolume, $script:ExpectedRedisVolume)
    $foreign = @((Get-EasyFireProperty -Object $Inventory -Name 'ReservedVolumeNames' -Default @()) |
        Where-Object { [string]$_ -notin $expectedNames })
    if ($foreign.Count -gt 0) { throw 'Rolled-back readback found foreign or historical durable volumes.' }
    Assert-EasyFirePreservedPlannedVolumes -Journal $Journal -Inventory $Inventory
    foreach ($definition in @(Get-EasyFireTaskDefinitions -ReleaseDirectory $script:ReleaseDirectory)) {
        if (Get-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -ErrorAction SilentlyContinue) {
            throw 'Rolled-back readback found a surviving Action scheduled task.'
        }
    }
    Assert-EasyFireRetiredTasksAbsent
    $rollback = Get-EasyFireProperty -Object $Journal -Name 'Rollback'
    if (-not $rollback -or -not [bool]$rollback.ComposeTeardownCompleted -or
        -not [bool]$rollback.TaskRemovalCompleted) {
        throw 'Rolled-back journal lacks completed teardown authority.'
    }
    if ([bool]$rollback.AppEverStarted) {
        Assert-EasyFireAuthorityTree -Path $script:BackupsRoot
        $emergency = Get-EasyFireProperty -Object $Journal -Name 'EmergencyBackup'
        if (-not $emergency) { throw 'Rolled-back application lacks its emergency backup receipt.' }
        $null = Assert-EasyFireBackupReceiptRecoveryUnit -Receipt $emergency -ExpectedRole 'Emergency'
    }
}

function Invoke-EasyFireRollbackStage {
    param([Parameter(Mandatory = $true)]$Journal)
    if (-not $ConfirmActionId) { throw 'ConfirmActionId is required for Stage Rollback.' }
    $canonicalConfirm = ConvertTo-EasyFireCanonicalActionId -ActionId $ConfirmActionId
    if ($canonicalConfirm -cne $ActionId) { throw 'ConfirmActionId must exactly match ActionId for Stage Rollback.' }
    Assert-EasyFireJournalIdentity -Journal $Journal
    if ([string]$Journal.status -eq 'rolled_back') {
        $readbackInventory = Get-EasyFireInventory
        Assert-EasyFireNamedResourceIsolation
        Assert-EasyFireRollbackReadback -Journal $Journal -Inventory $readbackInventory
        Write-Host "ROLLBACK_ALREADY_COMPLETE ActionId=$ActionId"
        return
    }

    $statusBeforeRollback = [string]$Journal.status
    $current = Get-EasyFireInventory
    Assert-EasyFireNamedResourceIsolation
    if ($statusBeforeRollback -eq 'rollback_in_progress') {
        $approved = Get-EasyFireProperty -Object $Journal -Name 'ApprovedInventory'
        if ($approved -and -not (Test-EasyFireInventorySubsetOfApproved -Current $current -Approved $approved)) {
            throw 'Rollback encountered a container or network identity outside its approved inventory.'
        }
        Assert-EasyFireInventoryCompatible -Inventory $current -Status 'rollback_in_progress' -Journal $Journal
    } else {
        Assert-EasyFireInventoryCompatible -Inventory $current -Status $statusBeforeRollback -Journal $Journal
        $approved = Get-EasyFireProperty -Object $Journal -Name 'ApprovedInventory'
        if ($approved -and (Get-EasyFireInventoryFingerprint -Inventory $current) -cne
            [string]$Journal.ApprovedInventoryFingerprint) {
            throw 'Rollback refuses a recreated or drifted approved stack.'
        }
    }
    if (Get-EasyFireProperty -Object $Journal -Name 'DurableVolumePlan') {
        $null = Update-EasyFireDurableVolumePlan -Journal $Journal -Inventory $current
    }
    Assert-EasyFireRetiredTasksAbsent

    $rollback = Get-EasyFireProperty -Object $Journal -Name 'Rollback'
    if (-not $rollback) {
        $appEverStarted = [bool](Get-EasyFireProperty -Object $Journal -Name 'AppStarted' -Default $false)
        if (-not $appEverStarted -and $statusBeforeRollback -in $script:PhaseOrder) {
            $appEverStarted = Test-EasyFireAtOrAfter -Current $statusBeforeRollback -Target 'app_tier_starting'
        }
        $rollback = [pscustomobject]@{
            StartedAtUtc = Get-EasyFireUtcNow
            FromStatus = $statusBeforeRollback
            AppEverStarted = $appEverStarted
            TaskRemovalCompleted = $false
            ComposeTeardownCompleted = $false
        }
        Set-EasyFireProperty -Object $Journal -Name 'Rollback' -Value $rollback
        Write-EasyFireTrackedJournal -Journal $Journal
    }
    if ([string]$Journal.status -ne 'rollback_in_progress') {
        Set-EasyFireJournalStatus -Journal $Journal -Status 'rollback_in_progress' -Inventory $current
    }

    $hasManifest = $null -ne (Get-EasyFireProperty -Object $Journal -Name 'ReleaseManifest')
    if ([bool]$rollback.AppEverStarted) {
        if (-not $hasManifest) { throw 'Rollback cannot protect application data without a sealed release.' }
        $existingEmergencyReceipt = Get-EasyFireProperty -Object $Journal -Name 'EmergencyBackup'
        if (Test-Path -LiteralPath $script:BackupsRoot) {
            Assert-EasyFireAuthorityTree -Path $script:BackupsRoot
        } elseif ($existingEmergencyReceipt) {
            throw 'Rollback emergency backup root is missing.'
        } else {
            Protect-EasyFireAuthorityDirectory -Path $script:BackupsRoot
        }
        if (-not $existingEmergencyReceipt) {
            $mysql = @($current.Containers | Where-Object { $_.Service -eq 'mysql' })
            if ($mysql.Count -ne 1 -or $mysql[0].State -cne 'running' -or $mysql[0].Health -cne 'healthy') {
                throw 'Rollback requires the exact healthy MariaDB container to create its emergency backup.'
            }
        }
        $null = Get-EasyFireVerifiedBackupReceipt -Journal $Journal -Kind 'Emergency'
    }
    Enter-EasyFireBackupFence

    $expectedDefinitions = @(Get-EasyFireTaskDefinitions -ReleaseDirectory $script:ReleaseDirectory)
    $plannedDefinitions = Get-EasyFireProperty -Object $Journal -Name 'ScheduledTasks'
    $definitions = @()
    if ($plannedDefinitions) {
        $definitions = @($plannedDefinitions)
        if (($definitions | ConvertTo-Json -Depth 5 -Compress) -cne
            ($expectedDefinitions | ConvertTo-Json -Depth 5 -Compress)) {
            throw 'Rollback scheduled-task authority does not match the sealed release.'
        }
    } else {
        foreach ($definition in $expectedDefinitions) {
            if (Get-ScheduledTask -TaskPath $definition.TaskPath -TaskName $definition.Name -ErrorAction SilentlyContinue) {
                throw 'Scheduled task exists without a journaled registration plan.'
            }
        }
    }
    if (-not [bool]$rollback.TaskRemovalCompleted) {
        Remove-EasyFireActionTasks -Definitions $definitions
        Set-EasyFireProperty -Object $rollback -Name 'TaskRemovalCompleted' -Value $true
        Write-EasyFireTrackedJournal -Journal $Journal
    }

    $current = Get-EasyFireInventory
    if (-not [bool]$rollback.ComposeTeardownCompleted -and
        (@($current.Containers).Count -gt 0 -or @($current.Networks).Count -gt 0)) {
        if (-not $hasManifest) { throw 'Rollback cannot execute Compose without a sealed release.' }
        Assert-EasyFireReleaseSeal -Journal $Journal -RequireEnvironment
        Set-EasyFireProperty -Object $rollback -Name 'ComposeTeardownPlannedAtUtc' -Value (Get-EasyFireUtcNow)
        Write-EasyFireTrackedJournal -Journal $Journal
        $null = Invoke-EasyFireCompose -ReleaseDirectory $script:ReleaseDirectory -Arguments @('down')
    }
    $after = Get-EasyFireInventory
    if (@($after.Containers).Count -ne 0 -or @($after.Networks).Count -ne 0) {
        throw 'Rollback Compose teardown did not remove the exact Action containers and network.'
    }
    Assert-EasyFirePreservedPlannedVolumes -Journal $Journal -Inventory $after
    Set-EasyFireProperty -Object $rollback -Name 'ComposeTeardownCompleted' -Value $true
    Set-EasyFireProperty -Object $rollback -Name 'CompletedAtUtc' -Value (Get-EasyFireUtcNow)
    Write-EasyFireTrackedJournal -Journal $Journal
    Set-EasyFireJournalStatus -Journal $Journal -Status 'rolled_back' -Inventory $after
    Assert-EasyFireRollbackReadback -Journal $Journal -Inventory $after
    Write-Host "ROLLBACK_PASSED_VOLUMES_PRESERVED ActionId=$ActionId"
}

$script:Mutex = $null
$script:MutexAcquired = $false
$script:BackupMutex = $null
$script:BackupMutexAcquired = $false
try {
    $ActionId = ConvertTo-EasyFireCanonicalActionId -ActionId $ActionId
    if ($PriorActionId) {
        $PriorActionId = ConvertTo-EasyFireCanonicalActionId -ActionId $PriorActionId
        throw 'DATABASE_ENGINE_MIGRATION_REQUIRED: PriorActionId is outside this fresh-install controller.'
    }
    if ($Stage -eq 'ScheduledBackup') {
        if (-not $AuthorityOwnerSid) {
            throw 'ScheduledBackup requires the journal-bound AuthorityOwnerSid.'
        }
        $script:AuthorityOwnerSid = ConvertTo-EasyFireCanonicalAuthorityOwnerSid -Value $AuthorityOwnerSid
    } else {
        if ($AuthorityOwnerSid) {
            throw 'AuthorityOwnerSid is accepted only for ScheduledBackup.'
        }
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        try {
            $script:AuthorityOwnerSid = ConvertTo-EasyFireCanonicalAuthorityOwnerSid -Value $identity.User.Value
        } finally {
            $identity.Dispose()
        }
    }
    $script:ResolvedProductionRoot = Resolve-EasyFireContainedPath -Path $ProductionRoot -AllowedRoot $ProductionRoot -MustExist
    if (-not (Test-Path -LiteralPath $script:ResolvedProductionRoot -PathType Container)) {
        throw 'ProductionRoot must be an existing directory.'
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $script:ResolvedProductionRoot -TrustedRoot $script:ResolvedProductionRoot
    Assert-EasyFireAdministrator

    $mutexName = Get-EasyFireProductionMutexName -ProductionRoot $script:ResolvedProductionRoot
    $script:Mutex = New-Object Threading.Mutex($false, $mutexName)
    try {
        $script:MutexAcquired = $script:Mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $script:MutexAcquired = $true
    }
    if (-not $script:MutexAcquired) { throw 'Another EasyFire production controller is active for this root.' }

    $script:JournalsRoot = Join-Path $script:ResolvedProductionRoot 'journals'
    $script:ReleasesRoot = Join-Path $script:ResolvedProductionRoot 'releases'
    $script:BackupsRoot = Join-Path $script:ResolvedProductionRoot 'backups'
    $script:JournalPath = Get-EasyFireJournalPath -ProductionRoot $script:ResolvedProductionRoot -ActionId $ActionId
    if (Test-Path -LiteralPath $script:JournalsRoot) {
        $null = Assert-EasyFireNoReparsePathChain -Path $script:JournalsRoot -TrustedRoot $script:ResolvedProductionRoot
        Assert-EasyFireAuthorityTree -Path $script:JournalsRoot
    }
    $journal = Read-EasyFireTrackedJournal

    $archiveSupplied = $ReleaseArchive -cne 'N/A' -and $ExpectedArchiveSha256 -cne 'N/A'
    if ($Stage -in @('Preflight', 'Action') -and -not $archiveSupplied) {
        throw 'Preflight and Action require the exact release archive and SHA-256.'
    }
    if ($archiveSupplied) {
        if ($ExpectedArchiveSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
            throw 'ExpectedArchiveSha256 must contain exactly 64 hexadecimal characters.'
        }
        $script:ResolvedReleaseArchive = Resolve-EasyFireContainedPath -Path $ReleaseArchive -AllowedRoot $script:ResolvedProductionRoot -MustExist
        $null = Assert-EasyFireNoReparsePathChain -Path $script:ResolvedReleaseArchive -TrustedRoot $script:ResolvedProductionRoot
        if (-not (Test-Path -LiteralPath $script:ResolvedReleaseArchive -PathType Leaf) -or
            (Test-EasyFireReparsePoint -Path $script:ResolvedReleaseArchive) -or
            [IO.Path]::GetExtension($script:ResolvedReleaseArchive) -ine '.zip') {
            throw 'ReleaseArchive must be one regular .zip file inside ProductionRoot.'
        }
        $script:ActualArchiveSha256 = Get-EasyFireSha256Hex -Path $script:ResolvedReleaseArchive
        if ($script:ActualArchiveSha256 -cne $ExpectedArchiveSha256.ToUpperInvariant()) {
            throw 'ReleaseArchive SHA-256 mismatch.'
        }
    } else {
        if (-not $journal) { throw 'Postcheck, ScheduledBackup, or Rollback requires the exact Action journal.' }
        $script:ResolvedReleaseArchive = [string]$journal.ReleaseArchive.Path
        $script:ActualArchiveSha256 = [string]$journal.ReleaseArchive.Sha256
    }

    $derivedTag = 'archive-' + $script:ActualArchiveSha256.ToLowerInvariant()
    if ($TargetImageTag -and $TargetImageTag -cne $derivedTag) {
        throw "TargetImageTag must equal the archive-derived immutable tag: $derivedTag"
    }
    $script:TargetTag = $derivedTag
    $script:MariaDbImageTag = 'dbarchive-' + $script:ActualArchiveSha256.ToLowerInvariant()
    $suffix = $ActionId.Replace('-', '').Substring(0, 12)
    $script:ExpectedMysqlVolume = "easyfire_prod_mysql_$suffix"
    $script:ExpectedRedisVolume = "easyfire_prod_redis_$suffix"
    $script:ExpectedNetworkName = "$($script:ProjectName)_bigcapital_network"
    $script:ReleaseDirectory = Get-EasyFireReleaseDirectory -ProductionRoot $script:ResolvedProductionRoot -ArchiveSha256 $script:ActualArchiveSha256
    $script:ControllerPath = [IO.Path]::GetFullPath($PSCommandPath)
    $script:ControllerSha256 = Get-EasyFireSha256Hex -Path $script:ControllerPath
    $script:ControllerBundlePaths = @(Get-EasyFireControllerBundlePaths -ControllerPath $script:ControllerPath)
    $script:ControllerBundleAuthority = Get-EasyFireExecutableBundleAuthority -Paths $script:ControllerBundlePaths

    $credentialSupplied = $CloudflareCredentialFile -cne 'N/A'
    if ($Stage -notin @('Rollback', 'ScheduledBackup') -and -not $credentialSupplied) {
        throw 'Preflight, Action, and Postcheck require the exact Cloudflare credential file.'
    }
    if ($credentialSupplied) {
        $credentialSnapshot = Get-EasyFireCredentialSnapshot -Path $CloudflareCredentialFile
        $script:ResolvedCredentialFile = [string]$credentialSnapshot.Path
        $script:CredentialSha256 = [string]$credentialSnapshot.Sha256
    } else {
        $script:ResolvedCredentialFile = [string]$journal.CredentialEvidence.Path
        $script:CredentialSha256 = [string]$journal.CredentialEvidence.Sha256
    }

    if ($journal) { Assert-EasyFireJournalIdentity -Journal $journal }
    switch ($Stage) {
        'Preflight' {
            if (-not (Test-Path -LiteralPath $script:JournalsRoot)) {
                Protect-EasyFireAuthorityDirectory -Path $script:JournalsRoot
            }
            Invoke-EasyFirePreflightStage -Journal $journal
        }
        'Action' {
            if (-not (Test-Path -LiteralPath $script:JournalsRoot)) { throw 'Preflight receipt directory is missing.' }
            Invoke-EasyFireActionStage -Journal $journal
        }
        'Postcheck' {
            if (-not $journal) { throw 'Postcheck requires the exact Action journal.' }
            Invoke-EasyFirePostcheckStage -Journal $journal
        }
        'ScheduledBackup' {
            if (-not $journal) { throw 'ScheduledBackup requires the exact Action journal.' }
            Invoke-EasyFireScheduledBackupStage -Journal $journal
        }
        'Rollback' {
            if (-not $journal) { throw 'Rollback requires the exact Action journal.' }
            Invoke-EasyFireRollbackStage -Journal $journal
        }
    }
} catch {
    Write-Error ("EASYFIRE_PRODUCTION_BLOCKED: " + $_.Exception.Message)
    exit 1
} finally {
    if ($script:BackupMutexAcquired -and $script:BackupMutex) {
        try { $script:BackupMutex.ReleaseMutex() } catch {}
    }
    if ($script:BackupMutex) { $script:BackupMutex.Dispose() }
    if ($script:MutexAcquired -and $script:Mutex) {
        try { $script:Mutex.ReleaseMutex() } catch {}
    }
    if ($script:Mutex) { $script:Mutex.Dispose() }
}
