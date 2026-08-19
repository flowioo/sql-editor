# Architecture

## 后端 (Rust / Tauri v2)

模块按领域拆分在 `src-tauri/src/`：

| 目录           | 职责                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `db/`          | 数据库驱动：`sqlite.rs` (rusqlite)、`postgres.rs`、`mysql.rs` (sqlx) + `split_sql` 语句切分状态机 |
| `schema/`      | Schema 内省（`introspect.rs`）、缓存（`cache.rs`、`persist.rs`）、代码库扫描（`scanner.rs`） |
| `commands/`    | Tauri command 注册：`connection` / `query` / `schema` / `files`      |

> **注意：** 不存在 `tunnel/`（SSH）和 `crypto/` 模块——历史上规划过但未实现。如需 SSH 隧道或加密，请新增模块并在本文档登记。

### 驱动分发

驱动通过 `db/mod.rs` 的 `Driver` enum 统一对外暴露：

```rust
pub enum Driver {
    Sqlite(Arc<sqlite::SqliteDriver>),
    Postgres(Arc<postgres::PostgresDriver>),
    MySql(Arc<mysql::MySqlDriver>),
}
```

`execute_multi_query` 在 `mod.rs` 层用 `split_sql` 切分后逐条调用各驱动的 `execute_single`，把结果聚合成 `MultiQueryResult`。`StatementResult`/`QueryResult` 都序列化成 `Vec<Vec<Option<String>>>` 传给前端。

> **已实现** —— `DriverGateway` trait 定义在 `application/ports.rs`，4 个驱动（`sqlite` / `postgres` / `mysql` / `redis`）均已 `impl DriverGateway`，仅提供 `execute_single` + `get_schema` 两个原语；`execute_multi_query` 与 `split_sql` 在 trait 默认实现层。新增驱动只需实现 trait + 工厂注册。

### 凭证存储

数据库密码通过 `keyring` crate 存入**操作系统密钥链**（macOS Keychain / Windows Credential Manager / Linux libsecret），**不落 localStorage**。前端 localStorage 只存连接元数据（host/port/user/db，不含密码）。新增/扩展数据库类型时无需改动凭证逻辑——它以连接 id 为 key，与驱动无关。

## 行值 → 字符串的取值策略

所有 SQL 结果都序列化成 `Vec<Vec<Option<String>>>` 传给前端。

- **SQLite**（`db/sqlite.rs`）：`rusqlite::ValueRef` 用 `match` 分发，覆盖 Integer/Real/Text/Blob/Null。
- **PostgreSQL / MySQL**（`db/postgres.rs`、`db/mysql.rs`）：用 `decode_cell!` 宏（定义在 `db/mod.rs`），对每个 cell 依次 `try_get` 常见类型，命中即返回。

### 关键陷阱：链式 `or_else` 在 sqlx 上不安全

`Row::try_get::<T>` 在类型不匹配时返回 `Err`，**不是** `None`。下面的写法是反模式：

```rust
// ❌ 错误：jsonb / timestamp / bytea 等类型 try_get::<String> 失败时，
// 后续所有 or_else 都被短路，整个 cell 变成 None
let val: Option<String> = row.try_get::<Option<String>, _>(i)
    .ok()
    .or_else(|| row.try_get::<Option<&str>, _>(i).ok().flatten().map(...))
```

正确做法是**每个类型独立 try，命中即返回**（`decode_cell!` 宏就是这么做的）：

```rust
// ✅ 正确：每种类型各自 try，命中即返回
if let Ok(Some(v)) = row.try_get::<Option<String>, _>(i) { return Some(v); }
if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(i) { return Some(v.to_string()); }
// ...
```

> 该宏定义为 `macro_rules!` 而非泛型函数，是因为 sqlx 的 `Row::try_get` trait bound 只能在具体的 Row 类型（`PgRow`/`MySqlRow`）上解析，无法写成 `<R: Row>` 的泛型 helper。

### sqlx features

`Cargo.toml` 实际开启：`runtime-tokio, tls-rustls, postgres, mysql, sqlite, chrono`。

| 类型                          | sqlx feature |
| ----------------------------- | ------------ |
| String / &str / 整数 / 浮点 / 布尔 | 默认     |
| `chrono` 日期/时间            | `chrono`     |
| `Vec<u8>` (bytea / BLOB)      | 默认         |

> 如需支持 `serde_json::Value`（jsonb），在 `Cargo.toml` 的 sqlx features 加 `json`，并在 `decode_cell!` 增加一个分支。

## 前端 (TypeScript + React 19 + Vite)

| 目录           | 职责                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `editor/`      | **自研 SQL 编辑器**：`SQLEditor.tsx`（textarea + 高亮层）、`vim-engine.ts`（Vim 状态机）、`highlight.ts`、`statement.ts` |
| `components/`  | UI 组件：`ResultGrid`、`ConnectionDialog`、`Sidebar`、`AIPanel`、`ui/`（Radix 封装） |
| `hooks/`       | `useConnection`、`useQuery`、`useTabStore`、`useSchema`、`useQueryHistory`、`useVimMode` |
| `lib/`         | `schema-source`（补全 + 标识符引用）、`tokens`（设计 token）           |

> **关于 CodeMirror：** `package.json` 残留 `@codemirror/*` 依赖，但 `SQLEditor` 实际使用**自研 textarea + 语法高亮 div + Vim 引擎**，并未接入 CodeMirror。`lib/schema-source.ts` 的 `schemaCompletionSource` 是为旧 CM6 迁移路径保留的遗留函数，未被 `SQLEditor` 调用。这些残留依赖计划清理。
