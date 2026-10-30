#Requires -Version 5.1
param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$Version = "2.1.314"

$ClawDir = Join-Path $env:USERPROFILE ".clawgod"
$BinDir  = Join-Path $env:USERPROFILE ".local\bin"
$ClawSelfVersion = "0.0.0-dev"

function Write-OK($msg)   { Write-Host "  $([char]0x2713) $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  $([char]0x2717) $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Dim($msg)  { Write-Host "  $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ClawGod Installer" -ForegroundColor White -NoNewline
Write-Host " (Windows)" -ForegroundColor DarkGray
Write-Host ""

if ($Uninstall) {
    $clawgodCmd = Join-Path $BinDir "clawgod.cmd"
    if (Test-Path $clawgodCmd) {
        Remove-Item -Force $clawgodCmd
        Write-OK "Removed clawgod launcher"
    }
    foreach ($leftover in @("claude.orig.cmd", "claude.orig.exe")) {
        $p = Join-Path $BinDir $leftover
        if (Test-Path $p) { Remove-Item -Force $p }
    }

    foreach ($f in @("cli.js","cli.cjs","cli.original.js","cli.original.cjs","cli.original.js.bak","cli.original.cjs.bak","source-backup.json","patch.js","patch.mjs","ast-patches.mjs","pentest-patches.mjs","pentest-scanners.mjs","pentest-trimming.mjs","pentest-policy-text.mjs","pentest-pruner.mjs","lean-mode.cjs","lean-settings.json",".lean-disabled",".lean-max","acorn.mjs","acorn.LICENSE","extract-natives.mjs","post-process.mjs","repatch.mjs","startup-check.cjs","startup-check.log","openai-proxy.cjs","feature-gates.cjs","runtime-helpers.cjs","bun-ant-shim.cjs","clawgod-import.exe","claude.staged.exe","claude.fallback.exe",".source-version","node_modules","bun-runtime","vendor","bunfs","pathmap.json")) {
        $p = Join-Path $ClawDir $f
        if (Test-Path $p) { Remove-Item -Recurse -Force $p }
    }
    Remove-Item -LiteralPath (Join-Path $ClawDir "compile-runtime.mjs"), (Join-Path $ClawDir ".compiled-runtime") -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $ClawDir -Filter "cli.compiled-*" -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    Get-ChildItem -LiteralPath $ClawDir -Filter "claude.fallback.*.exe" -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    Write-OK "ClawGod uninstalled"
    Write-Host ""
    Write-Dim "Restart your terminal for changes to take effect."
    Write-Host ""
    exit 0
}

try { $null = Get-Command node -ErrorAction Stop }
catch {
    Write-Err "Node.js is required (>= 18) for the patcher. Install from https://nodejs.org"
    exit 1
}

$nodeVer = [int](node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeVer -lt 18) {
    Write-Err "Node.js >= 18 required (found v$nodeVer)"
    exit 1
}

$BunBin = $null
try { $BunBin = (Get-Command bun -ErrorAction Stop).Source } catch {}
if (-not $BunBin) {
    $homeBun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
    if (Test-Path $homeBun) { $BunBin = $homeBun }
}
if (-not $BunBin) {
    Write-Dim "Installing Bun (required runtime for v2.1.113+ cli.js) ..."
    try {
        Invoke-Expression "$(Invoke-RestMethod https://bun.sh/install.ps1)" 2>$null | Out-Null
    } catch {}
    $BunBin = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
    if (-not (Test-Path $BunBin)) {
        Write-Err "Bun installation failed. Install manually: https://bun.sh/install"
        exit 1
    }
}

if ($BunBin -match '\.ps1$') {
    $resolved = $null
    $bunDir = Split-Path $BunBin

    $cand = Join-Path $bunDir "node_modules\bun\bin\bun.exe"
    if (Test-Path $cand) { $resolved = $cand }

    if (-not $resolved) {
        $cand = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
        if (Test-Path $cand) { $resolved = $cand }
    }

    if (-not $resolved) {
        $cand = Join-Path $env:USERPROFILE "scoop\shims\bun.exe"
        if (Test-Path $cand) { $resolved = $cand }
    }

    if (-not $resolved) {
        $chocoBin = Join-Path $env:ProgramData "chocolatey\bin\bun.exe"
        if (Test-Path $chocoBin) { $resolved = $chocoBin }
    }
    if ($resolved) {
        Write-Dim "Resolved bun.ps1 -> $resolved"
        $BunBin = $resolved
    } else {
        Write-Warn "Bun resolved to .ps1 wrapper ($BunBin). The launcher may not work."
        Write-Warn "Consider installing Bun via bun.sh/install.ps1 for a native bun.exe."
    }
}
Write-OK "Bun: $(& $BunBin --version)"


$MinBunVersion = '1.3.14'
$BunVersionRaw = ''
try {
    $bunOut = & $BunBin --version 2>$null | Select-Object -First 1
    if ($bunOut) { $BunVersionRaw = "$bunOut".Trim() }
} catch {}
$BunVersionNum = ($BunVersionRaw -split '-')[0]
$BunVersionOk = $false
try {
    if ($BunVersionNum) {
        $BunVersionOk = ([version]$BunVersionNum) -ge ([version]$MinBunVersion)
    }
} catch {}
if (-not $BunVersionOk) {
    Write-Host ""
    Write-Err "Bun $BunVersionRaw is below the required minimum ($MinBunVersion)."
    Write-Err ""
    Write-Err "  Anthropic builds claude-code with Bun's canary channel. Older Bun"
    Write-Err "  panics on cli.original.cjs with 'Expected CommonJS module to have"
    Write-Err "  a function wrapper'. This is a hard requirement, not a warning."
    Write-Err ""
    Write-Err "  Upgrade with one of:"
    Write-Err "    bun upgrade --canary"
    Write-Err "    powershell -c ""iex & {`$(irm https://bun.sh/install.ps1)} -Version canary"""
    Write-Err ""
    Write-Err "  If your bun is from scoop (the binary is behind a shim and refuses"
    Write-Err "  to self-replace, so 'bun upgrade' silently hangs):"
    Write-Err "    scoop uninstall bun"
    Write-Err "    irm https://bun.sh/install.ps1 | iex"
    Write-Err "    bun upgrade --canary"
    Write-Err ""
    Write-Err "  Then re-run this installer."
    exit 1
}

try {
    $rgPath = (Get-Command rg -ErrorAction Stop).Source
    Write-OK "ripgrep: $rgPath"
}
catch {
    Write-Err "ripgrep (rg) is required but not found in PATH."
    Write-Err "  Claude Code's Grep tool will not function without it."
    Write-Err ""
    Write-Err "  Install: winget install BurntSushi.ripgrep.MSVC"
    Write-Err "       or: scoop install ripgrep"
    Write-Err "       or: choco install ripgrep"
    Write-Err ""
    Write-Err "  Re-run this script after installing rg."
    exit 1
}

New-Item -ItemType Directory -Force -Path $ClawDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir  | Out-Null

$NativeBin = $null

if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") {
    $arch = "arm64"
} else {
    $arch = "x64"
}
$platformSuffix = "win32-$arch"


$npmPkg = "@anthropic-ai/claude-code-$platformSuffix"
Write-Dim "Fetching $npmPkg@$Version from npm registry ..."
$NativeBinTmpDir = Join-Path $env:TEMP "clawgod-binary-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $NativeBinTmpDir | Out-Null
$fetchScript = Join-Path $NativeBinTmpDir "fetch.mjs"
$useNpmFetch = $false
$noProxy = $env:NO_PROXY
if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) {
    if ($noProxy -match '(?i)npmjs\.org') {
        Write-Dim "NO_PROXY includes npmjs.org -- using direct fetch"
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        $useNpmFetch = $true
    } else {
        Write-Warn "HTTP proxy detected but npm not found. fetch.mjs may not work through your proxy."
        Write-Warn "Install npm or set NO_PROXY=registry.npmjs.org to bypass."
    }
}
if ($useNpmFetch) {
    Push-Location $NativeBinTmpDir
    try {
        $npmOut = npm pack "$npmPkg@$Version" --silent 2>&1
        $tarball = Get-ChildItem $NativeBinTmpDir -Filter "*.tgz" | Select-Object -First 1
        if ($tarball) {
            tar xzf $tarball.FullName 2>$null
            $cand = Join-Path $NativeBinTmpDir "package\claude.exe"
            if ((Test-Path $cand) -and (Get-Item $cand).Length -gt 10MB) {
                $NativeBin = $cand
                $pkgJson = Join-Path $NativeBinTmpDir "package\package.json"
                if (Test-Path $pkgJson) {
                    $NativeBinLabel = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
                } else { $NativeBinLabel = "npm-latest" }
                Write-OK "Downloaded $npmPkg@$NativeBinLabel (via npm)"
            }
        }
    } finally { Pop-Location }
    if (-not $NativeBin) {
        Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
        Write-Err "npm pack failed. Output:"
        Write-Dim ($npmOut -join "`n")
        exit 1
    }
} else {
@'
{{CLAWGOD:npm-fetch.mjs}}
'@ | Set-Content $fetchScript -Encoding UTF8

    $output = & node $fetchScript "$npmPkg@$Version" $NativeBinTmpDir 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host "  $_" }
    Remove-Item -Force $fetchScript -ErrorAction SilentlyContinue

    if ($exitCode -ne 0) {
        Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
        Write-Err "Fetch failed (node exit $exitCode). Install the official binary manually:"
        Write-Err "    irm https://claude.ai/install.ps1 | iex"
        exit 1
    }

    $cand = Join-Path $NativeBinTmpDir "package\claude.exe"
    if ((Test-Path $cand) -and (Get-Item $cand).Length -gt 10MB) {
        $NativeBin = $cand
        $verLine = $output | Where-Object { $_ -match '^VERSION=' } | Select-Object -First 1
        if ($verLine) { $NativeBinLabel = ($verLine -replace '^VERSION=', '').Trim() }
        else { $NativeBinLabel = "npm-latest" }
    } else {
        Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
        Write-Err "Tarball downloaded but expected package\claude.exe was missing or too small."
        Write-Err "  Tempdir kept for inspection: $NativeBinTmpDir"
        exit 1
    }
    Write-OK "Downloaded $npmPkg@$NativeBinLabel"
}

$RollbackDir = $null
$script:RollbackPending = $false
$RollbackFiles = @("cli.original.cjs","cli.original.cjs.bak","cli.original.js",".source-version",
    "source-backup.json","bunfs","vendor","pathmap.json","extract-natives.mjs","post-process.mjs",
    "openai-proxy.cjs","feature-gates.cjs","cli.cjs",".clawgod-version",
    "startup-check.cjs","compile-runtime.mjs",".compiled-runtime","runtime-helpers.cjs","bun-ant-shim.cjs","system-prompt.md","patch.mjs","patch-registry.mjs","ast-patches.mjs","pentest-patches.mjs","pentest-scanners.mjs","pentest-trimming.mjs","pentest-policy-text.mjs","pentest-pruner.mjs","lean-mode.cjs","acorn.mjs","acorn.LICENSE")
$origCjs = Join-Path $ClawDir "cli.original.cjs"
$sourceVerFile = Join-Path $ClawDir ".source-version"
if ((Test-Path $origCjs) -and (Test-Path $sourceVerFile)) {
    $RollbackDir = Join-Path ([System.IO.Path]::GetTempPath()) ("clawgod-rollback-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $RollbackDir -Force | Out-Null
    try {
        foreach ($f in $RollbackFiles) {
            $path = Join-Path $ClawDir $f
            if (Test-Path $path) { Copy-Item -LiteralPath $path -Destination $RollbackDir -Recurse -Force -ErrorAction Stop }
        }
    } catch {
        Remove-Item -LiteralPath $RollbackDir -Recurse -Force -ErrorAction SilentlyContinue
        throw "Could not snapshot existing installation; installation was not changed: $_"
    }
}

function Restore-Install {
    Remove-Item -LiteralPath (Join-Path $ClawDir "claude.staged.exe") -Force -ErrorAction SilentlyContinue
    if (-not $script:RollbackPending) { return }
    $script:RollbackPending = $false
    if (-not $RollbackDir) { return }
    Write-Dim "Rolling back to previous working installation ..."
    try {
        foreach ($f in $RollbackFiles) {
            $path = Join-Path $ClawDir $f
            if (Test-Path $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
        }
        Get-ChildItem -LiteralPath $RollbackDir -Force | Copy-Item -Destination $ClawDir -Recurse -Force -ErrorAction Stop
        Write-OK "Restored previous working installation ($((Get-Content $sourceVerFile -Raw).Trim()))."
        Remove-Item -LiteralPath $RollbackDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Err "Rollback failed; backup kept at $RollbackDir : $_"
    }
}
$script:RollbackPending = $true
trap { Restore-Install; break }

$extractorPath = Join-Path $ClawDir "extract-natives.mjs"
@'
{{CLAWGOD:extract-natives.mjs}}
'@ | Set-Content $extractorPath -Encoding UTF8

$VendorDir = Join-Path $ClawDir "vendor"
if (Test-Path $VendorDir) { Remove-Item -Recurse -Force $VendorDir }

$BunfsDir = Join-Path $ClawDir "bunfs"
if (Test-Path $BunfsDir) { Remove-Item -Recurse -Force $BunfsDir }
$PathMap = Join-Path $ClawDir "pathmap.json"
if (Test-Path $PathMap) { Remove-Item -Force $PathMap }

$dstCli = Join-Path $ClawDir "cli.original.js"
if (Test-Path $dstCli) { Remove-Item -Force $dstCli }

Write-Dim "Extracting cli.js + napi modules from $NativeBinLabel ..."
& node $extractorPath $NativeBin $ClawDir 2>&1 | ForEach-Object { Write-Host "  $_" }
if (($LASTEXITCODE -ne 0) -or -not (Test-Path $dstCli)) {
    Write-Err "Failed to extract cli.js from native binary"
    Restore-Install
    exit 1
}

Write-Dim "Rewriting bunfs paths and IIFE invocation ..."
$postProc = Join-Path $ClawDir "post-process.mjs"
@'
{{CLAWGOD:post-process.mjs}}
'@ | Set-Content $postProc -Encoding UTF8
try { $ProxySource = Get-Content (Join-Path $PSScriptRoot "openai-proxy.cjs") -Raw -ErrorAction Stop } catch { $ProxySource = $null }
if (-not $ProxySource) {

  $ProxySource = @'
{{CLAWGOD:openai-proxy.cjs}}
'@
}
$ProxySource | Set-Content (Join-Path $ClawDir "openai-proxy.cjs") -Encoding UTF8
Write-OK "OpenAI-compatible proxy created (openai-proxy.cjs)"

@'
{{CLAWGOD:feature-gates.cjs}}
'@ | Set-Content (Join-Path $ClawDir "feature-gates.cjs") -Encoding UTF8
Write-OK "Patch feature gates created (feature-gates.cjs)"

@'
{{CLAWGOD:cli.cjs}}
'@ | Set-Content (Join-Path $ClawDir "cli.cjs") -Encoding UTF8
Set-Content (Join-Path $ClawDir ".clawgod-version") $ClawSelfVersion
Write-OK "Wrapper created (cli.cjs)"

@'
{{CLAWGOD:startup-check.cjs}}
'@ | Set-Content (Join-Path $ClawDir "startup-check.cjs") -Encoding UTF8

@'
{{CLAWGOD:runtime-helpers.cjs}}
'@ | Set-Content (Join-Path $ClawDir "runtime-helpers.cjs") -Encoding UTF8
Write-OK "Classifier helper created (runtime-helpers.cjs)"

@'
{{CLAWGOD:bun-ant-shim.cjs}}
'@ | Set-Content (Join-Path $ClawDir "bun-ant-shim.cjs") -Encoding UTF8
Write-OK "Bun.ant runtime shim created (bun-ant-shim.cjs)"

@'
{{CLAWGOD:compile-runtime.mjs}}
'@ | Set-Content (Join-Path $ClawDir "compile-runtime.mjs") -Encoding UTF8

@'
{{CLAWGOD:acorn.mjs}}
'@ | Set-Content (Join-Path $ClawDir "acorn.mjs") -Encoding UTF8
@'
{{CLAWGOD:acorn.LICENSE}}
'@ | Set-Content (Join-Path $ClawDir "acorn.LICENSE") -Encoding UTF8

& node $postProc 2>&1 | ForEach-Object { Write-Host "  $_" }
if (($LASTEXITCODE -ne 0) -or -not (Test-Path (Join-Path $ClawDir "cli.original.cjs"))) {
    Write-Err "Post-process failed"
    Restore-Install
    exit 1
}

Set-Content -Path (Join-Path $ClawDir ".source-version") -Value $NativeBinLabel -Encoding ASCII

if ($NativeBin -and (Test-Path $NativeBin)) {
    Move-Item -Force $NativeBin (Join-Path $ClawDir "claude.staged.exe")
}

if ($NativeBinTmpDir -and (Test-Path $NativeBinTmpDir)) {
    Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
}

Write-OK "cli.original.cjs ready ($NativeBinLabel)"

@'
{{CLAWGOD:ast-patches.mjs}}
'@ | Set-Content (Join-Path $ClawDir "ast-patches.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-patches.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-patches.mjs") -Encoding UTF8

@'
{{CLAWGOD:pentest-scanners.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-scanners.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-trimming.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-trimming.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-policy-text.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-policy-text.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-pruner.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-pruner.mjs") -Encoding UTF8
@'
{{CLAWGOD:lean-mode.cjs}}
'@ | Set-Content (Join-Path $ClawDir "lean-mode.cjs") -Encoding UTF8

$systemPromptEscaped = @'
{{CLAWGOD:system-prompt.md}}
'@
$systemPromptText = [Regex]::Replace($systemPromptEscaped, '\\u([0-9a-fA-F]{4})', { param($m) [char]([Convert]::ToInt32($m.Groups[1].Value, 16)) }) -join ''
Set-Content (Join-Path $ClawDir "system-prompt.md") $systemPromptText -Encoding UTF8

$patcherCode = @'
{{CLAWGOD:patch.mjs}}
'@
$patchRegistryCode = @'
{{CLAWGOD:patch-registry.mjs}}
'@

Set-Content (Join-Path $ClawDir "patch.mjs") $patcherCode -Encoding UTF8
Set-Content (Join-Path $ClawDir "patch-registry.mjs") $patchRegistryCode -Encoding UTF8
Write-OK "Patcher created (patch.mjs)"


& {
    $ErrorActionPreference = 'Continue'
    node (Join-Path $ClawDir "patch.mjs") --capture-clean-source 2>&1 | ForEach-Object { Write-Host "  $_" }
    $script:captureExitCode = $LASTEXITCODE
}
if ($captureExitCode -ne 0) { Restore-Install; exit $captureExitCode }
Write-Dim "Applying patches ..."
$patchExitCode = 0
& {
    $ErrorActionPreference = 'Continue'
    node (Join-Path $ClawDir "patch.mjs") 2>&1 | ForEach-Object { Write-Host "  $_" }
    $script:patchExitCode = $LASTEXITCODE
}
if ($patchExitCode -ne 0) {
    $exitCode = $patchExitCode
    Write-Err "Patching failed (node exit $exitCode). Installation aborted."
    Restore-Install
    if (-not $RollbackDir) {
        Write-Err "No previous working installation found to roll back."
    }
    Write-Err ""
    Write-Err "The new Claude Code build ($NativeBinLabel) is not yet supported by this ClawGod release."
    Write-Err "Optional unmatched patches are already skipped; required prompt injection and source errors cannot be skipped."
    Write-Err "Rerun the current installer to reinstall Claude Code 2.1.314."
    exit $exitCode
}

Write-Dim "Compiling startup runtime ..."
& {
    $ErrorActionPreference = 'Continue'
    & $BunBin (Join-Path $ClawDir "compile-runtime.mjs") 2>&1 | ForEach-Object { Write-Host "  $_" }
    $script:compileExitCode = $LASTEXITCODE
}
if ($compileExitCode -ne 0) { Restore-Install; exit $compileExitCode }

$needsShim = $false
$bunfsDir = Join-Path $ClawDir "bunfs"
$targets = @()
if (Test-Path $bunfsDir) {
    $targets += Get-ChildItem -Path $bunfsDir -File -ErrorAction SilentlyContinue
}
$entry = Join-Path $ClawDir "cli.original.cjs"
if (Test-Path $entry) { $targets += Get-Item $entry }

$hit = $targets |
    Select-String -Pattern 'Bun\.ant\.CellSegmenter' -List -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($hit) { $needsShim = $true }
if ($needsShim) {
    Write-Dim "Renderer runtime: Bun.ant.CellSegmenter (Claude >= 2.1.271) - served by bun-ant-shim.cjs"
} else {
    Write-Dim "Renderer runtime: stock Bun APIs (shim present but unused)"
}

$featuresFile = Join-Path $ClawDir "features.json"
if (-not (Test-Path $featuresFile)) {
    $featuresJson = @'
{{CLAWGOD:features.json}}
'@
    [System.IO.File]::WriteAllText($featuresFile, $featuresJson, (New-Object System.Text.UTF8Encoding $false))
    Write-OK "Default features.json created"
}

$patchesFile = Join-Path $ClawDir "patches.json"
if (-not (Test-Path $patchesFile)) {
    [System.IO.File]::WriteAllText($patchesFile, "{}`r`n", (New-Object System.Text.UTF8Encoding $false))
    Write-OK "Default patches.json created (all features on)"
}

$providerFile = Join-Path $ClawDir "provider.json"
if (-not (Test-Path $providerFile)) {
    $providerJson = @'
{
  "protocol": "anthropic",
  "apiKey": "",
  "baseURL": "https://api.anthropic.com",
  "model": "",
  "smallModel": "",
  "effort": "",
  "timeoutMs": 3000000
}
'@
    [System.IO.File]::WriteAllText($providerFile, $providerJson, (New-Object System.Text.UTF8Encoding $false))
}

$claudeSettingsDir = Join-Path $env:USERPROFILE ".claude"
$claudeSettings = Join-Path $claudeSettingsDir "settings.json"
$leanSettings = Join-Path $ClawDir "lean-settings.json"
New-Item -ItemType Directory -Force -Path $claudeSettingsDir | Out-Null

foreach ($legacyFlag in @(".lean-disabled", ".lean-max")) {
    $legacyPath = Join-Path $ClawDir $legacyFlag
    if (Test-Path $legacyPath) { Remove-Item $legacyPath -Force }
}

$leanApplyScript = @'
{{CLAWGOD:lean-apply.cjs}}
'@
try {
    node -e $leanApplyScript "$leanSettings" "$claudeSettings" (Join-Path $ClawDir "patches.json") 2>$null
    Write-OK "Lean settings applied (strictest, clawgod-scoped): ~\.clawgod\lean-settings.json"
} catch {}

Write-Dim "Verifying Bun can load patched cli.original.cjs (bounded startup check) ..."
$sanityCli = Join-Path $ClawDir "cli.cjs"
$sanityOut = $null
try {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $sanityOut = (& node (Join-Path $ClawDir "startup-check.cjs") $BunBin $sanityCli 2>&1 | Out-String)
    $sanityExitCode = $LASTEXITCODE
} catch {
    $sanityOut = "$_"
    $sanityExitCode = 1
} finally {
    $ErrorActionPreference = $prevEAP
}
if ($sanityOut -match "Expected CommonJS module to have a function wrapper") {
    Write-Host ""
    Write-Err "The selected Bun runtime cannot load Anthropic's cli.original.cjs."
    Write-Err ""
    Write-Err "  Anthropic builds with Bun's canary channel (currently ~1.3.14), while"
    Write-Err "  bun.sh's main download is on stable (currently 1.3.13). The canary build"
    Write-Err "  is NOT visible on bun.sh's download page -- it lives on GitHub Releases"
    Write-Err "  and is reachable only via 'bun upgrade --canary'."
    Write-Err ""
    Write-Err "  If your bun is from bun.sh:"
    Write-Err "    bun upgrade --canary"
    Write-Err "    or: powershell -c ""iex & {`$(irm https://bun.sh/install.ps1)} -Version canary"""
    Write-Err ""
    Write-Err "  If your bun is from scoop (the binary is behind a shim and refuses to"
    Write-Err "  self-replace, so 'bun upgrade' silently hangs):"
    Write-Err "    scoop uninstall bun"
    Write-Err "    irm https://bun.sh/install.ps1 | iex"
    Write-Err "    bun upgrade --canary"
    Write-Err ""
    Write-Err "  Then re-run .\install.ps1 -- this sanity check will pass."
    Restore-Install
    exit 1
}
if ($sanityExitCode -ne 0) {
    Write-Host ""
    Write-Err "Patched Claude failed its startup check (exit $sanityExitCode):"
    Write-Err "$sanityOut"
    Restore-Install
    exit $sanityExitCode
}
Write-OK "Bun loads cli.original.cjs"
Write-Dim "Verifying tool/command tables load (bounded probe) ..."
$probeOut = $null
try {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $probeOut = (& node (Join-Path $ClawDir "startup-check.cjs") $BunBin $sanityCli --probe-tools 2>&1 | Out-String)
    $probeExitCode = $LASTEXITCODE
} catch {
    $probeOut = "$_"
    $probeExitCode = 1
} finally {
    $ErrorActionPreference = $prevEAP
}
if ($probeExitCode -ne 0) {
    Write-Host ""
    Write-Err "Patched Claude failed its tool-table probe (exit $probeExitCode):"
    Write-Err "$probeOut"
    Restore-Install
    exit $probeExitCode
}
Write-OK "Tool and command tables load cleanly"
$script:RollbackPending = $false
if ($RollbackDir) { Remove-Item -LiteralPath $RollbackDir -Recurse -Force -ErrorAction SilentlyContinue }
$compiledName = $null
if (Test-Path (Join-Path $ClawDir ".compiled-runtime")) {
    $compiledName = (Get-Content -LiteralPath (Join-Path $ClawDir ".compiled-runtime") -Raw).Trim()
}
Get-ChildItem -LiteralPath $ClawDir -Filter "cli.compiled-*" -File |
    Where-Object { $_.Name -ne $compiledName } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }


$cliPathInCmd = "%USERPROFILE%\.clawgod\cli.cjs"
$normalizedUserProfile = $env:USERPROFILE.TrimEnd('\', '/')
$normalizedBunBin = $BunBin.TrimEnd('\', '/')
$userProfilePrefix = "$normalizedUserProfile\"
if ($normalizedBunBin.Equals($normalizedUserProfile, [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedBunBin.StartsWith($userProfilePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    $bunRelative = $normalizedBunBin.Substring($normalizedUserProfile.Length).TrimStart('\', '/')
    $bunPathInCmd = "%USERPROFILE%\$bunRelative"
} else {

    $bunPathInCmd = $BunBin
}

$claudeExeForPath = $null
$foundClaude = Get-Command claude.exe -ErrorAction SilentlyContinue
if ($foundClaude) {
    $claudeExeForPath = $foundClaude.Source
} else {
    foreach ($loc in @(
        (Join-Path $BinDir "claude.exe"),
        (Join-Path $env:USERPROFILE ".local\share\claude\versions")
    )) {
        if (Test-Path $loc -PathType Leaf) { $claudeExeForPath = $loc; break }
        if (Test-Path $loc -PathType Container) {
            $latestExe = Get-ChildItem $loc -Filter "claude*.exe" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($latestExe) { $claudeExeForPath = $latestExe.FullName; break }
        }
    }
}
if (-not $claudeExeForPath) {
    $claudeExeForPath = Join-Path $ClawDir "claude.fallback.exe"
    $stagedFallback = Join-Path $ClawDir "claude.staged.exe"
    if (Test-Path $stagedFallback) {
        if (Test-Path $claudeExeForPath) {
            try {
                Remove-Item -LiteralPath $claudeExeForPath -Force -ErrorAction Stop
            } catch {
                $retiredFallback = Join-Path $ClawDir ("claude.fallback." + [Guid]::NewGuid().ToString('N') + ".exe")
                Move-Item -LiteralPath $claudeExeForPath -Destination $retiredFallback -ErrorAction Stop
            }
        }
        Move-Item -LiteralPath $stagedFallback -Destination $claudeExeForPath -Force
        Write-OK "Native execPath fallback refreshed (claude.fallback.exe)"
    }
    Write-Dim "No existing claude.exe found -- CLAUDE_CODE_EXECPATH will point at $claudeExeForPath"
}
$normalizedClaudeExe = $claudeExeForPath.TrimEnd('\', '/')
if ($normalizedClaudeExe.StartsWith($userProfilePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    $claudeExeInCmd = "%USERPROFILE%\" + $normalizedClaudeExe.Substring($normalizedUserProfile.Length).TrimStart('\', '/')
} else {
    $claudeExeInCmd = $claudeExeForPath
}

$importBin = Join-Path $ClawDir "clawgod-import.exe"
if (-not (Test-Path $importBin)) {
    $importUrl = "https://github.com/do-whilefor/Clawgod_Y/releases/latest/download/clawgod-import-windows-x64.exe"
    try {
        Invoke-WebRequest -Uri $importUrl -OutFile $importBin -UseBasicParsing -ErrorAction Stop
        Write-OK "Provider import tool installed (clawgod-import.exe)"
    } catch {
        Write-Dim "Provider import tool not yet available (build pending)"
    }
}

$importPathInCmd = "%USERPROFILE%\.clawgod\clawgod-import.exe"
$launcherContent = "@echo off`r`nif `"%~1`"==`"import`" (`r`n  if exist `"$importPathInCmd`" (`r`n    shift`r`n    `"$importPathInCmd`" %1 %2 %3 %4 %5 %6 %7 %8 %9`r`n    exit /b %ERRORLEVEL%`r`n  ) else (`r`n    echo clawgod: import tool not installed. Reinstall clawgod to get it.`r`n    exit /b 127`r`n  )`r`n)`r`nif not exist `"$cliPathInCmd`" (`r`n  echo clawgod: cli.cjs not found. Reinstall: irm https://github.com/do-whilefor/Clawgod_Y/releases/latest/download/install.ps1 ^| iex`r`n  exit /b 127`r`n)`r`nif not exist `"$bunPathInCmd`" (`r`n  echo clawgod: bun not found at $bunPathInCmd. Install: https://bun.sh/install`r`n  exit /b 127`r`n)`r`nset `"CLAUDE_CODE_EXECPATH=$claudeExeInCmd`"`r`nif not defined IS_SANDBOX set `"IS_SANDBOX=1`"`r`n`"$bunPathInCmd`" `"$cliPathInCmd`" %*"

$sourceLaunch = "`"$bunPathInCmd`" `"$cliPathInCmd`" %*"
$compiledLaunch = @"
if "%~1"=="--uninstall" goto source
if not exist "%USERPROFILE%\.clawgod\.compiled-runtime" goto source
set "CLAWGOD_COMPILED="
set /p "CLAWGOD_COMPILED="<"%USERPROFILE%\.clawgod\.compiled-runtime"
if not exist "%USERPROFILE%\.clawgod\%CLAWGOD_COMPILED%" goto source
"%USERPROFILE%\.clawgod\%CLAWGOD_COMPILED%" %*
exit /b %ERRORLEVEL%
:source
$sourceLaunch
"@
$launcherContent = $launcherContent.Replace($sourceLaunch, $compiledLaunch)
$launcherContent | Set-Content (Join-Path $BinDir "clawgod.cmd") -Encoding Default
Write-OK "Command 'clawgod' -> patched; 'claude' untouched"

$selfPath = $MyInvocation.MyCommand.Path
if ($selfPath -and (Test-Path $selfPath) -and
    ([System.IO.Path]::GetFullPath($selfPath) -ne [System.IO.Path]::GetFullPath((Join-Path $ClawDir "install.ps1")))) {
    Copy-Item -LiteralPath $selfPath -Destination (Join-Path $ClawDir "install.ps1") -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path (Join-Path $ClawDir "install.ps1"))) {
    try {
        [System.IO.File]::WriteAllText((Join-Path $ClawDir "install.ps1"),
            (Invoke-RestMethod "https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.ps1"),
            (New-Object System.Text.UTF8Encoding $false))
    } catch {}
}

foreach ($leftover in @("claude.orig.cmd", "claude.orig.exe", "claude.cmd")) {
    $p = Join-Path $BinDir $leftover
    if ((Test-Path $p) -and ($leftover -ne "claude.cmd" -or
        (Select-String -LiteralPath $p -Pattern '\.clawgod[\\/]cli\.(?:cjs|js)' -Quiet -ErrorAction SilentlyContinue))) {
        Remove-Item -Force $p -ErrorAction SilentlyContinue
    }
}
Get-ChildItem $BinDir -Filter "claude.*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
Remove-Item -Force (Join-Path $ClawDir "claude.staged.exe") -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $ClawDir -Filter "claude.fallback.*.exe" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

if ((Get-Command claude.exe -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $ClawDir "claude.fallback.exe"))) {
    Remove-Item -Force (Join-Path $ClawDir "claude.fallback.exe") -ErrorAction SilentlyContinue
    Write-Dim "Removed execPath fallback; a real claude.exe is available"
}


$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
    $env:Path = "$BinDir;$env:Path"
    Write-OK "Added $BinDir to user PATH"
    Write-Dim "(restart terminal for PATH to take effect)"
}

Write-Host ""
Write-Host "  ClawGod installed!" -ForegroundColor Green
Write-Host ""
Write-Dim "  clawgod           -- Start patched Claude Code (pentest build)"
Write-Dim "  claude            -- Original unpatched Claude Code (untouched)"
Write-Host ""
Write-Dim "  Claude Code version: 2.1.314"
Write-Dim "  clawgod --version   -- Query the Claude Code version"
Write-Dim "  clawgod --uninstall -- Uninstall ClawGod"
Write-Dim "  Vanilla 'claude update' keeps working and updates only the original."
Write-Host ""
Write-Dim "  If 'clawgod' is not found, restart your terminal."
Write-Host ""
Write-Dim "  Config: ~/.clawgod/provider.json"
Write-Dim "  Flags:  ~/.clawgod/features.json"
Write-Host ""
Write-Dim "  If 'claude' panics with 'Expected CommonJS module to have a function wrapper',"
Write-Dim "  your Bun lags Anthropic's embedded Bun. Upgrade with one of:"
Write-Dim "    bun upgrade --canary           (if installed from bun.sh)"
Write-Dim "    scoop update bun               (scoop -- may lag stable)"
Write-Dim "    irm https://bun.sh/install.ps1 | iex   (re-install latest)"
Write-Host ""
