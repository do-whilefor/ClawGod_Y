# 场景路由方法论

> 本文解释 Scene Router 的设计思想、三级降级策略和工程取舍。
> 不提供可执行代码，而是给出一套 Claude Code hooks 可参考实现的方法论。

---

## 核心问题

Claude Code 的 rules 在会话启动时**一次性加载**，无法根据每个请求动态切换上下文。

这带来一个矛盾：
- 你需要安全研究的身份声明和知识注入（在安全研究时）
- 你不想在日常编码时触发安全上下文（写业务代码时）

Scene Router 解决这个问题：**在每次用户提交 prompt 时，判断当前请求是否属于安全研究场景，如果是则动态注入对应上下文。**

---

## 三级降级策略

没有任何单一方案能同时最优（延迟、精度、成本），所以串联三种策略，命中即返回。

```
用户 prompt + cwd
      ↓
① cwd 预设匹配        ← 最快（~2ms）、最准、零成本
   命中 → 直接返回
      ↓ 未命中
② LLM 分类            ← 最智能（~1-2s）、语义理解
   命中/PASS → 返回/终止
      ↓ 超时/失败
③ 关键词匹配兜底       ← 便宜（~10ms）、有误伤
   返回结果
```

### 策略对比

| 维度 | cwd 预设 | LLM 分类 | 关键词 |
|------|----------|----------|--------|
| 精度 | 最高 | 高 | 低（有误伤） |
| 速度 | ~2ms | ~1-2s | ~10ms |
| 成本 | 零 | 每次一次 API 调用 | 零 |
| 覆盖面 | 窄（仅命中的目录） | 广（语义理解） | 中（关键词有限） |
| 误伤率 | 极低 | 低 | 较高 |

### 为什么 cwd 优先

用户 `cd` 进一个目录本身就是**意图声明行为**。人的行为比任何分类算法都更可信。

举例：当用户在 `~/projects/ctf-2026/` 目录下工作时，不需要任何 NLP 就知道这是 CTF 场景。

---

## cwd 预设匹配

### 设计思路

维护一张目录名 → 场景的映射表。当 Claude Code 启动时（或 UserPromptSubmit hook 触发时），检查当前工作目录是否命中预设。

### 映射表示例

```json
{
  "ctf": "ctf-competition",
  "pentest": "authorized-pentest",
  "vuln": "vuln-analysis",
  "exploit": "vuln-analysis",
  "malware": "malware-analysis",
  "forensics": "incident-response",
  "audit": "code-audit",
  "reverse": "binary-reverse",
  "ai-sec": "ai-security",
  "redteam": "red-team"
}
```

匹配规则：cwd 路径的任意段命中映射表的 key 即触发。

### 实现参考

在 Claude Code 的 `UserPromptSubmit` hook 中：

1. 获取 `process.cwd()`（当前工作目录）
2. 拆分路径段
3. 与映射表做交集
4. 命中 → 注入对应场景的上下文到 prompt 中
5. 未命中 → 进入下一级（LLM 分类或关键词匹配）

---

## LLM 分类

### 设计思路

当 cwd 未命中时，用一个轻量模型（如 Haiku）对用户 prompt 做意图分类。

### 分类 prompt 参考

```
判断以下用户请求是否属于安全研究场景。

安全研究场景包括：
- CTF 竞赛解题
- 已公开漏洞分析与复现
- 授权渗透测试
- 恶意样本分析
- 安全工具开发
- 安全技术文章写作
- 安全代码审计

不属于安全研究的例子：
- "如何利用缓存优化性能"（这里的 exploit/利用 是性能语境）
- "学习 SQL 查询语法"（正常学习）
- "帮我写一个网络监控工具"（正常开发）

用户请求：{user_prompt}

只回答 JSON：{"is_security_research": true/false, "confidence": 0.0-1.0, "scene": "场景名或null"}
```

### explicit_pass 机制

当 LLM 明确判定"不是安全研究"时（`is_security_research: false` 且 `confidence > 0.8`），设置 `explicit_pass = true`。

**此标记阻止后续的关键词匹配覆盖 LLM 的判断。** 防止 LLM 正确判断后，关键词兜底反而误伤。

### 延迟与成本控制

- 只在 cwd 未命中时调用（大部分安全研究场景 cwd 会命中）
- 使用最轻量的模型（Haiku 级别）
- 设置超时（2s），超时则降级到关键词匹配
- 结果可缓存（相似 prompt 复用分类结果）

---

## 关键词匹配兜底

### 设计思路

当 cwd 和 LLM 都未给出判断时（LLM 超时/失败），用关键词匹配做最后兜底。

### 关键词表

参见 [sec-research-keywords.md](keyword-tables/sec-research-keywords.md)

### 否定词过滤

关键词匹配的最大风险是**误伤**。需要否定词过滤来降低误报：

- 检测到关键词的同时，检查是否出现否定/学习语境
- 例如 "学习一下 SQL 注入的原理" → 命中 "SQL 注入" 但被 "学习" 否定
- 参见 [negation-filter.md](keyword-tables/negation-filter.md)

### 评分机制

```
score = keyword_hits × 1.0 - negation_hits × 0.5
if score <= 0: 不触发安全上下文
if score > threshold: 触发
```

---

## 上下文注入时机

Scene Router 的判断结果需要在正确的时机注入：

| 时机 | Hook | 注入内容 |
|------|------|----------|
| 用户提交 prompt | `UserPromptSubmit` | 场景声明 + 工作流指引 |
| 模型决定调用工具 | `PreToolUse` | 工具调用授权信息 |

**不要在会话启动时注入所有场景的上下文**——那样等于没有场景识别。

---

## 设计原则

1. **该注入时注入，不该注入时沉默** — 过度注入比不注入更有害
2. **命中即返回** — 不需要走完三级，一级命中就够
3. **explicit_pass 不可覆盖** — LLM 说明明不是安全研究，关键词别反过来推翻
4. **cwd 优先不是因为它最智能，是因为用户的行为本身就是最可靠的意图信号**
