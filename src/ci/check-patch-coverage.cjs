const { readFileSync } = require('node:fs');

const [logPath, platform] = process.argv.slice(2);
if (!logPath || !['linux', 'macos', 'windows'].includes(platform)) {
  throw new Error('Usage: node check-patch-coverage.cjs <install-log> <linux|macos|windows>');
}

// Known gaps in Claude 2.1.316: actions/runs/41206844027, also shared by stable 2.1.309.
const baseline = new Map([
  ['Computer Use gate (resolved configuration contract)', 'absent'],
  ['Neutralize geo-steganography in date string (qla)', 'unverified'],
  ['Skip MCP server allowlist / policy checks', 'absent'],
  ['Ultrareview enable (direct literal, <=2.1.213)', 'absent'],
  ['Computer Use gate bypass', 'unverified'],
  ['Auto-mode unlock for third-party API (provider helper gate)', 'absent'],
  ['macOS Cmd+V image paste fallback to clipboard read', 'stale'],
  ['Restore Glob/Grep tools (un-inline EMBEDDED_SEARCH_TOOLS)', platform === 'windows' ? 'stale' : 'absent'],
  ['Neutralize geo-detection probe (rdp)', 'unverified'],
  ['Neutralize apostrophe steganography (odp)', 'absent'],
  ['Remove cautious actions section', 'unverified'],
  ['Message list filter bypass (legacy ternary)', 'absent'],
]);
if (platform !== 'macos') {
  baseline.set('Computer Use default enabled', 'unverified');
  baseline.set('Computer Use subscription bypass', 'unverified');
}

const bytes = readFileSync(logPath);
const log = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8')
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const start = log.lastIndexOf('Mode: APPLY');
const summary = start < 0 ? null : log.slice(start)
  .match(/Result:\s*(\d+) applied,\s*(\d+) skipped,\s*(\d+) failed/);
if (!summary) throw new Error('Patch APPLY result is missing from the install log');

const body = log.slice(start, start + summary.index);
const errors = [];
if (Number(summary[3]) !== 0) errors.push(`Patcher reported ${summary[3]} failed patches`);
let records = 0;
const observed = { applied: 0, skipped: 0, failed: 0 };
for (const raw of body.split(/\r?\n/)) {
  const line = raw.trim();
  const status = line.match(/^(✅|⏭|⚠️|❌)\s+(.+)/u);
  if (!status) continue;
  const [, icon, message] = status;
  const partial = message.match(/^([\w-]+): (\d+) site\(s\) NOT patched/);
  if (partial) {
    if (partial[1] !== 'ultraplan' || Number(partial[2]) > 1) errors.push(message);
    continue;
  }
  records++;
  observed[icon === '✅' ? 'applied' : icon === '❌' ? 'failed' : 'skipped']++;
  if (icon === '✅' || / \(covered by applied rule: [\w-]+\)$/.test(message)) continue;
  if (icon === '❌') {
    errors.push(message);
    continue;
  }
  const missing = message.match(/^(.*) \((not present in this version|no matching anchor; application cannot be verified|0 matches, no sentinel — cannot verify)\)$/);
  const stale = message.match(/^(.*) — (?:regex|AST matcher) stale,/);
  const name = missing?.[1] ?? stale?.[1];
  const state = stale ? 'stale' : missing?.[2] === 'not present in this version' ? 'absent' : 'unverified';
  if (!name || baseline.get(name) !== state) errors.push(`New patch coverage gap: ${message}`);
}
if (records !== Number(summary[1]) + Number(summary[2]) + Number(summary[3])) {
  errors.push('Patch result count does not match the parsed patch records');
}
if (records < 72 || observed.applied === 0) errors.push('Patch report is empty or incomplete (baseline: 72 rules)');
if (observed.applied !== Number(summary[1]) || observed.skipped !== Number(summary[2]) || observed.failed !== Number(summary[3])) {
  errors.push('Patch status counts do not match the summary');
}
if (body.includes('Runtime fallback installed;')) errors.push('New runtime fallback requires coverage review');
if (errors.length) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`Patch coverage baseline (${platform}): ${summary[0]}; no new coverage gaps`);
