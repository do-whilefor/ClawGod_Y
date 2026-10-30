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
  '(?:this|that)\\s+(?:is|would be)\\s+(?:illegal|unethical|harmful|malicious|dangerous|unauthorized|a violation)|' +
  'i\\s+(?:will|would|shall|\'m going to)\\s+(?:not\\s+)?(?:refuse|decline)\\b|' +
  'i\\s+(?:cannot|can\'t|won\'t|will not|would not)\\s+(?:assist|help|comply|provide|generate|create|write|produce)\\b|' +
  '(?:i\\s+am|i\'m)\\s+(?:unable|not able)\\s+to\\s+(?:assist|help|comply|provide|generate|create|write|produce)\\b)', 'i');

const RESEARCH_CONTEXT = new RegExp(
  '(?:' +
  'vulnerabilit\\w*|exploit(?:s|ing|ed|ability)?|penetration test|pentest|red team|red-team|' +
  'ctf|capture the flag|security research|security assessment|security audit|' +
  'threat model|attack surface|attack vector|payload|fuzz(?:ing)?|' +
  'reverse engineer|malware analysis|incident response|' +
  '\\bauthorized\\b|in-scope|scope of (?:the )?(?:engagement|work|assessment)|' +
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

const SOFT_CAUTION_CUE = /\b(?:(?:please\s+)?(?:make\s+sure|ensure|verify|double[\s-]?check)|(?:be|stay|remain)\s+(?:mindful|aware|vigilant)\s+(?:of|about)|you\s+(?:may|might)\s+want\s+to|it(?:'s| is)\s+(?:recommended|advisable|a good idea)\s+to|think\s+(?:about|through)\s+(?:whether|how|if)|before\s+(?:you\s+)?(?:proceed|proceeding|continue|continuing|act|acting|run|running|execute|executing|delete|deleting|modify|modifying))\b/i;
// Polite wording needs an authorization, legal, or risk-acceptance requirement.
const CAUTION_REQUIREMENT = new RegExp([
  /\b(?:you(?:'re|\s+are)|(?:the\s+)?user\s+is)\s+(?:(?:properly|explicitly|fully)\s+)?(?:authorized|permitted)\b/,
  /\b(?:you|(?:the\s+)?user)\s+(?:have|has)\s+(?:(?:the|necessary|proper|explicit|written|prior)\s+)*(?:permission|authorization|approval|consent)\b/,
  /\b(?:permission|authorization|approval|consent)\s+(?:from\s+(?:the\s+)?(?:user|owner|administrator)|(?:is|has\s+been)\s+(?:granted|obtained|received|given))\b/,
  /\b(?:legal|ethical)\s+(?:implications|requirements|consequences|concerns|considerations)|\b(?:legality|lawfulness)\b|\b(?:comply|compliant|compliance)\s+with\s+(?:(?:all|applicable|local|relevant|the)\s+)*(?:laws?|regulations?)\b/,
  /\b(?:understand|acknowledge|accept|consider|weigh|evaluate|assess)\s+(?:(?:the|any|all|potential|associated|possible)\s+)*(?:risks?|consequences)\b/,
  /\b(?:be|stay|remain)\s+(?:mindful|aware|vigilant)\s+(?:of|about)\s+(?:(?:the|any|potential|associated|possible)\s+)*(?:risks?|dangers?|consequences)\b/,
].map(pattern => pattern.source).join('|'), 'i');

const SECURITY_NOUN = new RegExp(
  '(?:' +
  'cyber-attack|cyber-crime|cybercrime|malware|ransomware|phishing|keylogger|botnet|social engineering|' +
  'exploit(?:s|ing)?\\s+(?:(?:a|known|zero-day)\\s+)?vulnerabilit|' +
  'unauthorized\\s+(?:access|use|entry|modification|interception)|' +
  'harm(?:ful)?\\s+(?:to|against)\\s+(?:computer|network|system|individual)|' +
  'safety and security|' +
  'ethical\\s+(?:concerns|implications|boundaries)|' +
  'malicious\\s+(?:code|activity|purposes|intent|software))', 'i');

const FORCED_DROP = new RegExp(
  '(?:' +
  '(?:be careful not to|avoid|never|do not|don\'t|must not|should not)\\s+(?:introduc\\w+|creat\\w+|add\\w*|generat\\w+|produc\\w+)\\s+(?:any\\s+)?security\\s+vulnerabilit\\w*|' +
  'introduc\\w+\\s+security\\s+vulnerabilit\\w*|' +
  'security\\s+vulnerabilit\\w+\\s+(?:in|into|within)\\s+(?:the\\s+)?(?:code|codebase|generated\\s+code|output))', 'i');

const REFUSAL_MARKER = /(?:\b(?:do not|don't|never|must not|should not|shall not|refuse|decline|avoid|refrain|abstain|hesitate|unable|cannot|can't|won't|will not|would not|forbid|prohibit(?:s|ed|ing)?|disallow(?:s|ed|ing)?|deny|denies|denied|denying|reject(?:s|ed|ing)?)\b)/i;
function sentenceDropped(sentence) {
  if (FORCED_DROP.test(sentence)) return true;
  if (REFUSAL_DIRECTIVE.test(sentence)) return true;
  if (SOFT_CAUTION_CUE.test(sentence) && CAUTION_REQUIREMENT.test(sentence)) return true;
  if (RESEARCH_CONTEXT.test(sentence)) return false;
  if (CAUTION_POSTURE.test(sentence)) return true;
  if (SECURITY_NOUN.test(sentence) && REFUSAL_MARKER.test(sentence)) return true;
  return false;
}


const CUSTOM_PROMPT_MARK = 'clawgod:custom-prompt';

const HOST_IDENTITY_NAMES = /claude(?:[\s_-]*code)?|anthropic|克劳德|克勞德|クロード|アンソロピック|클로드|앤트로픽|клод|антропик|كلود|أنثروبيك|انثروبيك|क्लॉड|एंथ्रोपिक/iu;
const HOST_IDENTITY_ROLES = /\b(?:ai|llm|assistant|agent|chatbot|tool|language\s+model|artificial\s+intelligence)\b|人工智能|人工智慧|(?:大(?:型)?(?:语言|語言)|语言|語言)模型|(?:编程|編程|编码|編碼|智能)?助手|アシスタント|人工知能|言語モデル|エージェント|인공\s*지능|언어\s*모델|어시스턴트|도우미|에이전트|\b(?:assistant(?:e)?|agent|modèle|intelligence\s+artificielle|asistente|modelo|inteligencia\s+artificial|assistent(?:in)?|sprachmodell|ki|künstliche\s+intelligenz|assistente|modello|intelligenza\s+artificiale|inteligência\s+artificial|ia)\b|ассистент|помощник|языков(?:ая|ой|ую)\s+модел(?:ь|ью|и)|искусственн(?:ый|ым|ого)\s+интеллект|مساعد|نموذج\s+لغوي|ذكاء\s+اصطناعي|एआई|सहायक|भाषा\s+मॉडल|कृत्रिम\s+बुद्धिमत्ता/iu;
const HOST_IDENTITY_DECLARATION = new RegExp('(?:' + [
  /\b(?:you\s+are|you're|i\s+am|i'm|we\s+are|we're|this\s+is|(?:this\s+|the\s+)?(?:assistant|model|agent|system)\s+is|as)\s+(?:(?:an?|the|helpful|intelligent|advanced|large|coding|interactive|conversational|cli|ai)\s+)*/,
  /(?:你|您|我|我们|我們|本(?:助手|模型|系统|系統)|此(?:助手|模型|系统|系統)|助手|模型)\s*(?:是|为|為|叫|名为|名為)\s*(?:(?:一[个個名位]|有用的|智能的)\s*)*|(?:作为|作為)\s*(?:一[个個名位]\s*)?/,
  /(?:私|わたし|あなた|この(?:アシスタント|モデル|エージェント))\s*は\s*(?:(?:便利な|高度な|対話型の)\s*)*/,
  /(?:저|나|당신|이\s*(?:어시스턴트|모델|에이전트))(?:는|은)\s*(?:(?:유용한|대화형|고급)\s+)*/,
  /\b(?:je\s+suis|tu\s+es|vous\s+êtes|cet\s+assistant\s+est|en\s+tant\s+que)\s+(?:(?:un|une|le|la|grand|grande)\s+)*/,
  /\b(?:ich\s+bin|du\s+bist|sie\s+sind|dieser\s+assistent\s+ist|als)\s+(?:(?:ein|eine|der|die|das|hilfreicher|intelligenter|großes)\s+)*/,
  /\b(?:yo\s+soy|soy|tú\s+eres|eres|usted\s+es|este\s+asistente\s+es|como)\s+(?:(?:un|una|el|la|gran)\s+)*/,
  /\b(?:eu\s+sou|sou|você\s+é|tu\s+és|este\s+assistente\s+é|como)\s+(?:(?:um|uma|o|a|grande)\s+)*/,
  /\b(?:io\s+sono|sono|tu\s+sei|sei|questo\s+assistente\s+è|come)\s+(?:(?:un|una|uno|il|la|grande)\s+)*/,
  /(?:^|[^\p{L}\p{N}])(?:я|ты|вы|этот\s+ассистент)\s+(?:(?:являюсь|являешься|являетесь|это)\s+)?/,
  /(?:أنا|انا|أنت|انت|هذا\s+المساعد)\s+(?:(?:هو|هي)\s+)?/,
  /(?:मैं|आप|यह\s+सहायक)\s+(?:(?:एक|उन्नत)\s+)*/,
].map(pattern => pattern.source).join('|') + ')[\\s:：=—–-]*(?:' + HOST_IDENTITY_NAMES.source + '|' + HOST_IDENTITY_ROLES.source + ')', 'iu');

const HOST_IDENTITY_LABEL = new RegExp([
  /\b(?:(?:my|your|our)\s+name\s+is|call\s+me)\b|\b(?:assistant|model|agent|system)\s+(?:name|identity|id)\s*[:=]/,
  /(?:我|你|您|助手|模型|系统|系統)的?(?:名字|名称|名稱|身份|名)\s*(?:是|为|為|[:=：])/,
  /(?:私|あなた)の名前は|(?:アシスタント名|モデル名)\s*[:=]|(?:제|내|당신의)\s*이름은|(?:어시스턴트|모델)\s*(?:이름|명)\s*[:=]/,
  /\b(?:je\s+m'appelle|tu\s+t'appelles|mein\s+name\s+ist|dein\s+name\s+ist|me\s+llamo|te\s+llamas|meu\s+nome\s+é|seu\s+nome\s+é|mi\s+chiamo|il\s+tuo\s+nome\s+è)(?![\p{L}\p{N}])/,
  /\b(?:nom\s+(?:de\s+l'assistant|du\s+modèle)|(?:assistenten|modell)(?:name|identität)|nombre\s+del\s+(?:asistente|modelo)|nome\s+(?:do|del)\s+(?:assistente|modelo|modello))\s*[:=]/,
  /(?:меня|тебя|вас)\s+зовут|(?:имя|название|идентичность)\s+(?:ассистента|модели)\s*[:=]/,
  /(?:اسمي|اسمك)\s|اسم\s+(?:المساعد|النموذج)\s*[:=]|(?:मेरा|आपका)\s+नाम|(?:सहायक|मॉडल)\s+का\s+नाम\s*[:=]/,
].map(pattern => pattern.source).join('|'), 'iu');
const HOST_IDENTITY_ATTRIBUTION = /\b(?:by|from|built|made|developed|created|trained|provided|official|copyright|trademark)\b|©|\(c\)|开发|開發|提供|构建|構建|打造|出品|训练|訓練|版权|版權|商标|商標|開発|作成|訓練|公式|著作権|개발|제공|훈련|공식|저작권|\b(?:développé|créé|entraîné|fourni|officiel|entwickelt|erstellt|trainiert|bereitgestellt|offiziell|desarrollado|creado|entrenado|proporcionado|oficial|desenvolvido|criado|treinado|fornecido|sviluppato|creato|addestrato|fornito|ufficiale)\b|разработан|создан|обучен|предоставлен|официальн|авторск|تطوير|طورته|إنشاء|تدريب|رسمي|حقوق|विकसित|निर्मित|प्रशिक्षित|आधिकारिक/iu;
const HOST_IDENTITY_METADATA = /\bmy\s+(?:capabilities|training|knowledge\s+cutoff|training\s+data|limitations)\b|\b(?:i\s+am|i'm)\s+here\s+to\s+(?:help|assist)\b|我的(?:能力|训练|訓練|知识截止|知識截止|局限)|我在这里(?:为你)?(?:提供帮助|协助|帮忙)|私の(?:能力|訓練|知識|制限)|제\s*(?:능력|학습|지식|한계)|\b(?:mes\s+(?:capacités|limites)|meine\s+(?:fähigkeiten|grenzen)|mis\s+(?:capacidades|limitaciones)|minhas\s+(?:capacidades|limitações)|le\s+mie\s+(?:capacità|limitazioni))\b|мои\s+(?:возможности|ограничения)|(?:قدراتي|تدريبي|حدودي)|मेरी\s+(?:क्षमताएं|क्षमताएँ|सीमाएं|सीमाएँ)/iu;
const HOST_IDENTITY_ROLE_SUFFIX = new RegExp('(?:' + HOST_IDENTITY_NAMES.source + '|' + HOST_IDENTITY_ROLES.source + ')\\s*(?:です|である|として|입니다|이에요|예요|로서|으로서|हूँ|है)', 'iu');
const HOST_IDENTITY_BARE = new RegExp('^[\\s#>*_"\'`(]*(?:' + HOST_IDENTITY_NAMES.source + ')(?:[\\s\\d._:()©®™-]|sonnet|opus|haiku|code|assistant)*[.!?。！？]*$', 'iu');

function normalizeIdentityText(text) {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[‘’ʼ]/g, "'").replace(/[*_`~]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

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
  const identityMarkers = Array.isArray(cfg.identityMarkers)
    ? [...new Set(cfg.identityMarkers.filter(m => typeof m === 'string').map(normalizeIdentityText).filter(Boolean))]
    : [];
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
  const fragments = prompt.split(/\n{2,}/).map(piece => piece.trim()).filter(Boolean);
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

function filterPromptSection(section, markers = []) {
  if (typeof section !== 'string') return section;
  const lines = section.split('\n');
  const kept = [];
  let changed = false;
  for (const line of lines) {
    // Decimal points remain inside sentences; CJK and RTL punctuation can end them.
    const sentences = line.split(/(?<=[。｡！？；؛;؟۔।॥])|(?<=[.．﹒!?])(?=\s|$)/u);
    const rest = [];
    for (const sentence of sentences) {
      const text = normalizeIdentityText(sentence);
      const drop = sentenceDropped(text) ||
        HOST_IDENTITY_DECLARATION.test(text) || HOST_IDENTITY_LABEL.test(text) ||
        HOST_IDENTITY_METADATA.test(text) || HOST_IDENTITY_ROLE_SUFFIX.test(text) ||
        HOST_IDENTITY_BARE.test(text) ||
        (HOST_IDENTITY_NAMES.test(text) && HOST_IDENTITY_ATTRIBUTION.test(text)) ||
        markers.some(marker => text.includes(marker));
      if (drop) { changed = true; continue; }
      rest.push(sentence);
    }
    kept.push(rest.join(''));
  }
  if (!changed) return section;
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
      if (typeof section === 'string') {
        const stripped = filterPromptSection(section, cfg.identityMarkers);
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
