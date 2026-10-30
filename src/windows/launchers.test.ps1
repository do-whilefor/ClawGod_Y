$ErrorActionPreference = 'Stop'
$template = Get-Content (Join-Path $PSScriptRoot '..\templates\install.ps1') -Raw
$section = [regex]::Match($template, '(?s)\$cliPathInCmd =.*').Value
if (-not $section) { throw 'Installer launcher section not found' }
$install = [ScriptBlock]::Create($section)
$root = Join-Path ([IO.Path]::GetTempPath()) ('clawgod-launchers-' + [Guid]::NewGuid().ToString('N'))
$savedHome = $env:USERPROFILE
$savedLocal = $env:LOCALAPPDATA
$savedPath = $env:PATH
$savedUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
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
    function Invoke-RestMethod { $template }

    $exe = Join-Path $BinDir 'claude.exe'
    $cmd = Join-Path $BinDir 'claude.cmd'
    $clawgod = Join-Path $BinDir 'clawgod.cmd'

    Set-Content $exe 'official native' -Encoding ASCII
    $originalContent = Get-Content $exe -Raw
    Set-Content (Join-Path $ClawDir 'claude.staged.exe') 'selected native'
    & $install
    Assert (Test-Path $clawgod) 'clawgod.cmd was not written'
    Assert ((Get-Content $exe -Raw) -eq $originalContent) 'claude.exe was modified'
    Assert (-not (Test-Path $cmd)) 'claude.cmd must not be created'
    Assert (-not (Test-Path (Join-Path $BinDir 'claude.orig.exe'))) 'claude.orig.exe must not be created'
    $written = Get-Content $clawgod -Raw
    Assert ($written -match 'CLAUDE_CODE_EXECPATH=%USERPROFILE%\\\.clawgod\\claude\.fallback\.exe') "execPath did not use the selected native binary: $written"
    Assert ($script:messages -match "'claude' untouched") 'Untouched notice missing'
    Copy-Item $node (Join-Path $ClawDir 'claude.fallback.exe') -Force
    Set-Content (Join-Path $ClawDir 'cli.cjs') @'
const {spawnSync}=require('child_process');
const child=spawnSync(process.env.CLAUDE_CODE_EXECPATH,['--version'],{encoding:'utf8'});
if(child.error)throw child.error;
process.stdout.write(child.stdout);process.exit(child.status);
'@ -Encoding ASCII
    $childVersion = (& cmd.exe /d /c 'clawgod --version' | Out-String).Trim()
    Assert ($LASTEXITCODE -eq 0) 'Selected native subprocess failed'
    Assert ($childVersion -eq (& $node --version)) 'Launcher spawned a different native executable'

    $elsewhere = Join-Path $root 'elsewhere'
    New-Item -ItemType Directory -Force $elsewhere | Out-Null
    Copy-Item $node (Join-Path $elsewhere 'claude.exe')
    $env:PATH = "$elsewhere;$BinDir;$savedPath"
    try {
        & $install
        $written = Get-Content $clawgod -Raw
        Assert ($written -match 'CLAUDE_CODE_EXECPATH=%USERPROFILE%\\\.clawgod\\claude\.fallback\.exe') "PATH overrode the selected native binary: $written"
    } finally {
        $env:PATH = "$BinDir;$savedPath"
    }

    Remove-Item $exe
    $versions = Join-Path $root '.local\share\claude\versions'
    New-Item -ItemType Directory -Force $versions | Out-Null
    Copy-Item $node (Join-Path $versions 'claude-2.1.285.exe')
    & $install
    $written = Get-Content $clawgod -Raw
    Assert ($written -notmatch 'claude-2\.1\.285\.exe') "versions/ must not override the selected native binary: $written"

    Remove-Item -Recurse -Force $versions
    $script:messages.Clear()
    & $install
    Assert (Test-Path (Join-Path $ClawDir 'claude.fallback.exe')) 'Selected native binary is missing'

    Set-Content $exe 'official native' -Encoding ASCII
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
    Assert ((Get-Content $exe -Raw) -eq $originalContent) 'claude.exe was modified during sweep'
    Assert (((Get-Content (Join-Path $ClawDir 'claude.fallback.exe') -Raw).Trim()) -eq 'staged') 'Selected native binary was not refreshed'

    Set-Content $cmd '@echo original-launcher' -Encoding Ascii
    & $install
    Assert ((Get-Content $cmd -Raw) -match 'original-launcher') 'A genuine user claude.cmd was removed'

    Assert ((& cmd.exe /d /c 'clawgod import 2>&1') -match 'import tool not installed|cli\.cjs not found') 'clawgod.cmd is not executable via cmd.exe'

    Write-Host '[launchers.test] selected native isolation, repeated installs, and legacy-artifact sweep passed'
} finally {
    $env:USERPROFILE = $savedHome
    $env:LOCALAPPDATA = $savedLocal
    $env:PATH = $savedPath
    [Environment]::SetEnvironmentVariable('Path', $savedUserPath, 'User')
    Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}

exit 0
