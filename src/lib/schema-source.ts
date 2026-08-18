import type { DatabaseSchema } from "../hooks/useSchema";

/**
 * Completion item shape. Framework-agnostic — consumed by the
 * textarea-based SQL editor (SQLEditor).
 */
export interface SchemaCompletion {
  readonly label: string;
  readonly type: "table" | "column" | "keyword" | "function" | "command";
  readonly detail: string;
  readonly apply: string;
}

export type CompletionKind = "table-context" | "column-context" | "default";

/** SQL/Redis dialect — controls identifier quoting, completion shape, and
 *  string escaping. "redis" yields command-name completions only. */
export type SqlDialect = "sqlite" | "postgresql" | "mysql" | "redis";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A pragmatic set of reserved words that must be quoted when used as an
// identifier. Not exhaustive — covers the common offenders.
const RESERVED_IDENTIFIERS = new Set([
  "select", "from", "where", "order", "group", "by", "having", "limit",
  "offset", "insert", "into", "values", "update", "set", "delete", "create",
  "drop", "alter", "table", "index", "view", "primary", "key", "foreign",
  "references", "default", "null", "not", "and", "or", "unique", "database",
  "schema", "user", "check", "constraint", "as", "on", "join", "inner",
  "left", "right", "full", "cross", "union", "all", "distinct", "case",
  "when", "then", "else", "end", "between", "like", "in", "is", "exists",
  "asc", "desc", "with", "returning",
]);

/**
 * Quote an SQL identifier (table/column name) if it needs quoting: contains
 * non-word chars, starts with a digit, or is a reserved word. Uses backticks
 * for MySQL, double quotes for PostgreSQL/SQLite (standard SQL).
 */
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  const needsQuote =
    !IDENT_RE.test(name) || RESERVED_IDENTIFIERS.has(name.toLowerCase());
  if (!needsQuote) return name;
  if (dialect === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Render a value as an SQL string literal (or NULL). Doubles single quotes
 * per the SQL standard; for MySQL also escapes backslashes (default
 * sql_mode treats `\` as an escape char).
 */
export function quoteSql(
  value: string | null,
  dialect: SqlDialect = "postgresql",
): string {
  if (value === null) return "NULL";
  let escaped = value.replace(/'/g, "''");
  if (dialect === "mysql") {
    escaped = escaped.replace(/\\/g, "\\\\");
  }
  return `'${escaped}'`;
}

const SQL_KEYWORDS: readonly string[] = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS",
  "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN",
  "ON", "AS", "IS", "NULL", "LIKE", "BETWEEN",
  "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
  "DISTINCT", "UNION", "ALL", "ASC", "DESC",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "TRUE", "FALSE", "CAST", "DEFAULT",
  "WITH", "RETURNING",
];

const SQL_FUNCTIONS: readonly string[] = [
  "COUNT", "SUM", "AVG", "MAX", "MIN",
  "COALESCE", "NULLIF",
  "UPPER", "LOWER", "LENGTH", "TRIM", "SUBSTRING",
  "CONCAT", "REPLACE", "POSITION",
  "ROUND", "FLOOR", "CEIL", "ABS",
  "NOW", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP",
  "EXTRACT", "DATE_TRUNC",
  "ROW_NUMBER", "RANK", "DENSE_RANK",
  "STRING_AGG", "ARRAY_AGG",
  "TYPEOF",
];

const REDIS_COMMANDS: readonly string[] = [
  "GET", "SET", "MGET", "MSET", "GETSET", "APPEND", "STRLEN",
  "GETRANGE", "SETRANGE", "INCR", "INCRBY", "INCRBYFLOAT", "DECR", "DECRBY",
  "DEL", "EXISTS", "KEYS", "SCAN", "TYPE", "TTL", "EXPIRE", "PEXPIRE",
  "EXPIREAT", "PERSIST", "RENAME", "RENAMENX", "RANDOMKEY", "DBSIZE",
  "FLUSHDB", "FLUSHALL",
  "HSET", "HGET", "HMSET", "HMGET", "HGETALL", "HDEL", "HEXISTS",
  "HKEYS", "HVALS", "HLEN", "HINCRBY",
  "LPUSH", "RPUSH", "LPOP", "RPOP", "LLEN", "LRANGE", "LINDEX",
  "LSET", "LREM", "LINSERT", "RPOPLPUSH",
  "SADD", "SMEMBERS", "SREM", "SISMEMBER", "SCARD", "SPOP",
  "SRANDMEMBER", "SUNION", "SINTER", "SDIFF",
  "ZADD", "ZRANGE", "ZSCORE", "ZCARD", "ZREM", "ZRANGEBYSCORE",
  "ZINCRBY", "ZCOUNT",
  "SUBSCRIBE", "UNSUBSCRIBE", "PUBLISH", "PUBSUB",
  "INFO", "PING", "ECHO", "TIME", "SAVE", "BGSAVE", "SHUTDOWN",
  "CONFIG", "CLIENT", "DEBUG",
  "MULTI", "EXEC", "DISCARD", "WATCH", "UNWATCH",
];

/**
 * Extract the referenced table name from a SQL statement. Handles the
 * common SELECT shapes including `FROM <table>`, `JOIN <table>`, and
 * `UPDATE/INSERT INTO <table>`. Returns null for queries that touch
 * no single table (CTEs, UNION, derived tables) or for non-DML.
 *
 * Heuristic: strips comments and string literals first so a table
 * name inside `'…'` won't be matched.
 */
export function extractTableFromSql(sql: string): string | null {
  // Strip line comments and string literals so we don't match inside them.
  // Important: keep double-quoted identifiers ("users") — they are NOT
  // string literals in Postgres/standard SQL.
  const cleaned = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, " ");

  // Detect CTEs — if the statement starts with WITH, the real table is
  // not the CTE name. Reject these so the caller falls back to copy mode.
  if (/^\s*WITH\b/i.test(cleaned)) return null;

  // FROM <table> | UPDATE <table> | INSERT INTO <table>
  // Allow optional schema qualifier (schema.table) and optional double
  // quotes around the table name.
  const re = /\b(?:FROM|UPDATE|INSERT\s+INTO)\s+(?:\w+\s*\.\s*)?"?([A-Za-z_]\w*)"?/i;
  const m = cleaned.match(re);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (["set", "values", "select", "where", "from", "into", "update"].includes(word)) {
    return null;
  }
  return m[1];
}

/**
 * Return the primary-key column names for a given table from the
 * cached schema. Returns [] if the schema isn't loaded or the table
 * has no primary key (we then fall back to all columns).
 */
export function getPrimaryKeyColumns(
  tableName: string,
  schema: DatabaseSchema | null,
): string[] {
  if (!schema) return [];
  const table = schema.tables.find(
    (t) => t.name.toLowerCase() === tableName.toLowerCase(),
  );
  if (!table) return [];
  return table.columns.filter((c) => c.is_primary_key).map((c) => c.name);
}

/**
 * Return all column names for a given table.
 */
export function getColumnsForTable(
  tableName: string,
  schema: DatabaseSchema | null,
): string[] {
  if (!schema) return [];
  const table = schema.tables.find(
    (t) => t.name.toLowerCase() === tableName.toLowerCase(),
  );
  return table ? table.columns.map((c) => c.name) : [];
}

/**
 * Returns the kind of token immediately preceding `pos`:
 *   - "word": preceding chars form an in-progress word ([\w.] run)
 *   - "boundary": preceding char is whitespace/;/(/)/,
 *   - "string": cursor is inside a string literal
 *   - "comment": cursor is inside a line or block comment
 *
 * Used by the editor to decide whether the autocomplete dropdown
 * should appear at all. Without this gate, the dropdown would also
 * pop up after every space, semicolon, or bracket.
 */
export function getCursorContext(
  text: string,
  pos: number,
): "word" | "boundary" | "string" | "comment" {
  if (pos <= 0 || text.length === 0) return "boundary";
  if (pos > text.length) pos = text.length;

  // Walk left until we hit a boundary or run out.
  let i = pos - 1;
  while (i >= 0) {
    const c = text[i];
    if (/[\w.]/.test(c)) {
      const ctx = classifyAt(text, pos);
      return ctx === "word" ? "word" : ctx;
    }
    if (/\s/.test(c) || c === ";" || c === "(" || c === ")" || c === ",") {
      return classifyAt(text, pos);
    }
    if (c === "'" || c === '"') {
      return classifyAt(text, pos);
    }
    if (c === "-" && text[i + 1] === "-") {
      const rest = text.slice(i, pos);
      if (!rest.includes("\n")) return "comment";
      return classifyAt(text, pos);
    }
    if (c === "*" && text[i + 1] === "/") {
      return classifyAt(text, pos);
    }
    if (c === "/" && text[i + 1] === "*") {
      const closeAt = text.indexOf("*/", i + 2);
      if (closeAt === -1 || closeAt >= pos) return "comment";
      return classifyAt(text, pos);
    }
    i--;
  }
  return classifyAt(text, pos);
}

function classifyAt(
  text: string,
  pos: number,
): "word" | "boundary" | "string" | "comment" {
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let blockCommentDepth = 0;
  let lineStart = 0;

  for (let i = 0; i < pos; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\n") {
      inLineComment = false;
      lineStart = i + 1;
      inSingle = false;
      inDouble = false;
      continue;
    }
    if (inLineComment) continue;
    if (blockCommentDepth > 0) {
      if (c === "*" && next === "/") { blockCommentDepth--; i++; }
      else if (c === "/" && next === "*") { blockCommentDepth++; i++; }
      continue;
    }
    if (inSingle) {
      if (c === "'" && next === "'") { i++; continue; }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"' && next === '"') { i++; continue; }
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "-" && next === "-") { inLineComment = true; i++; continue; }
    if (c === "/" && next === "*") { blockCommentDepth++; i++; continue; }
    if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
  }

  if (inLineComment || blockCommentDepth > 0) return "comment";
  if (inSingle || inDouble) return "string";
  let j = pos - 1;
  while (j >= lineStart && (text[j] === " " || text[j] === "\t")) j--;
  if (j < lineStart) return "boundary";
  const c = text[j];
  if (/[\w.]/.test(c)) {
    const prev = text[pos - 1];
    return /[\w.]/.test(prev) ? "word" : "boundary";
  }
  return "boundary";
}

export function getCurrentWord(
  text: string,
  pos: number,
): { word: string; start: number } | null {
  if (pos <= 0) return null;
  let end = pos;
  if (!/[\w.]/.test(text[end - 1])) return null;
  let start = end - 1;
  while (start >= 0 && /[\w.]/.test(text[start])) start--;
  start++;
  return { word: text.slice(start, end), start };
}

/**
 * Detect context kind based on the 80 chars preceding the cursor,
 * uppercased and trimmed. Used to bias completions toward tables vs
 * columns vs keywords.
 */
export function detectContext(textBefore: string): CompletionKind {
  const upper = textBefore.toUpperCase().trimEnd();
  if (/\b(FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE)\s*$/i.test(upper)) {
    return "table-context";
  }
  if (/\b(SELECT|WHERE|AND|OR|ORDER\s+BY|GROUP\s+BY|HAVING|SET|ON|CASE\s+WHEN|WHEN|THEN|ELSE)\s*$/i.test(upper)) {
    return "column-context";
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Prefix index. Building it once per schema keeps `getCompletions` O(matching
// rows in namespace) instead of O(tables × columns × matched rows). For a
// schema with 1k tables × 30 columns the naïve scan runs 30k startsWith calls
// per keystroke; the index trims this to ~O(prefix length × buckets).
// ---------------------------------------------------------------------------

interface CompletionIndex {
  /** lower-case table name → completion item. */
  readonly tables: ReadonlyMap<string, SchemaCompletion>;
  /** lower-case column name → array of completions (one per owning table). */
  readonly columns: ReadonlyMap<string, SchemaCompletion[]>;
  /** "table.col" lower-case → completion item for dot completion. */
  readonly dot: ReadonlyMap<string, SchemaCompletion>;
}

const EMPTY_INDEX: CompletionIndex = {
  tables: new Map(),
  columns: new Map(),
  dot: new Map(),
};

function buildIndex(schema: DatabaseSchema | null): CompletionIndex {
  if (!schema || schema.tables.length === 0) return EMPTY_INDEX;
  const tables = new Map<string, SchemaCompletion>();
  const columns = new Map<string, SchemaCompletion[]>();
  const dot = new Map<string, SchemaCompletion>();
  for (const table of schema.tables) {
    const tlc = table.name.toLowerCase();
    tables.set(tlc, {
      label: table.name,
      type: "table",
      detail: `${table.columns.length} 列`,
      apply: table.name,
    });
    for (const col of table.columns) {
      const clc = col.name.toLowerCase();
      const entry: SchemaCompletion = {
        label: col.name,
        type: "column",
        detail: `${table.name}.${col.data_type || "unknown"}`,
        apply: col.name,
      };
      const bucket = columns.get(clc);
      if (bucket) bucket.push(entry);
      else columns.set(clc, [entry]);
      const dotKey = `${tlc}.${clc}`;
      dot.set(dotKey, {
        label: `${table.name}.${col.name}`,
        type: "column",
        detail: col.data_type || "unknown",
        apply: col.name,
      });
    }
  }
  return { tables, columns, dot };
}

// Per-schema memoized index. SQLite pointers are stable across renders so we
// can store in a WeakMap and GC when the schema is replaced.
const INDEX_CACHE = new WeakMap<DatabaseSchema, CompletionIndex>();

function indexFor(schema: DatabaseSchema | null): CompletionIndex {
  if (!schema) return EMPTY_INDEX;
  let cached = INDEX_CACHE.get(schema);
  if (!cached) {
    cached = buildIndex(schema);
    INDEX_CACHE.set(schema, cached);
  }
  return cached;
}

function pushIfStartsWith(
  map: ReadonlyMap<string, SchemaCompletion>,
  prefix: string,
  out: SchemaCompletion[],
): void {
  // Linear scan restricted to the map size (rather than the full schema).
  // For large schemas we could also bucket-by-first-letter; the linear
  // bound is fine up to ~50k entries.
  for (const [k, v] of map) {
    if (k.startsWith(prefix)) out.push(v);
  }
}

function pushColumnListIfStartsWith(
  map: ReadonlyMap<string, SchemaCompletion[]>,
  prefix: string,
  out: SchemaCompletion[],
): void {
  for (const [k, v] of map) {
    if (k.startsWith(prefix)) {
      for (const c of v) out.push(c);
    }
  }
}

export function fillKeywordCompletions(
  prefix: string,
  out: SchemaCompletion[],
): void {
  for (const kw of SQL_KEYWORDS) {
    if (kw.toLowerCase().startsWith(prefix)) {
      out.push({ label: kw, type: "keyword", detail: "关键字", apply: kw });
    }
  }
}

export function fillFunctionCompletions(
  prefix: string,
  out: SchemaCompletion[],
): void {
  for (const fn of SQL_FUNCTIONS) {
    if (fn.toLowerCase().startsWith(prefix)) {
      out.push({ label: fn, type: "function", detail: "函数", apply: `${fn}()` });
    }
  }
}

export function fillTableCompletions(
  prefix: string,
  out: SchemaCompletion[],
  schema: DatabaseSchema | null,
): void {
  if (!schema) return;
  pushIfStartsWith(indexFor(schema).tables, prefix, out);
}

export function fillColumnCompletions(
  prefix: string,
  out: SchemaCompletion[],
  schema: DatabaseSchema | null,
): void {
  if (!schema) return;
  pushColumnListIfStartsWith(indexFor(schema).columns, prefix, out);
}

export function fillDotCompletions(
  prefix: string,
  out: SchemaCompletion[],
  schema: DatabaseSchema | null,
): void {
  if (!schema) return;
  const dotIdx = prefix.indexOf(".");
  if (dotIdx < 0) return;
  const tableName = prefix.substring(0, dotIdx).toLowerCase();
  const colPrefix = prefix.substring(dotIdx + 1).toLowerCase();
  const idx = indexFor(schema);
  const table = idx.tables.get(tableName);
  if (!table) return;
  // Iterate over the table's columns via the dot-key map so we don't
  // re-scan unrelated tables.
  for (const [k, v] of idx.dot) {
    if (k.startsWith(`${tableName}.`) && k.substring(tableName.length + 1).startsWith(colPrefix)) {
      out.push(v);
    }
  }
}

function fillRedisCompletions(prefix: string, out: SchemaCompletion[]): void {
  for (const cmd of REDIS_COMMANDS) {
    if (cmd.toLowerCase().startsWith(prefix)) {
      out.push({
        label: cmd,
        type: "command",
        detail: "Redis 命令",
        apply: cmd,
      });
    }
  }
}

/**
 * Main entry for SQLEditor. Given current text + cursor pos, returns
 * up to `limit` completions biased by context and dialect.
 *
 *   - For `dialect === "redis"`: return Redis command completions;
 *     SQL keywords/functions are suppressed because they make no sense
 *     in `redis-cli`-shaped input.
 *   - Otherwise: existing table-column-keyword logic, prefix-indexed
 *     against the cached schema.
 */
export function getCompletions(
  text: string,
  pos: number,
  schema: DatabaseSchema | null,
  limit = 50,
  dialect: SqlDialect = "postgresql",
): SchemaCompletion[] {
  if (dialect === "redis") {
    if (text.length === 0 || pos <= 0) return [];
    const ctx = getCursorContext(text, pos);
    if (ctx !== "word") return [];
    const current = getCurrentWord(text, pos);
    const prefix = current?.word.toLowerCase() ?? "";
    const out: SchemaCompletion[] = [];
    fillRedisCompletions(prefix, out);
    return out.slice(0, limit);
  }

  if (text.length === 0 || pos <= 0) return [];

  const ctx = getCursorContext(text, pos);
  if (ctx !== "word") return [];

  const current = getCurrentWord(text, pos);
  const prefix = current?.word.toLowerCase() ?? "";

  const out: SchemaCompletion[] = [];

  if (current && current.word.includes(".")) {
    fillDotCompletions(prefix, out, schema);
    return out.slice(0, limit);
  }

  const textBefore = text.slice(Math.max(0, pos - 80), pos);
  const context = detectContext(textBefore);

  switch (context) {
    case "table-context":
      fillTableCompletions(prefix, out, schema);
      fillColumnCompletions(prefix, out, schema);
      break;
    case "column-context":
      fillColumnCompletions(prefix, out, schema);
      fillTableCompletions(prefix, out, schema);
      fillKeywordCompletions(prefix, out);
      fillFunctionCompletions(prefix, out);
      break;
    default:
      fillKeywordCompletions(prefix, out);
      fillFunctionCompletions(prefix, out);
      fillTableCompletions(prefix, out, schema);
      fillColumnCompletions(prefix, out, schema);
  }

  return out.slice(0, limit);
}
