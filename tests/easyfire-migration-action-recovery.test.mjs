import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controllerPath = resolve(root, "deploy/windows/migration-action.ps1");

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const harnessPrelude = `
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$script:ControllerPath = ${quotePowerShell(controllerPath)}

function Get-ControllerAst {
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile(
        $script:ControllerPath,
        [ref]$tokens,
        [ref]$errors
    )
    if (@($errors).Count -ne 0) {
        throw "Controller parse failed: $([string]::Join(' | ', @($errors | ForEach-Object Message)))"
    }
    return $ast
}

function Get-ControllerFunctionText {
    param([Parameter(Mandatory = $true)][string]$Name)
    $matches = @((Get-ControllerAst).FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            [string]$node.Name -ceq $Name
    }, $true))
    if ($matches.Count -ne 1) { throw "Controller function is not unique: $Name" }
    return [string]$matches[0].Extent.Text
}

function Get-ControllerDispatcherText {
    $matches = @((Get-ControllerAst).FindAll({
        param($node)
        $node -is [Management.Automation.Language.SwitchStatementAst] -and
            [string]$node.Condition.Extent.Text -ceq '$Mode' -and
            [string]$node.Extent.Text -match 'Invoke-EasyFireMigrationAbortRehearsal'
    }, $true))
    if ($matches.Count -ne 1) { throw 'Controller mode dispatcher is not unique.' }
    return [string]$matches[0].Extent.Text
}
`;

function runPowerShellHarness(body) {
  const fixture = mkdtempSync(resolve(tmpdir(), "easyfire-recovery-test-"));
  const scriptPath = resolve(fixture, "harness.ps1");
  writeFileSync(scriptPath, `${harnessPrelude}\n${body}\n`, "utf8");
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    assert.equal(
      result.status,
      0,
      `PowerShell harness failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(lines.length > 0, "PowerShell harness emitted no result.");
    return JSON.parse(lines.at(-1));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("real dispatcher aborts representative interrupted pre-auth phases and routes authenticated phases only to resume", () => {
  const evidence = runPowerShellHarness(`
$dispatcher = Get-ControllerDispatcherText
. ([scriptblock]::Create("function Invoke-ControllerDispatcherUnderTest { param([string]\`$Mode) $dispatcher }"))

function Invoke-EasyFireMigrationAbortRehearsal {
    param($Failure)
    $script:AbortCalls++
    return [pscustomobject]@{ State='RehearsalAborted'; Failure=[string]$Failure.Exception.Message }
}
function Invoke-EasyFireMigrationRehearsal { $script:RehearsalCalls++; return [pscustomobject]@{ State='Rehearsal' } }
function Invoke-EasyFireMigrationAcceptAuthentication { throw 'not expected' }
function Invoke-EasyFireMigrationCutover { throw 'not expected' }
function Invoke-EasyFireMigrationAutomaticRollback { throw 'not expected' }

$partialResults = @()
foreach ($phase in @('InitialRestoreRunning', 'RehearsalDataStarting', 'RehearsalMigrationRunning', 'RehearsalAppReady')) {
    $script:AbortCalls = 0
    $script:RehearsalCalls = 0
    $script:JournalRead = [pscustomobject]@{ Journal=[pscustomobject]@{ CurrentState='Rehearsing'; Phase=$phase } }
    $result = @(Invoke-ControllerDispatcherUnderTest -Mode Rehearse)
    $partialResults += [pscustomobject]@{
        Phase=$phase
        AbortCalls=$script:AbortCalls
        RehearsalCalls=$script:RehearsalCalls
        ResultState=[string]$result[0].State
    }
}

$guardedResults = @()
foreach ($phase in @('RehearsalAuthenticated', 'RehearsalRollbackPrepared')) {
    $script:AbortCalls = 0
    $script:RehearsalCalls = 0
    $script:JournalRead = [pscustomobject]@{ Journal=[pscustomobject]@{ CurrentState='Rehearsing'; Phase=$phase } }
    $message = ''
    try { $null = Invoke-ControllerDispatcherUnderTest -Mode Rehearse }
    catch { $message = [string]$_.Exception.Message }
    $guardedResults += [pscustomobject]@{
        Phase=$phase
        AbortCalls=$script:AbortCalls
        RehearsalCalls=$script:RehearsalCalls
        Error=$message
    }
}

[pscustomobject]@{ Partial=$partialResults; Guarded=$guardedResults } | ConvertTo-Json -Depth 10 -Compress
`);

  assert.deepEqual(
    evidence.Partial.map((item) => item.Phase),
    [
      "InitialRestoreRunning",
      "RehearsalDataStarting",
      "RehearsalMigrationRunning",
      "RehearsalAppReady",
    ],
  );
  for (const item of evidence.Partial) {
    assert.equal(item.AbortCalls, 1, item.Phase);
    assert.equal(item.RehearsalCalls, 0, item.Phase);
    assert.equal(item.ResultState, "RehearsalAborted", item.Phase);
  }
  for (const item of evidence.Guarded) {
    assert.equal(item.AbortCalls, 0, item.Phase);
    assert.equal(item.RehearsalCalls, 0, item.Phase);
    assert.match(item.Error, /resumed with AcceptAuthentication/i, item.Phase);
  }
});

test("real dispatcher preserves the original rehearsal error when abort also fails", () => {
  const evidence = runPowerShellHarness(`
$dispatcher = Get-ControllerDispatcherText
. ([scriptblock]::Create("function Invoke-ControllerDispatcherUnderTest { param([string]\`$Mode) $dispatcher }"))

function Invoke-EasyFireMigrationRehearsal {
    $script:JournalRead.Journal.CurrentState = 'Rehearsing'
    $script:JournalRead.Journal.Phase = 'RehearsalDataStarting'
    throw 'original rehearsal failure'
}
function Refresh-EasyFireMigrationJournal { return $script:JournalRead }
function Invoke-EasyFireMigrationAbortRehearsal { param($Failure); throw 'abort evidence failure' }
function Invoke-EasyFireMigrationAcceptAuthentication { throw 'not expected' }
function Invoke-EasyFireMigrationCutover { throw 'not expected' }
function Invoke-EasyFireMigrationAutomaticRollback { throw 'not expected' }

$script:JournalPath = 'C:\\test\\migration.json'
$script:JournalRead = [pscustomobject]@{ Journal=[pscustomobject]@{ CurrentState='Planned'; Phase='Planned' } }
$message = ''
try { $null = Invoke-ControllerDispatcherUnderTest -Mode Rehearse }
catch { $message = [string]$_.Exception.Message }
[pscustomobject]@{ Message=$message } | ConvertTo-Json -Compress
`);

  assert.match(evidence.Message, /original rehearsal failure/i);
  assert.match(evidence.Message, /abort evidence failure/i);
  assert.match(evidence.Message, /C:\\test\\migration\.json/i);
});

test("actual rehearsal abort stops partial lanes, preserves their volumes, verifies source, and becomes terminal", () => {
  const evidence = runPowerShellHarness(`
. ([scriptblock]::Create((Get-ControllerFunctionText -Name 'Stop-EasyFireMigrationLaneAndVerify')))
. ([scriptblock]::Create((Get-ControllerFunctionText -Name 'Invoke-EasyFireMigrationAbortRehearsal')))

function Refresh-EasyFireMigrationJournal { return $script:JournalRead }
function Stop-EasyFireMigrationLaneContainers {
    param($Lane)
    $script:StopCalls++
    foreach ($container in @($script:Adapter.Containers)) { $container.State = 'exited' }
    return [pscustomobject]@{
        Containers=@($script:Adapter.Containers)
        Volumes=@($script:Adapter.Volumes)
    }
}
function Assert-EasyFireMigrationLiveSource {
    $script:SourceChecks++
    return [pscustomobject]@{ Containers=@([pscustomobject]@{ Service='mysql'; State='running' }) }
}
function Start-EasyFireMigrationOperation {
    param($Name, $Lane)
    return [pscustomobject]@{ Name=$Name; Lane=$Lane; OperationId='11111111-1111-4111-8111-111111111111'; State='Started' }
}
function Complete-EasyFireMigrationOperation {
    param($Operation, $Lane, $Evidence)
    $script:CapturedEvidence = $Evidence
    return [pscustomobject]@{ Kind=[string]$Operation.Name; Sha256=('A' * 64 -join '') }
}
function Move-EasyFireMigrationPhase {
    param($State, $Phase, $Receipt, $CompletedAuthority, $BackupReceiptRole, $BackupReceipt)
    $script:JournalRead.Journal.CurrentState = $State
    $script:JournalRead.Journal.Phase = $Phase
    return $script:JournalRead
}
function Get-EasyFireMigrationInventoryFingerprint { param($Inventory) return 'SOURCE-FINGERPRINT' }
function Get-EasyFireMigrationLaneInventoryFingerprint { param($Inventory) return 'LANE-FINGERPRINT' }

$results = @()
$cases = @(
    [pscustomobject]@{ Phase='InitialRestoreRunning'; ContainerCount=0 },
    [pscustomobject]@{ Phase='RehearsalDataStarting'; ContainerCount=2 },
    [pscustomobject]@{ Phase='RehearsalMigrationRunning'; ContainerCount=5 },
    [pscustomobject]@{ Phase='RehearsalAppReady'; ContainerCount=7 }
)
foreach ($case in $cases) {
    $containers = @()
    for ($index = 0; $index -lt [int]$case.ContainerCount; $index++) {
        $containers += [pscustomobject]@{ Id="candidate-$index"; State='running' }
    }
    $script:Adapter = [pscustomobject]@{
        Containers=$containers
        Volumes=@('rehearsal_mysql', 'rehearsal_redis')
    }
    $volumesBefore = @($script:Adapter.Volumes)
    $script:StopCalls = 0
    $script:SourceChecks = 0
    $script:CapturedEvidence = $null
    $script:JournalPath = 'C:\test\migration.json'
    $script:JournalRead = [pscustomobject]@{
        Journal=[pscustomobject]@{
            CurrentState='Rehearsing'
            Phase=[string]$case.Phase
            Lanes=[pscustomobject]@{ Rehearsal=[pscustomobject]@{ ProjectName='candidate-rehearsal' } }
        }
    }
    $failure = [Management.Automation.ErrorRecord]::new(
        [Exception]::new('synthetic interruption'),
        'SyntheticInterruption',
        [Management.Automation.ErrorCategory]::OperationStopped,
        $null
    )
    $result = Invoke-EasyFireMigrationAbortRehearsal -Failure $failure
    $stopCallsAfterFirst = $script:StopCalls
    $sourceChecksAfterFirst = $script:SourceChecks
    $terminalError = ''
    try { $null = Invoke-EasyFireMigrationAbortRehearsal -Failure $failure }
    catch { $terminalError = [string]$_.Exception.Message }
    $results += [pscustomobject]@{
        Phase=[string]$case.Phase
        ContainerCount=[int]$case.ContainerCount
        RunningAfter=@($script:Adapter.Containers | Where-Object State -ceq 'running').Count
        VolumesUnchanged=(@(Compare-Object $volumesBefore @($script:Adapter.Volumes) -CaseSensitive).Count -eq 0)
        StopCallsAfterFirst=$stopCallsAfterFirst
        StopCallsAfterSecond=$script:StopCalls
        SourceChecksAfterFirst=$sourceChecksAfterFirst
        SourceChecksAfterSecond=$script:SourceChecks
        CandidateVolumesPreserved=[bool]$script:CapturedEvidence.CandidateVolumesPreserved
        SourceUnchanged=[bool]$script:CapturedEvidence.SourceUnchanged
        State=[string]$result.State
        PersistedState=[string]$script:JournalRead.Journal.CurrentState
        TerminalError=$terminalError
    }
}
$results | ConvertTo-Json -Depth 10 -Compress
`);

  assert.equal(evidence.length, 4);
  for (const item of evidence) {
    assert.equal(item.RunningAfter, 0, item.Phase);
    assert.equal(item.VolumesUnchanged, true, item.Phase);
    assert.equal(item.StopCallsAfterFirst, 1, item.Phase);
    assert.equal(item.StopCallsAfterSecond, 1, item.Phase);
    assert.equal(item.SourceChecksAfterFirst, 1, item.Phase);
    assert.equal(item.SourceChecksAfterSecond, 1, item.Phase);
    assert.equal(item.CandidateVolumesPreserved, true, item.Phase);
    assert.equal(item.SourceUnchanged, true, item.Phase);
    assert.equal(item.State, "RehearsalAborted", item.Phase);
    assert.equal(item.PersistedState, "RehearsalAborted", item.Phase);
    assert.match(item.TerminalError, /only from a persisted Rehearsing state/i);
  }
});

function ingressHarness({ failPersistence }) {
  return runPowerShellHarness(`
. ([scriptblock]::Create((Get-ControllerFunctionText -Name 'Invoke-EasyFireMigrationCutover')))

$script:Log = [Collections.Generic.List[string]]::new()
$script:FailPersistence = ${failPersistence ? "$true" : "$false"}
$script:CutoverMutationStarted = $false
$script:JournalPath = 'C:\test\migration.json'
$script:JournalRead = [pscustomobject]@{
    Journal=[pscustomobject]@{
        CurrentState='RehearsalVerified'
        Phase='RehearsalRollbackVerified'
        Lanes=[pscustomobject]@{
            Cutover=[pscustomobject]@{
                ProjectName='candidate-cutover'
                MysqlVolumeName='cutover_mysql'
                RedisVolumeName='cutover_redis'
            }
        }
        Authority=[pscustomobject]@{ Document=[pscustomobject]@{ Target=[pscustomobject]@{ Images=@() } } }
    }
}
$BackupTaskXmlPath = 'C:\test\backup.xml'
$BackupTaskXmlSha256 = ('B' * 64 -join '')
$StartupTaskXmlPath = 'C:\test\startup.xml'
$StartupTaskXmlSha256 = ('C' * 64 -join '')

function Assert-EasyFireMigrationControllerBundleAuthority { return [pscustomobject]@{ Exact=$true } }
function Assert-EasyFireMigrationLiveSource { return [pscustomobject]@{ Containers=@() } }
function Assert-EasyFireMigrationTargetImages { param($Images, [switch]$InspectDocker) }
function Assert-EasyFireMigrationFreshLanePreflight { param($Lane) return [pscustomobject]@{ Passed=$true } }
function Add-EasyFireMigrationPreservedVolume { param($Name); $script:Log.Add("PreserveVolume:$Name") }
function Move-EasyFireMigrationPhase {
    param($State, $Phase, $Receipt, $CompletedAuthority, $BackupReceiptRole, $BackupReceipt)
    $script:Log.Add("Persist:$State|$Phase|Receipt=$($null -ne $Receipt)")
    if ($script:FailPersistence -and $Phase -ceq 'IngressPausePrepared') { throw 'synthetic durable persistence failure' }
    $script:JournalRead.Journal.CurrentState = $State
    $script:JournalRead.Journal.Phase = $Phase
    return $script:JournalRead
}
function Start-EasyFireMigrationOperation {
    param($Name, $Lane)
    $script:Log.Add("StartOperation:$Name")
    return [pscustomobject]@{ Name=$Name; Lane=$Lane; State='Started'; OperationId='22222222-2222-4222-8222-222222222222' }
}
function Get-EasyFireMigrationIngressPreState {
    $script:Log.Add('PreStateCaptured')
    return [pscustomobject]@{ ServiceState='Running'; TaskEnabled=$true }
}
function Assert-EasyFireMigrationCheckpointTask { param($Kind, $CheckpointXmlPath, $CheckpointXmlSha256) }
function Get-EasyFireMigrationInventoryFingerprint { param($Inventory) return 'SOURCE-FINGERPRINT' }
function Complete-EasyFireMigrationOperation {
    param($Operation, $Lane, $Evidence)
    $script:Log.Add("ReceiptCreated:$([string]$Operation.Name)")
    return [pscustomobject]@{ Kind=[string]$Operation.Name; Sha256=('D' * 64 -join '') }
}
function Stop-EasyFireMigrationIngress {
    $script:Log.Add('StopIngress')
    throw 'synthetic stop boundary'
}
function Disable-EasyFireMigrationBackupTaskFence {
    param($CheckpointXmlPath, $CheckpointXmlSha256)
    $script:Log.Add('FenceBackupTask')
}

$errorMessage = ''
try { $null = Invoke-EasyFireMigrationCutover }
catch { $errorMessage = [string]$_.Exception.Message }
[pscustomobject]@{ Log=@($script:Log); Error=$errorMessage } | ConvertTo-Json -Depth 10 -Compress
`);
}

test("cutover persists a hash-bound ingress prestate receipt before stopping ingress or fencing the backup task", () => {
  const evidence = ingressHarness({ failPersistence: false });
  const receipt = evidence.Log.indexOf("ReceiptCreated:IngressPausePlan");
  const persisted = evidence.Log.indexOf(
    "Persist:CuttingOver|IngressPausePrepared|Receipt=True",
  );
  const stopped = evidence.Log.indexOf("StopIngress");
  assert.ok(receipt >= 0, evidence.Log.join("\n"));
  assert.ok(persisted > receipt, evidence.Log.join("\n"));
  assert.ok(stopped > persisted, evidence.Log.join("\n"));
  assert.equal(evidence.Log.includes("FenceBackupTask"), false);
  assert.match(evidence.Error, /synthetic stop boundary/i);
});

test("a failed ingress-prestate persistence boundary prevents both ingress stop and task fencing", () => {
  const evidence = ingressHarness({ failPersistence: true });
  assert.ok(
    evidence.Log.includes(
      "Persist:CuttingOver|IngressPausePrepared|Receipt=True",
    ),
    evidence.Log.join("\n"),
  );
  assert.equal(evidence.Log.includes("StopIngress"), false);
  assert.equal(evidence.Log.includes("FenceBackupTask"), false);
  assert.match(evidence.Error, /durable persistence failure/i);
});

test("completed rollback requires emergency restore proof, resumes every persisted phase, and mutates only after proof", () => {
  const evidence = runPowerShellHarness(`
. ([scriptblock]::Create((Get-ControllerFunctionText -Name 'Get-EasyFireMigrationProperty')))
. ([scriptblock]::Create((Get-ControllerFunctionText -Name 'Invoke-EasyFireMigrationAutomaticRollback')))

$MigrationId = '33333333-3333-4333-8333-333333333333'
$AuthorityRoot = 'C:\test\authority'
$AuthorityOwnerSid = 'S-1-5-21-1-2-3-1001'
$TargetReleaseDirectory = 'C:\test\release'
$BackupTaskXmlPath = 'C:\test\backup.xml'
$BackupTaskXmlSha256 = ('E' * 64 -join '')
$StartupTaskXmlPath = 'C:\test\startup.xml'
$StartupTaskXmlSha256 = ('F' * 64 -join '')
$script:JournalPath = 'C:\test\migration.json'

function Refresh-EasyFireMigrationJournal { return $script:JournalRead }
function Assert-EasyFireMigrationControllerBundleAuthority { return [pscustomobject]@{ Exact=$true } }
function Move-EasyFireMigrationPhase {
    param($State, $Phase, $Receipt, $CompletedAuthority, $BackupReceiptRole, $BackupReceipt)
    $journal = $script:JournalRead.Journal
    $fromState = [string]$journal.CurrentState
    $fromPhase = [string]$journal.Phase
    $script:Log.Add("Move:$State|$Phase")
    $journal.Transitions = @($journal.Transitions) + @([pscustomobject]@{
        FromState=$fromState; FromPhase=$fromPhase; ToState=$State; ToPhase=$Phase
    })
    $journal.CurrentState = $State
    $journal.Phase = $Phase
    return $script:JournalRead
}
function Invoke-EasyFireMigrationChildScript {
    param($ScriptPath, $Arguments)
    $script:EmergencyChildCalls++
    $script:Log.Add('EmergencyCompositeStart')
    $script:JournalRead.Journal.Phase = 'EmergencyBackupReady'
    $script:Log.Add('EmergencyBackupReady')
    if ($script:ChildMode -ceq 'BackupOnly') {
        return [pscustomobject]@{ Output=@('MIGRATION_BACKUP_PASSED {"Passed":false}') }
    }
    $script:JournalRead.Journal.Phase = 'EmergencyRestoreVerified'
    $script:JournalRead.Journal.BackupReceipts.MigrationEmergency = [pscustomobject]@{
        RecoveryUnit=[pscustomobject]@{ BackupSha256=('9' * 64 -join ''); IsolatedRestoreVerified=$true }
    }
    $script:Log.Add('EmergencyIsolatedRestoreVerified')
    return [pscustomobject]@{ Output=@('MIGRATION_BACKUP_PASSED {"Passed":true}') }
}
function Get-EasyFireMigrationStructuredOutput { param($Result, $Prefix, $Name); return [pscustomobject]@{ Passed=$true } }
function Stop-EasyFireMigrationLaneAndVerify {
    param($Lane)
    $script:CandidateStopCalls++
    $script:Log.Add('StopCandidate')
    foreach ($container in @($script:CandidateContainers)) { $container.State = 'exited' }
    return [pscustomobject]@{ Containers=@($script:CandidateContainers); Volumes=@($script:CandidateVolumes) }
}
function Restore-EasyFireMigrationCheckpointTask {
    param($Kind, $CheckpointXmlPath, $CheckpointXmlSha256)
    $script:TaskRestoreCalls++
    $script:Log.Add("RestoreTask:$Kind")
}
function Start-EasyFireMigrationSourceServices {
    param($SourceInventory, $Tier)
    $script:SourceStartCalls++
    $script:Log.Add("StartSource:$Tier")
}
function Get-EasyFireMigrationReceiptDocument {
    param($Kind)
    return [pscustomobject]@{ Evidence=[pscustomobject]@{ PreState=[pscustomobject]@{ ServiceState='Running' } } }
}
function Restore-EasyFireMigrationIngressPreState { param($PreState); $script:Log.Add('RestoreIngress') }
function Assert-EasyFireMigrationLiveSource { $script:Log.Add('VerifySource'); return [pscustomobject]@{ Exact=$true } }
function Start-EasyFireMigrationOperation {
    param($Name, $Lane)
    return [pscustomobject]@{ Name=$Name; Lane=$Lane; State='Started'; OperationId='44444444-4444-4444-8444-444444444444' }
}
function Complete-EasyFireMigrationOperation {
    param($Operation, $Lane, $Evidence)
    if ([string]$Operation.Name -ceq 'Rollback') { $script:RollbackEvidence = $Evidence }
    return [pscustomobject]@{ Kind=[string]$Operation.Name; Sha256=('8' * 64 -join '') }
}
function Get-EasyFireMigrationLaneInventoryFingerprint { param($Inventory) return 'LANE-FINGERPRINT' }
function Get-EasyFireMigrationInventoryFingerprint { param($Inventory) return 'SOURCE-FINGERPRINT' }

function Invoke-RollbackScenario {
    param([string]$StartingPhase, [string]$ChildMode, [switch]$VerifyTerminalRerun)
    $script:Log = [Collections.Generic.List[string]]::new()
    $script:ChildMode = $ChildMode
    $script:EmergencyChildCalls = 0
    $script:CandidateStopCalls = 0
    $script:TaskRestoreCalls = 0
    $script:SourceStartCalls = 0
    $script:RollbackEvidence = $null
    $script:CandidateContainers = @([pscustomobject]@{ Id='candidate-server'; State='running' })
    $script:CandidateVolumes = @('cutover_mysql', 'cutover_redis')
    $volumesBefore = @($script:CandidateVolumes)
    $recoveryUnit = if ($StartingPhase -ceq 'EmergencyRestoreVerified') {
        [pscustomobject]@{ BackupSha256=('7' * 64 -join ''); IsolatedRestoreVerified=$true }
    } else { $null }
    $script:JournalRead = [pscustomobject]@{
        Journal=[pscustomobject]@{
            CurrentState='Completed'
            Phase=$StartingPhase
            Lanes=[pscustomobject]@{ Cutover=[pscustomobject]@{ ProjectName='candidate-cutover' } }
            SourceInventory=[pscustomobject]@{ Containers=@() }
            Transitions=@()
            Receipts=@([pscustomobject]@{ Kind='IngressPausePlan' })
            BackupReceipts=[pscustomobject]@{
                MigrationEmergency=[pscustomobject]@{ RecoveryUnit=$recoveryUnit }
            }
        }
    }
    $failure = [Management.Automation.ErrorRecord]::new(
        [Exception]::new('explicit rollback'),
        'ExplicitRollback',
        [Management.Automation.ErrorCategory]::OperationStopped,
        $null
    )
    $errorMessage = ''
    $resultState = ''
    try {
        $result = Invoke-EasyFireMigrationAutomaticRollback -Failure $failure
        $resultState = [string]$result.State
    } catch { $errorMessage = [string]$_.Exception.Message }

    $beforeRerun = [pscustomobject]@{
        EmergencyChildCalls=$script:EmergencyChildCalls
        CandidateStopCalls=$script:CandidateStopCalls
        TaskRestoreCalls=$script:TaskRestoreCalls
        SourceStartCalls=$script:SourceStartCalls
    }
    $terminalError = ''
    if ($VerifyTerminalRerun -and $resultState -ceq 'RolledBack') {
        try { $null = Invoke-EasyFireMigrationAutomaticRollback -Failure $failure }
        catch { $terminalError = [string]$_.Exception.Message }
    }
    return [pscustomobject]@{
        StartingPhase=$StartingPhase
        ChildMode=$ChildMode
        ResultState=$resultState
        PersistedState=[string]$script:JournalRead.Journal.CurrentState
        PersistedPhase=[string]$script:JournalRead.Journal.Phase
        Error=$errorMessage
        TerminalError=$terminalError
        Log=@($script:Log)
        EmergencyChildCalls=$script:EmergencyChildCalls
        CandidateStopCalls=$script:CandidateStopCalls
        TaskRestoreCalls=$script:TaskRestoreCalls
        SourceStartCalls=$script:SourceStartCalls
        CountsBeforeRerun=$beforeRerun
        VolumesUnchanged=(@(Compare-Object $volumesBefore @($script:CandidateVolumes) -CaseSensitive).Count -eq 0)
        CutoverVolumesPreserved=if ($null -eq $script:RollbackEvidence) { $false } else { [bool]$script:RollbackEvidence.CutoverVolumesPreserved }
        EmergencyRecoveryUnitPresent=if ($null -eq $script:RollbackEvidence) { $false } else { $null -ne $script:RollbackEvidence.EmergencyRecoveryUnit }
    }
}

$success = @(
    Invoke-RollbackScenario -StartingPhase Completed -ChildMode Success
    Invoke-RollbackScenario -StartingPhase EmergencyBackupRunning -ChildMode Success
    Invoke-RollbackScenario -StartingPhase EmergencyBackupReady -ChildMode Success
    Invoke-RollbackScenario -StartingPhase EmergencyRestoreVerified -ChildMode Success -VerifyTerminalRerun
)
$blocked = Invoke-RollbackScenario -StartingPhase EmergencyBackupRunning -ChildMode BackupOnly
[pscustomobject]@{ Success=$success; Blocked=$blocked } | ConvertTo-Json -Depth 20 -Compress
`);

  assert.equal(evidence.Success.length, 4);
  for (const item of evidence.Success) {
    assert.equal(item.ResultState, "RolledBack", item.StartingPhase);
    assert.equal(item.PersistedState, "RolledBack", item.StartingPhase);
    assert.equal(item.PersistedPhase, "RolledBack", item.StartingPhase);
    assert.equal(item.CandidateStopCalls, 1, item.StartingPhase);
    assert.equal(item.TaskRestoreCalls, 2, item.StartingPhase);
    assert.equal(item.SourceStartCalls, 2, item.StartingPhase);
    assert.equal(item.VolumesUnchanged, true, item.StartingPhase);
    assert.equal(item.CutoverVolumesPreserved, true, item.StartingPhase);
    assert.equal(item.EmergencyRecoveryUnitPresent, true, item.StartingPhase);

    const stop = item.Log.indexOf("StopCandidate");
    assert.ok(stop >= 0, `${item.StartingPhase}: ${item.Log.join("\n")}`);
    if (item.StartingPhase === "EmergencyRestoreVerified") {
      assert.equal(item.EmergencyChildCalls, 0, item.StartingPhase);
    } else {
      assert.equal(item.EmergencyChildCalls, 1, item.StartingPhase);
      assert.ok(
        item.Log.indexOf("EmergencyBackupReady") < stop,
        item.Log.join("\n"),
      );
      assert.ok(
        item.Log.indexOf("EmergencyIsolatedRestoreVerified") < stop,
        item.Log.join("\n"),
      );
    }
    assert.ok(item.Log.indexOf("StartSource:Data") > stop, item.Log.join("\n"));
    assert.ok(
      item.Log.indexOf("StartSource:Application") > stop,
      item.Log.join("\n"),
    );
  }

  const resumedVerified = evidence.Success.find(
    (item) => item.StartingPhase === "EmergencyRestoreVerified",
  );
  assert.match(resumedVerified.TerminalError, /unavailable from state: RolledBack/i);
  assert.equal(
    resumedVerified.CandidateStopCalls,
    resumedVerified.CountsBeforeRerun.CandidateStopCalls,
  );
  assert.equal(
    resumedVerified.SourceStartCalls,
    resumedVerified.CountsBeforeRerun.SourceStartCalls,
  );

  assert.equal(evidence.Blocked.ResultState, "");
  assert.match(
    evidence.Blocked.Error,
    /requires an isolated-restore-verified emergency recovery unit/i,
  );
  assert.equal(evidence.Blocked.PersistedPhase, "EmergencyBackupReady");
  assert.equal(evidence.Blocked.CandidateStopCalls, 0);
  assert.equal(evidence.Blocked.TaskRestoreCalls, 0);
  assert.equal(evidence.Blocked.SourceStartCalls, 0);
  assert.equal(evidence.Blocked.VolumesUnchanged, true);
});
