import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(root, "deploy/windows/migration-state.psm1");
const migrationId = "11111111-1111-4111-8111-111111111111";

function runPowerShell(source) {
  const fixture = mkdtempSync(resolve(tmpdir(), "easyfire-migration-state-"));
  const script = resolve(fixture, "scenario.ps1");
  writeFileSync(
    script,
    [
      "Set-StrictMode -Version Latest",
      "$ErrorActionPreference = 'Stop'",
      "Import-Module $env:EASYFIRE_MIGRATION_STATE_MODULE -Force -ErrorAction Stop",
      source,
    ].join("\n\n"),
    "utf8",
  );
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          EASYFIRE_MIGRATION_STATE_MODULE: modulePath,
          EASYFIRE_MIGRATION_STATE_FIXTURE: fixture,
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(lines.length > 0, "PowerShell scenario returned no output");
    return JSON.parse(lines.at(-1));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const journalFixture = String.raw`
$authorityRoot = [IO.Path]::GetFullPath((Join-Path $env:EASYFIRE_MIGRATION_STATE_FIXTURE 'authority'))
$null = New-Item -ItemType Directory -Path $authorityRoot
$sourceInventory = [ordered]@{
  SchemaVersion = 1
  ProjectName = 'easyfire-bookkeeping-prod'
  Fingerprint = ('B' * 64)
}
$authorityDocument = [ordered]@{
  SchemaVersion = 1
  SourceReleaseId = 'E4210A54464D'
  TargetReleaseId = '1F588F338910'
  InitialBackupSha256 = ('C' * 64)
}
$journal = New-EasyFireMigrationJournal -MigrationId '${migrationId}' -AuthorityRoot $authorityRoot -AuthorityDocument $authorityDocument -SourceInventory $sourceInventory
$journalPath = Get-EasyFireMigrationJournalPath -AuthorityRoot $authorityRoot -MigrationId '${migrationId}'
`;

test("derives exact, disjoint rehearsal and cutover identities", () => {
  const evidence = runPowerShell(String.raw`
$authorityRoot = [IO.Path]::GetFullPath((Join-Path $env:EASYFIRE_MIGRATION_STATE_FIXTURE 'authority'))
$null = New-Item -ItemType Directory -Path $authorityRoot
$rehearsal = New-EasyFireMigrationLaneIdentity -MigrationId '${migrationId}' -AuthorityRoot $authorityRoot -Lane Rehearsal
$cutover = New-EasyFireMigrationLaneIdentity -MigrationId '${migrationId}' -AuthorityRoot $authorityRoot -Lane Cutover
[pscustomobject]@{ Rehearsal=$rehearsal; Cutover=$cutover } | ConvertTo-Json -Depth 12 -Compress
`);

  const token = migrationId.replaceAll("-", "");
  const shortToken = token.slice(0, 12);
  assert.equal(
    evidence.Rehearsal.ProjectName,
    `easyfire-bookkeeping-mig-r-${shortToken}`,
  );
  assert.equal(
    evidence.Cutover.ProjectName,
    `easyfire-bookkeeping-mig-c-${shortToken}`,
  );
  assert.equal(
    evidence.Rehearsal.MysqlVolumeName,
    `easyfire_mig_r_mysql_${shortToken}`,
  );
  assert.equal(
    evidence.Cutover.MysqlVolumeName,
    `easyfire_mig_c_mysql_${shortToken}`,
  );
  assert.equal(evidence.Rehearsal.LoopbackPort, 28369);
  assert.equal(evidence.Cutover.LoopbackPort, 80);
  assert.notEqual(evidence.Rehearsal.Directory, evidence.Cutover.Directory);
  assert.notDeepEqual(evidence.Rehearsal.Containers, evidence.Cutover.Containers);
  assert.equal(
    evidence.Rehearsal.AuthorityLabel,
    `easyfire.migration.r=${migrationId}`,
  );
  assert.equal(
    evidence.Cutover.AuthorityLabel,
    `easyfire.migration.c=${migrationId}`,
  );
});

test("initializes and reads one exact schema-2 journal atomically", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$read = Read-EasyFireMigrationJournal -JournalPath $journalPath -ExpectedMigrationId '${migrationId}' -ExpectedAuthorityFingerprint ([string]$journal.Authority.Fingerprint)
$retry = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
[pscustomobject]@{
  SchemaVersion=$read.Journal.SchemaVersion
  CurrentState=$read.Journal.CurrentState
  Phase=$read.Journal.Phase
  Revision=$read.Journal.Revision
  FirstReused=$initialized.Reused
  RetryReused=$retry.Reused
  SameSha=($initialized.Sha256 -ceq $retry.Sha256)
  PreserveOriginals=$read.Journal.PreserveOriginals
  LaneCount=@($read.Journal.Lanes.PSObject.Properties).Count
} | ConvertTo-Json -Compress
`);

  assert.deepEqual(evidence, {
    SchemaVersion: 2,
    CurrentState: "Planned",
    Phase: "Planned",
    Revision: 1,
    FirstReused: false,
    RetryReused: true,
    SameSha: true,
    PreserveOriginals: true,
    LaneCount: 2,
  });
});

test("persists and reuses crash-safe operation IDs", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$first = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Name 'InitialRestore' -Lane Rehearsal
$secondRead = Read-EasyFireMigrationJournal -JournalPath $journalPath -ExpectedMigrationId '${migrationId}' -ExpectedAuthorityFingerprint ([string]$journal.Authority.Fingerprint)
$second = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $secondRead.Sha256 -Name 'InitialRestore' -Lane Rehearsal
[pscustomobject]@{
  FirstId=$first.Operation.OperationId
  SecondId=$second.Operation.OperationId
  FirstReused=$first.Reused
  SecondReused=$second.Reused
  Revision=$second.Journal.Revision
  SameSha=($first.Sha256 -ceq $second.Sha256)
} | ConvertTo-Json -Compress
`);

  assert.match(
    evidence.FirstId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(evidence.SecondId, evidence.FirstId);
  assert.equal(evidence.FirstReused, false);
  assert.equal(evidence.SecondReused, true);
  assert.equal(evidence.Revision, 2);
  assert.equal(evidence.SameSha, true);
});

test("binds a receipt to its operation and only permits explicit transitions", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$operationResult = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Name 'InitialRestore' -Lane Rehearsal
$receipt = Write-EasyFireMigrationReceipt -AuthorityRoot $authorityRoot -MigrationId '${migrationId}' -AuthorityFingerprint ([string]$journal.Authority.Fingerprint) -Lane Rehearsal -Kind InitialRestore -OperationId ([string]$operationResult.Operation.OperationId) -Evidence ([ordered]@{ BackupSha256=('D' * 64); NetworkMode='none' })
$transition = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath -ExpectedJournalSha256 $operationResult.Sha256 -ToState Rehearsing -ToPhase InitialRestoreVerified -ReceiptBinding $receipt
$invalidMessage = ''
try {
  $null = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath -ExpectedJournalSha256 $transition.Sha256 -ToState Completed -ToPhase Completed
} catch { $invalidMessage = $_.Exception.Message }
$read = Read-EasyFireMigrationJournal -JournalPath $journalPath -ExpectedMigrationId '${migrationId}' -ExpectedAuthorityFingerprint ([string]$journal.Authority.Fingerprint)
[pscustomobject]@{
  CurrentState=$read.Journal.CurrentState
  Phase=$read.Journal.Phase
  ReceiptCount=@($read.Journal.Receipts).Count
  ReceiptKind=$read.Journal.Receipts[0].Kind
  TransitionCount=@($read.Journal.Transitions).Count
  InvalidMessage=$invalidMessage
  SnapshotExists=(Test-Path -LiteralPath $transition.TransitionSnapshotPath -PathType Leaf)
} | ConvertTo-Json -Compress
`);

  assert.equal(evidence.CurrentState, "Rehearsing");
  assert.equal(evidence.Phase, "InitialRestoreVerified");
  assert.equal(evidence.ReceiptCount, 1);
  assert.equal(evidence.ReceiptKind, "InitialRestore");
  assert.equal(evidence.TransitionCount, 2);
  assert.match(evidence.InvalidMessage, /transition is not allowed/i);
  assert.equal(evidence.SnapshotExists, true);
});

test("a partial rehearsal can terminate only with a hash-bound abort receipt", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$restoreOperation = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Name 'InitialRestore' -Lane Rehearsal
$restoreReceipt = Write-EasyFireMigrationReceipt -AuthorityRoot $authorityRoot -MigrationId '${migrationId}' -AuthorityFingerprint ([string]$journal.Authority.Fingerprint) -Lane Rehearsal -Kind InitialRestore -OperationId ([string]$restoreOperation.Operation.OperationId) -Evidence ([ordered]@{ RestorePassed=$true })
$rehearsing = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath -ExpectedJournalSha256 $restoreOperation.Sha256 -ToState Rehearsing -ToPhase InitialRestoreVerified -ReceiptBinding $restoreReceipt
$missingReceipt = ''
try {
  $null = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath -ExpectedJournalSha256 $rehearsing.Sha256 -ToState RehearsalAborted -ToPhase RehearsalAborted
} catch { $missingReceipt = $_.Exception.Message }
$abortOperation = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $rehearsing.Sha256 -Name 'RehearsalAbort' -Lane Rehearsal
$abortReceipt = Write-EasyFireMigrationReceipt -AuthorityRoot $authorityRoot -MigrationId '${migrationId}' -AuthorityFingerprint ([string]$journal.Authority.Fingerprint) -Lane Rehearsal -Kind RehearsalAbort -OperationId ([string]$abortOperation.Operation.OperationId) -Evidence ([ordered]@{ CandidateStopped=$true; CandidateVolumesPreserved=$true })
$aborted = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath -ExpectedJournalSha256 $abortOperation.Sha256 -ToState RehearsalAborted -ToPhase RehearsalAborted -ReceiptBinding $abortReceipt
[pscustomobject]@{
  State=$aborted.Journal.CurrentState
  Phase=$aborted.Journal.Phase
  ReceiptKind=$aborted.Journal.Receipts[-1].Kind
  MissingReceipt=$missingReceipt
} | ConvertTo-Json -Compress
`);
  assert.equal(evidence.State, "RehearsalAborted");
  assert.equal(evidence.Phase, "RehearsalAborted");
  assert.equal(evidence.ReceiptKind, "RehearsalAbort");
  assert.match(evidence.MissingReceipt, /requires receipt kind/i);
});

test("CAS-publishes one backup role atomically with its required transition", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$operationResult = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Name 'InitialRestore' -Lane Rehearsal
$activePlan = [pscustomobject][ordered]@{ BackupOperationId='22222222-2222-4222-8222-222222222222'; InvocationRole='InitialSource'; State='active'; StartedAtUtc=[DateTime]::UtcNow.ToString('o'); CompletedAtUtc='' }
$planWrite = Save-EasyFireMigrationBackupPlan -JournalPath $journalPath -ExpectedJournalSha256 $operationResult.Sha256 -BackupReceiptRole InitialSource -Plan $activePlan
$receipt = Write-EasyFireMigrationReceipt -AuthorityRoot $authorityRoot -MigrationId '${migrationId}' -AuthorityFingerprint ([string]$journal.Authority.Fingerprint) -Lane Rehearsal -Kind InitialRestore -OperationId ([string]$operationResult.Operation.OperationId) -Evidence ([ordered]@{ RestorePassed=$true })
$completedPlan = $activePlan | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$completedPlan.State = 'completed'
$completedPlan.CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
$backupRecord = [pscustomobject][ordered]@{
  Plan = $completedPlan
  RecoveryUnit = [pscustomobject][ordered]@{ BackupOperationId=$activePlan.BackupOperationId; BackupSha256=('E' * 64) }
  RestoreReceipt = [pscustomobject][ordered]@{ BackupOperationId=$activePlan.BackupOperationId; Verified=$true; BackupSha256=('E' * 64) }
}
$transition = Save-EasyFireMigrationJournalTransition -JournalPath $journalPath -ExpectedJournalSha256 $planWrite.Sha256 -ToState Rehearsing -ToPhase InitialRestoreVerified -ReceiptBinding $receipt -BackupReceiptRole InitialSource -BackupReceipt $backupRecord
$snapshot = Get-Content -LiteralPath $transition.TransitionSnapshotPath -Raw -Encoding utf8 | ConvertFrom-Json
$staleMessage = ''
try {
  $null = Add-EasyFireMigrationPreservedResource -JournalPath $journalPath -ExpectedJournalSha256 $operationResult.Sha256 -Category Backups -Identity 'stale-after-atomic-transition'
} catch { $staleMessage = $_.Exception.Message }
[pscustomobject]@{
  CurrentState=$transition.Journal.CurrentState
  Phase=$transition.Journal.Phase
  InitialSha=$transition.Journal.BackupReceipts.InitialSource.RecoveryUnit.BackupSha256
  SnapshotSha=$snapshot.BackupReceipts.InitialSource.RecoveryUnit.BackupSha256
  PlanWriteTransitionCount=@($planWrite.Journal.Transitions).Count
  FinalIsNull=($null -eq $transition.Journal.BackupReceipts.FinalSource)
  BaselineIsNull=($null -eq $transition.Journal.BackupReceipts.MigrationBaseline)
  Stale=$staleMessage
} | ConvertTo-Json -Compress
`);

  assert.deepEqual(evidence, {
    CurrentState: "Rehearsing",
    Phase: "InitialRestoreVerified",
    InitialSha: "E".repeat(64),
    SnapshotSha: "E".repeat(64),
    PlanWriteTransitionCount: 1,
    FinalIsNull: true,
    BaselineIsNull: true,
    Stale: evidence.Stale,
  });
  assert.match(evidence.Stale, /compare-and-swap authority changed/i);
});

test("appends periodic scheduled recovery authority without lifecycle transitions", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$completionOperationId = '33333333-3333-4333-8333-333333333333'
$completionReceipt = Write-EasyFireMigrationReceipt -AuthorityRoot $authorityRoot -MigrationId '${migrationId}' -AuthorityFingerprint ([string]$journal.Authority.Fingerprint) -Lane Cutover -Kind Completion -OperationId $completionOperationId -Evidence ([ordered]@{ CutoverPassed=$true })
$baselineRecoveryUnit = [pscustomobject][ordered]@{
  BackupOperationId = '44444444-4444-4444-8444-444444444444'
  MariaDb = [pscustomobject][ordered]@{ BackupSha256=('A' * 64) }
  Redis = [pscustomobject][ordered]@{ RdbArtifact='redis.rdb'; RdbSha256=('B' * 64); IsolatedNoHostPortRestore=$true; KeyCount=19 }
  ConsistencyBoundary = [pscustomobject][ordered]@{ ApplicationQuiesced=$true }
}
$journal.BackupReceipts.MigrationBaseline = [pscustomobject][ordered]@{
  Plan = [pscustomobject][ordered]@{ BackupOperationId='44444444-4444-4444-8444-444444444444' }
  RecoveryUnit = $baselineRecoveryUnit
  RestoreReceipt = [pscustomobject][ordered]@{ BackupOperationId='44444444-4444-4444-8444-444444444444'; Passed=$true }
}
$targets = @(
  'Rehearsing|InitialRestoreRunning', 'Rehearsing|InitialRestoreVerified',
  'Rehearsing|RehearsalDataStarting', 'Rehearsing|RehearsalMysqlReady',
  'Rehearsing|RehearsalImported', 'Rehearsing|RehearsalRedisReady',
  'Rehearsing|RehearsalMigrationPrepared', 'Rehearsing|RehearsalMigrationRunning',
  'Rehearsing|RehearsalMigrationComplete', 'Rehearsing|RehearsalAppReady',
  'Rehearsing|AwaitingNativeAuthentication', 'Rehearsing|RehearsalAuthenticated',
  'Rehearsing|RehearsalRollbackPrepared',
  'RehearsalVerified|RehearsalRollbackVerified', 'CuttingOver|IngressPausePending',
  'CuttingOver|IngressPausePrepared',
  'CuttingOver|IngressPaused', 'CuttingOver|SourceFreezePending',
  'CuttingOver|SourceFrozen', 'CuttingOver|FinalBackupRunning',
  'CuttingOver|FinalBackupReady', 'CuttingOver|FinalRestoreVerified',
  'CuttingOver|SourceDataFrozen', 'CuttingOver|CutoverDataStarting',
  'CuttingOver|CutoverMysqlReady', 'CuttingOver|CutoverImported',
  'CuttingOver|CutoverRedisReady', 'CuttingOver|CutoverMigrationPrepared',
  'CuttingOver|CutoverMigrationRunning', 'CuttingOver|CutoverMigrationComplete',
  'CuttingOver|CutoverAppReady', 'CuttingOver|CutoverBaselineBackupRunning',
  'CuttingOver|CutoverBaselineBackupReady', 'CuttingOver|CutoverBaselineRestoreVerified',
  'CuttingOver|TasksMutationPending', 'CuttingOver|TasksMigrated',
  'CuttingOver|EdgeStarting', 'Completed|Completed'
)
$history = @($journal.Transitions)
$fromState = 'Planned'
$fromPhase = 'Planned'
$now = [DateTime]::UtcNow.ToString('o')
foreach ($target in $targets) {
  $parts = $target.Split('|')
  $history += [pscustomobject][ordered]@{
    Sequence = $history.Count + 1
    FromState = $fromState
    FromPhase = $fromPhase
    ToState = $parts[0]
    ToPhase = $parts[1]
    AtUtc = $now
    ReceiptSha256 = ''
  }
  $fromState = $parts[0]
  $fromPhase = $parts[1]
}
$journal.Transitions = $history
$journal.CurrentState = 'Completed'
$journal.Phase = 'Completed'
$journal.Revision = $history.Count
$journal.UpdatedAtUtc = $now
$journal.CompletedAuthority = [pscustomobject][ordered]@{
  SchemaVersion = 1
  Lane = 'Cutover'
  ProjectName = $journal.Lanes.Cutover.ProjectName
  ReleaseId = '1F588F338910'
  ReleaseDirectory = (Join-Path $authorityRoot 'release')
  ComposeFile = (Join-Path $authorityRoot 'compose.yml')
  ComposeFileSha256 = ('C' * 64)
  ComposeOverrideFile = $journal.Lanes.Cutover.ComposeOverrideFile
  ComposeOverrideSha256 = ('D' * 64)
  EnvFile = $journal.Lanes.Cutover.EnvironmentFile
  EnvFileSha256 = ('E' * 64)
  Inventory = [pscustomobject][ordered]@{ ProjectName=$journal.Lanes.Cutover.ProjectName }
  InventoryFingerprint = ('F' * 64)
  DurableVolumeFingerprint = ('1' * 64)
  Mysql = [pscustomobject][ordered]@{ ContainerId=('a' * 64); ContainerName=$journal.Lanes.Cutover.MysqlContainerName; ImageReference='mariadb:11'; ImageId=('sha256:' + ('c' * 64)); VolumeName=$journal.Lanes.Cutover.MysqlVolumeName; VolumeComposeKey='mysql'; VolumeDestination='/var/lib/mysql' }
  Redis = [pscustomobject][ordered]@{ ContainerId=('b' * 64); ContainerName=$journal.Lanes.Cutover.RedisContainerName; ImageReference='redis:7'; ImageId=('sha256:' + ('d' * 64)); VolumeName=$journal.Lanes.Cutover.RedisVolumeName; VolumeComposeKey='redis'; VolumeDestination='/data' }
  ControllerBundleAuthority = [pscustomobject][ordered]@{ Sha256=('2' * 64) }
  BaselineRecoveryUnit = $baselineRecoveryUnit
  MigrationReceipt = $completionReceipt
  AuthorityOwnerSid = 'S-1-5-18'
  CompletedAtUtc = $now
}
$null = Assert-EasyFireMigrationJournalAuthority -Journal $journal
[IO.File]::WriteAllText($journalPath, ($journal | ConvertTo-Json -Depth 50), [Text.UTF8Encoding]::new($false))
$completedSha = Get-EasyFireMigrationFileSha256 -Path $journalPath
$plan1 = [pscustomobject][ordered]@{ BackupOperationId='55555555-5555-4555-8555-555555555555'; InvocationRole='MigrationScheduled'; State='active'; StartedAtUtc=$now; CompletedAtUtc='' }
$plan1Completed = $plan1 | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$plan1Completed.State = 'completed'
$plan1Completed.CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
$unit1 = [pscustomobject][ordered]@{ BackupOperationId=$plan1.BackupOperationId; MariaDb=[pscustomobject]@{ BackupSha256=('3' * 64) }; Redis=[pscustomobject]@{ RdbArtifact='scheduled-1.rdb'; RdbSha256=('4' * 64); IsolatedNoHostPortRestore=$true; KeyCount=19 } }
$restore1 = [pscustomobject][ordered]@{ BackupOperationId=$plan1.BackupOperationId; Passed=$true }
$first = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath -ExpectedJournalSha256 $completedSha -BackupReceipt ([pscustomobject][ordered]@{ Plan=@($plan1); RecoveryUnit=@(); RestoreReceipt=@() })
$second = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath -ExpectedJournalSha256 $first.Sha256 -BackupReceipt ([pscustomobject][ordered]@{ Plan=@($plan1Completed); RecoveryUnit=@($unit1); RestoreReceipt=@() })
$third = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath -ExpectedJournalSha256 $second.Sha256 -BackupReceipt ([pscustomobject][ordered]@{ Plan=@($plan1Completed); RecoveryUnit=@($unit1); RestoreReceipt=@($restore1) })
$plan2 = [pscustomobject][ordered]@{ BackupOperationId='66666666-6666-4666-8666-666666666666'; InvocationRole='MigrationScheduled'; State='active'; StartedAtUtc=$now; CompletedAtUtc='' }
$fourth = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath -ExpectedJournalSha256 $third.Sha256 -BackupReceipt ([pscustomobject][ordered]@{ Plan=@($plan1Completed,$plan2); RecoveryUnit=@($unit1); RestoreReceipt=@($restore1) })
$replacementMessage = ''
$badPlan = $plan1Completed | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$badPlan.InvocationRole = 'Changed'
try {
  $null = Save-EasyFireMigrationScheduledBackupReceipt -JournalPath $journalPath -ExpectedJournalSha256 $fourth.Sha256 -BackupReceipt ([pscustomobject][ordered]@{ Plan=@($badPlan,$plan2); RecoveryUnit=@($unit1); RestoreReceipt=@($restore1) })
} catch { $replacementMessage = $_.Exception.Message }
[pscustomobject]@{
  State=$fourth.Journal.CurrentState
  Phase=$fourth.Journal.Phase
  TransitionCountBefore=$history.Count
  TransitionCountAfter=@($fourth.Journal.Transitions).Count
  PlanCount=@($fourth.Journal.BackupReceipts.MigrationScheduled.Plan).Count
  UnitCount=@($fourth.Journal.BackupReceipts.MigrationScheduled.RecoveryUnit).Count
  RestoreCount=@($fourth.Journal.BackupReceipts.MigrationScheduled.RestoreReceipt).Count
  RedisSha=$fourth.Journal.BackupReceipts.MigrationScheduled.RecoveryUnit[0].Redis.RdbSha256
  ReplacementMessage=$replacementMessage
} | ConvertTo-Json -Compress
`);

  assert.equal(evidence.State, "Completed");
  assert.equal(evidence.Phase, "Completed");
  assert.equal(evidence.TransitionCountAfter, evidence.TransitionCountBefore);
  assert.equal(evidence.PlanCount, 2);
  assert.equal(evidence.UnitCount, 1);
  assert.equal(evidence.RestoreCount, 1);
  assert.equal(evidence.RedisSha, "4".repeat(64));
  assert.match(evidence.ReplacementMessage, /append-only|prefix/i);
});

test("preservation sets are monotonic across every journal write", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$added = Add-EasyFireMigrationPreservedResource -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Category Backups -Identity 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\backups\\source.sql.gz'
$same = Add-EasyFireMigrationPreservedResource -JournalPath $journalPath -ExpectedJournalSha256 $added.Sha256 -Category Backups -Identity 'C:\\ProgramData\\AgentFoundry\\easyfire-bookkeeping\\backups\\source.sql.gz'
$before = $same.Journal | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$after = $same.Journal | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$after.PreservationSet.Backups = @()
$message = ''
try { Assert-EasyFireMigrationPreservationMonotonic -Before $before -After $after }
catch { $message = $_.Exception.Message }
[pscustomobject]@{
  Count=@($same.Journal.PreservationSet.Backups).Count
  FirstReused=$added.Reused
  SecondReused=$same.Reused
  SameSha=($added.Sha256 -ceq $same.Sha256)
  Message=$message
} | ConvertTo-Json -Compress
`);

  assert.equal(evidence.Count, 1);
  assert.equal(evidence.FirstReused, false);
  assert.equal(evidence.SecondReused, true);
  assert.equal(evidence.SameSha, true);
  assert.match(evidence.Message, /cannot remove.*Backups/i);
});

test("rejects stale compare-and-swap writes and tampered receipts", () => {
  const evidence = runPowerShell(String.raw`
${journalFixture}
$initialized = Initialize-EasyFireMigrationJournal -Journal $journal -JournalPath $journalPath
$operationResult = Get-OrCreate-EasyFireMigrationOperation -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Name 'InitialRestore' -Lane Rehearsal
$staleMessage = ''
try {
  $null = Add-EasyFireMigrationPreservedResource -JournalPath $journalPath -ExpectedJournalSha256 $initialized.Sha256 -Category Backups -Identity 'stale'
} catch { $staleMessage = $_.Exception.Message }
$receipt = Write-EasyFireMigrationReceipt -AuthorityRoot $authorityRoot -MigrationId '${migrationId}' -AuthorityFingerprint ([string]$journal.Authority.Fingerprint) -Lane Rehearsal -Kind InitialRestore -OperationId ([string]$operationResult.Operation.OperationId) -Evidence ([ordered]@{ PassedTopology=$true })
[IO.File]::AppendAllText([string]$receipt.Path, 'tamper')
$tamperMessage = ''
try {
  Assert-EasyFireMigrationReceiptBinding -Binding $receipt -ExpectedMigrationId '${migrationId}' -ExpectedAuthorityFingerprint ([string]$journal.Authority.Fingerprint)
} catch { $tamperMessage = $_.Exception.Message }
[pscustomobject]@{ Stale=$staleMessage; Tamper=$tamperMessage } | ConvertTo-Json -Compress
`);

  assert.match(evidence.Stale, /compare-and-swap authority changed/i);
  assert.match(evidence.Tamper, /hash.*changed/i);
});

test("state module contains no runtime or destructive executor verbs", () => {
  const source = readFileSync(modulePath, "utf8");
  assert.doesNotMatch(
    source,
    /\bdocker\b|\b(?:Start|Stop|Restart)-Service\b|\b(?:Register|Unregister)-ScheduledTask\b|\bRemove-Item\b|\bClear-Content\b|\bSet-Content\b|\bvolume\s+rm\b|\bcompose\s+down\b/i,
  );
});
