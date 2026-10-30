$ErrorActionPreference = 'Stop'
$template = Get-Content (Join-Path $PSScriptRoot '..\templates\install.ps1') -Raw
$ClawDir = Join-Path ([IO.Path]::GetTempPath()) ('clawgod-source-recovery-' + [Guid]::NewGuid().ToString('N'))
$BinDir = Join-Path $ClawDir 'bin'
function Write-OK($message) {}
function Write-Dim($message) {}
function Write-Err($message) {}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
try {
    New-Item -ItemType Directory -Force $ClawDir | Out-Null
    $rollbackSection = [regex]::Match($template, '(?s)\$RollbackDir = \$null.*?(?=\$extractorPath =)').Value
    Assert $rollbackSection 'Rollback section not found'
    $snapshot = [ScriptBlock]::Create($rollbackSection)
    Set-Content (Join-Path $ClawDir 'cli.original.cjs') '// old source'
    Set-Content (Join-Path $ClawDir '.source-version') '2.1.280'
    Set-Content (Join-Path $ClawDir 'cli.cjs') '// old wrapper'
    $astPayloads = @('ast-patches.mjs','acorn.mjs','acorn.LICENSE')
    foreach ($name in $astPayloads) { Set-Content (Join-Path $ClawDir $name) "old $name" }
    New-Item -ItemType Directory -Path (Join-Path $ClawDir 'bunfs') | Out-Null
    Set-Content (Join-Path $ClawDir 'bunfs\commands.js') '// old graph'
    . $snapshot
    Remove-Item -Recurse -Force (Join-Path $ClawDir 'bunfs')
    Set-Content (Join-Path $ClawDir 'cli.original.cjs') '// new source'
    Set-Content (Join-Path $ClawDir '.source-version') '2.1.299'
    Set-Content (Join-Path $ClawDir 'cli.cjs') '// new wrapper'
    foreach ($name in $astPayloads) { Set-Content (Join-Path $ClawDir $name) "new $name" }
    Set-Content (Join-Path $ClawDir 'claude.staged.exe') 'new binary'
    Restore-Install
    Assert (((Get-Content (Join-Path $ClawDir 'cli.original.cjs') -Raw).Trim()) -eq '// old source') 'Source rollback failed'
    Assert (((Get-Content (Join-Path $ClawDir '.source-version') -Raw).Trim()) -eq '2.1.280') 'Version rollback failed'
    Assert (((Get-Content (Join-Path $ClawDir 'cli.cjs') -Raw).Trim()) -eq '// old wrapper') 'Wrapper rollback failed'
    foreach ($name in $astPayloads) {
        Assert (((Get-Content (Join-Path $ClawDir $name) -Raw).Trim()) -eq "old $name") "AST payload rollback failed: $name"
    }
    Assert (((Get-Content (Join-Path $ClawDir 'bunfs\commands.js') -Raw).Trim()) -eq '// old graph') 'Graph rollback failed'
    Assert (-not (Test-Path (Join-Path $ClawDir 'claude.staged.exe'))) 'Staged binary was not cleaned up'
    $applySection = [regex]::Match($template, '(?s)& \{\s*\$ErrorActionPreference = ''Continue''\s*node \(Join-Path \$ClawDir "patch\.mjs"\) --capture-clean-source.*?(?=\$bunfsDir = Join-Path \$ClawDir "bunfs")').Value
    Assert $applySection 'Patch application section not found'
    Set-Content (Join-Path $ClawDir 'patch.mjs') 'if(process.argv.includes("--capture-clean-source"))process.exit(0);process.stderr.write("expected diagnostic");process.exit(7)' -Encoding ASCII
    Set-Content (Join-Path $ClawDir 'old.cjs') '// previous working source' -Encoding ASCII
    $clawDirLiteral = $ClawDir.Replace("'", "''")
    $failureScript = @"
`$ErrorActionPreference = 'Stop'
`$ClawDir = '$clawDirLiteral'
function Write-Dim(`$message) {}
function Write-Err(`$message) {}
`$script:restored = 0
function Restore-Install {
    Copy-Item (Join-Path `$ClawDir 'old.cjs') (Join-Path `$ClawDir 'cli.original.cjs') -Force
    `$script:restored++
    Write-Host "RESTORED=`$script:restored"
}
`$NativeBinLabel = 'test'
$applySection
"@
    $failurePath = Join-Path $ClawDir 'patch-failure-test.ps1'
    Set-Content $failurePath $failureScript -Encoding ASCII
    $failureLog = Join-Path $ClawDir 'failure.log'
    $failureErrLog = Join-Path $ClawDir 'failure.err.log'
    $child = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "Invoke-Expression ([IO.File]::ReadAllText('$failurePath'))") -NoNewWindow -Wait -PassThru -RedirectStandardOutput $failureLog -RedirectStandardError $failureErrLog
    $failureExit = $child.ExitCode
    if (Test-Path $failureErrLog) { Get-Content $failureErrLog | Add-Content $failureLog }
    Assert ($failureExit -eq 7) "Patcher stderr changed the installer exit path: $failureExit"
    $failure = Get-Content (Join-Path $ClawDir 'failure.log') -Raw
    Assert ($failure.Contains('expected diagnostic')) 'Patcher stderr was not preserved'
    Assert ($failure.Contains('RESTORED=1')) 'Failure did not invoke Restore-Install'
    Assert (((Get-Content (Join-Path $ClawDir 'cli.original.cjs') -Raw).Trim()) -eq '// previous working source') 'Failure did not restore the previous source'
    Write-Host '[source-recovery.test] installation failure rollback passed'
} finally {
    Remove-Item -Recurse -Force $ClawDir
}
