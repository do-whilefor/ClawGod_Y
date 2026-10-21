import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The Windows half of this lives in src/windows/launchers.test.ps1.
if (process.platform === 'win32') {
  console.log('[native-refresh.test] skipped on Windows');
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'clawgod-native-refresh-'));
try {
  // Run the real installer launcher section: this fork installs only the
  // `clawgod` launcher and never replaces, renames or backs up `claude`.
  const template = readFileSync(new URL('../templates/install.sh', import.meta.url), 'utf8');
  const start = template.indexOf('# ─── Install the clawgod launcher');
  const end = template.indexOf('# ─── Check PATH', start);
  assert.ok(start > 0 && end > start, 'launcher section not found');
  const section = template.slice(start, end);
  assert.ok(section.includes('write_launcher "$BIN_DIR/clawgod"'), 'section must write only the clawgod launcher');
  assert.ok(!section.includes('write_launcher "$CLAUDE_BIN"'), 'section must not overwrite claude');

  const clawgod = join(root, '.clawgod');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, 'claude');
  const env = { ...process.env, HOME: root, CLAWGOD_DIR: clawgod, BIN_DIR: bin, BUN_BIN: '/bin/true' };
  // The section downloads the clawgod-import helper; keep the test offline.
  const script = 'set -e\ninfo() { echo "$*"; }; warn() { echo "$*"; }; dim() { :; };\ncurl() { return 1; }\n' + section;
  const install = (extra = {}) => {
    const result = spawnSync('bash', ['-c', script], { env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };

  // Fresh install with claude on PATH: the launcher resolves execPath at
  // launch time, and the binary stays byte-identical with no backups.
  writeFileSync(claude, 'native binary', { mode: 0o755 });
  const out = install({ PATH: `${bin}:${process.env.PATH}` });
  assert.match(out, /'clawgod'.*patched.*'claude' untouched/);
  assert.equal(readFileSync(claude, 'utf8'), 'native binary');
  assert.equal(existsSync(claude + '.orig'), false, 'claude.orig must not be created');
  const launcher = readFileSync(join(bin, 'clawgod'), 'utf8');
  assert.ok(launcher.includes('CLAUDE_CODE_EXECPATH="$CLAUDE_BIN"'), 'launcher must resolve execPath at launch time');
  assert.ok(launcher.includes('command -v claude'), 'launcher must resolve claude from PATH');
  assert.equal(existsSync(join(clawgod, 'claude.staged')), false, 'staged binary must be discarded when claude exists');

  // Native installs where `claude` is a symlink into versions/ are followed
  // for execPath but never written through.
  rmSync(claude);
  const versions = join(root, '.local/share/claude/versions');
  mkdirSync(versions, { recursive: true });
  const native = join(versions, '2.1.285');
  writeFileSync(native, 'native 2.1.285', { mode: 0o755 });
  symlinkSync(native, claude);
  writeFileSync(join(clawgod, 'claude.staged'), 'staged binary');
  install({ PATH: `${bin}:${process.env.PATH}` });
  assert.ok(lstatSync(claude).isSymbolicLink(), 'claude symlink was replaced');
  assert.equal(readFileSync(native, 'utf8'), 'native 2.1.285');
  assert.equal(existsSync(join(clawgod, 'claude.staged')), false, 'staged binary must be discarded when claude exists');

  // Without any claude on PATH, the staged binary becomes the execPath
  // fallback so re-spawned sessions still report the patched version.
  rmSync(claude);
  writeFileSync(join(clawgod, 'claude.staged'), 'fallback binary');
  const fallbackOut = install({ PATH: '/usr/bin:/bin' });
  assert.match(fallbackOut, /No existing claude found/);
  assert.equal(readFileSync(join(clawgod, 'claude.fallback'), 'utf8'), 'fallback binary');
  assert.equal(existsSync(join(clawgod, 'claude.staged')), false);

  // Artifacts left by installer versions that did replace claude are swept:
  // the claude.orig backup.
  writeFileSync(claude, 'restored', { mode: 0o755 });
  writeFileSync(join(bin, 'claude.orig'), 'old backup');
  install({ PATH: `${bin}:${process.env.PATH}` });
  assert.equal(existsSync(join(bin, 'claude.orig')), false, 'stale claude.orig was not swept');
  assert.equal(readFileSync(claude, 'utf8'), 'restored');

  console.log('[native-refresh.test] clawgod-only launcher, launch-time execPath, fallback staging, and legacy sweep passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
