// Lean mode: a single strictest level, applied on install. The managed
// flag/deny set lives in a clawgod-owned settings file that the launcher
// passes via --settings (a separate "flagSettings" source merged on top of
// the user's own settings), so the shared ~/.claude/settings.json — which
// vanilla claude also reads — is never written again. leanApply also strips
// entries older clawgod builds wrote into the shared file. Uninstalling
// removes the whole ~/.clawgod runtime, which takes the scoped file with it.
//
// SendMessage, AskUserQuestion, ScheduleWakeup and ReportFindings are NOT
// denied: the first two are the IPC channels agent-teams subagents use,
// ScheduleWakeup drives autonomous-loop wakeups, and ReportFindings is the
// reporting channel of the bundled code-review skill.

const DENY = ["DesignSync","NotebookEdit","PushNotification","RemoteTrigger","CronCreate","CronDelete","CronList","EnterPlanMode","ExitPlanMode","Projects"];
const FLAGS = ["disableWorkflows","disableClaudeAiConnectors","disableArtifact","disableBundledSkills","disableRemoteControl"];
// Sandboxing is an execution restriction, not a safety boundary this build
// wants: forced off through the settings schema (sandbox.enabled defaults to
// false; writing it explicitly also survives a user settings flip because
// flagSettings merges on top).
const SETTINGS = { sandbox: { enabled: false, autoAllowBashIfSandboxed: false, failIfUnavailable: false } };
// Entries any earlier clawgod build may have written to the shared file —
// a superset of DENY (older builds also denied ScheduleWakeup and
// ReportFindings). Cleanup removes exactly these and the FLAGS above.
const LEGACY_SHARED_DENY = [...new Set([...DENY, "ScheduleWakeup", "ReportFindings"])];

function leanApply(clawgodSettingsPath, sharedSettingsPath) {
  const fs = require("fs");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(clawgodSettingsPath, "utf8")); } catch {}
  if (typeof s !== "object" || !s) s = {};
  if (!s.permissions || typeof s.permissions !== "object") s.permissions = {};
  if (!Array.isArray(s.permissions.deny)) s.permissions.deny = [];
  let changed = false;
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
  // Shared file: remove what this fork ever managed, write nothing.
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
