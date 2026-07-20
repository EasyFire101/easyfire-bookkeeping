Set-StrictMode -Version Latest

if (-not ('EasyFireBookkeeping.NativePathAuthority' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace EasyFireBookkeeping
{
    public static class NativePathAuthority
    {
        private const uint FileShareRead = 0x00000001;
        private const uint FileShareWrite = 0x00000002;
        private const uint FileShareDelete = 0x00000004;
        private const uint OpenExisting = 3;
        private const uint FileAttributeDirectory = 0x00000010;
        private const uint FileAttributeReparsePoint = 0x00000400;
        private const uint InvalidFileAttributes = 0xFFFFFFFF;
        private const uint FileFlagBackupSemantics = 0x02000000;
        private const uint FileFlagOpenReparsePoint = 0x00200000;
        private const int FileIdInfo = 18;
        private const uint VolumeNameGuid = 0x1;
        private const uint VolumeNameNt = 0x2;

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeFileTime
        {
            public uint LowDateTime;
            public uint HighDateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ByHandleFileInformation
        {
            public uint FileAttributes;
            public NativeFileTime CreationTime;
            public NativeFileTime LastAccessTime;
            public NativeFileTime LastWriteTime;
            public uint VolumeSerialNumber;
            public uint FileSizeHigh;
            public uint FileSizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFileAttributesW(string fileName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(
            SafeFileHandle file,
            out ByHandleFileInformation information);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandleEx(
            SafeFileHandle file,
            int informationClass,
            IntPtr information,
            uint bufferSize);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder path,
            uint pathLength,
            uint flags);

        private static string NormalizeInput(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("An authority path is required.", "path");
            }

            try
            {
                return Path.GetFullPath(path);
            }
            catch (Exception error)
            {
                throw new InvalidOperationException("Could not resolve the authority path: " + path, error);
            }
        }

        private static string ToExtendedPath(string path)
        {
            if (path.StartsWith(@"\\?\", StringComparison.Ordinal) ||
                path.StartsWith(@"\\.\", StringComparison.Ordinal))
            {
                return path;
            }
            if (path.StartsWith(@"\\", StringComparison.Ordinal))
            {
                return @"\\?\UNC\" + path.Substring(2);
            }
            return @"\\?\" + path;
        }

        private static IEnumerable<string> GetPathChain(string fullPath)
        {
            string root = Path.GetPathRoot(fullPath);
            if (String.IsNullOrEmpty(root))
            {
                throw new InvalidOperationException("The authority path does not have a resolvable Windows root: " + fullPath);
            }

            yield return root;
            string current = root;
            string remainder = fullPath.Substring(root.Length);
            string[] components = remainder.Split(
                new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
                StringSplitOptions.RemoveEmptyEntries);
            foreach (string component in components)
            {
                current = Path.Combine(current, component);
                yield return current;
            }
        }

        private static uint GetValidatedAttributes(string path)
        {
            uint attributes = GetFileAttributesW(ToExtendedPath(path));
            if (attributes == InvalidFileAttributes)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not resolve every component of the authority path: " + path);
            }
            if ((attributes & FileAttributeReparsePoint) != 0)
            {
                throw new InvalidOperationException(
                    "Reparse points are not allowed in an authority path: " + path);
            }
            return attributes;
        }

        private static SafeFileHandle OpenValidated(string path, bool requireDirectory)
        {
            string fullPath = NormalizeInput(path);
            uint attributes = 0;
            foreach (string component in GetPathChain(fullPath))
            {
                attributes = GetValidatedAttributes(component);
            }

            bool isDirectory = (attributes & FileAttributeDirectory) != 0;
            if (requireDirectory != isDirectory)
            {
                throw new InvalidOperationException(
                    requireDirectory
                        ? "The authority root is not a directory: " + fullPath
                        : "The executable authority path is not a regular file: " + fullPath);
            }

            SafeFileHandle handle = CreateFileW(
                ToExtendedPath(fullPath),
                0,
                FileShareRead | FileShareWrite | FileShareDelete,
                IntPtr.Zero,
                OpenExisting,
                FileFlagBackupSemantics | FileFlagOpenReparsePoint,
                IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error, "Could not open the authority path: " + fullPath);
            }

            ByHandleFileInformation information;
            if (!GetFileInformationByHandle(handle, out information))
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error, "Could not inspect the authority path: " + fullPath);
            }
            if ((information.FileAttributes & FileAttributeReparsePoint) != 0)
            {
                handle.Dispose();
                throw new InvalidOperationException(
                    "Reparse points are not allowed in an authority path: " + fullPath);
            }
            bool openedDirectory = (information.FileAttributes & FileAttributeDirectory) != 0;
            if (openedDirectory != requireDirectory)
            {
                handle.Dispose();
                throw new InvalidOperationException("The authority path type changed while it was being inspected: " + fullPath);
            }
            return handle;
        }

        public static string GetDirectoryIdentity(string path)
        {
            using (SafeFileHandle handle = OpenValidated(path, true))
            {
                const int size = 24;
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    if (!GetFileInformationByHandleEx(handle, FileIdInfo, buffer, size))
                    {
                        throw new Win32Exception(
                            Marshal.GetLastWin32Error(),
                            "The file system could not provide a stable physical identity for the authority root.");
                    }

                    ulong volumeSerial = unchecked((ulong)Marshal.ReadInt64(buffer, 0));
                    byte[] fileId = new byte[16];
                    Marshal.Copy(IntPtr.Add(buffer, 8), fileId, 0, fileId.Length);
                    bool hasFileId = false;
                    foreach (byte value in fileId)
                    {
                        if (value != 0)
                        {
                            hasFileId = true;
                            break;
                        }
                    }
                    if (!hasFileId)
                    {
                        throw new InvalidOperationException(
                            "The file system returned an unresolved physical identity for the authority root.");
                    }
                    return volumeSerial.ToString("X16") + "-" + BitConverter.ToString(fileId).Replace("-", "");
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
        }

        public static string GetCanonicalFilePath(string path)
        {
            using (SafeFileHandle handle = OpenValidated(path, false))
            {
                int lastError = 0;
                foreach (uint volumeName in new[] { VolumeNameGuid, VolumeNameNt })
                {
                    int capacity = 512;
                    while (true)
                    {
                        StringBuilder output = new StringBuilder(capacity);
                        uint length = GetFinalPathNameByHandleW(handle, output, (uint)capacity, volumeName);
                        if (length == 0)
                        {
                            lastError = Marshal.GetLastWin32Error();
                            break;
                        }
                        if (length < capacity)
                        {
                            return output.ToString();
                        }
                        if (length >= Int32.MaxValue - 1)
                        {
                            throw new InvalidOperationException("The canonical executable authority path is too long.");
                        }
                        capacity = checked((int)length + 1);
                    }
                }
                throw new Win32Exception(lastError, "Could not derive the canonical executable authority path.");
            }
        }
    }
}
'@
}

function Get-EasyFireProductionMutexName {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ProductionRoot)

    $ErrorActionPreference = 'Stop'
    $physicalIdentity = [EasyFireBookkeeping.NativePathAuthority]::GetDirectoryIdentity($ProductionRoot)
    return "Global\EasyFireBookkeepingProduction-$physicalIdentity"
}

function Get-EasyFireBackupMutexName {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ProductionRoot)

    $productionName = Get-EasyFireProductionMutexName -ProductionRoot $ProductionRoot
    return $productionName.Replace('EasyFireBookkeepingProduction-', 'EasyFireBookkeepingBackup-')
}

function Get-EasyFireStateFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Get-EasyFireExecutableBundleAuthority {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    $ErrorActionPreference = 'Stop'
    if ($Paths.Count -eq 0) {
        throw 'At least one exact executable path is required.'
    }

    $shaByPath = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $canonicalPaths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($path in $Paths) {
        $canonicalPath = [EasyFireBookkeeping.NativePathAuthority]::GetCanonicalFilePath($path)
        if ($shaByPath.ContainsKey($canonicalPath)) {
            throw "Duplicate canonical executable authority path: $canonicalPath"
        }
        $shaByPath.Add($canonicalPath, (Get-EasyFireStateFileSha256 -Path $canonicalPath))
        $canonicalPaths.Add($canonicalPath)
    }

    $orderedPaths = $canonicalPaths.ToArray()
    [System.Array]::Sort($orderedPaths, [System.StringComparer]::OrdinalIgnoreCase)
    $files = @(
        foreach ($canonicalPath in $orderedPaths) {
            [pscustomobject]@{
                Path = $canonicalPath
                Sha256 = $shaByPath[$canonicalPath]
            }
        }
    )
    $canonicalBundle = ($files | ForEach-Object { "$($_.Sha256)  $($_.Path)" }) -join "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fingerprint = ([BitConverter]::ToString(
            $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonicalBundle))
        )).Replace('-', '')
    } finally {
        $sha.Dispose()
    }

    return [pscustomobject]@{
        SchemaVersion = 1
        Files = [object[]]$files
        FingerprintSha256 = $fingerprint
    }
}

function Assert-EasyFireExecutableBundleAuthority {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$ExpectedAuthority,
        [Parameter(Mandatory = $true)][string[]]$Paths
    )

    if ([int]$ExpectedAuthority.SchemaVersion -ne 1) {
        throw 'Executable bundle authority schema is not supported.'
    }
    $expectedFiles = @($ExpectedAuthority.Files)
    $actual = Get-EasyFireExecutableBundleAuthority -Paths $Paths
    if ($expectedFiles.Count -ne $actual.Files.Count) {
        throw 'Executable bundle authority file count does not match.'
    }
    for ($index = 0; $index -lt $actual.Files.Count; $index++) {
        $expectedFile = $expectedFiles[$index]
        $actualFile = $actual.Files[$index]
        if (-not [string]::Equals([string]$expectedFile.Path, [string]$actualFile.Path, [StringComparison]::OrdinalIgnoreCase) -or
            [string]$expectedFile.Sha256 -cne [string]$actualFile.Sha256) {
            throw "Executable bundle authority does not match at index $index."
        }
    }
    if ([string]$ExpectedAuthority.FingerprintSha256 -cne [string]$actual.FingerprintSha256) {
        throw 'Executable bundle fingerprint does not match.'
    }
    return $true
}

function ConvertTo-EasyFireCanonicalActionId {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ActionId)

    $parsed = [System.Guid]::Empty
    if (-not [System.Guid]::TryParseExact($ActionId, 'D', [ref]$parsed)) {
        throw "ActionId must be a canonical GUID in D format."
    }
    $canonical = $parsed.ToString('D')
    if ($ActionId -cne $canonical) {
        throw "ActionId must use canonical lowercase GUID form: $canonical"
    }
    return $canonical
}

function Resolve-EasyFireContainedPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot,
        [switch]$MustExist
    )

    $rootFull = [System.IO.Path]::GetFullPath($AllowedRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    $rootPrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    if ($pathFull -ne $rootFull -and -not $pathFull.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes the allowed root. Path: $pathFull Root: $rootFull"
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $pathFull)) {
        throw "Required path does not exist: $pathFull"
    }
    return $pathFull
}

function Get-EasyFireJournalPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProductionRoot,
        [Parameter(Mandatory = $true)][string]$ActionId
    )

    $canonical = ConvertTo-EasyFireCanonicalActionId -ActionId $ActionId
    $journalsRoot = Join-Path ([System.IO.Path]::GetFullPath($ProductionRoot)) 'journals'
    return Resolve-EasyFireContainedPath -Path (Join-Path $journalsRoot "$canonical.json") -AllowedRoot $journalsRoot
}

function Get-EasyFireReleaseDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProductionRoot,
        [Parameter(Mandatory = $true)][string]$ArchiveSha256
    )

    if ($ArchiveSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw "ArchiveSha256 must contain exactly 64 hexadecimal characters."
    }
    $releasesRoot = Join-Path ([System.IO.Path]::GetFullPath($ProductionRoot)) 'releases'
    return Resolve-EasyFireContainedPath -Path (Join-Path $releasesRoot $ArchiveSha256.Substring(0, 12).ToUpperInvariant()) -AllowedRoot $releasesRoot
}

function Test-EasyFireReparsePoint {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Assert-EasyFireNoReparsePathChain {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$TrustedRoot
    )

    $rootFull = [System.IO.Path]::GetFullPath($TrustedRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $pathFull = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $rootFull
    $current = $pathFull
    while ($true) {
        if (Test-Path -LiteralPath $current) {
            if (Test-EasyFireReparsePoint -Path $current) {
                throw "Reparse points are not allowed in the production authority path: $current"
            }
        }
        if ($current -eq $rootFull) { break }
        $parent = [System.IO.Directory]::GetParent($current)
        if (-not $parent) { throw "Could not walk the production authority path to its trusted root." }
        $current = $parent.FullName
    }
    return $true
}

function Get-EasyFireJournalReleaseManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ReleaseDirectory)

    $root = (Resolve-Path -LiteralPath $ReleaseDirectory -ErrorAction Stop).Path.TrimEnd('\')
    $entryList = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -Force) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Release contains a reparse point."
        }
        if ($item.PSIsContainer) { continue }
        $relative = $item.FullName.Substring($root.Length).TrimStart('\').Replace('\', '/')
        if ($relative -ieq '.env') { continue }
        $stream = [System.IO.File]::OpenRead($item.FullName)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
        } finally {
            $sha.Dispose()
            $stream.Dispose()
        }
        $entryList.Add([pscustomobject]@{ Path = $relative; Length = [int64]$item.Length; Sha256 = $hash })
    }
    $entries = @($entryList.ToArray() | Sort-Object Path)
    $canonical = ($entries | ForEach-Object { "$($_.Sha256)  $($_.Length)  $($_.Path)" }) -join "`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $manifestHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
    return [pscustomobject]@{ SchemaVersion = 1; FileCount = $entries.Count; Sha256 = $manifestHash }
}

function Test-EasyFireProductionJournal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Journal,
        [Parameter(Mandatory = $true)][string]$ExpectedActionId,
        [Parameter(Mandatory = $true)][string]$ProductionRoot,
        [string]$ProjectName = 'easyfire-bookkeeping-prod',
        [string[]]$AllowedStatuses = @('completed'),
        [bool]$RequireReleaseFiles = $true
    )

    try {
        $canonical = ConvertTo-EasyFireCanonicalActionId -ActionId $ExpectedActionId
        if ([int]$Journal.SchemaVersion -ne 2) { throw 'Journal SchemaVersion must be 2.' }
        if ([string]$Journal.ActionId -cne $canonical) { throw 'Journal ActionId does not match its authority filename.' }
        if ([string]$Journal.ProjectName -cne $ProjectName) { throw 'Journal ProjectName mismatch.' }
        if ([string]$Journal.Stage -cne 'Action') { throw 'Journal Stage must be Action.' }
        if ([string]$Journal.status -notin $AllowedStatuses) { throw 'Journal status is not allowed.' }
        $authorityOwnerSid = [string]$Journal.AuthorityOwnerSid
        try {
            $canonicalAuthorityOwnerSid = [string](New-Object Security.Principal.SecurityIdentifier($authorityOwnerSid)).Value
        } catch {
            throw 'Journal AuthorityOwnerSid is invalid.'
        }
        if ($authorityOwnerSid -cne $canonicalAuthorityOwnerSid) {
            throw 'Journal AuthorityOwnerSid is not canonical.'
        }
        $sha = [string]$Journal.ReleaseArchive.Sha256
        if ($sha -notmatch '^[A-F0-9]{64}$') { throw 'Journal archive SHA-256 is invalid.' }
        $expectedRelease = Get-EasyFireReleaseDirectory -ProductionRoot $ProductionRoot -ArchiveSha256 $sha
        $storedRelease = Resolve-EasyFireContainedPath -Path ([string]$Journal.ReleaseArchive.ExtractDir) -AllowedRoot (Join-Path $ProductionRoot 'releases')
        if ($storedRelease -cne $expectedRelease) { throw 'Journal release directory is not derived from its archive hash.' }
        $null = Assert-EasyFireNoReparsePathChain -Path $storedRelease -TrustedRoot $ProductionRoot
        if (Test-Path -LiteralPath $storedRelease) {
            if (-not (Test-Path -LiteralPath $storedRelease -PathType Container)) { throw 'Journal release path is not a directory.' }
            if (Test-EasyFireReparsePoint -Path $storedRelease) { throw 'Journal release directory cannot be a reparse point.' }
        } elseif ($RequireReleaseFiles) {
            throw 'Journal release directory is missing.'
        }
        if ($RequireReleaseFiles) {
            foreach ($relative in @('.env', 'docker-compose.prod.yml', 'scripts\production\backup.ps1', 'scripts\production\restore-verify.ps1')) {
                $required = Resolve-EasyFireContainedPath -Path (Join-Path $storedRelease $relative) -AllowedRoot $storedRelease -MustExist
                if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required release file is not a regular file: $relative" }
                $null = Assert-EasyFireNoReparsePathChain -Path $required -TrustedRoot $storedRelease
            }
            if ([string]$Journal.EnvironmentSha256 -notmatch '^[A-F0-9]{64}$') {
                throw 'Journal environment SHA-256 authority is missing or invalid.'
            }
            $environmentHash = Get-EasyFireStateFileSha256 -Path (Join-Path $storedRelease '.env')
            if ($environmentHash -cne [string]$Journal.EnvironmentSha256) {
                throw 'Runtime environment no longer matches the journal authority.'
            }
            if (-not $Journal.ReleaseManifest -or [int]$Journal.ReleaseManifest.SchemaVersion -ne 1 -or `
                [string]$Journal.ReleaseManifest.Sha256 -notmatch '^[A-F0-9]{64}$' -or `
                [int]$Journal.ReleaseManifest.FileCount -lt 1) {
                throw 'Journal release manifest authority is missing or invalid.'
            }
            $journalsRoot = Join-Path $ProductionRoot 'journals'
            $expectedManifestPath = Join-Path $journalsRoot "$canonical.release-manifest.json"
            $manifestPath = Resolve-EasyFireContainedPath -Path ([string]$Journal.ReleaseManifest.Path) -AllowedRoot $journalsRoot -MustExist
            if ($manifestPath -cne $expectedManifestPath) { throw 'Journal release manifest path is not ActionId-derived.' }
            if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or (Test-EasyFireReparsePoint -Path $manifestPath)) {
                throw 'Journal release manifest file is missing or unsafe.'
            }
            $null = Assert-EasyFireNoReparsePathChain -Path $manifestPath -TrustedRoot $journalsRoot
            $manifestDocument = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ([int]$manifestDocument.SchemaVersion -ne 1 -or [string]$manifestDocument.ActionId -cne $canonical -or
                [string]$manifestDocument.ArchiveSha256 -cne $sha -or [int]$manifestDocument.Manifest.SchemaVersion -ne 1 -or
                [string]$manifestDocument.Manifest.Sha256 -cne [string]$Journal.ReleaseManifest.Sha256 -or
                [int]$manifestDocument.Manifest.FileCount -ne [int]$Journal.ReleaseManifest.FileCount) {
                throw 'Release manifest document is not bound to the journal authority.'
            }
            $actualManifest = Get-EasyFireJournalReleaseManifest -ReleaseDirectory $storedRelease
            if ($actualManifest.Sha256 -cne [string]$Journal.ReleaseManifest.Sha256 -or
                $actualManifest.FileCount -ne [int]$Journal.ReleaseManifest.FileCount) {
                throw 'Release contents do not match the journal release manifest.'
            }
        }
        return [pscustomobject]@{ Valid = $true; Reason = 'release_verified'; ReleaseDirectory = $storedRelease; Sha256 = $sha.ToUpperInvariant() }
    } catch {
        return [pscustomobject]@{ Valid = $false; Reason = $_.Exception.Message }
    }
}

function Get-EasyFireDatabaseReleaseDecision {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][bool]$HasExistingVolume,
        [bool]$PriorJournalValid = $false,
        [string]$ObservedEngineVersion,
        [string]$PriorEngineVersion,
        [string]$ObservedImageId,
        [string]$PriorImageId,
        [string]$ObservedVolumeName,
        [string]$PriorVolumeName,
        [string]$CandidateEngineVersion = '11.8.6'
    )

    if (-not $HasExistingVolume) {
        return [pscustomobject]@{ Allowed = $true; Mode = 'fresh'; Reason = 'no_existing_volume' }
    }
    return [pscustomobject]@{ Allowed = $false; Mode = 'blocked'; Reason = 'DATABASE_ENGINE_MIGRATION_REQUIRED' }
}

Export-ModuleMember -Function Get-EasyFireProductionMutexName, Get-EasyFireBackupMutexName, Get-EasyFireExecutableBundleAuthority, Assert-EasyFireExecutableBundleAuthority, ConvertTo-EasyFireCanonicalActionId, Resolve-EasyFireContainedPath, Get-EasyFireJournalPath, Get-EasyFireReleaseDirectory, Test-EasyFireReparsePoint, Assert-EasyFireNoReparsePathChain, Test-EasyFireProductionJournal, Get-EasyFireDatabaseReleaseDecision
