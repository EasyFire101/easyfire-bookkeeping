<#
.SYNOPSIS
    Agent Foundry -- EasyFire Bookkeeping Local Dev Health Check
.DESCRIPTION
    Verifies all local dev services are healthy. Checks Docker containers,
    database/cache connectivity, API server, webapp, and boot PID status.
    Reports actionable failures with fix commands.
.NOTES
    AGPL v3 license. Upstream: https://github.com/bigcapitalhq/bigcapital
    Workspace: easyfire-bookkeeping/af-bk-full-01
#>

$ErrorActionPreference = "Continue"
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $workspaceRoot "logs"
$pidFile = Join-Path $logsDir ".pids"

$dockerConfigDir = Join-Path $logsDir "docker-config"
if (Test-Path $dockerConfigDir) {
    $env:DOCKER_CONFIG = $dockerConfigDir
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " EasyFire Bookkeeping -- Health Check" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$allHealthy = $true
$checks = @()

function Check-Pass {
    param([string]$Name, [string]$Detail)
    $script:checks += @{ Name = $Name; Status = "PASS"; Detail = $Detail }
    Write-Host "  [PASS] $Name" -ForegroundColor Green
}

function Check-Fail {
    param([string]$Name, [string]$Detail)
    $script:checks += @{ Name = $Name; Status = "FAIL"; Detail = $Detail }
    $script:allHealthy = $false
    Write-Host "  [FAIL] $Name -- $Detail" -ForegroundColor Red
}

function Check-Warn {
    param([string]$Name, [string]$Detail)
    $script:checks += @{ Name = $Name; Status = "WARN"; Detail = $Detail }
    Write-Host "  [WARN] $Name -- $Detail" -ForegroundColor Yellow
}

# -- Docker Containers --------------------------------------------------
Write-Host "-- Docker Containers --" -ForegroundColor Cyan

$dockerPs = & docker compose -f "$workspaceRoot/docker-compose.yml" ps --format json 2>$null
if (-not $dockerPs) {
    Check-Fail "docker-compose" "No containers running. Run: docker compose -f docker-compose.yml up -d --build"
} else {
    $containers = $dockerPs | ForEach-Object { $_ | ConvertFrom-Json }
    $containerNames = $containers | ForEach-Object { $_.Name }

    $requiredContainers = @("mariadb", "redis")
    foreach ($name in $requiredContainers) {
        $found = $containerNames | Where-Object { $_ -match $name }
        if ($found) {
            Check-Pass "Container: $name" "Running"
        } else {
            Check-Fail "Container: $name" "Not running. Run: docker compose -f docker-compose.yml up -d --build"
        }
    }
}

# -- MariaDB ------------------------------------------------------------
Write-Host "-- MariaDB --" -ForegroundColor Cyan

try {
    $mysqlResult = & docker compose -f "$workspaceRoot/docker-compose.yml" exec -T mariadb sh -lc 'mariadb-admin ping -h localhost -u"$MYSQL_USER" -p"$MYSQL_PASSWORD"' 2>$null
    if ($LASTEXITCODE -eq 0) {
        Check-Pass "MariaDB ping" "Responding"
    } else {
        Check-Fail "MariaDB ping" "Database not responding. Run: docker compose -f docker-compose.yml restart mariadb"
    }
} catch {
    Check-Fail "MariaDB ping" "Cannot reach MariaDB container -- is Docker running?"
}

# -- Redis --------------------------------------------------------------
Write-Host "-- Redis --" -ForegroundColor Cyan

try {
    $redisResult = & docker compose -f "$workspaceRoot/docker-compose.yml" exec -T redis redis-cli ping 2>$null
    if ($redisResult -match "PONG") {
        Check-Pass "Redis ping" "PONG"
    } else {
        Check-Fail "Redis ping" "Redis not responding. Run: docker compose -f docker-compose.yml restart redis"
    }
} catch {
    Check-Fail "Redis ping" "Cannot reach Redis container"
}

# -- Gotenberg (PDF, optional, port 9000) ------------------------------
Write-Host "-- Gotenberg (PDF, port 9000, optional) --" -ForegroundColor Cyan

try {
    $gotenbergResponse = Invoke-WebRequest -Uri "http://localhost:9000" -Method GET -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Check-Pass "Gotenberg" "HTTP $($gotenbergResponse.StatusCode)"
} catch {
    Check-Warn "Gotenberg" "Optional PDF service not running on port 9000. Enable with: docker compose --profile pdf up -d"
}

# -- API Server ---------------------------------------------------------
Write-Host "-- API Server (port 3000) --" -ForegroundColor Cyan

try {
    $apiResponse = Invoke-WebRequest -Uri "http://localhost:3000/swagger" -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    Check-Pass "API health" "HTTP $($apiResponse.StatusCode)"
} catch {
    Check-Fail "API health" "Not responding on port 3000. Start with: pnpm run server:start"
}

# -- Webapp -------------------------------------------------------------
Write-Host "-- Webapp (port 4000) --" -ForegroundColor Cyan

try {
    $webResponse = Invoke-WebRequest -Uri "http://localhost:4000" -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    Check-Pass "Webapp" "HTTP $($webResponse.StatusCode)"
} catch {
    Check-Warn "Webapp" "Not running on port 4000. Start with: pnpm run dev:webapp"
}

# -- Boot PID Status ----------------------------------------------------
Write-Host "-- Boot Process Status --" -ForegroundColor Cyan

if (Test-Path $pidFile) {
    Check-Pass "PID file" "Found at $pidFile"
    $pidLines = Get-Content $pidFile | Where-Object { $_ -match '=' -and $_ -notmatch '^#' }
    foreach ($line in $pidLines) {
        $parts = $line -split '=', 2
        $name = $parts[0]
        $processId = [int]$parts[1]
        try {
            $proc = Get-Process -Id $processId -ErrorAction Stop
            if (-not $proc.HasExited) {
                Check-Pass "Process: $name" "PID $processId running ($($proc.ProcessName))"
            } else {
                Check-Fail "Process: $name" "PID $processId has exited (exit code: $($proc.ExitCode)). Check logs: $logsDir"
            }
        } catch {
            Check-Fail "Process: $name" "PID $processId not found -- process may have crashed. Check logs: $logsDir"
        }
    }
} else {
    Check-Warn "PID file" "Not found at $pidFile -- boot script may not have run. Run: .\scripts\agent-foundry-dev-boot.ps1"
}

# -- Log Files -----------------------------------------------------------
Write-Host "-- Log Files --" -ForegroundColor Cyan

if (Test-Path $logsDir) {
    $logFiles = Get-ChildItem -Path $logsDir -Filter "*.log" -ErrorAction SilentlyContinue
    if ($logFiles) {
        $latestLogs = $logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 5
        Check-Pass "Logs directory" "$($logFiles.Count) log file(s) in $logsDir"
        foreach ($lf in $latestLogs) {
            Write-Host "         $($lf.Name) ($([math]::Round($lf.Length/1KB, 1)) KB)" -ForegroundColor Gray
        }
    } else {
        Check-Warn "Logs directory" "No log files found in $logsDir"
    }
} else {
    Check-Warn "Logs directory" "$logsDir does not exist yet"
}

# -- Project Files ------------------------------------------------------
Write-Host "-- Project Files --" -ForegroundColor Cyan

if (Test-Path "$workspaceRoot\.env") {
    Check-Pass ".env file" "Present"
} else {
    Check-Fail ".env file" "Missing. Run: Copy-Item .env.example .env"
}

if (Test-Path "$workspaceRoot\package.json") {
    Check-Pass "package.json" "Present"
} else {
    Check-Fail "package.json" "Missing"
}

if (Test-Path "$workspaceRoot\LICENSE") {
    Check-Pass "LICENSE (AGPL v3)" "Present"
} else {
    Check-Fail "LICENSE" "Missing"
}

# -- Summary ------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Health Check Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

$passCount = ($checks | Where-Object { $_.Status -eq "PASS" }).Count
$warnCount = ($checks | Where-Object { $_.Status -eq "WARN" }).Count
$failCount = ($checks | Where-Object { $_.Status -eq "FAIL" }).Count

Write-Host "  PASS: $passCount  WARN: $warnCount  FAIL: $failCount" -ForegroundColor White
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "FAILURES -- run these commands to fix:" -ForegroundColor Red
    $fails = $checks | Where-Object { $_.Status -eq "FAIL" }
    foreach ($f in $fails) {
        Write-Host "  [$($f.Name)] $($f.Detail)" -ForegroundColor Red
    }
}

if ($passCount -gt 0 -and $failCount -eq 0 -and $warnCount -eq 0) {
    Write-Host "All checks passed -- EasyFire Bookkeeping is healthy." -ForegroundColor Green
} elseif ($failCount -eq 0) {
    Write-Host "All core checks passed (warnings are non-critical)." -ForegroundColor Green
} else {
    Write-Host "Some checks failed. Review the output above." -ForegroundColor Red
}

Write-Host ""
Write-Host "Boot log: $logsDir\boot-*.log" -ForegroundColor Gray
Write-Host "API log:  $logsDir\api-*.log"  -ForegroundColor Gray
Write-Host "Web log:  $logsDir\webapp-*.log" -ForegroundColor Gray
Write-Host ""

if (-not $allHealthy) {
    exit 1
}
exit 0
