import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const MARIADB_IMAGE =
  "mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577";

test("proof Compose override removes production identities and host ports", () => {
  const proof = read("docker-compose.proof.yml");

  assert.equal((proof.match(/container_name:\s*!reset null/g) ?? []).length, 7);
  assert.match(proof, /ports:\s*!reset \[\]/);
  assert.equal((proof.match(/restart:\s*['"]no['"]/g) ?? []).length, 7);
  assert.equal((proof.match(/^\s+name:\s*!reset null/gm) ?? []).length, 2);
  assert.match(proof, /easyfire\.proof\.id/);
  assert.match(proof, /bigcapital_network:[\s\S]*easyfire\.proof\.id/);
});

test("proof builds dependency-heavy images sequentially", () => {
  const runner = read("scripts/production/disposable-proof.ps1");

  assert.match(
    runner,
    /\$composeBuildServices\s*=\s*@\('mysql',\s*'redis',\s*'database_migration',\s*'server',\s*'webapp'\)/,
  );
  assert.match(
    runner,
    /foreach\s*\(\$service\s+in\s+\$composeBuildServices\)[\s\S]*?Invoke-DockerLogged\s*\(\$composeArgs\s*\+\s*@\('build',\s*\$service\)\)/,
  );
  assert.doesNotMatch(
    runner,
    /@\('build',\s*'mysql',\s*'redis',\s*'database_migration',\s*'server',\s*'webapp'\)/,
  );
});

test("built-server authentication probe parses as CommonJS", () => {
  const runner = read("scripts/production/disposable-proof.ps1");
  const match = /\$builtServerAuthProbe\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/.exec(
    runner,
  );
  assert.ok(match, "built-server auth probe here-string is missing");
  assert.match(match[1], /\(async\s*\(\)\s*=>\s*\{[\s\S]*\}\)\(\)\.catch/);
  assert.match(match[1], /actualHeader\.alg\s*!==\s*['"]HS384['"]/);
  assert.match(match[1], /createHmac\(['"]sha384['"],\s*['"]123123['"]\)/);
  assert.match(
    match[1],
    /JSON\.stringify\(\{\s*alg:\s*['"]HS384['"],\s*typ:\s*['"]JWT['"]\s*\}\)/,
  );
  assert.match(
    match[1],
    /createHmac\(['"]sha256['"],\s*process\.env\.APP_JWT_SECRET\)/,
  );
  assert.doesNotMatch(
    match[1],
    /createHmac\(['"]sha256['"],\s*['"]123123['"]\)/,
  );

  const syntax = spawnSync(process.execPath, ["--check", "-"], {
    input: match[1],
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("restore verifier is immutable, identity-bound, and cleans only its own resources", () => {
  const verifier = read("scripts/production/restore-verify.ps1");

  assert.match(verifier, new RegExp(MARIADB_IMAGE.replaceAll("/", "\\/")));
  assert.match(verifier, /\[string\]\$ExpectedProofId/);
  assert.match(verifier, /easyfire_disposable_proof/);
  assert.match(verifier, /docker rm -f -v \$createdContainerId/);
  assert.doesNotMatch(verifier, /docker ps -a --filter/);
  assert.doesNotMatch(verifier, /mariadb:11(?:\s|['"])/);
  assert.doesNotMatch(verifier, /WARNING: No SHA-256 sidecar found/);
  assert.doesNotMatch(verifier, /Remove-Item -Recurse/);
});

test("restore verifier journals deterministic container and volume authority before Docker mutation", () => {
  const verifier = read("scripts/production/restore-verify.ps1");
  const journalWrite = verifier.indexOf(
    "$null = Write-EasyFireRestoreAuthorityJournal",
  );
  const volumeCreate = verifier.indexOf(
    "$volumeCreateArguments = @('volume', 'create'",
  );
  const containerRun = verifier.indexOf("$runArguments = @('run', '-d'");

  assert.match(verifier, /BackupOperationId/);
  assert.match(verifier, /ActionId/);
  assert.match(verifier, /\.restore-verify\.json/);
  assert.match(verifier, /easyfire\.restore\.action\.id/);
  assert.match(verifier, /easyfire\.restore\.backup\.operation\.id/);
  assert.match(verifier, /easyfire\.restore\.authority/);
  assert.match(verifier, /--mount/);
  assert.match(verifier, /\/var\/lib\/mysql/);
  assert.match(verifier, /docker container inspect \$ContainerName/);
  assert.match(verifier, /docker volume inspect \$VolumeName/);
  assert.match(verifier, /docker volume rm \$VolumeName/);
  assert.doesNotMatch(verifier, /\[Guid\]::NewGuid\(\)/);
  assert.ok(journalWrite >= 0, "restore authority journal writer is missing");
  assert.ok(
    volumeCreate > journalWrite,
    "volume creation preceded journal authority",
  );
  assert.ok(
    containerRun > volumeCreate,
    "container run preceded volume creation",
  );
});

test("PowerShell 5.1 resumes exact restore authority journal publication", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "easyfire-restore-authority-"),
  );
  const harnessPath = join(fixtureRoot, "restore-authority.ps1");
  const harness = String.raw`
param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$FixtureRoot
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $RepoRoot 'scripts\production\backup-integrity.psm1') -Force -ErrorAction Stop
$script:MariaDbImage = '${MARIADB_IMAGE}'
$restoreScript = Join-Path $RepoRoot 'scripts\production\restore-verify.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($restoreScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'restore-verify.ps1 did not parse in Windows PowerShell 5.1.' }
$functionNames = @(
    'Get-EasyFireRestoreProperty',
    'ConvertTo-EasyFireRestoreCanonicalGuid',
    'Test-EasyFireRestoreReparsePoint',
    'Get-EasyFireRestoreMetadataPath',
    'Get-EasyFireRestoreAuthorityToken',
    'Get-EasyFireRestoreAuthority',
    'Assert-EasyFireRestoreAuthorityDocument',
    'Read-EasyFireRestoreAuthorityJournal',
    'Write-EasyFireUtf8NoBomDurable',
    'Write-EasyFireRestoreAuthorityJournal'
)
$definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true))
foreach ($name in $functionNames) {
    $definition = @($definitions | Where-Object { $_.Name -ceq $name })
    if ($definition.Count -ne 1) { throw "Expected exactly one function definition for $name." }
    Invoke-Expression $definition[0].Extent.Text
}

function Assert-Condition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Write-TestGzip {
    param([string]$Path, [string]$Text)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    $file = [IO.File]::Create($Path)
    $gzip = $null
    try {
        $gzip = New-Object IO.Compression.GZipStream($file, [IO.Compression.CompressionMode]::Compress, $false)
        $gzip.Write($bytes, 0, $bytes.Length)
    } finally {
        if ($gzip) { $gzip.Dispose() }
        $file.Dispose()
    }
}

$actionId = '11111111-1111-4111-8111-111111111111'
$operationId = '22222222-2222-4222-8222-222222222222'
$backupFile = Join-Path $FixtureRoot "mysql-easyfire-bookkeeping-prod-full-$operationId.sql.gz"
$sidecarFile = $backupFile -replace '\.sql\.gz$', '.sha256'
$metadataFile = $backupFile -replace '\.sql\.gz$', '.metadata.json'
Write-TestGzip -Path $backupFile -Text 'synthetic restore authority fixture'
$backupHash = Get-EasyFireSha256Hex -Path $backupFile
Set-Content -LiteralPath $sidecarFile -Value "$backupHash  $([IO.Path]::GetFileName($backupFile))" -Encoding ascii
$metadata = [ordered]@{
    SchemaVersion = 1
    ActionId = $actionId
    InvocationRole = 'Baseline'
    BackupOperationId = $operationId
    BackupMode = 'full'
    PhaseInventoryFingerprint = ('A' * 64)
    DurableVolumeFingerprint = ('B' * 64)
    MysqlContainerId = ('c' * 64)
    MysqlContainerName = 'easyfire-bookkeeping-prod-mysql-1'
    MysqlImageReference = 'mariadb:11.8.6'
    MysqlImageId = ('sha256:' + ('d' * 64))
    MysqlVolumeName = 'easyfire_prod_mysql_fixture'
    MysqlVolumeDestination = '/var/lib/mysql'
    BackupFile = $backupFile
    BackupSha256 = $backupHash
}
[IO.File]::WriteAllText(
    $metadataFile,
    (($metadata | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    (New-Object Text.UTF8Encoding($false))
)

$pair = Test-EasyFireBackupPair -BackupFile $backupFile
Assert-Condition $pair.Valid 'Fixture backup pair was not valid.'
$authority = Get-EasyFireRestoreAuthority -BackupPair $pair
Assert-Condition ($authority.ActionId -ceq $actionId) 'ActionId was not bound from metadata.'
Assert-Condition ($authority.BackupOperationId -ceq $operationId) 'BackupOperationId was not bound from metadata.'
Assert-Condition ($authority.ContainerName -ceq "easyfire-restore-verify-$($actionId.Replace('-', ''))-$($operationId.Replace('-', ''))") 'Container name was not deterministic.'
Assert-Condition ($authority.VolumeName -ceq "$($authority.ContainerName)-data") 'Volume name was not deterministic.'

$proofId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$proofOperationId = '33333333-3333-4333-8333-333333333333'
$proofBackupFile = Join-Path $FixtureRoot "mysql-efbk-proof-full-$proofOperationId.sql.gz"
$proofSidecarFile = $proofBackupFile -replace '\.sql\.gz$', '.sha256'
$proofMetadataFile = $proofBackupFile -replace '\.sql\.gz$', '.metadata.json'
Write-TestGzip -Path $proofBackupFile -Text 'synthetic disposable proof restore fixture'
$proofBackupHash = Get-EasyFireSha256Hex -Path $proofBackupFile
Set-Content -LiteralPath $proofSidecarFile -Value "$proofBackupHash  $([IO.Path]::GetFileName($proofBackupFile))" -Encoding ascii
$proofMetadata = [ordered]@{
    SchemaVersion = 1
    ProofId = $proofId
    InvocationRole = 'DisposableProof'
    BackupOperationId = $proofOperationId
    BackupMode = 'full'
    MysqlContainerId = ('e' * 64)
    MysqlContainerName = 'efbk-proof-mysql-1'
    MysqlImageReference = 'mariadb:11.8.6'
    MysqlImageId = ('sha256:' + ('f' * 64))
    MysqlVolumeName = 'efbk-proof-mysql-data'
    MysqlVolumeDestination = '/var/lib/mysql'
    BackupFile = $proofBackupFile
    BackupSha256 = $proofBackupHash
}
[IO.File]::WriteAllText(
    $proofMetadataFile,
    (($proofMetadata | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    (New-Object Text.UTF8Encoding($false))
)
$proofPair = Test-EasyFireBackupPair -BackupFile $proofBackupFile
$proofAuthority = Get-EasyFireRestoreAuthority -BackupPair $proofPair -ExactExpectedProofId $proofId
Assert-Condition ($proofAuthority.ActionId -ceq 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') 'ProofId was not deterministically mapped to ActionId authority.'
Assert-Condition ($proofAuthority.BackupOperationId -ceq $proofOperationId) 'Proof BackupOperationId was not bound from metadata.'
Assert-Condition ($proofAuthority.ProofId -ceq $proofId) 'Proof authority lost the exact ProofId.'

$first = Write-EasyFireRestoreAuthorityJournal -Authority $authority
Assert-Condition (Test-Path -LiteralPath $authority.JournalPath -PathType Leaf) 'Final authority journal was not published.'
Assert-Condition (-not (Test-Path -LiteralPath $authority.JournalCandidatePath)) 'Journal candidate remained after publication.'
$resumed = Write-EasyFireRestoreAuthorityJournal -Authority $authority
Assert-Condition ($resumed.AuthorityToken -ceq $first.AuthorityToken) 'Existing journal did not resume exact authority.'

Remove-Item -LiteralPath $authority.JournalPath -Force
$candidateJson = ($authority.Document | ConvertTo-Json -Depth 8) + [Environment]::NewLine
Write-EasyFireUtf8NoBomDurable -Path $authority.JournalCandidatePath -Text $candidateJson
$candidateResume = Write-EasyFireRestoreAuthorityJournal -Authority $authority
Assert-Condition ($candidateResume.AuthorityToken -ceq $first.AuthorityToken) 'Prepared journal candidate did not resume.'
Assert-Condition (-not (Test-Path -LiteralPath $authority.JournalCandidatePath)) 'Resumed candidate remained after publication.'

Remove-Item -LiteralPath $authority.JournalPath -Force
Set-Content -LiteralPath $authority.JournalPath -Value '{"SchemaVersion":1}' -Encoding ascii
$corruptionRefused = $false
try {
    $null = Write-EasyFireRestoreAuthorityJournal -Authority $authority
} catch {
    $corruptionRefused = $_.Exception.Message -match 'does not match the exact backup authority'
}
Assert-Condition $corruptionRefused 'Corrupt final journal authority was not refused.'
Assert-Condition (Test-Path -LiteralPath $authority.JournalPath -PathType Leaf) 'Refusal removed the corrupt authority evidence.'

[pscustomobject]@{
    PowerShellVersion = $PSVersionTable.PSVersion.ToString()
    ActionId = $authority.ActionId
    BackupOperationId = $authority.BackupOperationId
    ProofActionId = $proofAuthority.ActionId
    CandidateResumed = $candidateResume.AuthorityToken -ceq $first.AuthorityToken
    CorruptionRefused = $corruptionRefused
} | ConvertTo-Json -Compress
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
        "-RepoRoot",
        root,
        "-FixtureRoot",
        fixtureRoot,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = JSON.parse(result.stdout.trim());
    assert.match(evidence.PowerShellVersion, /^5\.1\./);
    assert.equal(evidence.ActionId, "11111111-1111-4111-8111-111111111111");
    assert.equal(
      evidence.BackupOperationId,
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal(
      evidence.ProofActionId,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    assert.equal(evidence.CandidateResumed, true);
    assert.equal(evidence.CorruptionRefused, true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("production backup is bound to one journaled action and operation", () => {
  const backup = read("scripts/production/backup.ps1");

  assert.match(backup, /\[string\]\$ActionId/);
  assert.match(backup, /\[string\]\$BackupOperationId/);
  assert.match(backup, /ValidateSet\('Scheduled', 'Baseline', 'Emergency'\)/);
  assert.match(backup, /ConvertTo-EasyFireCanonicalActionId/);
  assert.match(backup, /Test-EasyFireProductionJournal/);
  assert.match(backup, /PhaseInventoryFingerprint/);
  assert.match(backup, /Get-EasyFireInventoryFingerprint/);
  assert.match(backup, /DurableVolumeFingerprint/);
  assert.match(backup, /Get-EasyFireVolumeFingerprint/);
  assert.match(backup, /State -cne 'running'/);
  assert.match(backup, /Health -cne 'healthy'/);
  assert.match(backup, /BackupOperationId.*InvocationRole.*BackupMode/s);
  assert.match(
    backup,
    /mysql-\$\{ProjectName\}-\$\{dumpMode\}-\$BackupOperationId/,
  );
  assert.match(backup, /BACKUP_PUBLISHED/);
  assert.match(backup, /MetadataFile/);
  assert.match(backup, /MetadataSha256/);
  assert.match(backup, /PhaseInventoryFingerprint/);
  assert.match(backup, /MysqlContainerId/);
  assert.match(backup, /MysqlImageReference/);
  assert.match(backup, /MysqlVolumeName/);
  assert.match(backup, /docker exec -i \$mysqlContainerId/);
  assert.doesNotMatch(backup, /composeArgs exec -T mysql/);
});

test("backup import order preserves state and integrity helper exports", () => {
  const backup = read("scripts/production/backup.ps1");
  const ioImport = backup.indexOf("production-io.psm1");
  const stateImport = backup.indexOf("production-state.psm1");
  const integrityImport = backup.indexOf("backup-integrity.psm1");

  assert.notEqual(ioImport, -1, "production I/O import is missing");
  assert.notEqual(stateImport, -1, "production state import is missing");
  assert.notEqual(integrityImport, -1, "backup integrity import is missing");
  assert.ok(
    ioImport < stateImport && stateImport < integrityImport,
    "imports must end with state then integrity so both helper families remain visible",
  );
  assert.match(backup, /Test-EasyFireReparsePoint/);
  assert.match(backup, /Test-EasyFireBackupPair/);
});

test("backup retention has independent pools and preserves journal authority", () => {
  const backup = read("scripts/production/backup.ps1");

  assert.match(backup, /mysql-\$\{ExactProjectName\}-\$\{Mode\}-\*\.sql\.gz/);
  assert.match(backup, /Get-EasyFireBackupMutexName/);
  assert.match(backup, /Get-EasyFirePinnedBackupNames/);
  assert.match(backup, /BaselineBackup/);
  assert.match(backup, /EmergencyBackup/);
  assert.match(backup, /BackupCandidate/);
  assert.match(backup, /BackupPlan/);
  assert.match(backup, /BackupOperationId/);
  assert.match(backup, /Get-EasyFireBackupMetadataPath/);
  assert.match(backup, /Test-EasyFireBackupMetadataBinding/);
  assert.match(
    backup,
    /Remove-Item -LiteralPath \$metadataFile[\s\S]*Write-Host/,
  );
  assert.doesNotMatch(backup, /-Filter "mysql-\*\.sql\.gz"/);
  assert.doesNotMatch(backup, /mysql-\$\{ProjectName\}-\*\.sql\.gz/);
});

test("backup passes the dump command to the exact container without Windows CRLF piping", () => {
  const backup = read("scripts/production/backup.ps1");

  assert.match(backup, /docker exec \$mysqlContainerId sh -c \$dumpCommand/);
  assert.doesNotMatch(backup, /\$dumpCommand\s*\|\s*docker/);
});

test("disposable proof runner fences ownership and forbids broad cleanup", () => {
  const runner = read("scripts/production/disposable-proof.ps1");
  const backup = read("scripts/production/backup.ps1");

  assert.match(runner, /EASYFIRE_PROOF_ID/);
  assert.match(runner, /easyfire\.proof\.id/);
  assert.match(runner, /Assert-ProjectResourcesOwnedByProof/);
  assert.match(runner, /Remove-ExactProofResources/);
  assert.match(runner, /ConvertFrom-Json/);
  assert.match(runner, /PSObject\.Properties\[['"]easyfire\.proof\.id['"]\]/);
  assert.doesNotMatch(runner, /index \.Config\.Labels "easyfire\.proof\.id"/);
  assert.match(runner, /Invoke-DockerLogged @\('volume', 'rm', \$volumeName\)/);
  assert.match(runner, /& docker @composeArgs down/);
  assert.doesNotMatch(runner, /@composeArgs down[^\r\n]*-v/);
  assert.doesNotMatch(runner, /@composeArgs down[^\r\n]*--remove-orphans/);
  assert.match(runner, /restore-verify\.ps1[\s\S]*-ExpectedProofId/);
  assert.match(runner, /easyfire-bookkeeping\/e2e:/);
  assert.match(runner, /easyfire-bookkeeping\.e2e-spec\.ts/);
  assert.match(runner, /EASYFIRE_BUILT_SERVER_AUTH_OK/);
  assert.match(runner, /builtServerAuthPassed/);
  assert.match(runner, /forged weak-secret token was accepted/i);
  assert.match(runner, /correct-secret HS256 token was accepted/i);
  assert.match(runner, /-DisposableProof/);
  assert.match(runner, /-ProofId \$proofId/);
  assert.match(runner, /-BackupOperationId \$backupOperationId/);
  assert.match(runner, /expectedMetadataFile/);
  assert.match(
    runner,
    /\[Environment\]::GetFolderPath\(\[Environment\+SpecialFolder\]::System\)/,
  );
  assert.match(runner, /WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(runner, /EXCHANGE_RATE_SERVICE=\r?\n/);
  assert.doesNotMatch(runner, /EXCHANGE_RATE_SERVICE=open-exchange-rate/);
  assert.match(backup, /\[switch\]\$DisposableProof/);
  assert.match(
    backup,
    /Disposable proof AuthorityRoot must be under the local temporary directory/,
  );
  assert.match(backup, /Disposable proof cannot target the production project/);
  assert.doesNotMatch(
    runner,
    /docker\s+(?:system|container|image|volume|network)\s+prune/i,
  );
  assert.doesNotMatch(runner, /docker rm[^\r\n]*\*/i);
  assert.doesNotMatch(runner, /docker rmi[^\r\n]*\*/i);
});

test("backup metadata is exact on publication and reuse", () => {
  const backup = read("scripts/production/backup.ps1");

  assert.match(backup, /SchemaVersion = 1/);
  assert.match(backup, /ActionId =/);
  assert.match(backup, /ProofId =/);
  assert.match(backup, /InvocationRole =/);
  assert.match(backup, /BackupOperationId =/);
  assert.match(backup, /BackupMode =/);
  assert.match(backup, /DurableVolumeFingerprint =/);
  assert.match(backup, /BackupFile =/);
  assert.match(backup, /BackupSha256 =/);
  assert.match(backup, /partialMetadataFile/);
  assert.match(
    backup,
    /Move-Item -LiteralPath \$partialMetadataFile -Destination \$metadataFile/,
  );
  assert.match(backup, /Test-EasyFireBackupMetadataExact/);
  assert.match(
    backup,
    /metadata no longer matches this exact backup authority/i,
  );
});

test("backup publication has deterministic operation authority and resumable rename boundaries", () => {
  const backup = read("scripts/production/backup.ps1");

  assert.match(backup, /New-EasyFirePublicationPlanDocument/);
  assert.match(backup, /Test-EasyFirePublicationPlanExact/);
  assert.match(backup, /Reset-EasyFirePlannedPublication/);
  assert.match(backup, /Complete-EasyFirePreparedPublication/);
  assert.match(backup, /-State 'prepared'/);
  assert.match(backup, /PreparedBackupSha256/);
  assert.match(backup, /\.publication\.json/);
  assert.match(backup, /\.publication\.planned\.json/);
  assert.match(backup, /\.operation-\$BackupOperationId\.partial/);
  assert.doesNotMatch(backup, /partial-\$localAttemptId/);
});

test("PowerShell 5.1 resumes every authorized backup publication boundary", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "easyfire-publication-boundaries-"),
  );
  const harnessPath = join(fixtureRoot, "publication-boundaries.ps1");
  const harness = String.raw`
param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$FixtureRoot
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $RepoRoot 'scripts\production\backup-integrity.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $RepoRoot 'deploy\windows\production-state.psm1') -Force -ErrorAction Stop

$backupScript = Join-Path $RepoRoot 'scripts\production\backup.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($backupScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'backup.ps1 did not parse in Windows PowerShell 5.1.' }
$functionNames = @(
    'Get-EasyFireBackupProperty',
    'ConvertTo-EasyFireCanonicalBackupOperationId',
    'Get-EasyFireBackupMetadataPath',
    'New-EasyFireBackupMetadataDocument',
    'Test-EasyFireBackupMetadataBinding',
    'Test-EasyFireBackupMetadataExact',
    'New-EasyFirePublicationPlanDocument',
    'Test-EasyFirePublicationPlanExact',
    'Reset-EasyFirePlannedPublication',
    'Complete-EasyFirePreparedPublication'
)
$definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true))
foreach ($name in $functionNames) {
    $definition = @($definitions | Where-Object { $_.Name -ceq $name })
    if ($definition.Count -ne 1) { throw "Expected exactly one function definition for $name." }
    Invoke-Expression $definition[0].Extent.Text
}

function Assert-Condition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Write-TestGzip {
    param([string]$Path, [string]$Text)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    $file = [IO.File]::Create($Path)
    $gzip = $null
    try {
        $gzip = New-Object IO.Compression.GZipStream($file, [IO.Compression.CompressionMode]::Compress, $false)
        $gzip.Write($bytes, 0, $bytes.Length)
    } finally {
        if ($gzip) { $gzip.Dispose() }
        $file.Dispose()
    }
}

$operationId = '11111111-1111-4111-8111-111111111111'
$proofId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$sourceAuthority = [pscustomobject]@{
    MysqlContainerId = ('a' * 64)
    MysqlContainerName = 'easyfire-proof-mysql-1'
    MysqlImageReference = 'mariadb:11.8.6'
    MysqlImageId = ('sha256:' + ('b' * 64))
    MysqlVolumeName = 'easyfire-proof-volume'
    MysqlVolumeDestination = '/var/lib/mysql'
}

function New-BoundaryFixture {
    param([string]$Name)
    $directory = Join-Path $FixtureRoot $Name
    New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
    $stem = "mysql-efbk-proof-boundary-full-$operationId"
    $backup = Join-Path $directory "$stem.sql.gz"
    $sidecar = Join-Path $directory "$stem.sha256"
    $metadata = Join-Path $directory "$stem.metadata.json"
    $partialBackup = "$backup.operation-$operationId.partial"
    $partialSidecar = "$sidecar.operation-$operationId.partial"
    $partialMetadata = "$metadata.operation-$operationId.partial"
    $publication = "$backup.publication.json"
    $plannedPublication = "$backup.publication.planned.json"
    Write-TestGzip -Path $partialBackup -Text "boundary=$Name"
    $hash = Get-EasyFireSha256Hex -Path $partialBackup
    Set-Content -LiteralPath $partialSidecar -Value "$hash  $([IO.Path]::GetFileName($backup))" -Encoding ascii
    $metadataArguments = @{
        Pair = [pscustomobject]@{ BackupFile = $backup; Sha256 = $hash }
        OperationId = $operationId
        Mode = 'full'
        Role = 'DisposableProof'
        ExactProofId = $proofId
        SourceAuthority = $sourceAuthority
    }
    $metadataDocument = New-EasyFireBackupMetadataDocument @metadataArguments
    Write-Utf8NoBom -Path $partialMetadata -Text (($metadataDocument | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
    $planArguments = @{
        State = 'prepared'
        PreparedBackupSha256 = $hash
        OperationId = $operationId
        Mode = 'full'
        Role = 'DisposableProof'
        ExactProofId = $proofId
        SourceAuthority = $sourceAuthority
        BackupFile = $backup
        SidecarFile = $sidecar
        MetadataFile = $metadata
        PartialBackupFile = $partialBackup
        PartialSidecarFile = $partialSidecar
        PartialMetadataFile = $partialMetadata
    }
    $plan = New-EasyFirePublicationPlanDocument @planArguments
    $plannedPlanArguments = $planArguments.Clone()
    $plannedPlanArguments.State = 'planned'
    $plannedPlanArguments.Remove('PreparedBackupSha256')
    $plannedPlan = New-EasyFirePublicationPlanDocument @plannedPlanArguments
    Write-Utf8NoBom -Path $plannedPublication -Text (($plannedPlan | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
    Write-Utf8NoBom -Path $publication -Text (($plan | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
    Set-Content -LiteralPath (Join-Path $directory 'unrelated.keep') -Value 'untouched' -Encoding ascii
    return [pscustomobject]@{
        Directory = $directory
        Backup = $backup
        Sidecar = $sidecar
        Metadata = $metadata
        PartialBackup = $partialBackup
        PartialSidecar = $partialSidecar
        PartialMetadata = $partialMetadata
        Publication = $publication
        PlannedPublication = $plannedPublication
        Hash = $hash
        MetadataDocument = $metadataDocument
        Plan = $plan
        PlannedPlan = $plannedPlan
        PlanArguments = $planArguments
    }
}

$boundaryEvidence = @()
for ($boundary = 0; $boundary -le 3; $boundary++) {
    $fixture = New-BoundaryFixture -Name "boundary-$boundary"
    if ($boundary -ge 1) { Move-Item -LiteralPath $fixture.PartialBackup -Destination $fixture.Backup }
    if ($boundary -ge 2) { Move-Item -LiteralPath $fixture.PartialSidecar -Destination $fixture.Sidecar }
    if ($boundary -ge 3) { Move-Item -LiteralPath $fixture.PartialMetadata -Destination $fixture.Metadata }
    $completed = Complete-EasyFirePreparedPublication -PublicationFile $fixture.Publication -ExpectedPlan $fixture.Plan -PlannedPublicationFile $fixture.PlannedPublication -ExpectedPlannedPlan $fixture.PlannedPlan -ExpectedMetadata $fixture.MetadataDocument -ExactBackupRoot $fixture.Directory
    Assert-Condition $completed.Pair.Valid "Boundary $boundary did not produce a verified pair."
    Assert-Condition $completed.Metadata.Valid "Boundary $boundary did not produce verified metadata."
    Assert-Condition (-not (Test-Path -LiteralPath $fixture.Publication)) "Boundary $boundary retained publication authority after verification."
    Assert-Condition (-not (Test-Path -LiteralPath $fixture.PlannedPublication)) "Boundary $boundary retained planned authority after verification."
    foreach ($partial in @($fixture.PartialBackup, $fixture.PartialSidecar, $fixture.PartialMetadata)) {
        Assert-Condition (-not (Test-Path -LiteralPath $partial)) "Boundary $boundary retained a partial artifact."
    }
    Assert-Condition ((Get-Content -LiteralPath (Join-Path $fixture.Directory 'unrelated.keep') -Raw).Trim() -ceq 'untouched') "Boundary $boundary changed an unrelated file."
    Assert-Condition (@(Get-ChildItem -LiteralPath $fixture.Directory -Filter '*.sql.gz' -File).Count -eq 1) "Boundary $boundary did not produce exactly one dump."
    Assert-Condition (@(Get-ChildItem -LiteralPath $fixture.Directory -Filter '*.sha256' -File).Count -eq 1) "Boundary $boundary did not produce exactly one sidecar."
    Assert-Condition (@(Get-ChildItem -LiteralPath $fixture.Directory -Filter '*.metadata.json' -File).Count -eq 1) "Boundary $boundary did not produce exactly one metadata file."
    $boundaryEvidence += [pscustomobject]@{ Boundary = $boundary; Pair = $completed.Pair.Valid; Metadata = $completed.Metadata.Valid }
}

$planned = New-BoundaryFixture -Name 'planned-reset'
Remove-Item -LiteralPath $planned.Publication -Force
Reset-EasyFirePlannedPublication -PublicationFile $planned.PlannedPublication -ExpectedPlan $planned.PlannedPlan -ExactBackupRoot $planned.Directory
Assert-Condition (Test-Path -LiteralPath $planned.PlannedPublication -PathType Leaf) 'Planned reset removed its authority record.'
foreach ($partial in @($planned.PartialBackup, $planned.PartialSidecar, $planned.PartialMetadata)) {
    Assert-Condition (-not (Test-Path -LiteralPath $partial)) 'Planned reset retained an exact operation partial.'
}
Assert-Condition ((Get-Content -LiteralPath (Join-Path $planned.Directory 'unrelated.keep') -Raw).Trim() -ceq 'untouched') 'Planned reset changed an unrelated file.'

$foreign = New-BoundaryFixture -Name 'foreign-sidecar'
Set-Content -LiteralPath $foreign.PartialSidecar -Value "$('F' * 64)  $([IO.Path]::GetFileName($foreign.Backup))" -Encoding ascii
$refused = $false
try {
    $null = Complete-EasyFirePreparedPublication -PublicationFile $foreign.Publication -ExpectedPlan $foreign.Plan -PlannedPublicationFile $foreign.PlannedPublication -ExpectedPlannedPlan $foreign.PlannedPlan -ExpectedMetadata $foreign.MetadataDocument -ExactBackupRoot $foreign.Directory
} catch {
    $refused = $_.Exception.Message -match 'sidecar does not exactly bind'
}
Assert-Condition $refused 'Prepared recovery did not refuse foreign sidecar bytes.'
Assert-Condition (Test-Path -LiteralPath $foreign.Publication -PathType Leaf) 'Foreign refusal removed publication authority.'
foreach ($partial in @($foreign.PartialBackup, $foreign.PartialSidecar, $foreign.PartialMetadata)) {
    Assert-Condition (Test-Path -LiteralPath $partial -PathType Leaf) 'Foreign refusal moved or deleted an artifact.'
}
Assert-Condition ((Get-Content -LiteralPath (Join-Path $foreign.Directory 'unrelated.keep') -Raw).Trim() -ceq 'untouched') 'Foreign refusal changed an unrelated file.'

$authorityCloseout = New-BoundaryFixture -Name 'authority-closeout'
Move-Item -LiteralPath $authorityCloseout.PartialBackup -Destination $authorityCloseout.Backup
Move-Item -LiteralPath $authorityCloseout.PartialSidecar -Destination $authorityCloseout.Sidecar
Move-Item -LiteralPath $authorityCloseout.PartialMetadata -Destination $authorityCloseout.Metadata
Remove-Item -LiteralPath $authorityCloseout.PlannedPublication -Force
$closeoutResult = Complete-EasyFirePreparedPublication -PublicationFile $authorityCloseout.Publication -ExpectedPlan $authorityCloseout.Plan -PlannedPublicationFile $authorityCloseout.PlannedPublication -ExpectedPlannedPlan $authorityCloseout.PlannedPlan -ExpectedMetadata $authorityCloseout.MetadataDocument -ExactBackupRoot $authorityCloseout.Directory
Assert-Condition $closeoutResult.Pair.Valid 'Prepared authority could not resume after planned-authority deletion.'
Assert-Condition (-not (Test-Path -LiteralPath $authorityCloseout.Publication)) 'Prepared authority remained after closeout recovery.'

[pscustomobject]@{
    PowerShellVersion = $PSVersionTable.PSVersion.ToString()
    Boundaries = $boundaryEvidence
    PlannedReset = $true
    ForeignArtifactRefused = $refused
    AuthorityCloseoutResumed = $closeoutResult.Pair.Valid
} | ConvertTo-Json -Depth 8 -Compress
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
        "-RepoRoot",
        root,
        "-FixtureRoot",
        fixtureRoot,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = JSON.parse(result.stdout.trim());
    assert.match(evidence.PowerShellVersion, /^5\.1\./);
    assert.deepEqual(
      evidence.Boundaries.map(({ Boundary, Pair, Metadata }) => ({
        Boundary,
        Pair,
        Metadata,
      })),
      [0, 1, 2, 3].map((Boundary) => ({
        Boundary,
        Pair: true,
        Metadata: true,
      })),
    );
    assert.equal(evidence.PlannedReset, true);
    assert.equal(evidence.ForeignArtifactRefused, true);
    assert.equal(evidence.AuthorityCloseoutResumed, true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("bookkeeping E2E refuses non-disposable databases", () => {
  const e2e = read("packages/server/test/easyfire-bookkeeping.e2e-spec.ts");

  assert.match(e2e, /EASYFIRE_DISPOSABLE_DB/);
  assert.match(e2e, /EASYFIRE_PROOF_ID/);
  assert.match(e2e, /\.post\('\/manual-journals'\)/);
  assert.match(e2e, /\.delete\(`\/manual-journals\/\$\{journalId\}`\)/);
});

test("Docker context includes only the proof E2E harness from server tests", () => {
  const dockerIgnore = read(".dockerignore");

  assert.match(dockerIgnore, /!packages\/server\/test\/$/m);
  assert.match(dockerIgnore, /^packages\/server\/test\/\*$/m);
  assert.match(dockerIgnore, /!packages\/server\/test\/jest-e2e\.json$/m);
  assert.match(
    dockerIgnore,
    /!packages\/server\/test\/easyfire-bookkeeping\.e2e-spec\.ts$/m,
  );
});
