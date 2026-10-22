import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const wrapper = read('./cli.cjs');
const unix = read('../templates/install.sh');
// install.sh applies the single strictest level through the installed
// lean-mode.cjs; uninstall must NOT touch the shared settings.json.
const unixApply = unix.match(/node -e '\n(const \{leanApply\}[^']*)\n' "\$HOME\/\.claude\/settings\.json" "\$CLAWGOD_DIR\/lean-mode\.cjs"/)?.[1];
assert.ok(unixApply, 'install.sh must apply Lean via lean-mode.cjs');
const uninstallBlock = unix.slice(unix.indexOf('if [ "$UNINSTALL" = "1" ]'), unix.indexOf('# ─── Prerequisites'));
assert.ok(!uninstallBlock.includes('settings.json'), 'uninstall must not touch ~/.claude/settings.json');
const winApply = read('../windows/lean-apply.cjs');
assert.ok(winApply.includes('leanApply(process.argv[1])'), 'lean-apply must delegate to lean-mode.cjs');
const home = fs.mkdtempSync(join(tmpdir(), 'clawgod-lean-test-'));
const dir = join(home, '.clawgod');
const settings = join(home, '.claude', 'settings.json');
const trafficKey = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
const originalSettings = { theme: 'dark', permissions: { allow: ['Read'], deny: ['Bash(custom)'] } };
const loadSettings = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
const saveSettings = s => fs.writeFileSync(settings, JSON.stringify(s));

function reset() {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  saveSettings(originalSettings);
}

// Execute the entire launcher with only HOME and its final bundle replaced.
// No credentials, user settings, network, or Claude installation are needed.
function launch(args = [], env = {}) {
  const exit = Symbol('exit');
  let loaded = false;
  const proc = { argv: ['node', 'cli.cjs', ...args], env: { ...env }, execPath: '/test/bun',
    stderr: { write() {} }, exit(code) { assert.equal(code, 0); throw exit; } };
  try {
    runInNewContext(wrapper, {
      process: proc,
      require(name) {
        if (name === 'os') return { homedir: () => home };
        if (name === './cli.original.cjs') { loaded = true; return {}; }
        if (['./feature-gates.cjs', './runtime-helpers.cjs', './bun-ant-shim.cjs'].includes(name)) return {};
        return require(name);
      },
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  assert.equal(loaded, args.length === 0);
  return proc.env;
}

const { leanApply, DENY, FLAGS } = require('./lean-mode.cjs');

function checkStrict(s) {
  for (const k of FLAGS) assert.equal(s[k], true, k);
  for (const t of DENY) assert.ok(s.permissions.deny.includes(t), t);
}

try {
  fs.mkdirSync(join(home, '.claude'));

  // Single strictest level: apply fills in everything managed, keeps the rest.
  reset();
  leanApply(settings);
  let s = loadSettings();
  checkStrict(s);
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.permissions.allow, ['Read']);
  assert.ok(s.permissions.deny.includes('Bash(custom)'));
  const once = fs.readFileSync(settings, 'utf8');
  leanApply(settings);
  assert.equal(fs.readFileSync(settings, 'utf8'), once, 'idempotent');

  // Existing user values are never overwritten, only missing ones added.
  reset();
  saveSettings({ ...originalSettings, disableWorkflows: false,
    permissions: { allow: ['Read'], deny: ['Bash(custom)', 'CronCreate'] } });
  leanApply(settings);
  s = loadSettings();
  assert.equal(s.disableWorkflows, false, 'user value preserved');
  assert.equal(s.disableRemoteControl, true, 'missing managed flag added');
  console.log('[lean.test] single strictest level: fill-only, idempotent ok');

  // node -e entry point (install.ps1 wrapper) reaches the same behavior.
  reset();
  runInNewContext(winApply, { require, process: { argv: ['node', settings] } });
  checkStrict(loadSettings());
  console.log('[lean.test] lean-apply wrapper ok');

  for (const baseURL of ['https://api.anthropic.com', 'https://example.invalid']) {
    reset();
    fs.writeFileSync(join(dir, 'provider.json'), JSON.stringify({ baseURL }));
    // Legacy toggle flags are accepted but no-op-ish: they re-apply strict.
    for (const flag of ['--lean-on', '--lean-max', '--lean-off']) {
      launch([flag]);
      checkStrict(loadSettings());
      assert.ok(!fs.existsSync(join(dir, '.lean-max')));
      assert.ok(!fs.existsSync(join(dir, '.lean-disabled')));
    }
    // Lean is unconditional: traffic restriction is always on by default.
    assert.equal(launch()[trafficKey], '1');
    checkStrict(loadSettings()); // A proxy launch must not undo settings.
    for (const explicit of ['1', '0', '']) {
      assert.equal(launch([], { [trafficKey]: explicit })[trafficKey], explicit);
    }
    assert.equal(launch([], { DISABLE_TELEMETRY: '1' }).DISABLE_TELEMETRY, '1');
  }
  console.log('[lean.test] launcher flags, provider parity, and explicit environment settings ok');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
