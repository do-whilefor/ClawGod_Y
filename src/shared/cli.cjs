#!/usr/bin/env bun
const { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { spawnSync } = require('child_process');

const clawgodDir = join(homedir(), '.clawgod');
if (process.argv.length === 3 && process.argv[2] === '--uninstall') {
  const windows = process.platform === 'win32';
  const installer = join(__dirname, windows ? 'install.ps1' : 'install.sh');
  if (!existsSync(installer)) {
    process.stderr.write('[clawgod] Local uninstaller is missing. Rerun the installer with its uninstall option.\n');
    process.exit(1);
  }
  const result = spawnSync(windows ? 'powershell' : 'bash', windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-Uninstall']
    : [installer, '--uninstall'], { stdio: 'inherit', env: process.env });
  if (result.error) process.stderr.write('[clawgod] Uninstall failed: ' + result.error.message + '\n');
  process.exit(Number.isInteger(result.status) ? result.status : 1);
}
if (['update', 'upgrade'].includes(process.argv[2])) {
  process.stderr.write('[clawgod] This command has been removed. Use --version to query the version or --uninstall to uninstall.\n');
  process.exit(2);
}
const versionOnly = process.argv.length === 3 && ['--version', '-v'].includes(process.argv[2]);

const probeTools = process.argv.length === 3 && process.argv[2] === '--probe-tools';

const nativeClaudeJson = join(homedir(), '.claude.json');
const strayClaudeJson = join(clawgodDir, '.claude.json');
if (!versionOnly && !probeTools && existsSync(strayClaudeJson) && !existsSync(nativeClaudeJson)) {
  try { renameSync(strayClaudeJson, nativeClaudeJson); } catch {}
}

const configFile = join(clawgodDir, 'provider.json');

const defaultConfig = {
  protocol: 'anthropic',
  apiKey: '',
  baseURL: 'https://api.anthropic.com',
  model: '',
  smallModel: '',
  effort: '',
  timeoutMs: 3000000,
};

let config = { ...defaultConfig };
if (!versionOnly && !probeTools && existsSync(configFile)) {
  try {
    const raw = JSON.parse(readFileSync(configFile, 'utf8'));
    config = { ...defaultConfig, ...raw, protocol: raw?.protocol };
  } catch {}
} else if (!versionOnly && !probeTools) {
  mkdirSync(clawgodDir, { recursive: true });
  writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2) + '\n');
}

const resolved = require('./runtime-helpers.cjs').resolveProviderConfig(config);
if (!probeTools && resolved.useProxy) {
  let _proxyKey = resolved.apiKey || '';
  if (!_proxyKey && resolved.type === 'grok') {
    try {
      const _gs = JSON.parse(readFileSync(join(homedir(), '.grok', 'user-settings.json'), 'utf8'));
      _proxyKey = _gs.apiKey || '';
    } catch {}
    if (!_proxyKey) _proxyKey = process.env.GROK_API_KEY || '';
  }
  if (resolved.baseURL === 'https://api.anthropic.com' || !resolved.baseURL) {
    if (resolved.type === 'grok') resolved.baseURL = 'https://api.x.ai/v1';
    else throw new Error('[clawgod] openai-chat requires an explicit baseURL, for example https://example.com/v1');
  }
  if (_proxyKey) {
    const { startProxy } = require('./openai-proxy.cjs');
    const _proxy = startProxy({
      apiKey: _proxyKey,
      baseURL: resolved.baseURL,
      model: resolved.model || '',
      effort: process.env.CLAUDE_CODE_EFFORT_LEVEL ?? resolved.effort,
      timeoutMs: process.env.API_TIMEOUT_MS ?? resolved.timeoutMs,
    });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + _proxy.port;
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-passthrough';
    if (resolved.model) process.env.ANTHROPIC_MODEL = resolved.model;
    if (resolved.smallModel) process.env.ANTHROPIC_SMALL_FAST_MODEL = resolved.smallModel;
    process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ??= '1';
    process.on('exit', function () { try { _proxy.stop(); } catch {} });
    process.stderr.write('[clawgod] OpenAI Chat Completions proxy on port ' + _proxy.port + '\n');
    resolved.apiKey = '';
    resolved.baseURL = '';
    resolved.model = '';
    resolved.smallModel = '';
  } else {
    throw new Error('[clawgod] openai-chat requires an API key (grok also accepts GROK_API_KEY or ~/.grok/user-settings.json)');
  }
}

if (!probeTools && resolved.apiKey) {
  if (resolved.baseURL) process.env.ANTHROPIC_BASE_URL = resolved.baseURL;
  if (resolved.model) process.env.ANTHROPIC_MODEL = resolved.model;
  if (resolved.smallModel) process.env.ANTHROPIC_SMALL_FAST_MODEL = resolved.smallModel;
  if (resolved.baseURL && !/anthropic\.com/i.test(resolved.baseURL)) {
    delete process.env.ANTHROPIC_API_KEY;
    const existingToken = (process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
    process.env.ANTHROPIC_AUTH_TOKEN = existingToken || resolved.apiKey;
  } else {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = resolved.apiKey;
  }
} else if (!probeTools && resolved.baseURL && resolved.baseURL !== 'https://api.anthropic.com') {
  process.env.ANTHROPIC_BASE_URL ??= resolved.baseURL;
}

if (!probeTools && resolved.effort) {
  process.env.CLAUDE_CODE_EFFORT_LEVEL ??= resolved.effort;
}

if (!probeTools && resolved.timeoutMs) {
  process.env.API_TIMEOUT_MS ??= String(resolved.timeoutMs);
}
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1';
process.env.DISABLE_TELEMETRY = '1';
process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS ??= '1';
process.env.DO_NOT_TRACK = '1';
process.env.DISABLE_ERROR_REPORTING = '1';
process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1';
process.env.CLAUDE_CODE_ATTRIBUTION_HEADER ??= '0';
try { unlinkSync(join(clawgodDir, '.lean-disabled')); } catch {}
try { unlinkSync(join(clawgodDir, '.lean-max')); } catch {}
process.env.DISABLE_INSTALLATION_CHECKS ??= '1';
process.env.DISABLE_AUTOUPDATER = '1';
process.env.DISABLE_UPDATES = '1';
process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL ??= '1';
process.env.USE_BUILTIN_RIPGREP ??= '1';
process.env.BASH_DEFAULT_TIMEOUT_MS ??= '600000';
process.env.BASH_MAX_TIMEOUT_MS ??= '3600000';
process.env.BASH_MAX_OUTPUT_LENGTH ??= '150000';
process.env.MAX_THINKING_TOKENS ??= '31999';
process.env.MAX_MCP_OUTPUT_TOKENS ??= '200000';

const featuresFile = join(clawgodDir, 'features.json');
if (!process.env.CLAUDE_INTERNAL_FC_OVERRIDES && existsSync(featuresFile)) {
  try {
    const raw = readFileSync(featuresFile, 'utf8');
    JSON.parse(raw);
    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = raw;
  } catch {}
}

const _realExecPath = process.env.CLAUDE_CODE_EXECPATH || process.execPath;
if (_realExecPath !== process.execPath) {
  Object.defineProperty(process, 'execPath', {
    value: _realExecPath,
    configurable: true,
  });
}

require('./feature-gates.cjs');

require('./bun-ant-shim.cjs');

const leanSettings = join(clawgodDir, 'lean-settings.json');
if (!versionOnly && !probeTools) {
  if (!existsSync(leanSettings)) {
    try { require('./lean-mode.cjs').leanApply(leanSettings, undefined, join(clawgodDir, 'patches.json')); } catch {}
  }
  if (existsSync(leanSettings) &&
      !process.argv.some(a => a === '--settings' || a.startsWith('--settings='))) {
    process.argv.push('--settings', leanSettings);
  }
}

const builtinPromptFile = join(__dirname, 'system-prompt.md');
if (!versionOnly && !probeTools) {
  let _customPrompt = '';
  try {
    _customPrompt = readFileSync(builtinPromptFile, 'utf8').trim();
    if (!_customPrompt) throw new Error('file is empty');
  } catch (error) {
    process.stderr.write('[clawgod] Cannot load required system-prompt.md: ' + error.message + '\n');
    process.exit(1);
  }
  let _identityMarkers;
  let _stripMemory;
  try {
    const _extra = JSON.parse(readFileSync(join(clawgodDir, 'assembly.json'), 'utf8'));
    if (Array.isArray(_extra?.identityMarkers)) _identityMarkers = _extra.identityMarkers;
    if (_extra && typeof _extra === 'object') _stripMemory = _extra.stripMemory;
  } catch {}
  globalThis.__clawgodAssembly = {
    customPrompt: _customPrompt,
    requireCustomPrompt: true,
    stripMemory: _stripMemory,
    identityMarkers: _identityMarkers,
  };
}

if (probeTools) {
  (async () => {
    try {
      const source = readFileSync(join(__dirname, 'cli.original.cjs'), 'utf8');
      const manifest = source.match(/^\/\/ clawgod:probe-modules (.+)$/m);
      const modules = manifest && JSON.parse(manifest[1]);
      if (!Array.isArray(modules) || !modules.length) throw new Error('probe module manifest missing; repatch this installation');
      for (const name of modules) require(join(__dirname, name));
      process.exit(await globalThis.__clawgodHelpers.probeToolTables());
    } catch (error) {
      process.stderr.write('[clawgod] probe-tools error: ' + error.message + '\n');
      process.exit(1);
    }
  })();
} else require('./cli.original.cjs');
