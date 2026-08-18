# SQL Query Editor — Tauri v2 + 自研 SQL 编辑器

定位：**本地优先的数据查询平台**（可扩展查询引擎 / 可定制结果组件 / CRUD SQL 自动生成），支持 PostgreSQL / MySQL / SQLite / Redis。

## Architecture
- Frontend: TypeScript + React 19 + Vite，**自研 SQL 编辑器**（textarea + 语法高亮层 + Vim 引擎，非 CodeMirror）
- Backend: Rust + Tauri v2（sqlx 驱动 PG/MySQL，rusqlite 驱动 SQLite，redis crate 驱动 Redis）
- Credentials: 数据库密码经 `keyring` crate 存入 **OS 密钥链**，不落 localStorage
- Local cache: schema_cache.db（SQLite）用于 schema 快照 + 列描述
- AI SQL: 可配置的本地代理（默认 `localhost:8000`）做 NL→SQL 生成

## Key Conventions
- Rust: modules in src-tauri/src/ organized by domain (db/, schema/, commands/)
- TypeScript: code in src/ organized by feature (editor/, components/, hooks/, lib/)
- Immutable data patterns (no in-place mutation)
- Files < 400 lines, functions < 50 lines
- All user-facing text in Chinese

## Commands
- `cd src-tauri && cargo build` — build Rust backend
- `cd src-tauri && cargo test` — run Rust tests
- `pnpm test` — run E2E tests (Playwright)
- `pnpm run dev` — start Vite dev server (frontend only)
- `pnpm run tauri dev` — start Tauri dev server (full app)
- `pnpm run build` — production frontend build
- `pnpm run tauri build` — full production build

## Design Docs
- docs/ARCHITECTURE.md — architecture details (accurate as of current code)
- docs/tech-proposal.html — full technical proposal (open in browser)
- docs/prototype.html — interactive UI prototype (open in browser)
