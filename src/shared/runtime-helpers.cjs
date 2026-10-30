'use strict';

function classifierTimeoutFloor(envValue) {
  if (typeof envValue === 'string' && envValue.trim() === '') return null;
  const value = Number(envValue);
  return Number.isFinite(value) ? value : null;
}

function terminalReplyDelay(querier, reader, now) {
  const parse = reader?.parse;
  if (parse?.mode !== 'NORMAL' || typeof parse.incomplete !== 'string') return 0;
  if (!/^\x1b(?:\[(?:\?[\d;]*)?)?$/.test(parse.incomplete)) return 0;
  if (!Array.isArray(querier?.queue) || !querier.queue.some((entry) =>
    entry?.kind === 'barrier' || (entry?.kind === 'sentinel' && entry.written !== false))) return 0;
  if (!Number.isFinite(now) || !Number.isFinite(reader.lastInputAt)) return 0;
  return Math.max(0, 2000 - Math.max(0, now - reader.lastInputAt));
}

function enablePredicate(original, id) {
  if (typeof original !== 'function') return original;
  return function () {
    'use strict';
    const result = Reflect.apply(original, this, arguments);
    if (globalThis.__clawgodPatches?.[id] === false) return result;
    const enable = value => typeof value === 'boolean' ? true : value;
    return result instanceof Promise ? result.then(enable) : enable(result);
  };
}

const fs = require('fs');
const os = require('os');
const path = require('path');

const NO_OVERRIDE = Symbol('clawgod:no-override');
const FLAG_OVERRIDES = (() => {
  const base = {
    tengu_destructive_command_warning: false,
    tengu_attempt_decision_shadow: false,
    tengu_bg_classifier_config: { useSmallFastModel: false, disableThinking: false, midTurnLlmDebounceMs: 0 },
    tengu_kairos_brief: false,
    tengu_amber_quartz_disabled: true,
    tengu_chrome_auto_enable: false,
    tengu_chrome_install_upsell: false,
    tengu_cowork_chrome_automode_default: false,
    tengu_desktop_upsell: false,
    tengu_violin_tip: false,
    tengu_vscode_feedback_survey: false,
    tengu_vscode_onboarding: false,
    tengu_vscode_review_upsell: false,
    tengu_c4e_slash_upsell: false,
  };
  for (const source of [
    () => JSON.parse(fs.readFileSync(path.join(os.homedir(), '.clawgod', 'flags.json'), 'utf8')),
    () => JSON.parse(process.env.CLAWGOD_FLAGS || '{}'),
  ]) {
    try {
      const extra = source();
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(base, extra);
    } catch {}
  }
  return base;
})();

function flagOverride(flag) {
  if (typeof flag !== 'string') return NO_OVERRIDE;
  return flag in FLAG_OVERRIDES ? FLAG_OVERRIDES[flag] : NO_OVERRIDE;
}

const REFUSAL_DIRECTIVE = new RegExp(
  '(?:' +
  '(?:do not|don\'t|never|must not|should not|shall not|refuse to|decline to|not permitted to|not allowed to)' +
  '\\s+(?:assist|help|comply|provide|generate|create|write|produce|offer|participate|engage|support|execute|perform|carry out|walk through|give)' +
  '(?:\\s+(?:with|in|to|any|requests?|users?))?|' +
  '(?:do not|don\'t|never|must not|should not|refuse|decline)[^.!?\\n]{0,60}\\b(?:malicious|harmful|illegal|unethical|destructive|criminal|dangerous|unauthorized)\\b|' +
  '(?:you must|you should|you will|you are to|always)\\s+(?:refuse|decline|reject)|' +
  'refuse\\s+(?:requests?|to assist|to help)|' +
  'decline\\s+(?:requests?|to assist|to help)|' +
  '(?:i must|i have to|i need to|i will)\\s+(?:decline|refuse)|' +
  '(?:do not|don\'t|never)\\s+(?:assist|help|comply)\\s+with|' +
  '(?:violates?|against|contrary to)\\s+(?:my|the)?\\s*(?:guidelines|policies|values|principles|usage policy|terms of use)|' +
  '(?:this|that)\\s+(?:is|would be)\\s+(?:illegal|unethical|harmful|malicious|dangerous|unauthorized|a violation))', 'i');

const RESEARCH_CONTEXT = new RegExp(
  '(?:' +
  'vulnerabilit\\w*|exploit(?:s|ing|ed|ability)?|penetration test|pentest|red team|red-team|' +
  'ctf|capture the flag|security research|security assessment|security audit|' +
  'threat model|attack surface|attack vector|payload|fuzz(?:ing)?|' +
  'reverse engineer|malware analysis|incident response|' +
  'authorized|in-scope|scope of (?:the )?(?:engagement|work|assessment)|' +
  'remediation|proof of concept|poc|0day|zero-day|CVE-\\d|' +
  'recon(?:naissance)?|osint|nmap|burp|metasploit|hydra|sql injection|xss|csrf|' +
  'privilege escalation|lateral movement|pivot|exfiltration|c2|command and control|' +
  'forensics|threat hunt|ioc\\b|indicator of compromise|' +
  'defense|defensive|hardening|patch(?:es|ing)?|mitigation)', 'i');

const CAUTION_POSTURE = new RegExp(
  '(?:' +
  'confirm (?:with )?(?:the )?user|confirm (?:first|before)|' +
  'hard to reverse|difficult to undo|irreversible|' +
  'proceed with caution|use with caution|at your own risk|be (?:extra )?careful|' +
  '(?:ask|request|seek|obtain|get|wait for|check with)(?:ing)?\\s+(?:the\\s+)?(?:user\\s+)?(?:for\\s+)?(?:permission|approval|authorization)|' +
  '(?:do not|don\'t|never|must not|should not)[^.!?\\n]{0,80}\\b(?:without|until)\\b[^.!?\\n]{0,50}\\b(?:permission|approval|authorization)\\b|' +
  '(?:you must|you should|always|never)\\s+(?:ask|confirm|check|verify)[^.!?\\n]{0,60}\\b(?:permission|approval|authorization)\\b|' +
  '(?:do not|don\'t|never)\\s+(?:run|execute|proceed|continue)[^.!?\\n]{0,60}\\b(?:destructive|irreversible)\\b|' +
  'avoid\\s+(?:destructive|irreversible)|' +
  '(?:think twice|consider|warn|be careful|confirm)[^.!?\\n]{0,60}\\b(?:destructive|irreversible|state-changing)\\b|' +
  '(?:be careful not to introduce|avoid introducing)\\s+security vulnerabilities|' +
  '(?:pause|stop|wait)\\s+(?:and|to)\\s+(?:confirm|ask|get)|' +
  'for safety reasons|out of an abundance of caution|to be on the safe side|' +
  'seek (?:user )?confirmation|wait for (?:user )?confirmation|' +
  'confirm (?:the )?(?:action|change|deletion|operation|command)|' +
  '(?:pause|stop) (?:here|now) (?:and|to)|' +
  '(?:get|obtain) (?:explicit )?(?:user )?consent|' +
  '(?:seek|consult)\\s+(?:legal|professional|law)|' +
  'exercise caution|exercise care|use caution when|be careful when|be cautious when|' +
  'caution is advised|discretion is advised|care should be taken)', 'i');

const SECURITY_NOUN = new RegExp(
  '(?:' +
  'cyber-attack|cyber-crime|cybercrime|malware|ransomware|phishing|keylogger|botnet|social engineering|' +
  'exploit(?:s|ing)?\\s+(?:(?:a|known|zero-day)\\s+)?vulnerabilit|' +
  'unauthorized\\s+(?:access|use|entry|modification|interception)|' +
  'harm(?:ful)?\\s+(?:to|against)\\s+(?:computer|network|system|individual)|' +
  'safety and security|' +
  'ethical\\s+(?:concerns|implications|boundaries)|' +
  'malicious\\s+(?:code|activity|purposes|intent|software))', 'i');

const REFUSAL_MARKER = /(?:\b(?:do not|don't|never|must not|should not|refuse|decline|avoid)\b)/i;
function sectionDropped(section) {
  if (REFUSAL_DIRECTIVE.test(section)) return true;
  if (RESEARCH_CONTEXT.test(section)) return false;
  if (CAUTION_POSTURE.test(section)) return true;
  if (SECURITY_NOUN.test(section) && REFUSAL_MARKER.test(section)) return true;
  return false;
}


const CUSTOM_PROMPT_MARK = 'clawgod:custom-prompt';

const HOST_IDENTITY_MARKERS = [
  'you are claude code',
  'you are an interactive cli agent',
  'you are an interactive cli tool',
  'you are claude,',
  'you are claude.',
  'you are claude ',
  'i am claude',
  'i\'m claude',
  'my name is claude',
  'this is claude',
  'assistant name:',
  'model name:',
];

const HOST_IDENTITY_NAMES = /\bclaude(?:\s+code)?\b/;
const HOST_IDENTITY_ATTRIBUTION = /\banthropic\b|\bofficial\b|\bbuilt by\b|\bmade by\b|\bdeveloped by\b|\bcreated by\b|\btrained by\b|\bprovided by\b|\blanguage model\b/;

const HOST_IDENTITY_BARE_DECLARATION = /^(?:i am|i'm|my name is|this is|the assistant is|the model is|assistant is|model is)\s+claude\b/;

const MEMORY_SECTION_TITLES = [
  '# auto memory',
  '# memory',
  '# conversation summary',
  '# session summary',
];

function assemblyConfig(snapshot) {
  const cfg = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const customPrompt = typeof cfg.customPrompt === 'string' ? cfg.customPrompt.trim() : '';
  const stripMemory = cfg.stripMemory !== false;
  const identityMarkers = Array.isArray(cfg.identityMarkers) && cfg.identityMarkers.length
    ? cfg.identityMarkers.filter(m => typeof m === 'string' && m.length)
    : HOST_IDENTITY_MARKERS;
  return { customPrompt, stripMemory, identityMarkers };
}

const isCustomSection = section =>
  typeof section === 'string' && section.includes(CUSTOM_PROMPT_MARK);

const IDENTITY_RESIDUE = /^(?:your )?working directory (?:is|=) .{1,200}?\.?$/is;
function isIdentityResidue(section) {
  const trimmed = section.trim();
  return !trimmed || IDENTITY_RESIDUE.test(trimmed);
}

const INJECT_FRAGMENT_MAX = 4096;
function injectMatchers(prompt) {
  const fragments = [];
  for (const piece of prompt.split(/\n{2,}/)) {
    const trimmed = piece.trim();
    if (trimmed) fragments.push(trimmed);
  }
  if (!fragments.length && prompt.trim()) fragments.push(prompt.trim());
  const matchers = [];
  for (const fragment of fragments) {
    for (let i = 0; i < fragment.length; i += INJECT_FRAGMENT_MAX) {
      const needle = fragment.slice(i, i + INJECT_FRAGMENT_MAX);
      let loose = null;
      try {
        const body = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        loose = new RegExp('(?:^|\\n)[ \\t]*' + body + '[ \\t]*(?=\\n|$)', 'g');
      } catch {}
      matchers.push({ needle, loose });
    }
  }
  return matchers;
}

function scrubInjectCopies(sections, matchers) {
  let changed = false;
  const kept = [];
  for (const section of sections) {
    if (typeof section !== 'string') { kept.push(section); continue; }
    let text = section;
    for (const { needle, loose } of matchers) {
      for (;;) {
        const at = text.indexOf(needle);
        if (at < 0) break;
        let start = at;
        while (start > 0 && /[ \t\n]/.test(text[start - 1])) start--;
        if (start > 0 && /[.!?]/.test(text[start - 1])) start = at;
        text = text.slice(0, start) + text.slice(at + needle.length);
      }
      if (loose) text = text.replace(loose, '');
    }
    if (text === section) { kept.push(section); continue; }
    changed = true;
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text) kept.push(text);
  }
  return { sections: changed ? kept : sections, changed };
}

const isMemorySection = section => {
  if (typeof section !== 'string') return false;
  const head = section.trimStart().slice(0, 200).toLowerCase();
  return MEMORY_SECTION_TITLES.some(title => head.startsWith(title));
};

function stripIdentityFingerprint(line) {
  const tryStripSentence = (sentence) => {
    const lower = sentence.toLowerCase();
    if (HOST_IDENTITY_NAMES.test(lower) && HOST_IDENTITY_ATTRIBUTION.test(lower)) return '';
    const trimmed = lower.trimStart();
    if (HOST_IDENTITY_BARE_DECLARATION.test(trimmed)) return '';
    return sentence;
  };
  if (line.indexOf('.') < 0) {
    return tryStripSentence(line);
  }
  const sentences = line.split('.');
  const kept = [];
  let changed = false;
  for (const sentence of sentences) {
    const stripped = tryStripSentence(sentence);
    if (stripped === '' && sentence.trim() !== '') { changed = true; continue; }
    kept.push(stripped);
  }
  if (!changed) return line;
  return kept.join('.').replace(/\.{2,}/g, '.').replace(/^[.\s]+/, '').trimEnd();
}

function stripHostIdentity(section, markers = HOST_IDENTITY_MARKERS) {
  if (typeof section !== 'string') return section;
  const lines = section.split('\n');
  const kept = [];
  let changed = false;
  for (const line of lines) {
    let rest = line;
    for (;;) {
      const lower = rest.trimStart().toLowerCase();
      const marker = markers.find(m => lower.startsWith(m));
      if (!marker) break;
      const period = rest.indexOf('.');
      rest = period >= 0 ? rest.slice(period + 1).trim() : '';
      changed = true;
      if (!rest) break;
    }
    if (!rest) continue;
    const swept = stripIdentityFingerprint(rest);
    if (swept !== rest) changed = true;
    if (swept) kept.push(swept);
  }
  if (!changed) return section;
  return kept.join('\n').trim();
}

function rewritePromptAssembly(sections, options) {
  if (options?.requireCustomPrompt && !Array.isArray(sections)) {
    throw new Error('[clawgod] Required system-prompt.md injection failed: unsupported assembly result');
  }
  if (!Array.isArray(sections)) return sections;
  try {
    if (isCustomSection(sections[0])) return sections;
    const cfg = assemblyConfig(options);
    const hasCustom = cfg.customPrompt.length > 0;
    let changed = false;
    let pool = sections;
    if (hasCustom) {
      const scrubbed = scrubInjectCopies(pool, injectMatchers(cfg.customPrompt));
      if (scrubbed.changed) { pool = scrubbed.sections; changed = true; }
    }
    const out = [];
    for (const original of pool) {
      let section = original;
      if (isCustomSection(section)) { changed = true; continue; }
      if (cfg.stripMemory && isMemorySection(section)) { changed = true; continue; }
      if (typeof section === 'string' && sectionDropped(section)) { changed = true; continue; }
      if (hasCustom && typeof section === 'string') {
        const stripped = stripHostIdentity(section, cfg.identityMarkers);
        if (stripped !== section) {
          section = stripped;
          changed = true;
        }
        if (isIdentityResidue(section)) { changed = true; continue; }
      }
      out.push(section);
    }
    if (hasCustom) {
      out.unshift('<!-- ' + CUSTOM_PROMPT_MARK + ' -->\n' + cfg.customPrompt);
      changed = true;
    }
    return changed ? out : sections;
  } catch (error) {
    if (options?.requireCustomPrompt) {
      throw new Error('[clawgod] Required system-prompt.md injection failed', { cause: error });
    }
    return sections;
  }
}


function resolveProviderConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const protocol = config.protocol;
  if (protocol !== undefined && !['anthropic', 'openai-chat'].includes(protocol)) {
    throw new Error('[clawgod] Unsupported provider protocol: ' + protocol + '. Use anthropic or openai-chat; auto and Responses are not supported.');
  }
  const type = config.type;
  const useProxy = protocol === 'openai-chat' ||
    (protocol === undefined && ['grok', 'openai-compat'].includes(type));
  return {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    baseURL: typeof config.baseURL === 'string' ? config.baseURL : 'https://api.anthropic.com',
    model: typeof config.model === 'string' ? config.model : '',
    smallModel: typeof config.smallModel === 'string' ? config.smallModel : '',
    effort: typeof config.effort === 'string' ? config.effort : '',
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : 3000000,
    protocol: protocol || undefined,
    type: type || undefined,
    useProxy,
  };
}

async function probeToolTables() {
  try {
    const tables = globalThis.__clawgodTables;
    const counts = {};
    for (const kind of ['tools', 'commands']) {
      const factories = tables?.[kind];
      if (!Array.isArray(factories) || factories.length === 0) throw new Error(`${kind} factories not exposed`);
      counts[kind] = 0;
      for (const [index, factory] of factories.entries()) {
        if (typeof factory !== 'function') throw new Error(`${kind} factory ${index} is not callable`);
        const entries = await factory();
        if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${kind} factory ${index} returned an empty or invalid table`);
        for (let i = 0; i < entries.length; i++) {
          if (entries[i] == null || typeof entries[i].name !== 'string' || !entries[i].name) {
            throw new Error(`${kind} factory ${index}, index ${i}: missing descriptor or name`);
          }
        }
        counts[kind] += entries.length;
      }
    }
    process.stderr.write('[clawgod] probe-tools ok: ' + counts.tools + ' tools, ' + counts.commands + ' commands\n');
    return 0;
  } catch (error) {
    process.stderr.write('[clawgod] probe-tools error: ' + (error?.message ?? error) + '\n');
    return 1;
  }
}

module.exports.classifierTimeoutFloor = classifierTimeoutFloor;
module.exports.terminalReplyDelay = terminalReplyDelay;
module.exports.enablePredicate = enablePredicate;
module.exports.NO_OVERRIDE = NO_OVERRIDE;
module.exports.flagOverride = flagOverride;
module.exports.flagOverrides = FLAG_OVERRIDES;
module.exports.rewritePromptAssembly = rewritePromptAssembly;
module.exports.resolveProviderConfig = resolveProviderConfig;
module.exports.probeToolTables = probeToolTables;
globalThis.__clawgodHelpers = module.exports;
