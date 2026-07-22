[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('PreparePlan', 'Quiesce', 'VerifyQuiesced', 'BindFinalCheckpoint', 'AbortBeforeActivation', 'AuthorizeActivation')]
    [string]$Stage,

    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$PlanSha256,

    [ValidatePattern('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')]
    [string]$CutoverId,

    [string]$PlanPath = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\direct-vm-cutover\cutover-plan.json',

    [string]$CheckpointManifestPath,

    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$CheckpointManifestSha256,

    [string]$ActivationEvidencePath,

    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$ActivationEvidenceSha256,

    [string]$GuestIsolationEvidencePath,

    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$GuestIsolationEvidenceSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:AuthorityRoot = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\direct-vm-cutover'
$script:ExactPlanPath = Join-Path $script:AuthorityRoot 'cutover-plan.json'
$script:ContainerSpecs = @(
    [ordered]@{ Role = 'mysql'; Tier = 'data'; Name = 'easyfire-mysql' },
    [ordered]@{ Role = 'redis'; Tier = 'data'; Name = 'easyfire-redis' },
    [ordered]@{ Role = 'gotenberg'; Tier = 'stateless'; Name = 'easyfire-gotenberg' },
    [ordered]@{ Role = 'proxy'; Tier = 'stateless'; Name = 'easyfire-proxy' },
    [ordered]@{ Role = 'webapp'; Tier = 'stateless'; Name = 'easyfire-webapp' },
    [ordered]@{ Role = 'server'; Tier = 'stateless'; Name = 'easyfire-owner-onboarding-ca845969f4b2' },
    [ordered]@{ Role = 'onboarding-web'; Tier = 'stateless'; Name = 'easyfire-owner-onboarding-web-0b7d1af8' },
    [ordered]@{ Role = 'onboarding-gateway'; Tier = 'stateless'; Name = 'easyfire-owner-onboarding-gateway-v2-0b7d1af8' }
)
$script:LegacyTasks = @(
    'easyfire-bookkeeping-prod-backup',
    'easyfire-bookkeeping-prod-startup'
)
$script:TunnelService = 'EasyFireBookkeepingCloudflared'
$script:CompletedActions = New-Object Collections.Generic.List[string]
$script:ReleaseArtifactNames = [ordered]@{
    contractPath = 'direct-vm-cutover-contract.mjs'
    sourceControllerPath = 'direct-vm-cutover-authority.ps1'
    checkpointControllerPath = 'direct-vm-preflight-checkpoint.ps1'
    checkpointV2ContractPath = 'direct-vm-checkpoint-v2-contract.mjs'
    finalQuiescenceContractPath = 'linux-final-quiescence-contract.mjs'
    activationEvidenceCollectorPath = 'linux-activation-evidence-collect.mjs'
    guardianPromotionPath = 'linux-guardian-promote-active.mjs'
    abortContractPath = 'direct-vm-source-abort-contract.mjs'
}

function Get-EasyFireSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-EasyFireTextSha256 {
    param([AllowEmptyString()][string]$Text)
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
    }
}

function Assert-EasyFireAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'The direct-VM cutover controller requires an elevated administrator session.'
        }
    } finally {
        $identity.Dispose()
    }
}

function Assert-EasyFireNoReparsePoint {
    param([Parameter(Mandatory = $true)][string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Cutover authority cannot traverse a reparse point: $Path"
    }
}

function Resolve-EasyFireContainedPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root,
        [switch]$MustExist
    )
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    if ($full -cne $rootFull -and -not $full.StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Cutover path escapes its protected root: $Path"
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full)) {
        throw "Required cutover authority path is missing: $full"
    }
    if (Test-Path -LiteralPath $full) { Assert-EasyFireNoReparsePoint -Path $full }
    return $full
}

function Get-EasyFireAllowedSids {
    param([Parameter(Mandatory = $true)][string]$OwnerSid)
    return @('S-1-5-18', 'S-1-5-32-544', $OwnerSid) | Sort-Object -Unique
}

function Assert-EasyFireRestrictedAuthority {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$OwnerSid,
        [string]$Root = $script:AuthorityRoot
    )
    $allowed = @{}
    foreach ($sid in Get-EasyFireAllowedSids -OwnerSid $OwnerSid) { $allowed[$sid] = $true }
    $writeRights = [Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::Modify -bor
        [Security.AccessControl.FileSystemRights]::FullControl -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    $root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $target = Resolve-EasyFireContainedPath -Path $Path -Root $root -MustExist
    $relative = $target.Substring($root.Length).TrimStart('\')
    $chain = @($root)
    $cursor = $root
    foreach ($segment in @($relative.Split('\') | Where-Object { $_ })) {
        $cursor = Join-Path $cursor $segment
        $chain += $cursor
    }
    foreach ($itemPath in $chain) {
        Assert-EasyFireNoReparsePoint -Path $itemPath
        $acl = Get-Acl -LiteralPath $itemPath
        foreach ($rule in @($acl.Access | Where-Object {
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
        })) {
            try {
                $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            } catch {
                throw "Cutover authority contains an unresolvable ACL principal: $itemPath"
            }
            if (-not $allowed.ContainsKey([string]$sid) -and (($rule.FileSystemRights -band $writeRights) -ne 0)) {
                throw "Cutover authority grants replacement rights to an unapproved principal: $itemPath"
            }
        }
    }
    return $target
}

function Assert-EasyFireInstalledRelease {
    param(
        [Parameter(Mandatory = $true)][string]$OwnerSid,
        $Plan
    )
    $controllerPath = [IO.Path]::GetFullPath($PSCommandPath)
    $pattern = '^C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\releases\\(?<releaseCommit>[a-f0-9]{40})\\scripts\\production\\direct-vm-cutover-authority\.ps1$'
    if ($controllerPath -cnotmatch $pattern) {
        throw 'The cutover controller must run from one exact immutable Windows release path.'
    }
    $releaseCommit = [string]$Matches.releaseCommit
    $releaseRoot = "C:\ProgramData\AgentFoundry\easyfire-bookkeeping\releases\$releaseCommit"
    $productionRoot = Join-Path (Join-Path $releaseRoot 'scripts') 'production'
    $manifestPath = Join-Path $releaseRoot 'release-manifest.json'
    foreach ($directory in @($releaseRoot, (Join-Path $releaseRoot 'scripts'), $productionRoot)) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            throw "Immutable release directory is missing: $directory"
        }
        Assert-EasyFireNoReparsePoint -Path $directory
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'Immutable release manifest is missing.'
    }
    Assert-EasyFireNoReparsePoint -Path $manifestPath
    $null = Assert-EasyFireRestrictedAuthority -Path $manifestPath -OwnerSid $OwnerSid -Root $releaseRoot
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (
        [int]$manifest.manifestVersion -ne 2 -or
        [string]$manifest.releaseCommit -cne $releaseCommit -or
        [string]$manifest.artifactModeAuthority -cne 'required-install-mode'
    ) { throw 'Immutable release manifest identity is invalid.' }
    $paths = [ordered]@{}
    foreach ($field in $script:ReleaseArtifactNames.Keys) {
        $fileName = [string]$script:ReleaseArtifactNames[$field]
        $artifactPath = "scripts/production/$fileName"
        $localPath = Join-Path $productionRoot $fileName
        if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
            throw "Immutable release executor is missing: $artifactPath"
        }
        Assert-EasyFireNoReparsePoint -Path $localPath
        $null = Assert-EasyFireRestrictedAuthority -Path $localPath -OwnerSid $OwnerSid -Root $releaseRoot
        $matches = @($manifest.artifacts | Where-Object { [string]$_.path -ceq $artifactPath })
        if ($matches.Count -ne 1) { throw "Release manifest artifact is missing or ambiguous: $artifactPath" }
        $artifact = $matches[0]
        $actualHash = Get-EasyFireSha256 -Path $localPath
        $actualBytes = (Get-Item -LiteralPath $localPath -Force).Length
        if (
            [string]$artifact.mode -cne '0644' -or
            [string]$artifact.sha256 -cne $actualHash -or
            [long]$artifact.bytes -ne [long]$actualBytes
        ) { throw "Release manifest artifact bytes, hash, or mode drifted: $artifactPath" }
        $paths[$field] = [IO.Path]::GetFullPath($localPath)
    }
    if ($paths.sourceControllerPath -cne $controllerPath) {
        throw 'The running controller does not match the manifest-bound source controller path.'
    }
    $manifestHash = Get-EasyFireSha256 -Path $manifestPath
    if ($null -ne $Plan -and (
        [string]$Plan.controller.releaseCommit -cne $releaseCommit -or
        [string]$Plan.controller.releaseManifestPath -cne [IO.Path]::GetFullPath($manifestPath) -or
        [string]$Plan.controller.releaseManifestSha256 -cne $manifestHash
    )) { throw 'Prepared cutover plan does not match the installed release manifest.' }
    return [pscustomobject]@{
        ReleaseCommit = $releaseCommit
        ReleaseRoot = $releaseRoot
        ReleaseManifestPath = [IO.Path]::GetFullPath($manifestPath)
        ReleaseManifestSha256 = $manifestHash
        Paths = $paths
    }
}

function Protect-EasyFireDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$OwnerSid
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        [IO.Directory]::CreateDirectory($Path) | Out-Null
    }
    Assert-EasyFireNoReparsePoint -Path $Path
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleAll($rule) }
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sidText in Get-EasyFireAllowedSids -OwnerSid $OwnerSid) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Write-EasyFireUtf8CreateNew {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally {
        $stream.Dispose()
    }
}

function Write-EasyFireJsonCreateNew {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )
    Write-EasyFireUtf8CreateNew -Path $Path -Text (($Value | ConvertTo-Json -Depth 30) + "`n")
}

function Invoke-EasyFireNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $FilePath @ArgumentList 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    if ($exitCode -ne 0) { throw "$Label failed closed with exit code $exitCode." }
    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    if ([Text.UTF8Encoding]::new($false).GetByteCount($text) -gt 2097152) {
        throw "$Label exceeded the bounded output limit."
    }
    return $text.Trim()
}

function Invoke-EasyFireContract {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )
    return Invoke-EasyFireNative -FilePath ([string]$Plan.controller.nodePath) `
        -ArgumentList (@([string]$Plan.controller.contractPath) + $Arguments) -Label $Label
}

function Invoke-EasyFireAbortContract {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )
    return Invoke-EasyFireNative -FilePath ([string]$Plan.controller.nodePath) `
        -ArgumentList (@([string]$Plan.controller.abortContractPath) + $Arguments) -Label $Label
}

function Assert-EasyFireCutoverPlan {
    $resolved = Resolve-EasyFireContainedPath -Path $PlanPath -Root $script:AuthorityRoot -MustExist
    if ($resolved -cne $script:ExactPlanPath) { throw 'Cutover plan must use the exact protected plan path.' }
    $actualHash = Get-EasyFireSha256 -Path $resolved
    if ($actualHash -cne $PlanSha256.ToLowerInvariant()) { throw 'Cutover plan SHA-256 mismatch.' }
    $plan = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$plan.evidence.root -cne $script:AuthorityRoot) { throw 'Cutover evidence root is invalid.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ([string]$plan.evidence.authorityOwnerSid -cne [string]$identity.User.Value) {
            throw 'Cutover authority owner SID is not the current elevated owner.'
        }
    } finally {
        $identity.Dispose()
    }
    $null = Assert-EasyFireInstalledRelease -OwnerSid ([string]$plan.evidence.authorityOwnerSid) -Plan $plan
    $null = Assert-EasyFireRestrictedAuthority -Path $resolved -OwnerSid ([string]$plan.evidence.authorityOwnerSid)
    foreach ($entry in @(
        [ordered]@{ Path = [string]$plan.controller.releaseManifestPath; Sha256 = [string]$plan.controller.releaseManifestSha256 },
        [ordered]@{ Path = [string]$plan.controller.nodePath; Sha256 = [string]$plan.controller.nodeSha256 },
        [ordered]@{ Path = [string]$plan.controller.contractPath; Sha256 = [string]$plan.controller.contractSha256 },
        [ordered]@{ Path = [string]$plan.controller.sourceControllerPath; Sha256 = [string]$plan.controller.sourceControllerSha256 },
        [ordered]@{ Path = [string]$plan.controller.checkpointControllerPath; Sha256 = [string]$plan.controller.checkpointControllerSha256 },
        [ordered]@{ Path = [string]$plan.controller.checkpointV2ContractPath; Sha256 = [string]$plan.controller.checkpointV2ContractSha256 },
        [ordered]@{ Path = [string]$plan.controller.finalQuiescenceContractPath; Sha256 = [string]$plan.controller.finalQuiescenceContractSha256 },
        [ordered]@{ Path = [string]$plan.controller.activationEvidenceCollectorPath; Sha256 = [string]$plan.controller.activationEvidenceCollectorSha256 },
        [ordered]@{ Path = [string]$plan.controller.guardianPromotionPath; Sha256 = [string]$plan.controller.guardianPromotionSha256 },
        [ordered]@{ Path = [string]$plan.controller.abortContractPath; Sha256 = [string]$plan.controller.abortContractSha256 },
        [ordered]@{ Path = [string]$plan.controller.privateLauncherPath; Sha256 = [string]$plan.controller.privateLauncherSha256 }
    )) {
        if (-not (Test-Path -LiteralPath $entry.Path -PathType Leaf)) { throw "Pinned controller input is missing: $($entry.Path)" }
        Assert-EasyFireNoReparsePoint -Path $entry.Path
        if ((Get-EasyFireSha256 -Path $entry.Path) -cne ([string]$entry.Sha256).ToLowerInvariant()) {
            throw "Pinned controller input hash mismatch: $($entry.Path)"
        }
    }
    if ([IO.Path]::GetFullPath($PSCommandPath) -cne [IO.Path]::GetFullPath([string]$plan.controller.sourceControllerPath)) {
        throw 'This controller is not running from its plan-bound installed path.'
    }
    $null = Invoke-EasyFireContract -Plan $plan -Arguments @(
        '--mode', 'validate-plan', '--plan', $resolved
    ) -Label 'Cutover plan contract validation'
    return $plan
}

function ConvertTo-EasyFireMounts {
    param($Inspect)
    return @($Inspect.Mounts | ForEach-Object {
        [ordered]@{
            type = ([string]$_.Type).ToLowerInvariant()
            source = if ([string]$_.Type -ceq 'volume' -and [string]$_.Name) { [string]$_.Name } else { [string]$_.Source }
            destination = [string]$_.Destination
            readOnly = -not [bool]$_.RW
        }
    } | Sort-Object destination, source)
}

function ConvertTo-EasyFirePorts {
    param($Inspect)
    $records = @()
    foreach ($property in @($Inspect.HostConfig.PortBindings.PSObject.Properties | Sort-Object Name)) {
        $parts = $property.Name.Split('/')
        foreach ($binding in @($property.Value)) {
            if ($null -eq $binding) { continue }
            $records += [ordered]@{
                containerPort = [int]$parts[0]
                hostIp = [string]$binding.HostIp
                hostPort = [int]$binding.HostPort
                protocol = [string]$parts[1]
            }
        }
    }
    return @($records | Sort-Object containerPort, hostIp, hostPort, protocol)
}

function Get-EasyFireTaskSnapshot {
    param([Parameter(Mandatory = $true)][string]$Name)
    $task = Get-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction Stop
    $actions = @($task.Actions)
    if ($actions.Count -ne 1) { throw "Legacy task action identity is ambiguous: $Name" }
    $xml = [string](Export-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction Stop)
    $definitionXml = [Text.RegularExpressions.Regex]::Replace(
        $xml,
        '<Enabled>(?:true|false)</Enabled>',
        '<Enabled>__CUTOVER_STATE__</Enabled>',
        [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    return [ordered]@{
        name = $Name
        taskPath = '\'
        enabled = [bool]$task.Settings.Enabled
        state = [string]$task.State
        xmlSha256 = Get-EasyFireTextSha256 -Text $definitionXml
        executable = [string]$actions[0].Execute
        argumentsSha256 = Get-EasyFireTextSha256 -Text ([string]$actions[0].Arguments)
        workingDirectory = [string]$actions[0].WorkingDirectory
        principalUserId = [string]$task.Principal.UserId
        logonType = [string]$task.Principal.LogonType
        runLevel = [string]$task.Principal.RunLevel
    }
}

function Test-EasyFireEndpointReachable {
    param([Parameter(Mandatory = $true)][string]$Uri)
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create($Uri)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 3000
    $response = $null
    try {
        $response = [Net.HttpWebResponse]$request.GetResponse()
        return $true
    } catch [Net.WebException] {
        return $null -ne $_.Exception.Response
    } finally {
        if ($null -ne $response) { $response.Dispose() }
    }
}

function Get-EasyFireWriterProof {
    param(
        [Parameter(Mandatory = $true)]$Containers,
        [Parameter(Mandatory = $true)]$Plan
    )
    $runningWriters = @($Containers | Where-Object { $_.tier -ceq 'stateless' -and $_.running }).Count
    $mysqlQuery = 'mariadb -u root -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --raw --execute="SELECT (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND USER NOT IN (''system user'',''event_scheduler'')),@@event_scheduler,(SELECT COUNT(*) FROM information_schema.EVENTS WHERE STATUS=''ENABLED'');"'
    $mysqlText = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'container', 'exec', [string]$Plan.source.mysqlContainerId, 'sh', '-lc', $mysqlQuery
    ) -Label 'Source MariaDB writer-connection proof'
    $mysqlFields = @($mysqlText -split "`t")
    if ($mysqlFields.Count -ne 3 -or $mysqlFields[0] -notmatch '^(?:0|[1-9][0-9]*)$' -or
        $mysqlFields[1] -notin @('ON', 'OFF') -or $mysqlFields[2] -notmatch '^(?:0|[1-9][0-9]*)$') {
        throw 'MariaDB writer proof did not return the exact connection/event-scheduler tuple.'
    }
    $redisText = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'container', 'exec', [string]$Plan.source.redisContainerId,
        'redis-cli', '--raw', 'CLIENT', 'LIST', 'TYPE', 'normal'
    ) -Label 'Source Redis client proof'
    $redisClients = @($redisText -split "`r?`n" | Where-Object { $_ }).Count
    if ($redisClients -lt 1) { throw 'Redis client proof did not include its own read-only client.' }
    return [ordered]@{
        applicationContainersRunning = $runningWriters
        mysqlNonSystemConnections = [int]$mysqlFields[0]
        mysqlEventScheduler = [string]$mysqlFields[1]
        mysqlEnabledEvents = [int]$mysqlFields[2]
        redisExternalClients = $redisClients - 1
    }
}

function Get-EasyFireSourceSnapshot {
    param(
        $Plan,
        [Parameter(Mandatory = $true)][ValidateSet('pre-quiesce', 'post-quiesce')][string]$Phase
    )
    $expected = if ($null -ne $Plan) { $Plan.source.expectedInitialSnapshot } else { $null }
    $dockerInfo = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'info', '--format', '{{json .}}'
    ) -Label 'Source Docker engine inspection' | ConvertFrom-Json
    $dockerIdentity = [ordered]@{
        id = [string]$dockerInfo.ID
        name = [string]$dockerInfo.Name
        serverVersion = [string]$dockerInfo.ServerVersion
        osType = [string]$dockerInfo.OSType
        architecture = [string]$dockerInfo.Architecture
        dockerRootDir = [string]$dockerInfo.DockerRootDir
    }
    $projectNames = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
        'container', 'ls', '--all', '--filter', 'label=com.docker.compose.project=easyfire-bookkeeping-prod',
        '--format', '{{.Names}}'
    ) -Label 'Source Compose-project inventory') -split "`r?`n" | Where-Object { $_ } | Sort-Object)
    $expectedNames = @($script:ContainerSpecs.Name | Sort-Object)
    if (($projectNames -join "`n") -cne ($expectedNames -join "`n")) {
        throw 'Source Compose project contains a missing or unexpected container.'
    }
    $containers = foreach ($spec in $script:ContainerSpecs) {
        $inspect = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'container', 'inspect', [string]$spec.Name
        ) -Label "Source container inspection: $($spec.Name)" | ConvertFrom-Json))[0]
        $health = if ($null -ne $inspect.State.Health) { [string]$inspect.State.Health.Status } else { 'none' }
        if (-not [bool]$inspect.State.Running) { $health = 'none' }
        [ordered]@{
            role = [string]$spec.Role
            tier = [string]$spec.Tier
            name = ([string]$inspect.Name).TrimStart('/')
            id = [string]$inspect.Id
            imageId = [string]$inspect.Image
            imageReference = [string]$inspect.Config.Image
            composeProject = [string]$inspect.Config.Labels.'com.docker.compose.project'
            composeService = [string]$inspect.Config.Labels.'com.docker.compose.service'
            restartPolicy = [string]$inspect.HostConfig.RestartPolicy.Name
            maximumRetryCount = [int]$inspect.HostConfig.RestartPolicy.MaximumRetryCount
            running = [bool]$inspect.State.Running
            state = [string]$inspect.State.Status
            health = $health
            mounts = @(ConvertTo-EasyFireMounts -Inspect $inspect)
            networks = @($inspect.NetworkSettings.Networks.PSObject.Properties.Name | Sort-Object)
            publishedPorts = @(ConvertTo-EasyFirePorts -Inspect $inspect)
        }
    }
    $volumes = foreach ($spec in @(
        [ordered]@{ Role = 'mysql'; Name = 'easyfire_prod_mysql'; ComposeVolume = 'mysql' },
        [ordered]@{ Role = 'redis'; Name = 'easyfire_prod_redis'; ComposeVolume = 'redis' }
    )) {
        $volume = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'volume', 'inspect', [string]$spec.Name
        ) -Label "Source volume inspection: $($spec.Name)" | ConvertFrom-Json))[0]
        $consumers = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'container', 'ls', '--all', '--filter', "volume=$($spec.Name)", '--no-trunc', '--format', '{{.ID}}'
        ) -Label "Source volume consumer inspection: $($spec.Name)") -split "`r?`n" | Where-Object { $_ } | Sort-Object)
        [ordered]@{
            role = [string]$spec.Role
            name = [string]$volume.Name
            driver = [string]$volume.Driver
            scope = [string]$volume.Scope
            composeProject = [string]$volume.Labels.'com.docker.compose.project'
            composeVolume = [string]$volume.Labels.'com.docker.compose.volume'
            consumers = $consumers
        }
    }
    $tasks = @($script:LegacyTasks | ForEach-Object { Get-EasyFireTaskSnapshot -Name $_ })
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$script:TunnelService'" -ErrorAction Stop
    if ($null -eq $service) { throw 'The exact legacy cloudflared service is missing.' }
    $serviceProcess = if ([int]$service.ProcessId -gt 0) {
        Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$([int]$service.ProcessId)" -ErrorAction SilentlyContinue
    } else { $null }
    if ($null -eq $serviceProcess -and $null -eq $expected) {
        throw 'The exact legacy cloudflared process must be running when preparing the plan.'
    }
    $tunnelExpected = if ($null -ne $expected) { $expected.tunnel } else { $null }
    $tunnelPath = if ($null -ne $serviceProcess) { [string]$serviceProcess.ExecutablePath } else { [string]$tunnelExpected.executablePath }
    $tunnel = [ordered]@{
        serviceName = $script:TunnelService
        state = [string]$service.State
        startMode = [string]$service.StartMode
        processId = if ($null -ne $serviceProcess) { [int]$service.ProcessId } else { 0 }
        executablePath = $tunnelPath
        executableSha256 = if ($null -ne $serviceProcess) { Get-EasyFireSha256 -Path $tunnelPath } else { [string]$tunnelExpected.executableSha256 }
        commandLineSha256 = if ($null -ne $serviceProcess) { Get-EasyFireTextSha256 -Text ([string]$serviceProcess.CommandLine) } else { [string]$tunnelExpected.commandLineSha256 }
        processPresent = $null -ne $serviceProcess
    }
    $routeExpected = if ($null -ne $expected) {
        $expected.privateRoute
    } else {
        $discoveredListeners = @(Get-NetTCPConnection -State Listen -LocalPort 25186 -ErrorAction Stop | Where-Object {
            $_.LocalAddress -ceq '100.84.66.30'
        })
        if ($discoveredListeners.Count -ne 1) {
            throw 'The exact private source route listener is missing or ambiguous.'
        }
        $discoveredProcess = Get-CimInstance -ClassName Win32_Process `
            -Filter "ProcessId=$([int]$discoveredListeners[0].OwningProcess)" -ErrorAction Stop
        if ([IO.Path]::GetFileName([string]$discoveredProcess.ExecutablePath) -notmatch '^(?:powershell|pwsh)\.exe$') {
            throw 'The private source route is not owned by the allowlisted PowerShell proxy.'
        }
        [pscustomobject][ordered]@{
            processId = [int]$discoveredProcess.ProcessId
            executablePath = [string]$discoveredProcess.ExecutablePath
            executableSha256 = Get-EasyFireSha256 -Path ([string]$discoveredProcess.ExecutablePath)
            commandLineSha256 = Get-EasyFireTextSha256 -Text ([string]$discoveredProcess.CommandLine)
            listenerAddress = '100.84.66.30'
            listenerPort = 25186
        }
    }
    $routeProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$([int]$routeExpected.processId)" -ErrorAction SilentlyContinue
    $routeListeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$routeExpected.listenerPort) -ErrorAction SilentlyContinue | Where-Object {
        $_.LocalAddress -ceq [string]$routeExpected.listenerAddress
    })
    $privateRoute = [ordered]@{
        kind = 'listener-process'
        processId = [int]$routeExpected.processId
        executablePath = if ($null -ne $routeProcess) { [string]$routeProcess.ExecutablePath } else { [string]$routeExpected.executablePath }
        executableSha256 = if ($null -ne $routeProcess) { Get-EasyFireSha256 -Path ([string]$routeProcess.ExecutablePath) } else { [string]$routeExpected.executableSha256 }
        commandLineSha256 = if ($null -ne $routeProcess) { Get-EasyFireTextSha256 -Text ([string]$routeProcess.CommandLine) } else { [string]$routeExpected.commandLineSha256 }
        listenerAddress = [string]$routeExpected.listenerAddress
        listenerPort = [int]$routeExpected.listenerPort
        processPresent = $null -ne $routeProcess
        listenerPresent = @($routeListeners | Where-Object { [int]$_.OwningProcess -eq [int]$routeExpected.processId }).Count -eq 1
    }
    $endpoint = [ordered]@{
        uri = 'http://100.84.66.30:25186/'
        reachable = Test-EasyFireEndpointReachable -Uri 'http://100.84.66.30:25186/'
        listenerProcessId = if ($routeListeners.Count -eq 1) { [int]$routeListeners[0].OwningProcess } else { 0 }
    }
    $writerProof = if ($Phase -ceq 'post-quiesce') {
        Get-EasyFireWriterProof -Containers $containers -Plan $Plan
    } else { $null }
    return [ordered]@{
        schemaVersion = 1
        project = 'easyfire-bookkeeping'
        kind = 'easyfire-bookkeeping-source-snapshot'
        phase = $Phase
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        host = $env:COMPUTERNAME
        docker = $dockerIdentity
        containers = @($containers)
        volumes = @($volumes)
        scheduledTasks = @($tasks)
        tunnel = $tunnel
        privateRoute = $privateRoute
        endpoint = $endpoint
        writerProof = $writerProof
    }
}

function Assert-EasyFireSourceSnapshot {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet('pre-quiesce', 'post-quiesce')][string]$Phase
    )
    $null = Invoke-EasyFireContract -Plan $Plan -Arguments @(
        '--mode', 'validate-snapshot', '--plan', $script:ExactPlanPath,
        '--snapshot', $Path, '--phase', $Phase
    ) -Label "Source $Phase snapshot validation"
}

function Invoke-EasyFirePreparePlan {
    if (-not $CutoverId) { throw 'PreparePlan requires one new cutover UUID.' }
    if ($PlanSha256) { throw 'PreparePlan does not accept a pre-existing plan SHA-256.' }
    $resolvedPlan = [IO.Path]::GetFullPath($PlanPath)
    if ($resolvedPlan -cne $script:ExactPlanPath) { throw 'PreparePlan must use the exact protected plan path.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $ownerSid = [string]$identity.User.Value }
    finally { $identity.Dispose() }
    $release = Assert-EasyFireInstalledRelease -OwnerSid $ownerSid
    Protect-EasyFireDirectory -Path $script:AuthorityRoot -OwnerSid $ownerSid
    if (Test-Path -LiteralPath $script:ExactPlanPath) {
        throw 'A cutover plan already exists; replacement is forbidden.'
    }
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop
    $nodePath = [IO.Path]::GetFullPath([string]$nodeCommand.Source)
    $contractPath = [string]$release.Paths.contractPath
    $checkpointPath = [string]$release.Paths.checkpointControllerPath
    $checkpointV2ContractPath = [string]$release.Paths.checkpointV2ContractPath
    $finalQuiescenceContractPath = [string]$release.Paths.finalQuiescenceContractPath
    $activationEvidenceCollectorPath = [string]$release.Paths.activationEvidenceCollectorPath
    $guardianPromotionPath = [string]$release.Paths.guardianPromotionPath
    $abortContractPath = [string]$release.Paths.abortContractPath
    $privateLauncherPath = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\incoming\launch-private-proxy-v2-0b7d1af8.ps1'
    foreach ($path in @(
        $nodePath, $contractPath, $PSCommandPath, $checkpointPath,
        $checkpointV2ContractPath, $finalQuiescenceContractPath,
        $activationEvidenceCollectorPath, $guardianPromotionPath,
        $abortContractPath, $privateLauncherPath
    )) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "PreparePlan input is missing: $path" }
        Assert-EasyFireNoReparsePoint -Path $path
    }
    $snapshot = Get-EasyFireSourceSnapshot -Plan $null -Phase 'pre-quiesce'
    $mysql = @($snapshot.containers | Where-Object { $_.role -ceq 'mysql' })
    $redis = @($snapshot.containers | Where-Object { $_.role -ceq 'redis' })
    if ($mysql.Count -ne 1 -or $redis.Count -ne 1) { throw 'PreparePlan data-container identity is ambiguous.' }
    $plan = [ordered]@{
        schemaVersion = 1
        project = 'easyfire-bookkeeping'
        kind = 'easyfire-bookkeeping-direct-vm-cutover-plan'
        cutoverId = $CutoverId
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        source = [ordered]@{
            host = 'NEWSEC'
            composeProject = 'easyfire-bookkeeping-prod'
            expectedInitialSnapshot = $snapshot
            mysqlContainerId = [string]$mysql[0].id
            redisContainerId = [string]$redis[0].id
            mysqlVolume = 'easyfire_prod_mysql'
            redisVolume = 'easyfire_prod_redis'
        }
        controller = [ordered]@{
            releaseCommit = [string]$release.ReleaseCommit
            releaseManifestPath = [string]$release.ReleaseManifestPath
            releaseManifestSha256 = [string]$release.ReleaseManifestSha256
            nodePath = $nodePath
            nodeSha256 = Get-EasyFireSha256 -Path $nodePath
            contractPath = [IO.Path]::GetFullPath($contractPath)
            contractSha256 = Get-EasyFireSha256 -Path $contractPath
            sourceControllerPath = [IO.Path]::GetFullPath($PSCommandPath)
            sourceControllerSha256 = Get-EasyFireSha256 -Path $PSCommandPath
            checkpointControllerPath = [IO.Path]::GetFullPath($checkpointPath)
            checkpointControllerSha256 = Get-EasyFireSha256 -Path $checkpointPath
            checkpointV2ContractPath = [IO.Path]::GetFullPath($checkpointV2ContractPath)
            checkpointV2ContractSha256 = Get-EasyFireSha256 -Path $checkpointV2ContractPath
            finalQuiescenceContractPath = [IO.Path]::GetFullPath($finalQuiescenceContractPath)
            finalQuiescenceContractSha256 = Get-EasyFireSha256 -Path $finalQuiescenceContractPath
            activationEvidenceCollectorPath = [IO.Path]::GetFullPath($activationEvidenceCollectorPath)
            activationEvidenceCollectorSha256 = Get-EasyFireSha256 -Path $activationEvidenceCollectorPath
            guardianPromotionPath = [IO.Path]::GetFullPath($guardianPromotionPath)
            guardianPromotionSha256 = Get-EasyFireSha256 -Path $guardianPromotionPath
            abortContractPath = [IO.Path]::GetFullPath($abortContractPath)
            abortContractSha256 = Get-EasyFireSha256 -Path $abortContractPath
            privateLauncherPath = $privateLauncherPath
            privateLauncherSha256 = Get-EasyFireSha256 -Path $privateLauncherPath
            privateLauncherChildSha256 = '1adac5341abea3e496cf9c015b68562781d34bb985fb64d8317f6832ad1bd0b9'
        }
        evidence = [ordered]@{
            root = $script:AuthorityRoot
            authorityOwnerSid = $ownerSid
            sourceQuiesceReceiptGuestPath = '/etc/easyfire-bookkeeping/source-quiesce-receipt.json'
            checkpointBindingGuestPath = '/etc/easyfire-bookkeeping/source-quiesce-checkpoint-binding.json'
            activationEvidenceGuestPath = '/etc/easyfire-bookkeeping/cutover-evidence.json'
            activationAuthorizationGuestPath = '/etc/easyfire-bookkeeping/cutover-authorization.json'
        }
        target = [ordered]@{
            vmName = 'easyfire-bookkeeping-newsec'
            tailscaleDnsName = 'easyfire-bookkeeping-newsec.taild63e9b.ts.net'
            tailscaleOrigin = 'http://127.0.0.1:8080'
            authorizationMaxAgeSeconds = 900
        }
    }
    Write-EasyFireJsonCreateNew -Path $script:ExactPlanPath -Value $plan
    $planHash = Get-EasyFireSha256 -Path $script:ExactPlanPath
    $null = Invoke-EasyFireNative -FilePath $nodePath -ArgumentList @(
        $contractPath, '--mode', 'validate-plan', '--plan', $script:ExactPlanPath
    ) -Label 'Prepared cutover plan validation'
    $null = Assert-EasyFireRestrictedAuthority -Path $script:ExactPlanPath -OwnerSid $ownerSid
    return [ordered]@{
        status = 'plan-prepared'
        cutoverId = $CutoverId
        plan = $script:ExactPlanPath
        planSha256 = $planHash
        liveActionsPerformed = $false
    }
}

function Get-EasyFireJournalPath {
    param([Parameter(Mandatory = $true)]$Plan)
    return Join-Path (Join-Path $script:AuthorityRoot 'journal') ([string]$Plan.cutoverId)
}

function Assert-EasyFireExistingQuiesceReceipt {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Journal
    )
    $receipt = Join-Path $Journal 'source-quiesce-receipt.json'
    $beforePath = Join-Path $Journal 'source-before.json'
    $afterPath = Join-Path $Journal 'source-after.json'
    $null = Assert-EasyFireRestrictedAuthority -Path $receipt -OwnerSid ([string]$Plan.evidence.authorityOwnerSid)
    $null = Invoke-EasyFireContract -Plan $Plan -Arguments @(
        '--mode', 'validate-quiesce-receipt', '--plan', $script:ExactPlanPath,
        '--source-receipt', $receipt,
        '--before', $beforePath, '--after', $afterPath
    ) -Label 'Source quiesce receipt validation'
    return $receipt
}

function Invoke-EasyFireQuiesce {
    param([Parameter(Mandatory = $true)]$Plan)
    $journalRoot = Join-Path $script:AuthorityRoot 'journal'
    Protect-EasyFireDirectory -Path $journalRoot -OwnerSid ([string]$Plan.evidence.authorityOwnerSid)
    $journal = Get-EasyFireJournalPath -Plan $Plan
    if (Test-Path -LiteralPath $journal) { throw 'Cutover journal already exists; automatic replay is forbidden.' }
    Protect-EasyFireDirectory -Path $journal -OwnerSid ([string]$Plan.evidence.authorityOwnerSid)
    $beforePath = Join-Path $journal 'source-before.json'
    $authorityPath = Join-Path $journal 'authority.json'
    try {
        $before = Get-EasyFireSourceSnapshot -Plan $Plan -Phase 'pre-quiesce'
        Write-EasyFireJsonCreateNew -Path $beforePath -Value $before
        Assert-EasyFireSourceSnapshot -Plan $Plan -Path $beforePath -Phase 'pre-quiesce'
        Write-EasyFireJsonCreateNew -Path $authorityPath -Value ([ordered]@{
            schemaVersion = 1
            project = 'easyfire-bookkeeping'
            kind = 'easyfire-bookkeeping-source-quiesce-authority'
            status = 'claimed-once'
            cutoverId = [string]$Plan.cutoverId
            claimedAt = (Get-Date).ToUniversalTime().ToString('o')
            planSha256 = $PlanSha256.ToLowerInvariant()
            beforeSnapshotSha256 = Get-EasyFireSha256 -Path $beforePath
            retryAuthorized = $false
            preservationRequired = $true
        })
        foreach ($taskName in $script:LegacyTasks) {
            $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
            if ([string]$task.State -ceq 'Running') { throw "Legacy task is running at cutover: $taskName" }
            Disable-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop | Out-Null
            $script:CompletedActions.Add("disabled-task:$taskName")
        }
        $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$script:TunnelService'" -ErrorAction Stop
        if ([string]$service.State -cne 'Running' -or [string]$service.StartMode -cne 'Auto') {
            throw 'Legacy cloudflared service state drifted before cutover.'
        }
        Set-Service -Name $script:TunnelService -StartupType Disabled -ErrorAction Stop
        Stop-Service -Name $script:TunnelService -ErrorAction Stop
        $script:CompletedActions.Add("disabled-stopped-service:$script:TunnelService")
        $route = $Plan.source.expectedInitialSnapshot.privateRoute
        $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$([int]$route.processId)" -ErrorAction Stop
        if ((Get-EasyFireSha256 -Path ([string]$process.ExecutablePath)) -cne [string]$route.executableSha256 -or
            (Get-EasyFireTextSha256 -Text ([string]$process.CommandLine)) -cne [string]$route.commandLineSha256) {
            throw 'Private-route process provenance drifted before cutover.'
        }
        Stop-Process -Id ([int]$route.processId) -ErrorAction Stop
        Wait-Process -Id ([int]$route.processId) -Timeout 30 -ErrorAction SilentlyContinue
        $script:CompletedActions.Add("stopped-private-route:$([int]$route.processId)")
        $stateless = @($Plan.source.expectedInitialSnapshot.containers | Where-Object { $_.tier -ceq 'stateless' })
        foreach ($container in $stateless) {
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('container', 'update', '--restart=no', [string]$container.id) -Label "Neutralize source restart policy: $($container.name)"
            $script:CompletedActions.Add("restart-no:$($container.id)")
        }
        foreach ($container in $stateless) {
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @('container', 'stop', '--time', '30', [string]$container.id) -Label "Stop source writer: $($container.name)"
            $script:CompletedActions.Add("stopped-writer:$($container.id)")
        }
        $after = Get-EasyFireSourceSnapshot -Plan $Plan -Phase 'post-quiesce'
        $afterPath = Join-Path $journal 'source-after.json'
        Write-EasyFireJsonCreateNew -Path $afterPath -Value $after
        Assert-EasyFireSourceSnapshot -Plan $Plan -Path $afterPath -Phase 'post-quiesce'
        $receiptPath = Join-Path $journal 'source-quiesce-receipt.json'
        $null = Invoke-EasyFireContract -Plan $Plan -Arguments @(
            '--mode', 'build-quiesce-receipt', '--plan', $script:ExactPlanPath,
            '--before', $beforePath, '--after', $afterPath,
            '--completed-at', (Get-Date).ToUniversalTime().ToString('o'),
            '--output', $receiptPath
        ) -Label 'Source quiesce receipt publication'
        $null = Assert-EasyFireExistingQuiesceReceipt -Plan $Plan -Journal $journal
        return [ordered]@{
            status = 'quiesced-verified'
            cutoverId = [string]$Plan.cutoverId
            receipt = $receiptPath
            receiptSha256 = Get-EasyFireSha256 -Path $receiptPath
            dataContainersRunning = $true
            noResourcesDeleted = $true
        }
    } catch {
        $failurePath = Join-Path $journal 'failure.json'
        if (-not (Test-Path -LiteralPath $failurePath)) {
            Write-EasyFireJsonCreateNew -Path $failurePath -Value ([ordered]@{
                schemaVersion = 1
                project = 'easyfire-bookkeeping'
                kind = 'easyfire-bookkeeping-source-quiesce-failure'
                status = 'failed-preserved'
                failedAt = (Get-Date).ToUniversalTime().ToString('o')
                cutoverId = [string]$Plan.cutoverId
                message = 'Source quiesce stopped at a fail-closed boundary.'
                completedActions = @($script:CompletedActions)
                automaticRetryAuthorized = $false
                automaticRollbackAuthorized = $false
                resourcesDeleted = $false
            })
        }
        throw
    }
}

function Invoke-EasyFireVerifyQuiesced {
    param([Parameter(Mandatory = $true)]$Plan)
    $journal = Get-EasyFireJournalPath -Plan $Plan
    $receipt = Assert-EasyFireExistingQuiesceReceipt -Plan $Plan -Journal $journal
    if (Test-Path -LiteralPath (Join-Path $journal 'failure.json')) {
        throw 'A preserved source-quiesce failure exists; activation is forbidden.'
    }
    $snapshot = Get-EasyFireSourceSnapshot -Plan $Plan -Phase 'post-quiesce'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'
    $path = Join-Path $journal "source-still-quiesced-$stamp.json"
    Write-EasyFireJsonCreateNew -Path $path -Value $snapshot
    Assert-EasyFireSourceSnapshot -Plan $Plan -Path $path -Phase 'post-quiesce'
    return [ordered]@{
        status = 'still-quiesced'
        receipt = $receipt
        receiptSha256 = Get-EasyFireSha256 -Path $receipt
        snapshot = $path
        snapshotSha256 = Get-EasyFireSha256 -Path $path
    }
}

function Get-EasyFireHttpStatusCode {
    param([Parameter(Mandatory = $true)][string]$Uri)
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create($Uri)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 5000
    $response = $null
    try {
        $response = [Net.HttpWebResponse]$request.GetResponse()
        return [int]$response.StatusCode
    } catch [Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $response = [Net.HttpWebResponse]$_.Exception.Response
            return [int]$response.StatusCode
        }
        return 0
    } finally {
        if ($null -ne $response) { $response.Dispose() }
    }
}

function Get-EasyFireSourceRearmSnapshot {
    param([Parameter(Mandatory = $true)]$Plan)
    $containers = foreach ($spec in $script:ContainerSpecs) {
        $expected = @($Plan.source.expectedInitialSnapshot.containers | Where-Object { $_.role -ceq [string]$spec.Role })
        if ($expected.Count -ne 1) { throw "Rearm container authority is ambiguous: $($spec.Name)" }
        $inspect = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
            'container', 'inspect', [string]$spec.Name
        ) -Label "Rearmed source container inspection: $($spec.Name)" | ConvertFrom-Json))[0]
        $health = if ($null -ne $inspect.State.Health) { [string]$inspect.State.Health.Status } else { 'none' }
        if (-not [bool]$inspect.State.Running) { $health = 'none' }
        [ordered]@{
            role = [string]$spec.Role
            tier = [string]$spec.Tier
            name = ([string]$inspect.Name).TrimStart('/')
            id = [string]$inspect.Id
            imageId = [string]$inspect.Image
            running = [bool]$inspect.State.Running
            state = [string]$inspect.State.Status
            health = $health
            restartPolicy = [string]$inspect.HostConfig.RestartPolicy.Name
            maximumRetryCount = [int]$inspect.HostConfig.RestartPolicy.MaximumRetryCount
        }
    }
    $tasks = @($script:LegacyTasks | ForEach-Object {
        $task = Get-EasyFireTaskSnapshot -Name $_
        [ordered]@{
            name = [string]$task.name
            enabled = [bool]$task.enabled
            state = [string]$task.state
            xmlSha256 = [string]$task.xmlSha256
        }
    })
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$script:TunnelService'" -ErrorAction Stop
    $serviceProcess = if ([int]$service.ProcessId -gt 0) {
        Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$([int]$service.ProcessId)" -ErrorAction SilentlyContinue
    } else { $null }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 25186 -ErrorAction SilentlyContinue | Where-Object {
        $_.LocalAddress -ceq '100.84.66.30'
    })
    if ($listeners.Count -ne 1) { throw 'The restored private listener is missing or ambiguous.' }
    $process = Get-CimInstance -ClassName Win32_Process `
        -Filter "ProcessId=$([int]$listeners[0].OwningProcess)" -ErrorAction Stop
    if ([IO.Path]::GetFileName([string]$process.ExecutablePath) -notmatch '^(?:powershell|pwsh)\.exe$') {
        throw 'The restored private listener is not owned by PowerShell.'
    }
    $probeUris = @(
        'http://100.84.66.30:25186/',
        'http://100.84.66.30:25186/api/system_db',
        'http://100.84.66.30:25186/api/auth/meta'
    )
    return [ordered]@{
        schemaVersion = 1
        project = 'easyfire-bookkeeping'
        kind = 'easyfire-bookkeeping-source-pre-activation-abort-snapshot'
        status = 'rearmed-private-verified'
        cutoverId = [string]$Plan.cutoverId
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        host = $env:COMPUTERNAME
        containers = @($containers)
        scheduledTasks = $tasks
        tunnel = [ordered]@{
            serviceName = $script:TunnelService
            state = [string]$service.State
            startMode = [string]$service.StartMode
            processId = if ($null -ne $serviceProcess) { [int]$service.ProcessId } else { 0 }
            processPresent = $null -ne $serviceProcess
        }
        privateRoute = [ordered]@{
            kind = 'hash-pinned-private-launcher'
            processId = [int]$process.ProcessId
            executablePath = [string]$process.ExecutablePath
            executableSha256 = Get-EasyFireSha256 -Path ([string]$process.ExecutablePath)
            commandLineSha256 = Get-EasyFireTextSha256 -Text ([string]$process.CommandLine)
            launcherPath = [string]$Plan.controller.privateLauncherPath
            launcherSha256 = [string]$Plan.controller.privateLauncherSha256
            launcherChildSha256 = [string]$Plan.controller.privateLauncherChildSha256
            listenerAddress = '100.84.66.30'
            listenerPort = 25186
            processPresent = $true
            listenerPresent = $true
        }
        endpoint = [ordered]@{
            listenerProcessId = [int]$process.ProcessId
            probes = @($probeUris | ForEach-Object {
                [ordered]@{ uri = $_; statusCode = Get-EasyFireHttpStatusCode -Uri $_ }
            })
        }
        preservation = [ordered]@{
            dataVolumesPreserved = $true
            releasesPreserved = $true
            backupsPreserved = $true
            guestStoppedAndLocked = $true
            noResourcesDeleted = $true
            publicExposureAbsent = $true
        }
    }
}

function Invoke-EasyFireBindFinalCheckpoint {
    param([Parameter(Mandatory = $true)]$Plan)
    if (-not $CheckpointManifestPath -or -not $CheckpointManifestSha256) {
        throw 'BindFinalCheckpoint requires the exact final checkpoint-v2 path and SHA-256.'
    }
    $checkpoint = Resolve-EasyFireContainedPath -Path $CheckpointManifestPath `
        -Root 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\backups' -MustExist
    if ((Get-EasyFireSha256 -Path $checkpoint) -cne $CheckpointManifestSha256.ToLowerInvariant()) {
        throw 'Final checkpoint-v2 SHA-256 mismatch.'
    }
    $verified = Invoke-EasyFireVerifyQuiesced -Plan $Plan
    $journal = Get-EasyFireJournalPath -Plan $Plan
    $bindingPath = Join-Path $journal 'source-quiesce-checkpoint-binding.json'
    $null = Invoke-EasyFireContract -Plan $Plan -Arguments @(
        '--mode', 'build-checkpoint-binding', '--plan', $script:ExactPlanPath,
        '--source-receipt', [string]$verified.receipt,
        '--snapshot', [string]$verified.snapshot,
        '--checkpoint', $checkpoint,
        '--bound-at', (Get-Date).ToUniversalTime().ToString('o'),
        '--output', $bindingPath
    ) -Label 'Final checkpoint/quiesce binding publication'
    return [ordered]@{
        status = 'bound-verified'
        binding = $bindingPath
        bindingSha256 = Get-EasyFireSha256 -Path $bindingPath
        checkpoint = $checkpoint
        checkpointSha256 = Get-EasyFireSha256 -Path $checkpoint
    }
}

function Invoke-EasyFireAbortBeforeActivation {
    param([Parameter(Mandatory = $true)]$Plan)
    if (-not $GuestIsolationEvidencePath -or -not $GuestIsolationEvidenceSha256) {
        throw 'AbortBeforeActivation requires the exact guest-isolation evidence path and SHA-256.'
    }
    $journal = Get-EasyFireJournalPath -Plan $Plan
    $sourceReceiptPath = Join-Path $journal 'source-quiesce-receipt.json'
    $bindingPath = Join-Path $journal 'source-quiesce-checkpoint-binding.json'
    $guestEvidence = Resolve-EasyFireContainedPath -Path $GuestIsolationEvidencePath -Root $journal -MustExist
    if ((Get-EasyFireSha256 -Path $guestEvidence) -cne $GuestIsolationEvidenceSha256.ToLowerInvariant()) {
        throw 'Guest-isolation evidence SHA-256 mismatch.'
    }
    foreach ($path in @($sourceReceiptPath, $bindingPath, $guestEvidence)) {
        $null = Assert-EasyFireRestrictedAuthority -Path $path -OwnerSid ([string]$Plan.evidence.authorityOwnerSid)
    }
    foreach ($forbidden in @(
        'cutover-authorization.json',
        'source-pre-activation-abort-authority.json',
        'source-pre-activation-abort-receipt.json',
        'source-pre-activation-abort-failure.json'
    )) {
        if (Test-Path -LiteralPath (Join-Path $journal $forbidden)) {
            throw "AbortBeforeActivation cannot replay or cross an activation boundary: $forbidden"
        }
    }
    $verified = Invoke-EasyFireVerifyQuiesced -Plan $Plan
    $null = Invoke-EasyFireAbortContract -Plan $Plan -Arguments @(
        '--mode', 'validate-guest-isolation', '--plan', $script:ExactPlanPath,
        '--source-receipt', $sourceReceiptPath,
        '--checkpoint-binding', $bindingPath,
        '--guest-evidence', $guestEvidence
    ) -Label 'Pre-first-write guest isolation validation'
    $guestIsolation = Get-Content -LiteralPath $guestEvidence -Raw -Encoding utf8 | ConvertFrom-Json
    $authorityPath = Join-Path $journal 'source-pre-activation-abort-authority.json'
    Write-EasyFireJsonCreateNew -Path $authorityPath -Value ([ordered]@{
        schemaVersion = 1
        project = 'easyfire-bookkeeping'
        kind = 'easyfire-bookkeeping-source-pre-activation-abort-authority'
        status = 'claimed-once'
        cutoverId = [string]$Plan.cutoverId
        claimedAt = (Get-Date).ToUniversalTime().ToString('o')
        planSha256 = $PlanSha256.ToLowerInvariant()
        sourceQuiesceReceiptSha256 = Get-EasyFireSha256 -Path $sourceReceiptPath
        checkpointBindingSha256 = Get-EasyFireSha256 -Path $bindingPath
        guestIsolationEvidenceSha256 = Get-EasyFireSha256 -Path $guestEvidence
        firstUserWriteAuthority = $guestIsolation.guest.firstUserWriteAuthority
        guestCutoverDecisionClaim = $guestIsolation.collector.decisionClaim
        guestCollectorExecutableSha256 = [string]$guestIsolation.collector.executableSha256
        automaticRetryAuthorized = $false
        staleWindowsRollbackAfterGuestWriteForbidden = $true
    })
    $stateless = @($Plan.source.expectedInitialSnapshot.containers | Where-Object { $_.tier -ceq 'stateless' })
    $startedIds = New-Object Collections.Generic.List[string]
    $routeProcessId = 0
    try {
        $occupied = @(Get-NetTCPConnection -State Listen -LocalPort 25186 -ErrorAction SilentlyContinue)
        if ($occupied.Count -ne 0) { throw 'Port 25186 became occupied before the pinned private launcher ran.' }
        foreach ($container in $stateless) {
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                'container', 'start', [string]$container.id
            ) -Label "Rearm exact source writer: $($container.name)"
            $startedIds.Add([string]$container.id)
            $script:CompletedActions.Add("started-source-writer:$($container.id)")
        }
        $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $null = Invoke-EasyFireNative -FilePath $powershellPath -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', [string]$Plan.controller.privateLauncherPath
        ) -Label 'Launch the hash-pinned private source route'
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 25186 -ErrorAction SilentlyContinue | Where-Object {
                $_.LocalAddress -ceq '100.84.66.30'
            })
            if ($listeners.Count -eq 1) {
                $routeProcessId = [int]$listeners[0].OwningProcess
                break
            }
            Start-Sleep -Seconds 1
        }
        if ($routeProcessId -lt 1) { throw 'The pinned private launcher did not establish its exact listener.' }
        $script:CompletedActions.Add("launched-private-route:$routeProcessId")
        foreach ($container in $stateless) {
            $restartValue = [string]$container.restartPolicy
            if ($restartValue -ceq 'on-failure' -and [int]$container.maximumRetryCount -gt 0) {
                $restartValue = "on-failure:$([int]$container.maximumRetryCount)"
            }
            $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                'container', 'update', "--restart=$restartValue", [string]$container.id
            ) -Label "Restore exact source restart policy: $($container.name)"
            $script:CompletedActions.Add("restored-restart-policy:$($container.id)")
        }
        $snapshotPath = Join-Path $journal 'source-pre-activation-abort-after.json'
        $snapshot = Get-EasyFireSourceRearmSnapshot -Plan $Plan
        Write-EasyFireJsonCreateNew -Path $snapshotPath -Value $snapshot
        $null = Invoke-EasyFireAbortContract -Plan $Plan -Arguments @(
            '--mode', 'validate-rearm-snapshot', '--plan', $script:ExactPlanPath,
            '--snapshot', $snapshotPath
        ) -Label 'Rearmed private Windows source validation'
        $abortedAt = (Get-Date).ToUniversalTime().ToString('o')
        $receiptPath = Join-Path $journal 'source-pre-activation-abort-receipt.json'
        $null = Invoke-EasyFireAbortContract -Plan $Plan -Arguments @(
            '--mode', 'build-source-abort-receipt', '--plan', $script:ExactPlanPath,
            '--source-receipt', $sourceReceiptPath,
            '--checkpoint-binding', $bindingPath,
            '--guest-evidence', $guestEvidence,
            '--snapshot', $snapshotPath,
            '--aborted-at', $abortedAt,
            '--output', $receiptPath
        ) -Label 'Pre-first-write source-abort receipt publication'
        $null = Invoke-EasyFireAbortContract -Plan $Plan -Arguments @(
            '--mode', 'validate-source-abort-receipt', '--plan', $script:ExactPlanPath,
            '--receipt', $receiptPath
        ) -Label 'Pre-first-write source-abort receipt validation'
        return [ordered]@{
            status = 'windows-source-rearmed-private'
            cutoverId = [string]$Plan.cutoverId
            receipt = $receiptPath
            receiptSha256 = Get-EasyFireSha256 -Path $receiptPath
            guestRemainsStoppedAndLocked = $true
            legacyTasksRemainDisabled = $true
            cloudflareRemainsDisabled = $true
            publicExposureAuthorized = $false
            activationPermanentlyRefusedForCutoverId = $true
        }
    } catch {
        $originalFailure = $_
        $containmentErrors = New-Object Collections.Generic.List[string]
        try {
            if ($routeProcessId -lt 1) {
                $createdListeners = @(Get-NetTCPConnection -State Listen -LocalPort 25186 -ErrorAction SilentlyContinue | Where-Object {
                    $_.LocalAddress -ceq '100.84.66.30'
                })
                if ($createdListeners.Count -eq 1) { $routeProcessId = [int]$createdListeners[0].OwningProcess }
            }
            if ($routeProcessId -gt 0) {
                $routeProcess = Get-CimInstance -ClassName Win32_Process `
                    -Filter "ProcessId=$routeProcessId" -ErrorAction Stop
                if ([IO.Path]::GetFileName([string]$routeProcess.ExecutablePath) -notmatch '^(?:powershell|pwsh)\.exe$') {
                    throw 'Containment refused to stop an unexpected listener owner.'
                }
                Stop-Process -Id $routeProcessId -ErrorAction Stop
            }
        } catch { $containmentErrors.Add('private-route-containment-failed') }
        foreach ($containerId in @($startedIds)) {
            try {
                $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                    'container', 'update', '--restart=no', $containerId
                ) -Label 'Contain failed source rearm restart policy'
                $inspect = @((Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                    'container', 'inspect', $containerId
                ) -Label 'Inspect failed source rearm containment' | ConvertFrom-Json))[0]
                if ([bool]$inspect.State.Running) {
                    $null = Invoke-EasyFireNative -FilePath 'docker' -ArgumentList @(
                        'container', 'stop', '--time', '30', $containerId
                    ) -Label 'Contain failed source rearm writer'
                }
            } catch { $containmentErrors.Add("writer-containment-failed:$containerId") }
        }
        $failurePath = Join-Path $journal 'source-pre-activation-abort-failure.json'
        if (-not (Test-Path -LiteralPath $failurePath)) {
            Write-EasyFireJsonCreateNew -Path $failurePath -Value ([ordered]@{
                schemaVersion = 1
                project = 'easyfire-bookkeeping'
                kind = 'easyfire-bookkeeping-source-pre-activation-abort-failure'
                status = 'failed-contained-preserved'
                failedAt = (Get-Date).ToUniversalTime().ToString('o')
                cutoverId = [string]$Plan.cutoverId
                message = 'Pre-first-write source rearm failed and returned to the narrowest available quiesced boundary.'
                completedActions = @($script:CompletedActions)
                containmentErrors = @($containmentErrors)
                automaticRetryAuthorized = $false
                guestMutationAuthorized = $false
                resourcesDeleted = $false
            })
        }
        throw $originalFailure
    }
}

function Invoke-EasyFireAuthorizeActivation {
    param([Parameter(Mandatory = $true)]$Plan)
    if (-not $ActivationEvidencePath -or -not $ActivationEvidenceSha256) {
        throw 'AuthorizeActivation requires the exact activation-evidence path and SHA-256.'
    }
    $journal = Get-EasyFireJournalPath -Plan $Plan
    foreach ($forbidden in @(
        'source-pre-activation-abort-authority.json',
        'source-pre-activation-abort-receipt.json',
        'source-pre-activation-abort-failure.json'
    )) {
        if (Test-Path -LiteralPath (Join-Path $journal $forbidden)) {
            throw "Activation is permanently refused after a source-abort attempt: $forbidden"
        }
    }
    $evidence = Resolve-EasyFireContainedPath -Path $ActivationEvidencePath -Root $journal -MustExist
    if ((Get-EasyFireSha256 -Path $evidence) -cne $ActivationEvidenceSha256.ToLowerInvariant()) {
        throw 'Activation evidence SHA-256 mismatch.'
    }
    $verified = Invoke-EasyFireVerifyQuiesced -Plan $Plan
    $bindingPath = Join-Path $journal 'source-quiesce-checkpoint-binding.json'
    $null = Assert-EasyFireRestrictedAuthority -Path $bindingPath -OwnerSid ([string]$Plan.evidence.authorityOwnerSid)
    $authorizationPath = Join-Path $journal 'cutover-authorization.json'
    $null = Invoke-EasyFireContract -Plan $Plan -Arguments @(
        '--mode', 'build-activation-authorization', '--plan', $script:ExactPlanPath,
        '--source-receipt', [string]$verified.receipt,
        '--checkpoint-binding', $bindingPath,
        '--activation-evidence', $evidence,
        '--authorized-at', (Get-Date).ToUniversalTime().ToString('o'),
        '--output', $authorizationPath
    ) -Label 'Private-route activation authorization publication'
    return [ordered]@{
        status = 'authorized-once'
        cutoverId = [string]$Plan.cutoverId
        authorization = $authorizationPath
        authorizationSha256 = Get-EasyFireSha256 -Path $authorizationPath
        route = 'tailscale-serve-tailnet-only'
        maximumActivations = 1
        publicExposureAuthorized = $false
    }
}

if ($env:COMPUTERNAME -cne 'NEWSEC') {
    throw "Host mismatch: expected NEWSEC, observed $env:COMPUTERNAME."
}
Assert-EasyFireAdministrator
$prepared = if ($Stage -ceq 'PreparePlan') { Invoke-EasyFirePreparePlan } else { $null }
if ($null -ne $prepared) {
    $prepared | ConvertTo-Json -Depth 10 -Compress
    return
}
if (-not $PlanSha256) { throw "$Stage requires the exact prepared plan SHA-256." }
$plan = Assert-EasyFireCutoverPlan
$result = switch ($Stage) {
    'Quiesce' { Invoke-EasyFireQuiesce -Plan $plan }
    'VerifyQuiesced' { Invoke-EasyFireVerifyQuiesced -Plan $plan }
    'BindFinalCheckpoint' { Invoke-EasyFireBindFinalCheckpoint -Plan $plan }
    'AbortBeforeActivation' { Invoke-EasyFireAbortBeforeActivation -Plan $plan }
    'AuthorizeActivation' { Invoke-EasyFireAuthorizeActivation -Plan $plan }
    default { throw 'Unknown direct-VM cutover stage.' }
}
$result | ConvertTo-Json -Depth 10 -Compress
