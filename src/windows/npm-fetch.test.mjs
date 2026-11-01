import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = mkdtempSync(join(tmpdir(), 'clawgod npm fetch-'));
const header = (name, size) => {
  const buf = Buffer.alloc(512);
  buf.write(name);
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124);
  buf[156] = 48;
  return buf;
};
const entry = (name, content) => Buffer.concat([header(name, content.length), Buffer.from(content), Buffer.alloc((512 - content.length % 512) % 512)]);
const archive = gzipSync(Buffer.concat([
  entry('package/package.json', '{"version":"2.1.316"}'), entry('package/claude.exe', 'fixture executable'), Buffer.alloc(1024),
]));
let mode = 'valid';
const server = createServer((req, res) => {
  if (mode === 'disconnect') { req.socket.destroy(); return; }
  if (req.url.startsWith('/@anthropic-ai/')) {
    if (mode === 'http-error') { res.writeHead(503); res.end('offline'); return; }
    res.end(mode === 'invalid-json' ? '{broken' : JSON.stringify({ version: '2.1.316', dist: { tarball: `http://127.0.0.1:${server.address().port}/redirect` } }));
  } else if (req.url === '/redirect') {
    res.writeHead(302, { location: mode === 'redirect-loop' ? '/redirect' : '/archive' }); res.end();
  } else if (mode === 'truncated-http') {
    res.writeHead(200, { 'content-length': archive.length + 10 }); res.flushHeaders(); res.write(archive.subarray(0, 10));
    setImmediate(() => res.destroy());
  } else if (mode === 'corrupt-gzip') res.end('not gzip');
  else if (mode === 'truncated-tar') res.end(gzipSync(Buffer.concat([header('package/claude.exe', 1024), Buffer.alloc(512)])));
  else if (mode === 'invalid-size') {
    const invalid = header('package/claude.exe', 0); invalid.write('bad-size\0', 124); res.end(gzipSync(invalid));
  } else if (mode === 'empty') res.end(gzipSync(Buffer.alloc(1024)));
  else res.end(archive);
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const preload = join(root, 'registry.cjs');
  // Redirect the production HTTPS registry request to this test's loopback server.
  writeFileSync(preload, `const https=require('node:https'),http=require('node:http');
https.request=(options,...args)=>http.request({...options,hostname:'127.0.0.1',port:${server.address().port}},...args);
require('node:module').syncBuiltinESMExports();`);
  const run = out => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', preload, fileURLToPath(new URL('./npm-fetch.mjs', import.meta.url)), '@anthropic-ai/claude-code-win32-x64@2.1.316', out], { timeout: 10000 });
    let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
  const good = join(root, 'valid space \u6d4b\u8bd5');
  const success = await run(good);
  assert.equal(success.code, 0, success.output);
  assert.equal(readFileSync(join(good, 'package/claude.exe'), 'utf8'), 'fixture executable');
  assert.equal(JSON.parse(readFileSync(join(good, 'package/package.json'))).version, '2.1.316');
  for (mode of ['http-error', 'invalid-json', 'disconnect', 'redirect-loop', 'truncated-http', 'corrupt-gzip', 'truncated-tar', 'invalid-size', 'empty']) {
    const out = join(root, mode); mkdirSync(out); writeFileSync(join(out, 'old-install'), 'keep');
    const result = await run(out);
    assert.ok(Number.isInteger(result.code), `${mode}: downloader timed out or was killed`);
    assert.notEqual(result.code, 0, `${mode}: ${result.output}`);
    assert.doesNotMatch(result.output, /^VERSION=/m, 'Failed downloads must not report success');
    assert.equal(readFileSync(join(out, 'old-install'), 'utf8'), 'keep');
    assert.equal(existsSync(join(out, 'package/claude.exe')), false);
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
console.log('[npm-fetch.test] loopback download, redirects and corrupt/truncated archives passed');
