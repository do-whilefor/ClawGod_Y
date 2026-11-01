const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const resolveVersions = require('./resolve-claude-versions.cjs');
const { prepareInstallers, verifyAssets, imports } = require('./release-assets.cjs');
const repository = resolve(__dirname, '../..');

const installer = 'VERSION="2.1.316"\n';
for (const [stable, latest, expected] of [
  ['2.1.316', '2.1.316', [['2.1.316', '2.1.316, stable, latest']]],
  ['2.1.309', '2.1.316', [['2.1.316', '2.1.316, latest'], ['2.1.309', 'stable']]],
  ['2.1.317', '2.1.317', [['2.1.316', '2.1.316'], ['2.1.317', 'stable, latest']]],
  ['2.1.309', '2.1.317', [['2.1.316', '2.1.316'], ['2.1.309', 'stable'], ['2.1.317', 'latest']]],
]) {
  const calls = [];
  const result = resolveVersions(installer, channel => { calls.push(channel); return (channel === 'stable' ? stable : latest) + '\n'; });
  assert.equal(result.defaultVersion, '2.1.316');
  assert.deepEqual(result.versions.map(row => [row.version, row.channels]), expected);
  assert.deepEqual(calls, ['stable', 'latest']);
}
assert.equal(resolveVersions(installer.replace('\n', '\r\n'), () => '2.1.316').versions.length, 1);
assert.throws(() => resolveVersions('', () => '2.1.316'), /Default Claude version/);
for (const bad of ['', 'latest', '2.1.316\n2.1.317', '2.1.316; exit 0']) {
  assert.throws(() => resolveVersions(installer, () => bad), /Invalid stable version/);
  assert.throws(() => resolveVersions(installer, channel => channel === 'stable' ? '2.1.309' : bad), /Invalid latest version/);
}
assert.throws(() => resolveVersions(installer, () => { throw new Error('registry offline'); }), /registry offline/);

const root = mkdtempSync(join(tmpdir(), 'clawgod-ci-gates-'));
try {
  const logPath = join(root, 'install.log');
  const report = (special = [], extra = '', countDelta = 0) => {
    const rows = [...special, ...Array.from({ length: 72 - special.length }, (_, i) => `✅ Applied rule ${i} (1 replacement in 1 file)`)];
    const skipped = special.filter(row => !row.startsWith('✅') && !row.startsWith('❌')).length;
    const failed = special.filter(row => row.startsWith('❌')).length;
    return `Mode: APPLY\n${rows.join('\n')}\n${extra}\nResult: ${72 - skipped - failed + countDelta} applied, ${skipped} skipped, ${failed} failed\n`;
  };
  const check = (log, ok, platform = 'linux', encoding = 'utf8') => {
    writeFileSync(logPath, encoding === 'utf16le' ? '\ufeff' + log : log, encoding);
    const child = spawnSync(process.execPath, [join(repository, 'src/ci/check-patch-coverage.cjs'), logPath, platform], { encoding: 'utf8', timeout: 10000 });
    assert.ok(Number.isInteger(child.status), child.error?.message || 'Coverage checker did not exit normally');
    assert.equal(child.status === 0, ok, child.stdout + child.stderr);
  };
  for (const platform of ['linux', 'macos', 'windows']) for (const encoding of ['utf8', 'utf16le']) {
    check(report().replaceAll('\n', '\r\n').replaceAll('✅', '\x1b[32m✅\x1b[0m'), true, platform, encoding);
  }
  check(report(['⏭  Computer Use gate (resolved configuration contract) (not present in this version)']), true);
  check(report(['⚠️  Computer Use default enabled (0 matches, no sentinel — cannot verify)']), true);
  check(report(['⚠️  Computer Use default enabled (0 matches, no sentinel — cannot verify)']), false, 'macos');
  check(report(['⚠️  Restore Glob/Grep tools (un-inline EMBEDDED_SEARCH_TOOLS) — regex stale, sentinel still in source: anchor']), true, 'windows');
  for (const row of [
    '⏭  New missing rule (not present in this version)',
    '⚠️  Computer Use gate (resolved configuration contract) — AST matcher stale, sentinel still in source: anchor',
    '❌ Required prompt injection hook did not match',
  ]) check(report([row]), false);
  check(report([], '⚠️  ultraplan: 1 site(s) NOT patched — coverage is partial'), true);
  check(report([], '⚠️  ultraplan: 2 site(s) NOT patched — coverage is partial'), false);
  check(report([], '⚠️  another-rule: 1 site(s) NOT patched — coverage is partial'), false);
  check(report([], 'Runtime fallback installed; activation is checked at call time'), false);
  check(report([], '', 1), false);
  check(report().replace('72 applied, 0 skipped', '71 applied, 1 skipped'), false);
  for (const bad of ['', 'Mode: VERIFY\nResult: 72 applied, 0 skipped, 0 failed',
    'Mode: APPLY\nResult: 0 applied, 0 skipped, 0 failed', report() + 'Mode: APPLY\ntruncated']) check(bad, false);

  const release = join(root, 'release');
  mkdirSync(join(release, 'dist'), { recursive: true });
  const originals = Object.fromEntries(['install.sh', 'install.ps1'].map(name => [name, readFileSync(join(repository, name), 'utf8')]));
  const reset = () => { for (const [name, text] of Object.entries(originals)) writeFileSync(join(release, name), text); };
  reset();
  for (const name of imports) writeFileSync(join(release, 'dist', name), 'fixture binary');
  for (const tag of ['v1.2.3', 'v1.2.3-beta.1']) {
    reset();
    prepareInstallers(release, tag);
    verifyAssets(release);
    const once = readFileSync(join(release, 'install.sh'), 'utf8');
    prepareInstallers(release, tag);
    assert.equal(readFileSync(join(release, 'install.sh'), 'utf8'), once, 'Preparing a tag twice is idempotent');
    for (const [name, original] of Object.entries(originals)) {
      const actual = readFileSync(join(release, name), 'utf8');
      const pattern = name.endsWith('.sh') ? /^CLAWGOD_SELF_VERSION=".*"$/m : /^\$ClawSelfVersion = ".*"$/m;
      assert.ok(actual.match(pattern)[0].includes(tag.slice(1)));
      assert.equal(actual.replace(pattern, ''), original.replace(pattern, ''), 'Only the self-version may change');
    }
  }
  for (const tag of ['vfoo', 'v1.2.3;echo bad', 'v1.2.3\nextra', 'v1.2.3\n']) assert.throws(() => prepareInstallers(release, tag), /Invalid release tag/);
  for (const invalid of [originals['install.ps1'].replace('$ClawSelfVersion =', '$MissingVersion ='),
    '\ufeff' + originals['install.ps1'], originals['install.ps1'] + '\n{{CLAWGOD:missing}}',
    originals['install.ps1'] + '\n$ClawSelfVersion = "duplicate"\n']) {
    reset();
    writeFileSync(join(release, 'install.ps1'), invalid);
    assert.throws(() => prepareInstallers(release, 'v1.2.3'));
    assert.equal(readFileSync(join(release, 'install.sh'), 'utf8'), originals['install.sh'], 'Failed preparation must not partly update installers');
  }
  reset();
  for (const name of imports) {
    const path = join(release, 'dist', name);
    rmSync(path);
    assert.throws(() => verifyAssets(release), /missing/);
    writeFileSync(path, '');
    assert.throws(() => verifyAssets(release), /empty/);
    writeFileSync(path, 'fixture binary');
  }
  writeFileSync(join(release, 'dist', 'clawgod-import-unknown'), 'unexpected');
  assert.throws(() => verifyAssets(release), /unexpected/);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('[ci-gates.test] version resolution, coverage failures and final release assets passed');
