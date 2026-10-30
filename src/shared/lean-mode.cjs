
const DENY = ["DesignSync","NotebookEdit","PushNotification","RemoteTrigger","EnterPlanMode","ExitPlanMode","Projects"];
const REMOVED_TOOLS = ["CronCreate","CronDelete","CronList"];
const FLAGS = ["disableWorkflows","disableClaudeAiConnectors","disableArtifact","disableBundledSkills","disableRemoteControl"];
const SETTINGS = {
  sandbox: { enabled: false, autoAllowBashIfSandboxed: false, failIfUnavailable: false },
  includeCoAuthoredBy: false,
  cleanupPeriodDays: 3650,
  enableAllProjectMcpServers: true,
  fileCheckpointingEnabled: false,
  env: {
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    DISABLE_ERROR_REPORTING: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: '1',
  },
};
const LEGACY_SHARED_DENY = [...DENY, ...REMOVED_TOOLS, "ScheduleWakeup", "ReportFindings"];

const FEATURES_LOCKED_ON = {
  'agent-teams': true,
  'computer-use': true,
  'ultraplan': true,
  'ultrareview': true,
  'remote-settings': true,
  'wiggly-dove': true,
  'bun-ant-shim': true,
};

function leanApply(clawgodSettingsPath, sharedSettingsPath, patchesJsonPath) {
  const fs = require("fs");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(clawgodSettingsPath, "utf8")); } catch {}
  if (typeof s !== "object" || !s) s = {};
  if (!s.permissions || typeof s.permissions !== "object") s.permissions = {};
  if (!Array.isArray(s.permissions.deny)) s.permissions.deny = [];
  let changed = false;
  if (s.permissions.defaultMode !== "bypassPermissions") {
    s.permissions.defaultMode = "bypassPermissions";
    changed = true;
  }
  for (const k of FLAGS) { if (!(k in s)) { s[k] = true; changed = true; } }
  for (const [k, v] of Object.entries(SETTINGS)) {
    if (JSON.stringify(s[k]) !== JSON.stringify(v)) { s[k] = v; changed = true; }
  }
  const ex = new Set(s.permissions.deny);
  for (const t of DENY) { if (!ex.has(t)) { s.permissions.deny.push(t); changed = true; } }
  if (changed) {
    try {
      fs.mkdirSync(require("path").dirname(clawgodSettingsPath), { recursive: true });
      fs.writeFileSync(clawgodSettingsPath, JSON.stringify(s, null, 2) + "\n");
    } catch {}
  }
  if (patchesJsonPath) {
    let p = {};
    try { p = JSON.parse(fs.readFileSync(patchesJsonPath, "utf8")); } catch {}
    if (typeof p !== "object" || !p) p = {};
    let pchanged = false;
    for (const [k, v] of Object.entries(FEATURES_LOCKED_ON)) {
      if (!(k in p)) { p[k] = v; pchanged = true; }
    }
    if (pchanged) {
      try {
        fs.mkdirSync(require("path").dirname(patchesJsonPath), { recursive: true });
        fs.writeFileSync(patchesJsonPath, JSON.stringify(p, null, 2) + "\n");
      } catch {}
    }
  }
  if (sharedSettingsPath) {
    try {
      let shared = JSON.parse(fs.readFileSync(sharedSettingsPath, "utf8"));
      if (typeof shared !== "object" || !shared) return;
      let touched = false;
      for (const k of FLAGS) { if (shared[k] === true) { delete shared[k]; touched = true; } }
      if (Array.isArray(shared.permissions?.deny)) {
        const kept = shared.permissions.deny.filter(t => !LEGACY_SHARED_DENY.includes(t));
        if (kept.length !== shared.permissions.deny.length) {
          shared.permissions.deny = kept;
          touched = true;
        }
      }
      if (touched) fs.writeFileSync(sharedSettingsPath, JSON.stringify(shared, null, 2) + "\n");
    } catch {}
  }
}

module.exports = { leanApply, DENY, FLAGS, SETTINGS, LEGACY_SHARED_DENY };
