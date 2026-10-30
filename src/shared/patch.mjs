#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname, relative, resolve as resolvePath, sep } from 'path';
import { fileURLToPath } from 'url';
import { AST_PATCH_IDS, scanAstPatches, applyAstEdits, parsePatchSource, createPatchContext, hasPatchAnchors } from './ast-patches.mjs';
import { PENTEST_AST_PATCH_IDS, PENTEST_AST_META, PENTEST_REQUIRED, scanPentestPatches, pruneRuntimeGraph } from './pentest-patches.mjs';
import { FEATURES, featuresMeta } from './patch-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, 'cli.original.cjs');
const BACKUP = TARGET + '.bak';
const CLEAN_SOURCE = join(__dirname, 'source-backup.json');

const gate = (id) => `globalThis.__clawgodPatches?.[${JSON.stringify(id)}]!==!1`;

const upstreamPatches = [
  {
    id: 'terminal-reply-fragments',
    name: 'Preserve split terminal replies while a DA1 probe is pending',
    pattern: /(flushIncomplete=\(\)=>\{if\(this\.incompleteEscapeTimer=null,![\w$]+\(this\.keyReader\)\)return;if\(this\.props\.stdin\.readableLength>0\)\{this\.incompleteEscapeTimer=setTimeout\(this\.flushIncomplete,[\w$]+\);return\}let ([\w$]+)=performance\.now\(\);)(this\.applyKeysRead\([\w$]+\(this\.keyReader,\2\),\2\)\})/g,
    replacer: (m, prefix, now, suffix) => prefix +
      `const _clawgodReplyDelay=globalThis.__clawgodHelpers?.terminalReplyDelay?.(this.querier,this.keyReader,${now})??0;` +
      'if(_clawgodReplyDelay>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,_clawgodReplyDelay);return}' + suffix,
    optional: true,
  },
  {
    id: 'user-type-ant',
    name: 'USER_TYPE → ant',
    ast: true,
  },
  {
    id: 'bun-standalone-executable',
    name: 'Bun.isStandaloneExecutable → true',
    ast: true,
  },
  {
    id: 'growthbook-env-overrides',
    name: 'GrowthBook env overrides',
    coveredBy: ['growthbook-env-overrides-graph'],
    pattern: /function ([\w$]+)\(\)\{if\(!([\w$]+)\)\2=!0;return ([\w$]+)\}/g,
    replacer: (m, fn, flag, val) =>
      `function ${fn}(){if(!${flag}){${flag}=!0;try{let e=process.env.CLAUDE_INTERNAL_FC_OVERRIDES;if(e)${val}=JSON.parse(e)}catch(e){}}return ${val}}`,
    unique: true,
  },
  {
    id: 'growthbook-env-overrides-graph',
    name: 'GrowthBook env overrides (graph dead-code fix)',
    ast: true,
    optional: true,
  },
  {
    id: 'growthbook-config-overrides',
    name: 'GrowthBook config overrides',
    fallbackFor: ['growthbook-config-overrides-graph'],
    pattern: /function ([\w$]+)\(\)\{return\}(function)/g,
    replacer: (m, fn, next) =>
      `function ${fn}(){return null}${next}`,
    validate: (match, code, pos = code.indexOf(match)) => {
      const nearby = code.substring(Math.max(0, pos - 500), pos + 500);
      return nearby.includes('growthBook') || nearby.includes('GrowthBook') || nearby.includes('FeatureValue');
    },
  },
  {
    id: 'growthbook-config-overrides-graph',
    name: 'GrowthBook config overrides (class reader)',
    ast: true,
    optional: true,
  },
  {
    id: 'agent-teams',
    toggleable: true,
    name: 'Agent Teams always enabled',
    coveredBy: ['agent-teams-graph'],
    pattern: /function ([\w$]+)\(\)\{if\(![\w$]+\(process\.env\.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS\)&&![\w$]+\(\)\)return!1;if\(![\w$]+\("tengu_amber_flint",!0\)\)return!1;return!0\}/g,
    replacer: (m, fn) => `function ${fn}(){if(${gate('agent-teams')})return!0;` + m.slice(`function ${fn}(){`.length, -1) + `}`,
  },
  {
    id: 'agent-teams-graph',
    toggleable: true,
    name: 'Agent Teams always enabled (graph)',
    ast: true,
    optional: true,
  },
  {
    id: 'computer-use-sub',
    toggleable: true,
    name: 'Computer Use subscription bypass',
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\(\);return [\w$]+==="max"\|\|[\w$]+==="pro"\}/g,
    replacer: (m, fn) => `function ${fn}(){if(${gate('computer-use-sub')})return!0;` + m.slice(`function ${fn}(){`.length, -1) + `}`,
  },
  {
    id: 'computer-use-default',
    toggleable: true,
    name: 'Computer Use default enabled',
    ast: true,
  },
  {
    id: 'computer-use-gate-semantic',
    toggleable: true,
    name: 'Computer Use gate (resolved configuration contract)',
    ast: true,
    optional: true,
  },
  {
    id: 'ultraplan',
    toggleable: true,
    name: 'Ultraplan enable',
    ast: true,
  },
  {
    id: 'ultrareview-gate',
    toggleable: true,
    name: 'Ultrareview enable (rQt gate)',
    pattern: /function ([\w$]+)\(\)\{return ([\w$]+)\(\)\?\.enabled===!0&&[\w$]+\(\)&&![\w$]+\(\)\}/g,
    replacer: (m, fn) => `function ${fn}(){return ${gate('ultrareview-gate')}?!0:(${m.slice(`function ${fn}(){return `.length, -1)})}`,
    optional: true,
  },
  {
    id: 'ultrareview-command',
    toggleable: true,
    name: 'Ultrareview command (resolved availability callback)',
    ast: true,
    optional: true,
  },
  {
    id: 'ultrareview-direct',
    toggleable: true,
    name: 'Ultrareview enable (direct literal, <=2.1.213)',
    pattern: /function ([\w$]+)\(\)\{return ([\w$]+)\("tengu_review_bughunter_config",null\)(\?\.enabled===!0)?\}/g,
    replacer: (m, fn, getter, hasGate) =>
      hasGate
        ? `function ${fn}(){if(${gate('ultrareview-direct')})return!0;` + m.slice(`function ${fn}(){`.length, -1) + `}`
        : `function ${fn}(){let _r=${getter}("tengu_review_bughunter_config",null);return ${gate('ultrareview-direct')}?_r?{..._r,enabled:!0}:{enabled:!0}:_r}`,
    optional: true,
  },
  {
    id: 'computer-use-gate',
    toggleable: true,
    name: 'Computer Use gate bypass',
    pattern: /function ([\w$]+)\(\)\{return [\w$]+\(\)&&[\w$]+\(\)\.enabled\}/g,
    replacer: (m, fn) => `function ${fn}(){return ${gate('computer-use-gate')}?!0:(${m.slice(`function ${fn}(){return `.length, -1)})}`,
  },
  {
    id: 'voice-mode',
    toggleable: true,
    name: 'Voice Mode enable (bypass GrowthBook kill)',
    ast: true,
  },
  {
    id: 'classifier-timeout',
    toggleable: true,
    name: 'Auto-mode classifier timeout override (CLAWGOD_CLASSIFIER_TIMEOUT_MS)',
    pattern: /function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=Math\.max\(0,Math\.ceil\(\(\2-50000\)\/50000\)\);return Math\.min\(([\w$]+),([\w$]+)\+\3\*1e4\)\}/g,
    replacer: (m, fn, arg, step, cap, base) =>
      `function ${fn}(${arg}){let _ct=${gate('classifier-timeout')}?globalThis.__clawgodHelpers.classifierTimeoutFloor(process.env.CLAWGOD_CLASSIFIER_TIMEOUT_MS):null;let ${step}=Math.max(0,Math.ceil((${arg}-50000)/50000));let _r=Math.min(${cap},${base}+${step}*1e4);return _ct===null?_r:Math.max(_r,_ct)}`,
    unique: true,
    optional: true,
    fallbacks: [{
      pattern: /function\s+([\w$]+)\s*\(\s*([\w$]+)\s*\)\s*\{\s*(?:let|const|var)\s+([\w$]+)\s*=\s*Math\.max\(\s*0\s*,\s*Math\.ceil\(\s*\(\s*\2\s*-\s*(?:50000|50_000|5[eE]4)\s*\)\s*\/\s*(?:50000|50_000|5[eE]4)\s*\)\s*\)\s*;\s*return\s+Math\.min\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\+\s*\3\s*\*\s*(?:1[eE]4|10000|10_000)\s*\)\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },
  {
    id: 'classifier-model',
    toggleable: true,
    name: 'Auto-mode classifier model override (CLAWGOD_CLASSIFIER_MODEL)',
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(.*?\),[\w$]+=[\w$]+\([\w$]+\?\.modelByMainModel,\{vet:/g,
    replacer: (m, fn) =>
      `function ${fn}(){let _cm=process.env.CLAWGOD_CLASSIFIER_MODEL?.trim();if(_cm&&${gate('classifier-model')})return{value:_cm,src:"default"};` + m.slice(m.indexOf('{') + 1),
    unique: true,
    optional: true,
  },
  {
    id: 'classifier-retries',
    toggleable: true,
    name: 'Auto-mode classifier retries override (CLAWGOD_CLASSIFIER_RETRIES)',
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\([^)]*\)\?\.maxRetries;return typeof [\w$]+==="number"&&Number\.isInteger\([\w$]+\)&&[\w$]+>=0\?{value:[\w$]+,src:"gb"}:{value:([\w$]+),src:"default"\}\}/g,
    replacer: (m, fn) =>
      `function ${fn}(){let _cr=process.env.CLAWGOD_CLASSIFIER_RETRIES?.trim();if(${gate('classifier-retries')}&&_cr!==undefined&&_cr!==""&&Number.isInteger(+_cr)&&+_cr>=0)return{value:+_cr,src:"default"};` + m.slice(m.indexOf('{') + 1),
    unique: true,
    optional: true,
    fallbacks: [{
      pattern: /function\s+([\w$]+)\s*\(\s*\)\s*\{\s*(?:let|const|var)\s+([\w$]+)\s*=\s*[^;{}]{1,300}?\?\.maxRetries\s*;\s*return\s+typeof\s+\2\s*===?\s*["']number["']\s*&&\s*Number\.isInteger\(\s*\2\s*\)\s*&&\s*\2\s*>=\s*0\s*\?\s*\{\s*value\s*:\s*\2\s*,\s*src\s*:\s*["']gb["']\s*\}\s*:\s*\{\s*value\s*:\s*[\w$]+\s*,\s*src\s*:\s*["']default["']\s*\}\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },
  {
    id: 'auto-mode-helper-gate',
    toggleable: true,
    name: 'Auto-mode unlock for third-party API (provider helper gate)',
    pattern: /if\(!([\w$]+)\(([\w$]+)\)\)return!1;(?=(?:(?!function\s).){0,300}!=="firstParty")/g,
    replacer: (m) => `if(globalThis.__clawgodPatches?.[${JSON.stringify('auto-mode-helper-gate')}]===!1&&` + m.slice(3, -10) + `)return!1;`,
    optional: true,
  },
  {
    id: 'auto-mode-inline-gate',
    toggleable: true,
    name: 'Auto-mode unlock for third-party API (inline gate)',
    pattern: /if\((?:([\w$]+)!=="firstParty"&&(?:\1!=="anthropicAws"|![\w$]+\(\1\))[^;]*|[\w$]+\(\)&&\([\w$]+==="claude-opus-4-6"\|\|[\w$]+==="claude-sonnet-4-6"\|\|[\w$]+\.includes\("haiku"\)[^;]*?\))\)return!1;/g,
    replacer: (m) => `if(globalThis.__clawgodPatches?.[${JSON.stringify('auto-mode-inline-gate')}]===!1&&` + m.slice(3, -10) + `)return!1;`,
    sentinel: ['!=="firstParty"', '&&'],
  },

  {
    id: 'macos-cmdv-image-paste',
    name: 'macOS Cmd+V image paste fallback to clipboard read',
    pattern: /if\(([\w$]+)\.length===0&&([\w$]+)\.length>0\)([\w$]+)\("input_image_drag","read_failed"\),([\w$]+)\.push\(\.\.\.\2\)/g,
    replacer: (m, L, R, at, D) =>
      `if(${L}.length===0&&${R}.length>0){${at}("input_image_drag","read_failed");if(d&&${D}.length===0){m();return}${D}.push(...${R})}`,
    sentinel: ['input_image_drag', 'read_failed'],
    optional: true,
  },

  {
    id: 'restore-search-tools',
    name: 'Restore Glob/Grep tools (un-inline EMBEDDED_SEARCH_TOOLS)',
    pattern: /function ([\w$]+)\(\)\{if\(!([\w$]+)\("true"\)\)return!1;if\([\w$]+\(\)\)return!1;return process\.env\.CLAUDE_CODE_ENTRYPOINT!=="local-agent"\}/g,
    replacer: (m, fn, envCheck) =>
      `function ${fn}(){if(!${envCheck}(process.env.EMBEDDED_SEARCH_TOOLS))return!1;if(typeof globalThis.__dpBinOk>"u"){try{var _w=process.platform==="win32"?"where":"which";require("child_process").execFileSync(_w,["bfs"],{timeout:2e3});require("child_process").execFileSync(_w,["ugrep"],{timeout:2e3});globalThis.__dpBinOk=!0}catch{globalThis.__dpBinOk=!1}}if(!globalThis.__dpBinOk)return!1;return process.env.CLAUDE_CODE_ENTRYPOINT!=="local-agent"}`,
    sentinel: ['EMBEDDED_SEARCH_TOOLS', 'local-agent', 'CLAUDE_CODE_ENTRYPOINT'],
    optional: true,
    fallbacks: [{
      pattern: /function\s+([\w$]+)\s*\(\s*\)\s*\{\s*if\s*\(\s*!([\w$]+)\(\s*["']true["']\s*\)\s*\)\s*return\s*(?:!1|false)\s*;\s*if\s*\(\s*[\w$]+\(\s*\)\s*\)\s*return\s*(?:!1|false)\s*;\s*return\s+process\.env\.CLAUDE_CODE_ENTRYPOINT\s*!==\s*["']local-agent["']\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },

  {
    id: 'wiggly-dove',
    toggleable: true,
    name: 'Block wiggly-dove Git/environment collection',
    ast: true,
  },

  {
    id: 'geo-stego-date',
    toggleable: true,
    name: 'Neutralize geo-steganography in date string (qla)',
    ast: true,
  },
  {
    id: 'geo-detect-probe',
    toggleable: true,
    name: 'Neutralize geo-detection probe (rdp)',
    pattern: /function ([\w$]+)\(\)\{if\([\w$]+\(\)\)return null;let [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(\),[\w$]+=[\w$]+==="Asia\/Shanghai"\|\|[\w$]+==="Asia\/Urumqi"[\s\S]*?\}\}/g,
    replacer: (m) => {
      const fn = m.match(/^function ([\w$]+)/)[1];
      return `function ${fn}(){if(${gate('geo-detect-probe')})return null;` + m.slice(`function ${fn}(){`.length, -1) + `}`;
    },
    sentinel: ['Asia/Shanghai', 'Asia/Urumqi'],
  },
  {
    id: 'geo-apostrophe-stego',
    toggleable: true,
    name: 'Neutralize apostrophe steganography (odp)',
    pattern: new RegExp(
      'function ([\\w$]+)\\(([\\w$]+),([\\w$]+)\\)\\{' +
      'if\\(!\\2&&!\\3\\)return"\'";' +
      'if\\(\\2&&!\\3\\)return"(?:\\\\u2019|\\u2019)";' +
      'if\\(!\\2&&\\3\\)return"(?:\\\\u02[Bb][Cc]|\\u02BC)";' +
      'return"(?:\\\\u02[Bb]9|\\u02B9)"\\}',
      'g'
    ),
    replacer: (m) => {
      const [, fn, params] = m.match(/^function ([\w$]+)\(([^)]*)\)/);
      return `function ${fn}(${params}){if(${gate('geo-apostrophe-stego')})return"'";` + m.slice(m.indexOf('{') + 1, -1) + `}`;
    },
    optional: true,
  },

  {
    id: 'remove-cyber-risk',
    toggleable: true,
    name: 'Remove CYBER_RISK_INSTRUCTION (unconditional)',
    pattern: /([\w$]+)="(IMPORTANT: Assist with authorized security testing[^"]*)"/g,
    replacer: (m, varName) => `${varName}=""`,
    sentinel: ['Assist with authorized security testing', 'IMPORTANT'],
  },
  {
    id: 'remove-url-restriction',
    toggleable: true,
    name: 'Remove URL generation restriction',
    pattern: /(\n\$\{[\w$]+\})(\nIMPORTANT: You must NEVER generate or guess URLs[^.]*\. You may use URLs provided by the user in their messages or local files\.)/g,
    replacer: (m, prefix, sentence) => `\${${gate('remove-url-restriction')}?"":\`${prefix}\`+'${sentence.replace('\n', '\\n')}'}`,
    sentinel: ['NEVER generate or guess URLs', 'URLs provided by the user'],
  },
  {
    id: 'remove-cautious-actions',
    toggleable: true,
    name: 'Remove cautious actions section',
    pattern: /function ([\w$]+)\(([\w$]*)\)\{(?:if\([\s\S]{1,200}?\)return`# Executing actions with care\n\n[\s\S]*?`;)?return`# Executing actions with care\n\n[\s\S]*?`\}/g,
    replacer: (m, fn, arg) => `function ${fn}(${arg}){if(${gate('remove-cautious-actions')})return\`\`;` + m.slice(`function ${fn}(${arg}){`.length, -1) + `}`,
    sentinel: ['# Executing actions with care'],
  },
  {
    id: 'remove-not-logged-in',
    toggleable: true,
    name: 'Remove "Not logged in" notice',
    pattern: /"(Not logged in\. Run [\w ]+ to authenticate\.)"/g,
    replacer: (m, orig) => `(${gate('remove-not-logged-in')}?"":'${orig}')`,
    optional: true,
    fallbacks: ['"Not logged in. Run /login to authenticate."', "'Not logged in. Run /login to authenticate.'"].map(pattern => ({
      pattern,
      nodeType: 'Literal',
      replacer: () => `(${gate('remove-not-logged-in')}?"":'Not logged in. Run \\x2flogin to authenticate.')`,
    })),
  },

  {
    id: 'attachment-filter-bypass',
    toggleable: true,
    name: 'Attachment filter bypass',
    pattern: /([\w$]+)\(\)!=="ant"(&&[\w$]+\.has\([\w$]+\.attachment\.type\)|\)\{if\([\w$]+\.attachment\.type==="hook_additional_context")/g,
    replacer: (m) => m.replace(/([\w$]+)\(\)!=="ant"(&&|\))/, (cm, f, sep) =>
      sep === '&&'
        ? `(${gate('attachment-filter-bypass')}?!1:${f}()!=="ant")&&`
        : `(${gate('attachment-filter-bypass')}?!1:${f}()!=="ant"))`),
    optional: true,
  },
  {
    id: 'message-filter-legacy',
    toggleable: true,
    name: 'Message list filter bypass (legacy ternary)',
    pattern: /([\w$]+)\(\)!=="ant"\?([\w$]+)\(([\w$]+),([\w$]+)\(([\w$]+)\)\):([\w$]+)/g,
    replacer: m => m.replace(/^([\w$]+)\(\)!=="ant"\?/, (g, f) => `(${gate('message-filter-legacy')}?!1:${f}()!=="ant")?`),
    optional: true,
  },
  {
    id: 'message-filter-s8',
    toggleable: true,
    name: 'Message list filter bypass (s_8 form)',
    pattern: /if\(([\w$]+)\(\)==="ant"\)return ([\w$]+);let ([\w$]+)=([\w$]+) instanceof Set\?\4:(?:typeof \4==="function"\?\4\(\):)?([\w$]+)\(\4\);return ([\w$]+)\(\2,\3\)/g,
    replacer: m => m.replace(/if\(([\w$]+)\(\)==="ant"\)/, (g, f) => `if(${gate('message-filter-s8')}||${f}()==="ant")`),
    optional: true,
  },
  {
    id: 'shell-integration-orig',
    name: 'Shell integration → native execPath (multitool dispatch fix)',
    pattern: /([\w$]+\.join\([\w$]+\(\),[\w$]+\?)"claude\.exe":"claude"(\))/g,
    replacer: m => `/*clawgod:shell-integration-orig*/(process.env.CLAUDE_CODE_EXECPATH||${m})`,
    appliedSentinel: '/*clawgod:shell-integration-orig*/',
    validate: (match, code, pos) => {
      if (code.slice(Math.max(0, pos - 80), pos).endsWith('(process.env.CLAUDE_CODE_EXECPATH||')) return false;
      const nearby = code.slice(Math.max(0, pos - 500), pos + 1600);
      return nearby.includes('CLAUDE_CODE_EXECPATH') && nearby.includes('ARGV0=');
    },
    fallbacks: [{
      pattern: /[\w$]+(?:\.join)?\(\s*[\w$]+\(\s*\)\s*,\s*[\w$]+\s*\?\s*["']claude\.exe["']\s*:\s*["']claude["']\s*\)/g,
      nodeType: 'CallExpression',
    }],
    sentinel: ['claude.exe', '"claude"'],
    optional: true,
  },
  {
    id: 'remote-settings-off',
    toggleable: true,
    name: 'Ignore enterprise-managed remote settings',
    ast: true,
  },
  {
    id: 'tool-result-pairing-recovery',
    name: 'Recover orphaned tool results from message history',
    ast: true,
  },
];

const PENTEST_DROPPED_FEATURES = ['voice-mode'];
const PENTEST_DROPPED_IDS = new Set(
  Object.entries(FEATURES).filter(([fid]) => PENTEST_DROPPED_FEATURES.includes(fid))
    .flatMap(([, def]) => def.patchIds),
);
for (const fid of PENTEST_DROPPED_FEATURES) delete FEATURES[fid];
const patches = upstreamPatches
  .filter(p => !PENTEST_DROPPED_IDS.has(p.id))
  .concat(PENTEST_AST_PATCH_IDS.map(id => ({ id, name: PENTEST_AST_META[id], ast: true, optional: true })));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verify = args.includes('--verify');
const revert = args.includes('--revert');
const dumpFeatures = args.includes('--dump-features');
const captureCleanSource = args.includes('--capture-clean-source');
const promptRequired = existsSync(join(__dirname, 'system-prompt.md'));

if (dumpFeatures) {
  console.log(JSON.stringify(featuresMeta()));
  process.exit(0);
}

(function validateRegistry() {
  const errs = [];
  const byId = new Map();
  for (const p of patches) {
    if (!p.id) errs.push(`patch without id: ${p.name}`);
    else if (byId.has(p.id)) errs.push(`duplicate patch id: ${p.id}`);
    else byId.set(p.id, p);
  }
  for (const [fid, def] of Object.entries(FEATURES)) {
    for (const pid of def.patchIds) {
      const p = byId.get(pid);
      if (!p) { errs.push(`feature '${fid}' references unknown patch id '${pid}'`); continue; }
      if (!p.toggleable) errs.push(`feature '${fid}' references non-toggleable patch '${pid}'`);
    }
  }
  for (const p of patches) {
    const referenced = Object.values(FEATURES).some((f) => f.patchIds.includes(p.id));
    if (p.toggleable && !referenced) errs.push(`toggleable patch '${p.id}' is referenced by no feature`);
  }
  if (errs.length > 0) {
    console.error('❌ Feature registry invalid:');
    for (const e of errs) console.error('   -', e);
    process.exit(1);
  }
})();

const GRAPH_DIR = join(__dirname, 'bunfs');
const isGraph = existsSync(GRAPH_DIR);
const sourcePaths = new Set([TARGET]);
if (isGraph) {
  const pathMapFile = join(__dirname, 'pathmap.json');
  const pathMap = existsSync(pathMapFile) ? JSON.parse(readFileSync(pathMapFile, 'utf8')) : null;
  if (!pathMap || Object.values(pathMap).some(entry =>
    !entry || typeof entry.path !== 'string' || typeof entry.loader !== 'string')) {
    console.error('Embedded loader metadata is missing. Rerun the current installer to re-extract this Claude version.');
    process.exit(1);
  }
  for (const { path, loader } of Object.values(pathMap)) {
    if (['js', 'jsx', 'ts', 'tsx'].includes(loader) && path.startsWith('bunfs/')) {
      sourcePaths.add(join(__dirname, path));
    }
  }
}

if (revert && !existsSync(CLEAN_SOURCE)) {
  if (isGraph) {
    console.error('No complete clean-source backup. Reinstall the same Claude version to recover it.');
    process.exit(1);
  }
  if (!existsSync(BACKUP)) { console.error('❌ No backup found'); process.exit(1); }
  if (existsSync(join(__dirname, '.compiled-runtime'))) unlinkSync(join(__dirname, '.compiled-runtime'));
  copyFileSync(BACKUP, TARGET);
  console.log('✅ Reverted from backup');
  process.exit(0);
}

let files = {};
if (isGraph) {
  files[TARGET] = readFileSync(TARGET, 'utf8');
  for (const name of sourcePaths) {
    if (name !== TARGET && existsSync(name)) files[name] = readFileSync(name, 'utf8');
  }
} else {
  if (!existsSync(TARGET)) {
    console.error('❌ Target not found:', TARGET);
    process.exit(1);
  }
  files[TARGET] = readFileSync(TARGET, 'utf8');
}
const installedFiles = { ...files };
let originalFiles = null;

const version = (files[TARGET] || '').match(/Version:\s*([\d.]+)/)?.[1] || 'unknown';

if (captureCleanSource) {
  const snapshot = { format: 1, version, files: Object.fromEntries(
    Object.entries(files).map(([name, content]) => [relative(__dirname, name).replaceAll('\\', '/'), content]),
  ) };
  const temporary = `${CLEAN_SOURCE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, CLEAN_SOURCE);
  copyFileSync(TARGET, BACKUP);
  console.log(`Saved clean source: ${Object.keys(files).length} files (v${version})`);
  process.exit(0);
}

if (existsSync(CLEAN_SOURCE) && !verify) {
  try {
    const snapshot = JSON.parse(readFileSync(CLEAN_SOURCE, 'utf8'));
    const sourceFiles = Object.fromEntries(Object.entries(snapshot.files ?? {})
      .filter(([name]) => sourcePaths.has(join(__dirname, name))));
    const names = Object.keys(files).map(name => relative(__dirname, name).replaceAll('\\', '/')).sort();
    const snapshotNames = Object.keys(sourceFiles);
    if (snapshot.format !== 1 || snapshot.version !== version ||
        !snapshot.files || typeof snapshot.files !== 'object' ||
        !snapshotNames.includes('cli.original.cjs') ||
        !names.every(name => Object.hasOwn(sourceFiles, name)) ||
        !snapshotNames.every(name => typeof sourceFiles[name] === 'string')) {
      throw new Error('version or file set does not match the installed source');
    }
    files = Object.fromEntries(snapshotNames.map(name => [join(__dirname, name), sourceFiles[name]]));
    console.log(`Using clean source backup: ${snapshotNames.length} files (v${version})`);
  } catch (error) {
    console.error(`Invalid clean-source backup: ${error.message}. Reinstall Claude ${version} with the current installer.`);
    process.exit(1);
  }
}
if (revert) {
  if (existsSync(join(__dirname, '.compiled-runtime'))) unlinkSync(join(__dirname, '.compiled-runtime'));
  for (const [name, content] of Object.entries(files)) writeFileSync(name, content, 'utf8');
  console.log('Reverted all source files from clean backup');
  process.exit(0);
}

originalFiles = { ...files };

console.log(`\n${'═'.repeat(55)}`);
console.log(`  ClawGod (universal)`);
console.log(`  Target: cli.original.cjs (v${version}) ${isGraph ? `[graph: ${Object.keys(files).length} files]` : ''}`);
console.log(`  Mode: ${dryRun ? 'DRY RUN' : verify ? 'VERIFY' : 'APPLY'} (best-effort features, required bundled prompt)`);
console.log(`${'═'.repeat(55)}\n`);

function collectMatches(p) {
  const out = [];
  const rules = [p, ...(p.fallbacks ?? [])];
  for (const [fname, content] of Object.entries(files)) {
    const accepted = [];
    let nodes;
    const syntaxMatch = (match, type) => {
      if (!nodes) {
        nodes = new Map();
        const pending = [parsePatchSource(content)];
        while (pending.length) {
          const node = pending.pop();
          const at = nodes.get(node.start) ?? [];
          at.push(node);
          nodes.set(node.start, at);
          for (const value of Object.values(node)) {
            if (value?.type) pending.push(value);
            else if (Array.isArray(value)) for (const child of value) if (child?.type) pending.push(child);
          }
        }
      }
      const types = Array.isArray(type) ? type : [type];
      return nodes.get(match.index)?.some(node =>
        types.includes(node.type) && node.end === match.index + match[0].length);
    };
    for (const [index, rule] of rules.entries()) {
      let matches;
      if (typeof rule.pattern === 'string') {
        if (!rule.pattern) continue;
        matches = [];
        let start = content.indexOf(rule.pattern);
        while (start !== -1) {
          matches.push(Object.assign([rule.pattern], { index: start }));
          start = content.indexOf(rule.pattern, start + rule.pattern.length);
        }
      } else matches = content.matchAll(rule.pattern);
      for (const match of matches) {
        if (!match[0].length || index && accepted.some(other =>
          match.index < other.index + other[0].length && other.index < match.index + match[0].length)) continue;
        if (p.validate && !p.validate(match[0], content, match.index)) continue;
        if (index && (!rule.nodeType || !syntaxMatch(match, rule.nodeType))) continue;
        match.replacer = rule.replacer ?? p.replacer;
        match.strategy = index ? typeof rule.pattern === 'string' ? 'string-fallback' : 'regex-fallback' : 'regex';
        accepted.push(match);
      }
    }
    if (accepted.length) out.push({ file: fname, content, matches: accepted.sort((a, b) => a.index - b.index) });
  }
  return out;
}

let applied = 0, skipped = 0, failed = 0, unverified = 0;
const appliedIds = new Set();

const astMatches = new Map([...AST_PATCH_IDS, ...PENTEST_AST_PATCH_IDS].map(id => [id, []]));
const astPresent = new Set();
const astPatched = new Set();
const astSkipped = new Map();
const astEdits = new Map();
const promptFallbacks = [];
try {
  const contexts = new Map();
  let cachedBytes = 0;
  const readSource = name => {
    const cached = contexts.get(name);
    if (cached) {
      contexts.delete(name);
      contexts.set(name, cached);
      return cached;
    }
    const source = files[name];
    if (source === undefined) return;
    const record = { tree: parsePatchSource(source), bytes: source.length * 2 };
    contexts.set(name, record);
    cachedBytes += record.bytes;
    while (cachedBytes > 32 * 1024 * 1024 && contexts.size > 1) {
      const oldest = contexts.keys().next().value;
      cachedBytes -= contexts.get(oldest).bytes;
      contexts.delete(oldest);
    }
    return record;
  };
  const readContext = (name, record = readSource(name)) => {
    if (!record) return;
    return record.context ??= createPatchContext(record.tree, files[name], specifier => {
      if (typeof specifier !== 'string') return;
      const target = specifier.startsWith('file:') ? fileURLToPath(specifier) :
        resolvePath(dirname(name), specifier.replaceAll('\\', sep));
      return readContext(target);
    });
  };
  for (const [file, content] of Object.entries(files)) {
    let record;
    const readTree = () => (record ??= readSource(file)).tree;
    const result = scanAstPatches(content, readTree, () => readContext(file, record ??= readSource(file)));
    for (const id of AST_PATCH_IDS) {
      if (result[id].present) astPresent.add(id);
      if (result[id].patched) astPatched.add(id);
      if (result[id].skipped) astSkipped.set(id, (astSkipped.get(id) ?? 0) + result[id].skipped);
      if (result[id].matches.length) astMatches.get(id).push({ file, content, matches: result[id].matches });
    }
    const upstreamRanges = [];
    for (const id of AST_PATCH_IDS) {
      for (const m of result[id].matches) upstreamRanges.push([m.start, m.end]);
      upstreamRanges.push(...result[id].protected);
    }
    const pentest = scanPentestPatches(content, upstreamRanges, readTree);
    for (const id of PENTEST_AST_PATCH_IDS) {
      if (pentest[id].present) astPresent.add(id);
      if (pentest[id].patched) astPatched.add(id);
      if (pentest[id].skipped) astSkipped.set(id, (astSkipped.get(id) ?? 0) + pentest[id].skipped);
      if (pentest[id].matches.length) astMatches.get(id).push({ file, content, matches: pentest[id].matches });
      if (id === 'pentest-prompt-assembly' && pentest[id].fallbackMatches.length) {
        promptFallbacks.push({ file, content, matches: pentest[id].fallbackMatches });
      }
    }
  }
  if (!astMatches.get('pentest-prompt-assembly').length && !astPatched.has('pentest-prompt-assembly') && promptFallbacks.length) {
    astMatches.set('pentest-prompt-assembly', promptFallbacks);
    astPresent.add('pentest-prompt-assembly');
  }
} catch (error) {
  console.error(`AST scan failed: ${error.message}. Source files were not changed.`);
  process.exit(1);
}

let astFlushed = false;
for (const p of [...patches.filter(p => p.ast), ...patches.filter(p => !p.ast)]) {
  if (!p.ast && !astFlushed) {
    try {
      for (const [file, edits] of astEdits) {
        files[file] = applyAstEdits(files[file], edits);
        parsePatchSource(files[file]);
      }
    } catch (error) {
      console.error(`AST rewrite failed: ${error.message}. Source files were not changed.`);
      process.exit(1);
    }
    astFlushed = true;
  }
  const preferredRule = p.fallbackFor?.find(id => appliedIds.has(id));
  if (preferredRule) {
    console.log(`  ⏭  ${p.name} (covered by applied rule: ${preferredRule})`);
    skipped++;
    continue;
  }
  const fileMatches = p.ast ? astMatches.get(p.id) : collectMatches(p);

  let fileChangedCount = 0;
  const strategies = new Map();
  const relevantFiles = fileMatches.filter((fm) => fm.matches.length > 0);

  let totalMatches = 0;
  for (const fm of fileMatches) totalMatches += fm.matches.length;

  if (relevantFiles.length === 0) {
    if (p.appliedSentinel && Object.values(files).some(content => content.includes(p.appliedSentinel))) {
      console.log(`  ✅ ${p.name} (already applied, patch marker present)`);
      applied++;
      appliedIds.add(p.id);
      continue;
    }
    if (p.ast && astPatched.has(p.id) && !astPresent.has(p.id)) {
      console.log(`  ✅ ${p.name} (already applied, AST gate present)`);
      applied++;
      appliedIds.add(p.id);
      continue;
    }
    if (promptRequired && PENTEST_REQUIRED.has(p.id)) {
      console.log(`  ❌ ${p.name} (required prompt injection hook did not match — Claude Code changed)`);
      failed++;
      continue;
    }
    const coveringRule = p.coveredBy?.find(id => appliedIds.has(id));
    if (coveringRule) {
      console.log(`  ⏭  ${p.name} (covered by applied rule: ${coveringRule})`);
      skipped++;
      continue;
    }
    const sentinels = p.ast ? [p.id] :
      (Array.isArray(p.sentinel) ? p.sentinel : [p.sentinel])
        .filter(s => typeof s === 'string' && s.length > 0);
    const anchorPresent = p.ast ? astPresent.has(p.id) :
      sentinels.length > 0 && Object.values(files).some(content => hasPatchAnchors(content, [sentinels]));
    if (p.optional && !anchorPresent) {
      console.log(`  ⏭  ${p.name} (not present in this version)`);
      skipped++;
      continue;
    }
    if (p.sentinel !== undefined || (p.ast && anchorPresent)) {
      if (anchorPresent) {
        const detail = sentinels.map((s) => JSON.stringify(s)).join(', ');
        console.log(`  ⚠️  ${p.name} — ${p.ast ? 'AST matcher' : 'regex'} stale, sentinel still in source: ${detail} (skipped, upstream behavior kept)`);
        skipped++;
        unverified++;
        continue;
      }
      console.log(`  ⏭  ${p.name} (no matching anchor; application cannot be verified)`);
      skipped++;
      continue;
    }
    console.log(`  ⚠️  ${p.name} (0 matches, no sentinel — cannot verify)`);
    skipped++;
    unverified++;
    continue;
  }

  if (verify) {
    console.log(`  ⬚  ${p.name} — ${totalMatches} match(es), not yet applied`);
    skipped++;
    continue;
  }

  const uniqueLimit = p.unique ? 1 : Infinity;
  let appliedFiles = 0;
  for (const fm of relevantFiles) {
    if (appliedFiles >= uniqueLimit) break;
    let changed = false;
    let count = 0;
    const replacements = [];
    for (const m of fm.matches) {
      const original = p.ast ? fm.content.slice(m.start, m.end) : m[0];
      const replacement = p.ast ? m.replacement : m.replacer(m[0], ...m.slice(1));
      if (replacement !== original) {
        if (p.ast) {
          if (!astEdits.has(fm.file)) astEdits.set(fm.file, []);
          astEdits.get(fm.file).push(m);
        } else {
          replacements.push({ start: m.index, end: m.index + m[0].length, replacement });
        }
        changed = true;
        count++;
        if (m.strategy && m.strategy !== 'ast' && m.strategy !== 'regex') {
          strategies.set(m.strategy, (strategies.get(m.strategy) ?? 0) + 1);
        }
      }
    }
    if (replacements.length) files[fm.file] = applyAstEdits(fm.content, replacements);
    if (changed) appliedFiles++;
    fileChangedCount += count;
  }

  if (fileChangedCount > 0) {
    const skippedNote = astSkipped.get(p.id) ? `, ${astSkipped.get(p.id)} site(s) left unpatched` : '';
    console.log(`  ✅ ${p.name} (${fileChangedCount} replacement${fileChangedCount > 1 ? 's' : ''} in ${appliedFiles} file${appliedFiles > 1 ? 's' : ''}${skippedNote})`);
    if (strategies.size) console.log(`     Fallbacks: ${[...strategies].map(([kind, count]) => `${count} ${kind}`).join(', ')}`);
    if (strategies.has('runtime-hook')) {
      console.warn('     Runtime fallback installed; boolean result and activation are checked at call time, not verified during patching.');
      unverified++;
    }
    if (astSkipped.get(p.id)) {
      console.warn(`  ⚠️  ${p.id}: ${astSkipped.get(p.id)} site(s) NOT patched — coverage is partial`);
      if (promptRequired && PENTEST_REQUIRED.has(p.id)) failed++;
      else unverified++;
    }
    applied++;
    appliedIds.add(p.id);
  } else if (relevantFiles.length > 0) {
    console.log(`  ⏭  ${p.name} (no change needed)`);
    skipped++;
  }
}

console.log(`\n${'─'.repeat(55)}`);
console.log(`  Result: ${applied} applied, ${skipped} skipped, ${failed} failed`);
if (unverified > 0 && failed === 0) {
  console.log(`  ⚠️  Patching completed; ${unverified} feature patch(es) have unverified or partial coverage. Unmatched sites keep upstream behavior.`);
}

if (failed > 0) {
  console.error('Patching failed; source files were not changed.');
  process.exit(1);
}

if (!dryRun && !verify && applied > 0) {
  try {
    const pruned = pruneRuntimeGraph(files, originalFiles);
    for (const [name, content] of Object.entries(pruned)) {
      if (content !== files[name]) parsePatchSource(content);
    }
    const removedCount = Object.keys(files).length - Object.keys(pruned).length;
    files = pruned;
    if (removedCount > 0) {
      console.log(`  ✂️  Pruned: ${removedCount} unreachable chunk(s) (deleted after all sources are written)`);
    }
  } catch (error) {
    console.error(`Pentest prune failed: ${error.message}. Source files were not changed.`);
    process.exit(1);
  }
}

if (promptRequired && !dryRun && !verify) {
  const hasHook = Object.values(files).some(content => content.includes('rewritePromptAssembly') &&
    scanPentestPatches(content)['pentest-prompt-assembly'].patched);
  if (!hasHook) {
    console.error('Required system-prompt.md injection hook is missing after rewriting; source files were not changed.');
    process.exit(1);
  }
}

if (!dryRun && !verify && applied > 0) {
  const probeModules = Object.entries(files)
    .filter(([, content]) => content.includes('/*clawgod:runtime-table-probe*/'))
    .map(([name]) => relative(__dirname, name).replaceAll('\\', '/')).sort();
  files[TARGET] = files[TARGET].replace(/^\/\/ clawgod:probe-modules .+\r?\n/gm, '');
  if (probeModules.length) files[TARGET] = `// clawgod:probe-modules ${JSON.stringify(probeModules)}\n${files[TARGET]}`;
  parsePatchSource(files[TARGET]);
  if (!existsSync(BACKUP)) {
    copyFileSync(TARGET, BACKUP);
    console.log(`  📦 Backup: ${BACKUP}`);
  }
  const staged = [];
  try {
    if (existsSync(join(__dirname, '.compiled-runtime'))) unlinkSync(join(__dirname, '.compiled-runtime'));
    for (const [fname, content] of Object.entries(files)) {
      if (content === installedFiles[fname]) continue;
      const tmp = `${fname}.clawgod-${process.pid}.tmp`;
      writeFileSync(tmp, content, 'utf8');
      staged.push([tmp, fname]);
    }
    for (const [tmp, fname] of staged) renameSync(tmp, fname);
  } catch (error) {
    for (const [tmp] of staged) { try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} }
    console.error(`Writing patched sources failed: ${error.message}. On-disk sources were left untouched.`);
    process.exit(1);
  }
  const stale = existsSync(GRAPH_DIR)
    ? readdirSync(GRAPH_DIR).filter(f => sourcePaths.has(join(GRAPH_DIR, f)))
    : [];
  for (const f of stale) {
    const full = join(GRAPH_DIR, f);
    if (!Object.hasOwn(files, full) && resolvePath(full).startsWith(resolvePath(GRAPH_DIR) + sep)) {
      try { unlinkSync(full); } catch {}
    }
  }
  console.log(`  📝 Written: ${staged.length} file(s), ${Object.keys(files).length - staged.length} unchanged ${isGraph ? '(graph)' : ''}`);
}

console.log(`${'═'.repeat(55)}\n`);
