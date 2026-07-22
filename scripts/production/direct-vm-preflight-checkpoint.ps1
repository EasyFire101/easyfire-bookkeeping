[CmdletBinding()]
param(
    [string]$SecondaryRoot = 'E:\EasyFire Bookkeeping Recovery\direct-vm-preflight',
    [switch]$RequireWritersStopped,
    [string]$SourceQuiesceReceiptPath,
    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$SourceQuiesceReceiptSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($env:COMPUTERNAME -ne 'NEWSEC') {
    throw "Host mismatch: expected NEWSEC, observed $env:COMPUTERNAME."
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$mysql = 'easyfire-mysql'
$redis = 'easyfire-redis'
$containers = @(
    'easyfire-mysql',
    'easyfire-redis',
    'easyfire-gotenberg',
    'easyfire-proxy',
    'easyfire-webapp',
    'easyfire-owner-onboarding-ca845969f4b2',
    'easyfire-owner-onboarding-web-0b7d1af8',
    'easyfire-owner-onboarding-gateway-v2-0b7d1af8'
)
$dataContainers = @('easyfire-mysql', 'easyfire-redis')
$writerContainers = @($containers | Where-Object { $_ -notin $dataContainers })
$sourceQuiesceReceipt = $null

if ($RequireWritersStopped) {
    if (-not $SourceQuiesceReceiptPath -or -not $SourceQuiesceReceiptSha256) {
        throw 'Final writers-stopped checkpoint requires the exact source-quiesce receipt path and SHA-256.'
    }
    $receiptRoot = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\direct-vm-cutover\journal'
    $receiptFull = [IO.Path]::GetFullPath($SourceQuiesceReceiptPath)
    $receiptRootFull = [IO.Path]::GetFullPath($receiptRoot).TrimEnd('\')
    if (-not $receiptFull.StartsWith("$receiptRootFull\", [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $receiptFull -PathType Leaf)) {
        throw 'Source-quiesce receipt must be the exact protected cutover-journal file.'
    }
    $receiptItem = Get-Item -LiteralPath $receiptFull -Force
    if (($receiptItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        (Get-FileHash -LiteralPath $receiptFull -Algorithm SHA256).Hash -cne $SourceQuiesceReceiptSha256.ToUpperInvariant()) {
        throw 'Source-quiesce receipt path or SHA-256 is invalid.'
    }
    $sourceQuiesceReceipt = Get-Content -LiteralPath $receiptFull -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$sourceQuiesceReceipt.schemaVersion -ne 1 -or
        [string]$sourceQuiesceReceipt.project -cne 'easyfire-bookkeeping' -or
        [string]$sourceQuiesceReceipt.kind -cne 'easyfire-bookkeeping-source-quiesce-receipt' -or
        [string]$sourceQuiesceReceipt.status -cne 'quiesced-verified' -or
        -not [bool]$sourceQuiesceReceipt.proof.writerConnectionsAbsent -or
        -not [bool]$sourceQuiesceReceipt.preservation.noResourcesDeleted) {
        throw 'Source-quiesce receipt does not contain the required final-checkpoint authority.'
    }
} elseif ($SourceQuiesceReceiptPath -or $SourceQuiesceReceiptSha256) {
    throw 'Source-quiesce receipt inputs are accepted only in writers-stopped mode.'
}

$rootName = "direct-vm-preflight-$stamp"
$rootC = Join-Path 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\backups' $rootName
$rootH = Join-Path $SecondaryRoot $rootName

if (Test-Path -LiteralPath $rootC) {
    throw "Refusing existing checkpoint path: $rootC"
}
if (Test-Path -LiteralPath $rootH) {
    throw "Refusing existing checkpoint path: $rootH"
}

$secondaryDrive = Split-Path -Qualifier $SecondaryRoot
$secondaryVolume = Get-Volume -DriveLetter $secondaryDrive.TrimEnd(':')
if ($secondaryVolume.FileSystem -ne 'NTFS') {
    throw "Secondary checkpoint volume must be NTFS; found $($secondaryVolume.FileSystem)."
}

New-Item -ItemType Directory -Path $rootC -Force:$false | Out-Null
New-Item -ItemType Directory -Path $rootH -Force:$false | Out-Null

$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($root in @($rootC, $rootH)) {
    & icacls.exe $root /inheritance:r /grant:r `
        '*S-1-5-18:(OI)(CI)F' `
        '*S-1-5-32-544:(OI)(CI)F' `
        "*$currentUserSid`:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to restrict checkpoint ACL: $root"
    }
}

if ($RequireWritersStopped) {
    foreach ($name in $dataContainers) {
        $state = docker inspect --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' $name 2>$null
        if ($LASTEXITCODE -ne 0 -or $state -ne 'true|healthy') {
            throw "Required source data container is not running and healthy: $name"
        }
    }
    foreach ($name in $writerContainers) {
        $state = docker inspect --format '{{.State.Running}}|{{.HostConfig.RestartPolicy.Name}}' $name 2>$null
        if ($LASTEXITCODE -ne 0 -or $state -ne 'false|no') {
            throw "Stopped source writer restart policy must be no: $name"
        }
    }
    $mysqlWriterQuery = 'mariadb -u root -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --raw --execute="SELECT (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND USER NOT IN (''system user'',''event_scheduler'')),@@event_scheduler,(SELECT COUNT(*) FROM information_schema.EVENTS WHERE STATUS=''ENABLED'');"'
    $mysqlWriterProof = docker exec $mysql sh -lc $mysqlWriterQuery
    if ($LASTEXITCODE -ne 0 -or $mysqlWriterProof -ne "0`tOFF`t0") {
        throw "Source MariaDB writer-connection proof failed: expected no external connections, event_scheduler OFF, and zero enabled events."
    }
    $redisClients = @(docker exec $redis redis-cli --raw CLIENT LIST TYPE normal | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0 -or $redisClients.Count -ne 1) {
        throw "Source Redis external-client proof failed: observed $([Math]::Max(0, $redisClients.Count - 1))."
    }
} else {
    foreach ($name in $containers) {
        $running = docker inspect --format '{{.State.Running}}' $name 2>$null
        if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
            throw "Required live container is not running: $name"
        }
    }
}

$backupDir = Join-Path $rootC 'database'
$runtimeDir = Join-Path $rootC 'runtime'
$inputDir = Join-Path $rootC 'inputs'
$imageDir = Join-Path $rootC 'images'
$proofDir = Join-Path $rootC 'restore-proof'
New-Item -ItemType Directory -Path $backupDir, $runtimeDir, $inputDir, $imageDir, $proofDir | Out-Null

if ($RequireWritersStopped) {
    Copy-Item -LiteralPath $receiptFull -Destination (Join-Path $inputDir 'source-quiesce-receipt.json') -Force:$false
}

$databaseOutput = docker exec $mysql sh -c `
    "mariadb -u root -p`"`$MYSQL_ROOT_PASSWORD`" -N -e 'SHOW DATABASES;'"
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to enumerate live databases.'
}

$appDatabases = @(
    $databaseOutput |
        Where-Object { $_ -eq 'easyfire_system' -or $_ -like 'easyfire_tenant_*' } |
        Sort-Object -Unique
)
if (
    $appDatabases.Count -ne 2 -or
    $appDatabases[0] -ne 'easyfire_system' -or
    $appDatabases[1] -notlike 'easyfire_tenant_*'
) {
    throw "Ambiguous application database set: $($appDatabases -join ',')"
}

$containerBase = "/tmp/easyfire-$rootName"
$databaseArguments = $appDatabases -join ' '
$dumpCommand = "mariadb-dump --single-transaction --skip-lock-tables --quick --routines --triggers --events --hex-blob --add-drop-database --databases $databaseArguments -u root -p`"`$MYSQL_ROOT_PASSWORD`" > $containerBase.sql && gzip -c $containerBase.sql > $containerBase.sql.gz"
docker exec $mysql sh -c $dumpCommand | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Fresh MariaDB logical dump failed.'
}

$databaseBackup = Join-Path $backupDir "easyfire-app-$stamp.sql.gz"
docker cp "${mysql}:$containerBase.sql.gz" $databaseBackup | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $databaseBackup)) {
    throw 'Copying MariaDB dump to checkpoint failed.'
}

docker exec $redis redis-cli SAVE | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Redis SAVE failed.'
}
$redisBackup = Join-Path $backupDir "easyfire-redis-$stamp.rdb"
docker cp "${redis}:/data/dump.rdb" $redisBackup | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $redisBackup)) {
    throw 'Copying Redis snapshot to checkpoint failed.'
}

$containerInspect = docker inspect @containers
if ($LASTEXITCODE -ne 0) {
    throw 'Container inspection failed.'
}
$containerInspect |
    Set-Content -LiteralPath (Join-Path $runtimeDir 'containers.restricted.json') -Encoding utf8

foreach ($volume in @('easyfire_prod_mysql', 'easyfire_prod_redis')) {
    docker volume inspect $volume |
        Set-Content -LiteralPath (Join-Path $runtimeDir "$volume.json") -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        throw "Volume inspection failed: $volume"
    }
}

$taskRecords = foreach ($taskName in @(
    'easyfire-bookkeeping-prod-backup',
    'easyfire-bookkeeping-prod-startup'
)) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
    Export-ScheduledTask -TaskName $taskName |
        Set-Content -LiteralPath (Join-Path $runtimeDir "$taskName.xml") -Encoding utf8
    [pscustomobject]@{
        Name = $taskName
        State = [string]$task.State
        Enabled = $task.Settings.Enabled
        LastRunTime = $taskInfo.LastRunTime
        LastTaskResult = $taskInfo.LastTaskResult
        NextRunTime = $taskInfo.NextRunTime
    }
}
$taskRecords |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $runtimeDir 'scheduled-tasks.json') -Encoding utf8

$copyMap = @(
    @{
        Source = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\releases\E4210A54464D'
        Destination = 'release-E4210A54464D'
    },
    @{
        Source = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\onboarding\setup-prefix-repair-20260721'
        Destination = 'setup-prefix-repair-20260721'
    },
    @{
        Source = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\onboarding\setup-web-fix-20260721-015953'
        Destination = 'setup-web-fix-20260721-015953'
    },
    @{
        Source = 'C:\ProgramData\AgentFoundry\easyfire-bookkeeping\onboarding\patch-0b7d1af8-bbb6-4874-afa5-3f5bf8efdc78'
        Destination = 'patch-0b7d1af8-bbb6-4874-afa5-3f5bf8efdc78'
    }
)
foreach ($entry in $copyMap) {
    if (-not (Test-Path -LiteralPath $entry.Source)) {
        throw "Missing live runtime input: $($entry.Source)"
    }
    Copy-Item `
        -LiteralPath $entry.Source `
        -Destination (Join-Path $inputDir $entry.Destination) `
        -Recurse `
        -Force:$false
}

$patchedPath = '/app/packages/server/dist/modules/Tenancy/TenancyDB/TenancyDB.module.js'
docker cp `
    "easyfire-owner-onboarding-ca845969f4b2:$patchedPath" `
    (Join-Path $inputDir 'TenancyDB.module.live.js') | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Copying the live root-filesystem patch failed.'
}

$imageIds = @(
    $containers |
        ForEach-Object { docker inspect --format '{{.Image}}' $_ } |
        Sort-Object -Unique
)
$imageArchive = Join-Path $imageDir "active-images-$stamp.tar"
docker image save --output $imageArchive @imageIds
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $imageArchive)) {
    throw 'Active image export failed.'
}

$imageRecords = foreach ($name in $containers) {
    [pscustomobject]@{
        Container = $name
        ImageId = docker inspect --format '{{.Image}}' $name
        ImageRef = docker inspect --format '{{.Config.Image}}' $name
        RestartPolicy = docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' $name
        Running = docker inspect --format '{{.State.Running}}' $name
        Health = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $name
    }
}
$imageRecords |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $runtimeDir 'container-identities.json') -Encoding utf8

$restoreName = "easyfire-direct-vm-restore-$stamp"
$restoreVolume = "easyfire_direct_vm_restore_$($stamp -replace '-', '_')"
$existingRestoreContainer = @(
    docker container ls --all --format '{{.Names}}' |
        Where-Object { $_ -eq $restoreName }
)
if ($existingRestoreContainer.Count -ne 0) {
    throw "Restore container already exists: $restoreName"
}
$existingRestoreVolume = @(
    docker volume ls --quiet |
        Where-Object { $_ -eq $restoreVolume }
)
if ($existingRestoreVolume.Count -ne 0) {
    throw "Restore volume already exists: $restoreVolume"
}

$randomBytes = New-Object byte[] 36
$randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $randomNumberGenerator.GetBytes($randomBytes)
}
finally {
    $randomNumberGenerator.Dispose()
}
$restoreSecret = [Convert]::ToBase64String($randomBytes)
$mysqlImageId = docker inspect --format '{{.Image}}' $mysql
docker volume create $restoreVolume | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Creating the isolated restore volume failed.'
}
docker run -d `
    --name $restoreName `
    --network none `
    --mount "type=volume,src=$restoreVolume,dst=/var/lib/mysql" `
    -e "MARIADB_ROOT_PASSWORD=$restoreSecret" `
    -e "MYSQL_ROOT_PASSWORD=$restoreSecret" `
    $mysqlImageId | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Starting the isolated restore container failed.'
}

$ready = $false
for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $readinessCommand = "mariadb -u`"`$MYSQL_USER`" -p`"`$MYSQL_PASSWORD`" -N -e 'SELECT 1;'"
    docker exec $restoreName sh -c `
        $readinessCommand 2>$null | Out-Null
    $readinessExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($readinessExitCode -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    throw 'Isolated restore MariaDB did not become ready.'
}

docker cp $databaseBackup "${restoreName}:/tmp/restore.sql.gz" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Copying the dump into the isolated restore container failed.'
}
docker exec $restoreName sh -c `
    'gzip -dc /tmp/restore.sql.gz | mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD"' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Isolated database restore failed.'
}

$checkOutput = docker exec $restoreName sh -c `
    'mariadb-check -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --all-databases --check'
if ($LASTEXITCODE -ne 0) {
    throw 'Isolated mariadb-check failed.'
}

$systemTableCountCommand = "mariadb -u`"`$MYSQL_USER`" -p`"`$MYSQL_PASSWORD`" -D easyfire_system -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();'"
$systemTableCount = docker exec $restoreName sh -c $systemTableCountCommand
if ($LASTEXITCODE -ne 0 -or $systemTableCount -ne '17') {
    throw "Isolated system table-count query failed: $systemTableCount"
}
$tenantTableCountCommand = "mariadb -u`"`$MYSQL_USER`" -p`"`$MYSQL_PASSWORD`" -D $($appDatabases[1]) -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();'"
$tenantTableCount = docker exec $restoreName sh -c $tenantTableCountCommand
if ($LASTEXITCODE -ne 0 -or $tenantTableCount -ne '70') {
    throw "Isolated tenant table-count query failed: $tenantTableCount"
}
$schemaCounts = @(
    "easyfire_system`t$systemTableCount",
    "$($appDatabases[1])`t$tenantTableCount"
)

$invariantsCommand = "mariadb -u`"`$MYSQL_USER`" -p`"`$MYSQL_PASSWORD`" -D easyfire_system -N -e 'SELECT (SELECT COUNT(*) FROM USERS),(SELECT COUNT(*) FROM TENANTS),(SELECT COUNT(*) FROM TENANTS_METADATA),(SELECT COUNT(*) FROM USER_TENANTS);'"
$invariants = docker exec $restoreName sh -c `
    $invariantsCommand
if ($LASTEXITCODE -ne 0 -or $invariants -ne "1`t1`t1`t1") {
    throw "Restored identity invariants failed: $invariants"
}

$proof = [ordered]@{
    schemaVersion = 1
    status = 'passed'
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceHost = $env:COMPUTERNAME
    sourceContainer = $mysql
    sourceImage = $mysqlImageId
    sourceVolume = 'easyfire_prod_mysql'
    databases = $appDatabases
    backupFile = Split-Path $databaseBackup -Leaf
    backupBytes = (Get-Item -LiteralPath $databaseBackup).Length
    backupSha256 = (Get-FileHash -LiteralPath $databaseBackup -Algorithm SHA256).Hash
    redisFile = Split-Path $redisBackup -Leaf
    redisBytes = (Get-Item -LiteralPath $redisBackup).Length
    redisSha256 = (Get-FileHash -LiteralPath $redisBackup -Algorithm SHA256).Hash
    restoreContainer = $restoreName
    restoreVolume = $restoreVolume
    restoreNetwork = 'none'
    restoreState = 'stopped-preserved'
    schemaTableCounts = $schemaCounts
    identityInvariants = 'users=1;tenants=1;tenant_metadata=1;user_tenants=1'
    mariadbCheckLineCount = @($checkOutput).Count
}
$proof |
    ConvertTo-Json -Depth 7 |
    Set-Content -LiteralPath (Join-Path $proofDir 'isolated-restore-proof.json') -Encoding utf8

docker stop --time 30 $restoreName | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Stopping the preserved restore container failed.'
}

$checkpoint = [ordered]@{
    schemaVersion = 1
    checkpointId = $rootName
    status = 'preflight-verified'
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    host = $env:COMPUTERNAME
    intent = 'Direct-to-VM migration recovery checkpoint; no source runtime resources removed.'
    liveEndpoint = 'http://100.84.66.30:25186'
    databaseCount = $appDatabases.Count
    databaseNames = $appDatabases
    activeContainers = $imageRecords
    sourceVolumes = @('easyfire_prod_mysql', 'easyfire_prod_redis')
    preservedRestoreContainer = $restoreName
    preservedRestoreVolume = $restoreVolume
    secondaryCopy = $rootH
}
$checkpoint |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $rootC 'checkpoint.json') -Encoding utf8

$hashRecords = Get-ChildItem -LiteralPath $rootC -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
        [pscustomobject]@{
            Path = $_.FullName.Substring($rootC.Length).TrimStart('\')
            Bytes = $_.Length
            Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }
$hashRecords |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $rootC 'files.sha256.json') -Encoding utf8

Copy-Item -Path (Join-Path $rootC '*') -Destination $rootH -Recurse -Force:$false

$primaryFiles = Get-ChildItem -LiteralPath $rootC -Recurse -File | Sort-Object FullName
$comparison = foreach ($file in $primaryFiles) {
    $relative = $file.FullName.Substring($rootC.Length).TrimStart('\')
    $secondaryFile = Join-Path $rootH $relative
    if (-not (Test-Path -LiteralPath $secondaryFile)) {
        throw "Secondary checkpoint copy is missing: $relative"
    }
    $primaryHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    $secondaryHash = (Get-FileHash -LiteralPath $secondaryFile -Algorithm SHA256).Hash
    if ($primaryHash -ne $secondaryHash) {
        throw "Secondary checkpoint hash mismatch: $relative"
    }
    [pscustomobject]@{
        Path = $relative
        Bytes = $file.Length
        Sha256 = $primaryHash
    }
}

$verification = [ordered]@{
    schemaVersion = 1
    status = 'passed'
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
    primary = $rootC
    secondary = $rootH
    fileCount = @($comparison).Count
    totalBytes = ($comparison | Measure-Object Bytes -Sum).Sum
    checkpointSha256 = (
        Get-FileHash -LiteralPath (Join-Path $rootC 'checkpoint.json') -Algorithm SHA256
    ).Hash
}
$verification |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $rootC 'dual-location-verification.json') -Encoding utf8
$verification |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $rootH 'dual-location-verification.json') -Encoding utf8

[pscustomobject]@{
    Status = 'passed'
    Primary = $rootC
    Secondary = $rootH
    BackupSha256 = $proof.backupSha256
    RedisSha256 = $proof.redisSha256
    RestoreContainer = $restoreName
    RestoreVolume = $restoreVolume
    FileCount = $verification.fileCount
    TotalBytes = $verification.totalBytes
    CheckpointSha256 = $verification.checkpointSha256
} | ConvertTo-Json -Compress
