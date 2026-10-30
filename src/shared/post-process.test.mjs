import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'clawgod text assets-'));
const defaultBun = process.platform === 'win32' && !process.env.CLAWGOD_TEST_BUN
  ? (() => {
      const candidates = [process.env.APPDATA, process.env.LOCALAPPDATA]
        .filter(Boolean).map(base => join(base, 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'));
      return candidates.find(existsSync) || 'bun';
    })()
  : 'bun';
const bun = process.env.CLAWGOD_TEST_BUN || defaultBun;
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr + result.stdout);
};

try {
  for (const mount of ['/$bunfs/root/', 'B:/~BUN/root/']) {
    const dir = join(root, mount.startsWith('B:') ? 'windows' : 'posix', 'profile space \u6d4b\u8bd5');
    mkdirSync(join(dir, 'bunfs'), { recursive: true });
    copyFileSync(new URL('./post-process.mjs', import.meta.url), join(dir, 'post-process.mjs'));
    copyFileSync(new URL('./acorn.mjs', import.meta.url), join(dir, 'acorn.mjs'));
    writeFileSync(join(dir, 'pathmap.json'), JSON.stringify({
      [`${mount}helper.js`]: { path: 'bunfs/helper.js', loader: 'js' },
      [`${mount}state-library.js.txt`]: { path: 'bunfs/state-library.js.txt', loader: 'text' },
      [`${mount}guide.md`]: { path: 'bunfs/guide.md', loader: 'text' },
      [`${mount}module.js`]: { path: 'bunfs/module.js', loader: 'js' },
      [`${mount}template.js`]: { path: 'bunfs/template.js', loader: 'text' },
      [`${mount}template.mjs`]: { path: 'bunfs/template.mjs', loader: 'file' },
    }));
    writeFileSync(join(dir, 'cli.original.js'),
      `import {load} from ${JSON.stringify(mount + 'helper.js')};var entryLoad=import.meta.require;export{load,entryLoad};`);
    writeFileSync(join(dir, 'bunfs/helper.js'),
      `var load=import.meta.require;const embeddedSource=()=>load(${JSON.stringify(mount + 'state-library.js.txt')});export{load,embeddedSource};`);
    writeFileSync(join(dir, 'bunfs/state-library.js.txt'), 'export const answer = 42;\n');
    writeFileSync(join(dir, 'bunfs/guide.md'), '# Guide\n');
    writeFileSync(join(dir, 'bunfs/module.js'), 'export const value = 7;');
    writeFileSync(join(dir, 'bunfs/template.js'), 'throw new Error("Text asset executed");');
    writeFileSync(join(dir, 'bunfs/template.mjs'), 'throw new Error("File asset executed");');
    writeFileSync(join(dir, 'external.txt'), 'outside the extracted graph');

    run(process.execPath, [join(dir, 'post-process.mjs')]);
    const check = join(dir, 'check.mjs');
    writeFileSync(check, `
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { load, entryLoad } from './cli.original.cjs';
import { embeddedSource } from './bunfs/helper.js';
assert.equal(embeddedSource(), 'export const answer = 42;\\n');
const assetIds = [
  join(import.meta.dirname, 'bunfs/state-library.js.txt'),
  ${JSON.stringify(join(realpathSync.native(dir), 'bunfs/state-library.js.txt'))},
];
if (process.platform === 'win32') {
  assetIds.push(...assetIds.flatMap(id => [id.replaceAll(${JSON.stringify('\\')}, '/'), id.toLowerCase()]));
}
for (const requireAsset of [load, entryLoad]) {
  for (const id of new Set(assetIds)) {
    const source = requireAsset(id);
    assert.equal(typeof source, 'string', JSON.stringify({ id, loader: requireAsset.toString() }));
    const module = new SourceTextModule(source);
    await module.link(() => { throw new Error('Unexpected dependency'); });
    await module.evaluate();
    assert.equal(module.namespace.answer, 42);
  }
  assert.equal(requireAsset(join(import.meta.dirname, 'bunfs/guide.md')), '# Guide\\n');
  assert.equal(requireAsset(join(import.meta.dirname, 'bunfs/module.js')).value, 7);
  assert.equal(requireAsset(join(import.meta.dirname, 'bunfs/template.js')), 'throw new Error("Text asset executed");');
  assert.equal(requireAsset(join(import.meta.dirname, 'bunfs/template.mjs')), join(import.meta.dirname, 'bunfs/template.mjs'));
  assert.equal(typeof requireAsset('node:fs').readFileSync, 'function');
  assert.equal(requireAsset(join(import.meta.dirname, 'external.txt')).default, 'outside the extracted graph');
  assert.throws(() => requireAsset(join(import.meta.dirname, 'bunfs/missing.txt')), /Cannot find module/);
}
`);
    run(bun, [check]);

    const helper = readFileSync(join(dir, 'bunfs/helper.js'), 'utf8');
    copyFileSync(join(dir, 'cli.original.cjs'), join(dir, 'cli.original.js'));
    run(process.execPath, [join(dir, 'post-process.mjs')]);
    assert.equal(readFileSync(join(dir, 'bunfs/helper.js'), 'utf8'), helper, 'reprocessing must not nest loaders');
    run(bun, [check]);
  }
  console.log('[post-process.test] extracted text compiles in the hooks VM; module imports and errors are preserved');
} finally {
  rmSync(root, { recursive: true, force: true });
}
