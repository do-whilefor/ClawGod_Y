# Write 工具守卫示例

> 针对文件写入工具的 Guard 策略示例。

---

## 风险分析

Write 工具的风险取决于**写入路径**和**内容**。

### 路径风险分级

| 路径类别 | 风险 | 决策 |
|----------|------|------|
| 项目目录内（cwd 及子目录） | LOW | ALLOW |
| /tmp, 临时目录 | LOW | ALLOW |
| ~/.claude/, ~/.config/ | MEDIUM | ALLOW（配置操作） |
| 项目目录外的用户目录 | MEDIUM | CONFIRM |
| /etc/, /usr/, /System/ | CRITICAL | BLOCK |
| /boot/, /EFI/ | CRITICAL | BLOCK |

### 内容风险分级

| 内容特征 | 风险 | 示例 |
|----------|------|------|
| 代码文件 | LOW | .py, .js, .ts, .go |
| 配置文件 | MEDIUM | .json, .yaml, .toml |
| 脚本文件 | MEDIUM | .sh, .ps1, .bat |
| 二进制文件 | HIGH | .exe, .dll, .so, .elf |
| 系统配置 | CRITICAL | fstab, hosts, passwd |

---

## BLOCK 级规则

```json
[
  {
    "pattern": "^/(etc|usr|boot|EFI|System|Windows)/",
    "reason": "系统目录写入"
  },
  {
    "pattern": "/etc/(passwd|shadow|hosts|fstab)$",
    "reason": "关键系统文件"
  },
  {
    "pattern": "\\.(exe|dll|so|elf)$",
    "reason": "二进制文件写入",
    "note": "安全研究场景可降级为 CONFIRM"
  }
]
```

---

## CONFIRM 级规则

```json
[
  {
    "pattern": "^~/\\.",
    "reason": "用户隐藏配置文件"
  },
  {
    "pattern": "\\.(sh|ps1|bat|cmd)$",
    "reason": "脚本文件写入"
  },
  {
    "pattern": "^(?!.*(/tmp/|/temp/)).*/(?!(node_modules|venv|\\.venv)/)",
    "reason": "项目目录外写入",
    "note": "简化版：非项目目录、非临时目录需确认"
  }
]
```

---

## 场景感知

| 写入目标 | CTF 场景 | 安全研究 | 无场景 |
|----------|----------|----------|--------|
| 项目内 .py | ALLOW | ALLOW | ALLOW |
| /tmp/yara-rule.yar | ALLOW | ALLOW | ALLOW |
| ~/tools/exploit.py | ALLOW | CONFIRM | BLOCK |
| /etc/hosts | BLOCK | BLOCK | BLOCK |
