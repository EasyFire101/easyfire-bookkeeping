# EasyFire Bookkeeping -- deterministic no-deploy validation
#
# This validator performs static inspection, PowerShell parsing, a Docker
# Compose render, and the local relative-import case checker. It does not start
# containers, mutate Docker resources, call external APIs, manage Windows
# services/tasks, or write production state.

param(
    [string]$ComposeFile = "$PSScriptRoot\..\..\docker-compose.prod.yml",
    [string]$EnvExampleFile = "$PSScriptRoot\..\..\.env.production.example",
    [string]$EnvFile = "$PSScriptRoot\..\..\.env"
)

$ErrorActionPreference = 'Stop'
$allPassed = $true
$checksRun = 0
$checksPassed = 0
$rootDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

function Write-CheckResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Passed,
        [string]$Detail = ''
    )

    $script:checksRun++
    if ($Passed) {
        $script:checksPassed++
        Write-Host "  [PASS] $Name" -ForegroundColor Green
    } else {
        $script:allPassed = $false
        Write-Host "  [FAIL] $Name" -ForegroundColor Red
        if ($Detail) { Write-Host "         $Detail" -ForegroundColor DarkYellow }
    }
}

function Get-Text {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    return Get-Content -LiteralPath $Path -Raw
}

function Test-PowerShellParse {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null
    return @($errors).Count -eq 0
}

function Get-PowerShellCommandNames {
    param([Parameter(Mandatory = $true)][string]$Content)
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Content, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { return @('__PARSE_ERROR__') }
    return @(
        $ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.CommandAst]
        }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Sort-Object -Unique
    )
}

Write-Host '==================================================' -ForegroundColor Cyan
Write-Host ' EasyFire Bookkeeping -- No-Deploy Validation' -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

Write-Host ''
Write-Host '[1] License and source foundation' -ForegroundColor Yellow
$licensePath = Join-Path $rootDir 'LICENSE'
$licenseContent = Get-Text -Path $licensePath
Write-CheckResult -Name 'LICENSE is present' -Passed (Test-Path -LiteralPath $licensePath -PathType Leaf)
Write-CheckResult -Name 'LICENSE is unmodified AGPL-3.0 text' -Passed (
    $licenseContent.Length -ge 25000 -and
    $licenseContent -match 'GNU AFFERO GENERAL PUBLIC LICENSE' -and
    $licenseContent -match 'Version 3'
)
Write-CheckResult -Name 'AGPL compliance document is present' -Passed (
    Test-Path -LiteralPath (Join-Path $rootDir 'docs\easyfire\AGPL_COMPLIANCE.md') -PathType Leaf
)

Write-Host ''
Write-Host '[2] Production Compose and environment contract' -ForegroundColor Yellow
$composeContent = Get-Text -Path $ComposeFile
$envExampleContent = Get-Text -Path $EnvExampleFile
Write-CheckResult -Name 'docker-compose.prod.yml is present' -Passed ($composeContent.Length -gt 0)
Write-CheckResult -Name 'all seven production services are defined' -Passed (
    @('envoy','webapp','server','database_migration','mysql','redis','gotenberg').Where({
        $composeContent -match "(?m)^  $($_):\s*$"
    }).Count -eq 7
)
Write-CheckResult -Name 'custom application images require an immutable IMAGE_TAG' -Passed (
    ([regex]::Matches($composeContent, '\$\{IMAGE_TAG:\?IMAGE_TAG must be an immutable release tag\}')).Count -ge 4
)
Write-CheckResult -Name 'MariaDB image requires a separately immutable MARIADB_IMAGE_TAG' -Passed (
    $composeContent -match '\$\{MARIADB_IMAGE_TAG:\?MARIADB_IMAGE_TAG must be an immutable database release tag\}'
)
Write-CheckResult -Name 'no custom image has a latest fallback' -Passed (
    $composeContent -notmatch 'IMAGE_TAG:-latest|MARIADB_IMAGE_TAG:-latest|easyfire-bookkeeping/.+:latest'
)
Write-CheckResult -Name 'Envoy and Gotenberg images are digest-pinned' -Passed (
    $composeContent -match 'envoyproxy/envoy:v1\.30\.11@sha256:[a-f0-9]{64}' -and
    $composeContent -match 'gotenberg/gotenberg:7\.10\.2@sha256:[a-f0-9]{64}'
)
Write-CheckResult -Name 'public listener is loopback-only' -Passed (
    $composeContent -match '127\.0\.0\.1:\$\{PUBLIC_PROXY_PORT:-80\}:80'
)
Write-CheckResult -Name 'runtime signup lock and canonical JWT secret are required' -Passed (
    $composeContent -match 'SIGNUP_DISABLED=\$\{SIGNUP_DISABLED:\?SIGNUP_DISABLED must be configured\}' -and
    $composeContent -match 'APP_JWT_SECRET=\$\{APP_JWT_SECRET:\?APP_JWT_SECRET must be configured\}'
)
Write-CheckResult -Name 'durable volume identities are explicit runtime inputs' -Passed (
    $composeContent -match 'name:\s*\$\{MARIADB_VOLUME_NAME:\?MARIADB_VOLUME_NAME must identify the durable database volume\}' -and
    $composeContent -match 'name:\s*\$\{REDIS_VOLUME_NAME:\?REDIS_VOLUME_NAME must identify the durable Redis volume\}'
)
Write-CheckResult -Name 'MariaDB automatic in-place upgrade is not enabled' -Passed (
    $composeContent -notmatch 'MARIADB_AUTO_UPGRADE'
)
Write-CheckResult -Name 'health checks cover the long-running production services' -Passed (
    ([regex]::Matches($composeContent, '(?m)^\s+healthcheck:\s*$')).Count -ge 5
)
Write-CheckResult -Name '.env.production.example is present' -Passed ($envExampleContent.Length -gt 0)
Write-CheckResult -Name 'environment example locks signup and leaves allowlists empty' -Passed (
    $envExampleContent -match '(?m)^SIGNUP_DISABLED=true\s*$' -and
    $envExampleContent -match '(?m)^SIGNUP_ALLOWED_DOMAINS=\s*$' -and
    $envExampleContent -match '(?m)^SIGNUP_ALLOWED_EMAILS=\s*$'
)
Write-CheckResult -Name 'environment example exposes action-derived volume placeholders' -Passed (
    $envExampleContent -match '(?m)^MARIADB_VOLUME_NAME=easyfire_prod_mysql_REPLACE_WITH_ACTION_SUFFIX\s*$' -and
    $envExampleContent -match '(?m)^REDIS_VOLUME_NAME=easyfire_prod_redis_REPLACE_WITH_ACTION_SUFFIX\s*$'
)
Write-CheckResult -Name 'environment example contains placeholders rather than live secrets' -Passed (
    $envExampleContent -match '(?m)^APP_JWT_SECRET=PLACEHOLDER_' -and
    $envExampleContent -notmatch '(?m)^(APP_JWT_SECRET|DB_PASSWORD|DB_ROOT_PASSWORD|MAIL_PASSWORD)=\S{64,}\s*$'
)

$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
Write-CheckResult -Name 'Docker CLI is available for read-only Compose rendering' -Passed $dockerAvailable
if ($dockerAvailable -and $composeContent -and $envExampleContent) {
    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $renderOutput = & docker compose -f $ComposeFile -p easyfire-bookkeeping-prod --env-file $EnvExampleFile config 2>&1
        $renderExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    $renderText = @($renderOutput) -join "`n"
    $renderDetail = if ($renderExit -eq 0) { '' } else { (@($renderOutput) | Select-Object -First 3) -join '; ' }
    Write-CheckResult -Name 'docker compose config renders without mutation' -Passed ($renderExit -eq 0) -Detail $renderDetail
    Write-CheckResult -Name 'rendered Compose retains the production project services' -Passed (
        $renderExit -eq 0 -and $renderText -match '(?m)^  mysql:' -and $renderText -match '(?m)^  server:'
    )
}

Write-Host ''
Write-Host '[3] Runtime and build pins' -ForegroundColor Yellow
$packageJson = Get-Text -Path (Join-Path $rootDir 'package.json') | ConvertFrom-Json
Write-CheckResult -Name 'pnpm is pinned to 10.34.5' -Passed ($packageJson.packageManager -eq 'pnpm@10.34.5')
Write-CheckResult -Name 'Node engine is constrained to supported Node 22' -Passed ($packageJson.engines.node -eq '>=22.0.0 <23')
Write-CheckResult -Name '.nvmrc pins Node 22.23.1' -Passed (
    (Get-Text -Path (Join-Path $rootDir '.nvmrc')).Trim() -eq '22.23.1'
)
$dockerfileChecks = @(
    @{ Path = 'packages\server\Dockerfile'; Pattern = 'node:22\.23\.1-alpine3\.23@sha256:' },
    @{ Path = 'packages\webapp\Dockerfile'; Pattern = 'node:22\.23\.1-alpine3\.23@sha256:' },
    @{ Path = 'docker\migration\Dockerfile'; Pattern = 'node:22\.23\.1-alpine3\.23@sha256:' },
    @{ Path = 'docker\mariadb\Dockerfile'; Pattern = 'mariadb:11\.8\.6@sha256:' },
    @{ Path = 'docker\redis\Dockerfile'; Pattern = 'redis:7\.4\.9-alpine3\.21@sha256:' }
)
foreach ($check in $dockerfileChecks) {
    $content = Get-Text -Path (Join-Path $rootDir $check.Path)
    Write-CheckResult -Name "$($check.Path) uses the expected digest-pinned base" -Passed (
        $content -match $check.Pattern
    )
}

Write-Host ''
Write-Host '[4] PowerShell parser verification' -ForegroundColor Yellow
$powerShellPaths = @(
    'scripts\production\backup-integrity.psm1',
    'scripts\production\backup.ps1',
    'scripts\production\restore.ps1',
    'scripts\production\restore-verify.ps1',
    'scripts\production\preflight.ps1',
    'scripts\production\postcheck.ps1',
    'scripts\production\rollback.ps1',
    'scripts\production\bootstrap-owner.ps1',
    'scripts\production\validate.ps1',
    'deploy\windows\production-state.psm1',
    'deploy\windows\production-io.psm1',
    'deploy\windows\production-action.ps1',
    'deploy\windows\start-stack.ps1',
    'deploy\windows\startup-commands.ps1'
)
foreach ($relativePath in $powerShellPaths) {
    $path = Join-Path $rootDir $relativePath
    Write-CheckResult -Name "$relativePath exists" -Passed (Test-Path -LiteralPath $path -PathType Leaf)
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Write-CheckResult -Name "$relativePath parses without syntax errors" -Passed (Test-PowerShellParse -Path $path)
    }
}

Write-Host ''
Write-Host '[5] Backup and restore integrity' -ForegroundColor Yellow
$integrityContent = Get-Text -Path (Join-Path $rootDir 'scripts\production\backup-integrity.psm1')
$backupContent = Get-Text -Path (Join-Path $rootDir 'scripts\production\backup.ps1')
$restoreContent = Get-Text -Path (Join-Path $rootDir 'scripts\production\restore.ps1')
$restoreVerifyContent = Get-Text -Path (Join-Path $rootDir 'scripts\production\restore-verify.ps1')
$standaloneRollbackContent = Get-Text -Path (Join-Path $rootDir 'scripts\production\rollback.ps1')
Write-CheckResult -Name 'backup-pair verifier requires exact sidecar name, hash, and full gzip read' -Passed (
    $integrityContent -match 'sidecar_filename_mismatch' -and
    $integrityContent -match 'hash_mismatch' -and
    $integrityContent -match 'gzip_invalid' -and
    $integrityContent -match 'while\s*\(\$gzipStream\.Read'
)
Write-CheckResult -Name 'backup publishes through partial files and validates before retention' -Passed (
    $backupContent -match '\.partial' -and
    $backupContent -match 'Test-EasyFireGzipIntegrity' -and
    $backupContent -match 'Test-EasyFireBackupPair' -and
    $backupContent -match 'Move-Item\s+-LiteralPath\s+\$partialCompressedFile' -and
    $backupContent -match 'Retention ignored unverified (?:artifact|recovery unit)'
)
Write-CheckResult -Name 'standalone restore is a non-mutating retired compatibility entry point' -Passed (
    $restoreContent -match 'retired standalone restore entry point' -and
    $restoreContent -match 'not an authorized production mutation path' -and
    $restoreContent -notmatch '(?im)^\s*(docker|Remove-Item|Move-Item|Register-ScheduledTask|Unregister-ScheduledTask|Invoke-RestMethod)\b' -and
    $restoreContent -notmatch 'Read-Host'
)
Write-CheckResult -Name 'restore verifier is isolated from networking and tracks exact disposable container ID' -Passed (
    $restoreVerifyContent -match '--network none' -and
    $restoreVerifyContent -match '\$createdContainerId' -and
    $restoreVerifyContent -match 'Test-EasyFireBackupPair' -and
    $restoreVerifyContent -notmatch 'docker ps -a --filter'
)
Write-CheckResult -Name 'standalone rollback is a non-mutating retired compatibility entry point' -Passed (
    $standaloneRollbackContent -match 'retired standalone rollback entry point' -and
    $standaloneRollbackContent -match 'not an authorized production mutation path' -and
    $standaloneRollbackContent -notmatch '(?im)^\s*(docker|Remove-Item|Register-ScheduledTask|Unregister-ScheduledTask|Invoke-RestMethod)\b'
)

Write-Host ''
Write-Host '[6] Fresh-install-only production controller' -ForegroundColor Yellow
$controllerPath = Join-Path $rootDir 'deploy\windows\production-action.ps1'
$stateModulePath = Join-Path $rootDir 'deploy\windows\production-state.psm1'
$ioModulePath = Join-Path $rootDir 'deploy\windows\production-io.psm1'
$controllerContent = Get-Text -Path $controllerPath
$stateContent = Get-Text -Path $stateModulePath
$ioContent = Get-Text -Path $ioModulePath
$controllerAndIo = $controllerContent + "`n" + $ioContent

Write-CheckResult -Name 'controller exposes only the four release stages plus authority-bound ScheduledBackup' -Passed (
    $controllerContent -match 'ValidateSet\(''Preflight'',\s*''Action'',\s*''Postcheck'',\s*''ScheduledBackup'',\s*''Rollback''\)'
)
Write-CheckResult -Name 'production project name is isolated from development' -Passed (
    $controllerContent -match '\$script:ProjectName\s*=\s*''easyfire-bookkeeping-prod''' -and
    $controllerContent -notmatch '\$script:ProjectName\s*=\s*''easyfire-bookkeeping'''
)
Write-CheckResult -Name 'controller is explicitly fresh-install-only' -Passed (
    $controllerContent -match 'DatabaseMode\s*=\s*''fresh''' -and
    $controllerContent -match 'DATABASE_ENGINE_MIGRATION_REQUIRED' -and
    $controllerContent -match 'PriorActionId'
)
Write-CheckResult -Name 'database decision module blocks every existing-volume upgrade' -Passed (
    $stateContent -match 'HasExistingVolume' -and
    $stateContent -match 'Allowed\s*=\s*\$false;\s*Mode\s*=\s*''blocked'';\s*Reason\s*=\s*''DATABASE_ENGINE_MIGRATION_REQUIRED'''
)
Write-CheckResult -Name 'durable volumes are derived from the canonical ActionId' -Passed (
    $controllerContent -match 'easyfire_prod_mysql_\$suffix' -and
    $controllerContent -match 'easyfire_prod_redis_\$suffix' -and
    $controllerContent -match 'ActionId\.Replace'
)
Write-CheckResult -Name 'journal schema 2 and release-manifest authority are mandatory' -Passed (
    $controllerContent -match 'SchemaVersion\s*=\s*2' -and
    $stateContent -match 'Journal\.SchemaVersion\s*-ne\s*2' -and
    $controllerContent -match 'Write-EasyFireReleaseManifestAuthority' -and
    $stateContent -match 'release manifest document is not bound to the journal authority'
)
Write-CheckResult -Name 'release seal is revalidated before extracted scripts execute' -Passed (
    $controllerContent -match 'function Assert-EasyFireReleaseSeal' -and
    ([regex]::Matches($controllerContent, 'Assert-EasyFireReleaseSeal')).Count -ge 5 -and
    $ioContent -match 'Test-EasyFireReleaseManifest'
)
Write-CheckResult -Name 'journal writes use mutex plus compare-and-swap authority' -Passed (
    $controllerContent -match 'Threading\.Mutex' -and
    $controllerContent -match 'WaitOne\(0\)' -and
    $controllerContent -match 'Journal compare-and-swap authority changed; refusing overwrite' -and
    $controllerContent -match '\$script:JournalAuthorityHash'
)
Write-CheckResult -Name 'Preflight receipt binds authority and expires after 15 minutes' -Passed (
    $controllerContent -match 'ExpiresAtUtc\s*=\s*\$issued\.AddMinutes\(15\)' -and
    $controllerContent -match 'ControllerSha256' -and
    $controllerContent -match 'CredentialSha256' -and
    $controllerContent -match 'InventoryFingerprint'
)
Write-CheckResult -Name 'scheduled backup preserves the journal-bound deployment-owner SID' -Passed (
    $controllerContent -match '-AuthorityOwnerSid\s+"\{3\}"' -and
    $controllerContent -match 'ScheduledBackup requires the journal-bound AuthorityOwnerSid' -and
    $controllerContent -match 'AuthorityOwnerSid\s*=\s*\$script:AuthorityOwnerSid' -and
    $controllerContent -match 'AuthorityOwnerSid\s*=\s*\[string\]\$Receipt\.AuthorityOwnerSid' -and
    $controllerContent -match 'New-ScheduledTaskPrincipal\s+-UserId\s+''SYSTEM''' -and
    $controllerContent -match 'function Invoke-EasyFireScheduledBackupStage \{[\s\S]*?Assert-EasyFireAuthorityTree\s+-Path\s+\$script:BackupsRoot[\s\S]*?ScheduledBackupPlan' -and
    $controllerContent -match 'function Invoke-EasyFirePostcheckStage \{[\s\S]*?Assert-EasyFireAuthorityTree\s+-Path\s+\$script:BackupsRoot[\s\S]*?BaselineBackup' -and
    $controllerContent -match 'function Assert-EasyFireRollbackReadback \{[\s\S]*?Assert-EasyFireAuthorityTree\s+-Path\s+\$script:BackupsRoot[\s\S]*?EmergencyBackup' -and
    $controllerContent -notmatch 'function Get-EasyFireAllowedSids \{[\s\S]{0,600}WindowsIdentity\]::GetCurrent'
)
Write-CheckResult -Name 'approved inventory fingerprint is immutable through Postcheck' -Passed (
    $controllerContent -match 'ApprovedInventoryFingerprint' -and
    $controllerContent -match 'if \(\$fingerprint -cne \[string\]\$Journal\.ApprovedInventoryFingerprint\)' -and
    $ioContent -match 'container\|\$\(\$c\.Id\)' -and
    $ioContent -match '\$\(\$c\.ImageId\)'
)
Write-CheckResult -Name 'baseline and emergency backups both require isolated restore verification' -Passed (
    $controllerContent -match 'Get-EasyFireVerifiedBackupReceipt\s+-Journal\s+\$Journal\s+-Kind\s+''Baseline''' -and
    $controllerContent -match 'Get-EasyFireVerifiedBackupReceipt\s+-Journal\s+\$Journal\s+-Kind\s+''Emergency''' -and
    $controllerContent -match 'restore-verify\.ps1' -and
    $controllerContent -match 'NetworkMode\s*=\s*''none'''
)
Write-CheckResult -Name 'Postcheck enforces the production signup lock and empty allowlists' -Passed (
    $controllerContent -match 'function Assert-EasyFireRuntimeSignupLock' -and
    $controllerContent -match 'environment\.SIGNUP_DISABLED -cne ''true''' -and
    $controllerContent -match 'environment\.SIGNUP_ALLOWED_DOMAINS -cne ''''' -and
    $controllerContent -match 'environment\.SIGNUP_ALLOWED_EMAILS -cne '''''
)
Write-CheckResult -Name 'Rollback is journal-resumable and preserves exact durable volumes' -Passed (
    $controllerContent -match 'rollback_in_progress\s*=\s*@\(''rollback_in_progress'',\s*''rolled_back''\)' -and
    $controllerContent -match 'Assert-EasyFirePreservedPlannedVolumes' -and
    $controllerContent -match 'Assert-EasyFireRollbackReadback' -and
    $controllerContent -match 'ROLLBACK_PASSED_VOLUMES_PRESERVED'
)
Write-CheckResult -Name 'Rollback Compose teardown does not remove volumes' -Passed (
    $controllerContent -match 'Arguments\s+@\(''down''\)' -and
    $controllerContent -notmatch '(?is)Arguments\s+@\([^\)]*''down''[^\)]*(''-v''|''--volumes'')'
)

Write-Host ''
Write-Host '[7] Negative-capability boundaries' -ForegroundColor Yellow
$cloudflareWritePattern = '(?is)(?:\.Method\s*=|-Method\s+|HttpMethod\]\s*::)\s*[''"]?(POST|PUT|PATCH|DELETE)\b'
$serviceMutationPattern = '(?im)\b(New-Service|Remove-Service)\b|\bsc(?:\.exe)?\s+(create|delete)\b|cloudflared\s+service\s+(install|uninstall|delete)\b'
$releaseDeletionPattern = '(?im)\bRemove-Item\b|\[System\.IO\.Directory\]::Delete|\[IO\.Directory\]::Delete|\b(rmdir|rd)\s+'
$volumeRemovalPattern = '(?is)(?:docker|Invoke-EasyFireNative)[^\r\n]{0,250}\bvolume\b[^\r\n]{0,80}\brm\b|Arguments\s+@\([^\)]*''down''[^\)]*(''-v''|''--volumes'')'

Write-CheckResult -Name 'Cloudflare integration is GET-only (no POST/PUT/PATCH/DELETE)' -Passed (
    $ioContent -match '\$request\.Method\s*=\s*''GET''' -and
    $controllerAndIo -notmatch $cloudflareWritePattern
)
Write-CheckResult -Name 'controller cannot install or delete Windows services' -Passed (
    $controllerAndIo -notmatch $serviceMutationPattern
)
Write-CheckResult -Name 'controller cannot delete release directories' -Passed (
    $controllerAndIo -notmatch $releaseDeletionPattern
)
Write-CheckResult -Name 'controller cannot remove Docker volumes or use compose down -v' -Passed (
    $controllerAndIo -notmatch $volumeRemovalPattern
)
Write-CheckResult -Name 'controller contains no pre-migration backup architecture' -Passed (
    $controllerContent -notmatch '(?i)pre[- ]migration\s+backup'
)
Write-CheckResult -Name 'controller cannot create or sign in an owner account' -Passed (
    $controllerContent -notmatch '/api/auth/(signup|signin)|api\\auth\\(signup|signin)'
)

Write-Host ''
Write-Host '[8] Retired automated owner bootstrap' -ForegroundColor Yellow
$bootstrapContent = Get-Text -Path (Join-Path $rootDir 'scripts\production\bootstrap-owner.ps1')
$bootstrapCommands = @(Get-PowerShellCommandNames -Content $bootstrapContent)
$unexpectedBootstrapCommands = @($bootstrapCommands | Where-Object { $_ -ne 'Write-Host' })
Write-CheckResult -Name 'bootstrap owner entry point is explicitly retired and non-mutating' -Passed (
    $bootstrapContent -match 'retired automated owner bootstrap' -and
    $bootstrapContent -match 'intentionally non-mutating' -and
    $bootstrapContent -match 'automated production owner bootstrap is not authorized'
)
Write-CheckResult -Name 'bootstrap owner executes only status output before exiting nonzero' -Passed (
    $unexpectedBootstrapCommands.Count -eq 0 -and $bootstrapContent -match '(?m)^exit 1\s*$'
) -Detail ("Unexpected commands: " + ($unexpectedBootstrapCommands -join ', '))
Write-CheckResult -Name 'bootstrap owner has no API, Docker, database, task, or service command' -Passed (
    $bootstrapCommands -notcontains 'Invoke-RestMethod' -and
    $bootstrapCommands -notcontains 'Invoke-WebRequest' -and
    $bootstrapCommands -notcontains 'docker' -and
    $bootstrapCommands -notcontains 'Register-ScheduledTask' -and
    $bootstrapCommands -notcontains 'New-Service'
)
Write-CheckResult -Name 'bootstrap owner contains no active signup or organization-construction endpoint' -Passed (
    $bootstrapContent -notmatch '/api/auth/signup|organization/build|organization/construct'
)

Write-Host ''
Write-Host '[9] Envoy, documentation, and Git hygiene' -ForegroundColor Yellow
$envoyContent = Get-Text -Path (Join-Path $rootDir 'docker\envoy\envoy.yaml')
Write-CheckResult -Name 'Envoy listens on HTTP 80 and delegates TLS to the edge' -Passed (
    $envoyContent -match 'port_value:\s*80' -and
    $envoyContent -notmatch 'tls_context|downstream_tls'
)
Write-CheckResult -Name 'Envoy routes API to server and root traffic to webapp' -Passed (
    $envoyContent -match "prefix:\s*'/api'" -and
    $envoyContent -match 'cluster:\s*dynamic_server' -and
    $envoyContent -match 'cluster:\s*webapp'
)
foreach ($doc in @(
    'docs\easyfire\PRODUCTION_RUNBOOK.md',
    'docs\easyfire\DEPLOYMENT_DESIGN.md',
    'docs\easyfire\AGPL_COMPLIANCE.md',
    'docs\easyfire\AUTH_SECURITY.md',
    'docs\easyfire\CORE_WORKFLOW_SMOKE.md',
    'docs\easyfire\ACCOUNTING_SMOKE.md',
    'docs\easyfire\LOCAL_BOOT.md'
)) {
    Write-CheckResult -Name "$doc exists" -Passed (
        Test-Path -LiteralPath (Join-Path $rootDir $doc) -PathType Leaf
    )
}
$gitignoreContent = Get-Text -Path (Join-Path $rootDir '.gitignore')
Write-CheckResult -Name '.gitignore excludes runtime environment, backups, and journals' -Passed (
    $gitignoreContent -match '(?m)^\.env\s*$' -and
    $gitignoreContent -match '(?i)backups' -and
    $gitignoreContent -match '(?i)journals'
)
Write-CheckResult -Name 'Cloudflare credentials are not embedded in production Compose' -Passed (
    $composeContent -notmatch 'apiToken\s*[=:]\s*\S{10}|cloudflare\.com/client/v4'
)

Write-Host ''
Write-Host '[10] Relative import casing' -ForegroundColor Yellow
$checkerScript = Join-Path $rootDir 'scripts\production\check-relative-import-case.mjs'
$nodeAvailable = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
Write-CheckResult -Name 'relative-import case checker exists' -Passed (
    Test-Path -LiteralPath $checkerScript -PathType Leaf
)
Write-CheckResult -Name 'Node is available for the import-case checker' -Passed $nodeAvailable
if ($nodeAvailable -and (Test-Path -LiteralPath $checkerScript -PathType Leaf)) {
    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $checkerOutput = & node $checkerScript 2>&1
        $checkerExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedEap
    }
    $checkerDetail = if ($checkerExit -eq 0) { '' } else { (@($checkerOutput) | Select-Object -First 3) -join '; ' }
    Write-CheckResult -Name 'relative imports have Linux-safe casing' -Passed ($checkerExit -eq 0) -Detail $checkerDetail
}

Write-Host ''
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host " Validation Summary: $checksPassed / $checksRun passed" -ForegroundColor $(if ($allPassed) { 'Green' } else { 'Red' })
Write-Host '==================================================' -ForegroundColor Cyan

if ($allPassed) { exit 0 }
exit 1
