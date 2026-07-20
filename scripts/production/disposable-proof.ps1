# EasyFire Bookkeeping -- disposable local release proof
#
# Builds and exercises a uniquely labeled Compose project against synthetic
# data only. The runner refuses remote Docker endpoints and pre-existing proof
# resources. Teardown is restricted to the exact project, exact one-off E2E
# container, and exact unique image tags created by this invocation.

param(
    [string]$EvidenceRoot = (Join-Path $env:TEMP 'EasyFireBookkeepingProof')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$productionCompose = Join-Path $repoRoot 'docker-compose.prod.yml'
$proofCompose = Join-Path $repoRoot 'docker-compose.proof.yml'
$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
$restoreVerifyScript = Join-Path $PSScriptRoot 'restore-verify.ps1'
$serverDockerfile = Join-Path $repoRoot 'packages\server\Dockerfile'
$windowsPowerShell = [IO.Path]::GetFullPath((Join-Path `
            ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) `
            'WindowsPowerShell\v1.0\powershell.exe'))
if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf) -or
    ((Get-Item -LiteralPath $windowsPowerShell -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'The canonical Windows PowerShell executable is missing or unsafe.'
}

function Invoke-DockerCapture {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & docker @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "docker $($Arguments -join ' ') failed ($exitCode): $($output -join ' ')"
    }
    return @($output | ForEach-Object { $_.ToString() })
}

function Invoke-DockerLogged {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $exitCode"
    }
}

function Test-DockerImage {
    param([Parameter(Mandatory = $true)][string]$Reference)

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $null = & docker image inspect $Reference 2>$null
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
}

function Get-LabelledContainerIds {
    param([Parameter(Mandatory = $true)][string]$Label)
    return @(
        Invoke-DockerCapture @('ps', '-a', '--filter', "label=$Label", '--format', '{{.ID}}') |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
}

function Get-LabelledVolumeNames {
    param([Parameter(Mandatory = $true)][string]$Label)
    return @(
        Invoke-DockerCapture @('volume', 'ls', '--filter', "label=$Label", '--format', '{{.Name}}') |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
}

function Get-LabelledNetworkIds {
    param([Parameter(Mandatory = $true)][string]$Label)
    return @(
        Invoke-DockerCapture @('network', 'ls', '--filter', "label=$Label", '--format', '{{.ID}}') |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
}

function Get-ResourceProofId {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('container', 'volume', 'network')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Identity
    )

    $inspectJson = (Invoke-DockerCapture @($Kind, 'inspect', $Identity)) -join "`n"
    $resources = @($inspectJson | ConvertFrom-Json)
    if ($resources.Count -ne 1) {
        throw "Docker returned ambiguous inspection data for $Kind $Identity"
    }
    $labels = if ($Kind -eq 'container') { $resources[0].Config.Labels } else { $resources[0].Labels }
    if (-not $labels) { return '' }
    $property = $labels.PSObject.Properties['easyfire.proof.id']
    if (-not $property) { return '' }
    return [string]$property.Value
}

function Assert-ProjectResourcesOwnedByProof {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectName,
        [Parameter(Mandatory = $true)][string]$ProofId
    )

    $projectLabel = "com.docker.compose.project=$ProjectName"
    $resources = @(
        [pscustomobject]@{ Kind = 'container'; Values = @(Get-LabelledContainerIds $projectLabel) },
        [pscustomobject]@{ Kind = 'volume'; Values = @(Get-LabelledVolumeNames $projectLabel) },
        [pscustomobject]@{ Kind = 'network'; Values = @(Get-LabelledNetworkIds $projectLabel) }
    )
    foreach ($group in $resources) {
        foreach ($identity in @($group.Values)) {
            if ((Get-ResourceProofId -Kind $group.Kind -Identity $identity) -cne $ProofId) {
                throw "Refusing project teardown: $($group.Kind) $identity is not owned by proof $ProofId"
            }
        }
    }
}

function Remove-ExactProofResources {
    param(
        [Parameter(Mandatory = $true)][string]$ProofLabel,
        [Parameter(Mandatory = $true)][string]$ProofId
    )

    foreach ($containerId in @(Get-LabelledContainerIds $ProofLabel)) {
        if ((Get-ResourceProofId -Kind 'container' -Identity $containerId) -cne $ProofId) {
            throw "Refusing to remove container without exact proof ownership: $containerId"
        }
        Invoke-DockerLogged @('container', 'rm', '-f', '-v', $containerId)
    }
    foreach ($volumeName in @(Get-LabelledVolumeNames $ProofLabel)) {
        if ((Get-ResourceProofId -Kind 'volume' -Identity $volumeName) -cne $ProofId) {
            throw "Refusing to remove volume without exact proof ownership: $volumeName"
        }
        Invoke-DockerLogged @('volume', 'rm', $volumeName)
    }
    foreach ($networkId in @(Get-LabelledNetworkIds $ProofLabel)) {
        if ((Get-ResourceProofId -Kind 'network' -Identity $networkId) -cne $ProofId) {
            throw "Refusing to remove network without exact proof ownership: $networkId"
        }
        Invoke-DockerLogged @('network', 'rm', $networkId)
    }
}

function Get-ProductionSnapshot {
    $label = 'com.docker.compose.project=easyfire-bookkeeping-prod'
    return [ordered]@{
        containers = @(Get-LabelledContainerIds $label)
        volumes = @(Get-LabelledVolumeNames $label)
        networks = @(Get-LabelledNetworkIds $label)
    }
}

function Assert-SameSnapshot {
    param(
        [Parameter(Mandatory = $true)]$Before,
        [Parameter(Mandatory = $true)]$After
    )

    foreach ($kind in @('containers', 'volumes', 'networks')) {
        $difference = @(Compare-Object @($Before[$kind]) @($After[$kind]))
        if ($difference.Count -gt 0) {
            throw "Production $kind changed during disposable proof"
        }
    }
}

function New-RandomHex {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    } finally {
        $generator.Dispose()
    }
    return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )
    $text = if ($Value -is [array]) { $Value -join "`r`n" } else { [string]$Value }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $text, $encoding)
}

$dockerContext = (Invoke-DockerCapture @('context', 'show') | Select-Object -Last 1).Trim()
$contextJson = (Invoke-DockerCapture @('context', 'inspect', $dockerContext)) -join "`n"
$contextObject = $contextJson | ConvertFrom-Json
$dockerEndpoint = [string]$contextObject.Endpoints.docker.Host
if ($dockerEndpoint -notmatch '^npipe://') {
    throw "Disposable proof requires a local Windows Docker pipe; current endpoint is '$dockerEndpoint'"
}
Invoke-DockerCapture @('info', '--format', '{{.ServerVersion}}') | Out-Null
Invoke-DockerCapture @('compose', 'version', '--short') | Out-Null

$proofId = [Guid]::NewGuid().ToString('N')
$backupOperationId = [Guid]::NewGuid().ToString('D')
$shortProofId = $proofId.Substring(0, 12)
$projectName = "efbk-proof-$shortProofId"
$imageTag = "proof-$proofId"
$proofLabel = "easyfire.proof.id=$proofId"
$proofRoot = Join-Path $EvidenceRoot $proofId
$envFile = Join-Path $proofRoot 'proof.env'
$resolvedCompose = Join-Path $proofRoot 'resolved-compose.yml'
$backupDir = Join-Path $proofRoot 'backups'
$beforeEvidence = Join-Path $proofRoot 'production-before.json'
$afterEvidence = Join-Path $proofRoot 'production-after.json'
$resultEvidence = Join-Path $proofRoot 'result.json'
$e2eContainerName = "efbk-e2e-$proofId"
$e2eContainerId = $null
$builtServerAuthPassed = $false
$proofPassed = $false
$cleanupPassed = $true
$failureMessage = $null

$imageReferences = @(
    "easyfire-bookkeeping/webapp:$imageTag",
    "easyfire-bookkeeping/server:$imageTag",
    "easyfire-bookkeeping/migration:$imageTag",
    "easyfire-bookkeeping/mariadb:$imageTag",
    "easyfire-bookkeeping/redis:$imageTag",
    "easyfire-bookkeeping/e2e:$imageTag"
)
$e2eImage = "easyfire-bookkeeping/e2e:$imageTag"

if (Test-Path -LiteralPath $proofRoot) {
    throw "Proof root already exists: $proofRoot"
}
if ((Get-LabelledContainerIds $proofLabel).Count -gt 0 -or
    (Get-LabelledVolumeNames $proofLabel).Count -gt 0 -or
    (Get-LabelledNetworkIds $proofLabel).Count -gt 0) {
    throw "Resources already exist for proof ID $proofId"
}
$projectLabel = "com.docker.compose.project=$projectName"
if ((Get-LabelledContainerIds $projectLabel).Count -gt 0 -or
    (Get-LabelledVolumeNames $projectLabel).Count -gt 0 -or
    (Get-LabelledNetworkIds $projectLabel).Count -gt 0) {
    throw "Compose resources already exist for unique proof project $projectName"
}
foreach ($imageReference in $imageReferences) {
    if (Test-DockerImage $imageReference) {
        throw "Unique proof image unexpectedly already exists: $imageReference"
    }
}

$null = New-Item -ItemType Directory -Path $proofRoot
$null = New-Item -ItemType Directory -Path $backupDir

$dbPassword = New-RandomHex
$dbRootPassword = New-RandomHex
$jwtSecret = New-RandomHex -Bytes 48
$systemDbName = "efproof_system_$shortProofId"
$tenantPrefix = "efproof_tenant_${shortProofId}_"

$environment = @"
EASYFIRE_PROOF_ID=$proofId
IMAGE_TAG=$imageTag
MARIADB_IMAGE_TAG=$imageTag
MARIADB_VOLUME_NAME=easyfire-proof-$proofId-mysql
REDIS_VOLUME_NAME=easyfire-proof-$proofId-redis
BASE_URL=http://envoy
SIGNUP_DISABLED=true
SIGNUP_ALLOWED_DOMAINS=
SIGNUP_ALLOWED_EMAILS=
SIGNUP_EMAIL_CONFIRMATION=false
MAIL_HOST=127.0.0.1
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_PORT=2525
MAIL_SECURE=false
MAIL_FROM_NAME=EasyFire Disposable Proof
MAIL_FROM_ADDRESS=proof@example.invalid
DB_HOST=mysql
DB_USER=efproof_$shortProofId
DB_PASSWORD=$dbPassword
DB_ROOT_PASSWORD=$dbRootPassword
DB_CHARSET=utf8mb4
SYSTEM_DB_NAME=$systemDbName
TENANT_DB_NAME_PERFIX=$tenantPrefix
JWT_SECRET=$jwtSecret
APP_JWT_SECRET=$jwtSecret
PUBLIC_PROXY_PORT=0
REDIS_HOST=redis
REDIS_PORT=6379
QUEUE_HOST=redis
QUEUE_PORT=6379
GOTENBERG_URL=http://gotenberg:3000
GOTENBERG_DOCS_URL=http://server:3000/public/
EXCHANGE_RATE_SERVICE=
OPEN_EXCHANGE_RATE_APP_ID=
BANK_FEED_ENABLED=false
PLAID_ENV=sandbox
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_LINK_WEBHOOK=
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
HOSTED_ON_BIGCAPITAL_CLOUD=false
NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=false
NEW_RELIC_LOG=stdout
NEW_RELIC_AI_MONITORING_ENABLED=false
NEW_RELIC_CUSTOM_INSIGHTS_EVENTS_MAX_SAMPLES_STORED=0
NEW_RELIC_SPAN_EVENTS_MAX_SAMPLES_STORED=0
NEW_RELIC_LICENSE_KEY=
NEW_RELIC_APP_NAME=EasyFire Disposable Proof
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=http://127.0.0.1
S3_BUCKET=easyfire-proof
STRIPE_PAYMENT_SECRET_KEY=
STRIPE_PAYMENT_PUBLISHABLE_KEY=
STRIPE_PAYMENT_CLIENT_ID=
STRIPE_PAYMENT_WEBHOOKS_SECRET=
STRIPE_PAYMENT_REDIRECT_URL=http://example.invalid/proof
"@
Write-Utf8NoBom -Path $envFile -Value $environment

$productionBefore = Get-ProductionSnapshot
Write-Utf8NoBom -Path $beforeEvidence -Value ($productionBefore | ConvertTo-Json -Depth 4)

$renderArgs = @(
    'compose', '-f', $productionCompose, '-f', $proofCompose,
    '--env-file', $envFile, '-p', $projectName
)
$composeArgs = @('compose', '-f', $resolvedCompose, '--env-file', $envFile, '-p', $projectName)

Write-Host "EasyFire disposable proof: $proofId" -ForegroundColor Cyan
Write-Host "  Docker context: $dockerContext ($dockerEndpoint)"
Write-Host "  Project:        $projectName"
Write-Host "  Evidence:       $proofRoot"

try {
    Write-Host '[1/11] Rendering and checking isolated Compose configuration' -ForegroundColor Cyan
    $rendered = Invoke-DockerCapture ($renderArgs + @('config'))
    Write-Utf8NoBom -Path $resolvedCompose -Value $rendered
    $renderedText = $rendered -join "`n"
    if ($renderedText -match '(?m)^\s*container_name:' -or
        $renderedText -match '(?m)^\s*ports:' -or
        $renderedText -match '(?m)^\s*published:') {
        throw 'Resolved proof Compose contains a fixed container name or published port'
    }
    if ($renderedText -notmatch [regex]::Escape("${projectName}_mysql") -or
        $renderedText -notmatch [regex]::Escape("${projectName}_redis")) {
        throw 'Resolved proof Compose does not use project-scoped volumes'
    }
    if (($renderedText | Select-String -Pattern ([regex]::Escape($proofId)) -AllMatches).Matches.Count -lt 10) {
        throw 'Resolved proof Compose is missing proof-ID labels'
    }

    Write-Host '[2/11] Building six uniquely tagged proof images' -ForegroundColor Cyan
    $composeBuildServices = @('mysql', 'redis', 'database_migration', 'server', 'webapp')
    foreach ($service in $composeBuildServices) {
        Invoke-DockerLogged ($composeArgs + @('build', $service))
    }
    Invoke-DockerLogged @(
        'build', '--target', 'builder', '--file', $serverDockerfile,
        '--tag', $e2eImage, $repoRoot
    )
    Invoke-DockerLogged ($composeArgs + @('pull', 'envoy', 'gotenberg'))

    Write-Host '[3/11] Starting disposable MariaDB and Redis' -ForegroundColor Cyan
    Invoke-DockerLogged ($composeArgs + @('up', '-d', '--wait', 'mysql', 'redis'))

    Write-Host '[4/11] Running system and tenant migrations' -ForegroundColor Cyan
    Invoke-DockerLogged ($composeArgs + @('run', '--rm', '--no-deps', 'database_migration'))

    $networkIds = @(
        Invoke-DockerCapture @(
            'network', 'ls', '--filter', "label=com.docker.compose.project=$projectName",
            '--filter', 'label=com.docker.compose.network=bigcapital_network',
            '--format', '{{.ID}}'
        ) | Where-Object { $_ }
    )
    if ($networkIds.Count -ne 1) { throw 'Expected exactly one proof network' }
    $networkName = (
        Invoke-DockerCapture @('network', 'inspect', $networkIds[0], '--format', '{{.Name}}') |
            Select-Object -Last 1
    ).Trim()

    Write-Host '[5/11] Running self-contained synthetic bookkeeping E2E' -ForegroundColor Cyan
    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker run --rm `
            --name $e2eContainerName `
            --label "easyfire.proof.id=$proofId" `
            --label 'easyfire.proof.role=e2e' `
            --network $networkName `
            --env-file $envFile `
            -e 'NODE_ENV=test' `
            -e 'SIGNUP_DISABLED=false' `
            -e 'EASYFIRE_DISPOSABLE_DB=true' `
            $e2eImage `
            corepack pnpm --filter '@bigcapital/server' exec jest `
                --config ./test/jest-e2e.json `
                --testRegex '.*\.e2e-spec\.ts$' `
                --runTestsByPath test/easyfire-bookkeeping.e2e-spec.ts `
                --runInBand --forceExit
        $e2eExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($e2eExitCode -ne 0) { throw "Synthetic bookkeeping E2E failed ($e2eExitCode)" }

    Write-Host '[6/11] Starting the complete application stack' -ForegroundColor Cyan
    Invoke-DockerLogged ($composeArgs + @('up', '-d', '--wait', 'mysql', 'redis', 'server', 'webapp', 'gotenberg', 'envoy'))

    Write-Host '[7/11] Authenticating against the built production server and rejecting the legacy weak JWT' -ForegroundColor Cyan
    $builtServerAuthProbe = @'
const { createHmac } = require('node:crypto');

(async () => {
const proofId = process.argv[1];
const email = `easyfire-proof-${proofId}@example.invalid`;
const password = `Proof-${proofId}-Only!`;
const baseUrl = 'http://127.0.0.1:3000/api';

const signinResponse = await fetch(`${baseUrl}/auth/signin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (signinResponse.status !== 201) {
  throw new Error(`built server signin failed (${signinResponse.status})`);
}
const signin = await signinResponse.json();
if (!signin.access_token || !signin.organization_id) {
  throw new Error('built server signin response was incomplete');
}

const authHeaders = {
  authorization: `Bearer ${signin.access_token}`,
  'organization-id': String(signin.organization_id),
};
const authorizedResponse = await fetch(`${baseUrl}/accounts`, {
  headers: authHeaders,
});
if (!authorizedResponse.ok) {
  throw new Error(`built server rejected its configured JWT (${authorizedResponse.status})`);
}

const tokenParts = signin.access_token.split('.');
if (tokenParts.length !== 3) throw new Error('built server returned a malformed JWT');
const actualHeader = JSON.parse(Buffer.from(tokenParts[0], 'base64url').toString('utf8'));
if (actualHeader.alg !== 'HS384') {
  throw new Error(`built server JWT algorithm was ${actualHeader.alg || 'missing'}, expected HS384`);
}

const weakHeader = Buffer.from(JSON.stringify({ alg: 'HS384', typ: 'JWT' })).toString('base64url');
const weakInput = `${weakHeader}.${tokenParts[1]}`;
const weakSignature = createHmac('sha384', '123123').update(weakInput).digest('base64url');
const forgedToken = `${weakInput}.${weakSignature}`;
const forgedResponse = await fetch(`${baseUrl}/accounts`, {
  headers: {
    authorization: `Bearer ${forgedToken}`,
    'organization-id': String(signin.organization_id),
  },
});
if (forgedResponse.status < 400) {
  throw new Error('forged weak-secret token was accepted');
}

const wrongAlgorithmHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const wrongAlgorithmInput = `${wrongAlgorithmHeader}.${tokenParts[1]}`;
const wrongAlgorithmSignature = createHmac('sha256', process.env.APP_JWT_SECRET)
  .update(wrongAlgorithmInput)
  .digest('base64url');
const wrongAlgorithmToken = `${wrongAlgorithmInput}.${wrongAlgorithmSignature}`;
const wrongAlgorithmResponse = await fetch(`${baseUrl}/accounts`, {
  headers: {
    authorization: `Bearer ${wrongAlgorithmToken}`,
    'organization-id': String(signin.organization_id),
  },
});
if (wrongAlgorithmResponse.status < 400) {
  throw new Error('correct-secret HS256 token was accepted');
}

console.log('EASYFIRE_BUILT_SERVER_AUTH_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
'@
    $authProbeOutput = Invoke-DockerCapture ($composeArgs + @(
        'exec', '-T', 'server', 'node', '-e', $builtServerAuthProbe, $proofId
    ))
    if (($authProbeOutput -join "`n") -notmatch 'EASYFIRE_BUILT_SERVER_AUTH_OK') {
        throw 'Built server authentication proof did not return its success marker'
    }
    $builtServerAuthPassed = $true

    Write-Host '[8/11] Writing one disposable backup marker' -ForegroundColor Cyan
    $markerSql = "CREATE TABLE IF NOT EXISTS ${systemDbName}.easyfire_disposable_proof (proof_id CHAR(32) NOT NULL PRIMARY KEY, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO ${systemDbName}.easyfire_disposable_proof (proof_id) VALUES ('$proofId');"
    Invoke-DockerLogged ($composeArgs + @(
        'exec', '-T', 'mysql', 'mariadb', '-u', 'root', "-p$dbRootPassword",
        '--execute', $markerSql
    ))

    Write-Host '[9/11] Creating and hash-verifying a full application backup' -ForegroundColor Cyan
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $backupScript `
        -ComposeFile $resolvedCompose -EnvFile $envFile -ProjectName $projectName `
        -BackupDir $backupDir -AuthorityRoot $proofRoot -RetentionCount 5 `
        -DisposableProof -ProofId $proofId -BackupOperationId $backupOperationId
    if ($LASTEXITCODE -ne 0) { throw "Backup proof failed ($LASTEXITCODE)" }
    $expectedBackupFile = Join-Path $backupDir "mysql-${projectName}-full-${backupOperationId}.sql.gz"
    $expectedMetadataFile = Join-Path $backupDir "mysql-${projectName}-full-${backupOperationId}.metadata.json"
    $backupFiles = if (Test-Path -LiteralPath $expectedBackupFile -PathType Leaf) {
        @(Get-Item -LiteralPath $expectedBackupFile)
    } else { @() }
    if ($backupFiles.Count -ne 1 -or -not (Test-Path -LiteralPath $expectedMetadataFile -PathType Leaf)) {
        throw "Expected one proof backup with exact metadata, found $($backupFiles.Count) backup files"
    }

    Write-Host '[10/11] Restoring the backup into an isolated verifier' -ForegroundColor Cyan
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $restoreVerifyScript `
        -BackupFile $backupFiles[0].FullName -EnvFile $envFile `
        -ExpectedProofId $proofId
    if ($LASTEXITCODE -ne 0) { throw "Restore verification failed ($LASTEXITCODE)" }

    Write-Host '[11/11] Rechecking running health and recording evidence' -ForegroundColor Cyan
    Invoke-DockerLogged ($composeArgs + @('up', '-d', '--wait', 'mysql', 'redis', 'server', 'webapp', 'gotenberg', 'envoy'))
    $composePs = Invoke-DockerCapture ($composeArgs + @('ps', '--format', 'json'))
    Write-Utf8NoBom -Path (Join-Path $proofRoot 'compose-ps.json') -Value $composePs

    $proofPassed = $true
} catch {
    $failureMessage = $_.Exception.Message
    Write-Host "DISPOSABLE PROOF FAILED: $failureMessage" -ForegroundColor Red
} finally {
    Write-Host 'Teardown inventory (exact current proof only):' -ForegroundColor Cyan
    Write-Host "  Project: $projectName"
    Write-Host "  Proof label: $proofLabel"
    Write-Host "  One-off E2E name: $e2eContainerName"
    Write-Host "  Image tags: $($imageReferences -join ', ')"

        $savedErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $e2eCandidates = @(
                Get-LabelledContainerIds $proofLabel | Where-Object {
                    $observedName = ((Invoke-DockerCapture @(
                                'container', 'inspect', $_, '--format', '{{.Name}}'
                            ) | Select-Object -Last 1).Trim()).TrimStart('/')
                    $observedName -ceq $e2eContainerName
                }
            )
            if ($e2eCandidates.Count -gt 1) {
                Write-Host 'Refusing to remove E2E containers: exact name authority is ambiguous' -ForegroundColor Red
                $cleanupPassed = $false
            } elseif ($e2eCandidates.Count -eq 1) {
                $e2eContainerId = [string]$e2eCandidates[0]
                if ((Get-ResourceProofId -Kind 'container' -Identity $e2eContainerId) -ceq $proofId -and
                    $e2eContainerId -match '^[a-f0-9]{12,64}$') {
                    & docker rm -f -v $e2eContainerId 2>$null | Out-Null
                    if ($LASTEXITCODE -ne 0) { $cleanupPassed = $false }
                } else {
                Write-Host 'Refusing to remove E2E container: exact proof ownership was not established' -ForegroundColor Red
                $cleanupPassed = $false
            }
        }

        $projectOwnershipEstablished = $false
        try {
            Assert-ProjectResourcesOwnedByProof -ProjectName $projectName -ProofId $proofId
            $projectOwnershipEstablished = $true
        } catch {
            Write-Host $_.Exception.Message -ForegroundColor Red
            $cleanupPassed = $false
        }
        if ($projectOwnershipEstablished) {
            # Project teardown excludes volumes and orphans. Exact proof-labelled
            # leftovers are removed individually only after label readback below.
            & docker @composeArgs down
            if ($LASTEXITCODE -ne 0) { $cleanupPassed = $false }
            try {
                Remove-ExactProofResources -ProofLabel $proofLabel -ProofId $proofId
            } catch {
                Write-Host $_.Exception.Message -ForegroundColor Red
                $cleanupPassed = $false
            }
        }

        foreach ($imageReference in $imageReferences) {
            if (Test-DockerImage $imageReference) {
                & docker image rm $imageReference
                if ($LASTEXITCODE -ne 0) { $cleanupPassed = $false }
            }
        }
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }

    $leftoverContainers = @(Get-LabelledContainerIds $proofLabel)
    $leftoverVolumes = @(Get-LabelledVolumeNames $proofLabel)
    $leftoverNetworks = @(Get-LabelledNetworkIds $proofLabel)
    $leftoverImages = @($imageReferences | Where-Object { Test-DockerImage $_ })
    if ($leftoverContainers.Count -gt 0 -or $leftoverVolumes.Count -gt 0 -or
        $leftoverNetworks.Count -gt 0 -or $leftoverImages.Count -gt 0) {
        $cleanupPassed = $false
        Write-Host 'Exact proof resources remain; no broader cleanup was attempted.' -ForegroundColor Red
    }

    $productionAfter = Get-ProductionSnapshot
    Write-Utf8NoBom -Path $afterEvidence -Value ($productionAfter | ConvertTo-Json -Depth 4)
    try {
        Assert-SameSnapshot -Before $productionBefore -After $productionAfter
    } catch {
        $cleanupPassed = $false
        if (-not $failureMessage) { $failureMessage = $_.Exception.Message }
        Write-Host $_.Exception.Message -ForegroundColor Red
    }

    [ordered]@{
        proofId = $proofId
        backupOperationId = $backupOperationId
        projectName = $projectName
        imageTag = $imageTag
        dockerContext = $dockerContext
        dockerEndpoint = $dockerEndpoint
        proofPassed = $proofPassed
        builtServerAuthPassed = $builtServerAuthPassed
        cleanupPassed = $cleanupPassed
        failure = $failureMessage
        backup = if ($backupFiles -and $backupFiles.Count -eq 1) { $backupFiles[0].Name } else { $null }
        backupMetadata = if ($expectedMetadataFile -and (Test-Path -LiteralPath $expectedMetadataFile -PathType Leaf)) {
            [IO.Path]::GetFileName($expectedMetadataFile)
        } else { $null }
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 4 | ForEach-Object {
        Write-Utf8NoBom -Path $resultEvidence -Value $_
    }
}

if ($proofPassed -and $cleanupPassed) {
    Write-Host "DISPOSABLE PROOF PASSED: $proofId" -ForegroundColor Green
    Write-Host "Evidence retained at: $proofRoot" -ForegroundColor Green
    exit 0
}
Write-Host "DISPOSABLE PROOF INCOMPLETE: $proofId" -ForegroundColor Red
Write-Host "Evidence retained at: $proofRoot" -ForegroundColor Yellow
exit 1
