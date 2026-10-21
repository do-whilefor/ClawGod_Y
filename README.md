<div align="center">

# ClawGod_Y

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) god mode.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.14%2B-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-555)](#usage)
[![License](https://img.shields.io/badge/License-GPL_v3-orange)](./LICENSE)

[Overview](#overview) · [Usage](#usage) · [Usage Limits and Security](#usage-limits-and-security) · [License and Related Files](#license-and-related-files)

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JP.md)

</div>

## Overview

ClawGod_Y is a runtime patch for the official [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI that turns it into a tool dedicated to authorized penetration testing and security audits. It is **not** a third-party client: the installer extracts the official binary, applies AST-level patches, and runs the patched build with the Bun runtime.

The patch implementation draws on [0Chencc/clawgod](https://github.com/0Chencc/clawgod). Thanks to the original project for its open-source work. This fork keeps upstream's cross-version patch architecture and update flow, and changes where the patched build is installed:

- **`clawgod` starts the patched Claude Code.** The patched runtime lives entirely under `~/.clawgod` (`%USERPROFILE%\.clawgod` on Windows).
- **`claude` stays the original, untouched Claude Code.** The installer never replaces, renames, or backs up the `claude` command. Vanilla `claude update` keeps working normally.
- **Works with any Claude Code version.** Patches use cross-version anchors; if a future Claude Code release drifts beyond them, the installer fails loudly instead of producing a half-patched build. `clawgod update` pulls the latest Anthropic release and re-patches in one step.
- **Pentest-oriented patching**: tool-permission prompts and safety classifiers are bypassed by default, prompts are rewritten for authorized testing contexts, and unused office/consumer features are pruned.

## Usage

### Requirements

| Item | Requirement |
| --- | --- |
| Host | Windows, macOS, or Linux/WSL |
| Claude Code | Official native binary installed (`claude.ai/install.sh` or `claude.ai/install.ps1`) |
| Installer | Node.js 18 or later, including npm; run in an interactive terminal |
| Local runtime | Bun 1.3.14 or later (installed automatically if missing) and ripgrep (`rg`) |
| Windows | PowerShell 5.1 or later, with `tar` available |
| macOS / Linux / WSL | Bash, `curl`, and `tar`; automatic Bun installation also requires `unzip` |

### Installation

**macOS / Linux / WSL:**

```bash
curl -fsSL https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.ps1 | iex
```

After installation, open a new terminal: `clawgod` starts patched Claude, and `claude` starts original Claude. The patched runtime is stored in `~/.clawgod`, or `%USERPROFILE%\.clawgod` on Windows.

### Configure a Model and Get Started

The first launch of `clawgod` creates `~/.clawgod/provider.json`, or `%USERPROFILE%\.clawgod\provider.json` on Windows. This file is independent of Claude's own settings. To use an Anthropic-compatible API:

```json
{
  "protocol": "anthropic",
  "apiKey": "REPLACE_WITH_YOUR_API_KEY",
  "baseURL": "https://api.anthropic.com",
  "model": "REPLACE_WITH_A_MODEL_SUPPORTED_BY_YOUR_PROVIDER"
}
```

For an OpenAI Chat Completions-compatible service, set `protocol` to `openai-chat` and enter the provider's `baseURL`, API key, and model name. If you use a Claude subscription login instead of API credentials, leave `provider.json` at its defaults — `clawgod` shares the existing login in `~/.claude.json`. Save the file and restart `clawgod`.

### Update

```bash
clawgod update                    # pull the latest Claude Code release and re-patch
clawgod update --version 2.1.180  # install a specific version
clawgod update --no-upgrade       # re-patch the installed version
```

### Uninstallation

**macOS / Linux / WSL:** rerun the installer with `--uninstall`. **Windows:** rerun the installer with `-Uninstall`. This removes the `clawgod` launcher and the `~/.clawgod` runtime. Original `claude` is untouched by installation and needs no restoration.

## Usage Limits and Security

Read the [Disclaimer and Usage Compliance Notice](./SECURITY.md) before use.

- **Legal authorization**: Use only on your own systems, explicitly authorized targets, and CTFs or labs that permit testing. Stay within the authorized assets, time window, and operations. Unauthorized intrusion, data theft, and destruction are prohibited.
- **Human review**: Verify model judgments and tool findings against raw evidence, actual impact, and coverage. Patched sessions skip permission prompts, so every action executes without confirmation.
- **Information protection**: Before submitting source code, logs, credentials, or other materials, ensure compliance with confidentiality requirements and the model service's data processing terms.
- **Resource control**: Configure spending limits with your model service, and manually manage execution time, disk usage, and evidence retention.

Users must obtain testing authorization and are legally responsible for their actions and the resulting consequences. The project license does not grant permission to test third-party systems.

## License and Related Files

This repository is licensed under the [GNU General Public License v3.0](./LICENSE). Use, modification, distribution, and commercial use are permitted subject to the license's terms. Distribution requires compliance with applicable obligations concerning copyright notices, the license, and corresponding source code. See `LICENSE` for the full terms.

Third-party software, dependencies, and brand assets remain subject to their respective licenses and rights notices. This repository's license does not replace the terms of use for Claude Code, model services, or other third-party components.

| File | Contents |
| --- | --- |
| [LICENSE](./LICENSE) | Full English text of the GNU GPL v3 |
| [SECURITY.md](./SECURITY.md) | Disclaimer, usage compliance requirements, and deployment risks |
