# 多语句执行支持

## 问题
PostgreSQL 的 prepared statement 不支持一次执行多条 SQL（分号分隔），报错：
`cannot insert multiple commands into a prepared statement`

## 需求
1. 支持一次执行多条 SQL（用 `;` 分隔）
2. SELECT 查询结果：用多个 tab 展示每个查询的结果表格
3. DML (INSERT/UPDATE/DELETE) 和 DDL 语句：在控制台消息区输出执行的语句和影响行数

## 改动范围

### 1. Rust 后端 — 数据结构变更

**文件: `src-tauri/src/db/mod.rs`**

```rust
// 单条语句执行结果
#[derive(Serialize, Clone)]
pub struct StatementResult {
    pub sql: String,           // 执行的原始 SQL
    pub columns: Vec<String>,  // SELECT 有列名，DML 为 ["影响行数"]
    pub rows: Vec<Vec<Option<String>>>,  // SELECT 有数据行，DML 为 [[affected]]
    pub affected_rows: u64,
    pub truncated: bool,
    pub is_query: bool,        // true=SELECT/有结果集, false=DML/DDL
    pub error: Option<String>, // 单条语句的执行错误（不阻断后续）
}

// 多语句执行总结果
#[derive(Serialize, Clone)]
pub struct MultiQueryResult {
    pub results: Vec<StatementResult>,
    pub total_duration_ms: u64,  // 总执行耗时
}
```

### 2. Rust 后端 — SQL 拆分逻辑

**文件: `src-tauri/src/db/mod.rs`**

新增 `split_sql(sql: &str) -> Vec<String>` 函数：
- 按 `;` 分割
- 过滤空语句和只包含注释的语句
- 保留每条语句的原始文本（trim 后）

新增 `Driver::execute_multi_query()` 方法：
- 调用 `split_sql()` 拆分
- 逐条执行每个子语句
- 每条执行结果包装为 `StatementResult`
- 遇到某条语句报错，记录到 `error` 字段，**继续执行下一条**（不中断）
- 记录总执行时间

### 3. Rust 后端 — 各 Driver 改造

**文件: `postgres.rs`, `mysql.rs`, `sqlite.rs`**

现有的 `execute_query_async` / `execute_query` 保持不变（作为单语句执行内部方法）。

各 driver 新增 `execute_single(sql: &str) -> Result<StatementResult, String>`：
- 复用现有的 query/fetch_all → execute 逻辑
- 区分 is_query（fetch_all 成功 = true, fallback 到 execute = false）

**文件: `src-tauri/src/commands/query.rs`**

```rust
#[tauri::command]
pub async fn execute_query(sql: String, state: State<'_, AppState>) -> Result<MultiQueryResult, String> {
    // 调用 driver.execute_multi_query(&sql).await
}
```

### 4. 前端 — 类型更新

**文件: `src/hooks/useQuery.ts`**

```typescript
export interface StatementResult {
  sql: string;
  columns: readonly string[];
  rows: readonly (readonly (string | null)[])[];
  affected_rows: number;
  truncated: boolean;
  is_query: boolean;
  error?: string | null;
}

export interface MultiQueryResult {
  results: readonly StatementResult[];
  total_duration_ms: number;
}

// useQuery 的 result 改为 MultiQueryResult | null
```

### 5. 前端 — 结果展示改造

**文件: `src/App.tsx`**

替换当前的 `{result && <ResultGrid result={result} />}` 区域：

- 如果 `results` 中有 `is_query=true` 的语句，渲染 **结果 Tab 区域**：
  - 每个 SELECT 一个 tab，标签显示 `结果 1`, `结果 2`, ... 或截取 SQL 前缀
  - tab 内容复用现有的 `ResultGrid` 组件
  - tab 栏下方显示总耗时

- **控制台消息区**（新增组件 `ConsoleMessages`）：
  - 显示所有 `is_query=false` 的语句执行信息
  - 格式：`> SQL前30字符...` → `影响 3 行 (12ms)`
  - 也显示错误语句：`> SQL前30字符...` → `❌ 错误信息`
  - 样式：类似终端的黑色背景区域，放在结果 tab 下方

### 6. 文件清单

新增文件：
- `src/components/ResultTabs.tsx` — SELECT 结果多 tab 切换
- `src/components/ConsoleMessages.tsx` — DML/DDL 控制台消息输出

修改文件：
- `src-tauri/src/db/mod.rs` — 新增数据结构 + split_sql + execute_multi_query
- `src-tauri/src/db/postgres.rs` — execute_single 方法
- `src-tauri/src/db/mysql.rs` — execute_single 方法
- `src-tauri/src/db/sqlite.rs` — execute_single 方法
- `src-tauri/src/commands/query.rs` — command 签名改为 MultiQueryResult
- `src/hooks/useQuery.ts` — 类型更新
- `src/components/ResultGrid.tsx` — 接收 StatementResult（小改动）
- `src/App.tsx` — 用 ResultTabs + ConsoleMessages 替换原有 ResultGrid
- `src/styles/layout.css` — 控制台消息区样式

## 边界情况
- 单条 SQL（无分号）：行为与现在完全一致，一个 tab 或一条控制台消息
- 空语句：split_sql 过滤掉
- 混合 SELECT + DML：SELECT 结果在 tab 区，DML 在控制台区
- 某条语句报错：记录错误继续执行下一条，不中断
- SQL 中字符串内包含分号：split_sql 需要简单处理（字符串内的分号不拆分）

## 验收标准
- [ ] 粘贴多条 SQL 并执行，不再报 "cannot insert multiple commands" 错误
- [ ] 多个 SELECT 结果可以通过 tab 切换查看
- [ ] DML 语句的执行结果在控制台区显示
- [ ] 单条 SQL 执行行为与改动前一致
- [ ] `cd src-tauri && cargo build` 编译通过
- [ ] `cd src-tauri && cargo test` 通过
- [ ] `npm run build` 前端编译通过
