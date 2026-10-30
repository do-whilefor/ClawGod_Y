
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewritePromptAssembly } from './runtime-helpers.cjs';

const MARK = '<!-- clawgod:custom-prompt -->';
const opts = prompt => ({ customPrompt: prompt, stripMemory: true });

{
  const prompt = 'ROLE: senior operator.\n\nNever mention the host.';
  const sections = [
    'Header.\n' + prompt + '\nPrefer editing existing files to creating new ones.',
  ];
  const out = rewritePromptAssembly(sections, opts(prompt));
  assert.equal(out.length, 2);
  assert.ok(out[0].startsWith(MARK));
  assert.ok(!out[1].includes('ROLE: senior operator.'));
  assert.ok(!out[1].includes('Never mention the host.'));
  assert.ok(out[1].includes('Header.'));
  assert.ok(out[1].includes('Prefer editing existing files to creating new ones.'));
  assert.equal(out[1], 'Header.\n\nPrefer editing existing files to creating new ones.');
}
{
  const prompt = 'ALPHA block one.\n\nBRAVO block two.';
  const out = rewritePromptAssembly([prompt], opts(prompt));
  assert.equal(out.length, 1);
  assert.ok(out[0].startsWith(MARK));
}
{
  const prompt = 'Line one of the role.\nSecond line of the role.';
  const variant = 'Line one   of the role.\n   Second line of the role.';
  const out = rewritePromptAssembly(['Prefix.\n' + variant], opts(prompt));
  assert.ok(!out[1].includes('of the role.'));
  assert.ok(out[1].includes('Prefix.'));
}

{
  const prompt = 'Custom role.';
  const out = rewritePromptAssembly(
    ['You are Claude Code, an interactive CLI tool.\nYour working directory is /x.'],
    opts(prompt));
  assert.equal(out.length, 1);
  assert.ok(out[0].startsWith(MARK));
}
{
  const prompt = 'Custom role.';
  const out = rewritePromptAssembly(
    ['You are Claude Code. Prefer editing existing files to creating new ones.'],
    opts(prompt));
  assert.equal(out.length, 2);
  assert.ok(out[1].includes('Prefer editing existing files'));
}

{
  const prompt = 'Custom role.';
  const once = rewritePromptAssembly(
    ['You are Claude Code. Prefer editing existing files to creating new ones.'],
    opts(prompt));
  const twice = rewritePromptAssembly(once, opts(prompt));
  assert.deepEqual(twice, once);
}

{
  const sections = ['Keep this section.', 'And this one.'];
  const out = rewritePromptAssembly(sections, opts(''));
  assert.equal(out, sections);
}
{
  assert.equal(rewritePromptAssembly('not-an-array', opts('x')), 'not-an-array');
  assert.equal(rewritePromptAssembly(undefined, opts('x')), undefined);
}

{
  const real = readFileSync(new URL('./system-prompt.md', import.meta.url), 'utf8').trim();
  assert.ok(real.length > 0);
  const duty = 'Prefer editing existing files to creating new ones. ' +
    'Follow existing code style and conventions.';
  const out = rewritePromptAssembly([duty], opts(real));
  assert.equal(out.length, 2);
  assert.equal(out[1], duty);
  const embedded = rewritePromptAssembly(['Lead in.\n\n' + real + '\n\nTail out.'], opts(real));
  assert.equal(embedded.length, 2);
  assert.ok(embedded[1].includes('Lead in.'));
  assert.ok(embedded[1].includes('Tail out.'));
}

{
  const prompt = 'Custom role.';
  const line = 'You are DeepSeek Harness, an AI coding assistant.\nPrefer editing existing files.';
  const defaultOut = rewritePromptAssembly([line], opts(prompt));
  assert.ok(defaultOut[1].includes('DeepSeek Harness'));
  const customOut = rewritePromptAssembly([line], {
    customPrompt: prompt, stripMemory: true,
    identityMarkers: ['you are deepseek harness'],
  });
  assert.ok(!customOut[1].includes('DeepSeek Harness'));
  assert.ok(customOut[1].includes('Prefer editing existing files.'));
}

console.log('[prompt-assembly.test] duplicate scrub, residue drop, idempotence, custom markers ok');
