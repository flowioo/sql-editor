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
- Schema 缓存（本地 SQLite 快照）
- Radix UI 基元层（Dialog / Toast / Tooltip / Dropdown / Popover）+ 设计 token
- 虚拟滚动结果网格 + 单元格直接编辑（按主键生成 UPDATE）
- GitHub Actions CI：frontend + Rust 双平台 × ubuntu/macos（tsc / build / E2E / cargo check / clippy / fmt / test）
- Dependabot：npm + Cargo + GitHub Actions 周更

### Changed
- 连接操作收进 ⋯ 下拉菜单（连接 / 编辑 / 复制 / 删除），侧栏由 4 按钮简化为 1 ⋯
- 项目定位：**核心稳定可扩展的数据查询工具**，三条支柱——可扩展查询引擎 / 数据源管理 / 无缝对接 Agent
- README：新增「为什么不用 VSCode / 单独造轮子」对比；中英双语
- README 预览：从 5 张静态截图改为 4 张静态 + 1 个语法高亮 GIF（Playwright + ffmpeg 生成）

### Removed
- 代码库扫描与列描述推断（Toolbar `扫描代码` / `刷新结构` 按钮、`useCodebaseScan` hook、`scan_codebase` Tauri 命令、`schema/scanner.rs`）
- AI 对话面板（迁移到 Roadmap，作为后续 Agent shell 调用的中间态）
- Tauri 未引用的图标（iOS 18 / Android 16 / Windows Store 9 / StoreLogo 1），从 1.2 MB → 200 KB

### Security
- 密码仅存 OS 密钥链，URL 连接串中的密码在持久化前剥离
- 仓库扫描：未发现硬编码 key / secret / token

[Unreleased]: https://github.com/flowioo/sql-editor/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/flowioo/sql-editor/releases/tag/v0.0.1
