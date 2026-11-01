# Passman installer for Windows PowerShell 5.1+ on local NTFS storage.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Download([string]$Url, [string]$Destination) {
    for ($redirect = 0; $redirect -lt 6; $redirect++) {
        if (([Uri]$Url).Scheme -ne 'https') { throw 'Downloads must use HTTPS.' }
        $request = [Net.HttpWebRequest]::Create($Url)
        $request.AllowAutoRedirect = $false
        $request.Timeout = 180000
        $request.UserAgent = 'Passman-Installer'
        $response = $request.GetResponse()
        try {
            if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) {
                $Url = ([Uri]::new([Uri]$Url, $response.Headers['Location'])).AbsoluteUri
                continue
            }
            $stream = [IO.File]::Create($Destination)
            try { $response.GetResponseStream().CopyTo($stream) } finally { $stream.Dispose() }
            return
        } finally { $response.Dispose() }
    }
    throw 'Too many redirects.'
}
function PlainPath([string]$Location) {
    $current = Get-Item -LiteralPath $Location -Force
    while ($null -ne $current) {
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installation paths must not use reparse points.' }
        if ($current -is [IO.FileInfo]) { $current = $current.Directory } else { $current = $current.Parent }
    }
}
function PrivateDirectory([string]$Location) {
    $new = !(Test-Path -LiteralPath $Location)
    if ($new) { [IO.Directory]::CreateDirectory($Location) | Out-Null }
    PlainPath $Location
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Location))
    if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Use a local NTFS drive.' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($new) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        $item = Get-Item -LiteralPath $Location -Force
        if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($item,$acl) } else { $item.SetAccessControl($acl) }
    }
    $item = Get-Item -LiteralPath $Location -Force
    $acl = if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::GetAccessControl($item) } else { $item.GetAccessControl() }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Wrong installation owner.' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid.Value) { throw 'Installation directory grants access to other accounts.' }
    }
}
function Checksum([string]$File, [string]$Manifest, [string]$Name) {
    $matches = @(Get-Content -LiteralPath $Manifest | Where-Object { $_ -match ('^[0-9a-f]{64}\s+' + [Regex]::Escape($Name) + '$') })
    if ($matches.Count -ne 1) { throw 'Invalid checksum manifest.' }
    $expected = ($matches[0] -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Checksum mismatch; active installation was not changed.' }
    return $expected
}
$work = $null
try {
    if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows.' }
    $base = if ($env:PASSMAN_DOWNLOAD_BASE) { $env:PASSMAN_DOWNLOAD_BASE.TrimEnd('/') } else { 'https://github.com/07rjain/passman/releases' }
    if (([Uri]$base).Scheme -ne 'https') { throw 'Downloads must use HTTPS.' }
    $root = if ($env:PASSMAN_INSTALL_DIR) { $env:PASSMAN_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Passman' }
    if ($root -notmatch '^[A-Za-z]:\\' -or $root -match '[%!&|<>^"\r\n]') { throw 'Use an absolute local installation path without shell metacharacters.' }
    $root = [IO.Path]::GetFullPath($root).TrimEnd('\')
    PrivateDirectory $root
    $bin = Join-Path $root 'bin'
    $versions = Join-Path $root 'versions'
    [IO.Directory]::CreateDirectory($bin) | Out-Null
    [IO.Directory]::CreateDirectory($versions) | Out-Null
    PlainPath $bin
    PlainPath $versions
    $launcher = Join-Path $bin 'passman.cmd'
    $marker = "@echo off`r`nrem Managed by the Passman installer.`r`n"
    if (Test-Path -LiteralPath $launcher) {
        PlainPath $launcher
        if (!([IO.File]::ReadAllText($launcher).StartsWith($marker))) { throw 'Refusing to overwrite an unrelated command.' }
    }
    $pointer = Join-Path $root 'current.txt'
    if (Test-Path -LiteralPath $pointer) { PlainPath $pointer }
    $work = Join-Path $root ('.install-' + [Guid]::NewGuid())
    [IO.Directory]::CreateDirectory($work) | Out-Null
    $version = $env:PASSMAN_VERSION
    if (!$version) {
        Download "$base/latest/download/latest.txt" (Join-Path $work 'latest.txt')
        $version = [IO.File]::ReadAllText((Join-Path $work 'latest.txt')).Trim()
    }
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
    if ([version]$version -lt [version]'0.2.0') { throw 'Windows requires Passman 0.2.0 or newer.' }
    $archive = "passman-$version.tgz"
    $package = Join-Path $work 'package.tgz'
    $manifest = Join-Path $work 'package.sha256'
    Download "$base/download/passman-v$version/$archive" $package
    Download "$base/download/passman-v$version/$archive.sha256" $manifest
    $expected = Checksum $package $manifest $archive
    $release = Join-Path $versions $version
    if (Test-Path -LiteralPath $release) {
        PlainPath $release
        if ([IO.File]::ReadAllText((Join-Path $release 'installed.sha256')).Trim() -ne $expected) { throw 'Version exists with different contents; refusing replacement.' }
    } else {
        $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $arch = switch ($cpu) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw 'Supported Windows CPUs: x64 and arm64.' } }
        $nodeVersion = '24.22.2'
        $nodeArchive = "node-v$nodeVersion-win-$arch.zip"
        Download "https://nodejs.org/dist/v$nodeVersion/$nodeArchive" (Join-Path $work 'node.zip')
        Download "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt" (Join-Path $work 'node.sha256')
        Checksum (Join-Path $work 'node.zip') (Join-Path $work 'node.sha256') $nodeArchive | Out-Null
        $stage = Join-Path $work 'release'
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        $entries = & tar.exe -tzf $package
        if ($LASTEXITCODE -ne 0 -or @($entries | Where-Object { $_ -notmatch '^package/' -or $_ -match '(^|/)\.\.(/|$)|\\' }).Count -ne 0) { throw 'Invalid package archive paths.' }
        & tar.exe -xzf $package -C $stage
        if ($LASTEXITCODE -ne 0) { throw 'Package extraction failed.' }
        Expand-Archive -LiteralPath (Join-Path $work 'node.zip') -DestinationPath $work
        Move-Item -LiteralPath (Join-Path $work "node-v$nodeVersion-win-$arch") -Destination (Join-Path $stage 'runtime')
        $actual = & (Join-Path $stage 'runtime\node.exe') (Join-Path $stage 'package\dist\cli.js') --version
        if ($LASTEXITCODE -ne 0 -or $actual -ne $version) { throw 'Installed CLI failed its version check.' }
        [IO.File]::WriteAllText((Join-Path $stage 'installed.sha256'), $expected)
        Move-Item -LiteralPath $stage -Destination $release
    }
    $newLauncher = Join-Path $bin ('.passman-' + [Guid]::NewGuid() + '.cmd')
    $text = $marker + 'setlocal DisableDelayedExpansion' + "`r`n" + 'set /p PASSMAN_ACTIVE=<"%~dp0..\current.txt"' + "`r`n" + '"%~dp0..\versions\%PASSMAN_ACTIVE%\runtime\node.exe" "%~dp0..\versions\%PASSMAN_ACTIVE%\package\dist\cli.js" %*' + "`r`nexit /b %errorlevel%`r`n"
    [IO.File]::WriteAllText($newLauncher, $text, [Text.Encoding]::ASCII)
    if (Test-Path -LiteralPath $launcher) { [IO.File]::Replace($newLauncher, $launcher, $null) } else { [IO.File]::Move($newLauncher, $launcher) }
    $newPointer = Join-Path $root ('.current-' + [Guid]::NewGuid())
    [IO.File]::WriteAllText($newPointer, $version, [Text.Encoding]::ASCII)
    if (Test-Path -LiteralPath $pointer) { [IO.File]::Replace($newPointer, $pointer, $null) } else { [IO.File]::Move($newPointer, $pointer) }
    Write-Host "Passman $version installed. Your vault was not changed."
    $displayLauncher = $launcher.Replace("'", "''")
    Write-Host "Sign in: & '$displayLauncher' login"
    $displayBin = $bin.Replace("'", "''")
    Write-Host "For this PowerShell session: `$env:Path = '$displayBin;' + `$env:Path"
    Write-Host 'Update by running this installer again. PASSMAN_VERSION selects a specific version.'
} catch {
    Write-Error 'Passman installation failed. Check HTTPS downloads, local NTFS permissions and the selected release. Your vault was not changed.'
    throw
} finally {
    if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force }
}
