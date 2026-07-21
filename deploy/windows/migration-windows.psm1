Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'production-io.psm1') -Force -ErrorAction Stop

$script:MigrationBackupTaskName = 'easyfire-bookkeeping-prod-backup'
$script:MigrationStartupTaskName = 'easyfire-bookkeeping-prod-startup'
$script:MigrationTaskPath = '\'
$script:MigrationCloudflaredServiceName = 'EasyFireBookkeepingCloudflared'
$script:CanonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$script:MigrationBackupTaskDescription = 'Daily isolated-restore-verified backup for the completed EasyFire migration runtime.'

function Get-EasyFireMigrationWindowsSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required file is missing: $Path" }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Assert-EasyFireMigrationWindowsPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [switch]$RequireLeaf,
        [switch]$RequireContainer
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Contains('"') -or
        -not [IO.Path]::IsPathRooted($Path) -or $Path -cne [IO.Path]::GetFullPath($Path)) {
        throw "$Name must be a canonical absolute path without quotes."
    }
    if ($RequireLeaf -and -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Name must identify one existing file."
    }
    if ($RequireContainer -and -not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Name must identify one existing directory."
    }
}

function Get-EasyFireMigrationBackupTaskDefinition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$MigrationId,
        [Parameter(Mandatory = $true)][string]$AuthorityRoot,
        [Parameter(Mandatory = $true)][string]$AuthorityOwnerSid
    )

    Assert-EasyFireMigrationWindowsPath -Path $ScriptPath -Name 'ScriptPath' -RequireLeaf
    Assert-EasyFireMigrationWindowsPath -Path $AuthorityRoot -Name 'AuthorityRoot' -RequireContainer
    $migrationGuid = [Guid]::Empty
    if (-not [Guid]::TryParseExact($MigrationId, 'D', [ref]$migrationGuid) -or
        $MigrationId -cne $migrationGuid.ToString('D').ToLowerInvariant()) {
        throw 'MigrationId must be one canonical lowercase D-format GUID.'
    }
    if ($AuthorityOwnerSid -notmatch '^S-1-5-21-(?:\d+-){3}\d+$') {
        throw 'AuthorityOwnerSid must be a canonical local or domain user SID.'
    }
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $ScriptPath),
        '-MigrationId', $MigrationId,
        '-AuthorityRoot', ('"{0}"' -f $AuthorityRoot),
        '-InvocationRole', 'MigrationScheduled',
        '-AuthorityOwnerSid', $AuthorityOwnerSid
    ) -join ' '
    return [pscustomobject][ordered]@{
        TaskName = $script:MigrationBackupTaskName
        TaskPath = $script:MigrationTaskPath
        ScriptPath = $ScriptPath
        MigrationId = $MigrationId
        AuthorityRoot = $AuthorityRoot
        AuthorityOwnerSid = $AuthorityOwnerSid
        Execute = $script:CanonicalPowerShell
        Arguments = $arguments
        WorkingDirectory = [IO.Path]::GetDirectoryName($ScriptPath)
        ActionClass = 'MSFT_TaskExecAction'
        PrincipalUserId = 'SYSTEM'
        PrincipalLogonType = 'ServiceAccount'
        PrincipalRunLevel = 'Highest'
        PrincipalClass = 'MSFT_TaskPrincipal2'
        PrincipalProcessTokenSidType = 'Default'
        TriggerKind = 'Daily'
        TriggerClass = 'MSFT_TaskDailyTrigger'
        TriggerAt = '02:00'
        DaysInterval = 1
        StartWhenAvailable = $true
        AllowStartIfOnBatteries = $true
        DontStopIfGoingOnBatteries = $true
        Enabled = $true
        ExecutionTimeLimitHours = 8
        MultipleInstances = 'IgnoreNew'
        AllowDemandStart = $true
        AllowHardTerminate = $true
        Compatibility = 'Win8'
        SettingsClass = 'MSFT_TaskSettings3'
        DisallowStartOnRemoteAppSession = $false
        Hidden = $false
        Priority = 7
        RestartCount = 0
        RunOnlyIfIdle = $false
        RunOnlyIfNetworkAvailable = $false
        UseUnifiedSchedulingEngine = $true
        Volatile = $false
        WakeToRun = $false
        Description = $script:MigrationBackupTaskDescription
    }
}

function ConvertTo-EasyFireMigrationCanonicalTaskXml {
    param(
        [Parameter(Mandatory = $true)][string]$Xml,
        [switch]$IgnoreEnabled
    )

    try {
        $document = New-Object Xml.XmlDocument
        $document.PreserveWhitespace = $false
        $document.LoadXml($Xml)
    } catch {
        throw 'Scheduled-task XML is invalid.'
    }
    if ($IgnoreEnabled) {
        $manager = New-Object Xml.XmlNamespaceManager($document.NameTable)
        $manager.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
        foreach ($node in @($document.SelectNodes('//t:Settings/t:Enabled', $manager))) {
            $node.InnerText = '<enabled-state-ignored>'
        }
    }
    return $document.OuterXml
}

function Test-EasyFireMigrationTaskXmlEquivalent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$LeftXml,
        [Parameter(Mandatory = $true)][string]$RightXml,
        [switch]$IgnoreEnabled
    )

    return (ConvertTo-EasyFireMigrationCanonicalTaskXml -Xml $LeftXml -IgnoreEnabled:$IgnoreEnabled) -ceq
        (ConvertTo-EasyFireMigrationCanonicalTaskXml -Xml $RightXml -IgnoreEnabled:$IgnoreEnabled)
}

function Get-EasyFireMigrationTaskXml {
    param([Parameter(Mandatory = $true)][ValidateSet('Backup', 'Startup')][string]$Kind)

    $name = if ($Kind -ceq 'Backup') { $script:MigrationBackupTaskName } else { $script:MigrationStartupTaskName }
    $task = Get-ScheduledTask -TaskPath $script:MigrationTaskPath -TaskName $name -ErrorAction SilentlyContinue
    if ($null -eq $task) { return $null }
    return Export-ScheduledTask -TaskPath $script:MigrationTaskPath -TaskName $name -ErrorAction Stop
}

function Assert-EasyFireMigrationCheckpointTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Backup', 'Startup')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$CheckpointXmlPath,
        [Parameter(Mandatory = $true)][string]$CheckpointXmlSha256,
        [switch]$AllowEnabledDrift
    )

    if ($CheckpointXmlSha256 -notmatch '^[A-F0-9]{64}$' -or
        (Get-EasyFireMigrationWindowsSha256 -Path $CheckpointXmlPath) -cne $CheckpointXmlSha256) {
        throw "$Kind scheduled-task checkpoint hash is invalid."
    }
    # PowerShell's content reader honors the XML file's BOM, so both the
    # UTF-16 schtasks export and a UTF-8 recovery copy are read correctly.
    $checkpoint = Get-Content -LiteralPath $CheckpointXmlPath -Raw
    $current = Get-EasyFireMigrationTaskXml -Kind $Kind
    if ($null -eq $current) { throw "$Kind scheduled task is unexpectedly absent." }
    if (-not (Test-EasyFireMigrationTaskXmlEquivalent -LeftXml $checkpoint -RightXml $current `
            -IgnoreEnabled:$AllowEnabledDrift)) {
        throw "$Kind scheduled task drifted from its exact recovery checkpoint."
    }
    return [pscustomobject]@{
        Kind = $Kind
        CurrentXmlSha256 = Get-EasyFireMigrationWindowsTextSha256 -Text $current
        CheckpointXmlSha256 = $CheckpointXmlSha256
        Equivalent = $true
    }
}

function Get-EasyFireMigrationWindowsTextSha256 {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
}

function Disable-EasyFireMigrationBackupTaskFence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$CheckpointXmlPath,
        [Parameter(Mandatory = $true)][string]$CheckpointXmlSha256
    )

    $null = Assert-EasyFireMigrationCheckpointTask -Kind Backup `
        -CheckpointXmlPath $CheckpointXmlPath -CheckpointXmlSha256 $CheckpointXmlSha256 `
        -AllowEnabledDrift
    $task = Get-ScheduledTask -TaskPath $script:MigrationTaskPath `
        -TaskName $script:MigrationBackupTaskName -ErrorAction Stop
    if ([string]$task.State -ceq 'Running') {
        Stop-ScheduledTask -TaskPath $script:MigrationTaskPath `
            -TaskName $script:MigrationBackupTaskName -ErrorAction Stop
    }
    Disable-ScheduledTask -TaskPath $script:MigrationTaskPath `
        -TaskName $script:MigrationBackupTaskName -ErrorAction Stop | Out-Null
    $readback = Get-ScheduledTask -TaskPath $script:MigrationTaskPath `
        -TaskName $script:MigrationBackupTaskName -ErrorAction Stop
    if ([bool]$readback.Settings.Enabled) { throw 'Backup task fence did not become disabled.' }
    return [pscustomobject]@{ TaskName = $script:MigrationBackupTaskName; Disabled = $true; Running = $false }
}

function Get-EasyFireMigrationTaskValueText {
    param($Value)

    if ($null -eq $Value) { return '' }
    return [string]$Value
}

function Get-EasyFireMigrationTaskDurationText {
    param($Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return '' }
    try { return [Xml.XmlConvert]::ToString([TimeSpan]$Value) }
    catch { throw 'Migrated backup task contains an invalid duration field.' }
}

function Get-EasyFireMigrationTaskCimClassName {
    param($Value)

    if ($null -eq $Value -or $null -eq $Value.CimClass) { return '' }
    return [string]$Value.CimClass.CimClassName
}

function Get-EasyFireMigrationBackupTaskReadbackAuthority {
    param([Parameter(Mandatory = $true)]$Task)

    $actions = @($Task.Actions)
    $triggers = @($Task.Triggers)
    if ($actions.Count -ne 1 -or $triggers.Count -ne 1) {
        throw 'Migrated backup task readback does not match exact authority.'
    }
    $triggerStart = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$triggers[0].StartBoundary, [ref]$triggerStart)) {
        throw 'Migrated backup task readback does not match exact authority.'
    }
    $requiredPrivileges = @($Task.Principal.RequiredPrivilege | Where-Object {
            -not [string]::IsNullOrWhiteSpace([string]$_)
        } | ForEach-Object { [string]$_ } | Sort-Object)
    return [pscustomobject][ordered]@{
        TaskName = [string]$Task.TaskName
        TaskPath = [string]$Task.TaskPath
        ActionCount = $actions.Count
        ActionClass = Get-EasyFireMigrationTaskCimClassName -Value $actions[0]
        ActionId = Get-EasyFireMigrationTaskValueText -Value $actions[0].Id
        Execute = [string]$actions[0].Execute
        Arguments = [string]$actions[0].Arguments
        WorkingDirectory = [string]$actions[0].WorkingDirectory
        TriggerCount = $triggers.Count
        TriggerClass = Get-EasyFireMigrationTaskCimClassName -Value $triggers[0]
        TriggerId = Get-EasyFireMigrationTaskValueText -Value $triggers[0].Id
        TriggerAt = $triggerStart.TimeOfDay.ToString('c')
        TriggerEndBoundary = Get-EasyFireMigrationTaskValueText -Value $triggers[0].EndBoundary
        TriggerExecutionTimeLimit = Get-EasyFireMigrationTaskDurationText -Value $triggers[0].ExecutionTimeLimit
        TriggerHasRepetition = ($null -ne $triggers[0].Repetition)
        TriggerRandomDelay = Get-EasyFireMigrationTaskDurationText -Value $triggers[0].RandomDelay
        TriggerDaysInterval = [int]$triggers[0].DaysInterval
        TriggerEnabled = [bool]$triggers[0].Enabled
        PrincipalClass = Get-EasyFireMigrationTaskCimClassName -Value $Task.Principal
        PrincipalId = Get-EasyFireMigrationTaskValueText -Value $Task.Principal.Id
        PrincipalDisplayName = Get-EasyFireMigrationTaskValueText -Value $Task.Principal.DisplayName
        PrincipalGroupId = Get-EasyFireMigrationTaskValueText -Value $Task.Principal.GroupId
        PrincipalUserId = [string]$Task.Principal.UserId
        PrincipalLogonType = [string]$Task.Principal.LogonType
        PrincipalRunLevel = [string]$Task.Principal.RunLevel
        PrincipalProcessTokenSidType = [string]$Task.Principal.ProcessTokenSidType
        PrincipalRequiredPrivileges = @($requiredPrivileges)
        Description = [string]$Task.Description
        SettingsClass = Get-EasyFireMigrationTaskCimClassName -Value $Task.Settings
        SettingsEnabled = [bool]$Task.Settings.Enabled
        StartWhenAvailable = [bool]$Task.Settings.StartWhenAvailable
        DisallowStartIfOnBatteries = [bool]$Task.Settings.DisallowStartIfOnBatteries
        StopIfGoingOnBatteries = [bool]$Task.Settings.StopIfGoingOnBatteries
        ExecutionTimeLimit = Get-EasyFireMigrationTaskDurationText -Value $Task.Settings.ExecutionTimeLimit
        MultipleInstances = [string]$Task.Settings.MultipleInstances
        AllowDemandStart = [bool]$Task.Settings.AllowDemandStart
        AllowHardTerminate = [bool]$Task.Settings.AllowHardTerminate
        Compatibility = [string]$Task.Settings.Compatibility
        DeleteExpiredTaskAfter = Get-EasyFireMigrationTaskDurationText -Value $Task.Settings.DeleteExpiredTaskAfter
        DisallowStartOnRemoteAppSession = [bool]$Task.Settings.DisallowStartOnRemoteAppSession
        Hidden = [bool]$Task.Settings.Hidden
        Priority = [int]$Task.Settings.Priority
        RestartCount = [int]$Task.Settings.RestartCount
        RestartInterval = Get-EasyFireMigrationTaskDurationText -Value $Task.Settings.RestartInterval
        RunOnlyIfIdle = [bool]$Task.Settings.RunOnlyIfIdle
        RunOnlyIfNetworkAvailable = [bool]$Task.Settings.RunOnlyIfNetworkAvailable
        UseUnifiedSchedulingEngine = [bool]$Task.Settings.UseUnifiedSchedulingEngine
        Volatile = [bool]$Task.Settings.volatile
        WakeToRun = [bool]$Task.Settings.WakeToRun
    }
}

function Get-EasyFireMigrationBackupTaskExpectedAuthority {
    param([Parameter(Mandatory = $true)]$Definition)

    return [pscustomobject][ordered]@{
        TaskName = [string]$Definition.TaskName
        TaskPath = [string]$Definition.TaskPath
        ActionCount = 1
        ActionClass = [string]$Definition.ActionClass
        ActionId = ''
        Execute = [string]$Definition.Execute
        Arguments = [string]$Definition.Arguments
        WorkingDirectory = [string]$Definition.WorkingDirectory
        TriggerCount = 1
        TriggerClass = [string]$Definition.TriggerClass
        TriggerId = ''
        TriggerAt = '02:00:00'
        TriggerEndBoundary = ''
        TriggerExecutionTimeLimit = ''
        TriggerHasRepetition = $false
        TriggerRandomDelay = ''
        TriggerDaysInterval = [int]$Definition.DaysInterval
        TriggerEnabled = [bool]$Definition.Enabled
        PrincipalClass = [string]$Definition.PrincipalClass
        PrincipalId = ''
        PrincipalDisplayName = ''
        PrincipalGroupId = ''
        PrincipalUserId = [string]$Definition.PrincipalUserId
        PrincipalLogonType = [string]$Definition.PrincipalLogonType
        PrincipalRunLevel = [string]$Definition.PrincipalRunLevel
        PrincipalProcessTokenSidType = [string]$Definition.PrincipalProcessTokenSidType
        PrincipalRequiredPrivileges = @()
        Description = [string]$Definition.Description
        SettingsClass = [string]$Definition.SettingsClass
        SettingsEnabled = [bool]$Definition.Enabled
        StartWhenAvailable = [bool]$Definition.StartWhenAvailable
        DisallowStartIfOnBatteries = -not [bool]$Definition.AllowStartIfOnBatteries
        StopIfGoingOnBatteries = -not [bool]$Definition.DontStopIfGoingOnBatteries
        ExecutionTimeLimit = 'PT8H'
        MultipleInstances = [string]$Definition.MultipleInstances
        AllowDemandStart = [bool]$Definition.AllowDemandStart
        AllowHardTerminate = [bool]$Definition.AllowHardTerminate
        Compatibility = [string]$Definition.Compatibility
        DeleteExpiredTaskAfter = ''
        DisallowStartOnRemoteAppSession = [bool]$Definition.DisallowStartOnRemoteAppSession
        Hidden = [bool]$Definition.Hidden
        Priority = [int]$Definition.Priority
        RestartCount = [int]$Definition.RestartCount
        RestartInterval = ''
        RunOnlyIfIdle = [bool]$Definition.RunOnlyIfIdle
        RunOnlyIfNetworkAvailable = [bool]$Definition.RunOnlyIfNetworkAvailable
        UseUnifiedSchedulingEngine = [bool]$Definition.UseUnifiedSchedulingEngine
        Volatile = [bool]$Definition.Volatile
        WakeToRun = [bool]$Definition.WakeToRun
    }
}

function Register-EasyFireMigrationBackupTask {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Definition)

    $expectedDefinition = Get-EasyFireMigrationBackupTaskDefinition `
        -ScriptPath ([string]$Definition.ScriptPath) -MigrationId ([string]$Definition.MigrationId) `
        -AuthorityRoot ([string]$Definition.AuthorityRoot) `
        -AuthorityOwnerSid ([string]$Definition.AuthorityOwnerSid)
    if (($Definition | ConvertTo-Json -Depth 10 -Compress) -cne
        ($expectedDefinition | ConvertTo-Json -Depth 10 -Compress)) {
        throw 'Migrated backup task definition is outside exact authority.'
    }
    $action = New-ScheduledTaskAction -Execute ([string]$Definition.Execute) `
        -Argument ([string]$Definition.Arguments) -WorkingDirectory ([string]$Definition.WorkingDirectory)
    $trigger = New-ScheduledTaskTrigger -Daily -At ([string]$Definition.TriggerAt)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::FromHours([int]$Definition.ExecutionTimeLimitHours)) `
        -MultipleInstances ([string]$Definition.MultipleInstances) `
        -Compatibility ([string]$Definition.Compatibility) -Priority ([int]$Definition.Priority) `
        -RestartCount ([int]$Definition.RestartCount) `
        -DisallowStartOnRemoteAppSession:$false -Hidden:$false -RunOnlyIfIdle:$false `
        -RunOnlyIfNetworkAvailable:$false -WakeToRun:$false `
        -DisallowHardTerminate:$false -Disable:$false
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskPath $script:MigrationTaskPath -TaskName $script:MigrationBackupTaskName `
        -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description ([string]$Definition.Description) -Force -ErrorAction Stop | Out-Null
    return Assert-EasyFireMigrationBackupTask -Definition $Definition
}

function Assert-EasyFireMigrationBackupTask {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Definition)

    $task = Get-ScheduledTask -TaskPath $script:MigrationTaskPath `
        -TaskName $script:MigrationBackupTaskName -ErrorAction Stop
    $currentAuthority = Get-EasyFireMigrationBackupTaskReadbackAuthority -Task $task
    $expectedAuthority = Get-EasyFireMigrationBackupTaskExpectedAuthority -Definition $Definition
    if (($currentAuthority | ConvertTo-Json -Depth 10 -Compress) -cne
        ($expectedAuthority | ConvertTo-Json -Depth 10 -Compress)) {
        throw 'Migrated backup task readback does not match exact authority.'
    }
    return [pscustomobject]@{
        TaskName = $script:MigrationBackupTaskName
        Exact = $true
        Enabled = $true
        XmlSha256 = Get-EasyFireMigrationWindowsTextSha256 -Text (
            Get-EasyFireMigrationTaskXml -Kind Backup
        )
    }
}

function Unregister-EasyFireMigrationStartupTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$CheckpointXmlPath,
        [Parameter(Mandatory = $true)][string]$CheckpointXmlSha256
    )

    $null = Assert-EasyFireMigrationCheckpointTask -Kind Startup `
        -CheckpointXmlPath $CheckpointXmlPath -CheckpointXmlSha256 $CheckpointXmlSha256
    Unregister-ScheduledTask -TaskPath $script:MigrationTaskPath `
        -TaskName $script:MigrationStartupTaskName -Confirm:$false -ErrorAction Stop
    if ($null -ne (Get-ScheduledTask -TaskPath $script:MigrationTaskPath `
            -TaskName $script:MigrationStartupTaskName -ErrorAction SilentlyContinue)) {
        throw 'Retired startup task remains present.'
    }
    return [pscustomobject]@{ TaskName = $script:MigrationStartupTaskName; Absent = $true }
}

function Restore-EasyFireMigrationCheckpointTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Backup', 'Startup')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$CheckpointXmlPath,
        [Parameter(Mandatory = $true)][string]$CheckpointXmlSha256
    )

    if ((Get-EasyFireMigrationWindowsSha256 -Path $CheckpointXmlPath) -cne $CheckpointXmlSha256) {
        throw "$Kind task checkpoint hash changed before rollback."
    }
    $name = if ($Kind -ceq 'Backup') { $script:MigrationBackupTaskName } else { $script:MigrationStartupTaskName }
    $xml = Get-Content -LiteralPath $CheckpointXmlPath -Raw
    Register-ScheduledTask -TaskPath $script:MigrationTaskPath -TaskName $name `
        -Xml $xml -Force -ErrorAction Stop | Out-Null
    $null = Assert-EasyFireMigrationCheckpointTask -Kind $Kind `
        -CheckpointXmlPath $CheckpointXmlPath -CheckpointXmlSha256 $CheckpointXmlSha256
    return [pscustomobject]@{ Kind = $Kind; TaskName = $name; Restored = $true }
}

function Get-EasyFireMigrationIngressPreState {
    [CmdletBinding()]
    param()

    $service = Get-CimInstance Win32_Service `
        -Filter "Name='$script:MigrationCloudflaredServiceName'" -ErrorAction Stop
    return [pscustomobject][ordered]@{
        ServiceName = $script:MigrationCloudflaredServiceName
        State = [string]$service.State
        StartMode = [string]$service.StartMode
        PathNameSha256 = Get-EasyFireMigrationWindowsTextSha256 -Text ([string]$service.PathName)
        ProcessId = [int]$service.ProcessId
    }
}

function Stop-EasyFireMigrationIngress {
    [CmdletBinding()]
    param()

    $service = Get-Service -Name $script:MigrationCloudflaredServiceName -ErrorAction Stop
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $script:MigrationCloudflaredServiceName -Force -ErrorAction Stop
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    return [pscustomobject]@{ ServiceName = $script:MigrationCloudflaredServiceName; State = 'Stopped' }
}

function Start-EasyFireMigrationIngress {
    [CmdletBinding()]
    param()

    $service = Get-Service -Name $script:MigrationCloudflaredServiceName -ErrorAction Stop
    if ($service.Status -ne 'Running') {
        Start-Service -Name $script:MigrationCloudflaredServiceName -ErrorAction Stop
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
    return [pscustomobject]@{ ServiceName = $script:MigrationCloudflaredServiceName; State = 'Running' }
}

function Restore-EasyFireMigrationIngressPreState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$PreState)

    if ([string]$PreState.ServiceName -cne $script:MigrationCloudflaredServiceName -or
        [string]$PreState.State -notin @('Running', 'Stopped') -or
        [string]$PreState.StartMode -notin @('Auto', 'Manual', 'Disabled') -or
        [string]$PreState.PathNameSha256 -notmatch '^[A-F0-9]{64}$') {
        throw 'Ingress pre-state authority is invalid.'
    }
    $before = Get-CimInstance Win32_Service `
        -Filter "Name='$script:MigrationCloudflaredServiceName'" -ErrorAction Stop
    if ([string]$before.StartMode -cne [string]$PreState.StartMode -or
        (Get-EasyFireMigrationWindowsTextSha256 -Text ([string]$before.PathName)) -cne
            [string]$PreState.PathNameSha256) {
        throw 'Ingress service configuration drifted from the hash-bound pre-state.'
    }
    if ([string]$PreState.State -ceq 'Running') {
        $null = Start-EasyFireMigrationIngress
    } else {
        $null = Stop-EasyFireMigrationIngress
    }
    $after = Get-CimInstance Win32_Service `
        -Filter "Name='$script:MigrationCloudflaredServiceName'" -ErrorAction Stop
    if ([string]$after.State -cne [string]$PreState.State -or
        [string]$after.StartMode -cne [string]$PreState.StartMode -or
        (Get-EasyFireMigrationWindowsTextSha256 -Text ([string]$after.PathName)) -cne
            [string]$PreState.PathNameSha256) {
        throw 'Ingress service did not restore to its exact hash-bound pre-state.'
    }
    return [pscustomobject]@{
        ServiceName=$script:MigrationCloudflaredServiceName
        State=[string]$PreState.State
        StartMode=[string]$PreState.StartMode
        PathNameSha256=[string]$PreState.PathNameSha256
        Restored=$true
    }
}

function Get-EasyFireMigrationVerifiedIngress {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$CredentialFile,
        [string]$Domain = 'bookkeeping.easyfire.fyi'
    )

    Assert-EasyFireMigrationWindowsPath -Path $CredentialFile -Name 'CredentialFile' -RequireLeaf
    $credential = Get-Content -LiteralPath $CredentialFile -Raw | ConvertFrom-Json
    $edge = Get-EasyFireVerifiedEdgeState -Credential $credential -Domain $Domain `
        -ServiceName $script:MigrationCloudflaredServiceName
    $http = Test-EasyFireHttp -Uri "https://$Domain/" -NoRedirect
    if (-not $http.Reachable -or [int]$http.StatusCode -ne 302 -or
        [string]$http.Location -notmatch '^https://[^/]+\.cloudflareaccess\.com/') {
        throw 'Public owner-only Access redirect verification failed.'
    }
    return [pscustomobject][ordered]@{
        Mode = [string]$edge.Mode
        Hostname = [string]$edge.TunnelHostname
        ConnectorVersion = [string]$edge.ConnectorVersion
        ConnectorArchitecture = [string]$edge.ConnectorArchitecture
        ActiveConnections = [int]$edge.ConnectorActiveConnectionCount
        ConnectorFingerprint = [string]$edge.ConnectorIdentityFingerprint
        PublicStatus = [int]$http.StatusCode
        AccessRedirect = $true
    }
}

Export-ModuleMember -Function `
    Get-EasyFireMigrationBackupTaskDefinition, `
    Test-EasyFireMigrationTaskXmlEquivalent, `
    Get-EasyFireMigrationTaskXml, `
    Assert-EasyFireMigrationCheckpointTask, `
    Disable-EasyFireMigrationBackupTaskFence, `
    Register-EasyFireMigrationBackupTask, `
    Assert-EasyFireMigrationBackupTask, `
    Unregister-EasyFireMigrationStartupTask, `
    Restore-EasyFireMigrationCheckpointTask, `
    Get-EasyFireMigrationIngressPreState, `
    Stop-EasyFireMigrationIngress, `
    Start-EasyFireMigrationIngress, `
    Restore-EasyFireMigrationIngressPreState, `
    Get-EasyFireMigrationVerifiedIngress
