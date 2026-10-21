# settings.json 配置片段

> 用于 Claude Code hooks 注册和策略配置的 settings.json 片段参考。

---

## 文件位置

```
全局：~/.claude/settings.json
项目：.claude/settings.local.json
```

---

## 最小配置：仅 Session Rules

不需要任何 hook，只需要 rules 文件：

```json
{
  "permissions": {
    "allow": [
      "Bash(nmap:*)",
      "Bash(python:*)",
      "Bash(git:*)"
    ]
  }
}
```

Rules 文件放到 `~/.claude/rules/` 即可自动加载。

---

## 进阶配置：Scene Router Hook

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": "python ~/.claude/hooks/scene-router.py",
        "timeout": 3000
      }
    ]
  }
}
```

---

## 完整配置：Scene Router + Guard

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": "python ~/.claude/hooks/scene-router.py",
        "timeout": 3000
      }
    ],
    "PreToolUse": [
      {
        "command": "python ~/.claude/hooks/tool-guard.py",
        "timeout": 3000
      }
    ]
  }
}
```

---

## 审计日志配置

Guard 脚本应将决策写入日志文件。日志路径建议：

```
~/.claude/audit/audit-YYYY-MM-DD.jsonl
```

每行一条 JSON 记录，格式参见 [audit-log-schema.md](../../appendix/audit-log-schema.md)。

---

## 注意事项

1. `settings.json` 和 `settings.local.json` 的区别：
   - `settings.json` — 可提交到 git，团队共享
   - `settings.local.json` — 本地专用，不提交到 git

2. hooks 的 `command` 路径要用绝对路径

3. `timeout` 单位是毫秒，建议 UserPromptSubmit 设 3000，PreToolUse 设 3000

4. hook 脚本需要有执行权限：`chmod +x ~/.claude/hooks/*.py`

5. 测试 hook 时建议先用 `echo` 验证输入输出格式
