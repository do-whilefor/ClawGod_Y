import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'clawgod binary formats-'));
const name = Buffer.from('/$bunfs/root/cli.js');
const content = Buffer.from('(function(exports, require, module){module.exports="fixture"})');
const trailer = Buffer.from('\n---- Bun! ----\n');
const tableOffset = name.length + content.length;
const offsetsAt = tableOffset + 52;
const payload = Buffer.alloc(offsetsAt + 32 + trailer.length);
name.copy(payload); content.copy(payload, name.length);
payload.writeUInt32LE(name.length, tableOffset + 4);
payload.writeUInt32LE(name.length, tableOffset + 8);
payload.writeUInt32LE(content.length, tableOffset + 12);
payload[tableOffset + 49] = 1;
payload.writeUInt32LE(tableOffset, offsetsAt + 8);
payload.writeUInt32LE(52, offsetsAt + 12);
trailer.copy(payload, payload.length - trailer.length);
const section = data => { const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(data.length)); return Buffer.concat([size, data]); };

function binary(format, arch, data) {
  const raw = section(data);
  let header;
  if (format === 'ELF') {
    header = Buffer.alloc(198);
    header.writeUInt32LE(0x464c457f); header[4] = 2; header[5] = 1;
    header.writeUInt16LE(arch === 'x64' ? 0x3e : 0xb7, 0x12);
    header.writeBigUInt64LE(64n, 0x28); header.writeUInt16LE(64, 0x3a); header.writeUInt16LE(2, 0x3c);
    header.writeBigUInt64LE(192n, 64 + 0x18); header.writeBigUInt64LE(6n, 64 + 0x20);
    header.write('\0.bun\0', 192);
    header.writeUInt32LE(1, 128); header.writeBigUInt64LE(198n, 128 + 0x18);
    header.writeBigUInt64LE(BigInt(raw.length), 128 + 0x20);
  } else if (format === 'Mach-O') {
    header = Buffer.alloc(184);
    header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(arch === 'x64' ? 0x01000007 : 0x0100000c, 4);
    header.writeUInt32LE(1, 0x10); header.writeUInt32LE(152, 0x14);
    header.writeUInt32LE(0x19, 32); header.writeUInt32LE(152, 36); header.write('__BUN', 40);
    header.writeUInt32LE(1, 32 + 0x40); header.write('__bun', 104);
    header.writeBigUInt64LE(BigInt(raw.length), 104 + 0x28); header.writeUInt32LE(184, 104 + 0x30);
  } else {
    header = Buffer.alloc(130);
    header.write('MZ'); header.writeUInt32LE(64, 0x3c); header.write('PE\0\0', 64);
    header.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68); header.writeUInt16LE(1, 70);
    header.writeUInt16LE(2, 84); header.writeUInt16LE(0x20b, 88); header.write('.bun', 90);
    header.writeUInt32LE(raw.length, 106); header.writeUInt32LE(130, 110);
  }
  return Buffer.concat([header, raw]);
}
try {
  let i = 0;
  const check = (bytes, ok, pattern) => {
    const path = join(root, `binary-${i}`), out = join(root, `out-${i++}`);
    writeFileSync(path, bytes);
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./extract-natives.mjs', import.meta.url)), path, out], { encoding: 'utf8' });
    assert.ok(Number.isInteger(child.status), child.error?.message || 'Extractor did not exit normally');
    assert.equal(child.status === 0, ok, child.stdout + child.stderr);
    if (ok) {
      assert.match(child.stdout, pattern);
      assert.equal(readFileSync(join(out, 'cli.original.js'), 'utf8'), content.toString());
    } else assert.equal(existsSync(join(out, 'cli.original.js')), false, 'Invalid binaries must not publish an entry point');
  };
  for (const format of ['ELF', 'Mach-O', 'PE']) for (const arch of ['x64', 'arm64']) {
    const good = binary(format, arch, payload);
    check(good, true, new RegExp(`${format} \\(${arch}-`));
    check(good.subarray(0, 8), false);
    check(good.subarray(0, good.length - 1), false);
    const brokenTrailer = Buffer.from(payload); brokenTrailer[brokenTrailer.length - 1] = 0;
    check(binary(format, arch, brokenTrailer), false);
    for (const [offset, value] of [[offsetsAt + 8, 0x7fffffff], [offsetsAt + 12, 51], [offsetsAt + 16, 1], [tableOffset, 0x7fffffff]]) {
      const corrupt = Buffer.from(payload); corrupt.writeUInt32LE(value, offset);
      check(binary(format, arch, corrupt), false);
    }
  }
  check(Buffer.alloc(0), false);
  check(Buffer.from('not an executable'), false);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('[extract-natives.test] ELF/Mach-O/PE x64/ARM64 and malformed binary rejection passed');
