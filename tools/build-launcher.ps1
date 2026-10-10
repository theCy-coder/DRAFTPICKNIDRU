# Builds "MLBB Overlay Server.exe" in the overlay folder from tools\launcher.cs.
# Needs nothing installed: it uses the C# compiler that ships with Windows.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-launcher.ps1
#   powershell -ExecutionPolicy Bypass -File tools\build-launcher.ps1 -Publisher "Your Name"
#
# To sign the result with a code-signing certificate, so Windows shows the
# publisher in its security prompt, pass the certificate's thumbprint:
#
#   ... -File tools\build-launcher.ps1 -SignThumbprint ABCDEF0123...
param(
    [string]$Publisher = '',
    [string]$SignThumbprint = ''
)

$ErrorActionPreference = 'Stop'
$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $tools
$source = Join-Path $tools 'launcher.cs'
$icon = Join-Path $tools 'launcher.ico'
$exe = Join-Path $root 'MLBB Overlay Server.exe'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler (csc.exe) was not found on this PC.' }

# A different publisher name is written into a copy of the source.
$build = $source
if ($Publisher) {
    $build = Join-Path $env:TEMP 'mlbb-launcher.cs'
    $text = [IO.File]::ReadAllText($source)
    $text = $text -replace 'Publisher = "[^"]*"', ('Publisher = "' + $Publisher.Replace('"', '') + '"')
    [IO.File]::WriteAllText($build, $text)
}

# The icon: a gold play mark on a dark tile, drawn here so no image file is needed.
if (-not (Test-Path $icon)) {
    Add-Type -AssemblyName System.Drawing
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 52; $d = $r * 2; $m = 8; $w = $size - 2 * $m
    $tile.AddArc($m, $m, $d, $d, 180, 90)
    $tile.AddArc($m + $w - $d, $m, $d, $d, 270, 90)
    $tile.AddArc($m + $w - $d, $m + $w - $d, $d, $d, 0, 90)
    $tile.AddArc($m, $m + $w - $d, $d, $d, 90, 90)
    $tile.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 18, 24))), $tile)
    # blue and red halves along the bottom, as on the overlays
    $g.SetClip($tile)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 47, 143, 255))), 0, 206, 128, 50)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 61, 85))), 128, 206, 128, 50)
    $g.ResetClip()
    $play = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF 98, 62), (New-Object System.Drawing.PointF 186, 118), (New-Object System.Drawing.PointF 98, 174))
    $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 201, 77))), $play)
    $g.Dispose()
    $png = New-Object IO.MemoryStream
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $bytes = $png.ToArray()
    # an .ico file holding that one PNG
    $out = New-Object IO.MemoryStream
    $bw = New-Object IO.BinaryWriter $out
    $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
    $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$bytes.Length); $bw.Write([uint32]22)
    $bw.Write($bytes)
    [IO.File]::WriteAllBytes($icon, $out.ToArray())
}

& $csc /nologo /target:exe /platform:anycpu /optimize+ "/win32icon:$icon" "/out:$exe" $build
if ($LASTEXITCODE -ne 0) { throw 'The launcher did not compile.' }

if ($SignThumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert |
        Where-Object { $_.Thumbprint -eq $SignThumbprint.Replace(' ', '') } | Select-Object -First 1
    if (-not $cert) { throw "No code-signing certificate with thumbprint $SignThumbprint was found." }
    $signed = Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -TimestampServer 'http://timestamp.digicert.com'
    Write-Host ("Signature: " + $signed.Status)
}

$info = (Get-Item $exe).VersionInfo
Write-Host ("Built " + $exe)
Write-Host ("  Product:   " + $info.ProductName)
Write-Host ("  Publisher: " + $info.CompanyName)
