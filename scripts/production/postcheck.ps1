# EasyFire Bookkeeping -- Production Post-check Script
# Validates that a deployment is healthy after startup.
# Read-only checks; does NOT modify any services.
#
# Usage: .\scripts\production\postcheck.ps1

param(
    [string]$ComposeFile = "$PSScriptRoot\..\..\docker-compose.prod.yml",
    [string]$EnvFile = "$PSScriptRoot\..\..\.env",
    [string]$ProjectName = "easyfire-bookkeeping-prod",
    [string]$BaseUrl = "http://localhost:80"
)

$ErrorActionPreference = "Continue"
$allPassed = $true
$checksRun = 0
$checksPassed = 0

function Write-CheckResult($name, $passed, $detail = "") {
    $script:checksRun++
    $status = if ($passed) { $script:checksPassed++; "PASS" } else { $script:allPassed = $false; "FAIL" }
    $color = if ($passed) { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1}" -f $status, $name) -ForegroundColor $color
    if ($detail -and -not $passed) {
        Write-Host ("       {0}" -f $detail) -ForegroundColor DarkYellow
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " EasyFire Bookkeeping -- Post-check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$composeArgs = @("compose", "-f", $ComposeFile, "--env-file", $EnvFile, "-p", $ProjectName)

Write-Host "[1] Container Status" -ForegroundColor Yellow
$containerIdMap = @{}
$expectedServices = @("mysql", "redis", "server", "webapp", "envoy", "gotenberg")
foreach ($svc in $expectedServices) {
    $cid = docker $composeArgs ps -q $svc 2>$null
    if ($cid -and $LASTEXITCODE -eq 0) {
        $inspect = docker inspect --format='{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $cid 2>$null
        if ($inspect) {
            $parts = $inspect -split '\|'
            $containerIdMap[$svc] = @{ Id = $cid.Trim(); Name = $parts[0].TrimStart('/'); State = $parts[1]; Health = $parts[2] }
        }
    }
}

foreach ($svc in $expectedServices) {
    if ($containerIdMap.ContainsKey($svc)) {
        $c = $containerIdMap[$svc]
        $running = $c.State -eq "running"
        Write-CheckResult "$svc running ($($c.Name))" $running "State: $($c.State)"
    } else {
        Write-CheckResult "$svc running" $false "Not found via compose ps -q"
    }
}

Write-Host ""
Write-Host "[2] Container Health" -ForegroundColor Yellow
foreach ($svc in $expectedServices) {
    if ($containerIdMap.ContainsKey($svc)) {
        $c = $containerIdMap[$svc]
        $health = $c.Health
        if ($health -eq "<nil>" -or -not $health) { $health = "no healthcheck" }
        $healthy = $health -eq "healthy"
        if ($svc -eq "gotenberg" -and $health -eq "no healthcheck") { $healthy = $true }
        Write-CheckResult "$svc health" $healthy $health
    } else {
        Write-CheckResult "$svc health" $false "Container not found"
    }
}

Write-Host ""
Write-Host "[3] HTTP Endpoints" -ForegroundColor Yellow
$endpoints = @(
    @{ Name = "API health"; Url = "$BaseUrl/api/system_db" },
    @{ Name = "Webapp root"; Url = "$BaseUrl/" }
)
foreach ($ep in $endpoints) {
    try {
        $response = Invoke-WebRequest -Uri $ep.Url -Method GET -TimeoutSec 10 -UseBasicParsing -SkipHttpErrorCheck
        $ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
        Write-CheckResult $ep.Name $ok "HTTP $($response.StatusCode) ($($ep.Url))"
    } catch {
        Write-CheckResult $ep.Name $false $_.Exception.Message
    }
}

Write-Host ""
Write-Host "[4] Envoy Routing" -ForegroundColor Yellow
try {
    $apiResponse = Invoke-WebRequest -Uri "$BaseUrl/api/system_db" -Method GET -TimeoutSec 10 -UseBasicParsing -SkipHttpErrorCheck
    $apiOk = $apiResponse.StatusCode -ge 200 -and $apiResponse.StatusCode -lt 400
    Write-CheckResult "/api/* routes to server" $apiOk "HTTP $($apiResponse.StatusCode)"

    $webappResponse = Invoke-WebRequest -Uri "$BaseUrl/" -Method GET -TimeoutSec 10 -UseBasicParsing -SkipHttpErrorCheck
    $webappOk = $webappResponse.StatusCode -ge 200 -and $webappResponse.StatusCode -lt 400
    $isWebapp = $webappResponse.Content -match "EasyFire|Bigcapital|bookkeeping"
    Write-CheckResult "/* routes to webapp" ($webappOk -and $isWebapp) "HTTP $($webappResponse.StatusCode), content match: $isWebapp"
} catch {
    Write-CheckResult "Envoy routing" $false $_.Exception.Message
}

Write-Host ""
Write-Host "[5] Database Connectivity" -ForegroundColor Yellow
if ($containerIdMap.ContainsKey("mysql")) {
    $dbCheck = docker $composeArgs exec -T mysql sh -c "mariadb-admin ping -h localhost -u root -p`"`$MYSQL_ROOT_PASSWORD`"" 2>&1
    Write-CheckResult "MariaDB ping" ($LASTEXITCODE -eq 0) $dbCheck

    $dbList = docker $composeArgs exec -T mysql sh -c "mariadb -u root -p`"`$MYSQL_ROOT_PASSWORD`" -e 'SHOW DATABASES;'" 2>&1
    $hasSystemDb = $dbList -match "easyfire_system|bigcapital_system"
    Write-CheckResult "System database exists" $hasSystemDb ($dbList -join ', ')
} else {
    Write-CheckResult "MariaDB ping" $false "mysql service not found"
    Write-CheckResult "System database exists" $false "mysql service not found"
}

Write-Host ""
Write-Host "[6] Redis Connectivity" -ForegroundColor Yellow
if ($containerIdMap.ContainsKey("redis")) {
    $redisCheck = docker $composeArgs exec -T redis redis-cli PING 2>&1
    Write-CheckResult "Redis PING" ($redisCheck -eq "PONG") $redisCheck
} else {
    Write-CheckResult "Redis PING" $false "redis service not found"
}

Write-Host ""
Write-Host "[7] Log Files (recent errors)" -ForegroundColor Yellow
$recentLogs = docker $composeArgs logs --tail 50 --since 5m 2>&1
$errors = ($recentLogs | Select-String -Pattern '(?-i:\bERROR\b)|(?-i:\bFATAL\b)|(?-i:\bCRITICAL\b)|\[(error|fatal|critical)\]|"level"\s*:\s*"(error|fatal|critical)"|\bexit (code|status)\b.*[1-9]|\bExited\s*\(\s*[1-9]' | Select-Object -First 10) -join '; '
if ($errors) {
    Write-CheckResult "No recent errors in logs" $false $errors
} else {
    Write-CheckResult "No recent errors in logs" $true
}

Write-Host ""
Write-Host "[8] Database Migration (last run evidence)" -ForegroundColor Yellow
$migCid = docker $composeArgs ps -a -q database_migration 2>$null
if ($migCid -and $LASTEXITCODE -eq 0) {
    $migInspect = docker inspect --format='{{.State.Status}}|{{.State.ExitCode}}' $migCid 2>$null
    if ($migInspect) {
        $migParts = $migInspect -split '\|'
        $migExited = $migParts[0] -eq 'exited'
        $migExitOk = $migParts[1] -eq '0'
        Write-CheckResult "Migration container exited ok" ($migExited -and $migExitOk) "Status: $($migParts[0]), ExitCode: $($migParts[1])"
    } else {
        Write-CheckResult "Migration container exited ok" $false "Cannot inspect migration container"
    }
} else {
    Write-CheckResult "Migration container exited ok" $false "No database_migration container found (ps -a -q)"
}

Write-Host ""
Write-Host "[9] Signup Disabled (production lock)" -ForegroundColor Yellow
if ($containerIdMap.ContainsKey("server")) {
    $serverId = $containerIdMap["server"].Id
    $signupOutput = docker exec $serverId printenv SIGNUP_DISABLED 2>$null
    if ($LASTEXITCODE -eq 0 -and $signupOutput -and ([string]$signupOutput).Trim() -eq "true") {
        Write-CheckResult "SIGNUP_DISABLED=true" $true
    } else {
        Write-CheckResult "SIGNUP_DISABLED=true" $false "Container runtime probe failed - signup may not be disabled."
    }
} else {
    Write-CheckResult "SIGNUP_DISABLED=true" $false "Server container not found via compose ps -q"
}

Write-Host ""
Write-Host "[10] Volume Integrity" -ForegroundColor Yellow
try {
    $composeJson = docker $composeArgs config --format json 2>$null | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($composeJson)) {
        Write-CheckResult "Render compose config" $false "docker compose config failed or returned empty output"
    } else {
        $composeModel = $composeJson | ConvertFrom-Json
        $expectedVolumes = @($composeModel.volumes.PSObject.Properties | ForEach-Object { $_.Value.name })
        if ($expectedVolumes.Count -lt 2) {
            Write-CheckResult "Derive volume names" $false "Found $($expectedVolumes.Count) volumes (expected at least 2)"
        } else {
            $dockerVolumes = docker volume ls --format '{{.Name}}' 2>&1
            $foundVolumes = $expectedVolumes | Where-Object { $dockerVolumes -match $_ }
            Write-CheckResult "Named volumes exist" ($foundVolumes.Count -eq $expectedVolumes.Count) "Expected: $($expectedVolumes -join ', '); Found: $($foundVolumes -join ', ')"
        }
    }
} catch {
    Write-CheckResult "Volume integrity" $false "Exception: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "[11] DNS / Tunnel Hint" -ForegroundColor Yellow
Write-Host "  REMINDER: Verify Cloudflare Tunnel is running and DNS resolves bookkeeping.easyfire.fyi" -ForegroundColor DarkYellow
Write-CheckResult "Reminder logged" $true "(manual verification required for DNS + Tunnel)"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Post-check Summary: $checksPassed / $checksRun passed" -ForegroundColor $(if ($allPassed) { "Green" } else { "Red" })
Write-Host "============================================" -ForegroundColor Cyan

exit (&{ if ($allPassed) { 0 } else { 1 } })
