<div align="center">

# ClawGod_Y

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) 上帝模式。

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3.14%2B-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-555)](#使用方法)
[![License](https://img.shields.io/badge/License-GPL_v3-orange)](./LICENSE)

[概述](#概述) · [使用方法](#使用方法) · [安全范围](#安全范围) · [许可证与相关文件](#许可证与相关文件)

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JP.md)

</div>

## 概述

ClawGod_Y 是针对官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 的运行时补丁，将其转变为专用于授权渗透测试与安全审计的工具。它**不是**第三方客户端：安装器从官方二进制中提取代码、执行 AST 级补丁，并通过 Bun 运行时启动打补丁后的构建。

补丁实现参考了 [0Chencc/clawgod](https://github.com/0Chencc/clawgod)，感谢原项目的开源工作。本 fork 保留了上游的跨版本补丁架构与更新流程，并改变了打补丁版本的安装方式：

- **`clawgod` 启动打补丁的 Claude Code。** 补丁运行时完全存放在 `~/.clawgod`（Windows 下为 `%USERPROFILE%\.clawgod`）。
- **`claude` 保持原版，不受任何改动。** 安装器不会替换、重命名或备份 `claude` 命令，原版 `claude update` 照常工作。
- **兼容任意 Claude Code 版本。** 补丁使用跨版本锚点；如果未来的 Claude Code 版本变化超出锚点范围，安装器会明确报错中止，而不是产出打了一半的构建。`clawgod update` 会拉取最新的 Anthropic 发布版本并一步完成重新打补丁。
- **面向渗透测试的补丁**：默认绕过工具权限提示与安全分类器，将提示词改写为授权测试场景，并裁剪掉无关的办公/消费级功能。

## 使用方法

### 环境要求

| 项目 | 要求 |
| --- | --- |
| 主机 | Windows、macOS 或 Linux/WSL |
| Claude Code | 已安装官方原生二进制（`claude.ai/install.sh` 或 `claude.ai/install.ps1`） |
| 安装器 | Node.js 18 或更高版本（含 npm）；在交互式终端中运行 |
| 本地运行时 | Bun 1.3.14 或更高版本（缺失时自动安装）及 ripgrep（`rg`） |
| Windows | PowerShell 5.1 或更高版本，且可用的 `tar` |
| macOS / Linux / WSL | Bash、`curl` 和 `tar`；自动安装 Bun 还需要 `unzip` |

### 安装

**macOS / Linux / WSL：**

```bash
curl -fsSL https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.sh | bash
```

**Windows PowerShell：**

```powershell
irm https://raw.githubusercontent.com/do-whilefor/Clawgod_Y/main/install.ps1 | iex
```

安装完成后打开新终端：`clawgod` 启动打补丁的 Claude，`claude` 启动原版 Claude。补丁运行时存放在 `~/.clawgod`，Windows 下为 `%USERPROFILE%\.clawgod`。

### 配置模型并开始使用

首次启动 `clawgod` 会创建 `~/.clawgod/provider.json`（Windows 下为 `%USERPROFILE%\.clawgod\provider.json`）。该文件独立于 Claude 自身的配置。使用 Anthropic 兼容 API 时：

```json
{
  "protocol": "anthropic",
  "apiKey": "REPLACE_WITH_YOUR_API_KEY",
  "baseURL": "https://api.anthropic.com",
  "model": "REPLACE_WITH_A_MODEL_SUPPORTED_BY_YOUR_PROVIDER"
}
```

使用 OpenAI Chat Completions 兼容服务时，将 `protocol` 设为 `openai-chat`，并填写服务商的 `baseURL`、API 密钥和模型名称。如果你使用 Claude 订阅账号登录而非 API 凭证，保持 `provider.json` 为默认值即可——`clawgod` 会共享 `~/.claude.json` 中已有的登录态。保存文件后重启 `clawgod`。

### 更新

```bash
clawgod update                    # 拉取最新 Claude Code 版本并重新打补丁
clawgod update --version 2.1.180  # 安装指定版本
clawgod update --no-upgrade       # 对已安装的版本重新打补丁
```

### 卸载

**macOS / Linux / WSL：** 重新运行安装器并附加 `--uninstall`。**Windows：** 重新运行安装器并附加 `-Uninstall`。卸载会移除 `clawgod` 启动器和 `~/.clawgod` 运行时。原版 `claude` 在安装时未被改动，无需恢复。

## 安全范围

使用前请阅读[免责声明与使用合规须知](./SECURITY.md)。

- **合法授权**：仅用于你自己的系统、获得明确授权的目标，以及允许测试的 CTF 或实验环境。严格限定在授权的资产、时间窗口和操作范围内。严禁未经授权的入侵、数据窃取和破坏行为。
- **人工复核**：对照原始证据、实际影响和覆盖范围，核实模型判断与工具结果。打补丁的会话会跳过权限提示，每个动作都不经确认直接执行。
- **信息保护**：在提交源代码、日志、凭证或其他材料之前，确保符合保密要求以及模型服务的数据处理条款。
- **资源控制**：向模型服务商配置消费限额，并自行管理执行时长、磁盘占用和证据留存。

用户必须获得测试授权，并对自身行为及其后果承担法律责任。本项目许可证不授予对第三方系统进行测试的任何许可。

## 许可证与相关文件

本仓库采用 [GNU 通用公共许可证 v3.0](./LICENSE)。在遵守许可证条款的前提下，允许使用、修改、分发及商业使用。分发时须遵守有关版权声明、许可证文本及对应源代码的相关义务。完整条款见 `LICENSE`。

第三方软件、依赖及品牌资产仍受其各自的许可证与权利声明约束。本仓库许可证不替代 Claude Code、模型服务或其他第三方组件的使用条款。

| 文件 | 内容 |
| --- | --- |
| [LICENSE](./LICENSE) | GNU GPL v3 英文全文 |
| [SECURITY.md](./SECURITY.md) | 免责声明、使用合规要求与部署风险 |
