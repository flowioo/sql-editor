# sql-editor — 核心稳定可扩展的数据查询工具

中文 | [English](./README.en.md)

> 一款核心稳定、可扩展的本地优先数据查询工具，专注**管理你的数据源**。基于 Tauri v2 + Rust 构建，资源占用远低于 Electron 类方案。
> 三条核心支柱：**可扩展的查询引擎**、**数据源管理**、**无缝对接 Agent**。目前支持 PostgreSQL / MySQL / SQLite / Redis。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](./.github/workflows/ci.yml)

## 预览

![主编辑器与查询结果](./docs/images/01-main-editor.png)

> 上图：自研 SQL 编辑器（语法高亮 + Vim normal 模式）+ 多语句结果 + 主键驱动单元格编辑。
> 全部截图位于 [`docs/images/`](./docs/images)，由 `tests/screenshots.spec.ts` 用 Playwright + mock IPC 生成。

| | |
|:---:|:---:|
| ![数据库结构](./docs/images/02-schema-tree.png) | ![Vim 引擎](./docs/images/04-vim-mode.png) |
| 侧栏连接项 ⋯ 菜单 + 展开的数据库结构 | Vim normal / insert / 算子待发 |

| | |
|:---:|:---:|
| ![连接对话框](./docs/images/03-connection-dialog.png) | ![AI 面板](./docs/images/05-ai-panel.png) |
| 多类型连接表单 | AI 集成（待实现，见 Roadmap） |

### 语法高亮

![语法高亮动效](./docs/images/highlight.gif)

> 上图：键入 SQL 时关键字 / 字符串 / 数字 / 标识符逐 token 实时着色。
> 由 `tests/gif.spec.ts` 用 Playwright + ffmpeg 生成，跑 `GIF=1 pnpm exec playwright test tests/gif.spec.ts` 可重拍。

## 平台架构

本项目按"平台"而非"工具"设计，三条核心支柱：

### 1. 查询引擎可扩展

统一的查询 / Schema 内省接口，新增一种后端只需实现一个驱动，前端编辑器、补全、结果网格随即可用：

- 已内置：SQLite（rusqlite）、PostgreSQL、MySQL（sqlx）、Redis
- **Driver trait 化已完成**：统一接口 `DriverGateway`（`execute_single` / `get_schema`），多语句编排 `execute_multi_query` 共享；新增驱动只需实现 trait。

### 2. 数据源管理

把"连接 + 凭据 + 结构 + 查询历史"视为一等公民，所有数据按连接隔离：

- 连接：本地列表 + 凭据存 OS 密钥链（macOS Keychain / Windows Credential Manager / Linux libsecret）
- Schema：本地 SQLite 缓存 + 代码库列描述推断，离线浏览
- 查询历史：按连接隔离的 `.sql` 文件，自动保存到 `app_data_dir/queries/<连接>/`
- 结果操作：单元格直接编辑 → 按主键自动生成 `UPDATE`
- 所有 UI 操作不离开本地，零遥测

### 3. 无缝对接 Agent

把查询工具变成 Agent 友好的子进程 / HTTP 端点，便于 Claude Code / Codex / pi 等 Agent 调用：

- **本地 shell 调用**（首选）：把 sql-editor 当成命令调用，stdin 投 SQL / 参数，stdout 取结构化结果
- **HTTP 端点**（可选）：暴露本地服务端口，Agent 远程发起查询
- **结构化输出**：JSON / TSV / Markdown 表格可选，避免无意义转义
- **Agent 视角设计**：错误信息针对 LLM 优化（带类型、列、行号），让 Agent 能自我修正

## 系统架构图

```mermaid
flowchart LR
  subgraph UI[前端 · React 19 + Vite]
    direction TB
    Editor["自研 SQL 编辑器<br/>textarea + 高亮层 + Vim 引擎"]
    Sidebar["侧栏<br/>连接 / 数据库结构 / 历史 / 文件"]
    Results["结果网格<br/>虚拟滚动 + 单元格编辑"]
    AIPanel["AI 面板<br/>(本地 shell 调用 cc / codex / pi)"]
    Settings["设置<br/>localStorage 持久化"]
  end

  subgraph IPC["IPC 层 · Tauri v2 invoke"]
    Cmd["commands::query / connection /<br/>schema / files"]
  end

  subgraph Backend[后端 · Rust]
    direction TB
    Domain["domain::sql<br/>字符级状态机切分 + 分类"]
    Drivers["db::<br/>SQLite · Postgres · MySQL · Redis"]
    Gateway["DriverGateway trait<br/>execute_single + get_schema"]
    Creds["credentials.rs<br/>OS 密钥链 (keyring)"]
    Cache["schema_cache.db<br/>本地结构快照"]
    Scanner["schema::scanner<br/>代码库列描述推断"]
  end

  DBs[(PostgreSQL<br/>MySQL<br/>SQLite<br/>Redis)]

  Editor --> Cmd
  Sidebar --> Cmd
  Results --> Cmd
  AIPanel -. shell 调用 .-> Cmd
  Cmd --> Gateway
  Gateway --> Drivers
  Drivers --> DBs
  Cmd --> Domain
  Cmd --> Creds
  Cmd --> Cache
  Cmd --> Scanner
  Settings --> Cmd
```

## 特性

- **自研 SQL 编辑器**：基于 textarea + 语法高亮层，内置 Vim 模式引擎（normal/insert/visual/pending）。
- **Schema 自动补全**：表名 / 列名 / 关键字 / 函数，支持 `表.列` 点号上下文。
- **多语句执行**：字符级状态机切分 SQL，逐条执行并聚合结果。
- **Schema 缓存**：本地 SQLite 缓存数据库结构快照，离线浏览 + 列描述扫描（从代码库推断列含义）。

## 安全模型

请务必阅读本节——它决定了你的数据如何被处理。

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| 数据库连接凭证（密码） | **操作系统密钥链**（macOS Keychain / Windows Credential Manager / Linux libsecret） | 密码**绝不**写入 localStorage 或明文文件（URL 连接串中的密码也会在持久化前剥离） |
| 连接元数据（host/port/user/db） | 应用数据目录 + localStorage | 不含密码 |
| Schema 快照 | `app_data_dir/schema_cache.db`（本地 SQLite） | 仅本地 |
| 查询文件（`.sql`） | `app_data_dir/queries/<连接>/` | 按连接隔离 |

**网络行为：**
- 查询直连你指定的数据库（按需 TLS，建议生产库启用）。
- 应用本身不向任何第三方服务发送遥测。

**执行边界：** 本工具按用户输入执行任意查询（这是查询客户端的本职）。请只连接你有权访问的数据库。

## 数据库支持

| 数据库 | 状态 | 驱动 |
|--------|------|------|
| SQLite | ✅ 完整 | rusqlite（bundled） |
| PostgreSQL | ✅ 完整 | sqlx + rustls |
| MySQL | ✅ 完整 | sqlx + rustls |
| Redis | ✅ 可用（已知限制） | redis（tokio-comp） |

> 新增数据库类型的工作量见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 安装与构建

### 前置要求

- [Node.js](https://nodejs.org/) ≥ 20 + [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- Tauri v2 系统依赖：[按官方指南安装](https://v2.tauri.app/start/prerequisites/)

### 开发

```bash
pnpm install
pnpm run tauri dev
```

### 生产构建

```bash
pnpm run tauri build
```

产物在 `src-tauri/target/release/bundle/`。

## 项目结构

```
src/                     # 前端（TypeScript + React 19 + Vite）
├── editor/              # 自研编辑器（高亮、Vim 引擎、语句提取）
├── components/          # UI 组件（ResultGrid、ConnectionDialog、Sidebar…）
│   ├── results/         # 结果渲染器（JSON 等）
│   └── ui/              # Radix UI 封装（Dialog / DropdownMenu / Toast / Tooltip…）
├── domain/              # 领域模型（连接、结果集）
├── hooks/               # useConnection / useQuery / useTabStore / useSchema…
├── lib/                 # IPC / 凭证 / schema-source / tokens
└── styles/              # CSS 样式（按组件拆分）

src-tauri/src/           # 后端（Rust）
├── db/                  # 驱动：sqlite / postgres / mysql / redis + split_sql 状态机
├── schema/              # 内省 / 缓存 / 代码库扫描
├── credentials.rs       # OS 密钥链存取
├── application/         # ports + 编排（DriverGateway trait）
├── commands/            # Tauri 命令：connection / query / schema / files
└── domain/              # 纯 SQL 域原语（splitter / classifier）
```

详见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## Roadmap

- [ ] **CRUD SQL 生成完整化**：行级 `INSERT` / `DELETE`、变更预览确认
- [ ] **结果组件配置**：JSON / 表格 / 图表渲染器，组件注册机制
- [ ] **AI 集成**：本地 shell 调用 Agent（如 `cc` / `codex` / `pi`），全程不外发（产品形式与边界 TBD）
- [ ] 快捷键配置层（数据驱动 key→action 映射）
- [ ] 设置中心（主题、字体统一持久化）
- [ ] 明暗主题切换（token 已就绪，待加 `[data-theme]` 作用域）

## 为什么不用 VSCode / 为什么自己造

| 维度 | VSCode + SQL 插件 | 本项目 |
|---|---|---|
| 资源占用 | Electron，~300-500 MB 内存常驻 | Tauri v2 + Rust 后端，~30-80 MB |
| 多数据库 | 各自独立的扩展，体验割裂 | 统一 `DriverGateway` trait，UI / 补全 / 结果网格代码共用 |
| 查询专用 UI | 通用编辑器 + 插件式补全 | 数据库优先：侧栏连接 + 结构树 + 结果网格 + 单元格编辑 |
| Agent 友好 | 没有标准化接口 | shell 调用 + 结构化输出，Agent 可直接调用 |
| 凭据安全 | 写在 settings.json 或依赖扩展 | OS 密钥链，URL 密码自动剥离，零 localStorage |

主要论点是：**VSCode 是通用编辑器，强行塞数据库查询**。我们要的是**核心稳定的数据查询工具**，Tauri + Rust 给到 `30 MB` 内存 + 类原生速度，加 `DriverGateway` trait 化后可扩展性不输插件生态。

## 开发指南

```bash
cd src-tauri && cargo build     # 构建后端
cd src-tauri && cargo test      # 运行后端测试
pnpm run dev                     # 启动 Vite dev server
pnpm test                        # 运行 E2E（Playwright）
pnpm run build                   # 生产构建
SCREENSHOTS=1 pnpm test tests/screenshots.spec.ts   # 重新生成 docs/images/*.png
```

代码规范见 [CLAUDE.md](./CLAUDE.md)（不可变数据、文件 < 400 行、函数 < 50 行、用户面文本中文化）。

## 贡献

欢迎 Issue 和 PR。提交前请确保：

1. `cd src-tauri && cargo test` 通过
2. `pnpm run build` 通过（含 `tsc` 类型检查）
3. 遵循现有代码风格与不可变数据模式
4. 用户面文本使用中文

## License

[MIT](./LICENSE)
