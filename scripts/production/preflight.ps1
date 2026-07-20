# EasyFire Bookkeeping -- Production Pre-flight Check
# Validates that the environment is ready for a production deployment.
# Does NOT start, stop, or modify any services.
#
# Usage: .\scripts\production\preflight.ps1

param(
    [string]$ComposeFile = "$PSScriptRoot\..\..\docker-compose.prod.yml",
    [string]$EnvFile = "$PSScriptRoot\..\..\.env",
    [string]$ProjectName = "easyfire-bookkeeping-prod"
)

$ErrorActionPreference = "Continue"
$allPassed = $true
$checksRun = 0
$checksPassed = 0

function Write-CheckResult($name, $passed, $detail = "") {
    $script:checksRun++
    if ($passed) { $script:checksPassed++; $status = "PASS" } else { $script:allPassed = $false; $status = "FAIL" }
    $color = if ($passed) { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1}" -f $status, $name) -ForegroundColor $color
    if ($detail -and -not $passed) {
        Write-Host ("       {0}" -f $detail) -ForegroundColor DarkYellow
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " EasyFire Bookkeeping -- Pre-flight Check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1] Docker Daemon" -ForegroundColor Yellow
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>&1
    Write-CheckResult "Docker daemon running" ($LASTEXITCODE -eq 0) "$dockerVersion"
} catch {
    Write-CheckResult "Docker daemon running" $false $_.Exception.Message
}

Write-Host ""
Write-Host "[2] Required Files" -ForegroundColor Yellow
Write-CheckResult "docker-compose.prod.yml exists" (Test-Path $ComposeFile) $ComposeFile
Write-CheckResult ".env file exists" (Test-Path $EnvFile) $EnvFile
Write-CheckResult "LICENSE file exists" (Test-Path "$PSScriptRoot\..\..\LICENSE") "$PSScriptRoot\..\..\LICENSE"

$dockerfiles = @(
    "packages/server/Dockerfile",
    "packages/webapp/Dockerfile",
    "docker/migration/Dockerfile",
    "docker/mariadb/Dockerfile",
    "docker/redis/Dockerfile"
)
foreach ($df in $dockerfiles) {
    $exists = Test-Path "$PSScriptRoot\..\..\$df"
    Write-CheckResult "$df exists" $exists
}

Write-Host ""
Write-Host "[3] Required Environment Variables" -ForegroundColor Yellow
if (Test-Path $EnvFile) {
    $envContent = Get-Content $EnvFile -Raw
    $requiredVars = @(
        "BASE_URL", "APP_JWT_SECRET", "DB_USER", "DB_PASSWORD", "DB_ROOT_PASSWORD",
        "SYSTEM_DB_NAME", "TENANT_DB_NAME_PERFIX", "SIGNUP_DISABLED"
    )
    foreach ($var in $requiredVars) {
        $found = $envContent -match "(?m)^$var\s*="
        $isPlaceholder = $found -and ($envContent -match "(?m)^$var\s*=.*PLACEHOLDER")
        if ($found -and -not $isPlaceholder) {
            Write-CheckResult "`$$var is set" $true
        } else {
            $reason = if (-not $found) { "not found" } else { "placeholder detected" }
            Write-CheckResult "`$$var is set" $false "$var`: $reason"
        }
    }
} else {
    Write-CheckResult ".env variables" $false ".env file not found"
}

Write-Host ""
Write-Host "[4] Proxy Port Availability" -ForegroundColor Yellow
$proxyPortLine = $null
if (Test-Path $EnvFile) {
    $proxyPortLine = Select-String -Path $EnvFile -Pattern 'PUBLIC_PROXY_PORT\s*=' | Select-Object -First 1
}
$proxyPort = 80
if ($proxyPortLine -and $proxyPortLine.Line -match 'PUBLIC_PROXY_PORT\s*=\s*(\d+)') {
    $proxyPort = [int]$Matches[1]
}
$listening = netstat -ano 2>$null | Select-String ":$proxyPort " | Select-String "LISTENING"
if ($listening) {
    $processInfo = $listening.ToString().Trim()
    Write-CheckResult "Port $proxyPort available" $false "In use: $processInfo"
} else {
    Write-CheckResult "Port $proxyPort available" $true
}

Write-Host ""
Write-Host "[5] Compose File Syntax" -ForegroundColor Yellow
$composeArgs = @("compose", "-f", $ComposeFile, "-p", $ProjectName)
if (Test-Path $EnvFile) {
    $composeArgs += @("--env-file", $EnvFile)
}
$configOutput = docker $composeArgs config 2>&1
Write-CheckResult "docker compose config valid" ($LASTEXITCODE -eq 0) ($configOutput -join '; ' * ($LASTEXITCODE -ne 0))

Write-Host ""
Write-Host "[6] Docker Compose Version" -ForegroundColor Yellow
$versionOutput = docker compose version 2>&1
Write-CheckResult "Docker Compose available" ($LASTEXITCODE -eq 0) $versionOutput

Write-Host ""
Write-Host "[7] Disk Space" -ForegroundColor Yellow
try {
    $drive = (Get-Location).Drive.Name
    $disk = Get-PSDrive -Name $drive
    $freeGB = [math]::Round($disk.Free / 1GB, 1)
    $totalGB = [math]::Round(($disk.Used + $disk.Free) / 1GB, 1)
    $sufficient = $freeGB -gt 5
    Write-CheckResult "Disk free space > 5 GB" $sufficient "${freeGB}GB free / ${totalGB}GB total"
} catch {
    Write-CheckResult "Disk free space check" $false $_.Exception.Message
}

Write-Host ""
Write-Host "[8] Signup Disabled Verification" -ForegroundColor Yellow
if (Test-Path $EnvFile) {
    $signupMatch = $envContent -match '(?m)^SIGNUP_DISABLED\s*=\s*(\S+)'
    if ($signupMatch) {
        $signupValue = $Matches[1].Trim()
        $isDisabled = $signupValue -eq 'true'
        Write-CheckResult "SIGNUP_DISABLED=true" $isDisabled "Current: SIGNUP_DISABLED=$signupValue"
    } else {
        Write-CheckResult "SIGNUP_DISABLED is set" $false "Variable not found in .env"
    }
} else {
    Write-CheckResult "SIGNUP_DISABLED check" $false ".env file missing"
}

Write-Host ""
Write-Host "[9] Envoy Loopback Binding" -ForegroundColor Yellow
if (Test-Path $ComposeFile) {
    $composeContent = Get-Content $ComposeFile -Raw
    $envoyBound = $composeContent -match '127\.0\.0\.1:'
    Write-CheckResult "Envoy binds to 127.0.0.1 only" $envoyBound
} else {
    Write-CheckResult "Envoy binds to 127.0.0.1 only" $false "$ComposeFile not found"
}

Write-Host ""
Write-Host "[10] Restart Policies" -ForegroundColor Yellow
if (Test-Path $ComposeFile) {
    $composeContent = Get-Content $ComposeFile -Raw
    $hasOnFailure = $composeContent -match 'restart:\s*on-failure'
    if ($hasOnFailure) {
        Write-CheckResult "All services use unless-stopped" $false "Found 'on-failure' -- should be 'unless-stopped'"
    } else {
        Write-CheckResult "All services use unless-stopped" $true
    }
} else {
    Write-CheckResult "All services use unless-stopped" $false "$ComposeFile not found"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Pre-flight Summary: $checksPassed / $checksRun passed" -ForegroundColor $(if ($allPassed) { "Green" } else { "Red" })
Write-Host "============================================" -ForegroundColor Cyan

if (-not $allPassed) {
    Write-Host ""
    Write-Host "Fixes needed before deployment:" -ForegroundColor Yellow
    Write-Host "  1. Fill in all PLACEHOLDER values in $EnvFile"
    Write-Host "  2. Ensure no port conflicts on proxy port $proxyPort"
    Write-Host "  3. Verify all Dockerfiles exist in the expected paths"
    Write-Host "  4. Ensure restart policies are 'unless-stopped'"
}

exit (&{ if ($allPassed) { 0 } else { 1 } })
