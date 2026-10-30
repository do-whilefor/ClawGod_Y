'use strict';
const CLAWGOD_FEATURES_META = {};

var CLAWGOD_RUNTIME_FEATURES = ['bun-ant-shim'];

var clawgodDir = require('path').join(require('os').homedir(), '.clawgod');

var _cfg = {};
try { _cfg = JSON.parse(require('fs').readFileSync(require('path').join(clawgodDir, 'patches.json'), 'utf8')); } catch {}
for (var _name in process.env) {
  if (_name.indexOf('CLAWGOD_FEATURE_') !== 0) continue;
  var _val = process.env[_name];
  if (_val !== 'true' && _val !== 'false') continue;
  _cfg[_name.slice('CLAWGOD_FEATURE_'.length).toLowerCase().replace(/_/g, '-')] = _val === 'true';
}

for (var _k in _cfg) {
  var _known = CLAWGOD_RUNTIME_FEATURES.includes(_k) ||
    Object.values(CLAWGOD_FEATURES_META).some(features => features.includes(_k));
  if (!_known) process.stderr.write('[clawgod] warning: unknown feature "' + _k + '" in patches.json\n');
}

var _gate = {};
for (var _pid in CLAWGOD_FEATURES_META) {
  _gate[_pid] = CLAWGOD_FEATURES_META[_pid].some(feature => _cfg[feature] !== false);
}
for (var _feature of CLAWGOD_RUNTIME_FEATURES) {
  _gate[_feature] = _cfg[_feature] !== false;
}
globalThis.__clawgodPatches = _gate;
