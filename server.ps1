# MLBB overlay server - serves the pages and keeps the control panel and the
# OBS overlays in sync. No install needed: it only uses Windows PowerShell.
param(
    [int]$Port = 8777,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $root 'data'
$stateFile = Join-Path $dataDir 'state.json'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.otf'  = 'font/otf'
}
$blocked = @('.ps1', '.bat', '.cmd')

# The state is kept as raw JSON text; the browser pages own its shape.
$script:stateJson = 'null'
$script:version = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
if (Test-Path $stateFile) {
    try {
        $saved = [IO.File]::ReadAllText($stateFile, $utf8).Trim()
        if ($saved.StartsWith('{') -and $saved.EndsWith('}')) { $script:stateJson = $saved }
    } catch { }
}

function Send-Bytes($res, [int]$code, [string]$type, [byte[]]$bytes, [string]$cache) {
    $res.StatusCode = $code
    $res.ContentType = $type
    $res.Headers['Cache-Control'] = $cache
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
}

function Send-Text($res, [int]$code, [string]$text, [string]$type = 'text/plain; charset=utf-8') {
    Send-Bytes $res $code $type $utf8.GetBytes($text) 'no-store'
}

function Handle-Request($ctx) {
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

    if ($path -eq '/api/state') {
        if ($req.HttpMethod -eq 'GET') {
            if ($req.QueryString['v'] -eq "$script:version") {
                $res.StatusCode = 204
                $res.Close()
                return
            }
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            Send-Text $res 200 ('{"v":' + $script:version + ',"t":' + $now + ',"state":' + $script:stateJson + '}') 'application/json; charset=utf-8'
            return
        }
        if ($req.HttpMethod -eq 'POST') {
            if ($req.ContentLength64 -gt 16MB) { Send-Text $res 413 'State too large'; return }
            $reader = New-Object IO.StreamReader($req.InputStream, $utf8)
            $body = $reader.ReadToEnd().Trim()
            $reader.Dispose()
            if (-not ($body.StartsWith('{') -and $body.EndsWith('}'))) { Send-Text $res 400 'Expected a JSON object'; return }
            # A page says which version its copy is based on. If someone else has
            # saved since, refuse it and hand back the newer state so the page can
            # merge its own change into that instead of overwriting it.
            $based = $req.QueryString['v']
            if ($based -and $based -ne "$script:version") {
                $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                Send-Text $res 409 ('{"v":' + $script:version + ',"t":' + $now + ',"state":' + $script:stateJson + '}') 'application/json; charset=utf-8'
                return
            }
            $script:stateJson = $body
            $script:version++
            try { [IO.File]::WriteAllText($stateFile, $body, $utf8) } catch { }
            Send-Text $res 200 ('{"v":' + $script:version + '}') 'application/json; charset=utf-8'
            return
        }
        Send-Text $res 405 'Method not allowed'
        return
    }

    # The centre stage of the draft overlay plays whatever is in Assets\Media.
    if ($path -eq '/api/media') {
        $dir = Join-Path $root 'Assets\Media'
        $kinds = @('.mp4', '.webm', '.png', '.jpg', '.jpeg', '.gif', '.webp')
        $items = @()
        if (Test-Path -LiteralPath $dir) {
            $items = @(Get-ChildItem -LiteralPath $dir -File |
                Where-Object { $kinds -contains $_.Extension.ToLowerInvariant() } |
                Sort-Object Name |
                ForEach-Object { '"Assets/Media/' + [Uri]::EscapeDataString($_.Name) + '"' })
        }
        Send-Text $res 200 ('[' + ($items -join ',') + ']') 'application/json; charset=utf-8'
        return
    }

    if ($path -eq '/') { $path = '/index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart('/') -replace '/', '\')))
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    $inside = $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)
    $private = $full.StartsWith($dataDir + '\', [StringComparison]::OrdinalIgnoreCase) -or ($blocked -contains $ext)
    if (-not $inside -or $private -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text $res 404 'Not found'
        return
    }
    $type = $mime[$ext]
    if (-not $type) { $type = 'application/octet-stream' }
    $cache = 'no-cache'
    if ($type.StartsWith('image/') -or $type.StartsWith('font/') -or $type.StartsWith('video/')) { $cache = 'max-age=300' }
    Send-Bytes $res 200 $type ([IO.File]::ReadAllBytes($full)) $cache
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Host ''
    Write-Host "Could not start on port $Port. Is the overlay server already running in another window?" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$base = "http://localhost:$Port"
Write-Host ''
Write-Host '  MLBB overlay server is running' -ForegroundColor Green
Write-Host ''
Write-Host "  Control panel      $base/control.html"
Write-Host "  Draft overlay      $base/draft.html        (OBS browser source, 1920x1080)"
Write-Host "  Scoreboard overlay $base/scoreboard.html   (OBS browser source, 1920x1080)"
Write-Host ''
Write-Host '  Keep this window open while streaming. Press Ctrl+C to stop.'
Write-Host ''
if (-not $NoOpen) { Start-Process "$base/control.html" }

try {
    while ($listener.IsListening) {
        $task = $listener.GetContextAsync()
        while (-not $task.Wait(200)) { }
        $ctx = $task.Result
        try { Handle-Request $ctx } catch { try { $ctx.Response.Abort() } catch { } }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
