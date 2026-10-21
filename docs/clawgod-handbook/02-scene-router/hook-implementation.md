# Scene Router Hook 实现参考

> 本文档提供 Claude Code hooks 的实现参考。
> 给出的是方法思路和配置片段，不是可直接运行的脚本。

---

## Claude Code Hooks 机制

Hooks 是 Claude Code 在特定事件发生时执行的 shell 命令。通过 `settings.json` 或 `settings.local.json` 配置。

### 可用事件

| 事件名 | 触发时机 | 用途 |
|--------|----------|------|
| `SessionStart` | 会话启动 | 初始化环境、加载配置 |
| `UserPromptSubmit` | 用户提交 prompt 后、发送到模型前 | 修改 prompt、注入上下文 |
| `PreToolUse` | 模型决定调用工具后、工具执行前 | 拦截、授权、降级 |
| `PostToolUse` | 工具执行完成后 | 记录、审计 |

### 配置位置

```json
// ~/.claude/settings.json（全局）
// 或 .claude/settings.local.json（项目级）
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": "python /path/to/scene-router.py",
        "timeout": 5000
      }
    ]
  }
}
```

---

## UserPromptSubmit Hook：场景识别

### Hook 输入

Hook 通过 stdin 接收 JSON：

```json
{
  "session_id": "xxx",
  "prompt": "用户输入的内容",
  "cwd": "/home/user/projects/ctf-2026",
  "hook_event_name": "UserPromptSubmit"
}
```

### Hook 输出

Hook 通过 stdout 返回 JSON（可选修改 prompt）：

```json
{
  "prompt": "修改后的 prompt（原样返回或追加内容）",
  "context": "动态注入的上下文"
}
```

### 场景识别脚本参考思路

```
伪代码流程：

1. 从 stdin 读取 JSON
2. 提取 prompt 和 cwd
3. cwd 预设匹配
   - 拆分 cwd 路径段
   - 与映射表做交集
   - 命中 → 返回对应场景上下文
4. LLM 分类（如果 cwd 未命中）
   - 调用轻量模型 API
   - 超时 2s → 跳到关键词匹配
   - 返回判定结果
5. 关键词匹配（如果 LLM 失败）
   - 扫描 prompt 中的关键词
   - 应用否定词过滤
   - 计算得分
6. 根据结果决定是否注入上下文
7. 输出 JSON 到 stdout
```

### 配置片段

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

## 实现选择

### 语言选择

| 语言 | 优势 | 劣势 |
|------|------|------|
| Python | 生态丰富、LLM SDK 就绪 | 启动稍慢（~100ms） |
| Node.js | 与 Claude Code 同栈、启动快 | LLM 调用需额外库 |
| Bash | 零依赖、极轻量 | 复杂逻辑难维护 |

推荐 Python 用于完整实现，Bash 用于简单的 cwd 匹配。

### cwd-only 最简方案

如果只需要 cwd 预设匹配（不需要 LLM 和关键词），一个简单的 shell 脚本就够了：

```bash
#!/bin/bash
# ~/.claude/hooks/scene-router.sh

read -r INPUT
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))")

# cwd 映射
case "$CWD" in
  *ctf*|*CTF*)     SCENE="ctf-competition" ;;
  *pentest*)       SCENE="authorized-pentest" ;;
  *vuln*|*exploit*) SCENE="vuln-analysis" ;;
  *malware*)       SCENE="malware-analysis" ;;
  *forensics*)     SCENE="incident-response" ;;
  *audit*)         SCENE="code-audit" ;;
  *)               SCENE="" ;;
esac

if [ -n "$SCENE" ]; then
  # 注入场景声明到 prompt
  echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['prompt'] = f\"[场景: {json.loads('''$SCENE''')}]\\n\" + data['prompt']
json.dump(data, sys.stdout)
"
else
  echo "$INPUT"
fi
```

---

## 注意事项

1. **Hook 超时**：设置合理的 timeout。LLM 分类超时后应降级到关键词匹配，不应阻塞用户输入
2. **幂等性**：Hook 可能被多次调用，确保逻辑幂等
3. **错误处理**：Hook 出错不应导致 Claude Code 崩溃。脚本异常时直接透传原始 prompt
4. **日志**：建议将路由结果写入日志文件，方便后续审计和调优
