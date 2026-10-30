'use strict';
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const [bun, cli, probeMode] = process.argv.slice(2);
const timeoutMs = Number(process.env.CLAWGOD_STARTUP_TIMEOUT_MS || 30000);
if (!bun || !cli || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
  process.stderr.write('Usage: node startup-check.cjs <bun> <cli.cjs> [--probe-tools]; CLAWGOD_STARTUP_TIMEOUT_MS must be a positive integer <= 2147483647.\n');
  process.exitCode = 1;
} else {
  const probeTools = probeMode === '--probe-tools';
  const logPath = join(dirname(cli), probeTools ? 'probe-tools.log' : 'startup-check.log');
  const limit = 1024 * 1024;
  let output = Buffer.alloc(0), truncated = false, finished = false;
  const versionPattern = /^\d+\.\d+\.\d+[^\r\n]*\(Claude Code\)\s*$/;
  let stdoutLine = '', sawVersion = false;
  const args = probeTools ? ['--probe-tools'] : ['--version'];
  let compiled;
  try {
    const path = join(dirname(cli), readFileSync(join(dirname(cli), '.compiled-runtime'), 'utf8').trim());
    if (existsSync(path)) compiled = path;
  } catch {}
  const child = spawn(compiled || bun, compiled ? args : [cli, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32',
  });
  const capture = chunk => {
    output = Buffer.concat([output, chunk]);
    if (output.length > limit) { output = output.subarray(output.length - limit); truncated = true; }
  };
  child.stdout.on('data', chunk => {
    capture(chunk);
    const lines = (stdoutLine + chunk.toString('utf8')).split('\n');
    stdoutLine = lines.pop().slice(-4096);
    if (lines.some(line => versionPattern.test(line))) sawVersion = true;
  });
  child.stderr.on('data', capture);

  function finish(code, message) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const text = (truncated ? '[Earlier startup output truncated]\n' : '') + output.toString('utf8');
    const diagnostic = message ? '\n[clawgod] ' + message + '\n' : '';
    let logWritten = false;
    try { writeFileSync(logPath, text + diagnostic); logWritten = true; }
    catch (error) {
      process.stderr.write('[clawgod] Cannot write startup log: ' + error.message + '\n');
      code = code || 1;
    }
    if (text) process.stdout.write(text);
    if (diagnostic) process.stderr.write(diagnostic);
    if (code && logWritten) process.stderr.write('[clawgod] Startup log: ' + logPath + '\n');
    process.exitCode = code;
  }

  const timer = setTimeout(() => {
    if (child.pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore', windowsHide: true, timeout: 2000,
        });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
      try { child.kill('SIGKILL'); } catch {}
    }
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    finish(124, 'Startup verification timed out after ' + timeoutMs + ' ms. The Bun probe did not finish; launcher installation was aborted. If this machine needs more time, increase CLAWGOD_STARTUP_TIMEOUT_MS and retry.');
  }, timeoutMs);

  child.on('error', error => finish(1, 'Could not start ' + (compiled ? 'compiled runtime' : 'Bun') + ': ' + error.message));
  child.on('close', (code, signal) => {
    if (code !== 0) finish(code || 1, 'Patched Claude startup failed' + (signal ? ' (' + signal + ')' : ' (exit ' + code + ')') + '.');
    else if (probeTools) {
      const receipt = /^\[clawgod\] probe-tools ok: [1-9]\d* tools, [1-9]\d* commands\r?$/m;
      if (!receipt.test(output.toString('utf8'))) finish(1, 'Tool/command verification did not produce a success receipt.');
      else finish(0);
    }
    else if (!sawVersion && !versionPattern.test(stdoutLine))
      finish(1, 'Bun exited successfully but did not print a Claude Code version.');
    else finish(0);
  });
}
