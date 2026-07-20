import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controllerPath = resolve(root, "deploy/windows/production-action.ps1");
const source = readFileSync(controllerPath, "utf8");

function getFunctionBody(name) {
  const marker = `function ${name} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing controller function ${name}`);
  const remaining = source.slice(start + marker.length);
  const nextFunction = remaining.search(/\r?\nfunction [A-Za-z0-9-]+ \{/);
  return nextFunction === -1
    ? source.slice(start)
    : source.slice(start, start + marker.length + nextFunction);
}

function assertOrdered(body, patterns) {
  let cursor = 0;
  for (const pattern of patterns) {
    const match = pattern.exec(body.slice(cursor));
    assert.ok(match, `missing ordered controller contract: ${pattern}`);
    cursor += match.index + match[0].length;
  }
}

test("environment and image creation are journal-authorized before mutation", () => {
  const environmentCandidate = getFunctionBody(
    "New-EasyFireEnvironmentCandidate",
  );
  assert.match(
    environmentCandidate,
    /# EASYFIRE_ENV_OPERATION_ID=\$OperationId/,
  );
  assert.match(
    environmentCandidate,
    /\$PartialPath\s+-cne\s+"\$CandidatePath\.\$OperationId\.partial"/,
  );
  assert.match(environmentCandidate, /\[IO\.File\]::Delete\(\$PartialPath\)/);
  assertOrdered(environmentCandidate, [
    /WriteAllText\(\$PartialPath/,
    /Assert-EasyFireEnvironmentOperationAuthority\s+-Path\s+\$PartialPath/,
    /Move-Item\s+-LiteralPath\s+\$PartialPath\s+-Destination\s+\$CandidatePath/,
    /Assert-EasyFireEnvironmentOperationAuthority\s+-Path\s+\$CandidatePath/,
  ]);

  const imageCleanup = getFunctionBody("Remove-EasyFireJournalOwnedImageTags");
  assert.match(imageCleanup, /Compare-Object[\s\S]*-CaseSensitive/);
  assertOrdered(imageCleanup, [
    /'image',\s*'inspect',\s*\$reference/,
    /'ps',\s*'-a',\s*'--filter',\s*"ancestor=\$reference"/,
    /'image',\s*'rm',\s*\$reference/,
    /'image',\s*'inspect',\s*\$reference/,
  ]);
  assert.doesNotMatch(imageCleanup, /--force|\bvolume\b|\bcontainer\s+rm\b/);

  const action = getFunctionBody("Invoke-EasyFireActionStage");
  assertOrdered(action, [
    /State\s*=\s*'planned'/,
    /Set-EasyFireProperty\s+-Object\s+\$Journal\s+-Name\s+'EnvironmentPlan'/,
    /Write-EasyFireTrackedJournal\s+-Journal\s+\$Journal/,
    /New-EasyFireEnvironmentCandidate[\s\S]*?-OperationId\s+\$environmentOperationId/,
    /Set-EasyFireProperty\s+-Object\s+\$environmentPlan\s+-Name\s+'State'\s+-Value\s+'prepared'/,
    /Set-EasyFireProperty\s+-Object\s+\$environmentPlan\s+-Name\s+'State'\s+-Value\s+'publishing'/,
    /Move-Item\s+-LiteralPath\s+\$expectedCandidatePath\s+-Destination\s+\$envFile/,
    /Set-EasyFireProperty\s+-Object\s+\$environmentPlan\s+-Name\s+'State'\s+-Value\s+'published'/,
    /ImageBuildPlan/,
    /Write-EasyFireTrackedJournal\s+-Journal\s+\$Journal/,
    /Remove-EasyFireJournalOwnedImageTags\s+-ImageReferences\s+\$plannedImageReferences/,
    /Invoke-EasyFireCompose[\s\S]*?@\('build',\s*'--pull',\s*'--no-cache'\)/,
    /Set-EasyFireProperty\s+-Object\s+\$imageBuildPlan\s+-Name\s+'State'\s+-Value\s+'completed'/,
  ]);
});

test("scheduled task uses the sealed release controller and preserves its bundle authority", () => {
  const interpreter = getFunctionBody("Get-EasyFireWindowsPowerShellPath");
  assert.match(
    interpreter,
    /\[Environment\]::GetFolderPath\(\[Environment\+SpecialFolder\]::System\)/,
  );
  assert.match(interpreter, /WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(
    interpreter,
    /Test-Path\s+-LiteralPath\s+\$executable\s+-PathType\s+Leaf/,
  );
  assert.match(interpreter, /Test-EasyFireReparsePoint\s+-Path\s+\$executable/);

  const taskDefinitions = getFunctionBody("Get-EasyFireTaskDefinitions");
  assert.match(
    taskDefinitions,
    /\$installedController\s*=\s*Join-Path\s+\$ReleaseDirectory\s+'deploy\\windows\\production-action\.ps1'/,
  );
  assert.match(
    taskDefinitions,
    /-ExecutionPolicy\s+Bypass\s+-WindowStyle\s+Hidden\s+-File\s+"\{0\}"\s+-Stage\s+ScheduledBackup[\s\S]*?-f\s*\r?\n?\s*\$installedController/,
  );
  assert.match(
    taskDefinitions,
    /-AuthorityOwnerSid\s+"\{3\}"[\s\S]*\$script:AuthorityOwnerSid/,
  );
  assert.match(
    taskDefinitions,
    /WorkingDirectory\s*=\s*\[IO\.Path\]::GetDirectoryName\(\$installedController\)/,
  );
  assert.match(
    taskDefinitions,
    /Execute\s*=\s*Get-EasyFireWindowsPowerShellPath/,
  );

  const contentEquality = getFunctionBody(
    "Assert-EasyFireControllerBundleContentEqual",
  );
  assert.match(contentEquality, /\$Left\.Files/);
  assert.match(contentEquality, /\$Right\.Files/);
  assert.match(
    contentEquality,
    /\$leftFiles\.Count\s+-ne\s+\$rightFiles\.Count/,
  );
  assert.match(
    contentEquality,
    /\[IO\.Path\]::GetFileName\(\[string\]\$file\.Path\)/,
  );
  assert.match(
    contentEquality,
    /\[string\]\$file\.Sha256\s+-cne\s+\[string\]\$rightByName\[\$name\]/,
  );

  const action = getFunctionBody("Invoke-EasyFireActionStage");
  assertOrdered(action, [
    /\$installedController\s*=\s*Join-Path\s+\$script:ReleaseDirectory\s+'deploy\\windows\\production-action\.ps1'/,
    /Get-EasyFireControllerBundlePaths\s+-ControllerPath\s+\$installedController/,
    /Get-EasyFireExecutableBundleAuthority\s+-Paths\s+\$installedBundlePaths/,
    /Assert-EasyFireControllerBundleContentEqual\s+-Left\s+\$script:ControllerBundleAuthority\s+-Right\s+\$installedBundle/,
    /Get-EasyFireProperty\s+-Object\s+\$Journal\s+-Name\s+'ScheduledControllerBundleAuthority'/,
    /if\s*\(\$establishedInstalledBundle\)/,
    /Assert-EasyFireExecutableBundleAuthority[\s\S]*?-ExpectedAuthority\s+\$establishedInstalledBundle\s+-Paths\s+\$installedBundlePaths/,
    /Set-EasyFireProperty\s+-Object\s+\$Journal\s+-Name\s+'ScheduledControllerBundleAuthority'\s+-Value\s+\$installedBundle/,
    /Write-EasyFireTrackedJournal\s+-Journal\s+\$Journal/,
    /Get-EasyFireTaskDefinitions\s+-ReleaseDirectory\s+\$script:ReleaseDirectory/,
  ]);
});

test("scheduled backup keeps the interactive deployment owner as journal-bound ACL authority", () => {
  assert.match(source, /\[string\]\$AuthorityOwnerSid/);
  assert.match(
    source,
    /if\s*\(\$Stage\s+-eq\s+'ScheduledBackup'\)[\s\S]*ScheduledBackup requires the journal-bound AuthorityOwnerSid\.[\s\S]*ConvertTo-EasyFireCanonicalAuthorityOwnerSid -Value \$AuthorityOwnerSid/,
  );
  assert.match(
    source,
    /else\s*\{[\s\S]*AuthorityOwnerSid is accepted only for ScheduledBackup\.[\s\S]*WindowsIdentity\]::GetCurrent\(\)[\s\S]*\$script:AuthorityOwnerSid\s*=\s*ConvertTo-EasyFireCanonicalAuthorityOwnerSid/,
  );

  const allowedSids = getFunctionBody("Get-EasyFireAllowedSids");
  assert.match(allowedSids, /\$script:AuthorityOwnerSid/);
  assert.match(allowedSids, /S-1-5-18/);
  assert.match(allowedSids, /S-1-5-32-544/);
  assert.doesNotMatch(allowedSids, /WindowsIdentity\]::GetCurrent/);

  const identity = getFunctionBody("Assert-EasyFireJournalIdentity");
  assert.match(
    identity,
    /AuthorityOwnerSid[\s\S]*-cne\s+\$script:AuthorityOwnerSid/,
  );

  const receipt = getFunctionBody("Invoke-EasyFirePreflightStage");
  const actionReceipt = getFunctionBody("Assert-EasyFireActionReceipt");
  const journal = getFunctionBody("New-EasyFireActionJournal");
  assert.match(receipt, /AuthorityOwnerSid\s*=\s*\$script:AuthorityOwnerSid/);
  assert.match(
    actionReceipt,
    /AuthorityOwnerSid[\s\S]*-ceq\s+\$script:AuthorityOwnerSid/,
  );
  assert.match(
    journal,
    /AuthorityOwnerSid\s*=\s*\[string\]\$Receipt\.AuthorityOwnerSid/,
  );
  assert.match(source, /New-ScheduledTaskPrincipal\s+-UserId\s+'SYSTEM'/);
});

test("authority-tree validation accepts the bound deployer SID and rejects a different SID", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "easyfire-owner-sid-"));
  const harnessPath = join(fixtureRoot, "owner-sid-proof.ps1");
  const harness = `
param([Parameter(Mandatory = $true)][string]$FixtureRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop

function Test-EasyFireReparsePoint {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

${getFunctionBody("Get-EasyFireAllowedSids")}
${getFunctionBody("Protect-EasyFireAuthorityDirectory")}
${getFunctionBody("Assert-EasyFireAuthorityTree")}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $currentSid = $identity.User.Value } finally { $identity.Dispose() }
$authorityRoot = Join-Path $FixtureRoot 'authority'
$script:AuthorityOwnerSid = $currentSid
Protect-EasyFireAuthorityDirectory -Path $authorityRoot
[IO.File]::WriteAllText((Join-Path $authorityRoot 'journal.json'), '{}')
Assert-EasyFireAuthorityTree -Path $authorityRoot

  $script:AuthorityOwnerSid = 'S-1-5-21-999999999-999999999-999999999-1001'
  $rejected = $false
  try { Assert-EasyFireAuthorityTree -Path $authorityRoot } catch { $rejected = $true }
  if (-not $rejected) { throw 'A different authority-owner SID was accepted.' }

  $script:AuthorityOwnerSid = $currentSid
  $null = & (Join-Path $env:SystemRoot 'System32/icacls.exe') $authorityRoot /grant '*S-1-5-32-545:(OI)(CI)(RX)'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to add the disposable extra-principal ACL.' }
  $extraPrincipalRejected = $false
  try { Assert-EasyFireAuthorityTree -Path $authorityRoot } catch { $extraPrincipalRejected = $true }
  if (-not $extraPrincipalRejected) { throw 'An extra authority-tree principal was accepted.' }
  'AUTHORITY_OWNER_SID_PROOF_OK'
`;

  try {
    writeFileSync(harnessPath, harness, "utf8");
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        harnessPath,
        "-FixtureRoot",
        fixtureRoot,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PSModulePath: [
            join(
              process.env.USERPROFILE,
              "Documents",
              "WindowsPowerShell",
              "Modules",
            ),
            join(process.env.ProgramFiles, "WindowsPowerShell", "Modules"),
            join(
              process.env.SystemRoot,
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "Modules",
            ),
          ].join(";"),
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /AUTHORITY_OWNER_SID_PROOF_OK/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("ScheduledBackup fails before work when the caller is not the installed controller", () => {
  const identity = getFunctionBody("Assert-EasyFireJournalIdentity");
  assertOrdered(identity, [
    /\$installedController\s*=\s*Join-Path\s+\$script:ReleaseDirectory\s+'deploy\\windows\\production-action\.ps1'/,
    /\[IO\.Path\]::GetFullPath\(\$script:ControllerPath\)/,
    /\[IO\.Path\]::GetFullPath\(\$installedController\)/,
    /\[StringComparison\]::OrdinalIgnoreCase/,
    /if\s*\(\$Stage\s+-eq\s+'ScheduledBackup'\s+-and\s+-not\s+\$isInstalledController\)/,
    /throw\s+'Scheduled backup must run through the exact sealed installed controller\.'/,
    /'ScheduledControllerBundleAuthority'/,
    /Assert-EasyFireExecutableBundleAuthority\s+-ExpectedAuthority\s+\$bundle\s+-Paths\s+\$script:ControllerBundlePaths/,
  ]);

  const scheduled = getFunctionBody("Invoke-EasyFireScheduledBackupStage");
  const identityCheck = scheduled.indexOf(
    "Assert-EasyFireJournalIdentity -Journal $Journal",
  );
  const backupAuthorityCheck = scheduled.indexOf(
    "Assert-EasyFireAuthorityTree -Path $script:BackupsRoot",
  );
  const firstPlanAccess = scheduled.indexOf("ScheduledBackupPlan");
  const backupInvocation = scheduled.indexOf(
    "Get-EasyFireVerifiedBackupReceipt",
  );
  assert.ok(identityCheck >= 0);
  assert.ok(backupAuthorityCheck >= 0);
  assert.ok(identityCheck < firstPlanAccess);
  assert.ok(identityCheck < backupInvocation);
  assert.ok(backupAuthorityCheck < firstPlanAccess);
  assert.ok(backupAuthorityCheck < backupInvocation);

  const postcheck = getFunctionBody("Invoke-EasyFirePostcheckStage");
  assertOrdered(postcheck, [
    /Assert-EasyFireAuthorityTree\s+-Path\s+\$script:BackupsRoot/,
    /BaselineBackup/,
    /Assert-EasyFireBackupReceiptRecoveryUnit\s+-Receipt\s+\$baseline/,
  ]);

  const rollbackReadback = getFunctionBody("Assert-EasyFireRollbackReadback");
  assertOrdered(rollbackReadback, [
    /if\s*\(\[bool\]\$rollback\.AppEverStarted\)/,
    /Assert-EasyFireAuthorityTree\s+-Path\s+\$script:BackupsRoot/,
    /EmergencyBackup/,
    /Assert-EasyFireBackupReceiptRecoveryUnit\s+-Receipt\s+\$emergency/,
  ]);

  const rollback = getFunctionBody("Invoke-EasyFireRollbackStage");
  assertOrdered(rollback, [
    /if\s*\(\[bool\]\$rollback\.AppEverStarted\)/,
    /\$existingEmergencyReceipt\s*=\s*Get-EasyFireProperty/,
    /Assert-EasyFireAuthorityTree\s+-Path\s+\$script:BackupsRoot/,
    /Get-EasyFireVerifiedBackupReceipt\s+-Journal\s+\$Journal\s+-Kind\s+'Emergency'/,
  ]);
});

test("backup candidate, publication receipt, and metadata recovery unit are independently bound and journaled", () => {
  const backup = getFunctionBody("Get-EasyFireVerifiedBackupReceipt");
  const invocation = backup.indexOf("Invoke-EasyFireNative");
  assert.ok(invocation > 0);

  const beforeInvocation = backup.slice(0, invocation);
  assertOrdered(beforeInvocation, [
    /\$candidateProperty\s*=\s*\$Kind\s*\+\s*'BackupCandidate'/,
    /\$candidatePath\s*=\s*Join-Path\s+\$script:BackupsRoot\s+"\$artifactStem\.sql\.gz"/,
    /\$metadataPath\s*=\s*Join-Path\s+\$script:BackupsRoot\s+"\$artifactStem\.metadata\.json"/,
    /Set-EasyFireProperty\s+-Object\s+\$Journal\s+-Name\s+\$candidateProperty\s+-Value\s+\$candidate/,
    /Write-EasyFireTrackedJournal\s+-Journal\s+\$Journal/,
  ]);
  for (const exactCandidateField of [
    /\$candidate\.BackupFile\s+-cne\s+\$candidatePath/,
    /\$candidate\.SidecarFile\s+-cne\s+\(Join-Path\s+\$script:BackupsRoot\s+"\$artifactStem\.sha256"\)/,
    /\$candidate\.MetadataFile\s+-cne\s+\$metadataPath/,
    /\$candidate\.BackupOperationId\s+-cne\s+\[string\]\$plan\.BackupOperationId/,
  ]) {
    assert.match(beforeInvocation, exactCandidateField);
  }
  assert.match(
    beforeInvocation,
    /throw\s+"\$Kind backup candidate does not match its operation authority\."/,
  );

  const afterInvocation = backup.slice(invocation);
  assertOrdered(afterInvocation, [
    /Test-EasyFireBackupPair\s+-BackupFile\s+\$candidatePath/,
    /Test-Path\s+-LiteralPath\s+\$metadataPath\s+-PathType\s+Leaf/,
    /Test-EasyFireReparsePoint\s+-Path\s+\$metadataPath/,
    /Assert-EasyFireNoReparsePathChain\s+-Path\s+\$metadataPath\s+-TrustedRoot\s+\$script:BackupsRoot/,
    /\$metadataSha256\s*=\s*Get-EasyFireSha256Hex\s+-Path\s+\$metadataPath/,
    /Get-Content\s+-LiteralPath\s+\$metadataPath\s+-Raw\s+-Encoding\s+utf8\s*\|\s*ConvertFrom-Json/,
  ]);

  const namesMatch =
    /\$expectedMetadataNames\s*=\s*@\(([\s\S]*?)\)\s*\|\s*Sort-Object/.exec(
      backup,
    );
  assert.ok(namesMatch);
  const metadataNames = [...namesMatch[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(metadataNames, [
    "ActionId",
    "BackupFile",
    "BackupMode",
    "BackupOperationId",
    "BackupSha256",
    "DurableVolumeFingerprint",
    "InvocationRole",
    "MysqlContainerId",
    "MysqlContainerName",
    "MysqlImageId",
    "MysqlImageReference",
    "MysqlVolumeDestination",
    "MysqlVolumeName",
    "PhaseInventoryFingerprint",
    "SchemaVersion",
  ]);

  for (const independentBinding of [
    /\$published\.BackupFile\s+-cne\s+\[string\]\$pair\.BackupFile/,
    /\$published\.SidecarFile\s+-cne\s+\[string\]\$pair\.SidecarFile/,
    /\$published\.Sha256\s+-cne\s+\[string\]\$pair\.Sha256/,
    /\$published\.MetadataFile\s+-cne\s+\$metadataPath/,
    /\$published\.MetadataSha256\s+-cne\s+\$metadataSha256/,
    /Compare-Object\s+\$expectedMetadataNames\s+\$actualMetadataNames\s+-CaseSensitive/,
    /\$metadata\.PhaseInventoryFingerprint\s+-cne\s+\[string\]\$Journal\.PhaseInventoryFingerprint/,
    /\$metadata\.DurableVolumeFingerprint\s+-cne\s+\[string\]\$Journal\.DurableVolumeFingerprint/,
    /\$metadata\.BackupFile\s+-cne\s+\[string\]\$pair\.BackupFile/,
    /\$metadata\.BackupSha256\s+-cne\s+\[string\]\$pair\.Sha256/,
  ]) {
    assert.match(afterInvocation, independentBinding);
  }

  assertOrdered(afterInvocation, [
    /\$receipt\s*=\s*\[pscustomobject\]@\{/,
    /MetadataFile\s*=\s*\$metadataPath/,
    /MetadataSha256\s*=\s*\$metadataSha256/,
    /Set-EasyFireProperty\s+-Object\s+\$Journal\s+-Name\s+\$receiptProperty\s+-Value\s+\$receipt/,
    /Write-EasyFireTrackedJournal\s+-Journal\s+\$Journal/,
  ]);
});
