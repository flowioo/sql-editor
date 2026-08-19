# Security Policy

## 报告漏洞

**请勿**通过公开 Issue 报告安全问题。

发送邮件至 `flowioo@users.noreply.github.com`（或通过 GitHub [Security Advisories](https://github.com/flowioo/sql-editor/security/advisories/new) 私下提报），
标题包含 `[security]`，正文给出：

- 复现步骤 / 最小 demo
- 影响的版本（commit hash 或 tag）
- 期望与实际行为
- 利用条件（需本地用户 / 需物理访问 / 远程触发）

我们会在 **72 小时内** 回复确认；修复按 CVSS 评估的严重度排期。

## 支持的版本

| 版本 | 支持状态 |
|------|----------|
| 0.0.x | ✅ 当前开发版，紧急修复优先 |

## 数据存储约定

| 数据 | 存储位置 |
|------|----------|
| 数据库连接凭证（密码） | **操作系统密钥链**（`keyring` crate） |
| 连接元数据（host/port/user/db） | 应用数据目录 + localStorage |
| Schema 快照 | `app_data_dir/schema_cache.db` |
| 查询文件 | `app_data_dir/queries/<连接>/` |
| AI 对话 | 你配置的代理 URL（默认本机） |

应用本身**不向任何第三方服务发送遥测**。

## 已知风险

- 本工具按用户输入执行任意查询（查询客户端本职）；请只连接你有权访问的数据库
- 默认情况下数据库连接无加密，建议生产库启用 TLS
- 截图脚本基于 mock IPC 运行，文档截图不触及真实网络

详见 [`README.md`](./README.md) 的"安全模型"一节与 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。
