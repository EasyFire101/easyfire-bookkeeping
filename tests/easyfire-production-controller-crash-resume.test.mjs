import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controllerPath = resolve(root, "deploy/windows/production-action.ps1");
const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const exactFunctionNames = [
  "Set-EasyFireProperty",
  "Get-EasyFireProperty",
  "Test-EasyFireAtOrAfter",
  "Assert-EasyFireActionReceipt",
  "Invoke-EasyFireActionStage",
  "Assert-EasyFireMigrationSucceeded",
  "Get-EasyFireMigrationContainerAuthority",
  "Assert-EasyFireMigrationContainerAuthority",
  "Update-EasyFireDurableVolumePlan",
  "Assert-EasyFirePreservedPlannedVolumes",
  "Invoke-EasyFireScheduledBackupStage",
  "Test-EasyFireInventorySubsetOfApproved",
  "Assert-EasyFireRollbackReadback",
  "Invoke-EasyFireRollbackStage",
];

function extractExactFunctions() {
  const names = exactFunctionNames.map(psQuote).join(",");
  const command = [
    `$path = ${psQuote(controllerPath)}`,
    "$tokens = $null; $errors = $null",
    "$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)",
    "if ($errors.Count -ne 0) { throw 'Controller did not parse cleanly.' }",
    `$names = @(${names})`,
    "$result = [ordered]@{}",
    "foreach ($name in $names) {",
    "  $matches = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true))",
    '  if ($matches.Count -ne 1) { throw "Expected one exact function extent for $name." }',
    "  $result[$name] = $matches[0].Extent.Text",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr);
  const functions = JSON.parse(result.stdout);
  for (const name of exactFunctionNames) {
    assert.ok(
      functions[name].startsWith(`function ${name} {`),
      `AST extent for ${name} was not exact`,
    );
  }
  return functions;
}

const exactFunctions = extractExactFunctions();

function runHarness(functionNames, scenario) {
  const fixtureRoot = mkdtempSync(
    resolve(tmpdir(), "easyfire-controller-crash-"),
  );
  const scriptPath = resolve(fixtureRoot, "scenario.ps1");
  const source = [
    "Set-StrictMode -Version Latest",
    "$ErrorActionPreference = 'Stop'",
    ...functionNames.map((name) => exactFunctions[name]),
    scenario,
  ].join("\n\n");
  writeFileSync(scriptPath, source, "utf8");

  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        encoding: "utf8",
        env: { ...process.env, EASYFIRE_TEST_ROOT: fixtureRoot },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(lines.length > 0, "PowerShell harness returned no evidence");
    return JSON.parse(lines.at(-1));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const actionFunctions = [
  "Set-EasyFireProperty",
  "Get-EasyFireProperty",
  "Test-EasyFireAtOrAfter",
  "Invoke-EasyFireActionStage",
];

const phaseOrder = String.raw`$script:PhaseOrder = @(
  'initialized','extracting','extracted','env_writing','env_written',
  'images_building','images_built','data_tier_starting','data_tier_ready',
  'migration_preparing','migration_running','migration_complete',
  'baseline_backup_running','baseline_backup_ready','app_tier_starting',
  'app_tier_ready','tasks_registering','action_completed_pending_postcheck','completed'
)`;

test("helper-bundle drift is rejected by the exact receipt gate before side effects", () => {
  const evidence = runHarness(
    ["Get-EasyFireProperty", "Assert-EasyFireActionReceipt"],
    String.raw`
$ActionId = '11111111-1111-4111-8111-111111111111'
$ConfirmActionId = $ActionId
$PriorActionId = $null
$script:ControllerBundlePaths = @('controller.ps1', 'helper.psm1')
$script:ControllerSha256 = 'CONTROLLER'
$script:ResolvedProductionRoot = 'ROOT'
$script:ResolvedReleaseArchive = 'ARCHIVE'
$script:ActualArchiveSha256 = ('A' * 64)
$script:ReleaseDirectory = 'RELEASE'
$script:ResolvedCredentialFile = 'CREDENTIAL'
$script:CredentialSha256 = ('B' * 64)
$script:TargetTag = 'archive-test'
$script:MariaDbImageTag = 'dbarchive-test'
$script:ExpectedMysqlVolume = 'mysql-test'
$script:ExpectedRedisVolume = 'redis-test'
$script:Receipt = [pscustomobject]@{
  SchemaVersion = 2
  ExpiresAtUtc = (Get-Date).ToUniversalTime().AddMinutes(10).ToString('o')
  ControllerBundleAuthority = [pscustomobject]@{ FingerprintSha256 = 'ORIGINAL' }
}
$script:BundleChecks = 0
$script:SideEffects = 0
function ConvertTo-EasyFireCanonicalActionId { param([string]$ActionId) return $ActionId }
function Read-EasyFirePreflightReceipt { return $script:Receipt }
function Assert-EasyFireExecutableBundleAuthority {
  param($ExpectedAuthority, $Paths)
  $script:BundleChecks++
  throw 'simulated helper-bundle drift'
}
function Get-EasyFireInventory { $script:SideEffects++; throw 'inventory must not run' }
function Assert-EasyFireNamedResourceIsolation { $script:SideEffects++ }
function Get-EasyFireZipManifest { $script:SideEffects++ }
function Get-EasyFireVerifiedCredential { $script:SideEffects++ }
function Get-EasyFireVerifiedEdgeState { $script:SideEffects++ }
$before = $script:Receipt.ControllerBundleAuthority | ConvertTo-Json -Compress
$message = ''
try { $null = Assert-EasyFireActionReceipt -Journal $null } catch { $message = $_.Exception.Message }
$after = $script:Receipt.ControllerBundleAuthority | ConvertTo-Json -Compress
[pscustomobject]@{
  Message = $message
  BundleChecks = $script:BundleChecks
  SideEffects = $script:SideEffects
  ControllerAuthorityUnchanged = ($before -ceq $after)
} | ConvertTo-Json -Compress
`,
  );

  assert.match(evidence.Message, /helper-bundle drift/i);
  assert.equal(evidence.BundleChecks, 1);
  assert.equal(evidence.SideEffects, 0);
  assert.equal(evidence.ControllerAuthorityUnchanged, true);
});

test("environment candidate survives every journal and publication crash boundary without regeneration", () => {
  const evidence = runHarness(
    actionFunctions,
    String.raw`
${phaseOrder}
$ActionId = '22222222-2222-4222-8222-222222222222'
$script:ReleasesRoot = Join-Path $env:EASYFIRE_TEST_ROOT 'releases'
$script:ReleaseDirectory = Join-Path $script:ReleasesRoot 'sealed-release'
$null = New-Item -ItemType Directory -Path $script:ReleaseDirectory -Force
$script:ResolvedReleaseArchive = Join-Path $env:EASYFIRE_TEST_ROOT 'release.zip'
$script:CandidateWrites = 0
$script:JournalWrites = 0
$script:CrashOnJournalState = ''
$script:CrashAfterCandidateWrite = $false
$script:CrashAfterMove = $false
$script:Journal = [pscustomobject]@{
  status = 'env_writing'
  ControllerBundleAuthority = [pscustomobject]@{ FingerprintSha256 = 'CONTROLLER-AUTHORITY' }
  DurableVolumePlan = [pscustomobject]@{ Marker = 'VOLUME-AUTHORITY' }
}
$coreBefore = [pscustomobject]@{
  Controller = $script:Journal.ControllerBundleAuthority
  Volumes = $script:Journal.DurableVolumePlan
} | ConvertTo-Json -Depth 8 -Compress
$script:PersistedJournal = $script:Journal | ConvertTo-Json -Depth 20 -Compress
function Restore-PersistedJournal {
  $script:Journal = $script:PersistedJournal | ConvertFrom-Json
}
function Assert-EasyFireActionReceipt { return [pscustomobject]@{ ArchiveManifest = [pscustomobject]@{} } }
function Get-EasyFireUtcNow { return '2026-07-19T00:00:00.0000000Z' }
function Write-EasyFireTrackedJournal {
  param($Journal)
  $script:JournalWrites++
  $script:PersistedJournal = $Journal | ConvertTo-Json -Depth 20 -Compress
  $state = [string](Get-EasyFireProperty (Get-EasyFireProperty $Journal 'EnvironmentPlan') 'State' '')
  if ($script:CrashOnJournalState -and $state -ceq $script:CrashOnJournalState) {
    $crashedState = $script:CrashOnJournalState
    $script:CrashOnJournalState = ''
    throw "CRASH_AFTER_$($crashedState.ToUpperInvariant())_JOURNAL"
  }
}
function Set-EasyFireJournalStatus {
  param($Journal, [string]$Status, $Inventory)
  if ($Status -ceq 'env_written') { throw 'STOP_BEFORE_ENV_WRITTEN' }
  Set-EasyFireProperty -Object $Journal -Name 'status' -Value $Status
}
function Get-EasyFireInventory { return [pscustomobject]@{ Containers=@(); Networks=@(); Volumes=@() } }
function Assert-EasyFireReleaseSeal { param($Journal, [switch]$RequireEnvironment) }
function Assert-EasyFireEnvironment {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'environment missing' }
  return [pscustomobject]@{}
}
function Assert-EasyFireEnvironmentOperationAuthority {
  param([string]$Path, [string]$OperationId)
  $firstLine = @(Get-Content -LiteralPath $Path -Encoding ascii -TotalCount 1)
  if ($firstLine.Count -ne 1 -or [string]$firstLine[0] -cne "# EASYFIRE_ENV_OPERATION_ID=$OperationId") {
    throw 'environment operation authority mismatch'
  }
}
function Get-EasyFireSha256Hex {
  param([string]$Path)
  return [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-', '')
}
function New-EasyFireEnvironmentCandidate {
  param([string]$CandidatePath, [string]$PartialPath, [string]$OperationId)
  $script:CandidateWrites++
  $contents = "# EASYFIRE_ENV_OPERATION_ID=$OperationId" + [Environment]::NewLine + 'NODE_ENV=production' + [Environment]::NewLine + 'JWT_SECRET=synthetic-test-secret' + [Environment]::NewLine
  [IO.File]::WriteAllText($PartialPath, $contents)
  Move-Item -LiteralPath $PartialPath -Destination $CandidatePath
  if ($script:CrashAfterCandidateWrite) {
    $script:CrashAfterCandidateWrite = $false
    throw 'CRASH_AFTER_CANDIDATE_WRITE'
  }
  return [pscustomobject]@{ Path=$CandidatePath; Sha256=(Get-EasyFireSha256Hex -Path $CandidatePath) }
}
function Protect-EasyFireSecretFile {
  param([string]$Path)
  if ($script:CrashAfterMove -and [IO.Path]::GetFileName($Path) -ceq '.env') {
    $script:CrashAfterMove = $false
    throw 'CRASH_AFTER_ENV_MOVE'
  }
}
function Assert-EasyFireInventoryCompatible {}
function Assert-EasyFireBuiltImageAuthority {}

$script:CrashOnJournalState = 'planned'
try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $first = $_.Exception.Message }
Restore-PersistedJournal
$candidatePath = [string]$script:Journal.EnvironmentPlan.CandidatePath
$candidateAfterPlanJournal = Test-Path -LiteralPath $candidatePath -PathType Leaf
$targetPath = Join-Path $script:ReleaseDirectory '.env'
$operationId = [string]$script:Journal.EnvironmentPlan.OperationId

$script:CrashAfterCandidateWrite = $true
try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $second = $_.Exception.Message }
Restore-PersistedJournal
$candidateAfterWrite = Test-Path -LiteralPath $candidatePath -PathType Leaf
$stateAfterCandidateCrash = [string]$script:Journal.EnvironmentPlan.State

$script:CrashOnJournalState = 'prepared'
try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $third = $_.Exception.Message }
Restore-PersistedJournal

$script:CrashOnJournalState = 'publishing'
try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $fourth = $_.Exception.Message }
Restore-PersistedJournal

$script:CrashAfterMove = $true
try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $fifth = $_.Exception.Message }
Restore-PersistedJournal
$candidateAfterMove = Test-Path -LiteralPath $candidatePath -PathType Leaf
$targetAfterMove = Test-Path -LiteralPath $targetPath -PathType Leaf
$publishedAfterMove = [bool]$script:Journal.EnvironmentPlan.Published

try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $sixth = $_.Exception.Message }
$boundHash = [string]$script:Journal.EnvironmentSha256
$writesAfterBinding = $script:JournalWrites
$planAfterBinding = $script:Journal.EnvironmentPlan | ConvertTo-Json -Depth 8 -Compress
try { Invoke-EasyFireActionStage -Journal $script:Journal } catch { $seventh = $_.Exception.Message }
$coreAfter = [pscustomobject]@{
  Controller = $script:Journal.ControllerBundleAuthority
  Volumes = $script:Journal.DurableVolumePlan
} | ConvertTo-Json -Depth 8 -Compress
[pscustomobject]@{
  First = $first; Second = $second; Third = $third; Fourth = $fourth
  Fifth = $fifth; Sixth = $sixth; Seventh = $seventh
  CandidateAfterPlanJournal = $candidateAfterPlanJournal
  CandidateAfterWrite = $candidateAfterWrite
  StateAfterCandidateCrash = $stateAfterCandidateCrash
  CandidateAfterMove = $candidateAfterMove; TargetAfterMove = $targetAfterMove
  PublishedAfterMove = $publishedAfterMove
  CandidateWrites = $script:CandidateWrites
  OperationId = $operationId
  BoundHash = $boundHash
  TargetHash = Get-EasyFireSha256Hex -Path $targetPath
  Published = [bool]$script:Journal.EnvironmentPlan.Published
  EnvironmentPlanUnchangedOnReplay = ($planAfterBinding -ceq ($script:Journal.EnvironmentPlan | ConvertTo-Json -Depth 8 -Compress))
  NoJournalRewriteOnBoundReplay = ($writesAfterBinding -eq $script:JournalWrites)
  CoreAuthorityUnchanged = ($coreBefore -ceq $coreAfter)
} | ConvertTo-Json -Compress
`,
  );

  assert.match(evidence.First, /crash_after_planned_journal/i);
  assert.equal(evidence.CandidateAfterPlanJournal, false);
  assert.match(evidence.Second, /crash_after_candidate_write/i);
  assert.equal(evidence.CandidateAfterWrite, true);
  assert.equal(evidence.StateAfterCandidateCrash, "planned");
  assert.match(evidence.Third, /crash_after_prepared_journal/i);
  assert.match(evidence.Fourth, /crash_after_publishing_journal/i);
  assert.match(evidence.Fifth, /crash_after_env_move/i);
  assert.equal(evidence.CandidateAfterMove, false);
  assert.equal(evidence.TargetAfterMove, true);
  assert.equal(evidence.PublishedAfterMove, false);
  assert.match(evidence.Sixth, /stop_before_env_written/i);
  assert.match(evidence.Seventh, /stop_before_env_written/i);
  assert.equal(evidence.CandidateWrites, 1);
  assert.match(evidence.OperationId, /^[a-f0-9-]{36}$/);
  assert.match(evidence.BoundHash, /^[A-F0-9]{64}$/);
  assert.equal(evidence.BoundHash, evidence.TargetHash);
  assert.equal(evidence.Published, true);
  assert.equal(evidence.EnvironmentPlanUnchangedOnReplay, true);
  assert.equal(evidence.NoJournalRewriteOnBoundReplay, true);
  assert.equal(evidence.CoreAuthorityUnchanged, true);
});

test("image building resumes by removing only journal-owned partial tags and binds once", () => {
  const evidence = runHarness(
    actionFunctions,
    String.raw`
${phaseOrder}
$ActionId = '33333333-3333-4333-8333-333333333333'
$script:ReleaseDirectory = 'SEALED-RELEASE'
$script:ComposeCalls = 0
$script:BuildCalls = 0
$script:CleanupCalls = 0
$script:AbsentChecks = 0
$script:JournalWrites = 0
$script:ImagesPresent = $false
$script:CrashAfterPlan = $false
$script:CrashDuringBuild = $false
$script:CleanedPartialTags = $false
$script:ObservedImageAuthority = [pscustomobject]@{
  Fingerprint = 'IMAGE-A'
  Images = @([pscustomobject]@{ Reference='server:archive-a'; ImageId='sha256:a' })
}
function New-ImageJournal {
  return [pscustomobject]@{
    status = 'env_written'
    ReleaseArchive = [pscustomobject]@{ Sha256=('A' * 64) }
    ControllerBundleAuthority = [pscustomobject]@{ Fingerprint='CONTROLLER' }
    EnvironmentSha256 = ('E' * 64)
    DurableVolumePlan = [pscustomobject]@{ Marker='VOLUMES' }
  }
}
function Assert-EasyFireActionReceipt { return [pscustomobject]@{} }
function Write-EasyFireTrackedJournal {
  param($Journal)
  $script:JournalWrites++
  $script:PersistedJournal = $Journal | ConvertTo-Json -Depth 20 -Compress
  $plan = Get-EasyFireProperty $Journal 'ImageBuildPlan'
  $built = Get-EasyFireProperty $Journal 'BuiltImageAuthority'
  if ($script:CrashAfterPlan -and $plan -and -not $built) {
    $script:CrashAfterPlan = $false
    throw 'CRASH_AFTER_IMAGE_BUILD_PLAN'
  }
}
function Set-EasyFireJournalStatus {
  param($Journal, [string]$Status, $Inventory)
  if ($Status -ceq 'images_built') { throw 'STOP_BEFORE_IMAGES_BUILT' }
  Set-EasyFireProperty -Object $Journal -Name 'status' -Value $Status
  $script:PersistedJournal = $Journal | ConvertTo-Json -Depth 20 -Compress
}
function Assert-EasyFireReleaseSeal { param($Journal, [switch]$RequireEnvironment) }
function Assert-EasyFireBuiltImageTagsAbsent {
  $script:AbsentChecks++
  if ($script:ImagesPresent) { throw 'release tags already exist' }
}
function Remove-EasyFireJournalOwnedImageTags {
  param([string[]]$ImageReferences)
  if (($ImageReferences -join '|') -cne 'server:sealed') { throw 'wrong cleanup authority' }
  $script:CleanupCalls++
  if ($script:ImagesPresent) {
    $script:ImagesPresent = $false
    $script:CleanedPartialTags = $true
  }
}
function Invoke-EasyFireCompose {
  param($ReleaseDirectory, [string[]]$Arguments)
  $script:ComposeCalls++
  if ($Arguments[0] -ceq 'build') {
    $script:BuildCalls++
    $script:ImagesPresent = $true
    if ($script:CrashDuringBuild) {
      $script:CrashDuringBuild = $false
      throw 'CRASH_DURING_IMAGE_BUILD'
    }
  }
}
function Get-EasyFireBuiltImageReferences { return @('server:sealed') }
function Get-EasyFireExpectedImageAuthority {
  if (-not $script:ImagesPresent) { throw 'simulated built image missing' }
  return $script:ObservedImageAuthority
}
function Test-EasyFireExpectedImageAuthorityEqual {
  param($EstablishedAuthority, $ObservedAuthority)
  return (($EstablishedAuthority | ConvertTo-Json -Depth 10 -Compress) -ceq ($ObservedAuthority | ConvertTo-Json -Depth 10 -Compress))
}
function Get-EasyFireInventory { return [pscustomobject]@{ Containers=@(); Networks=@(); Volumes=@() } }
function Assert-EasyFireInventoryCompatible {}
function Assert-EasyFireBuiltImageAuthority {}

$journal = New-ImageJournal
$script:PersistedJournal = $journal | ConvertTo-Json -Depth 20 -Compress
$coreBefore = [pscustomobject]@{
  Controller=$journal.ControllerBundleAuthority
  Environment=$journal.EnvironmentSha256
  Volumes=$journal.DurableVolumePlan
} | ConvertTo-Json -Depth 8 -Compress

$script:CrashAfterPlan = $true
try { Invoke-EasyFireActionStage -Journal $journal } catch { $first = $_.Exception.Message }
$journal = $script:PersistedJournal | ConvertFrom-Json
$planStateAfterFirst = [string]$journal.ImageBuildPlan.State
$composeAfterPlan = $script:ComposeCalls

$script:CrashDuringBuild = $true
try { Invoke-EasyFireActionStage -Journal $journal } catch { $second = $_.Exception.Message }
$journal = $script:PersistedJournal | ConvertFrom-Json
$partialTagsAfterCrash = $script:ImagesPresent
$boundAfterCrash = $null -ne (Get-EasyFireProperty $journal 'BuiltImageAuthority')

try { Invoke-EasyFireActionStage -Journal $journal } catch { $third = $_.Exception.Message }
$bound = $journal.BuiltImageAuthority | ConvertTo-Json -Depth 10 -Compress
$writesAfterBind = $script:JournalWrites
try { Invoke-EasyFireActionStage -Journal $journal } catch { $fourth = $_.Exception.Message }
$writesAfterReplay = $script:JournalWrites
$script:ObservedImageAuthority = [pscustomobject]@{
  Fingerprint = 'IMAGE-B'
  Images = @([pscustomobject]@{ Reference='server:archive-b'; ImageId='sha256:b' })
}
try { Invoke-EasyFireActionStage -Journal $journal } catch { $retagError = $_.Exception.Message }
$coreAfter = [pscustomobject]@{
  Controller=$journal.ControllerBundleAuthority
  Environment=$journal.EnvironmentSha256
  Volumes=$journal.DurableVolumePlan
} | ConvertTo-Json -Depth 8 -Compress
[pscustomobject]@{
  First=$first; Second=$second; Third=$third; Fourth=$fourth; RetagError=$retagError
  PlanStateAfterFirst=$planStateAfterFirst; ComposeAfterPlan=$composeAfterPlan
  PartialTagsAfterCrash=$partialTagsAfterCrash; BoundAfterCrash=$boundAfterCrash
  BoundUnchanged=($bound -ceq ($journal.BuiltImageAuthority | ConvertTo-Json -Depth 10 -Compress))
  NoJournalRewriteOnReplay=($writesAfterBind -eq $writesAfterReplay -and $script:JournalWrites -eq $writesAfterReplay)
  ComposeCalls=$script:ComposeCalls; BuildCalls=$script:BuildCalls
  CleanupCalls=$script:CleanupCalls; AbsentChecks=$script:AbsentChecks
  CleanedPartialTags=$script:CleanedPartialTags
  CoreAuthorityUnchanged=($coreBefore -ceq $coreAfter)
} | ConvertTo-Json -Compress
`,
  );

  assert.match(evidence.First, /crash_after_image_build_plan/i);
  assert.equal(evidence.PlanStateAfterFirst, "planned");
  assert.equal(evidence.ComposeAfterPlan, 0);
  assert.match(evidence.Second, /crash_during_image_build/i);
  assert.equal(evidence.PartialTagsAfterCrash, true);
  assert.equal(evidence.BoundAfterCrash, false);
  assert.match(evidence.Third, /stop_before_images_built/i);
  assert.match(evidence.Fourth, /stop_before_images_built/i);
  assert.match(evidence.RetagError, /cannot be rewritten/i);
  assert.equal(evidence.BoundUnchanged, true);
  assert.equal(evidence.NoJournalRewriteOnReplay, true);
  assert.equal(evidence.ComposeCalls, 4);
  assert.equal(evidence.BuildCalls, 2);
  assert.equal(evidence.CleanupCalls, 2);
  assert.equal(evidence.AbsentChecks, 1);
  assert.equal(evidence.CleanedPartialTags, true);
  assert.equal(evidence.CoreAuthorityUnchanged, true);
});

test("migration crash matrix preserves one container authority and starts at most once", () => {
  const evidence = runHarness(
    [
      ...actionFunctions,
      "Assert-EasyFireMigrationSucceeded",
      "Get-EasyFireMigrationContainerAuthority",
      "Assert-EasyFireMigrationContainerAuthority",
    ],
    String.raw`
${phaseOrder}
$ActionId = '44444444-4444-4444-8444-444444444444'
$script:ReleaseDirectory = 'SEALED-RELEASE'
$script:StopBeforeStatus = ''
$script:StopAfterStatus = ''
$script:CrashAfterStart = $false
$script:CreateCount = 0
$script:StartCount = 0
$script:InspectExitCode = 0
function New-MigrationContainer {
  param([string]$Id, [string]$State)
  return [pscustomobject]@{
    Id=$Id; Name='easyfire-database-migration'; Project='easyfire-bookkeeping-prod'
    Service='database_migration'; ComposeConfigHash='CONFIG'; ImageReference='server:sealed'; ImageId='sha256:sealed'
    State=$State
  }
}
function New-MigrationInventory {
  param($Container)
  $containers = @()
  if ($null -ne $Container) { $containers = @($Container) }
  return [pscustomobject]@{ Containers=$containers; Networks=@(); Volumes=@() }
}
function New-MigrationJournal {
  param([string]$Status, $Attempt)
  $journal = [pscustomobject]@{
    status=$Status
    ControllerBundleAuthority=[pscustomobject]@{ Fingerprint='CONTROLLER' }
    EnvironmentSha256=('E' * 64)
    BuiltImageAuthority=[pscustomobject]@{ Fingerprint='IMAGES' }
    DurableVolumePlan=[pscustomobject]@{ Marker='VOLUMES' }
  }
  if ($null -ne $Attempt) { Set-EasyFireProperty -Object $journal -Name 'MigrationAttempt' -Value $Attempt }
  return $journal
}
function New-Attempt {
  param($Authority, $Started)
  return [pscustomobject]@{
    AttemptId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    PreparedAtUtc='2026-07-19T00:00:00Z'
    ContainerAuthority=$Authority
    StartAuthorizedAtUtc=$Started
  }
}
function Get-CoreAuthority { param($Journal) return ([pscustomobject]@{
  Controller=$Journal.ControllerBundleAuthority; Environment=$Journal.EnvironmentSha256
  Images=$Journal.BuiltImageAuthority; Volumes=$Journal.DurableVolumePlan
} | ConvertTo-Json -Depth 10 -Compress) }
function Assert-EasyFireActionReceipt { return [pscustomobject]@{} }
function Assert-EasyFireBuiltImageAuthority {}
function Assert-EasyFireReleaseSeal { param($Journal, [switch]$RequireEnvironment) }
function Assert-EasyFireInventoryCompatible {}
function Get-EasyFireUtcNow { return '2026-07-19T00:00:00.0000000Z' }
function Write-EasyFireTrackedJournal { param($Journal) }
function Set-EasyFireJournalStatus {
  param($Journal, [string]$Status, $Inventory)
  if ($script:StopBeforeStatus -ceq $Status) { throw ('STOP_BEFORE_' + $Status) }
  Set-EasyFireProperty -Object $Journal -Name 'status' -Value $Status
  if ($script:StopAfterStatus -ceq $Status) { throw ('STOP_AFTER_' + $Status) }
}
function Get-EasyFireInventory { return $script:CurrentInventory }
function Invoke-EasyFireCompose {
  param($ReleaseDirectory, $Arguments)
  if ([string]$Arguments[0] -cne 'create') { throw 'unexpected compose operation' }
  $script:CreateCount++
  $script:CurrentInventory = New-MigrationInventory (New-MigrationContainer 'MIGRATION-A' 'created')
}
function Invoke-EasyFireNative {
  param([string]$FilePath, [string[]]$ArgumentList)
  if ($ArgumentList[0] -ceq 'start') {
    $script:StartCount++
    $script:CurrentInventory = New-MigrationInventory (New-MigrationContainer 'MIGRATION-A' 'running')
    if ($script:CrashAfterStart) { $script:CrashAfterStart = $false; throw 'CRASH_AFTER_DOCKER_START' }
    return [pscustomobject]@{ Text=''; Output=@() }
  }
  if ($ArgumentList[0] -ceq 'inspect') { return [pscustomobject]@{ Text=[string]$script:InspectExitCode; Output=@([string]$script:InspectExitCode) } }
  throw 'unexpected native operation'
}
function Wait-EasyFireMigrationTerminal { param($Journal) return $script:TerminalInventory }

# Crash after preparing authority is durable but before Compose create, then resume.
$script:CurrentInventory = New-MigrationInventory $null
$script:TerminalInventory = New-MigrationInventory (New-MigrationContainer 'MIGRATION-A' 'exited')
$preCreate = New-MigrationJournal 'data_tier_ready' $null
$preCore = Get-CoreAuthority $preCreate
$script:StopAfterStatus = 'migration_preparing'
try { Invoke-EasyFireActionStage -Journal $preCreate } catch { $preError = $_.Exception.Message }
$preCreateCallsBeforeResume = $script:CreateCount
$script:StopAfterStatus = ''
$script:StopBeforeStatus = 'migration_complete'
try { Invoke-EasyFireActionStage -Journal $preCreate } catch { $preResumeError = $_.Exception.Message + ' @ ' + $_.ScriptStackTrace }
$preCreateResult = [pscustomobject]@{
  Error=$preError; ResumeError=$preResumeError
  AttemptPrepared=($null -ne $preCreate.MigrationAttempt)
  CreateBeforeResume=$preCreateCallsBeforeResume
  Creates=$script:CreateCount; Starts=$script:StartCount
  AuthorityBound=([string](Get-EasyFireProperty -Object $preCreate.MigrationAttempt.ContainerAuthority -Name 'Id' -Default '') -ceq 'MIGRATION-A')
  CoreUnchanged=($preCore -ceq (Get-CoreAuthority $preCreate))
}

# Crash after the exact docker start changes state; resume must wait, not start again.
$authority = Get-EasyFireMigrationContainerAuthority -Container (New-MigrationContainer 'MIGRATION-A' 'created')
$created = New-MigrationJournal 'migration_running' (New-Attempt $authority $null)
$createdCore = Get-CoreAuthority $created
$script:CurrentInventory = New-MigrationInventory (New-MigrationContainer 'MIGRATION-A' 'created')
$script:TerminalInventory = New-MigrationInventory (New-MigrationContainer 'MIGRATION-A' 'exited')
$script:CreateCount = 0; $script:StartCount = 0; $script:StopBeforeStatus = 'migration_complete'; $script:CrashAfterStart = $true
try { Invoke-EasyFireActionStage -Journal $created } catch { $createdCrash = $_.Exception.Message }
try { Invoke-EasyFireActionStage -Journal $created } catch { $createdResume = $_.Exception.Message }
$createdResult = [pscustomobject]@{
  Crash=$createdCrash; Resume=$createdResume; Starts=$script:StartCount; Creates=$script:CreateCount
  StartAuthority=([string]$created.MigrationAttempt.StartAuthorizedAtUtc)
  CoreUnchanged=($createdCore -ceq (Get-CoreAuthority $created))
}

function Invoke-ResumeStateCase {
  param([string]$State, [int]$ExitCode, [string]$ContainerId='MIGRATION-A')
  $expected = Get-EasyFireMigrationContainerAuthority -Container (New-MigrationContainer 'MIGRATION-A' 'created')
  $journal = New-MigrationJournal 'migration_running' (New-Attempt $expected '2026-07-19T00:00:00Z')
  $core = Get-CoreAuthority $journal
  $script:CurrentInventory = if ($State -ceq 'missing') { New-MigrationInventory $null } else { New-MigrationInventory (New-MigrationContainer $ContainerId $State) }
  $script:TerminalInventory = New-MigrationInventory (New-MigrationContainer 'MIGRATION-A' 'exited')
  $script:InspectExitCode = $ExitCode
  $script:StartCount = 0; $script:CreateCount = 0; $script:StopBeforeStatus = 'migration_complete'; $script:CrashAfterStart = $false
  $message = ''
  try { Invoke-EasyFireActionStage -Journal $journal } catch { $message = $_.Exception.Message }
  return [pscustomobject]@{ Message=$message; Starts=$script:StartCount; Creates=$script:CreateCount; CoreUnchanged=($core -ceq (Get-CoreAuthority $journal)) }
}
$running = Invoke-ResumeStateCase 'running' 0
$exitedZero = Invoke-ResumeStateCase 'exited' 0
$exitedNonzero = Invoke-ResumeStateCase 'exited' 17
$missing = Invoke-ResumeStateCase 'missing' 0
$replaced = Invoke-ResumeStateCase 'created' 0 'MIGRATION-B'
[pscustomobject]@{
  PreCreate=$preCreateResult; Created=$createdResult; Running=$running
  ExitedZero=$exitedZero; ExitedNonzero=$exitedNonzero; Missing=$missing; Replaced=$replaced
} | ConvertTo-Json -Depth 12 -Compress
`,
  );

  assert.match(evidence.PreCreate.Error, /stop_after_migration_preparing/i);
  assert.match(
    evidence.PreCreate.ResumeError,
    /stop_before_migration_complete/i,
  );
  assert.equal(evidence.PreCreate.AttemptPrepared, true);
  assert.equal(evidence.PreCreate.CreateBeforeResume, 0);
  assert.equal(evidence.PreCreate.Creates, 1);
  assert.equal(evidence.PreCreate.Starts, 1);
  assert.equal(evidence.PreCreate.AuthorityBound, true);
  assert.equal(evidence.PreCreate.CoreUnchanged, true);

  assert.match(evidence.Created.Crash, /crash_after_docker_start/i);
  assert.match(evidence.Created.Resume, /stop_before_migration_complete/i);
  assert.equal(evidence.Created.Starts, 1);
  assert.equal(evidence.Created.Creates, 0);
  assert.ok(evidence.Created.StartAuthority);
  assert.equal(evidence.Created.CoreUnchanged, true);

  for (const name of ["Running", "ExitedZero"]) {
    assert.match(evidence[name].Message, /stop_before_migration_complete/i);
    assert.equal(evidence[name].Starts, 0);
    assert.equal(evidence[name].Creates, 0);
    assert.equal(evidence[name].CoreUnchanged, true);
  }
  assert.match(evidence.ExitedNonzero.Message, /did not exit successfully/i);
  assert.match(evidence.Missing.Message, /missing.*replay is forbidden/i);
  assert.match(evidence.Replaced.Message, /no longer matches/i);
  for (const name of ["ExitedNonzero", "Missing", "Replaced"]) {
    assert.equal(evidence[name].Starts, 0);
    assert.equal(evidence[name].Creates, 0);
    assert.equal(evidence[name].CoreUnchanged, true);
  }
});

test("rollback preserves zero, one, or two partially-created volumes and repeat is read-only", () => {
  const evidence = runHarness(
    [
      "Set-EasyFireProperty",
      "Get-EasyFireProperty",
      "Test-EasyFireAtOrAfter",
      "Update-EasyFireDurableVolumePlan",
      "Assert-EasyFirePreservedPlannedVolumes",
      "Test-EasyFireInventorySubsetOfApproved",
      "Assert-EasyFireRollbackReadback",
      "Invoke-EasyFireRollbackStage",
    ],
    String.raw`
${phaseOrder}
$ActionId = '55555555-5555-4555-8555-555555555555'
$ConfirmActionId = $ActionId
$script:ExpectedMysqlVolume = 'easyfire_prod_mysql_test'
$script:ExpectedRedisVolume = 'easyfire_prod_redis_test'
$script:ReleaseDirectory = 'SEALED-RELEASE'
$script:BackupsRoot = 'BACKUPS'
$script:WriteCount = 0
$script:RemoveCount = 0
$script:ComposeCount = 0
$script:TaskPresent = $false
function New-TestVolume { param([string]$Name) return [pscustomobject]@{ Name=$Name; CreatedAt=('created-' + $Name); Driver='local' } }
function Get-EasyFireVolumeFingerprint {
  param($Volumes)
  return [string](@($Volumes | Sort-Object Name | ForEach-Object { "$($_.Name)|$($_.CreatedAt)|$($_.Driver)" }) -join ';')
}
function New-RollbackInventory { param($Volumes) return [pscustomobject]@{
  Containers=@(); Networks=@(); Volumes=@($Volumes); ReservedVolumeNames=@($Volumes | ForEach-Object Name)
} }
function Get-EasyFireInventoryFingerprint { param($Inventory) return (($Inventory | ConvertTo-Json -Depth 12 -Compress)) }
function New-RollbackJournal {
  return [pscustomobject]@{
    status='data_tier_starting'; AppStarted=$false
    ControllerBundleAuthority=[pscustomobject]@{ Fingerprint='CONTROLLER' }
    EnvironmentSha256=('E' * 64)
    BuiltImageAuthority=[pscustomobject]@{ Fingerprint='IMAGES' }
    DurableVolumePlan=[pscustomobject]@{
      ExpectedNames=@($script:ExpectedMysqlVolume,$script:ExpectedRedisVolume | Sort-Object)
      ObservedVolumes=@(); ObservedFingerprint=(Get-EasyFireVolumeFingerprint -Volumes @()); PlannedAtUtc='2026-07-19T00:00:00Z'
    }
  }
}
function Get-CoreAuthority { param($Journal) return ([pscustomobject]@{
  Controller=$Journal.ControllerBundleAuthority; Environment=$Journal.EnvironmentSha256; Images=$Journal.BuiltImageAuthority
} | ConvertTo-Json -Depth 8 -Compress) }
function ConvertTo-EasyFireCanonicalActionId { param([string]$ActionId) return $ActionId }
function Assert-EasyFireJournalIdentity {}
function Assert-EasyFireNamedResourceIsolation {}
function Assert-EasyFireInventoryCompatible {}
function Assert-EasyFireRetiredTasksAbsent {}
function Enter-EasyFireBackupFence {}
function Get-EasyFireUtcNow { return '2026-07-19T00:00:00.0000000Z' }
function Write-EasyFireTrackedJournal { param($Journal) $script:WriteCount++ }
function Set-EasyFireJournalStatus { param($Journal,[string]$Status,$Inventory) Set-EasyFireProperty -Object $Journal -Name 'status' -Value $Status; Write-EasyFireTrackedJournal $Journal }
function Get-EasyFireInventory { return $script:Inventory }
function Get-EasyFireTaskDefinitions { return @([pscustomobject]@{ TaskPath='\'; Name='easyfire-bookkeeping-prod-backup' }) }
function Get-ScheduledTask { param($TaskPath,$TaskName,$ErrorAction) if ($script:TaskPresent) { return [pscustomobject]@{ TaskName=$TaskName } } }
function Remove-EasyFireActionTasks { param($Definitions) $script:RemoveCount++ }
function Invoke-EasyFireCompose { $script:ComposeCount++ }
function Assert-EasyFireReleaseSeal {}

$results = @()
foreach ($count in @(0,1,2)) {
  $volumes = @()
  if ($count -ge 1) { $volumes += New-TestVolume $script:ExpectedMysqlVolume }
  if ($count -ge 2) { $volumes += New-TestVolume $script:ExpectedRedisVolume }
  $script:Inventory = New-RollbackInventory $volumes
  $script:WriteCount=0; $script:RemoveCount=0; $script:ComposeCount=0
  $journal = New-RollbackJournal
  $coreBefore = Get-CoreAuthority $journal
  Invoke-EasyFireRollbackStage -Journal $journal
  $afterFirst = $journal | ConvertTo-Json -Depth 20 -Compress
  $writesAfterFirst = $script:WriteCount
  Invoke-EasyFireRollbackStage -Journal $journal
  $afterRepeat = $journal | ConvertTo-Json -Depth 20 -Compress
  $results += [pscustomobject]@{
    Count=$count; Status=$journal.status; ObservedCount=@($journal.DurableVolumePlan.ObservedVolumes).Count
    FirstAndRepeatEqual=($afterFirst -ceq $afterRepeat); NoRepeatWrite=($writesAfterFirst -eq $script:WriteCount)
    Removes=$script:RemoveCount; Compose=$script:ComposeCount; CoreUnchanged=($coreBefore -ceq (Get-CoreAuthority $journal))
    TeardownComplete=([bool]$journal.Rollback.TaskRemovalCompleted -and [bool]$journal.Rollback.ComposeTeardownCompleted)
  }
}
$results | ConvertTo-Json -Depth 12 -Compress
`,
  );

  assert.deepEqual(
    evidence.map((item) => item.Count),
    [0, 1, 2],
  );
  for (const item of evidence) {
    assert.equal(item.Status, "rolled_back");
    assert.equal(item.ObservedCount, item.Count);
    assert.equal(item.FirstAndRepeatEqual, true);
    assert.equal(item.NoRepeatWrite, true);
    assert.equal(item.Removes, 1);
    assert.equal(item.Compose, 0);
    assert.equal(item.CoreUnchanged, true);
    assert.equal(item.TeardownComplete, true);
  }
});

test("rolled_back readback rejects resource, volume, task, and journal drift", () => {
  const evidence = runHarness(
    [
      "Set-EasyFireProperty",
      "Get-EasyFireProperty",
      "Assert-EasyFirePreservedPlannedVolumes",
      "Assert-EasyFireRollbackReadback",
    ],
    String.raw`
$script:ExpectedMysqlVolume = 'easyfire_prod_mysql_test'
$script:ExpectedRedisVolume = 'easyfire_prod_redis_test'
$script:ReleaseDirectory = 'SEALED-RELEASE'
$script:TaskPresent = $false
function New-TestVolume { param([string]$Name,[string]$Created='original') return [pscustomobject]@{ Name=$Name; CreatedAt=$Created; Driver='local' } }
function Get-EasyFireVolumeFingerprint { param($Volumes) return [string](@($Volumes | Sort-Object Name | ForEach-Object { "$($_.Name)|$($_.CreatedAt)|$($_.Driver)" }) -join ';') }
$volume = New-TestVolume $script:ExpectedMysqlVolume
$journal = [pscustomobject]@{
  DurableVolumePlan=[pscustomobject]@{ ObservedVolumes=@($volume); ObservedFingerprint=(Get-EasyFireVolumeFingerprint @($volume)) }
  Rollback=[pscustomobject]@{ AppEverStarted=$false; TaskRemovalCompleted=$true; ComposeTeardownCompleted=$true }
}
function Get-EasyFireTaskDefinitions { return @([pscustomobject]@{ TaskPath='\'; Name='easyfire-bookkeeping-prod-backup' }) }
function Get-ScheduledTask { param($TaskPath,$TaskName,$ErrorAction) if ($script:TaskPresent) { return [pscustomobject]@{ TaskName=$TaskName } } }
function Assert-EasyFireRetiredTasksAbsent {}
function Test-EasyFireBackupPair { return [pscustomobject]@{ Valid=$true; Sha256='OK' } }
function New-Inventory { param($Containers=@(),$Networks=@(),$Volumes=@($volume),$Reserved=@($script:ExpectedMysqlVolume)) return [pscustomobject]@{
  Containers=@($Containers); Networks=@($Networks); Volumes=@($Volumes); ReservedVolumeNames=@($Reserved)
} }
function Get-Message { param($Inventory)
  try { Assert-EasyFireRollbackReadback -Journal $journal -Inventory $Inventory; return '' }
  catch { return $_.Exception.Message }
}
$good = Get-Message (New-Inventory)
$container = Get-Message (New-Inventory -Containers @([pscustomobject]@{ Id='survivor' }))
$network = Get-Message (New-Inventory -Networks @([pscustomobject]@{ Id='survivor' }))
$foreign = Get-Message (New-Inventory -Reserved @($script:ExpectedMysqlVolume,'historical-volume'))
$recreated = Get-Message (New-Inventory -Volumes @((New-TestVolume $script:ExpectedMysqlVolume 'recreated')))
$script:TaskPresent = $true
$task = Get-Message (New-Inventory)
$script:TaskPresent = $false
$journal.Rollback.ComposeTeardownCompleted = $false
$flags = Get-Message (New-Inventory)
[pscustomobject]@{ Good=$good; Container=$container; Network=$network; Foreign=$foreign; Recreated=$recreated; Task=$task; Flags=$flags } | ConvertTo-Json -Compress
`,
  );

  assert.equal(evidence.Good, "");
  assert.match(
    evidence.Container,
    /surviving.*container|containers or network/i,
  );
  assert.match(evidence.Network, /surviving.*network|containers or network/i);
  assert.match(evidence.Foreign, /foreign or historical/i);
  assert.match(evidence.Recreated, /exact journaled durable-volume subset/i);
  assert.match(evidence.Task, /surviving.*scheduled task/i);
  assert.match(evidence.Flags, /lacks completed teardown authority/i);
});

test("scheduled backup renews completed operations and reuses an active crash operation", () => {
  const evidence = runHarness(
    [
      "Set-EasyFireProperty",
      "Get-EasyFireProperty",
      "Invoke-EasyFireScheduledBackupStage",
    ],
    String.raw`
$ActionId = '66666666-6666-4666-8666-666666666666'
$script:ResolvedProductionRoot = 'ROOT'
$script:ProjectName = 'easyfire-bookkeeping-prod'
$script:ReleaseDirectory = 'SEALED-RELEASE'
$script:BackupsRoot = 'BACKUPS'
$script:WriteCount = 0
$script:CrashBackupBoundary = $true
$oldId = '77777777-7777-4777-8777-777777777777'
$journal = [pscustomobject]@{
  status='completed'; ApprovedInventoryFingerprint='APPROVED'
  ControllerBundleAuthority=[pscustomobject]@{ Fingerprint='CONTROLLER' }
  EnvironmentSha256=('E' * 64); BuiltImageAuthority=[pscustomobject]@{ Fingerprint='IMAGES' }
  DurableVolumePlan=[pscustomobject]@{ Marker='VOLUMES' }
  ScheduledBackupPlan=[pscustomobject]@{ BackupOperationId=$oldId; InvocationRole='Scheduled'; BackupMode='full'; State='completed' }
  ScheduledBackupCandidate=[pscustomobject]@{ BackupOperationId=$oldId }
}
$coreBefore = [pscustomobject]@{
  Controller=$journal.ControllerBundleAuthority; Environment=$journal.EnvironmentSha256
  Images=$journal.BuiltImageAuthority; Volumes=$journal.DurableVolumePlan
} | ConvertTo-Json -Depth 8 -Compress
function Assert-EasyFireJournalIdentity {}
function Test-EasyFireProductionJournal { return [pscustomobject]@{ Valid=$true; Reason='' } }
function Assert-EasyFireReleaseSeal {}
function Get-EasyFireInventory { return [pscustomobject]@{ Containers=@([pscustomobject]@{ Service='mysql'; State='running'; Health='healthy' }) } }
function Assert-EasyFireInventoryCompatible {}
function Get-EasyFireInventoryFingerprint { return 'APPROVED' }
function Assert-EasyFireTasksForPhase {}
function Assert-EasyFireAuthorityTree {}
function Get-EasyFireUtcNow { return '2026-07-19T00:00:00.0000000Z' }
function Write-EasyFireTrackedJournal { param($Journal) $script:WriteCount++ }
function Get-EasyFireVerifiedBackupReceipt {
  param($Journal,$Kind)
  if ($script:CrashBackupBoundary) { $script:CrashBackupBoundary=$false; throw 'CRASH_AFTER_OPERATION_RENEWAL' }
  $plan = $Journal.ScheduledBackupPlan
  Set-EasyFireProperty -Object $plan -Name 'State' -Value 'completed'
  return [pscustomobject]@{ BackupOperationId=[string]$plan.BackupOperationId }
}
try { Invoke-EasyFireScheduledBackupStage -Journal $journal } catch { $crash = $_.Exception.Message }
$renewedId = [string]$journal.ScheduledBackupPlan.BackupOperationId
$candidateCleared = $null -eq (Get-EasyFireProperty $journal 'ScheduledBackupCandidate')
$writesAfterRenewal = $script:WriteCount
Invoke-EasyFireScheduledBackupStage -Journal $journal
$resumedId = [string]$journal.ScheduledBackupPlan.BackupOperationId
$writesAfterResume = $script:WriteCount
Invoke-EasyFireScheduledBackupStage -Journal $journal
$nextId = [string]$journal.ScheduledBackupPlan.BackupOperationId
$coreAfter = [pscustomobject]@{
  Controller=$journal.ControllerBundleAuthority; Environment=$journal.EnvironmentSha256
  Images=$journal.BuiltImageAuthority; Volumes=$journal.DurableVolumePlan
} | ConvertTo-Json -Depth 8 -Compress
[pscustomobject]@{
  Crash=$crash; OldId=$oldId; RenewedId=$renewedId; ResumedId=$resumedId; NextId=$nextId
  CandidateCleared=$candidateCleared; WritesAfterRenewal=$writesAfterRenewal
  WritesAfterResume=$writesAfterResume; TotalWrites=$script:WriteCount
  CoreAuthorityUnchanged=($coreBefore -ceq $coreAfter)
} | ConvertTo-Json -Compress
`,
  );

  assert.match(evidence.Crash, /crash_after_operation_renewal/i);
  assert.notEqual(evidence.RenewedId, evidence.OldId);
  assert.equal(evidence.ResumedId, evidence.RenewedId);
  assert.notEqual(evidence.NextId, evidence.ResumedId);
  assert.equal(evidence.CandidateCleared, true);
  assert.equal(evidence.WritesAfterRenewal, 1);
  assert.equal(evidence.WritesAfterResume, 1);
  assert.equal(evidence.TotalWrites, 2);
  assert.equal(evidence.CoreAuthorityUnchanged, true);
});

test("the harness functions are exact current controller AST extents", () => {
  const source = readFileSync(controllerPath, "utf8");
  for (const name of exactFunctionNames) {
    assert.ok(source.includes(exactFunctions[name]));
  }
});
