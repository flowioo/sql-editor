# 贡献指南

欢迎贡献！提交前请阅读一遍，避免来回返工。

## 开发环境

- Node.js ≥ 20 + [pnpm](https://pnpm.io/) 9
- Rust stable（[安装](https://www.rust-lang.org/tools/install)）
- Tauri v2 系统依赖：[按官方指南](https://v2.tauri.app/start/prerequisites/)
- macOS 需允许 `cargo` 访问 Keychain（首次凭证写入时会弹窗）

## 工作流

1. Fork → 新分支（`feat/xxx` / `fix/xxx` / `docs/xxx`）
2. TDD：先写测试（`pnpm test` 或 `cd src-tauri && cargo test`），跑红 → 写实现 → 跑绿
3. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)
4. 提 PR 前 checklist：
   - [ ] `cd src-tauri && cargo test` 通过
   - [ ] `pnpm run build` 通过（含 `tsc --noEmit` 类型检查）
   - [ ] `pnpm test`（E2E）通过
   - [ ] `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
   - [ ] 用户面文本使用中文
   - [ ] 数据不可变（不修改入参 / 状态机返回新对象）

## 代码规范

详见 `CLAUDE.md`：

- 文件 < 400 行，函数 < 50 行
- 不可变数据模式（React 状态、Tauri 命令返回）
- 错误显式处理，前端对齐用户友好提示
- 输入校验在系统边界做（schema 校验或类型守卫）
- 单元测试覆盖目标 80%+

## 目录速查

```
src/                     前端（TypeScript + React 19 + Vite）
├── editor/              自研编辑器（高亮、Vim 引擎、语句提取）
├── components/          UI 组件
├── domain/              领域模型
├── hooks/               useConnection / useQuery / useTabStore…
└── lib/                 schema-source / credentials / tokens

src-tauri/src/           后端（Rust）
├── db/                  驱动 + split_sql 状态机
├── schema/              内省 / 缓存 / 代码库扫描
├── credentials.rs       OS 密钥链
├── domain/              纯 SQL 域原语
├── application/         ports + 编排
└── commands/            Tauri 命令注册
```

## 提交新数据库驱动

实现 `DriverGateway` trait（`src-tauri/src/application/ports.rs`），提供 `execute_single` + `get_schema`，
在 `db/mod.rs` 工厂注册。详见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 的"驱动分发"一节。

## 行为准则

请遵循 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。
