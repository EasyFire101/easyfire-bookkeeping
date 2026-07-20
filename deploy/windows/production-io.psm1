Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot '..\..\scripts\production\backup-integrity.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'production-state.psm1') -Force -ErrorAction Stop

function Get-EasyFireMemberValue {
    [CmdletBinding()]
    param(
        [AllowNull()]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties.Item($Name)
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Test-EasyFireSecretEqual {
    [CmdletBinding()]
    param([string]$Left, [string]$Right)
    if ($null -eq $Left -or $null -eq $Right) { return $false }
    $leftBytes = [System.Text.Encoding]::UTF8.GetBytes($Left)
    $rightBytes = [System.Text.Encoding]::UTF8.GetBytes($Right)
    $different = $leftBytes.Length -bxor $rightBytes.Length
    $count = [Math]::Max($leftBytes.Length, $rightBytes.Length)
    for ($index = 0; $index -lt $count; $index++) {
        $leftByte = if ($index -lt $leftBytes.Length) { $leftBytes[$index] } else { 0 }
        $rightByte = if ($index -lt $rightBytes.Length) { $rightBytes[$index] } else { 0 }
        $different = $different -bor ($leftByte -bxor $rightByte)
    }
    return ($different -eq 0)
}

function Get-EasyFireTextSha256 {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Assert-EasyFireImageReference {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Reference)

    if ($Reference.Length -gt 255 -or $Reference -match '[\s\x00-\x1f\x7f]' -or $Reference.StartsWith('-')) {
        throw "Expected image reference is malformed."
    }
    $name = ''
    if ($Reference -match '@sha256:[a-f0-9]{64}$') {
        $name = $Reference.Substring(0, $Reference.LastIndexOf('@'))
    } else {
        $lastSlash = $Reference.LastIndexOf('/')
        $lastColon = $Reference.LastIndexOf(':')
        if ($lastColon -le $lastSlash -or
            $Reference.Substring($lastColon + 1) -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
            throw "Expected image reference must contain an exact tag or sha256 digest."
        }
        $name = $Reference.Substring(0, $lastColon)
    }
    $segments = @($name.Split('/'))
    if ($segments.Count -eq 0 -or @($segments | Where-Object { -not $_ }).Count -ne 0) {
        throw "Expected image repository name is malformed."
    }
    for ($index = 0; $index -lt $segments.Count; $index++) {
        $segment = [string]$segments[$index]
        $validRepositorySegment = $segment -match '^[a-z0-9]+(?:(?:[._-]+)[a-z0-9]+)*$'
        $validRegistrySegment = ($index -eq 0 -and
            $segment -match '^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?$')
        if (-not $validRepositorySegment -and -not $validRegistrySegment) {
            throw "Expected image repository name is malformed."
        }
    }
    return $Reference
}

function Get-EasyFireImageAuthorityCanonical {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Authority)

    if ([int](Get-EasyFireMemberValue -Object $Authority -Name 'SchemaVersion' -Default 0) -ne 1) {
        throw 'Expected image authority schema is invalid.'
    }
    $images = @((Get-EasyFireMemberValue -Object $Authority -Name 'Images' -Default @()))
    if ($images.Count -eq 0 -or
        [int](Get-EasyFireMemberValue -Object $Authority -Name 'ImageCount' -Default -1) -ne $images.Count) {
        throw 'Expected image authority count is invalid.'
    }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $canonicalRows = New-Object 'System.Collections.Generic.List[string]'
    $canonicalMap = New-Object 'System.Collections.Generic.SortedDictionary[string,string]' ([StringComparer]::Ordinal)
    foreach ($image in $images) {
        $reference = [string](Get-EasyFireMemberValue -Object $image -Name 'Reference' -Default '')
        $imageId = [string](Get-EasyFireMemberValue -Object $image -Name 'ImageId' -Default '')
        $null = Assert-EasyFireImageReference -Reference $reference
        if (-not $seen.Add($reference) -or $imageId -notmatch '^sha256:[a-f0-9]{64}$') {
            throw 'Expected image authority contains a duplicate reference or malformed image ID.'
        }
        $canonicalMap.Add($reference, $imageId)
    }
    $sortedImages = @($canonicalMap.GetEnumerator() | ForEach-Object {
        [pscustomobject]@{ Reference = [string]$_.Key; ImageId = [string]$_.Value }
    })
    foreach ($image in $sortedImages) {
        $canonicalRows.Add("image|$($image.Reference)|$($image.ImageId)")
    }
    $fingerprint = Get-EasyFireTextSha256 -Text ($canonicalRows -join "`n")
    if ([string](Get-EasyFireMemberValue -Object $Authority -Name 'Fingerprint' -Default '') -cne $fingerprint) {
        throw 'Expected image authority fingerprint is invalid.'
    }

    $map = Get-EasyFireMemberValue -Object $Authority -Name 'ReferenceToImageId'
    if ($null -eq $map) { throw 'Expected image authority map is missing.' }
    $mapRows = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    if ($map -is [System.Collections.IDictionary]) {
        foreach ($key in @($map.Keys)) {
            if ($mapRows.ContainsKey([string]$key)) {
                throw 'Expected image authority map contains duplicate references.'
            }
            $mapRows.Add([string]$key, [string]$map[$key])
        }
    } else {
        foreach ($property in @($map.PSObject.Properties)) {
            if ($mapRows.ContainsKey([string]$property.Name)) {
                throw 'Expected image authority map contains duplicate references.'
            }
            $mapRows.Add([string]$property.Name, [string]$property.Value)
        }
    }
    if ($mapRows.Count -ne $sortedImages.Count) { throw 'Expected image authority map count is invalid.' }
    foreach ($image in $sortedImages) {
        $mappedId = ''
        if (-not $mapRows.TryGetValue([string]$image.Reference, [ref]$mappedId) -or
            $mappedId -cne [string]$image.ImageId) {
            throw 'Expected image authority map does not match its canonical image list.'
        }
    }
    return [pscustomobject]@{ Fingerprint = $fingerprint; Images = $sortedImages }
}

function Get-EasyFireExpectedImageAuthority {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$ImageReferences)

    if ($ImageReferences.Count -eq 0) { throw 'At least one expected image reference is required.' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $references = New-Object 'System.Collections.Generic.List[string]'
    foreach ($candidate in $ImageReferences) {
        $reference = [string]$candidate
        $null = Assert-EasyFireImageReference -Reference $reference
        if (-not $seen.Add($reference)) { throw 'Expected image references must be unique.' }
        $references.Add($reference)
    }
    $references.Sort([StringComparer]::Ordinal)

    $images = New-Object 'System.Collections.Generic.List[object]'
    foreach ($reference in $references) {
        $inspect = Invoke-EasyFireNative -FilePath docker -ArgumentList @('image', 'inspect', $reference)
        $parsed = $inspect.Text | ConvertFrom-Json
        if ($parsed -is [array]) {
            if ($parsed.Count -ne 1) { throw "Expected image inspect was not unique for reference: $reference" }
            $item = $parsed[0]
        } else {
            $item = $parsed
        }
        if ($null -eq $item) { throw "Expected image inspect was empty for reference: $reference" }
        $imageId = [string](Get-EasyFireMemberValue -Object $item -Name 'Id' -Default '')
        if ($imageId -notmatch '^sha256:[a-f0-9]{64}$') {
            throw "Expected image inspect returned a malformed image ID for reference: $reference"
        }
        $attachedReferences = if ($reference.Contains('@')) {
            @((Get-EasyFireMemberValue -Object $item -Name 'RepoDigests' -Default @()))
        } else {
            @((Get-EasyFireMemberValue -Object $item -Name 'RepoTags' -Default @()))
        }
        if (@($attachedReferences | Where-Object { [string]$_ -ceq $reference }).Count -ne 1) {
            throw "Expected image reference is not attached exactly to its inspected image: $reference"
        }
        $images.Add([pscustomobject]@{ Reference = $reference; ImageId = $imageId })
    }
    $map = [ordered]@{}
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($image in $images) {
        $map[[string]$image.Reference] = [string]$image.ImageId
        $rows.Add("image|$($image.Reference)|$($image.ImageId)")
    }
    $imageArray = @($images | ForEach-Object { $_ })
    return [pscustomobject]@{
        SchemaVersion = 1
        ImageCount = $images.Count
        Images = $imageArray
        ReferenceToImageId = [pscustomobject]$map
        Fingerprint = Get-EasyFireTextSha256 -Text ($rows -join "`n")
    }
}

function Test-EasyFireExpectedImageAuthorityEqual {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$EstablishedAuthority,
        [Parameter(Mandatory = $true)]$ObservedAuthority
    )

    try {
        $established = Get-EasyFireImageAuthorityCanonical -Authority $EstablishedAuthority
        $observed = Get-EasyFireImageAuthorityCanonical -Authority $ObservedAuthority
        return ($established.Fingerprint -ceq $observed.Fingerprint)
    } catch {
        return $false
    }
}

function Invoke-EasyFireNative {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$AllowFailure
    )

    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $FilePath @ArgumentList 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $saved
    }
    $result = [pscustomobject]@{
        ExitCode = [int]$exitCode
        Output = $output
        Text = ($output -join "`n")
    }
    if (-not $AllowFailure -and $result.ExitCode -ne 0) {
        throw "$FilePath failed with exit code $($result.ExitCode)."
    }
    return $result
}

function Write-EasyFireJsonAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    $root = Resolve-EasyFireContainedPath -Path $AllowedRoot -AllowedRoot $AllowedRoot -MustExist
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "JSON authority root is not a directory: $root"
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $root -TrustedRoot $root
    $target = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $root
    if (Test-Path -LiteralPath $target) {
        if (Test-EasyFireReparsePoint -Path $target) {
            throw "JSON authority target cannot be a reparse point: $target"
        }
    }
    $parent = [System.IO.Path]::GetDirectoryName($target)
    $null = Assert-EasyFireNoReparsePathChain -Path $parent -TrustedRoot $root
    if (-not (Test-Path -LiteralPath $parent)) {
        [IO.Directory]::CreateDirectory($parent) | Out-Null
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $parent -TrustedRoot $root
    $temporary = "$target.tmp.$([guid]::NewGuid().ToString('N'))"
    $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporary -Encoding utf8 -Force
    Move-Item -LiteralPath $temporary -Destination $target -Force
    return $target
}

function Read-EasyFireJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    $target = Resolve-EasyFireContainedPath -Path $Path -AllowedRoot $AllowedRoot
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return $null }
    $null = Assert-EasyFireNoReparsePathChain -Path $target -TrustedRoot $AllowedRoot
    return (Get-Content -LiteralPath $target -Raw -Encoding utf8 | ConvertFrom-Json)
}

function Get-EasyFireReleaseManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
        [string[]]$ExcludedRelativePaths = @('.env')
    )

    $root = (Resolve-Path -LiteralPath $ReleaseDirectory -ErrorAction Stop).Path.TrimEnd('\')
    if (Test-EasyFireReparsePoint -Path $root) { throw "Release directory cannot be a reparse point." }
    $entries = New-Object 'System.Collections.Generic.List[object]'
    $directories = New-Object 'System.Collections.Generic.Stack[string]'
    $directories.Push($root)
    $fileSha = [System.Security.Cryptography.SHA256]::Create()
    try {
        while ($directories.Count -gt 0) {
            $currentPath = $directories.Pop()
            $currentDirectory = New-Object System.IO.DirectoryInfo -ArgumentList $currentPath
            foreach ($item in $currentDirectory.EnumerateFileSystemInfos()) {
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Release contains a reparse point: $($item.FullName)"
                }
                if (($item.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
                    $directories.Push($item.FullName)
                    continue
                }
                $relative = $item.FullName.Substring($root.Length).TrimStart('\').Replace('\', '/')
                if (-not $relative -or $relative -match '(^|/)\.\.(/|$)') { throw "Invalid release path: $relative" }
                if ($relative -in $ExcludedRelativePaths) { continue }
                $stream = [System.IO.File]::OpenRead($item.FullName)
                try {
                    $fileHash = ([System.BitConverter]::ToString($fileSha.ComputeHash($stream))).Replace('-', '')
                } finally {
                    $stream.Dispose()
                }
                $entries.Add([pscustomobject]@{
                    Path = $relative
                    Length = [int64]$item.Length
                    Sha256 = $fileHash
                })
            }
        }
    } finally {
        $fileSha.Dispose()
    }
    $entries = @($entries | Sort-Object Path)
    $canonical = ($entries | ForEach-Object { "$($_.Sha256)  $($_.Length)  $($_.Path)" }) -join "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $manifestHash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
    return [pscustomobject]@{
        SchemaVersion = 1
        FileCount = $entries.Count
        Sha256 = $manifestHash
        Entries = $entries
    }
}

function Test-EasyFireReleaseManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
        [Parameter(Mandatory = $true)][string]$ExpectedManifestSha256,
        [Parameter(Mandatory = $true)][int]$ExpectedFileCount
    )
    try {
        $actual = Get-EasyFireReleaseManifest -ReleaseDirectory $ReleaseDirectory
        return ($actual.Sha256 -ceq $ExpectedManifestSha256 -and $actual.FileCount -eq $ExpectedFileCount)
    } catch {
        return $false
    }
}

function Expand-EasyFireZipRelease {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [Parameter(Mandatory = $true)][string]$ReleasesRoot,
        [Parameter(Mandatory = $true)][string]$ActionId
    )

    $root = Resolve-EasyFireContainedPath -Path $ReleasesRoot -AllowedRoot $ReleasesRoot -MustExist
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "ReleasesRoot is not a directory: $root"
    }
    $null = Assert-EasyFireNoReparsePathChain -Path $root -TrustedRoot $root
    $destination = Resolve-EasyFireContainedPath -Path $DestinationPath -AllowedRoot $root
    $archiveFile = (Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop).Path
    if (Test-EasyFireReparsePoint -Path $archiveFile) {
        throw "Release archive cannot be a reparse point."
    }
    if ([System.IO.Path]::GetExtension($archiveFile) -ine '.zip') {
        throw "Production release archives must be .zip files."
    }
    if (Test-Path -LiteralPath $destination) {
        throw "Release destination already exists; validate and resume it instead of overwriting."
    }

    $partial = Resolve-EasyFireContainedPath -Path (
        Join-Path $root ("partial-$ActionId-$([guid]::NewGuid().ToString('N'))")
    ) -AllowedRoot $root
    [IO.Directory]::CreateDirectory($partial) | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveFile)
    try {
        $entryCount = 0
        [int64]$expandedBytes = 0
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $archive.Entries) {
            $entryCount++
            if ($entryCount -gt 25000) { throw "Archive contains too many entries." }
            $name = $entry.FullName.Replace('\', '/')
            $segments = @($name.Split('/') | Where-Object { $_ -ne '' })
            $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            $isDirectory = $name.EndsWith('/')
            if (-not $name -or [System.IO.Path]::IsPathRooted($name) -or $name -match ':' -or
                $segments -contains '..' -or $unixType -eq 0xA000) {
                throw "Archive contains an unsafe entry."
            }
            $normalized = $name.TrimEnd('/')
            if (-not $normalized) { continue }
            if (-not $seen.Add($normalized)) { throw "Archive contains duplicate or case-colliding entries." }
            if ($normalized -ieq '.env') { throw "Release archive must not contain a runtime .env file." }
            if (-not $isDirectory) {
                if ([int64]$entry.Length -gt 536870912) { throw "Archive entry exceeds the expanded-size limit." }
                $expandedBytes += [int64]$entry.Length
                if ($expandedBytes -gt 2147483648) { throw "Archive exceeds the total expanded-size limit." }
            }

            $target = Resolve-EasyFireContainedPath -Path (Join-Path $partial $normalized) -AllowedRoot $partial
            if ($isDirectory) {
                if (-not (Test-Path -LiteralPath $target)) {
                    [IO.Directory]::CreateDirectory($target) | Out-Null
                }
                continue
            }
            $parent = [System.IO.Path]::GetDirectoryName($target)
            $null = Assert-EasyFireNoReparsePathChain -Path $parent -TrustedRoot $partial
            if (-not (Test-Path -LiteralPath $parent)) {
                [IO.Directory]::CreateDirectory($parent) | Out-Null
            }
            $input = $entry.Open()
            $output = New-Object System.IO.FileStream(
                $target,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None
            )
            try { $input.CopyTo($output) }
            finally { $output.Dispose(); $input.Dispose() }
        }
        $null = Get-EasyFireReleaseManifest -ReleaseDirectory $partial
        $destinationParent = [System.IO.Path]::GetDirectoryName($destination)
        $null = Assert-EasyFireNoReparsePathChain -Path $destinationParent -TrustedRoot $root
        if (Test-Path -LiteralPath $destination) {
            throw "Release destination appeared during extraction; refusing replacement."
        }
        Move-Item -LiteralPath $partial -Destination $destination -ErrorAction Stop
    } catch {
        throw
    } finally {
        $archive.Dispose()
    }
    return $destination
}

function Get-EasyFireComposeInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectName,
        [string[]]$ExactVolumeNames = @(),
        [string[]]$LegacyVolumeNames = @()
    )

    $allVolumeNames = @((Invoke-EasyFireNative -FilePath docker -ArgumentList @(
        'volume', 'ls', '--format', '{{.Name}}'
    )).Output | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $projectVolumeNames = @((Invoke-EasyFireNative -FilePath docker -ArgumentList @(
        'volume', 'ls', '--filter', "label=com.docker.compose.project=$ProjectName", '--format', '{{.Name}}'
    )).Output | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $reservedVolumeNames = @(
        @($projectVolumeNames) + @($allVolumeNames | Where-Object {
            $_ -in $ExactVolumeNames -or
            $_ -in $LegacyVolumeNames -or
            $_ -match '^easyfire_prod_(?:mysql|redis)_[a-f0-9]{12}$' -or
            $_ -match '^(?:bigcapital_prod|easyfire-bookkeeping-prod|bigcapital-prod)_(?:mysql|redis)$'
        }) | Sort-Object -Unique
    )

    $containers = @()
    $containerList = Invoke-EasyFireNative -FilePath docker -ArgumentList @(
        'ps', '-a', '--filter', "label=com.docker.compose.project=$ProjectName", '--format', '{{.ID}}'
    )
    foreach ($id in @($containerList.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
        $inspect = Invoke-EasyFireNative -FilePath docker -ArgumentList @('inspect', $id)
        $parsed = $inspect.Text | ConvertFrom-Json
        $item = if ($parsed -is [array]) { $parsed[0] } else { $parsed }
        $config = Get-EasyFireMemberValue -Object $item -Name 'Config'
        $labels = Get-EasyFireMemberValue -Object $config -Name 'Labels'
        $state = Get-EasyFireMemberValue -Object $item -Name 'State'
        $healthObject = Get-EasyFireMemberValue -Object $state -Name 'Health'
        $hostConfig = Get-EasyFireMemberValue -Object $item -Name 'HostConfig'
        $restartPolicy = Get-EasyFireMemberValue -Object $hostConfig -Name 'RestartPolicy'
        $portBindingMap = Get-EasyFireMemberValue -Object $hostConfig -Name 'PortBindings'
        $portBindings = @()
        if ($null -ne $portBindingMap) {
            foreach ($portProperty in @($portBindingMap.PSObject.Properties | Sort-Object Name)) {
                foreach ($binding in @($portProperty.Value | Where-Object { $null -ne $_ })) {
                    $portBindings += [pscustomobject]@{
                        ContainerPort = [string]$portProperty.Name
                        HostIp = [string](Get-EasyFireMemberValue -Object $binding -Name 'HostIp' -Default '')
                        HostPort = [string](Get-EasyFireMemberValue -Object $binding -Name 'HostPort' -Default '')
                    }
                }
            }
        }
        $networkSettings = Get-EasyFireMemberValue -Object $item -Name 'NetworkSettings'
        $attachedNetworkMap = Get-EasyFireMemberValue -Object $networkSettings -Name 'Networks'
        $attachedNetworks = @()
        if ($null -ne $attachedNetworkMap) {
            foreach ($networkProperty in @($attachedNetworkMap.PSObject.Properties)) {
                $attachment = $networkProperty.Value
                $attachedNetworks += [pscustomobject]@{
                    Name = [string]$networkProperty.Name
                    NetworkId = [string](Get-EasyFireMemberValue -Object $attachment -Name 'NetworkID' -Default '')
                    EndpointId = [string](Get-EasyFireMemberValue -Object $attachment -Name 'EndpointID' -Default '')
                    IpAddress = [string](Get-EasyFireMemberValue -Object $attachment -Name 'IPAddress' -Default '')
                    Aliases = @((Get-EasyFireMemberValue -Object $attachment -Name 'Aliases' -Default @()) | Sort-Object)
                }
            }
        }
        $mounts = @((Get-EasyFireMemberValue -Object $item -Name 'Mounts' -Default @()) | ForEach-Object {
            [pscustomobject]@{
                Type = [string]$_.Type
                Source = if ($_.Type -eq 'volume') { [string]$_.Name } else { [string]$_.Source }
                Destination = [string]$_.Destination
                Mode = [string]$_.Mode
                ReadWrite = [bool]$_.RW
                Propagation = [string]$_.Propagation
            }
        } | Sort-Object Destination, Type, Source)
        $containers += [pscustomobject]@{
            Id = [string]$item.Id
            Name = ([string]$item.Name).TrimStart('/')
            Project = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.project' -Default '')
            Service = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.service' -Default '')
            ComposeConfigHash = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.config-hash' -Default '')
            ComposeOneOff = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.oneoff' -Default '')
            ImageReference = [string](Get-EasyFireMemberValue -Object $config -Name 'Image' -Default '')
            ImageId = [string]$item.Image
            State = [string](Get-EasyFireMemberValue -Object $state -Name 'Status' -Default 'unknown')
            Health = [string](Get-EasyFireMemberValue -Object $healthObject -Name 'Status' -Default 'none')
            RestartPolicy = [string](Get-EasyFireMemberValue -Object $restartPolicy -Name 'Name' -Default '')
            RestartMaximumRetryCount = [int](Get-EasyFireMemberValue -Object $restartPolicy -Name 'MaximumRetryCount' -Default 0)
            PortBindings = @($portBindings | Sort-Object ContainerPort, HostIp, HostPort)
            Networks = @($attachedNetworks | Sort-Object Name)
            Mounts = $mounts
            VolumeNames = @($mounts | Where-Object { $_.Type -eq 'volume' } | ForEach-Object { $_.Source } | Sort-Object)
        }
    }

    $networkNames = @((Invoke-EasyFireNative -FilePath docker -ArgumentList @(
        'network', 'ls', '--filter', "label=com.docker.compose.project=$ProjectName", '--format', '{{.Name}}'
    )).Output | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object)
    $networks = @()
    foreach ($networkName in $networkNames) {
        $inspect = Invoke-EasyFireNative -FilePath docker -ArgumentList @('network', 'inspect', $networkName)
        $parsed = $inspect.Text | ConvertFrom-Json
        $item = if ($parsed -is [array]) { $parsed[0] } else { $parsed }
        $labels = Get-EasyFireMemberValue -Object $item -Name 'Labels'
        $options = Get-EasyFireMemberValue -Object $item -Name 'Options'
        $optionRows = @()
        if ($null -ne $options) {
            foreach ($option in @($options.PSObject.Properties | Sort-Object Name)) {
                $optionRows += "$($option.Name)=$($option.Value)"
            }
        }
        $networks += [pscustomobject]@{
            Id = [string]$item.Id
            Name = [string]$item.Name
            Driver = [string]$item.Driver
            Scope = [string]$item.Scope
            Internal = [bool]$item.Internal
            Project = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.project' -Default '')
            LogicalName = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.network' -Default '')
            Options = @($optionRows)
        }
    }

    # Only exact action-derived names can be mounted by this release. Historical
    # preserved volumes from rolled-back actions are intentionally ignored.
    $candidateVolumeNames = @()
    foreach ($exactName in $ExactVolumeNames) {
        $listed = (Invoke-EasyFireNative -FilePath docker -ArgumentList @(
            'volume', 'ls', '--filter', "name=$exactName", '--format', '{{.Name}}'
        )).Output
        if (@($listed | Where-Object { $_.Trim() -ceq $exactName }).Count -eq 1) {
            $candidateVolumeNames += $exactName
        }
    }
    $volumes = @()
    foreach ($name in @($candidateVolumeNames | Sort-Object -Unique)) {
        $inspect = Invoke-EasyFireNative -FilePath docker -ArgumentList @('volume', 'inspect', $name)
        $parsed = $inspect.Text | ConvertFrom-Json
        $item = if ($parsed -is [array]) { $parsed[0] } else { $parsed }
        $labels = Get-EasyFireMemberValue -Object $item -Name 'Labels'
        $options = Get-EasyFireMemberValue -Object $item -Name 'Options'
        $optionRows = @()
        if ($null -ne $options) {
            foreach ($option in @($options.PSObject.Properties | Sort-Object Name)) {
                $optionRows += "$($option.Name)=$($option.Value)"
            }
        }
        $volumes += [pscustomobject]@{
            Name = [string]$item.Name
            CreatedAt = [string]$item.CreatedAt
            Driver = [string]$item.Driver
            Scope = [string]$item.Scope
            Project = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.project' -Default '')
            LogicalName = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.volume' -Default '')
            Options = @($optionRows)
        }
    }

    $projectContainerIds = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($container in $containers) { $null = $projectContainerIds.Add([string]$container.Id) }
    foreach ($id in @($containerList.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
        $null = $projectContainerIds.Add([string]$id)
    }
    $foreignVolumeConsumers = @()
    foreach ($volumeName in @($ExactVolumeNames | Sort-Object -Unique)) {
        $consumerList = Invoke-EasyFireNative -FilePath docker -ArgumentList @(
            'ps', '-a', '--filter', "volume=$volumeName", '--format', '{{.ID}}'
        )
        foreach ($consumerId in @($consumerList.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)) {
            if ($projectContainerIds.Contains([string]$consumerId)) { continue }
            $inspect = Invoke-EasyFireNative -FilePath docker -ArgumentList @('inspect', $consumerId)
            $parsed = $inspect.Text | ConvertFrom-Json
            if ($parsed -is [array]) {
                if ($parsed.Count -ne 1) { throw "Exact-volume consumer inspect was not unique: $consumerId" }
                $item = $parsed[0]
            } else {
                $item = $parsed
            }
            if ($null -eq $item) { throw "Exact-volume consumer inspect was empty: $consumerId" }
            $fullConsumerId = [string](Get-EasyFireMemberValue -Object $item -Name 'Id' -Default '')
            if (-not $fullConsumerId) { throw "Exact-volume consumer has no container identity: $consumerId" }
            if ($projectContainerIds.Contains($fullConsumerId)) { continue }
            $config = Get-EasyFireMemberValue -Object $item -Name 'Config'
            $labels = Get-EasyFireMemberValue -Object $config -Name 'Labels'
            $state = Get-EasyFireMemberValue -Object $item -Name 'State'
            $matchingMounts = @((Get-EasyFireMemberValue -Object $item -Name 'Mounts' -Default @()) |
                Where-Object {
                    [string]$_.Type -ceq 'volume' -and
                    ([string]$_.Name -ceq $volumeName -or [string]$_.Source -ceq $volumeName)
                })
            if ($matchingMounts.Count -eq 0) {
                throw "Docker reported an exact-volume consumer without a matching inspected mount: $consumerId"
            }
            foreach ($mount in $matchingMounts) {
                $foreignVolumeConsumers += [pscustomobject]@{
                    VolumeName = $volumeName
                    ContainerId = $fullConsumerId
                    ContainerName = ([string](Get-EasyFireMemberValue -Object $item -Name 'Name' -Default '')).TrimStart('/')
                    Project = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.project' -Default '')
                    Service = [string](Get-EasyFireMemberValue -Object $labels -Name 'com.docker.compose.service' -Default '')
                    State = [string](Get-EasyFireMemberValue -Object $state -Name 'Status' -Default 'unknown')
                    MountDestination = [string](Get-EasyFireMemberValue -Object $mount -Name 'Destination' -Default '')
                    ReadWrite = [bool](Get-EasyFireMemberValue -Object $mount -Name 'RW' -Default $false)
                }
            }
        }
    }
    return [pscustomobject]@{
        Containers = @($containers | Sort-Object Service)
        Networks = @($networks | Sort-Object Name)
        Volumes = @($volumes | Sort-Object Name)
        ReservedVolumeNames = $reservedVolumeNames
        ForeignVolumeConsumers = @($foreignVolumeConsumers |
            Sort-Object VolumeName, ContainerId, MountDestination)
    }
}

function Get-EasyFireInventoryFingerprint {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Inventory)

    $rows = @()
    foreach ($c in @($Inventory.Containers)) {
        $mountRows = @($c.Mounts | ForEach-Object {
            "$($_.Type):$($_.Source):$($_.Destination):$($_.Mode):$($_.ReadWrite):$($_.Propagation)"
        } | Sort-Object)
        $networkRows = @($c.Networks | ForEach-Object {
            "$($_.Name):$($_.NetworkId):$($_.EndpointId):$($_.IpAddress):$(@($_.Aliases) -join ',')"
        } | Sort-Object)
        $portRows = @((Get-EasyFireMemberValue -Object $c -Name 'PortBindings' -Default @()) | ForEach-Object {
            "$($_.ContainerPort):$($_.HostIp):$($_.HostPort)"
        } | Sort-Object)
        $rows += "container|$($c.Id)|$($c.Name)|$($c.Project)|$($c.Service)|$($c.ComposeConfigHash)|$($c.ComposeOneOff)|$($c.ImageReference)|$($c.ImageId)|$($c.RestartPolicy)|$($c.RestartMaximumRetryCount)|$($mountRows -join ',')|$($networkRows -join ',')|$($portRows -join ',')"
    }
    foreach ($n in @($Inventory.Networks)) {
        $rows += "network|$($n.Id)|$($n.Name)|$($n.Driver)|$($n.Scope)|$($n.Internal)|$($n.Project)|$($n.LogicalName)|$(@($n.Options) -join ',')"
    }
    foreach ($v in @($Inventory.Volumes)) {
        $rows += "volume|$($v.Name)|$($v.CreatedAt)|$($v.Driver)|$($v.Scope)|$($v.Project)|$($v.LogicalName)|$(@($v.Options) -join ',')"
    }
    foreach ($name in @((Get-EasyFireMemberValue -Object $Inventory -Name 'ReservedVolumeNames' -Default @()))) {
        $rows += "reserved-volume|$name"
    }
    foreach ($consumer in @((Get-EasyFireMemberValue -Object $Inventory -Name 'ForeignVolumeConsumers' -Default @()))) {
        $rows += "foreign-volume-consumer|$($consumer.VolumeName)|$($consumer.ContainerId)|$($consumer.ContainerName)|$($consumer.Project)|$($consumer.Service)|$($consumer.State)|$($consumer.MountDestination)|$($consumer.ReadWrite)"
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes((@($rows | Sort-Object) -join "`n"))
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Get-EasyFireVolumeFingerprint {
    [CmdletBinding()]
    param([object[]]$Volumes = @())

    $rows = @($Volumes | ForEach-Object {
        "volume|$($_.Name)|$($_.CreatedAt)|$($_.Driver)|$($_.Scope)|$($_.Project)|$($_.LogicalName)|$(@($_.Options) -join ',')"
    } | Sort-Object)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($rows -join "`n"))
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Invoke-EasyFireCloudflareGet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$ApiToken,
        [int]$TimeoutSec = 20
    )
    $parsedUri = [Uri]$Uri
    if ($parsedUri.Scheme -cne 'https' -or $parsedUri.Host -cne 'api.cloudflare.com') {
        throw "Cloudflare verification permits only the official HTTPS API host."
    }
    $request = [System.Net.HttpWebRequest]::Create($parsedUri)
    $request.Method = 'GET'
    $request.Timeout = $TimeoutSec * 1000
    $request.ReadWriteTimeout = $TimeoutSec * 1000
    $request.AllowAutoRedirect = $false
    $request.Headers['Authorization'] = "Bearer $ApiToken"
    try {
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) }
        finally { $reader.Dispose(); $response.Dispose() }
    } catch {
        $status = 'no_http_status'
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        throw "Cloudflare read-only verification request failed (status $status)."
    }
}

function Get-EasyFireCloudflareCollection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$ApiToken
    )
    $items = @()
    for ($page = 1; $page -le 100; $page++) {
        $separator = if ($Uri.Contains('?')) { '&' } else { '?' }
        $response = Invoke-EasyFireCloudflareGet -Uri "${Uri}${separator}per_page=50&page=$page" -ApiToken $ApiToken
        if (-not (Get-EasyFireMemberValue -Object $response -Name 'success' -Default $false)) {
            throw "Cloudflare collection verification failed."
        }
        $items += @((Get-EasyFireMemberValue -Object $response -Name 'result' -Default @()))
        $resultInfo = Get-EasyFireMemberValue -Object $response -Name 'result_info'
        $totalPages = [int](Get-EasyFireMemberValue -Object $resultInfo -Name 'total_pages' -Default 1)
        if ($page -ge $totalPages) { return @($items) }
    }
    throw "Cloudflare collection exceeded the verification page limit."
}

function ConvertTo-EasyFireUtcDateTime {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Value)

    if ($Value -is [datetime]) { return ([datetime]$Value).ToUniversalTime() }
    $text = [string]$Value
    if (-not $text) { throw 'Required timestamp evidence is missing.' }
    try {
        if ($text -match '^\d{14}\.\d{6}[+-]\d{3}$') {
            return [System.Management.ManagementDateTimeConverter]::ToDateTime($text).ToUniversalTime()
        }
        return ([DateTimeOffset]::Parse(
            $text,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal
        )).UtcDateTime
    } catch {
        throw 'Required timestamp evidence is malformed.'
    }
}

function Get-EasyFireCorrelatedConnectorIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$ConnectionsResponse,
        [Parameter(Mandatory = $true)][datetime]$ProcessCreatedAtUtc,
        [Parameter(Mandatory = $true)][string]$LocalVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedArchitecture,
        [int]$MaximumStartSkewSeconds = 300
    )

    if (-not (Get-EasyFireMemberValue -Object $ConnectionsResponse -Name 'success' -Default $false)) {
        throw 'Tunnel connector API evidence is unavailable.'
    }
    if ($LocalVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$' -or
        $ExpectedArchitecture -notmatch '^[a-z0-9_/-]+$') {
        throw 'Local connector identity evidence is malformed.'
    }

    $activeClients = New-Object 'System.Collections.Generic.List[object]'
    foreach ($connector in @((Get-EasyFireMemberValue -Object $ConnectionsResponse -Name 'result' -Default @()))) {
        $activeConnections = New-Object 'System.Collections.Generic.List[object]'
        foreach ($connection in @((Get-EasyFireMemberValue -Object $connector -Name 'conns' -Default @()))) {
            $pending = [bool](Get-EasyFireMemberValue -Object $connection -Name 'is_pending_reconnect' -Default $true)
            $connectionId = [string](Get-EasyFireMemberValue -Object $connection -Name 'id' -Default '')
            if (-not $connectionId) {
                $connectionId = [string](Get-EasyFireMemberValue -Object $connection -Name 'uuid' -Default '')
            }
            if (-not $pending -and $connectionId) { $activeConnections.Add($connection) }
        }
        if ($activeConnections.Count -gt 0) {
            $activeClients.Add([pscustomobject]@{
                Connector = $connector
                Connections = @($activeConnections | ForEach-Object { $_ })
            })
        }
    }
    if ($activeClients.Count -ne 1) {
        throw 'Tunnel must have exactly one active connector client.'
    }

    $active = $activeClients[0]
    $connector = $active.Connector
    $connectorId = [string](Get-EasyFireMemberValue -Object $connector -Name 'id' -Default '')
    $connectorVersion = [string](Get-EasyFireMemberValue -Object $connector -Name 'version' -Default '')
    $connectorArchitecture = ([string](Get-EasyFireMemberValue -Object $connector -Name 'arch' -Default '')).ToLowerInvariant()
    if ($connectorId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or
        $connectorVersion -cne $LocalVersion -or
        $connectorArchitecture -cne $ExpectedArchitecture.ToLowerInvariant()) {
        throw 'Tunnel connector client identity does not match the local binary identity.'
    }
    foreach ($connection in @($active.Connections)) {
        $clientId = [string](Get-EasyFireMemberValue -Object $connection -Name 'client_id' -Default '')
        $clientVersion = [string](Get-EasyFireMemberValue -Object $connection -Name 'client_version' -Default '')
        if ($clientId -cne $connectorId -or $clientVersion -cne $connectorVersion) {
            throw 'Tunnel edge connections do not belong to the sole connector client.'
        }
    }

    $connectorRunAt = ConvertTo-EasyFireUtcDateTime -Value (
        Get-EasyFireMemberValue -Object $connector -Name 'run_at' -Default ''
    )
    $processCreated = $ProcessCreatedAtUtc.ToUniversalTime()
    if ([Math]::Abs(($connectorRunAt - $processCreated).TotalSeconds) -gt $MaximumStartSkewSeconds) {
        throw 'Tunnel connector start evidence does not correlate with the local service process.'
    }
    return [pscustomobject]@{
        ConnectorClientId = $connectorId
        ConnectorRunAtUtc = $connectorRunAt.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        ConnectorVersion = $connectorVersion
        ConnectorArchitecture = $connectorArchitecture
        ConnectorActiveConnectionCount = $active.Connections.Count
    }
}

function Get-EasyFireVerifiedEdgeState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Credential,
        [string]$Domain = 'bookkeeping.easyfire.fyi',
        [string]$TunnelName = 'easyfire-bookkeeping-prod',
        [string]$ServiceName = 'EasyFireBookkeepingCloudflared'
    )
    $base = 'https://api.cloudflare.com/client/v4'
    $headersToken = [string](Get-EasyFireMemberValue -Object $Credential -Name 'apiToken' -Default '')
    $account = [string](Get-EasyFireMemberValue -Object $Credential -Name 'accountId' -Default '')
    $zone = [string](Get-EasyFireMemberValue -Object $Credential -Name 'zoneId' -Default '')
    $email = [string](Get-EasyFireMemberValue -Object $Credential -Name 'adminEmail' -Default '')
    if ($headersToken.Length -lt 20 -or $account -notmatch '^[a-f0-9]{32}$' -or `
        $zone -notmatch '^[a-f0-9]{32}$' -or $email -notmatch '@') { throw 'Cloudflare credential shape is invalid.' }

    $apps = Get-EasyFireCloudflareCollection -Uri "$base/accounts/$account/access/apps" -ApiToken $headersToken
    $matches = @($apps | Where-Object { $_.domain -eq $Domain -and $_.type -eq 'self_hosted' })
    if ($matches.Count -ne 1) { throw 'Exact Access application verification failed.' }
    $app = $matches[0]
    $policies = @(Get-EasyFireCloudflareCollection -Uri "$base/accounts/$account/access/apps/$($app.id)/policies" -ApiToken $headersToken)
    if ($policies.Count -ne 1) { throw 'Exact Access policy verification failed.' }
    $policy = $policies[0]
    $include = @($policy.include)
    $policyEmail = if ($include.Count -eq 1 -and $include[0].email) { [string]$include[0].email.email } else { '' }
    if ($policy.decision -ne 'allow' -or $policyEmail -ine $email -or `
        @($policy.exclude | Where-Object { $_ }).Count -ne 0 -or `
        @($policy.require | Where-Object { $_ }).Count -ne 0) { throw 'Access policy is not exact owner-only allow.' }

    $tunnels = @(Get-EasyFireCloudflareCollection -Uri "$base/accounts/$account/cfd_tunnel?name=$TunnelName&is_deleted=false" -ApiToken $headersToken |
        Where-Object { $_.name -eq $TunnelName -and -not $_.deleted_at })
    if ($tunnels.Count -ne 1) { throw 'Exact tunnel verification failed.' }
    $tunnel = $tunnels[0]
    $configResult = Invoke-EasyFireCloudflareGet -Uri "$base/accounts/$account/cfd_tunnel/$($tunnel.id)/configurations" -ApiToken $headersToken
    $ingress = @($configResult.result.config.ingress)
    if (-not $configResult.success -or $ingress.Count -ne 2 -or $ingress[0].hostname -ne $Domain -or `
        $ingress[0].service -ne 'http://localhost:80' -or `
        (Get-EasyFireMemberValue -Object $ingress[1] -Name 'hostname' -Default '') -or `
        $ingress[1].service -ne 'http_status:404') { throw 'Exact tunnel ingress verification failed.' }

    $dns = @(Get-EasyFireCloudflareCollection -Uri "$base/zones/$zone/dns_records?type=CNAME&name=$Domain" -ApiToken $headersToken |
        Where-Object { $_.name -eq $Domain })
    if ($dns.Count -ne 1 -or $dns[0].content -ne "$($tunnel.id).cfargotunnel.com" -or -not $dns[0].proxied) {
        throw 'Exact DNS-to-tunnel verification failed.'
    }
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service -or $service.Status -ne 'Running') { throw 'cloudflared service is not running.' }
    $serviceConfig = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
    $expectedExecutable = Join-Path ${env:ProgramFiles} 'cloudflared\cloudflared.exe'
    $expectedBinaryHash = 'B11EE950A12B15604E6B0A0F30A226516ADC7AEC75DE2E3C642B28E50DDEF9EA'
    $servicePattern = '^"' + [regex]::Escape($expectedExecutable) + '"\s+(?:--no-autoupdate\s+tunnel|tunnel\s+--no-autoupdate)\s+run\s+--token\s+(?<Token>\S+)$'
    $serviceCommand = [string]$serviceConfig.PathName
    if (-not (Test-Path -LiteralPath $expectedExecutable -PathType Leaf) -or
        (Get-EasyFireSha256Hex -Path $expectedExecutable) -cne $expectedBinaryHash -or
        [string]$serviceConfig.StartName -cne 'LocalSystem' -or
        [string]$serviceConfig.StartMode -cne 'Auto' -or
        $serviceCommand -notmatch $servicePattern) {
        throw 'cloudflared service executable, hash, account, or command identity is invalid.'
    }
    $serviceToken = [string]$Matches.Token
    $tokenResult = Invoke-EasyFireCloudflareGet -Uri "$base/accounts/$account/cfd_tunnel/$($tunnel.id)/token" -ApiToken $headersToken
    $expectedTunnelToken = [string](Get-EasyFireMemberValue -Object $tokenResult -Name 'result' -Default '')
    if (-not (Get-EasyFireMemberValue -Object $tokenResult -Name 'success' -Default $false) -or
        -not (Test-EasyFireSecretEqual -Left $serviceToken -Right $expectedTunnelToken)) {
        throw 'cloudflared service token does not belong to the verified tunnel.'
    }
    $processId = [int](Get-EasyFireMemberValue -Object $serviceConfig -Name 'ProcessId' -Default 0)
    if ($processId -le 0) { throw 'cloudflared service has no running process identity.' }
    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
    $processCommand = [string](Get-EasyFireMemberValue -Object $process -Name 'CommandLine' -Default '')
    if ([string](Get-EasyFireMemberValue -Object $process -Name 'ExecutablePath' -Default '') -cne $expectedExecutable -or
        $processCommand -notmatch $servicePattern -or
        -not (Test-EasyFireSecretEqual -Left ([string]$Matches.Token) -Right $expectedTunnelToken)) {
        throw 'cloudflared running process identity does not match the verified service and tunnel.'
    }
    $processCreatedAt = ConvertTo-EasyFireUtcDateTime -Value (
        Get-EasyFireMemberValue -Object $process -Name 'CreationDate' -Default ''
    )
    $versionResult = Invoke-EasyFireNative -FilePath $expectedExecutable -ArgumentList @('--version')
    if ($versionResult.Text -notmatch '(?im)\bcloudflared\s+version\s+(?<Version>[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)\b') {
        throw 'cloudflared local binary version evidence is unavailable.'
    }
    $localVersion = [string]$Matches.Version
    $tunnelState = Invoke-EasyFireCloudflareGet -Uri "$base/accounts/$account/cfd_tunnel/$($tunnel.id)" -ApiToken $headersToken
    $connections = Invoke-EasyFireCloudflareGet -Uri "$base/accounts/$account/cfd_tunnel/$($tunnel.id)/connections" -ApiToken $headersToken
    if (-not (Get-EasyFireMemberValue -Object $tunnelState -Name 'success' -Default $false) -or
        [string]$tunnelState.result.status -ne 'healthy') {
        throw 'Tunnel connector health verification failed.'
    }
    $connectorIdentity = Get-EasyFireCorrelatedConnectorIdentity `
        -ConnectionsResponse $connections `
        -ProcessCreatedAtUtc $processCreatedAt `
        -LocalVersion $localVersion `
        -ExpectedArchitecture 'windows_amd64'
    $normalizedDomain = $Domain.TrimEnd('.').ToLowerInvariant()
    $configurationIdentity = "hostname=$normalizedDomain|service=http://localhost:80|fallback=http_status:404"
    $serviceCommandIdentity = ('"{0}" --no-autoupdate tunnel run --token <redacted>' -f $expectedExecutable)
    $connectorFingerprintInput = @(
        $connectorIdentity.ConnectorClientId,
        $connectorIdentity.ConnectorRunAtUtc,
        $connectorIdentity.ConnectorVersion,
        $connectorIdentity.ConnectorArchitecture,
        $connectorIdentity.ConnectorActiveConnectionCount,
        $processCreatedAt.ToString('o', [Globalization.CultureInfo]::InvariantCulture),
        $expectedBinaryHash,
        $serviceCommandIdentity
    ) -join '|'
    return [pscustomobject]@{
        Mode = 'verify_only'
        AccessAppId = [string]$app.id
        AccessPolicyId = [string]$policy.id
        TunnelId = [string]$tunnel.id
        DnsRecordId = [string]$dns[0].id
        ServiceName = $ServiceName
        ServiceExecutable = $expectedExecutable
        ServiceExecutableSha256 = $expectedBinaryHash
        ServiceCommandIdentity = $serviceCommandIdentity
        ServiceProcessCreatedAtUtc = $processCreatedAt.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        TunnelHostname = $normalizedDomain
        TunnelOriginService = 'http://localhost:80'
        TunnelFallbackService = 'http_status:404'
        TunnelConfigurationFingerprint = Get-EasyFireTextSha256 -Text $configurationIdentity
        ConnectorClientId = $connectorIdentity.ConnectorClientId
        ConnectorRunAtUtc = $connectorIdentity.ConnectorRunAtUtc
        ConnectorVersion = $connectorIdentity.ConnectorVersion
        ConnectorArchitecture = $connectorIdentity.ConnectorArchitecture
        ConnectorActiveConnectionCount = $connectorIdentity.ConnectorActiveConnectionCount
        ConnectorIdentityFingerprint = Get-EasyFireTextSha256 -Text $connectorFingerprintInput
    }
}

function Test-EasyFireHttp {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [int]$TimeoutSec = 20,
        [switch]$NoRedirect
    )
    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSec `
            -MaximumRedirection $(if ($NoRedirect) { 0 } else { 5 }) -ErrorAction Stop
        return [pscustomobject]@{ Reachable = $true; StatusCode = [int]$response.StatusCode; Location = [string]$response.Headers.Location }
    } catch {
        if ($_.Exception.Response) {
            return [pscustomobject]@{
                Reachable = $true
                StatusCode = [int]$_.Exception.Response.StatusCode
                Location = [string]$_.Exception.Response.Headers['Location']
            }
        }
        return [pscustomobject]@{ Reachable = $false; StatusCode = 0; Location = ''; Error = $_.Exception.Message }
    }
}

Export-ModuleMember -Function Invoke-EasyFireNative, Write-EasyFireJsonAtomic, Read-EasyFireJson, Get-EasyFireReleaseManifest, Test-EasyFireReleaseManifest, Expand-EasyFireZipRelease, Get-EasyFireExpectedImageAuthority, Test-EasyFireExpectedImageAuthorityEqual, Get-EasyFireComposeInventory, Get-EasyFireInventoryFingerprint, Get-EasyFireVolumeFingerprint, Invoke-EasyFireCloudflareGet, Get-EasyFireVerifiedEdgeState, Test-EasyFireHttp
