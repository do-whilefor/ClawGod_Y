#!/bin/bash
set -e


CLAWGOD_DIR="$HOME/.clawgod"
BIN_DIR="$HOME/.local/bin"
VERSION="2.1.314"
CLAWGOD_SELF_VERSION="0.0.0-dev"

while [[ $# -gt 0 ]]; do
  case $1 in
    --uninstall) UNINSTALL=1; shift ;;
    *) printf 'Unknown installer option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${RED}✗${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1" >&2; }
dim()   { echo -e "  ${DIM}$1${NC}"; }

echo ""
echo -e "${BOLD}  ClawGod Installer${NC}"
echo ""

if [ "$UNINSTALL" = "1" ]; then
  CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
  for DIR in "${CLAUDE_BIN:+$(dirname "$CLAUDE_BIN")}" "$BIN_DIR"; do
    [ -z "$DIR" ] && continue
    if [ -f "$DIR/clawgod" ] && grep -q "clawgod" "$DIR/clawgod" 2>/dev/null; then
      rm -f "$DIR/clawgod"
      info "Removed ClawGod launcher ($DIR/clawgod)"
    fi
  done
  rm -rf "$CLAWGOD_DIR/node_modules" "$CLAWGOD_DIR/vendor" "$CLAWGOD_DIR/bun-runtime" "$CLAWGOD_DIR/cli.original.js" "$CLAWGOD_DIR/cli.original.js.bak" "$CLAWGOD_DIR/cli.original.cjs" "$CLAWGOD_DIR/cli.original.cjs.bak" "$CLAWGOD_DIR/source-backup.json" "$CLAWGOD_DIR/cli.js" "$CLAWGOD_DIR/cli.cjs" "$CLAWGOD_DIR/patch.mjs" "$CLAWGOD_DIR/ast-patches.mjs" "$CLAWGOD_DIR/pentest-patches.mjs" "$CLAWGOD_DIR/pentest-scanners.mjs" "$CLAWGOD_DIR/pentest-trimming.mjs" "$CLAWGOD_DIR/pentest-policy-text.mjs" "$CLAWGOD_DIR/pentest-pruner.mjs" "$CLAWGOD_DIR/lean-mode.cjs" "$CLAWGOD_DIR/lean-settings.json" "$CLAWGOD_DIR/.lean-disabled" "$CLAWGOD_DIR/.lean-max" "$CLAWGOD_DIR/acorn.mjs" "$CLAWGOD_DIR/acorn.LICENSE" "$CLAWGOD_DIR/patch.js" "$CLAWGOD_DIR/extract-natives.mjs" "$CLAWGOD_DIR/post-process.mjs" "$CLAWGOD_DIR/repatch.mjs" "$CLAWGOD_DIR/startup-check.cjs" "$CLAWGOD_DIR/startup-check.log" "$CLAWGOD_DIR/openai-proxy.cjs" "$CLAWGOD_DIR/feature-gates.cjs" "$CLAWGOD_DIR/runtime-helpers.cjs" "$CLAWGOD_DIR/bun-ant-shim.cjs" "$CLAWGOD_DIR/clawgod-import" "$CLAWGOD_DIR/claude.staged" "$CLAWGOD_DIR/claude.fallback" "$CLAWGOD_DIR/.source-version"
  rm -f "$CLAWGOD_DIR/compile-runtime.mjs" "$CLAWGOD_DIR/.compiled-runtime" "$CLAWGOD_DIR"/cli.compiled-*
  hash -r 2>/dev/null
  info "ClawGod uninstalled"
  echo ""
  warn "  Restart your terminal or run: hash -r"
  echo ""
  exit 0
fi


if ! command -v node &>/dev/null; then
  warn "Node.js is required (>= 18) for the patcher. Install from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 18 ]; then
  warn "Node.js >= 18 required (found v$NODE_VERSION)"
  exit 1
fi

if command -v bun &>/dev/null; then
  BUN_BIN=$(command -v bun)
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
else
  dim "Installing Bun (required runtime for v2.1.113+ cli.js) ..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || true
  BUN_BIN="$HOME/.bun/bin/bun"
  if [ ! -x "$BUN_BIN" ]; then
    warn "Bun installation failed. Install manually: https://bun.sh/install"
    exit 1
  fi
fi
info "Bun: $($BUN_BIN --version)"


MIN_BUN_VERSION="1.3.14"
BUN_VERSION_RAW=$($BUN_BIN --version 2>/dev/null | head -1)
BUN_VERSION_NUM=$(echo "$BUN_VERSION_RAW" | sed 's/-.*//')
if [ -z "$BUN_VERSION_NUM" ] \
   || [ "$(printf '%s\n%s\n' "$BUN_VERSION_NUM" "$MIN_BUN_VERSION" | sort -V | head -1)" != "$MIN_BUN_VERSION" ]; then
  warn ""
  warn "Bun ${BUN_VERSION_RAW:-<unknown>} is below the required minimum ($MIN_BUN_VERSION)."
  warn ""
  warn "  Anthropic builds claude-code with Bun's canary channel. Older Bun"
  warn "  panics on cli.original.cjs with 'Expected CommonJS module to have"
  warn "  a function wrapper'. This is a hard requirement, not a warning."
  warn ""
  warn "  Upgrade with one of:"
  warn "    bun upgrade --canary               (if installed via curl/install.sh)"
  warn "    brew upgrade bun                   (homebrew)"
  warn "    scoop uninstall bun && \\           (scoop — shim blocks self-replace)"
  warn "      irm https://bun.sh/install.ps1 | iex && bun upgrade --canary"
  warn ""
  warn "  Then re-run this installer."
  exit 1
fi


if ! command -v rg &>/dev/null; then
  warn "ripgrep (rg) is required but not found in PATH."
  warn "  Claude Code's Grep tool will not function without it."
  warn ""
  case "$(uname -s)" in
    Darwin) warn "  Install: brew install ripgrep" ;;
    Linux)  warn "  Install: apt install ripgrep   |   dnf install ripgrep   |   pacman -S ripgrep" ;;
    *)      warn "  Install: https://github.com/BurntSushi/ripgrep#installation" ;;
  esac
  warn ""
  warn "  Re-run this script after installing rg."
  exit 1
fi
info "ripgrep: $(rg --version | head -1)"

mkdir -p "$CLAWGOD_DIR" "$BIN_DIR"

NATIVE_BIN=""


case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)      os="" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *)             arch="" ;;
esac
if [ "$os" = "linux" ] && (ldd /bin/ls 2>/dev/null | grep -q musl); then
  PLATFORM="${os}-${arch}-musl"
else
  PLATFORM="${os}-${arch}"
fi

if ! command -v npm &>/dev/null; then
  warn "npm is required to download Claude Code from the registry."
  exit 1
fi
if [ -z "$os" ] || [ -z "$arch" ]; then
  warn "Unsupported platform: $(uname -s) $(uname -m)"
  exit 1
fi
NPM_PKG="@anthropic-ai/claude-code-${PLATFORM}"
dim "Fetching $NPM_PKG@$VERSION from npm registry ..."
NATIVE_BIN_TMPDIR=$(mktemp -d)
if ( cd "$NATIVE_BIN_TMPDIR" && npm pack "$NPM_PKG@$VERSION" --silent >/dev/null 2>&1 ); then
  TARBALL=$(ls "$NATIVE_BIN_TMPDIR"/*.tgz 2>/dev/null | head -1)
  if [ -n "$TARBALL" ]; then
    ( cd "$NATIVE_BIN_TMPDIR" && tar xzf "$TARBALL" )
    cand="$NATIVE_BIN_TMPDIR/package/claude"
    if [ -f "$cand" ]; then
      sz=$(stat -f%z "$cand" 2>/dev/null || stat -c%s "$cand" 2>/dev/null || echo 0)
      if [ "$sz" -gt 10000000 ]; then
        NATIVE_BIN="$cand"
        NATIVE_BIN_LABEL=$(node -e "console.log(require('$NATIVE_BIN_TMPDIR/package/package.json').version)" 2>/dev/null || echo "npm-latest")
      fi
    fi
  fi
fi
if [ -z "$NATIVE_BIN" ]; then
  rm -rf "$NATIVE_BIN_TMPDIR"
  warn "Failed to download $NPM_PKG from npm."
  warn "  Install the official Claude Code binary manually:"
  warn "    curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi
info "Downloaded $NPM_PKG@$NATIVE_BIN_LABEL"

PREV_BACKUP_DIR=""
ROLLBACK_FILES=(cli.original.cjs cli.original.cjs.bak cli.original.js .source-version
  source-backup.json bunfs vendor pathmap.json extract-natives.mjs post-process.mjs
  openai-proxy.cjs feature-gates.cjs cli.cjs .clawgod-version
  startup-check.cjs compile-runtime.mjs .compiled-runtime runtime-helpers.cjs bun-ant-shim.cjs system-prompt.md
  patch.mjs patch-registry.mjs ast-patches.mjs pentest-patches.mjs pentest-scanners.mjs
  pentest-trimming.mjs pentest-policy-text.mjs pentest-pruner.mjs lean-mode.cjs acorn.mjs acorn.LICENSE)
if [ -f "$CLAWGOD_DIR/cli.original.cjs" ] && [ -f "$CLAWGOD_DIR/.source-version" ]; then
  PREV_BACKUP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/clawgod-rollback-XXXXXX")
  for f in "${ROLLBACK_FILES[@]}"; do
    if [ -e "$CLAWGOD_DIR/$f" ]; then
      cp -a "$CLAWGOD_DIR/$f" "$PREV_BACKUP_DIR/" || {
        warn "Could not snapshot $f; installation was not changed."
        rm -rf "$PREV_BACKUP_DIR"
        exit 1
      }
    fi
  done
fi

rollback_install() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    rm -f "$CLAWGOD_DIR/claude.staged"
    if [ -n "$PREV_BACKUP_DIR" ]; then
      dim "Rolling back to previous working installation ..."
      for f in "${ROLLBACK_FILES[@]}"; do rm -rf "$CLAWGOD_DIR/$f"; done
      if cp -a "$PREV_BACKUP_DIR"/. "$CLAWGOD_DIR/"; then
        info "Restored previous working installation ($(cat "$CLAWGOD_DIR/.source-version"))."
      else
        warn "Rollback failed; backup kept at $PREV_BACKUP_DIR"
        return
      fi
    fi
  fi
  [ -z "$PREV_BACKUP_DIR" ] || rm -rf "$PREV_BACKUP_DIR" || warn "Could not remove rollback snapshot at $PREV_BACKUP_DIR"
}
trap rollback_install EXIT

cat > "$CLAWGOD_DIR/extract-natives.mjs" << 'EXTRACTOR_EOF'
{{CLAWGOD:extract-natives.mjs}}
EXTRACTOR_EOF

rm -rf "$CLAWGOD_DIR/vendor" "$CLAWGOD_DIR/bunfs" "$CLAWGOD_DIR/pathmap.json" \
  "$CLAWGOD_DIR/cli.original.js" 2>/dev/null

dim "Extracting cli.js + modules from $NATIVE_BIN_LABEL ..."
node "$CLAWGOD_DIR/extract-natives.mjs" "$NATIVE_BIN" "$CLAWGOD_DIR" 2>&1 | while IFS= read -r line; do echo "  $line"; done
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  err "Failed to extract from native binary"
  exit 1
fi
[ -f "$CLAWGOD_DIR/cli.original.js" ] || { err "cli.js missing after extraction"; exit 1; }


dim "Rewriting bunfs paths and IIFE invocation ..."
cat > "$CLAWGOD_DIR/post-process.mjs" << 'POSTPROC_EOF'
{{CLAWGOD:post-process.mjs}}
POSTPROC_EOF
cat > "$CLAWGOD_DIR/openai-proxy.cjs" << 'PROXY_EOF'
{{CLAWGOD:openai-proxy.cjs}}
PROXY_EOF
info "OpenAI-compatible proxy created (openai-proxy.cjs)"

cat > "$CLAWGOD_DIR/feature-gates.cjs" << 'GATES_EOF'
{{CLAWGOD:feature-gates.cjs}}
GATES_EOF
info "Patch feature gates created (feature-gates.cjs)"

cat > "$CLAWGOD_DIR/cli.cjs" << 'WRAPPER_EOF'
{{CLAWGOD:cli.cjs}}
WRAPPER_EOF
chmod +x "$CLAWGOD_DIR/cli.cjs"
echo "$CLAWGOD_SELF_VERSION" > "$CLAWGOD_DIR/.clawgod-version"
info "Wrapper created (cli.cjs)"

cat > "$CLAWGOD_DIR/startup-check.cjs" << 'STARTUP_EOF'
{{CLAWGOD:startup-check.cjs}}
STARTUP_EOF

cat > "$CLAWGOD_DIR/compile-runtime.mjs" << 'COMPILE_EOF'
{{CLAWGOD:compile-runtime.mjs}}
COMPILE_EOF

cat > "$CLAWGOD_DIR/runtime-helpers.cjs" << 'CFG_EOF'
{{CLAWGOD:runtime-helpers.cjs}}
CFG_EOF
info "Classifier runtime helpers created (runtime-helpers.cjs)"

cat > "$CLAWGOD_DIR/bun-ant-shim.cjs" << 'BUNANT_EOF'
{{CLAWGOD:bun-ant-shim.cjs}}
BUNANT_EOF
info "Bun.ant runtime shim created (bun-ant-shim.cjs)"

cat > "$CLAWGOD_DIR/acorn.mjs" << 'ACORN_EOF'
{{CLAWGOD:acorn.mjs}}
ACORN_EOF
cat > "$CLAWGOD_DIR/acorn.LICENSE" << 'ACORN_LICENSE_EOF'
{{CLAWGOD:acorn.LICENSE}}
ACORN_LICENSE_EOF

node "$CLAWGOD_DIR/post-process.mjs" 2>&1 | while IFS= read -r line; do echo "  $line"; done
if [ "${PIPESTATUS[0]}" -ne 0 ]; then err "Post-process failed"; exit 1; fi
[ -f "$CLAWGOD_DIR/cli.original.cjs" ] || { err "Post-process failed"; exit 1; }

echo "$NATIVE_BIN_LABEL" > "$CLAWGOD_DIR/.source-version"

if [ -f "$NATIVE_BIN" ]; then
  mv -f "$NATIVE_BIN" "$CLAWGOD_DIR/claude.staged"
fi

if [ -n "$NATIVE_BIN_TMPDIR" ]; then
  rm -rf "$NATIVE_BIN_TMPDIR"
fi

info "cli.original.cjs ready ($NATIVE_BIN_LABEL)"

cat > "$CLAWGOD_DIR/ast-patches.mjs" << 'AST_PATCHES_EOF'
{{CLAWGOD:ast-patches.mjs}}
AST_PATCHES_EOF
cat > "$CLAWGOD_DIR/pentest-patches.mjs" << 'PENTEST_PATCHES_EOF'
{{CLAWGOD:pentest-patches.mjs}}
PENTEST_PATCHES_EOF

cat > "$CLAWGOD_DIR/pentest-scanners.mjs" << 'PENTEST_SCANNERS_EOF'
{{CLAWGOD:pentest-scanners.mjs}}
PENTEST_SCANNERS_EOF
cat > "$CLAWGOD_DIR/pentest-trimming.mjs" << 'PENTEST_TRIMMING_EOF'
{{CLAWGOD:pentest-trimming.mjs}}
PENTEST_TRIMMING_EOF
cat > "$CLAWGOD_DIR/pentest-policy-text.mjs" << 'PENTEST_POLICY_TEXT_EOF'
{{CLAWGOD:pentest-policy-text.mjs}}
PENTEST_POLICY_TEXT_EOF
cat > "$CLAWGOD_DIR/pentest-pruner.mjs" << 'PENTEST_PRUNER_EOF'
{{CLAWGOD:pentest-pruner.mjs}}
PENTEST_PRUNER_EOF

cat > "$CLAWGOD_DIR/lean-mode.cjs" << 'LEAN_MODE_EOF'
{{CLAWGOD:lean-mode.cjs}}
LEAN_MODE_EOF

cat > "$CLAWGOD_DIR/system-prompt.md" << 'SYSTEM_PROMPT_EOF'
{{CLAWGOD:system-prompt.md}}
SYSTEM_PROMPT_EOF

cat > "$CLAWGOD_DIR/patch.mjs" << 'PATCHER_EOF'
{{CLAWGOD:patch.mjs}}

PATCHER_EOF
cat > "$CLAWGOD_DIR/patch-registry.mjs" << 'PATCH_REGISTRY_EOF'
{{CLAWGOD:patch-registry.mjs}}

PATCH_REGISTRY_EOF
info "Patcher created (patch.mjs)"


node "$CLAWGOD_DIR/patch.mjs" --capture-clean-source
dim "Applying patches ..."
node --max-old-space-size=4096 "$CLAWGOD_DIR/patch.mjs" 2>&1 | while IFS= read -r line; do echo "  $line"; done
patch_status=${PIPESTATUS[0]}
if [ "$patch_status" -ne 0 ]; then
  warn "Patching failed (node exit $patch_status). Installation aborted."
  if [ -z "$PREV_BACKUP_DIR" ]; then
    warn "No previous working installation found to roll back."
  fi
  warn ""
  warn "The new Claude Code build (${NATIVE_BIN_LABEL:-unknown}) is not yet supported by this ClawGod release."
  warn "Optional unmatched patches are already skipped; required prompt injection and source errors cannot be skipped."
  warn "Rerun the current installer to reinstall Claude Code 2.1.314."
  exit "$patch_status"
fi

dim "Compiling startup runtime ..."
"$BUN_BIN" "$CLAWGOD_DIR/compile-runtime.mjs"

if grep -rqs "Bun\.ant\.CellSegmenter" "$CLAWGOD_DIR/bunfs" "$CLAWGOD_DIR/cli.original.cjs" 2>/dev/null; then
  info "Renderer runtime: Bun.ant.CellSegmenter (Claude >= 2.1.271) — served by bun-ant-shim.cjs"
else
  info "Renderer runtime: stock Bun APIs (shim present but unused)"
fi

if [ ! -f "$CLAWGOD_DIR/features.json" ]; then
  cat > "$CLAWGOD_DIR/features.json" << 'FEATURES_EOF'
{{CLAWGOD:features.json}}
FEATURES_EOF
  info "Default features.json created"
fi

if [ ! -f "$CLAWGOD_DIR/patches.json" ]; then
  printf '{}\n' > "$CLAWGOD_DIR/patches.json"
  info "Default patches.json created (all features on)"
fi

if [ ! -f "$CLAWGOD_DIR/provider.json" ]; then
  cat > "$CLAWGOD_DIR/provider.json" << 'PROVIDER_EOF'
{
  "protocol": "anthropic",
  "apiKey": "",
  "baseURL": "https://api.anthropic.com",
  "model": "",
  "smallModel": "",
  "effort": "",
  "timeoutMs": 3000000
}
PROVIDER_EOF
fi


rm -f "$CLAWGOD_DIR/.lean-disabled" "$CLAWGOD_DIR/.lean-max"

node -e '
const {leanApply}=require(process.argv[3]);
try{leanApply(process.argv[1],process.argv[2],process.argv[4])}catch{}
' "$CLAWGOD_DIR/lean-settings.json" "$HOME/.claude/settings.json" "$CLAWGOD_DIR/lean-mode.cjs" "$CLAWGOD_DIR/patches.json" 2>/dev/null || true
info "Lean settings applied (strictest, clawgod-scoped): ~/.clawgod/lean-settings.json"

dim "Verifying Bun can load patched cli.original.cjs (bounded startup check) ..."
sanity_rc=0
sanity_out=$(node "$CLAWGOD_DIR/startup-check.cjs" "$BUN_BIN" "$CLAWGOD_DIR/cli.cjs" 2>&1) || sanity_rc=$?
if echo "$sanity_out" | grep -q "Expected CommonJS module to have a function wrapper"; then
  echo ""
  warn "The selected Bun runtime cannot load Anthropic's cli.original.cjs."
  warn ""
  warn "  Anthropic builds with Bun's canary channel (currently ~1.3.14), while"
  warn "  bun.sh's main download is on stable (currently 1.3.13). The canary build"
  warn "  is NOT visible on bun.sh's download page — it lives on GitHub Releases"
  warn "  and is reachable only via 'bun upgrade --canary'."
  warn ""
  warn "  If your bun is from bun.sh:"
  warn "    bun upgrade --canary"
  warn ""
  warn "  If your bun is from a package manager (brew/apt/scoop) where the binary"
  warn "  is behind a shim and refuses to self-replace ('bun upgrade' silently"
  warn "  hangs or no-ops):"
  warn "    <pkg-manager> uninstall bun"
  warn "    curl -fsSL https://bun.sh/install | bash"
  warn "    bun upgrade --canary"
  warn ""
  warn "  Then re-run install.sh — this sanity check will pass."
  exit 1
fi
if [ "$sanity_rc" -ne 0 ]; then
  warn "Patched Claude failed its startup check (exit $sanity_rc):"
  printf '%s\n' "$sanity_out"
  exit "$sanity_rc"
fi
info "Bun loads cli.original.cjs"
dim "Verifying tool/command tables load (bounded probe) ..."
probe_rc=0
probe_out=$(node "$CLAWGOD_DIR/startup-check.cjs" "$BUN_BIN" "$CLAWGOD_DIR/cli.cjs" --probe-tools 2>&1) || probe_rc=$?
if [ "$probe_rc" -ne 0 ]; then
  warn "Patched Claude failed its tool-table probe (exit $probe_rc):"
  printf '%s\n' "$probe_out"
  exit "$probe_rc"
fi
info "Tool and command tables load cleanly"
rollback_install
COMPILED_NAME=$(cat "$CLAWGOD_DIR/.compiled-runtime" 2>/dev/null || true)
for compiled in "$CLAWGOD_DIR"/cli.compiled-*; do
  [ "$compiled" = "$CLAWGOD_DIR/$COMPILED_NAME" ] || rm -f "$compiled"
done


IMPORT_BIN="$CLAWGOD_DIR/clawgod-import"
if [ ! -x "$IMPORT_BIN" ]; then
  IMPORT_URL="https://github.com/do-whilefor/Clawgod_Y/releases/latest/download/clawgod-import-$os-$arch"
  if curl -fsSL -o "$IMPORT_BIN" "$IMPORT_URL" 2>/dev/null; then
    chmod +x "$IMPORT_BIN"
    info "Provider import tool installed (clawgod-import)"
  else
    dim "Provider import tool not yet available (build pending)"
  fi
fi

LAUNCHER_CONTENT="#!/bin/bash

CLAWGOD_CLI=\"$CLAWGOD_DIR/cli.cjs\"
CLAWGOD_IMPORT=\"$CLAWGOD_DIR/clawgod-import\"
BUN_BIN=\"$BUN_BIN\"

if [ \"\$1\" = \"import\" ]; then
  shift
  if [ -x \"\$CLAWGOD_IMPORT\" ]; then
    exec \"\$CLAWGOD_IMPORT\" \"\$@\"
  else
    echo \"clawgod: import tool not installed. Reinstall clawgod to get it.\" >&2
    exit 127
  fi
fi
if [ ! -f \"\$CLAWGOD_CLI\" ]; then
  echo \"clawgod: installation at $CLAWGOD_DIR is missing (cli.cjs not found)\" >&2
  echo \"clawgod: reinstall via  curl -fsSL https://github.com/do-whilefor/Clawgod_Y/releases/latest/download/install.sh | bash\" >&2
  echo \"clawgod: or remove this launcher:  rm \\\"\$0\\\"\" >&2
  exit 127
fi
if [ ! -x \"\$BUN_BIN\" ]; then
  if command -v bun >/dev/null 2>&1; then BUN_BIN=\"\$(command -v bun)\"; fi
fi
if [ ! -x \"\$BUN_BIN\" ]; then
  echo \"clawgod: bun runtime not found at \$BUN_BIN\" >&2
  echo \"clawgod: install bun  curl -fsSL https://bun.sh/install | bash\" >&2
  exit 127
fi
LAUNCH_CLAUDE=\"\$(command -v claude 2>/dev/null || true)\"
if [ -z \"\$LAUNCH_CLAUDE\" ] && [ -f \"$CLAWGOD_DIR/claude.fallback\" ]; then
  LAUNCH_CLAUDE=\"$CLAWGOD_DIR/claude.fallback\"
fi
if [ -n \"\$LAUNCH_CLAUDE\" ]; then
  export CLAUDE_CODE_EXECPATH=\"\$LAUNCH_CLAUDE\"
fi
export HERDR_AGENT=\"\${HERDR_AGENT:-claude}\"
export IS_SANDBOX=\"\${IS_SANDBOX:-1}\"
if [ \"\$1\" != \"--uninstall\" ] && [ -f \"$CLAWGOD_DIR/.compiled-runtime\" ]; then
  COMPILED_NAME=\"\$(cat \"$CLAWGOD_DIR/.compiled-runtime\")\"
  if [ -x \"$CLAWGOD_DIR/\$COMPILED_NAME\" ]; then exec \"$CLAWGOD_DIR/\$COMPILED_NAME\" \"\$@\"; fi
fi
exec \"\$BUN_BIN\" \"\$CLAWGOD_CLI\" \"\$@\""

write_launcher() {
  local target="$1"
  local dir
  dir=$(dirname "$target")
  mkdir -p "$dir"
  rm -f "$target"
  printf '%s\n' "$LAUNCHER_CONTENT" > "$target"
  chmod +x "$target"
}

if ! command -v claude >/dev/null 2>&1; then
  if [ -f "$CLAWGOD_DIR/claude.staged" ]; then
    rm -f "$CLAWGOD_DIR/claude.fallback"
    mv -f "$CLAWGOD_DIR/claude.staged" "$CLAWGOD_DIR/claude.fallback"
    chmod +x "$CLAWGOD_DIR/claude.fallback"
  fi
  dim "No existing claude found — launcher will fall back to $CLAWGOD_DIR/claude.fallback"
else

  rm -f "$CLAWGOD_DIR/claude.staged"
fi

rm -f "$BIN_DIR/claude.orig"

write_launcher "$BIN_DIR/clawgod"
info "Command 'clawgod' → patched ($BIN_DIR/clawgod); 'claude' untouched"

if [ -f "$0" ] && [ "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" != "$CLAWGOD_DIR/install.sh" ]; then
  cp "$0" "$CLAWGOD_DIR/install.sh" 2>/dev/null || true
fi
if [ ! -f "$CLAWGOD_DIR/install.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.sh -o "$CLAWGOD_DIR/install.sh" 2>/dev/null || true
fi
chmod +x "$CLAWGOD_DIR/install.sh" 2>/dev/null || true


if ! echo "$PATH" | grep -q "$BIN_DIR"; then

  case "$(basename "$SHELL")" in
    zsh)  SHELL_RC="$HOME/.zshrc" ;;
    bash) SHELL_RC="$HOME/.bashrc" ;;
    fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
    *)    SHELL_RC="$HOME/.profile" ;;
  esac
  echo ""
  warn "$BIN_DIR is not in PATH. Run:"
  dim "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $SHELL_RC && source $SHELL_RC"
fi

hash -r 2>/dev/null

echo ""
echo -e "  ${BOLD}${GREEN}ClawGod installed!${NC}"
echo ""
dim "  clawgod           — Start patched Claude Code (pentest build)"
dim "  claude            — Original unpatched Claude Code (untouched)"
echo ""
dim "  Claude Code version: 2.1.314"
dim "  clawgod --version   — Query the Claude Code version"
dim "  clawgod --uninstall — Uninstall ClawGod"
dim "  Vanilla 'claude update' keeps working and updates only the original."
echo ""
warn "  If 'clawgod' is not found, restart your terminal or run: hash -r"
echo ""
dim "  Config: ~/.clawgod/provider.json"
dim "  Flags:  ~/.clawgod/features.json"
echo ""
dim "  If 'claude' panics with 'Expected CommonJS module to have a function wrapper',"
dim "  your Bun lags Anthropic's embedded Bun. Upgrade with one of:"
dim "    bun upgrade --canary           (if installed via curl/install.sh)"
dim "    scoop update bun               (scoop — may lag stable)"
dim "    brew upgrade bun               (homebrew)"
echo ""
