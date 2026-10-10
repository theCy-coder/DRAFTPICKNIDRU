# Builds dist\MLBB-Overlay-Setup.exe: the whole project, as committed, packed
# into one installer for a GitHub release.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version 1.0.0
#
# It packs the last commit (git archive HEAD), so commit first. Your live
# data\state.json is not in it; the blank one from the repository is.
# Then publish it, for example:
#
#   gh release create v1.0.0 dist\MLBB-Overlay-Setup.exe --title "MLBB Overlay 1.0.0" --notes "..."
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Publisher = '',
    [string]$SignThumbprint = ''
)

$ErrorActionPreference = 'Stop'
$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $tools
$dist = Join-Path $root 'dist'
$exe = Join-Path $dist 'MLBB-Overlay-Setup.exe'
$work = Join-Path ([IO.Path]::GetTempPath()) ('mlbb-release-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must look like 1.0.0' }

$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path (Join-Path $fw 'csc.exe'))) { $fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319' }
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler (csc.exe) was not found on this PC.' }

try {
    # The project exactly as committed. No line-ending conversion, so the files
    # match GitHub's and the updater sees a fresh install as up to date.
    $payload = Join-Path $work 'payload.zip'
    Push-Location $root
    try {
        & git -c core.autocrlf=false archive --format=zip -o $payload HEAD
        if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
    } finally { Pop-Location }

    $source = Join-Path $work 'setup.cs'
    $text = [IO.File]::ReadAllText((Join-Path $tools 'setup.cs'))
    $text = $text -replace 'Version = "[^"]*"', ('Version = "' + $Version + '"')
    $text = $text -replace 'Assembly(File)?Version\("[^"]*"\)', ('Assembly$1Version("' + $Version + '.0")')
    if ($Publisher) { $text = $text -replace 'Publisher = "[^"]*"', ('Publisher = "' + $Publisher.Replace('"', '') + '"') }
    [IO.File]::WriteAllText($source, $text)

    $icon = Join-Path $tools 'launcher.ico'
    $arguments = @('/nologo', '/target:exe', '/platform:anycpu', '/optimize+',
        '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
        "/resource:$payload,payload.zip", "/out:$exe")
    if (Test-Path $icon) { $arguments += "/win32icon:$icon" }
    & $csc @arguments $source
    if ($LASTEXITCODE -ne 0) { throw 'The installer did not compile.' }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

if ($SignThumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert |
        Where-Object { $_.Thumbprint -eq $SignThumbprint.Replace(' ', '') } | Select-Object -First 1
    if (-not $cert) { throw "No code-signing certificate with thumbprint $SignThumbprint was found." }
    $signed = Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -TimestampServer 'http://timestamp.digicert.com'
    Write-Host ("Signature: " + $signed.Status)
}

$item = Get-Item $exe
Write-Host ("Built " + $exe)
Write-Host ("  Version:   " + $item.VersionInfo.FileVersion)
Write-Host ("  Publisher: " + $item.VersionInfo.CompanyName)
Write-Host ("  Size:      " + [Math]::Round($item.Length / 1MB, 1) + " MB")
Write-Host ("  SHA-256:   " + (Get-FileHash $exe -Algorithm SHA256).Hash)
