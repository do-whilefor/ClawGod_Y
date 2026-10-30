#!/usr/bin/env node

const {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
const SOURCE_ROOT = join(ROOT, 'src');
const PLACEHOLDER_RE = /{{CLAWGOD:[^}]+}}/g;

const identity = (content) => content;

const escapeNonAscii = (content) => content.replace(
  /[^\x00-\x7F]/g,
  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
);

const FEATURES_META_MARKER = 'const CLAWGOD_FEATURES_META = {};';

function featuresMeta() {
  const registryUrl = new URL(`file://${join(SOURCE_ROOT, 'shared/patch-registry.mjs')}`).href;
  const result = spawnSync(process.execPath, ['-e',
    `import(${JSON.stringify(registryUrl)}).then(m=>console.log(JSON.stringify(m.featuresMeta())))`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`patch-registry.mjs featuresMeta failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function weaveFeaturesMeta(content) {
  if (!content.includes(FEATURES_META_MARKER)) {
    throw new Error(`wrapper source missing ${FEATURES_META_MARKER} marker`);
  }
  const meta = featuresMeta();
  const rendered = `const CLAWGOD_FEATURES_META = ${JSON.stringify(meta, null, 2)};`;
  return content.replace(FEATURES_META_MARKER, () => rendered);
}

const SHARED_SOURCES = {
  'extract-natives.mjs': ['shared/extract-natives.mjs'],
  'post-process.mjs': ['shared/post-process.mjs'],
  'openai-proxy.cjs': ['shared/openai-proxy.cjs'],
  'cli.cjs': ['shared/cli.cjs'],
  'startup-check.cjs': ['shared/startup-check.cjs'],
  'compile-runtime.mjs': ['shared/compile-runtime.mjs'],
  'runtime-helpers.cjs': ['shared/runtime-helpers.cjs'],
  'bun-ant-shim.cjs': ['shared/bun-ant-shim.cjs'],
  'feature-gates.cjs': ['shared/feature-gates.cjs', weaveFeaturesMeta, c => escapeNonAscii(weaveFeaturesMeta(c))],
  'patch.mjs': ['shared/patch.mjs'],
  'patch-registry.mjs': ['shared/patch-registry.mjs'],
  'ast-patches.mjs': ['shared/ast-patches.mjs'],
  'pentest-patches.mjs': ['shared/pentest-patches.mjs'],
  'pentest-scanners.mjs': ['shared/pentest-scanners.mjs'],
  'pentest-trimming.mjs': ['shared/pentest-trimming.mjs'],
  'pentest-policy-text.mjs': ['shared/pentest-policy-text.mjs'],
  'pentest-pruner.mjs': ['shared/pentest-pruner.mjs'],
  'lean-mode.cjs': ['shared/lean-mode.cjs'],
  'system-prompt.md': ['shared/system-prompt.md'],
  'acorn.mjs': ['shared/acorn.mjs'],
  'acorn.LICENSE': ['shared/acorn.LICENSE'],
  'features.json': ['shared/features.json'],
};

const TARGETS = [
  {
    name: 'install.sh',
    template: 'templates/install.sh',
    mode: 0o755,
    sources: Object.fromEntries(Object.entries(SHARED_SOURCES)
      .map(([k, [path, sh]]) => [k, [path, sh ?? identity]])),
  },
  {
    name: 'install.ps1',
    template: 'templates/install.ps1',
    asciiOnly: true,
    sources: {
      'npm-fetch.mjs': ['windows/npm-fetch.mjs', escapeNonAscii],
      ...Object.fromEntries(Object.entries(SHARED_SOURCES)
        .map(([k, [path, , ps1]]) => [k, [path, ps1 ?? escapeNonAscii]])),
      'lean-apply.cjs': ['windows/lean-apply.cjs', escapeNonAscii],
    },
  },
];

function readSource(relativePath) {
  const path = join(SOURCE_ROOT, relativePath);
  if (!existsSync(path)) throw new Error(`Missing build source: ${relativePath}`);
  const content = readFileSync(path, 'utf8');
  if (!content.endsWith('\n')) {
    throw new Error(`Build source must end with a newline: ${relativePath}`);
  }
  return content.slice(0, -1);
}

function render(target) {
  const templatePath = join(SOURCE_ROOT, target.template);
  if (!existsSync(templatePath)) throw new Error(`Missing template: ${target.template}`);
  let output = readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '');

  for (const [name, [sourcePath, transform]] of Object.entries(target.sources)) {
    const placeholder = `{{CLAWGOD:${name}}}`;
    const matches = output.split(placeholder).length - 1;
    if (matches !== 1) {
      throw new Error(`${target.template}: expected one ${placeholder}, found ${matches}`);
    }
    const source = transform(readSource(sourcePath));
    output = output.replace(placeholder, () => source);
  }

  const unresolved = output.match(PLACEHOLDER_RE);
  if (unresolved) {
    throw new Error(`${target.template}: unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  }
  if (target.asciiOnly) {
    const nonAsciiIndex = output.search(/[^\x00-\x7F]/);
    if (nonAsciiIndex !== -1) {
      const codePoint = output.codePointAt(nonAsciiIndex).toString(16).toUpperCase();
      throw new Error(`${target.template}: non-ASCII U+${codePoint} at character ${nonAsciiIndex}`);
    }
  }
  return output;
}

function firstDifference(actual, expected) {
  const length = Math.min(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    if (actual[index] !== expected[index]) return index;
  }
  return actual.length === expected.length ? -1 : length;
}

function checkTarget(target, expected) {
  const outputPath = join(ROOT, target.name);
  if (!existsSync(outputPath)) {
    console.error(`out of date: ${target.name} is missing`);
    return false;
  }
  const actual = readFileSync(outputPath, 'utf8');
  if (actual === expected) {
    console.log(`ok: ${target.name}`);
    return true;
  }
  const offset = firstDifference(actual, expected);
  console.error(`out of date: ${target.name} (first difference at character ${offset})`);
  return false;
}

function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    process.exit(2);
  }

  let success = true;
  for (const target of TARGETS) {
    const content = render(target);
    if (check) {
      success = checkTarget(target, content) && success;
      continue;
    }
    const outputPath = join(ROOT, target.name);
    writeFileSync(outputPath, content, 'utf8');
    if (target.mode) chmodSync(outputPath, target.mode);
    console.log(`built: ${target.name} (${Buffer.byteLength(content)} bytes)`);
  }
  if (!success) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
