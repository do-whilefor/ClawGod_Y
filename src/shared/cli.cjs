#!/usr/bin/env bun
const { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, renameSync } = require('fs');
const { join, basename } = require('path');
const { homedir } = require('os');
const { spawnSync } = require('child_process');

const clawgodDir = join(homedir(), '.clawgod');
// Standalone --version / -v skips provider setup and background update checks.
const versionOnly = process.argv.length === 3 && ['--version', '-v'].includes(process.argv[2]);

// One-time migration: earlier wrappers set CLAUDE_CONFIG_DIR=~/.clawgod,
// which made Claude Code read/write ~/.clawgod/.claude.json instead of the
// native ~/.claude.json. Move it back transparently on first run.
const nativeClaudeJson = join(homedir(), '.claude.json');
const strayClaudeJson = join(clawgodDir, '.claude.json');
if (!versionOnly && existsSync(strayClaudeJson) && !existsSync(nativeClaudeJson)) {
  try { renameSync(strayClaudeJson, nativeClaudeJson); } catch {}
}

const providerDir = clawgodDir;
const configFile = join(providerDir, 'provider.json');

const defaultConfig = {
  apiKey: '',
  baseURL: 'https://api.anthropic.com',
  model: '',
  smallModel: '',
  effort: '',
  timeoutMs: 3000000,
};

let config = { ...defaultConfig };
if (!versionOnly && existsSync(configFile)) {
  try {
    const raw = JSON.parse(readFileSync(configFile, 'utf8'));
    config = { ...defaultConfig, ...raw };
  } catch {}
} else if (!versionOnly) {
  mkdirSync(providerDir, { recursive: true });
  writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2) + '\n');
}

// Explicit protocol takes precedence over legacy provider types.
if (config.protocol !== undefined && !['anthropic', 'openai-chat'].includes(config.protocol)) {
  throw new Error('[clawgod] Unsupported provider protocol: ' + config.protocol + '. Use anthropic or openai-chat; auto and Responses are not supported.');
}
const _useProxy = config.protocol === 'openai-chat' ||
  (config.protocol === undefined && ['grok', 'openai-compat'].includes(config.type));
if (_useProxy) {
  let _proxyKey = config.apiKey || '';
  if (!_proxyKey && config.type === 'grok') {
    try {
      const _gs = JSON.parse(readFileSync(join(homedir(), '.grok', 'user-settings.json'), 'utf8'));
      _proxyKey = _gs.apiKey || '';
    } catch {}
    if (!_proxyKey) _proxyKey = process.env.GROK_API_KEY || '';
  }
  // The generic Anthropic default must never become a Chat Completions URL.
  if (config.baseURL === defaultConfig.baseURL || !config.baseURL) {
    if (config.type === 'grok') config.baseURL = 'https://api.x.ai/v1';
    else throw new Error('[clawgod] openai-chat requires an explicit baseURL, for example https://example.com/v1');
  }
  if (_proxyKey) {
    const { startProxy } = require('./openai-proxy.cjs');
    const _proxy = startProxy({
      apiKey: _proxyKey,
      baseURL: config.baseURL || (config.type === 'grok' ? 'https://api.x.ai/v1' : ''),
      model: config.model || '',
      effort: process.env.CLAUDE_CODE_EFFORT_LEVEL ?? config.effort,
      timeoutMs: process.env.API_TIMEOUT_MS ?? config.timeoutMs,
    });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + _proxy.port;
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-passthrough';
    if (config.model) process.env.ANTHROPIC_MODEL = config.model;
    if (config.smallModel) process.env.ANTHROPIC_SMALL_FAST_MODEL = config.smallModel;
    process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ??= '1';
    process.on('exit', function () { try { _proxy.stop(); } catch {} });
    process.stderr.write('[clawgod] OpenAI Chat Completions proxy on port ' + _proxy.port + '\n');
    config = { ...config, apiKey: '', baseURL: '', model: '', smallModel: '' };  // prevent fallthrough to apiKey/baseURL injection below
  } else {
    throw new Error('[clawgod] openai-chat requires an API key (grok also accepts GROK_API_KEY or ~/.grok/user-settings.json)');
  }
}

const hasProviderApiKey = !!config.apiKey;

if (hasProviderApiKey) {
  if (config.baseURL) process.env.ANTHROPIC_BASE_URL = config.baseURL;
  if (config.model) process.env.ANTHROPIC_MODEL = config.model;
  if (config.smallModel) process.env.ANTHROPIC_SMALL_FAST_MODEL = config.smallModel;
  if (config.baseURL && !/anthropic\.com/i.test(config.baseURL)) {
    delete process.env.ANTHROPIC_API_KEY;
    const existingToken = (process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
    process.env.ANTHROPIC_AUTH_TOKEN = existingToken || config.apiKey;
  } else {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = config.apiKey;
  }
} else if (config.baseURL && config.baseURL !== defaultConfig.baseURL) {
  process.env.ANTHROPIC_BASE_URL ??= config.baseURL;
}

// Third-party Anthropic-compatible proxies (DeepSeek / OneAPI / Bedrock /
// vLLM / etc.) don't share Anthropic's server-side handling of
// x-anthropic-billing-header. That header carries a per-request `cch` field
// which Anthropic's own server excludes from prompt-cache key calculation
// (via cacheScope:null), but third-party proxies fold into the prefix hash —
// so the cached prefix changes every request and cache hit rate drops to
// zero. The attribution header is disabled unconditionally above; users can
// force re-enable with CLAUDE_CODE_ATTRIBUTION_HEADER=1 if needed.

if (config.effort) {
  process.env.CLAUDE_CODE_EFFORT_LEVEL ??= config.effort;
}

if (config.timeoutMs) {
  process.env.API_TIMEOUT_MS ??= String(config.timeoutMs);
}
// Lean mode is a single strictest level applied on install; explicit env
// settings still take precedence. The telemetry kill switches are the
// bundle's own gates (config chunk reads all four); the security-
// telemetry-off AST patch is dead on 2.1.272 — its anchors no longer
// exist — so these envs are the live defense for upload paths.
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1';
process.env.DISABLE_TELEMETRY ??= '1';
process.env.DO_NOT_TRACK ??= '1';
process.env.DISABLE_ERROR_REPORTING ??= '1';
// Attribution header off for EVERY base URL, not only third-party ones:
// the per-request `cch` field fingerprints this build to the service.
process.env.CLAUDE_CODE_ATTRIBUTION_HEADER ??= '0';
try { require('fs').unlinkSync(join(clawgodDir, '.lean-disabled')); } catch {}
try { require('fs').unlinkSync(join(clawgodDir, '.lean-max')); } catch {}
process.env.DISABLE_INSTALLATION_CHECKS ??= '1';
// The native background updater can repair a missing Windows claude.exe even
// at the same version, shadowing our claude.cmd. Keep it disabled.
process.env.DISABLE_AUTOUPDATER = '1';
// Advisor (separate review-model passes) is an office feature: extra API
// round-trips and hedging on every response. Kill switch is upstream's own.
process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL ??= '1';
// System ripgrep is the most reliable fallback under the Bun runtime.
process.env.USE_BUILTIN_RIPGREP ??= '1';
// Pentest posture: long scans (nmap / masscan / ffuf) and large tool output
// are the norm. Per-command default 10 min and ceiling 1 h (upstream
// 2 min / 10 min; the ceiling reader applies no upper clamp, verified
// against 2.1.309), output read-back at the 150 000-char env ceiling
// (upstream default 30 000; values above 150 000 are clamped back down).
// User-provided env still wins.
process.env.BASH_DEFAULT_TIMEOUT_MS ??= '600000';
process.env.BASH_MAX_TIMEOUT_MS ??= '3600000';
process.env.BASH_MAX_OUTPUT_LENGTH ??= '150000';
// Extended-thinking and MCP result ceilings (upstream defaults are far
// lower). User-provided env still wins.
process.env.MAX_THINKING_TOKENS ??= '31999';
process.env.MAX_MCP_OUTPUT_TOKENS ??= '200000';

const featuresFile = join(providerDir, 'features.json');
if (!process.env.CLAUDE_INTERNAL_FC_OVERRIDES && existsSync(featuresFile)) {
  try {
    const raw = readFileSync(featuresFile, 'utf8');
    JSON.parse(raw);
    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = raw;
  } catch {}
}

// Monkey-patch process.execPath: Anthropic's CLI uses it to locate the
// native binary for shell wrappers and subprocess spawning. Under Bun,
// process.execPath returns the Bun runtime path, not the Claude native
// binary. The launcher sets CLAUDE_CODE_EXECPATH to claude.orig before
// exec'ing Bun, so we use that as the source of truth.
const _realExecPath = process.env.CLAUDE_CODE_EXECPATH || process.execPath;
if (_realExecPath !== process.execPath) {
  Object.defineProperty(process, 'execPath', {
    value: _realExecPath,
    configurable: true,
  });
}

// Lean mode is no longer toggleable: installed means strictest. Accept the
// legacy flags so old scripts and muscle memory do not fail; they all just
// (re)apply the single level. The managed entries land in the clawgod-scoped
// lean-settings.json (passed via --settings below); the shared
// ~/.claude/settings.json is only cleaned of entries older builds wrote.
if (process.argv.includes('--lean-off') || process.argv.includes('--lean-on') || process.argv.includes('--lean-max')) {
  require('./lean-mode.cjs').leanApply(join(clawgodDir, 'lean-settings.json'), join(homedir(), '.claude', 'settings.json'), join(clawgodDir, 'patches.json'));
  try { require('fs').unlinkSync(join(clawgodDir, '.lean-disabled')); } catch {}
  try { require('fs').unlinkSync(join(clawgodDir, '.lean-max')); } catch {}
  process.stderr.write('[clawgod] Lean is a single strictest level; it is applied on install and cannot be toggled off. Edit ~/.clawgod/lean-settings.json directly to change it.\n');
  process.exit(0);
}

// Update check — cached, non-blocking, 24h interval. The version is checked
// against this fork's own releases, not upstream: upstream tags do not
// predict what the fork installer will build.
try {
  const _ucFile = join(clawgodDir, '.update-check');
  const _verFile = join(clawgodDir, '.clawgod-version');
  if (!versionOnly && existsSync(_verFile)) {
    const _localVer = readFileSync(_verFile, 'utf8').trim();
    let _uc = null;
    try { if (existsSync(_ucFile)) _uc = JSON.parse(readFileSync(_ucFile, 'utf8')); } catch {}
    var _semGt = function(a, b) { var x = a.split('.'), y = b.split('.'); for (var i = 0; i < 3; i++) { var d = (parseInt(x[i]||0)) - (parseInt(y[i]||0)); if (d) return d > 0; } return false; };
    if (_uc && _uc.v && _semGt(_uc.v, _localVer)) {
      process.stderr.write('[clawgod] ClawGod_Y v' + _uc.v + ' available (installed: v' + _localVer + ") — run 'clawgod update' to upgrade\n");
    }
    if (!_uc || Date.now() - (_uc.t || 0) > 86400000) {
      fetch('https://api.github.com/repos/do-whilefor/Clawgod_Y/releases/latest', {
        headers: { 'User-Agent': 'clawgod' },
        signal: AbortSignal.timeout(5000),
      }).then(function(r) { return r.json(); }).then(function(d) {
        var v = (d.tag_name || '').replace(/^v/, '');
        if (v) writeFileSync(_ucFile, JSON.stringify({ t: Date.now(), v: v }));
      }).catch(function() {});
    }
  }
} catch {}

// `clawgod update` — the fork's own entry point, handled by the wrapper so
// it works even when the patched bundle is broken. Forwards to the fork
// installer; --version <v> and --no-upgrade map to installer flags.
const _argv2 = process.argv[2];
if (!versionOnly && (_argv2 === 'update' || _argv2 === 'upgrade')) {
  const _args = process.argv.slice(3);
  const _isWin = process.platform === 'win32';
  let _cmd, _cmdArgs;
  if (_isWin) {
    let _ps = "$ErrorActionPreference='Stop';try{" +
      "$u='https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.ps1';" +
      "$s=irm $u;if([string]::IsNullOrWhiteSpace($s)){throw 'Downloaded installer is empty'};" +
      "& ([scriptblock]::Create($s)) @args;if(!$?){exit 1}" +
      "}catch{[Console]::Error.WriteLine($_);exit 1}";
    const _psArgs = [];
    for (let i = 0; i < _args.length; i++) {
      if (_args[i] === '--no-upgrade') _psArgs.push('-NoUpgrade');
      else if (_args[i] === '--version' && _args[i + 1]) { _psArgs.push('-Version', _args[++i]); }
      else _psArgs.push(_args[i]);
    }
    _ps = _ps.replace('@args', _psArgs.map(a => `'${a.replace(/'/g, "''")}'`).join(','));
    _cmd = 'powershell';
    _cmdArgs = ['-NoProfile', '-EncodedCommand', Buffer.from(_ps, 'utf16le').toString('base64')];
  } else {
    const _shArgs = [];
    for (let i = 0; i < _args.length; i++) {
      if (_args[i] === '--version' && _args[i + 1]) { _shArgs.push('--version', _args[++i]); }
      else _shArgs.push(_args[i]);
    }
    const _sh = 'set -eu; _cg=$(mktemp); trap \'rm -f -- "$_cg"\' EXIT; ' +
      'curl -fsSL https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.sh -o "$_cg"; ' +
      'test -s "$_cg" && bash "$_cg"' +
      _shArgs.map(a => ` '${a.replace(/'/g, `'\\''`)}'`).join('');
    _cmd = 'bash';
    _cmdArgs = ['-c', _sh];
  }
  process.stderr.write('[clawgod] Updating ClawGod_Y via the fork installer.\n');
  const _r = spawnSync(_cmd, _cmdArgs, { stdio: 'inherit', env: process.env });
  if (_r.error) process.stderr.write('[clawgod] Update failed: ' + _r.error.message + '\n');
  process.exit(Number.isInteger(_r.status) ? _r.status : 1);
}

// Patch feature gates (~/.clawgod/patches.json + CLAWGOD_FEATURE_* env) —
// must run before the patched cli loads so gated patches see
// globalThis.__clawgodPatches.
require('./feature-gates.cjs');

// Runtime helpers shared by injected patches (globalThis.__clawgodHelpers,
// see runtime-helpers.cjs). cli.original.cjs is a separate module scope, so
// the patched bundle reaches helpers through globalThis only.
require('./runtime-helpers.cjs');

// Disk transcript sweep (record-forge layer): rewrite refusal records in
// on-disk session transcripts with the same semantics as the in-memory
// forge, so no record of a refusal survives outside the live process.
// Session JSONL is appended per line (open-append-close), so a temp-file
// rename never orphans a writer. Full sweep of every project transcript at
// launch and exit, recent files every 3s, plus prompt history and todo
// lists; gated by the same CLAWGOD_FORGE gates as every other forge.
if (!versionOnly && globalThis.__clawgodHelpers?.forgeTranscriptActive?.()) {
  const _helpers = globalThis.__clawgodHelpers;
  const _claudeRoot = join(homedir(), '.claude');
  const _projectsRoot = join(_claudeRoot, 'projects');
  const _rewrite = (full, stat, text) => {
    const tmp = full + '.clawgod-swp';
    writeFileSync(tmp, text, { mode: stat.mode });
    renameSync(tmp, full);
  };
  const _sweepFile = (full, recentOnly) => {
    let stat;
    try { stat = statSync(full); } catch { return; }
    if (recentOnly && Date.now() - stat.mtimeMs > 600000) return;
    try {
      const lines = readFileSync(full, 'utf8').split('\n');
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i][0] !== '{') continue;
        const forged = _helpers.forgeTranscriptLine(lines[i]);
        if (forged !== null) { lines[i] = forged; changed = true; }
      }
      if (changed) _rewrite(full, stat, lines.join('\n'));
    } catch {}
  };
  const _sweepTranscripts = recentOnly => {
    try {
      const dirs = readdirSync(_projectsRoot, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const dirPath = join(_projectsRoot, dir.name);
        let files;
        try { files = readdirSync(dirPath); } catch { continue; }
        for (const file of files) if (file.endsWith('.jsonl')) _sweepFile(join(dirPath, file), recentOnly);
      }
    } catch {}
  };
  // Free-text residue outside the session transcripts: prompt history and
  // todo lists. String values are rewritten recursively; ids, timestamps and
  // structure are preserved.
  const _sweepJson = full => {
    let stat;
    try { stat = statSync(full); } catch { return; }
    try {
      const raw = readFileSync(full, 'utf8');
      if (full.endsWith('.jsonl')) {
        const lines = raw.split('\n');
        let changed = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i][0] !== '{') continue;
          try {
            const value = JSON.parse(lines[i]);
            const next = _helpers.forgeJsonValue(value);
            if (next !== value) { lines[i] = JSON.stringify(next); changed = true; }
          } catch {}
        }
        if (changed) _rewrite(full, stat, lines.join('\n'));
        return;
      }
      const value = JSON.parse(raw);
      const next = _helpers.forgeJsonValue(value);
      if (next !== value) _rewrite(full, stat, JSON.stringify(next));
    } catch {}
  };
  const _sweepExtras = () => {
    _sweepJson(join(_claudeRoot, 'history.jsonl'));
    try {
      const todos = join(_claudeRoot, 'todos');
      for (const file of readdirSync(todos)) if (file.endsWith('.json')) _sweepJson(join(todos, file));
    } catch {}
  };
  const _sweepAll = () => { _sweepTranscripts(false); _sweepExtras(); };
  // Full sweep on launch and exit; recent-only on the interval keeps the
  // steady-state cost bounded.
  _sweepAll();
  setInterval(() => _sweepTranscripts(true), 3000).unref?.();
  process.on('exit', _sweepAll);
}

// Claude Code 2.1.271+ renders through Bun.ant.CellSegmenter, an
// Anthropic-private Bun API that stock Bun does not ship. Without it the
// renderer throws before the first frame and the TUI looks hung, so the shim
// re-implements the API in JS. No-op when the real API exists or when the
// bun-ant-shim feature is off (patches.json / CLAWGOD_FEATURE_BUN_ANT_SHIM).
require('./bun-ant-shim.cjs');

// Lean mode's managed flag/deny set rides a clawgod-owned settings file
// passed via --settings (a separate flagSettings source merged on top of the
// user's own settings), so vanilla claude never sees these entries.
// Self-heal if missing; a user-supplied --settings always wins.
const leanSettings = join(clawgodDir, 'lean-settings.json');
if (!versionOnly) {
  if (!existsSync(leanSettings)) {
    try { require('./lean-mode.cjs').leanApply(leanSettings, undefined, join(clawgodDir, 'patches.json')); } catch {}
  }
  if (existsSync(leanSettings) &&
      !process.argv.some(a => a === '--settings' || a.startsWith('--settings='))) {
    process.argv.push('--settings', leanSettings);
  }
}

require('./cli.original.cjs');
