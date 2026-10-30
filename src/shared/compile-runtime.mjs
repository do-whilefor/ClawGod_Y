import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePatchSource, walk } from './ast-patches.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, 'cli.cjs');
const marker = join(here, '.compiled-runtime');
const name = `cli.compiled-${Date.now()}-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`;
const output = join(here, name);
const temporaryMarker = `${marker}.${process.pid}.tmp`;

rmSync(marker, { force: true });
try {
  const original = readFileSync(join(here, 'cli.original.cjs'), 'utf8');
  const manifest = original.match(/^\/\/ clawgod:probe-modules (.+)$/m);
  const probes = manifest && JSON.parse(manifest[1]);
  if (!Array.isArray(probes) || !probes.length) throw new Error('tool probe manifest is missing');

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    bytecode: true,
    bytecodeDepth: 0,
    compile: { outfile: output },
    packages: 'external',
    external: ['*.node', '*.txt', '*.md'],
    minify: { whitespace: true },
    ignoreDCEAnnotations: true,
    plugins: [{
      name: 'clawgod-local-modules',
      setup(build) {
        build.onLoad({ filter: /\.(?:[cm]?js)$/ }, ({ path }) => {
          let contents = readFileSync(path, 'utf8');
          if (resolve(path) === entry) {
            const loop = 'for (const name of modules) require(join(__dirname, name));';
            if (!contents.includes(loop)) throw new Error('unsupported tool probe loader');
            contents = contents.replace(loop, () => probes.map(module => `require(${JSON.stringify(join(here, module))});`).join(''));
            contents = contents.replace(/\b__dirname\b/g, () => JSON.stringify(here));
          }
          if (contents.includes('import.meta.require')) {
            const edits = [];
            walk(parsePatchSource(contents), node => {
              const callee = node.callee;
              if (node.type !== 'CallExpression' || node.arguments.length !== 1 ||
                  callee.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'require' ||
                  callee.object.type !== 'MetaProperty' || callee.object.meta.name !== 'import') return;
              const argument = node.arguments[0];
              if (argument.type !== 'Literal' || typeof argument.value !== 'string' || !/\.[cm]?js$/.test(argument.value)) return;
              const target = resolve(dirname(path), argument.value);
              const local = relative(here, target);
              if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local) || !existsSync(target)) return;
              edits.push({ start: callee.start, end: callee.end });
            });
            for (const edit of edits.sort((a, b) => b.start - a.start)) {
              contents = contents.slice(0, edit.start) + 'require' + contents.slice(edit.end);
            }
          }
          return { contents, loader: 'js' };
        });
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'));
  writeFileSync(temporaryMarker, name + '\n');
  renameSync(temporaryMarker, marker);
  console.log('[clawgod] Compiled startup runtime ready.');
} catch (error) {
  rmSync(output, { force: true });
  rmSync(temporaryMarker, { force: true });
  console.warn('[clawgod] Startup compilation skipped; using Bun source runtime: ' + error.message);
}
