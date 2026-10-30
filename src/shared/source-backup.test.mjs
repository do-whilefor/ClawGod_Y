import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'clawgod-source-backup-'));
const command = 'function userType(){return"external"}';
const colors = 'const color="rgb(215,119,87)";';
try {
  for (const graph of [false, true]) {
    const dir = join(root, graph ? 'graph' : 'legacy');
    mkdirSync(dir);
    for (const name of ['patch.mjs', 'patch-registry.mjs', 'ast-patches.mjs', 'acorn.mjs', 'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-trimming.mjs', 'pentest-policy-text.mjs', 'pentest-pruner.mjs']) {
      copyFileSync(new URL(`./${name}`, import.meta.url), join(dir, name));
    }
    const entry = join(dir, 'cli.original.cjs');
    if (graph) mkdirSync(join(dir, 'bunfs'));
    const target = graph ? join(dir, 'bunfs/commands.js') : entry;
    const snapshot = join(dir, 'source-backup.json');
    const writeSource = (version, body = command) => {
      writeFileSync(entry, `// Version: ${version}\n${graph ? '// entry' : body + colors}`);
      if (graph) {
        writeFileSync(target, body);
        writeFileSync(join(dir, 'bunfs/colors.mjs'), colors);
        writeFileSync(join(dir, 'bunfs/asset.txt'), 'unchanged asset');
        writeFileSync(join(dir, 'pathmap.json'), JSON.stringify({
          '/$bunfs/root/commands.js': { path: 'bunfs/commands.js', loader: 'js' },
          '/$bunfs/root/colors.mjs': { path: 'bunfs/colors.mjs', loader: 'js' },
          '/$bunfs/root/asset.txt': { path: 'bunfs/asset.txt', loader: 'text' },
        }));
      }
    };
    const run = (...args) => spawnSync(process.execPath, [join(dir, 'patch.mjs'), ...args], { encoding: 'utf8' });
    const succeeds = (...args) => {
      const result = run(...args);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout;
    };

    writeSource('2.1.283');
    const clean = readFileSync(target, 'utf8');
    succeeds('--capture-clean-source');
    const backup = readFileSync(snapshot, 'utf8');
    const first = succeeds();
    const patched = readFileSync(target, 'utf8');
    assert.match(patched, /return"ant"/);
    assert.notEqual(patched, clean);
    for (let attempt = 0; attempt < 3; attempt++) {
      const output = succeeds();
      assert.equal(output.match(/Result: .*/)[0], first.match(/Result: .*/)[0]);
      assert.equal(readFileSync(target, 'utf8'), patched, 'no nested or duplicate patches');
      assert.equal(readFileSync(snapshot, 'utf8'), backup, 'clean backup stays clean');
    }
    succeeds('--revert');
    assert.equal(readFileSync(target, 'utf8'), clean);
    if (graph) assert.equal(readFileSync(join(dir, 'bunfs/colors.mjs'), 'utf8'), colors);
    succeeds();
    assert.equal(readFileSync(target, 'utf8'), patched);

    writeFileSync(snapshot, '{truncated');
    assert.equal(run().status, 1);
    assert.equal(readFileSync(target, 'utf8'), patched);
    writeFileSync(snapshot, backup);
    if (graph) {
      writeFileSync(join(dir, 'bunfs/extra.js'), '// mismatched graph');
      const pathMapFile = join(dir, 'pathmap.json');
      const pathMap = JSON.parse(readFileSync(pathMapFile, 'utf8'));
      pathMap['/$bunfs/root/extra.js'] = { path: 'bunfs/extra.js', loader: 'js' };
      writeFileSync(pathMapFile, JSON.stringify(pathMap));
      assert.equal(run().status, 1);
      assert.equal(readFileSync(target, 'utf8'), patched);
      rmSync(join(dir, 'bunfs/extra.js'));
      delete pathMap['/$bunfs/root/extra.js'];
      writeFileSync(pathMapFile, JSON.stringify(pathMap));
    }
    writeSource('2.1.284');
    assert.equal(run().status, 1, 'reject mismatched backup version');
    succeeds('--capture-clean-source');
    assert.equal(JSON.parse(readFileSync(snapshot)).version, '2.1.284');
    assert.match(readFileSync(entry + '.bak', 'utf8'), /Version: 2.1.284/);
    succeeds();

    rmSync(snapshot);
    rmSync(entry + '.bak');
    writeSource('2.1.284', 'const unsupported="fixture";');
    writeFileSync(join(dir, 'system-prompt.md'), 'Fixture prompt.\n');
    const before = readFileSync(target, 'utf8');
    for (const args of [[], ['--dry-run']]) {
      const failed = run(...args);
      assert.equal(failed.status, 1);
      assert.match(failed.stdout, /required prompt injection hook did not match/);
      assert.equal(readFileSync(target, 'utf8'), before);
      assert.equal(existsSync(entry + '.bak'), false);
      if (graph) assert.equal(readFileSync(join(dir, 'bunfs/colors.mjs'), 'utf8'), colors);
    }
  }
  if (process.platform !== 'win32') {
    const template = readFileSync(new URL('../templates/install.sh', import.meta.url), 'utf8');
    const dir = join(root, 'shell');
    mkdirSync(dir);
    const env = { ...process.env, CLAWGOD_DIR: dir, BIN_DIR: join(dir, 'bin'), VERSION: '2.1.312' };
    const shell = (body, extraEnv = {}) => spawnSync('bash', ['-c', 'set -e\ninfo() { echo "$*"; }; warn() { echo "$*"; }; dim() { :; };\n' + body], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
    writeFileSync(join(dir, 'patch.mjs'), "if(process.argv.includes('--capture-clean-source'))process.exit(0);process.exit(7)");
    const applyStart = template.indexOf('node "$CLAWGOD_DIR/patch.mjs" --capture-clean-source');
    const apply = template.slice(applyStart, template.indexOf('if grep -rqs "Bun', applyStart));
    const snapshotStart = template.indexOf('PREV_BACKUP_DIR=""');
    const snapshotInstall = template.slice(snapshotStart, template.indexOf('cat > "$CLAWGOD_DIR/extract-natives.mjs"', snapshotStart));
    const extractionStart = template.indexOf('rm -rf "$CLAWGOD_DIR/vendor"', snapshotStart);
    const extract = template.slice(extractionStart, template.indexOf('dim "Rewriting bunfs paths and IIFE invocation', extractionStart));
    let result = shell(apply + '\necho UNEXPECTED_SUCCESS');
    assert.equal(result.status, 7);
    assert.match(result.stdout, /Installation aborted/);
    assert.match(result.stdout, /No previous working installation found to roll back/);
    assert.match(result.stdout, /Rerun the current installer/);
    assert.doesNotMatch(result.stdout, /UNEXPECTED_SUCCESS/);
    const rollbackDir = join(dir, 'rollback-test');
    mkdirSync(rollbackDir);
    const rollbackTmp = join(rollbackDir, 'tmp');
    mkdirSync(rollbackTmp);
    const graphDir = join(rollbackDir, 'bunfs');
    mkdirSync(graphDir);
    writeFileSync(join(graphDir, 'commands.js'), '// old graph');
    writeFileSync(join(rollbackDir, 'cli.original.cjs'), '// Old working 2.1.280');
    writeFileSync(join(rollbackDir, '.source-version'), '2.1.280\n');
    writeFileSync(join(rollbackDir, 'cli.cjs'), '// old wrapper');
    writeFileSync(join(rollbackDir, 'patch.mjs'), '// old patcher');
    const astPayloads = ['ast-patches.mjs', 'acorn.mjs', 'acorn.LICENSE'];
    for (const name of astPayloads) writeFileSync(join(rollbackDir, name), `old ${name}`);
    writeFileSync(join(rollbackDir, 'broken-patch.mjs'), "if(process.argv.includes('--capture-clean-source')) process.exit(0); process.exit(9);");
    const rollbackEnv = { ...env, CLAWGOD_DIR: rollbackDir, TMPDIR: rollbackTmp, NATIVE_BIN_LABEL: '2.1.299', NATIVE_BIN: 'missing' };
    const rollbackShell = body => spawnSync('bash', ['-c', 'set -e\ninfo() { echo "$*"; }; warn() { echo "$*"; }; dim() { :; }; err() { echo "$*"; };\n' + body], { env: rollbackEnv, encoding: 'utf8' });
    result = rollbackShell(snapshotInstall + '\nnode() { return 17; }\n' + extract);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Restored previous working installation \(2.1.280\)/);
    assert.equal(readFileSync(join(graphDir, 'commands.js'), 'utf8'), '// old graph');
    assert.equal(readdirSync(rollbackTmp).length, 0);

    const broken = '\nrm -rf "$CLAWGOD_DIR/bunfs"\nprintf "%s\\n" "// Broken candidate 2.1.299" > "$CLAWGOD_DIR/cli.original.cjs"\nprintf "%s\\n" 2.1.299 > "$CLAWGOD_DIR/.source-version"\nprintf "%s\\n" "// new wrapper" > "$CLAWGOD_DIR/cli.cjs"\nprintf "%s\\n" "native 2.1.299" > "$CLAWGOD_DIR/claude.staged"\ncp "$CLAWGOD_DIR/broken-patch.mjs" "$CLAWGOD_DIR/patch.mjs"\n';
    const replaceAst = astPayloads.map(name => `printf '%s' new > "$CLAWGOD_DIR/${name}"`).join('\n') + '\n';
    result = rollbackShell(snapshotInstall + broken + replaceAst + apply);
    assert.equal(result.status, 9, result.stderr + result.stdout);
    assert.match(result.stdout, /Restored previous working installation \(2.1.280\)/);
    assert.match(result.stdout, /The new Claude Code build \(2.1.299\) is not yet supported/);
    assert.equal(readFileSync(join(rollbackDir, '.source-version'), 'utf8').trim(), '2.1.280');
    assert.equal(readFileSync(join(rollbackDir, 'cli.original.cjs'), 'utf8'), '// Old working 2.1.280');
    assert.equal(readFileSync(join(graphDir, 'commands.js'), 'utf8'), '// old graph');
    assert.equal(readFileSync(join(rollbackDir, 'cli.cjs'), 'utf8'), '// old wrapper');
    for (const name of astPayloads) assert.equal(readFileSync(join(rollbackDir, name), 'utf8'), `old ${name}`);
    assert.equal(existsSync(join(rollbackDir, 'claude.staged')), false);
    assert.equal(readdirSync(rollbackTmp).length, 0, 'rollback temp dir cleaned up');
  }
  console.log('[source-backup.test] clean backups, patching, extraction rollback, and patch failure rollback passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
