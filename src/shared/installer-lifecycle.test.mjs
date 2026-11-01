import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const root = mkdtempSync(join(tmpdir(), 'clawgod lifecycle-'));
const home = join(root, 'profile space \u6d4b\u8bd5');
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
    if(process.env.CLAWGOD_FAIL_STAGE==='extract')throw new Error('fixture extraction failure');
    writeFileSync(join(dir,'cli.original.js'),'fixture');writeFileSync(join(dir,'bunfs','asset.txt'),'asset');
    writeFileSync(join(dir,'pathmap.json'),'{}');`,
  'post-process.mjs': `import{writeFileSync}from'node:fs';
    if(process.env.CLAWGOD_FAIL_STAGE==='post-process')throw new Error('fixture post-process failure');
    writeFileSync(new URL('./cli.original.cjs',import.meta.url),${JSON.stringify(`// clawgod:probe-modules ["cli.original.cjs"]
if(process.env.CLAWGOD_FAIL_STAGE==='startup')throw new Error('fixture startup failure');
if(process.argv[2]==='--probe-tools')globalThis.__clawgodTables={tools:[()=>[{name:'fixture'}]],commands:[()=>[{name:'fixture'}]]};
else console.log(require('fs').readFileSync(require('path').join(__dirname,'.source-version'),'utf8').trim()+' (Claude Code)');`)});`,
  'patch.mjs': `import{writeFileSync}from'node:fs';if(process.env.CLAWGOD_FAIL_STAGE==='patch'&&!process.argv.includes('--capture-clean-source'))throw new Error('fixture patch failure');if(process.argv.includes('--capture-clean-source'))writeFileSync(new URL('./source-backup.json',import.meta.url),'{}');`,
  'compile-runtime.mjs': `import{rmSync}from'node:fs';rmSync(new URL('./.compiled-runtime',import.meta.url),{force:true});`,
  'npm-fetch.mjs': `import{mkdirSync,copyFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
    writeFileSync(join(process.env.USERPROFILE,'requested-package.txt'),process.argv[2]);
    if(['download','corrupt'].includes(process.env.CLAWGOD_FAIL_STAGE))throw new Error('fixture download or corrupt archive');
    const tag=process.argv[2].split('@').at(-1),version=tag==='latest'?'2.1.315':tag==='stable'?'2.1.308':tag;
    const dir=join(process.argv[3],'package');mkdirSync(dir,{recursive:true});if(process.env.CLAWGOD_FAIL_STAGE!=='missing-binary')copyFileSync(process.execPath,join(dir,'claude.exe'));
    writeFileSync(join(dir,'package.json'),JSON.stringify({version}));console.log('VERSION='+version);`,
};
let template = source(windows ? '../templates/install.ps1' : '../templates/install.sh');
if (process.argv[2]) {
  const built = readFileSync(resolve(process.argv[2]), 'utf8');
  const selfVersion = windows ? /^\$ClawSelfVersion = ".*"$/m : /^CLAWGOD_SELF_VERSION=".*"$/m;
  template = template.replace(selfVersion, built.match(selfVersion)[0]);
  const names = [...template.matchAll(/{{CLAWGOD:([^}]+)}}/g)].map(match => match[1]);
  const literals = template.split(/{{CLAWGOD:[^}]+}}/g);
  let at = 0, fixture = '';
  for (const [i, literal] of literals.entries()) {
    assert.ok(built.startsWith(literal, at), 'Final installer must preserve the template structure');
    fixture += literal;
    at += literal.length;
    if (i < names.length) {
      at = built.indexOf(literals[i + 1], at);
      assert.ok(at >= 0, `Final installer payload boundary missing: ${names[i]}`);
      fixture += payloads[names[i]] ?? '';
    }
  }
  assert.equal(at, built.length);
  template = fixture;
} else template = template.replace(/{{CLAWGOD:([^}]+)}}/g, (_, name) => payloads[name] ?? '');
const shellFile = (name, code) => writeFileSync(join(commands, name), '#!/bin/bash\nset -e\n' + code, { mode: 0o755 });
const run = (args = [], extra = {}, piped = false) => {
  if (!windows) return spawnSync('bash', piped ? ['-s', '--', ...args] : [installer, ...args], {
    env: { ...env, ...extra }, input: piped ? template : undefined, encoding: 'utf8', timeout: 60000,
  });
  const command = `function Invoke-WebRequest { throw 'Optional import download is offline' }
function Invoke-RestMethod { if($env:CLAWGOD_FAIL_CACHE -eq '1'){throw 'Uninstaller download failed'};[IO.File]::ReadAllText($env:CLAWGOD_FIXTURE_INSTALLER) }
${['PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432'].filter(key => Object.hasOwn(extra, key)).map(key => `$env:${key}='${extra[key].replaceAll("'", "''")}'`).join('\n')}
${extra.CLAWGOD_FAIL_LAUNCHER ? '$lock=[IO.File]::Open((Join-Path $env:USERPROFILE ".local\\bin\\clawgod.cmd"),"Open","Read","Read")' : ''}
& ([scriptblock]::Create([IO.File]::ReadAllText($env:CLAWGOD_FIXTURE_INSTALLER))) ${args.map(arg => `'${arg.replaceAll("'", "''")}'`).join(' ')}
if (-not $?) { exit 1 }
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
    shellFile('npm', `printf '%s' "$2" > "$HOME/requested-package.txt"
[ "\${CLAWGOD_FAIL_STAGE:-}" != download ] || exit 23
tag="\${2##*@}"; case "$tag" in latest) version=2.1.315;; stable) version=2.1.308;; *) version="$tag";; esac
printf '%s' "$version" > fixture.tgz\n`);
    shellFile('tar', `[ "\${CLAWGOD_FAIL_STAGE:-}" != corrupt ] || exit 2
version=$(cat "$2");mkdir -p package
if [ "\${CLAWGOD_FAIL_STAGE:-}" = missing-binary ]; then exit 0; fi
printf '#!/bin/bash\\necho "%s (Claude Code)"\\n' "$version" > package/claude
printf '{"version":"%s"}' "$version" > package/package.json\n`);
    shellFile('stat', 'echo 11000001\n');
    shellFile('uname', `case "$1" in -s) if [ -n "\${CLAWGOD_FIXTURE_OS:-}" ];then echo "$CLAWGOD_FIXTURE_OS";exit;fi;;
-m) if [ -n "\${CLAWGOD_FIXTURE_ARCH:-}" ];then echo "$CLAWGOD_FIXTURE_ARCH";exit;fi;;esac
exec /usr/bin/uname "$@"\n`);
    shellFile('ldd', 'echo "\${CLAWGOD_FIXTURE_LIBC:-glibc}"\n');
    shellFile('rg', 'echo "ripgrep fixture"\n');
    shellFile('curl', `while [ "$#" -gt 0 ]; do if [ "$1" = -o ];then target="$2";shift 2;else shift;fi;done
case "$target" in */clawgod-import) exit 22;; esac
[ "\${CLAWGOD_FAIL_CACHE:-0}" != 1 ] || exit 22
cp "$CLAWGOD_FIXTURE_INSTALLER" "$target"\n`);
    shellFile('mv', `for target in "$@"; do :; done
case "$target" in */.local/bin/clawgod) [ "\${CLAWGOD_FAIL_LAUNCHER:-0}" != 1 ] || exit 73;; esac
exec /bin/mv "$@"\n`);
  }
  for (const [args, version] of [[[], '2.1.316'], [['latest'], '2.1.315'], [['stable'], '2.1.308'], [['2.1.309'], '2.1.309']]) {
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
  const platforms = windows ? [
    [{ PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_ARCHITEW6432: '' }, 'win32-x64'],
    [{ PROCESSOR_ARCHITECTURE: 'ARM64', PROCESSOR_ARCHITEW6432: '' }, 'win32-arm64'],
    [{ PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'ARM64' }, 'win32-arm64'],
  ] : [
    ['Linux', 'x86_64', 'glibc', 'linux-x64'], ['Linux', 'aarch64', 'glibc', 'linux-arm64'],
    ['Linux', 'x86_64', 'musl', 'linux-x64-musl'], ['Linux', 'aarch64', 'musl', 'linux-arm64-musl'],
    ['Darwin', 'x86_64', '', 'darwin-x64'], ['Darwin', 'arm64', '', 'darwin-arm64'],
  ].map(([os, arch, libc, suffix]) => [{ CLAWGOD_FIXTURE_OS: os, CLAWGOD_FIXTURE_ARCH: arch, CLAWGOD_FIXTURE_LIBC: libc }, suffix]);
  for (const [extra, suffix] of platforms) {
    succeeds(run(['2.1.316'], extra));
    assert.equal(readFileSync(join(home, 'requested-package.txt'), 'utf8'), `@anthropic-ai/claude-code-${suffix}@2.1.316`);
  }
  for (const name of retained) writeFileSync(join(dir, name), JSON.stringify({ fixture: name }));
  for (const extra of [{ CLAWGOD_FAIL_CACHE: '1' }, { CLAWGOD_FAIL_LAUNCHER: '1' },
    ...['download', 'corrupt', 'missing-binary', 'extract', 'post-process', 'patch', 'startup'].map(stage => ({ CLAWGOD_FAIL_STAGE: stage }))]) {
    writeFileSync(join(dir, '.compiled-runtime'), 'cli.compiled-old\n');
    writeFileSync(join(dir, 'cli.compiled-old'), 'old compiled runtime');
    const old = Object.fromEntries(['cli.original.cjs', 'cli.cjs', '.source-version', native, 'install.' + (windows ? 'ps1' : 'sh'), '.compiled-runtime', 'source-backup.json', 'bunfs/asset.txt', ...retained]
      .map(name => [name, readFileSync(join(dir, name))]));
    const oldLauncher = readFileSync(launcher);
    const result = run(['latest'], extra, true);
    assert.ok(Number.isInteger(result.status), result.error?.message || 'Installer did not exit normally');
    assert.notEqual(result.status, 0, `Installation must fail for ${JSON.stringify(extra)}:\n${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stdout, /ClawGod installed!/);
    for (const [name, content] of Object.entries(old)) assert.deepEqual(readFileSync(join(dir, name)), content, `Rollback failed for ${name}`);
    assert.deepEqual(readFileSync(launcher), oldLauncher, 'Failed publication must preserve the previous launcher');
    assert.equal(readFileSync(join(dir, 'cli.compiled-old'), 'utf8'), 'old compiled runtime');
    assert.equal(existsSync(join(dir, windows ? 'claude.staged.exe' : 'claude.staged')), false);
    const restored = spawnSync('bun', [join(dir, 'cli.cjs'), '--version'], { env, encoding: 'utf8', timeout: 15000 });
    succeeds(restored);
    assert.equal(restored.stdout.trim(), readFileSync(join(dir, '.source-version'), 'utf8').trim() + ' (Claude Code)');
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
  for (const stage of ['download', 'corrupt', 'missing-binary', 'extract']) {
    const failed = run([], { CLAWGOD_FAIL_STAGE: stage });
    assert.ok(Number.isInteger(failed.status), failed.error?.message || 'Fresh installer did not exit normally');
    assert.notEqual(failed.status, 0, `Fresh ${stage} failure must abort`);
    assert.equal(existsSync(launcher), false, 'Failed fresh installation must not publish a launcher');
    assert.doesNotMatch(failed.stdout, /ClawGod installed!/);
    for (const name of retained) assert.equal(JSON.parse(readFileSync(join(dir, name), 'utf8')).fixture, name);
  }
  console.log('[installer-lifecycle.test] version selection, native isolation, finalization rollback, offline cache failure, and uninstall passed');
} finally {
  if (windows) spawnSync('powershell.exe', ['-NoProfile', '-Command', '[Environment]::SetEnvironmentVariable("Path", $env:CLAWGOD_SAVED_USER_PATH, "User")'], {
    env: { ...process.env, CLAWGOD_SAVED_USER_PATH: savedUserPath },
  });
  rmSync(root, { recursive: true, force: true });
}
