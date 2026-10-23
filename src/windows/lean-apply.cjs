const { existsSync } = require('fs');
const { dirname, join } = require('path');
// Resolve lean-mode.cjs next to the settings file first, so the installer's
// `node -e` invocation works regardless of the current working directory;
// fall back to a relative require for test harnesses. Only single quotes are
// used: PowerShell 5.1 strips embedded double quotes when passing a script
// string to a native command.
const local = join(dirname(process.argv[1]), 'lean-mode.cjs');
require(existsSync(local) ? local : './lean-mode.cjs').leanApply(process.argv[1], process.argv[2]);
