#!/usr/bin/env node
// prompt-audit — diff a Claude Code clean-source snapshot against the fork's
// prompt-coverage lists.
//
// Purpose: after every Claude Code release, run this once against the
// installed clean source to answer two questions:
//   1. UNCOVERED: which caution/safety/coaching strings did the new bundle
//      grow that none of our rewrites or prefixes touch? Each hit is a
//      candidate for a new removedPromptPrefixes / rewrite-table entry.
//   2. DEAD COVERAGE: which of our exact-match rewrites and prefixes no
//      longer exist in the bundle? Dead entries are harmless at patch time
//      (no match → no edit) but should be pruned to keep the tables honest.
//
// Usage:
//   node tools/prompt-audit.mjs                       # ~/.clawgod/source-backup.json
//   node tools/prompt-audit.mjs --source <backup.json>
//
// The scanner is heuristic (regex over source text, no AST): it looks at
// string literals and template-literal chunks. Confirm each hit by reading
// the cited context before turning it into a patch anchor — strings inside
// log/telemetry machinery are not prompt-visible and should be skipped.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const {
  PENTEST_ANCHORS,
  PENTEST_COVERAGE: {
    removedPromptPrefixes, denialGuidancePrefixes,
    removalGuidance, injectionWarning, unavailableReviewWarning,
    PENTEST_IDENTITY_REWRITES, PENTEST_PREFIX_REWRITES,
    SUBAGENT_PROMPT_PREFIXES,
    PENTEST_TOOL_DESCRIPTION_REWRITES, WEBFETCH_NOTES_PREFIX,
  },
} = await import(pathToFileURL(join(repoRoot, 'src', 'shared', 'pentest-patches.mjs')).href);

const sourceArg = process.argv.indexOf('--source');
const sourcePath = sourceArg !== -1 && process.argv[sourceArg + 1]
  ? process.argv[sourceArg + 1]
  : join(homedir(), '.clawgod', 'source-backup.json');
if (!existsSync(sourcePath)) {
  console.error(`No clean-source snapshot at ${sourcePath}. Install/re-patch first, or pass --source.`);
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(sourcePath, 'utf8'));
console.log(`Auditing ${Object.keys(snapshot.files ?? {}).length} files from ${sourcePath} (v${snapshot.version})\n`);

// Heuristic caution markers for prompt-visible coaching text. Deliberately
// broad, but paired with a prose filter below: internal state machines
// constantly contain words like "refused"/"declined" in log and error
// strings that never reach the model, so those markers are excluded.
const MARKERS = [
  /must never/i, /never (?:generate|produce|follow|trust|accept)/i, /be careful/i, /\bcaution/i,
  /do not (?:use|run|execute|access|modify|delete|share|send|act|re-?attempt)/i,
  /avoid (?:using|running|executing|introducing)/i,
  /irreversible/i, /destructive/i, /\bsafety\b/i, /prohibited/i,
  /unauthorized/i, /malicious/i, /harmful/i, /ethically/i, /illegal/i,
  /permission from/i, /confirm (?:with|before)/i,
  /untrusted/i, /quote[sd]? .{0,40}maximum/i, /you are not a lawyer/i,
];
// Prompt-visible coaching is prose addressed at the model or about the user.
const looksLikeProse = text =>
  text.split(/\s+/).length >= 8 && /\b(you|your|the user|never|always)\b/i.test(text);
const SKIP_FILES = /(?:changelog|change-?log|\.md$|\.txt$|\.json$)/i;
const MIN_LEN = 25, MAX_LEN = 500;

function covered(raw) {
  // Source captures can carry leading expression noise (`,` or backticks)
  // before the sentence starts; strip it so prefix checks see the text.
  const text = raw.replace(/^[^A-Za-z]+/, '');
  for (const prefix of [...removedPromptPrefixes, ...denialGuidancePrefixes,
    removalGuidance, injectionWarning, unavailableReviewWarning,
    ...SUBAGENT_PROMPT_PREFIXES, WEBFETCH_NOTES_PREFIX,
    ...PENTEST_PREFIX_REWRITES.map(e => e.prefix)]) {
    if (text.startsWith(prefix)) return `prefix:${prefix.slice(0, 40)}`;
  }
  for (const entry of PENTEST_IDENTITY_REWRITES) {
    if (entry.from === text) return 'identity-rewrite';
  }
  for (const entry of PENTEST_TOOL_DESCRIPTION_REWRITES) {
    if (entry.kind === 'exact' && entry.from === text) return 'tool-desc:exact';
    if (entry.kind === 'prefix' && text.startsWith(entry.prefix)) return 'tool-desc:prefix';
    if (entry.kind === 'contains' && text.includes(entry.contains)) return 'tool-desc:contains';
  }
  return null;
}

const re = new RegExp(`"((?:[^"\\\\\\n]|\\\\.){${MIN_LEN},${MAX_LEN}})"`, 'g');

const uncovered = new Map(); // text -> {file, at}
for (const [name, code] of Object.entries(snapshot.files ?? {})) {
  if (SKIP_FILES.test(name)) continue;
  let m;
  while ((m = re.exec(code))) {
    // Unescape the common JSON-ish escapes so prefix checks see real text.
    let text;
    try { text = JSON.parse(`"${m[1]}"`); } catch { text = m[1]; }
    if (!MARKERS.some(rx => rx.test(text)) || !looksLikeProse(text)) continue;
    if (covered(text)) continue;
    if (!uncovered.has(text)) uncovered.set(text, { file: name, at: m.index });
  }
}

console.log(`── UNCOVERED caution candidates: ${uncovered.size}`);
let shown = 0;
for (const [text, { file, at }] of [...uncovered.entries()].sort((a, b) => a[1].file.localeCompare(b[1].file))) {
  if (shown++ >= 60) { console.log('\n  … output capped at 60; refine or extend coverage to shrink the set'); break; }
  console.log(`\n  ${file} @${at}`);
  console.log(`  » ${text.slice(0, 200).replaceAll('\n', '\\n')}`);
}

console.log('\n── DEAD coverage entries (no hit in this bundle)');
let dead = 0;
for (const entry of PENTEST_IDENTITY_REWRITES) {
  const hit = Object.values(snapshot.files).some(code => code.includes(entry.from));
  if (!hit) { console.log(`  identity-rewrite: ${entry.from.slice(0, 90)}…`); dead++; }
}
for (const prefix of [...SUBAGENT_PROMPT_PREFIXES, ...PENTEST_PREFIX_REWRITES.map(e => e.prefix)]) {
  const hit = Object.values(snapshot.files).some(code => code.includes(prefix));
  if (!hit) { console.log(`  prefix: ${prefix.slice(0, 90)}`); dead++; }
}
for (const entry of PENTEST_TOOL_DESCRIPTION_REWRITES) {
  const needle = entry.kind === 'contains' ? entry.contains
    : entry.kind === 'prefix' ? entry.prefix : entry.from;
  const hit = Object.values(snapshot.files).some(code => code.includes(needle));
  if (!hit) { console.log(`  tool-desc ${entry.kind}: ${needle.slice(0, 90)}…`); dead++; }
}
if (!dead) console.log('  (none — every entry hits this bundle)');

console.log(`\n${uncovered.size} uncovered candidate(s), ${dead} dead entrie(s).`);
console.log('Review each candidate in context before promoting it to a patch anchor;');
console.log('telemetry/log strings are not prompt-visible and must be skipped.');
