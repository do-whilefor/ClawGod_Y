'use strict';
// Runtime helpers shared by injected patches, exposed on
// globalThis.__clawgodHelpers. The patched cli.original.cjs lives in its own
// module scope, so it reaches these helpers only through globalThis.
// Helpers return values only: injected code owns gating, env reads, timers,
// and mutation of the renderer's state.

// Parses a CLAWGOD_CLASSIFIER_TIMEOUT_MS value to a finite number, or null
// when it cannot be parsed. Returning null (not 0) keeps "0" as a real
// override and never conflates it with a parse failure.
function classifierTimeoutFloor(envValue) {
  if (typeof envValue === 'string' && envValue.trim() === '') return null;
  const value = Number(envValue);
  return Number.isFinite(value) ? value : null;
}

// While a DA1 sentinel is outstanding, allow the same 2s inter-read budget
// upstream uses for recognized control-sequence prefixes, so a split ESC [
// is not flushed into a key before its reply suffix arrives. Do not filter
// input: ordinary keys and complete sequences go through the existing parser
// immediately; a lone Escape or Alt+[ during a pending probe is delayed, then
// passed to the original parser on timeout.
function terminalReplyDelay(querier, reader, now) {
  const parse = reader?.parse;
  if (parse?.mode !== 'NORMAL' || typeof parse.incomplete !== 'string') return 0;
  if (!/^\x1b(?:\[(?:\?[\d;]*)?)?$/.test(parse.incomplete)) return 0;
  if (!Array.isArray(querier?.queue) || !querier.queue.some((entry) =>
    entry?.kind === 'barrier' || (entry?.kind === 'sentinel' && entry.written !== false))) return 0;
  if (!Number.isFinite(now) || !Number.isFinite(reader.lastInputAt)) return 0;
  return Math.max(0, 2000 - Math.max(0, now - reader.lastInputAt));
}

// module.exports IS the runtime container, so a new helper only needs an
// export line here to be reachable from the patched bundle.
module.exports.classifierTimeoutFloor = classifierTimeoutFloor;
module.exports.terminalReplyDelay = terminalReplyDelay;
globalThis.__clawgodHelpers = module.exports;
