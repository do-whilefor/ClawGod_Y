# Hooks — 可直接运行的脚本

> 复制到 `~/.claude/hooks/` 即可使用，无需手写代码。

---

## 包含文件

| 文件 | 对应层 | 触发时机 | 功能 |
|------|--------|----------|------|
| `scene-router.py` | Layer 2 | UserPromptSubmit | cwd 预设匹配 + 关键词匹配 → 动态注入场景上下文 |
| `tool-guard.py` | Layer 3 | PreToolUse | Bash/Write 工具调用风险评估 → allow/block |
| `setup.sh` | — | 安装时 | 一键安装 hook 脚本 + 注册到 settings.json（macOS/Linux） |
| `setup.ps1` | — | 安装时 | 一键安装（Windows） |

---

## 快速安装

### macOS / Linux

```bash
cd clawgod-handbook/hooks
bash setup.sh
```

### Windows (PowerShell)

```powershell
cd clawgod-handbook\hooks
.\setup.ps1
```

安装脚本会自动：
1. 复制 hook 脚本到 `~/.claude/hooks/`
2. 注册 hook 到 `~/.claude/settings.json`
3. 安装 `security-research-context.md` rules（如果不存在）
4. 创建审计日志目录 `~/.claude/audit/`

## 手动安装

如果不想用安装脚本：

```bash
# 1. 复制脚本
mkdir -p ~/.claude/hooks
cp scene-router.py tool-guard.py ~/.claude/hooks/

# 2. 编辑 ~/.claude/settings.json，添加：
{
  "hooks": {
    "UserPromptSubmit": [
      { "command": "python3 ~/.claude/hooks/scene-router.py", "timeout": 3000 }
    ],
    "PreToolUse": [
      { "command": "python3 ~/.claude/hooks/tool-guard.py", "timeout": 3000 }
    ]
  }
}

# 3. 重启 Claude Code
```

## 卸载

```bash
# macOS / Linux
bash setup.sh --uninstall

# Windows
.\setup.ps1 -Uninstall
```

---

## 自定义

### scene-router.py

编辑脚本顶部的配置区：

```python
# 添加新的目录映射
CWD_MAP = {
    "my-project": "my-custom-scene",
    ...
}

# 添加新的场景上下文
SCENE_CONTEXT = {
    "my-custom-scene": "[场景识别] 你的自定义场景描述...",
    ...
}
```

### tool-guard.py

编辑 `BLOCK_RULES` 列表添加新的阻断规则：

```python
BLOCK_RULES = [
    (["Bash"], r"your-dangerous-pattern", "原因说明"),
    ...
]
```

---

## 审计日志

所有决策记录在 `~/.claude/audit/` 目录下：

```
~/.claude/audit/
├── scene-router-2026-05-13.jsonl    # 场景识别日志
└── tool-guard-2026-05-13.jsonl      # 工具守卫日志
```

每行一条 JSON，格式参见 [audit-log-schema.md](../appendix/audit-log-schema.md)。
