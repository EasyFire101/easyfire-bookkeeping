Set-StrictMode -Version Latest

function Get-EasyFireSha256Hex {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $stream = $null
    $sha256 = $null
    try {
        $stream = [System.IO.File]::OpenRead($resolved)
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
        if ($sha256) { $sha256.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}

function Test-EasyFireGzipIntegrity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $inputStream = $null
    $gzipStream = $null
    try {
        $inputStream = [System.IO.File]::OpenRead($resolved)
        $gzipStream = New-Object System.IO.Compression.GZipStream(
            $inputStream,
            [System.IO.Compression.CompressionMode]::Decompress,
            $false
        )
        $buffer = New-Object byte[] 65536
        while ($gzipStream.Read($buffer, 0, $buffer.Length) -gt 0) {}
        return $true
    } catch {
        return $false
    } finally {
        if ($gzipStream) { $gzipStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
    }
}

function Get-EasyFireBackupSidecarPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$BackupFile)

    if ([System.IO.Path]::GetFileName($BackupFile) -notmatch '\.sql\.gz$') {
        throw "Backup file must end in .sql.gz: $BackupFile"
    }
    return ($BackupFile -replace '\.sql\.gz$', '.sha256')
}

function Test-EasyFireBackupPair {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$BackupFile)

    try {
        if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
            return [pscustomobject]@{ Valid = $false; Reason = 'backup_missing'; BackupFile = $BackupFile }
        }
        $resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
        $sidecar = Get-EasyFireBackupSidecarPath -BackupFile $resolvedBackup
        if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
            return [pscustomobject]@{ Valid = $false; Reason = 'sidecar_missing'; BackupFile = $resolvedBackup; SidecarFile = $sidecar }
        }
        $content = (Get-Content -LiteralPath $sidecar -Raw -ErrorAction Stop).Trim()
        if ($content -notmatch '^([A-Fa-f0-9]{64})\s+([^\r\n]+)$') {
            return [pscustomobject]@{ Valid = $false; Reason = 'sidecar_malformed'; BackupFile = $resolvedBackup; SidecarFile = $sidecar }
        }
        $expectedHash = $Matches[1].ToUpperInvariant()
        $expectedName = $Matches[2].Trim()
        $actualName = [System.IO.Path]::GetFileName($resolvedBackup)
        if ($expectedName -ne $actualName) {
            return [pscustomobject]@{ Valid = $false; Reason = 'sidecar_filename_mismatch'; BackupFile = $resolvedBackup; SidecarFile = $sidecar }
        }
        $actualHash = (Get-EasyFireSha256Hex -Path $resolvedBackup).ToUpperInvariant()
        if ($expectedHash -ne $actualHash) {
            return [pscustomobject]@{ Valid = $false; Reason = 'hash_mismatch'; BackupFile = $resolvedBackup; SidecarFile = $sidecar }
        }
        if (-not (Test-EasyFireGzipIntegrity -Path $resolvedBackup)) {
            return [pscustomobject]@{ Valid = $false; Reason = 'gzip_invalid'; BackupFile = $resolvedBackup; SidecarFile = $sidecar; Sha256 = $actualHash }
        }
        return [pscustomobject]@{
            Valid = $true
            Reason = 'verified'
            BackupFile = $resolvedBackup
            SidecarFile = $sidecar
            Sha256 = $actualHash
        }
    } catch {
        return [pscustomobject]@{ Valid = $false; Reason = "validation_error: $($_.Exception.Message)"; BackupFile = $BackupFile }
    }
}

Export-ModuleMember -Function Get-EasyFireSha256Hex, Test-EasyFireGzipIntegrity, Get-EasyFireBackupSidecarPath, Test-EasyFireBackupPair
