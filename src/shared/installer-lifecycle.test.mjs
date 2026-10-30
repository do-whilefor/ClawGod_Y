import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const root = mkdtempSync(join(tmpdir(), 'clawgod lifecycle-'));
const home = join(root, 'profile');
const dir = join(home, '.clawgod');
const bin = join(home, '.local', 'bin');
const commands = join(root, 'commands');
const installer = join(root, windows ? 'install.ps1' : 'install.sh');
const native = windows ? 'claude.fallback.exe' : 'claude.fallback';
const launcher = join(bin, windows ? 'clawgod.cmd' : 'clawgod');
const cache = join(dir, windows ? 'install.ps1' : 'install.sh');
const savedUserPath = windows ? spawnSync('powershell.exe', ['-NoProfile', '-Command', '[Environment]::GetEnvironmentVariable("Path", "User")'], { encoding: 'utf8' }).stdout.trimEnd() : '';
const env = { ...process.env, HOME: home, USERPROFILE: home, CLAWGOD_FIXTURE_INSTALLER: installer,
  PATH: commands + (windows ? ';' : ':') + process.env.PATH };
for (const key of Object.keys(env)) if (/^(?:https?_proxy|all_proxy)$/i.test(key)) delete env[key];
const source = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const payloads = {
  'cli.cjs': source('./cli.cjs'),
  'runtime-helpers.cjs': source('./runtime-helpers.cjs'),
  'lean-mode.cjs': source('./lean-mode.cjs'),
  'lean-apply.cjs': source('../windows/lean-apply.cjs'),
  'startup-check.cjs': source('./startup-check.cjs'),
  'features.json': '{}',
  'system-prompt.md': 'Lifecycle fixture prompt.\n',
  'extract-natives.mjs': `import {mkdirSync,writeFileSync} from 'node:fs';import{join}from'node:path';
    const dir=process.argv[3];mkdirSync(join(dir,'bunfs'),{recursive:true});
    writeFileSync(join(dir,'cli.original.js'),'fixture');writeFileSync(join(dir,'bunfs','asset.txt'),'asset');
    writeFileSync(join(dir,'pathmap.json'),'{}');`,
  'post-process.mjs': `import{writeFileSync}from'node:fs';
    writeFileSync(new URL('./cli.original.cjs',import.meta.url),${JSON.stringify(`// clawgod:probe-modules ["cli.original.cjs"]
if(process.argv[2]==='--probe-tools')globalThis.__clawgodTables={tools:[()=>[{name:'fixture'}]],commands:[()=>[{name:'fixture'}]]};
else console.log(require('fs').readFileSync(require('path').join(__dirname,'.source-version'),'utf8').trim()+' (Claude Code)');`)});`,
  'patch.mjs': `import{writeFileSync}from'node:fs';if(process.argv.includes('--capture-clean-source'))writeFileSync(new URL('./source-backup.json',import.meta.url),'{}');`,
  'compile-runtime.mjs': `import{rmSync}from'node:fs';rmSync(new URL('./.compiled-runtime',import.meta.url),{force:true});`,
  'npm-fetch.mjs': `import{mkdirSync,copyFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
    const tag=process.argv[2].split('@').at(-1),version=tag==='latest'?'2.1.315':tag==='stable'?'2.1.308':tag;
    const dir=join(process.argv[3],'package');mkdirSync(dir,{recursive:true});copyFileSync(process.execPath,join(dir,'claude.exe'));
    writeFileSync(join(dir,'package.json'),JSON.stringify({version}));console.log('VERSION='+version);`,
};
let template = source(windows ? '../templates/install.ps1' : '../templates/install.sh');
template = template.replace(/{{CLAWGOD:([^}]+)}}/g, (_, name) => payloads[name] ?? '');
const shellFile = (name, code) => writeFileSync(join(commands, name), '#!/bin/bash\nset -e\n' + code, { mode: 0o755 });
const run = (args = [], extra = {}, piped = false) => {
  if (!windows) return spawnSync('bash', piped ? ['-s', '--', ...args] : [installer, ...args], {
    env: { ...env, ...extra }, input: piped ? template : undefined, encoding: 'utf8', timeout: 60000,
  });
  const command = `function Invoke-WebRequest { throw 'Optional import download is offline' }
function Invoke-RestMethod { if($env:CLAWGOD_FAIL_CACHE -eq '1'){throw 'Uninstaller download failed'};[IO.File]::ReadAllText($env:CLAWGOD_FIXTURE_INSTALLER) }
${extra.CLAWGOD_FAIL_LAUNCHER ? '$lock=[IO.File]::Open((Join-Path $env:USERPROFILE ".local\\bin\\clawgod.cmd"),"Open","Read","Read")' : ''}
& ([scriptblock]::Create([IO.File]::ReadAllText($env:CLAWGOD_FIXTURE_INSTALLER))) ${args.map(arg => `'${arg.replaceAll("'", "''")}'`).join(' ')}
`;
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000,
  });
};
const succeeds = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const retained = ['provider.json', 'features.json', 'patches.json', 'assembly.json', 'flags.json'];
try {
  mkdirSync(bin, { recursive: true });
  mkdirSync(commands);
  writeFileSync(installer, template);
  const official = join(commands, windows ? 'claude.exe' : 'claude');
  writeFileSync(official, 'official Claude must remain unchanged', { mode: 0o755 });
  if (windows) writeFileSync(join(commands, 'rg.cmd'), '@echo off\r\necho ripgrep fixture\r\n');
  if (!windows) {
    shellFile('npm', `tag="\${2##*@}"; case "$tag" in latest) version=2.1.315;; stable) version=2.1.308;; *) version="$tag";; esac
printf '%s' "$version" > fixture.tgz\n`);
    shellFile('tar', `version=$(cat "$2");mkdir -p package
printf '#!/bin/bash\\necho "%s (Claude Code)"\\n' "$version" > package/claude
printf '{"version":"%s"}' "$version" > package/package.json\n`);
    shellFile('stat', 'echo 11000001\n');
    shellFile('rg', 'echo "ripgrep fixture"\n');
    shellFile('curl', `while [ "$#" -gt 0 ]; do if [ "$1" = -o ];then target="$2";shift 2;else shift;fi;done
case "$target" in */clawgod-import) exit 22;; esac
[ "\${CLAWGOD_FAIL_CACHE:-0}" != 1 ] || exit 22
cp "$CLAWGOD_FIXTURE_INSTALLER" "$target"\n`);
    shellFile('mv', `for target in "$@"; do :; done
case "$target" in */.local/bin/clawgod) [ "\${CLAWGOD_FAIL_LAUNCHER:-0}" != 1 ] || exit 73;; esac
exec /bin/mv "$@"\n`);
  }
  for (const [args, version] of [[[], '2.1.314'], [['latest'], '2.1.315'], [['stable'], '2.1.308'], [['2.1.309'], '2.1.309']]) {
    const result = run(args);
    succeeds(result);
    assert.equal(readFileSync(join(dir, '.source-version'), 'utf8').trim(), version);
    assert.match(result.stdout, new RegExp('Claude Code version: ' + version.replaceAll('.', '\\.')));
    assert.ok(existsSync(cache), 'Successful install must save a local uninstaller');
    assert.ok(existsSync(join(dir, native)), 'Selected native binary must be retained even with an official claude on PATH');
    assert.ok(readFileSync(launcher, 'utf8').includes(windows ? 'CLAUDE_CODE_EXECPATH=%USERPROFILE%\\.clawgod\\claude.fallback.exe' : `CLAUDE_CODE_EXECPATH="${join(dir, native)}"`));
    assert.equal(readFileSync(official, 'utf8'), 'official Claude must remain unchanged');
    if (!windows) {
      const child = spawnSync(join(dir, native), ['--version'], { encoding: 'utf8' });
      succeeds(child);
      assert.equal(child.stdout.trim(), version + ' (Claude Code)');
    }
  }
  for (const extra of [{ CLAWGOD_FAIL_CACHE: '1' }, { CLAWGOD_FAIL_LAUNCHER: '1' }]) {
    writeFileSync(join(dir, '.compiled-runtime'), 'cli.compiled-old\n');
    writeFileSync(join(dir, 'cli.compiled-old'), 'old compiled runtime');
    const old = Object.fromEntries(['cli.original.cjs', '.source-version', native, 'install.' + (windows ? 'ps1' : 'sh'), '.compiled-runtime']
      .map(name => [name, readFileSync(join(dir, name))]));
    const oldLauncher = readFileSync(launcher);
    const result = run(['latest'], extra, true);
    assert.notEqual(result.status, 0, 'A failed finalization must fail installation');
    assert.doesNotMatch(result.stdout, /ClawGod installed!/);
    for (const [name, content] of Object.entries(old)) assert.deepEqual(readFileSync(join(dir, name)), content, `Rollback failed for ${name}`);
    assert.deepEqual(readFileSync(launcher), oldLauncher, 'Failed publication must preserve the previous launcher');
    assert.equal(readFileSync(join(dir, 'cli.compiled-old'), 'utf8'), 'old compiled runtime');
    assert.equal(existsSync(join(dir, windows ? 'claude.staged.exe' : 'claude.staged')), false);
    rmSync(join(dir, '.compiled-runtime'));
  }
  for (const name of retained) writeFileSync(join(dir, name), JSON.stringify({ fixture: name }));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const settings = join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{"keep":"shared settings"}');
  const uninstall = spawnSync(windows ? 'powershell.exe' : 'bash', windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cache, '-Uninstall'] : [cache, '--uninstall'], {
    env, encoding: 'utf8', timeout: 30000,
  });
  succeeds(uninstall);
  assert.equal(existsSync(launcher), false);
  assert.deepEqual(readdirSync(dir).sort(), [...retained, windows ? 'install.ps1' : 'install.sh'].sort(), 'Only configuration and the cached uninstaller should remain');
  assert.equal(readFileSync(settings, 'utf8'), '{"keep":"shared settings"}');
  assert.equal(readFileSync(official, 'utf8'), 'official Claude must remain unchanged');
  for (const name of retained) assert.equal(JSON.parse(readFileSync(join(dir, name), 'utf8')).fixture, name);
  console.log('[installer-lifecycle.test] version selection, native isolation, finalization rollback, offline cache failure, and uninstall passed');
} finally {
  if (windows) spawnSync('powershell.exe', ['-NoProfile', '-Command', '[Environment]::SetEnvironmentVariable("Path", $env:CLAWGOD_SAVED_USER_PATH, "User")'], {
    env: { ...process.env, CLAWGOD_SAVED_USER_PATH: savedUserPath },
  });
  rmSync(root, { recursive: true, force: true });
}
