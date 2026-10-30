# 否定词过滤规则

> 用于关键词匹配时的误伤防护。检测到安全关键词后，检查是否出现否定/学习语境。

---

## 否定触发词

当以下词/短语与安全关键词**同时出现**时，降低或归零场景得分：

### 学习/教学语境

```
学习, 了解, 理解, 认识, 入门, 教程, 笔记, 总结
learn, understand, introduction, tutorial, basics
什么是, 原理是, 怎么理解
```

### 防御/防护语境

```
如何防御, 如何防范, 怎么防止, 防护措施, 安全加固
how to prevent, how to defend, mitigation, hardening
检测方法, 防御方案
```

### 否定/排除语境

```
不要, 不想, 避免, 排除, 不是
don't, avoid, exclude, not trying to, no need to
请不要, 无需
```

## 负样本示例

| 用户输入 | 命中关键词 | 否定原因 | 结果 |
|----------|-----------|----------|------|
| "学习一下 SQL 注入的原理" | SQL 注入 | 学习语境 | 不触发 |
| "如何防御 XSS 攻击" | XSS | 防御语境 | 不触发 |
| "exploit caching for better performance" | exploit | 性能语境，非安全 | 不触发 |
| "不要在代码里硬编码密码" | 密码 | 否定语境 | 不触发 |
| "审计日志的格式是什么" | 审计 | 询问格式，非安全审计 | 不触发 |

## 评分公式

```
base_score = keyword_hit_count × 1.0
negation_penalty = negation_hit_count × 0.5
final_score = max(0, base_score - negation_penalty)

if final_score == 0: 不触发场景注入
if final_score > 0: 触发，注入对应上下文
```

## explicit_pass 保护

当 LLM 分类器已经明确判定为"非安全研究"（`explicit_pass = true`）时，**关键词匹配的结果被完全忽略**。

这防止了一个常见问题：LLM 正确识别 "exploit caching for performance" 不是安全研究，但关键词匹配命中 "exploit" 导致误注入。
