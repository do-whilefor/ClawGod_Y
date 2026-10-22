// Lean mode: a single strictest level, applied on install. It writes the
// full managed flag/deny set into the shared ~/.claude/settings.json (adding
// only what is missing, never touching the user's other entries) and enables
// the CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC gate via the .lean-max marker.
// There are no levels and no undo: uninstalling clawgod leaves these entries
// in place — they are plain settings the user can edit or delete by hand.
// cli.cjs and both installers embed their own copies of this list; keep them
// in sync (lean.test.mjs exercises every entry point).

const DENY = ["DesignSync","NotebookEdit","PushNotification","RemoteTrigger","CronCreate","CronDelete","CronList","EnterPlanMode","ExitPlanMode","SendMessage","ScheduleWakeup","AskUserQuestion","ReportFindings"];
const FLAGS = ["disableWorkflows","disableClaudeAiConnectors","disableArtifact","disableBundledSkills","disableRemoteControl"];

function leanApply(settingsPath) {
  const fs = require("fs");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
  if (typeof s !== "object" || !s) s = {};
  if (!s.permissions || typeof s.permissions !== "object") s.permissions = {};
  if (!Array.isArray(s.permissions.deny)) s.permissions.deny = [];
  let changed = false;
  for (const k of FLAGS) { if (!(k in s)) { s[k] = true; changed = true; } }
  const ex = new Set(s.permissions.deny);
  for (const t of DENY) { if (!ex.has(t)) { s.permissions.deny.push(t); changed = true; } }
  if (changed) { try { fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + "\n"); } catch {} }
}

module.exports = { leanApply, DENY, FLAGS };
