# Changelog

本项目的所有显著变更都会记录在这里。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.0.1] - 2026-08-19

首个开源版本。

### Added
- 自研 SQL 编辑器（textarea + 语法高亮层 + Vim normal/insert/visual/pending 引擎），替换 CodeMirror
- Schema 自动补全：表名 / 列名 / 关键字 / 函数，支持 `表.列` 点号上下文
- 多语句执行：字符级状态机切分 SQL，逐条执行并聚合结果
- 双驱动支持：SQLite（rusqlite bundled）、PostgreSQL / MySQL（sqlx + rustls）
- Redis 驱动（tokio-comp，key/value/string/hash/list/set 基础渲染）
- OS 密钥链凭证存储（macOS Keychain / Windows Credential Manager / Linux libsecret）
- Schema 缓存（本地 SQLite 快照 + 代码库列描述推断）
- AI 面板（OpenAI 兼容 `/v1/chat/completions`），默认本机代理；非回环地址首次发送须确认；schema 注入 opt-in
- Radix UI 基元层（Dialog / Toast / Tooltip / Dropdown / Popover）+ 设计 token
- 虚拟滚动结果网格 + 单元格直接编辑（按主键生成 UPDATE）
- GitHub Actions CI：frontend + Rust 双平台 × ubuntu/macos（tsc / build / E2E / cargo check / clippy / fmt / test）

### Security
- 密码仅存 OS 密钥链，URL 连接串中的密码在持久化前剥离
- AI 外发白名单：默认回环地址静默；非回环地址首次确认后信任
- 仓库扫描：未发现硬编码 key / secret / token

[Unreleased]: https://github.com/flowioo/sql-editor/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/flowioo/sql-editor/releases/tag/v0.0.1
