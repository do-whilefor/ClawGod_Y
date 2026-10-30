$ErrorActionPreference = 'Stop'
$template = Get-Content (Join-Path $PSScriptRoot '..\templates\install.ps1') -Raw
$section = [regex]::Match($template, '(?s)\$cliPathInCmd =.*?(?=\$userPath = \[Environment\]::GetEnvironmentVariable)').Value
if (-not $section) { throw 'Installer launcher section not found' }
$install = [ScriptBlock]::Create($section)
$root = Join-Path ([IO.Path]::GetTempPath()) ('clawgod-launchers-' + [Guid]::NewGuid().ToString('N'))
$savedHome = $env:USERPROFILE
$savedLocal = $env:LOCALAPPDATA
$savedPath = $env:PATH
$node = (Get-Command node.exe).Source
$script:messages = New-Object 'System.Collections.Generic.List[string]'
function Write-OK($message) { $script:messages.Add($message) }
function Write-Warn($message) { $script:messages.Add($message) }
function Write-Dim($message) { $script:messages.Add($message) }
function Assert($condition, $message) { if (-not $condition) { throw $message } }

try {
    $env:USERPROFILE = $root
    $env:LOCALAPPDATA = Join-Path $root 'AppData\Local'
    $BinDir = Join-Path $root '.local\bin'
    New-Item -ItemType Directory -Force $BinDir | Out-Null
    $ClawDir = Join-Path $root '.clawgod'
    New-Item -ItemType Directory -Force $ClawDir | Out-Null
    $env:PATH = "$BinDir;$savedPath"
    $BunBin = $node
    function Invoke-WebRequest { throw 'offline' }

    $exe = Join-Path $BinDir 'claude.exe'
    $cmd = Join-Path $BinDir 'claude.cmd'
    $clawgod = Join-Path $BinDir 'clawgod.cmd'

    Copy-Item $node $exe
    $originalHash = (Get-FileHash $exe).Hash
    & $install
    Assert (Test-Path $clawgod) 'clawgod.cmd was not written'
    Assert ((Get-FileHash $exe).Hash -eq $originalHash) 'claude.exe was modified'
    Assert (-not (Test-Path $cmd)) 'claude.cmd must not be created'
    Assert (-not (Test-Path (Join-Path $BinDir 'claude.orig.exe'))) 'claude.orig.exe must not be created'
    $written = Get-Content $clawgod -Raw
    Assert ($written -match 'CLAUDE_CODE_EXECPATH=%USERPROFILE%\\\.local\\bin\\claude\.exe') "execPath was not pointed at the discovered claude.exe: $written"
    Assert ($script:messages -match "'claude' untouched") 'Untouched notice missing'

    $elsewhere = Join-Path $root 'elsewhere'
    New-Item -ItemType Directory -Force $elsewhere | Out-Null
    Copy-Item $node (Join-Path $elsewhere 'claude.exe')
    $env:PATH = "$elsewhere;$BinDir;$savedPath"
    try {
        & $install
        $written = Get-Content $clawgod -Raw
        Assert ($written -match 'CLAUDE_CODE_EXECPATH=%USERPROFILE%\\elsewhere\\claude\.exe') "execPath did not follow PATH claude.exe: $written"
    } finally {
        $env:PATH = "$BinDir;$savedPath"
    }

    Remove-Item $exe
    $versions = Join-Path $root '.local\share\claude\versions'
    New-Item -ItemType Directory -Force $versions | Out-Null
    Copy-Item $node (Join-Path $versions 'claude-2.1.285.exe')
    & $install
    $written = Get-Content $clawgod -Raw
    Assert ($written -match 'claude-2\.1\.285\.exe') "versions/ fallback was not used: $written"

    Remove-Item -Recurse -Force $versions
    $script:messages.Clear()
    & $install
    Assert ($script:messages -match 'No existing claude\.exe found') 'Missing-claude notice missing'

    Copy-Item $node $exe
    Set-Content $cmd "@echo off`r`nrem $root\.clawgod\cli.cjs" -Encoding Ascii
    Set-Content (Join-Path $BinDir 'claude.orig.cmd') '@echo old' -Encoding Ascii
    Copy-Item $node (Join-Path $BinDir 'claude.orig.exe')
    Copy-Item $node (Join-Path $BinDir 'claude.abcdef.exe')
    Set-Content (Join-Path $ClawDir 'claude.staged.exe') 'staged'
    & $install
    Assert (-not (Test-Path $cmd)) 'Old clawgod claude.cmd launcher was not swept'
    Assert (-not (Test-Path (Join-Path $BinDir 'claude.orig.cmd'))) 'claude.orig.cmd was not swept'
    Assert (-not (Test-Path (Join-Path $BinDir 'claude.orig.exe'))) 'claude.orig.exe was not swept'
    Assert (-not (Test-Path (Join-Path $BinDir 'claude.abcdef.exe'))) 'Timestamped exe was not swept'
    Assert (-not (Test-Path (Join-Path $ClawDir 'claude.staged.exe'))) 'Staged binary was not swept'
    Assert ((Get-FileHash $exe).Hash -eq $originalHash) 'claude.exe was modified during sweep'

    Set-Content $cmd '@echo original-launcher' -Encoding Ascii
    & $install
    Assert ((Get-Content $cmd -Raw) -match 'original-launcher') 'A genuine user claude.cmd was removed'

    Assert ((& cmd.exe /d /c 'clawgod import 2>&1') -match 'import tool not installed|cli\.cjs not found') 'clawgod.cmd is not executable via cmd.exe'

    Write-Host '[launchers.test] clawgod-only launcher, execPath discovery, and legacy-artifact sweep passed'
} finally {
    $env:USERPROFILE = $savedHome
    $env:LOCALAPPDATA = $savedLocal
    $env:PATH = $savedPath
    Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}

exit 0
