# 安全研究关键词表

> 用于 Scene Router 第三级（关键词匹配兜底）。
> 注意：关键词匹配是精度最低的策略，仅作 LLM 超时/失败时的后备。

---

## 高置信关键词

命中任一即高概率为安全研究场景：

```
CTF, ctf, flag, writeup, pwn, web题, 逆向题, 密码题, misc题
CVE, 漏洞分析, 漏洞复现, PoC, exploit, 0day, N-day
渗透测试, pentest, 红队, 授权测试, 靶场
应急响应, 取证, forensics, 恶意样本, malware, IOC
代码审计, 白盒, 静态分析
SQL注入, XSS, SSRF, CSRF, RCE, LFI, RFI, 反序列化
缓冲区溢出, heap overflow, stack overflow, UAF, double free
shellcode, ROP, payload
nmap, burp, sqlmap, nuclei, ffuf, masscan
YARA, sigma, SNORT, suricata
pwntools, GDB, pwndbg, gef, radare2, ghidra, IDA
wireshark, volatility, autopsy
```

## 中等置信关键词

命中后需要结合上下文判断：

```
扫描器, fuzzer, fuzzing
检测规则, 威胁情报
加密, 解密, 密码学, cipher
token, JWT, OAuth, 认证绕过
提权, 权限提升, privilege escalation
后门, backdoor, webshell
钓鱼, phishing
APT, 高级威胁
MITRE ATT&CK, kill chain
HIDS, EDR, SIEM, SOAR
```

## 场景到上下文映射

| 命中场景 | 注入的上下文标识 |
|----------|------------------|
| CTF 相关 | `scene=ctf-competition` |
| CVE/漏洞相关 | `scene=vuln-analysis` |
| 渗透测试相关 | `scene=authorized-pentest` |
| 恶意样本/取证 | `scene=incident-response` |
| 代码审计 | `scene=code-audit` |
| AI/LLM 安全 | `scene=ai-security` |

## 使用建议

1. 关键词表不是越大越好——过多关键词会提高误伤率
2. 高置信关键词可以直接触发场景注入
3. 中等置信关键词需要结合否定词过滤
4. 定期根据实际使用情况调整——添加新的误伤关键词到否定词表
