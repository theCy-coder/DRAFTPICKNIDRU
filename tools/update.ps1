# Checks GitHub for a newer version of the overlay and, if the operator agrees,
# installs it. Run by server.ps1 before the server starts.
#
# It never blocks a show: no internet, a slow reply or any error just prints a
# line and lets the server start with the files already here.
#
# How it works: GitHub lists every file in the project with a fingerprint. The
# fingerprints from the last install are kept in data\installed.txt, so only
# the files that changed are downloaded. The data folder (your match, your
# season) is never touched, and a file you edited yourself is saved to
# data\backup before it is replaced.
#
# Returns $true when files were replaced, so the server can restart on them.
param(
    [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
    [string]$Repo = 'theCy-coder/DRAFTPICKNIDRU',
    [string]$Branch = 'main',
    [switch]$Yes          # install without asking (for testing)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'      # the progress bar makes downloads many times slower
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# MLBB_OVERLAY_UPDATE=yes installs without asking, for a PC nobody sits at.
if ($env:MLBB_OVERLAY_UPDATE -eq 'yes') { $Yes = $true }

function Say($text, $color = 'Gray') { Write-Host ('  ' + $text) -ForegroundColor $color }

# A working copy is updated with git, and may hold work in progress.
if (Test-Path (Join-Path $Root '.git')) {
    Say 'Update check skipped: this folder is a git working copy (use git pull).' DarkGray
    return $false
}

# A launcher replaced while it was running leaves its old copy behind.
Get-ChildItem -LiteralPath $Root -Filter '*.old' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$placing = $false
$dataDir = Join-Path $Root 'data'
$record = Join-Path $dataDir 'installed.txt'
$api = "https://api.github.com/repos/$Repo"
$headers = @{ 'User-Agent' = 'mlbb-overlay-updater'; 'Accept' = 'application/vnd.github+json' }

# The fingerprint git gives a file: SHA-1 of "blob <size>" + a zero byte + the contents.
function Get-Fingerprint([string]$path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $head = [Text.Encoding]::ASCII.GetBytes('blob ' + $bytes.Length + [char]0)
    $sha = [Security.Cryptography.SHA1]::Create()
    try {
        [void]$sha.TransformBlock($head, 0, $head.Length, $null, 0)
        [void]$sha.TransformFinalBlock($bytes, 0, $bytes.Length)
        return -join ($sha.Hash | ForEach-Object { $_.ToString('x2') })
    } finally { $sha.Dispose() }
}

# data\installed.txt: the commit, the tree, a version the operator chose to
# skip, then one "fingerprint<TAB>path" line per file.
function Read-Record {
    $r = @{ commit = ''; tree = ''; skipped = ''; files = @{} }
    if (-not (Test-Path $record)) { return $r }
    foreach ($line in [IO.File]::ReadAllLines($record)) {
        if ($line -match '^commit=(.*)$') { $r.commit = $Matches[1] }
        elseif ($line -match '^tree=(.*)$') { $r.tree = $Matches[1] }
        elseif ($line -match '^skipped=(.*)$') { $r.skipped = $Matches[1] }
        elseif ($line -match '^([0-9a-f]{40})\t(.+)$') { $r.files[$Matches[2]] = $Matches[1] }
    }
    return $r
}
function Write-Record($r) {
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('commit=' + $r.commit); $lines.Add('tree=' + $r.tree); $lines.Add('skipped=' + $r.skipped)
    foreach ($path in ($r.files.Keys | Sort-Object)) { $lines.Add($r.files[$path] + "`t" + $path) }
    [IO.File]::WriteAllLines($record, $lines)
}

try {
    $have = Read-Record

    # 1. What is the newest version? One small request; give up after a few seconds.
    try {
        $latest = Invoke-RestMethod -Uri "$api/commits/$Branch" -Headers $headers -TimeoutSec 6
    } catch {
        Say 'Could not check for updates (no internet?). Starting with the version already here.' DarkGray
        return $false
    }
    $commit = $latest.sha
    $tree = $latest.commit.tree.sha
    $what = (($latest.commit.message -split "`n")[0]).Trim()
    $when = ([datetime]$latest.commit.committer.date).ToLocalTime().ToString('d MMM yyyy')

    if ($have.tree -eq $tree) { Say 'Up to date.' DarkGray; return $false }

    # 2. Which files differ? The full list, with fingerprints.
    $list = Invoke-RestMethod -Uri "$api/git/trees/${tree}?recursive=1" -Headers $headers -TimeoutSec 15
    $remote = @{}
    foreach ($item in $list.tree) {
        if ($item.type -eq 'blob' -and $item.path -notlike 'data/*') { $remote[$item.path] = $item.sha }
    }

    $firstRun = $have.files.Count -eq 0
    $change = New-Object System.Collections.Generic.List[string]    # to download
    $edited = New-Object System.Collections.Generic.List[string]    # ... and changed here too
    foreach ($path in $remote.Keys) {
        $local = Join-Path $Root ($path -replace '/', '\')
        if ($firstRun) {
            # Nothing recorded yet: compare the files themselves.
            # A file that differs may be old or may be your own edit, so it is backed up too.
            if (-not (Test-Path -LiteralPath $local)) { $change.Add($path) }
            elseif ((Get-Fingerprint $local) -ne $remote[$path]) { $change.Add($path); $edited.Add($path) }
            continue
        }
        if ($have.files[$path] -eq $remote[$path] -and (Test-Path -LiteralPath $local)) { continue }
        $change.Add($path)
        if ((Test-Path -LiteralPath $local) -and $have.files.ContainsKey($path) -and (Get-Fingerprint $local) -ne $have.files[$path]) { $edited.Add($path) }
    }
    $gone = @($have.files.Keys | Where-Object { -not $remote.ContainsKey($_) })

    if ($change.Count -eq 0 -and $gone.Count -eq 0) {
        # Same files under a new version number: just note it.
        $have.commit = $commit; $have.tree = $tree; $have.files = $remote
        Write-Record $have
        Say 'Up to date.' DarkGray
        return $false
    }

    # 3. Ask.
    Write-Host ''
    Say ('An update is available  (' + $when + ')') Yellow
    Say ('  Latest change: ' + $what)
    Say ('  ' + $change.Count + ' file(s) to download' + $(if ($gone.Count) { ', ' + $gone.Count + ' to remove' } else { '' }) + '. Your match and season are not touched.')
    if ($edited.Count -and $firstRun) { Say '  The files it replaces are copied to data\backup first.' }
    elseif ($edited.Count) { Say ('  ' + $edited.Count + ' file(s) you changed yourself will be replaced; copies go to data\backup.') }
    if ($have.skipped -eq $commit -and -not $Yes) {
        Say 'You chose to skip this version. Starting without it.' DarkGray
        return $false
    }
    if (-not $Yes) {
        if ([Console]::IsInputRedirected) { Say 'Not installed (no keyboard to ask). Starting without it.' DarkGray; return $false }
        Say 'Best done before the show, not during it.' DarkGray
        Write-Host ''
        $answer = (Read-Host '  Install it now?  [Y] yes   [N] not now   [S] skip this version').Trim().ToLower()
        if ($answer -like 's*') { $have.skipped = $commit; Write-Record $have; Say 'Skipped. You will be asked again for the next version.' DarkGray; return $false }
        if ($answer -notlike 'y*') { Say 'Not now. Starting with the version already here.' DarkGray; return $false }
    }

    # 4. Download everything first, so a dropped connection leaves this folder as it was.
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('mlbb-overlay-update-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $n = 0
        foreach ($path in $change) {
            $n++
            Write-Host ("`r  Downloading " + $n + ' of ' + $change.Count + '   ') -NoNewline
            $target = Join-Path $stage ($path -replace '/', '\')
            $dir = Split-Path -Parent $target
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $url = "https://raw.githubusercontent.com/$Repo/$commit/" + (($path -split '/' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
            Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing -TimeoutSec 120 -Headers @{ 'User-Agent' = 'mlbb-overlay-updater' }
            if ((Get-Fingerprint $target) -ne $remote[$path]) { throw "Download of $path did not match." }
        }
        Write-Host ''

        # 5. Put them in place.
        $placing = $true
        $backup = Join-Path $dataDir ('backup\' + (Get-Date -Format 'yyyy-MM-dd_HHmmss'))
        foreach ($path in $change) {
            $from = Join-Path $stage ($path -replace '/', '\')
            $to = Join-Path $Root ($path -replace '/', '\')
            $dir = Split-Path -Parent $to
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            if ($edited.Contains($path)) {
                $keep = Join-Path $backup ($path -replace '/', '\')
                New-Item -ItemType Directory -Path (Split-Path -Parent $keep) -Force | Out-Null
                Copy-Item -LiteralPath $to -Destination $keep -Force
            }
            try {
                Copy-Item -LiteralPath $from -Destination $to -Force
            } catch {
                # A program that is running (this launcher) cannot be overwritten, but it can be renamed.
                $old = $to + '.old'
                if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
                Rename-Item -LiteralPath $to -NewName (Split-Path -Leaf $old)
                Copy-Item -LiteralPath $from -Destination $to -Force
            }
        }
        foreach ($path in $gone) {
            $to = Join-Path $Root ($path -replace '/', '\')
            if ((Test-Path -LiteralPath $to) -and $path -notlike 'data/*') { Remove-Item -LiteralPath $to -Force -ErrorAction SilentlyContinue }
        }
    } finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }

    $have.commit = $commit; $have.tree = $tree; $have.skipped = ''; $have.files = $remote
    Write-Record $have
    Say ('Updated: ' + $what) Green
    return $true
} catch {
    Write-Host ''
    Say ('The update did not finish: ' + $_.Exception.Message) Red
    if ($placing) { Say 'Some files were already replaced. Start the server again to finish the update.' Yellow }
    else { Say 'Nothing was changed. Starting with the version already here.' DarkGray }
    return $false
}
