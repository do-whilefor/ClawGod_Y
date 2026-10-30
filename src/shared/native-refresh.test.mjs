import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform === 'win32') {
  console.log('[native-refresh.test] skipped on Windows');
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'clawgod-native-refresh-'));
try {
  const template = readFileSync(new URL('../templates/install.sh', import.meta.url), 'utf8');
  const start = template.indexOf('IMPORT_BIN="$CLAWGOD_DIR/clawgod-import"');
  assert.ok(start > 0, 'launcher section not found');
  const section = template.slice(start);
  assert.ok(section.includes('write_launcher "$BIN_DIR/clawgod"'), 'section must write only the clawgod launcher');
  assert.ok(!section.includes('write_launcher "$CLAUDE_BIN"'), 'section must not overwrite claude');

  const clawgod = join(root, '.clawgod');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(clawgod, { recursive: true });
  const claude = join(bin, 'claude');
  const bun = join(root, 'bun');
  writeFileSync(bun, '#!/bin/bash\nexec "$CLAUDE_CODE_EXECPATH" "$@"\n', { mode: 0o755 });
  const installer = join(root, 'install.sh');
  writeFileSync(installer, '#!/bin/bash\nexit 0\n');
  writeFileSync(join(clawgod, 'cli.cjs'), '// fixture');
  const env = { ...process.env, HOME: root, CLAWGOD_DIR: clawgod, BIN_DIR: bin, BUN_BIN: bun, NATIVE_BIN_LABEL: '2.1.308' };
  const script = 'set -e\ninfo() { echo "$*"; }; warn() { echo "$*"; }; dim() { :; }; rollback_install() { :; };\ncurl() { return 1; }\n' + section;
  const install = (extra = {}) => {
    if (!existsSync(join(clawgod, 'claude.staged')) && !existsSync(join(clawgod, 'claude.fallback'))) {
      writeFileSync(join(clawgod, 'claude.staged'), '#!/bin/bash\necho "2.1.308 (Claude Code)"\n');
    }
    const result = spawnSync('bash', ['-c', script, installer], { env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };

  writeFileSync(claude, 'native binary', { mode: 0o755 });
  const out = install({ PATH: `${bin}:${process.env.PATH}` });
  assert.match(out, /'clawgod'.*patched.*'claude' untouched/);
  assert.equal(readFileSync(claude, 'utf8'), 'native binary');
  assert.equal(existsSync(claude + '.orig'), false, 'claude.orig must not be created');
  const launcher = readFileSync(join(bin, 'clawgod'), 'utf8');
  assert.ok(launcher.includes(`CLAUDE_CODE_EXECPATH="${join(clawgod, 'claude.fallback')}"`), 'launcher must use the selected private native binary');
  const child = spawnSync(join(bin, 'clawgod'), ['--version'], { env: { ...env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), '2.1.308 (Claude Code)', 'Child process must use the selected version');

  rmSync(claude);
  const versions = join(root, '.local/share/claude/versions');
  mkdirSync(versions, { recursive: true });
  const native = join(versions, '2.1.285');
  writeFileSync(native, 'native 2.1.285', { mode: 0o755 });
  symlinkSync(native, claude);
  mkdirSync(clawgod, { recursive: true });
  writeFileSync(join(clawgod, 'claude.staged'), 'staged binary');
  install({ PATH: `${bin}:${process.env.PATH}` });
  assert.ok(lstatSync(claude).isSymbolicLink(), 'claude symlink was replaced');
  assert.equal(readFileSync(native, 'utf8'), 'native 2.1.285');
  assert.equal(existsSync(join(clawgod, 'claude.staged')), false);
  assert.equal(readFileSync(join(clawgod, 'claude.fallback'), 'utf8'), 'staged binary');

  rmSync(claude);
  writeFileSync(join(clawgod, 'claude.staged'), 'fallback binary');
  install({ PATH: '/usr/bin:/bin' });
  assert.equal(readFileSync(join(clawgod, 'claude.fallback'), 'utf8'), 'fallback binary');
  assert.equal(existsSync(join(clawgod, 'claude.staged')), false);

  writeFileSync(claude, 'restored', { mode: 0o755 });
  writeFileSync(join(bin, 'claude.orig'), 'old backup');
  install({ PATH: `${bin}:${process.env.PATH}` });
  assert.equal(existsSync(join(bin, 'claude.orig')), false, 'stale claude.orig was not swept');
  assert.equal(readFileSync(claude, 'utf8'), 'restored');

  console.log('[native-refresh.test] selected native child version, official binary isolation, refresh, and legacy sweep passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
