<#
.SYNOPSIS
    Agent Foundry -- EasyFire Bookkeeping Local Dev Boot Script
.DESCRIPTION
    Executes bounded local dev boot steps: install deps, start Docker containers,
    wait for readiness, build server, optionally run disposable migration,
    and start API/web services in background with logs.
    Does NOT read .env -- treats it as opaque existing config.
.NOTES
    AGPL v3 license. Upstream: https://github.com/bigcapitalhq/bigcapital
    Workspace: easyfire-bookkeeping/af-bk-full-01
    Risk: medium (bounded local dev only)
#>

$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $PSScriptRoot

$logsDir = Join-Path $workspaceRoot "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$dockerConfigDir = Join-Path $logsDir "docker-config"
New-Item -ItemType Directory -Force -Path $dockerConfigDir | Out-Null
$dockerConfigJson = Join-Path $dockerConfigDir "config.json"
if (-not (Test-Path $dockerConfigJson)) {
    Set-Content -Path $dockerConfigJson -Value "{}" -Encoding ASCII
}
$env:DOCKER_CONFIG = $dockerConfigDir

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $logsDir "boot-$timestamp.log"
$pidFile = Join-Path $logsDir ".pids"

$script:blockers = @()
$script:pids = @{}

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -Path $logFile -Value $line
}

function Write-Step {
    param([string]$Message)
    $msg = "[*] $Message"
    Write-Host $msg -ForegroundColor Yellow
    Write-Log $msg
}

function Write-Ok {
    param([string]$Message)
    $msg = "[+] $Message"
    Write-Host $msg -ForegroundColor Green
    Write-Log $msg
}

function Write-Err {
    param([string]$Message)
    $msg = "[-] $Message"
    Write-Host $msg -ForegroundColor Red
    Write-Log $msg
}

function Invoke-Native {
    param([scriptblock]$ScriptBlock)
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        return & $ScriptBlock 2>&1
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

function Get-PnpmExecutable {
    try {
        $cmd = Get-Command -Name "pnpm.cmd" -ErrorAction Stop
        return $cmd.Source
    } catch {
        try {
            $cmd = Get-Command -Name "pnpm" -ErrorAction Stop
            $ext = [System.IO.Path]::GetExtension($cmd.Source)
            if ($ext -in @('.cmd', '.bat', '.exe', '.ps1')) {
                return $cmd.Source
            }
            $dir = Split-Path -Parent $cmd.Source
            $candidate = Join-Path $dir "pnpm.cmd"
            if (Test-Path $candidate) {
                return $candidate
            }
            throw "No executable pnpm command found"
        } catch {
            throw "Cannot resolve pnpm to an executable-safe path for Start-Process"
        }
    }
}

function Write-Blocker {
    param([string]$Message)
    $msg = "[BLOCKER] $Message"
    Write-Host $msg -ForegroundColor Magenta
    Write-Log $msg
}

function Add-Blocker {
    param([string]$Message)
    $script:blockers += $Message
    Write-Blocker $Message
}

function Add-Pid {
    param([string]$Name, [int]$Id)
    $script:pids[$Name] = $Id
}

function Write-PidFile {
    $lines = @()
    $lines += "# Agent Foundry -- EasyFire Bookkeeping PIDs"
    $lines += "# Written $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $lines += "# Boot log: $logFile"
    foreach ($key in $script:pids.Keys) {
        $lines += "$key=$($script:pids[$key])"
    }
    Set-Content -Path $pidFile -Value ($lines -join "`n")
}

$bootStart = Get-Date

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " EasyFire Bookkeeping -- Local Dev Bootstrap" -ForegroundColor Cyan
Write-Host " Agent Foundry Workspace: af-bk-full-01"   -ForegroundColor Cyan
Write-Host " Logs: $logFile"                            -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Log "Boot started -- workspace: $workspaceRoot"

# -- Prerequisites Check ------------------------------------------------
Write-Step "Checking prerequisites..."

$nodeVersion = & node --version 2>$null
if (-not $nodeVersion) {
    Add-Blocker "Node.js is not installed. Install Node.js 18.x from https://nodejs.org/"
    Write-Ok "Node.js: NOT FOUND (blocker)"
} else {
    Write-Ok "Node.js $nodeVersion"
}

$pnpmVersion = & pnpm --version 2>$null
if (-not $pnpmVersion) {
    Add-Blocker "pnpm is not installed. Install via: npm install -g pnpm"
    Write-Ok "pnpm: NOT FOUND (blocker)"
} else {
    Write-Ok "pnpm $pnpmVersion"
}

$dockerVersion = & docker --version 2>$null
if (-not $dockerVersion) {
    Add-Blocker "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    Write-Ok "Docker: NOT FOUND (blocker)"
} else {
    Write-Ok "Docker available"
}

$dockerRunning = & docker info 2>$null
if (-not $dockerRunning) {
    Add-Blocker "Docker daemon is not running. Start Docker Desktop first."
    Write-Ok "Docker daemon: NOT RUNNING (blocker)"
} else {
    Write-Ok "Docker daemon is running"
}

if ($script:blockers.Count -gt 0) {
    Write-Host ""
    Write-Host "Prerequisites missing. Fix blockers above and re-run." -ForegroundColor Red
    Write-Blocker "Boot aborted at prerequisites check -- $($script:blockers.Count) blocker(s)"
    Write-PidFile
    exit 1
}

# -- Environment File ---------------------------------------------------
Write-Step "Checking environment file..."
Push-Location $workspaceRoot
try {
    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
        Write-Ok "Created .env from .env.example (uses fake/dev defaults)"
    } else {
        Write-Ok ".env already exists (using existing config)"
    }

    # -- Install Dependencies -------------------------------------------
    Write-Step "Installing monorepo dependencies (pnpm install)..."
    $installStart = Get-Date
    try {
        $installOutput = Invoke-Native { pnpm install }
        $installResult = $installOutput -join "`n"
        Write-Log "pnpm install output:`n$installResult"
        if ($LASTEXITCODE -ne 0) {
            Add-Blocker "pnpm install failed with exit code $LASTEXITCODE."
            Write-Err "pnpm install FAILED (see log)"
        } else {
            $installDuration = [math]::Round(((Get-Date) - $installStart).TotalSeconds, 1)
            Write-Ok "pnpm install completed (${installDuration}s)"
        }
    } catch {
        Add-Blocker "pnpm install threw exception: $_"
        Write-Err "pnpm install EXCEPTION: $_"
    }

    if ($script:blockers.Count -gt 0) {
        Write-Host ""
        Write-Host "Dependency install failed. Fix blockers and re-run." -ForegroundColor Red
        Write-PidFile
        exit 1
    }

    # -- Docker Dev Containers ------------------------------------------
    Write-Step "Starting Docker dev containers (docker compose up -d --build)..."
    try {
        $composeOutput = Invoke-Native { docker compose -f "$workspaceRoot/docker-compose.yml" up -d --build }
        $composeResult = $composeOutput -join "`n"
        Write-Log "docker compose output:`n$composeResult"
        if ($LASTEXITCODE -ne 0) {
            Add-Blocker "docker compose up -d failed with exit code $LASTEXITCODE."
            Write-Err "docker compose up -d FAILED"
        } else {
            Write-Ok "docker compose up -d completed"
        }
    } catch {
        Add-Blocker "docker compose up -d threw exception: $_"
        Write-Err "docker compose EXCEPTION: $_"
    }

    if ($script:blockers.Count -gt 0) {
        Write-Host ""
        Write-Host "Docker compose failed. Skipping readiness poll." -ForegroundColor Red
        Write-PidFile
        exit 1
    }

    # -- Wait for Container Readiness -----------------------------------
    Write-Step "Waiting for container readiness (MariaDB, Redis)..."
    $maxWaitSec = 120
    $pollIntervalSec = 5
    $elapsed = 0
    $dbReady = $false
    $redisReady = $false
    $gotenbergReady = $false

    :waitLoop while ($elapsed -lt $maxWaitSec) {
        Start-Sleep -Seconds $pollIntervalSec
        $elapsed += $pollIntervalSec

        try {
            $dbCheck = Invoke-Native { docker compose -f "$workspaceRoot/docker-compose.yml" exec -T mariadb sh -lc 'mariadb-admin ping -h localhost -u"$MYSQL_USER" -p"$MYSQL_PASSWORD"' }
            if ($LASTEXITCODE -eq 0) { $dbReady = $true }
        } catch { }

        try {
            $redisCheck = Invoke-Native { docker compose -f "$workspaceRoot/docker-compose.yml" exec -T redis redis-cli ping }
            if ($redisCheck -match "PONG") { $redisReady = $true }
        } catch { }

        try {
            $gotenbergResponse = Invoke-WebRequest -Uri "http://localhost:9000" -Method GET -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($gotenbergResponse.StatusCode -eq 200) { $gotenbergReady = $true }
        } catch { }

        Write-Log "Wait ${elapsed}s -- MariaDB: $dbReady  Redis: $redisReady  Gotenberg: $gotenbergReady"

        if ($dbReady -and $redisReady) {
            Write-Ok "Core containers ready after ${elapsed}s"
            break waitLoop
        }
    }

    if ($elapsed -ge $maxWaitSec) {
        $waitMsg = "Container readiness timeout after ${maxWaitSec}s."
        if (-not $dbReady) { $waitMsg += " MariaDB not ready." }
        if (-not $redisReady) { $waitMsg += " Redis not ready." }
        if (-not $dbReady -or -not $redisReady) {
            Add-Blocker $waitMsg
            Write-Err $waitMsg
        }
        if (-not $gotenbergReady) {
            Write-Ok "Gotenberg (PDF) not detected -- PDF features disabled (optional, enable with: docker compose --profile pdf up -d)"
        }
    }

    if ($script:blockers.Count -gt 0) {
        Write-Host ""
        Write-Host "Docker containers not ready. Fix blockers and re-run." -ForegroundColor Red
        Write-PidFile
        exit 1
    }

    # -- Post-Readiness Dev Grant (MariaDB 11) --------------------------
    Write-Step "Applying post-readiness dev grant (idempotent)..."
    try {
        $dbGrant = Invoke-Native { docker compose -f "$workspaceRoot/docker-compose.yml" exec -T mariadb bash -c "mariadb -u root -p`$MYSQL_ROOT_PASSWORD -e `"GRANT ALL PRIVILEGES ON *.* TO '`$MYSQL_USER'@'%' IDENTIFIED BY '`$MYSQL_PASSWORD' WITH GRANT OPTION; FLUSH PRIVILEGES;`"" }
        $grantResult = $dbGrant -join "`n"
        Write-Log "Dev grant executed (output redacted for secrets)"
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Dev grant applied"
        } else {
            Write-Ok "Dev grant completed (may already be idempotent)"
        }
    } catch {
        Write-Ok "Dev grant step skipped (non-critical)"
    }

    # -- Build Server ---------------------------------------------------
    Write-Step "Building server and shared packages (pnpm run build:server)..."
    $buildStart = Get-Date
    try {
        $buildOutput = Invoke-Native { pnpm run build:server }
        $buildResult = $buildOutput -join "`n"
        Write-Log "build:server output:`n$buildResult"
        if ($LASTEXITCODE -ne 0) {
            Add-Blocker "pnpm run build:server failed with exit code $LASTEXITCODE."
            Write-Err "build:server FAILED"
        } else {
            $buildDuration = [math]::Round(((Get-Date) - $buildStart).TotalSeconds, 1)
            Write-Ok "build:server completed (${buildDuration}s)"
        }
    } catch {
        Add-Blocker "build:server threw exception: $_"
        Write-Err "build:server EXCEPTION: $_"
    }

    # -- Run Disposable Local Migration ---------------------------------
    Write-Step "Running disposable local migration (system:migrate:latest)..."
    try {
        $migrateOutput = Invoke-Native { pnpm run system:migrate:latest }
        $migrateResult = $migrateOutput -join "`n"
        Write-Log "system:migrate:latest output:`n$migrateResult"
        if ($LASTEXITCODE -ne 0) {
            Write-Ok "Migration command returned non-zero exit code ($LASTEXITCODE) -- may be expected if schema already current"
        } else {
            Write-Ok "System migration completed successfully"
        }
    } catch {
        Write-Ok "Migration skipped (command threw exception, may be expected): $_"
        Write-Log "Migration skip reason: $_"
    }

    # -- Resolve pnpm executable for Start-Process (Windows/SSH) ---------
    $pnpmExe = Get-PnpmExecutable
    Write-Log "Resolved pnpm executable for background start: $pnpmExe"

    # -- Stop Prior Dev Services (bounded) -------------------------------
    function Stop-PriorServices {
        param([string]$PidFilePath)
        if (-not (Test-Path $PidFilePath)) {
            Write-Log "No prior PID file found -- skipping service cleanup"
            return
        }
        Write-Step "Stopping prior dev services recorded in $PidFilePath..."
        $priorLines = Get-Content $PidFilePath | Where-Object { $_ -match '=' -and $_ -notmatch '^#' }
        if (-not $priorLines) {
            Write-Log "Prior PID file empty -- nothing to stop"
            return
        }
        foreach ($line in $priorLines) {
            $parts = $line -split '=', 2
            $svcName = $parts[0]
            $svcProcId = [int]$parts[1]
            try {
                $proc = Get-Process -Id $svcProcId -ErrorAction Stop
                if (-not $proc.HasExited) {
                    Write-Log "Stopping prior service: $svcName (PID $svcProcId)"
                    $proc.Kill()
                    Start-Sleep -Milliseconds 800
                    Write-Ok "Stopped prior $svcName (PID $svcProcId)"
                } else {
                    Write-Log "Prior $svcName (PID $svcProcId) already exited"
                }
            } catch {
                Write-Log "Prior $svcName (PID $svcProcId) no longer exists -- skip"
            }
        }
    }

    Stop-PriorServices -PidFilePath $pidFile

    # -- SSH-Safe Background Launcher ------------------------------------
    function Start-BackgroundService {
        param(
            [string]$Name,
            [string]$PnpmCommand,
            [string]$StdoutLog,
            [string]$StderrLog
        )
        $cmdString = "cd /d `"$workspaceRoot`" && `"$pnpmExe`" run $PnpmCommand > `"$StdoutLog`" 2> `"$StderrLog`""
        Write-Log "Launching background ${Name}: cmd.exe /c $cmdString"
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "cmd.exe"
            $psi.Arguments = "/c `"$cmdString`""
            $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
            $psi.UseShellExecute = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            Add-Pid $Name $proc.Id
            Write-Ok "$Name started (PID $($proc.Id), logs: $StdoutLog)"
        } catch {
            Add-Blocker "Failed to start $Name : $_"
            Write-Err "$Name start FAILED: $_"
        }
    }

    # -- Start API Server in Background ---------------------------------
    Write-Step "Starting API server in background (port 3000)..."
    $apiLog = Join-Path $logsDir "api-$timestamp.log"
    $apiErrLog = Join-Path $logsDir "api-err-$timestamp.log"
    Start-BackgroundService -Name "api-server" -PnpmCommand "server:start" -StdoutLog $apiLog -StderrLog $apiErrLog

    Start-Sleep -Seconds 3

    # -- Start Webapp in Background -------------------------------------
    Write-Step "Starting webapp in background (port 4000)..."
    $webLog = Join-Path $logsDir "webapp-$timestamp.log"
    $webErrLog = Join-Path $logsDir "webapp-err-$timestamp.log"
    Start-BackgroundService -Name "webapp" -PnpmCommand "dev:webapp" -StdoutLog $webLog -StderrLog $webErrLog

    # -- Write PID File -------------------------------------------------
    Write-Step "Writing PID file..."
    Write-PidFile
    Write-Ok "PIDs written to $pidFile"

    # -- Summary --------------------------------------------------------
    $bootDuration = [math]::Round(((Get-Date) - $bootStart).TotalSeconds, 1)
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " Bootstrap Complete (${bootDuration}s)"    -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " API:     http://localhost:3000"            -ForegroundColor Green
    Write-Host " Swagger: http://localhost:3000/swagger"    -ForegroundColor Green
    Write-Host " Webapp:  http://localhost:4000"            -ForegroundColor Green
    Write-Host " Logs:    $logsDir"                         -ForegroundColor Green
    Write-Host ""
    Write-Host " Next: .\scripts\agent-foundry-dev-health.ps1" -ForegroundColor Cyan

    if ($script:blockers.Count -gt 0) {
        Write-Host ""
        Write-Host "BLOCKERS ($($script:blockers.Count)):" -ForegroundColor Red
        foreach ($b in $script:blockers) {
            Write-Host "  - $b" -ForegroundColor Red
        }
        Write-Log "Boot completed with $($script:blockers.Count) blocker(s)"
        exit 1
    } else {
        Write-Log "Boot completed successfully"
        exit 0
    }
} finally {
    Pop-Location
}
