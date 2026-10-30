# Bash 工具守卫示例

> 针对高风险工具 Bash 的 Guard 策略示例。
> 可作为 PreToolUse hook 的参考配置。

---

## Bash 的特殊性

Bash 工具可以执行任意 shell 命令，是风险最高的工具类型。需要最严格的守卫策略。

---

## 模式匹配规则

### BLOCK 级模式

```
# 文件系统破坏
^rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?/($|\s)
^mkfs\b
^dd\s+.*of=/dev/
^shred\b
^format\s+[A-Z]:

# 凭据操作
cat\s+/etc/shadow
mimikatz
hashdump
secretsdump
keylogger

# 持久化
(crontab|launchctl|schtasks)\s+.*(add|create|load)
reg\s+(add|import).*(HKLM|HKCU)\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run

# 大规模扫描
masscan\s+.*0\.0\.0\.0/0
nmap\s+.*-p-\s+.*10\.\d+\.\d+\.\d+/\d+
```

### CONFIRM 级模式

```
# 网络扫描（非 localhost）
(nmap|masscan|rustscan)\s+(?!.*127\.0\.0\.1)(?!.*localhost)

# 二进制执行
\./\w+\.elf
\./\w+\.bin
python\s+exploit
python\s+poc\.py

# 数据库写操作
(sqlite3|mysql|psql).*\b(DROP|INSERT|UPDATE|DELETE|ALTER)\b

# 包安装
(pip|npm|yarn|pnpm)\s+install\s+
```

### ALLOW 级模式

```
# 安全分析工具
(python|python3)\s+\w*analyze
(file|strings|xxd|hexdump|binwalk)\s+
(yara|clamscan)\s+

# 只读操作
(cat|head|tail|less|more)\s+
(find|grep|rg|ag)\s+
(ls|tree|stat|file)\s+

# 开发工具
(git|docker|kubectl)\s+
(pytest|vitest|jest)\s+
(eslint|flake8|mypy)\s+
```

---

## 目标识别

从命令中提取目标地址，判断风险等级：

```python
# 伪代码
def classify_target(command):
    if "127.0.0.1" in command or "localhost" in command:
        return "localhost", "LOW"
    elif re.match(r"192\.168\.\d+\.\d+", command):
        return "private_network", "MEDIUM"
    elif re.match(r"10\.\d+\.\d+\.\d+", command):
        return "private_network", "MEDIUM"
    elif re.match(r"172\.(1[6-9]|2\d|3[01])\.\d+\.\d+", command):
        return "private_network", "MEDIUM"
    else:
        return "public", "HIGH"
```

---

## 场景感知决策

同一命令在不同场景下的决策不同：

| 命令 | CTF 场景 | 渗透测试 | 漏洞分析 | 无场景 |
|------|----------|----------|----------|--------|
| `nmap -sV localhost` | ALLOW | ALLOW | ALLOW | ALLOW |
| `nmap -sV 192.168.1.0/24` | ALLOW | CONFIRM | CONFIRM | CONFIRM |
| `nmap -sV target.com` | DOWNGRADE | CONFIRM | DOWNGRADE | BLOCK |
| `python exploit.py` | ALLOW | CONFIRM | CONFIRM | BLOCK |
| `rm -rf /` | BLOCK | BLOCK | BLOCK | BLOCK |
