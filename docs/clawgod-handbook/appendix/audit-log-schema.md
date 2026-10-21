# 审计日志 Schema 参考

> PreToolUse Guard 和 Scene Router 的审计日志格式定义。

---

## 日志格式

日志文件为 JSONL（每行一条 JSON），路径建议：`~/.claude/audit/audit-YYYY-MM-DD.jsonl`

---

## 完整 Schema

```json
{
  "ts": "2026-05-13T14:32:01Z",
  "session_id": "sess-xxxxx",
  "request_id": "req-xxxxx",

  "layer0": {
    "runtime": "clawgod",
    "patched": true,
    "source_version": "2.1.xxx"
  },

  "layer1": {
    "rules_loaded": ["security-research-context", "ctf-context"],
    "active_rules": "ctf-context"
  },

  "layer2": {
    "scene": "ctf-competition",
    "mode": "cwd",
    "confidence": 1.0,
    "skill": null,
    "context_injected": true,
    "injection_content": "ctf-competition 场景声明"
  },

  "layer3": {
    "tool": "Bash",
    "tool_input": {
      "command": "python exploit.py --target 10.10.10.5:8888"
    },
    "target": "10.10.10.5",
    "target_type": "private_network",
    "risk": "medium",
    "action": "allow",
    "reason": "CTF 靶机操作，在授权范围内",
    "rule_id": "ctf-allow-targets"
  },

  "elapsed_ms": 8,
  "result": "tool_executed",
  "output_summary": "exploit 执行成功"
}
```

---

## 字段说明

### 通用字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ts | string (ISO 8601) | 是 | 事件时间戳 |
| session_id | string | 是 | 会话标识 |
| request_id | string | 否 | 请求标识（用于关联） |
| elapsed_ms | number | 否 | 总处理耗时 |
| result | string | 否 | 最终结果描述 |

### Layer 0 — Runtime Patch

| 字段 | 类型 | 说明 |
|------|------|------|
| runtime | string | 运行时类型：clawgod / original |
| patched | boolean | 是否已打补丁 |
| source_version | string | Claude Code 版本 |

### Layer 1 — Session Rules

| 字段 | 类型 | 说明 |
|------|------|------|
| rules_loaded | string[] | 加载的 rules 文件列表 |
| active_rules | string | 当前激活的 rules |

### Layer 2 — Scene Router

| 字段 | 类型 | 说明 |
|------|------|------|
| scene | string | 识别的场景 |
| mode | string | 匹配模式：cwd / llm / keyword |
| confidence | number | 置信度 0.0-1.0 |
| skill | string | 匹配的 Skill 文档 |
| context_injected | boolean | 是否注入了上下文 |

### Layer 3 — Guard

| 字段 | 类型 | 说明 |
|------|------|------|
| tool | string | 工具名称 |
| tool_input | object | 工具输入 |
| target | string | 操作目标 |
| target_type | string | 目标类型：localhost / private_network / public / filesystem |
| risk | string | 风险等级：low / medium / high / critical |
| action | string | 决策：allow / confirm / downgrade / block |
| reason | string | 决策原因 |
| rule_id | string | 匹配的规则 ID |

---

## 最小化日志

如果不实现完整的 Guard，只记录关键事件的最小日志：

```json
{
  "ts": "2026-05-13T14:32:01Z",
  "tool": "Bash",
  "command": "python exploit.py",
  "scene": "ctf-competition",
  "action": "allow"
}
```

即使是最小化日志也比没有日志好。审计的核心是"有记录"，不是"格式完美"。
