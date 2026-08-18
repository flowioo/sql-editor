/**
 * SQL/Redis syntax highlighter — single-pass tokenizer + HTML renderer.
 *
 * Configuration is dialect-driven via `DialectProfile`:
 *   - `keywords`     — set of reserved words rendered as keywords
 *   - `functions`    — set of identifier-followed-by-`(` function names
 *   - `stringDelims` — single-char string delimiters (default `["'"]`)
 *   - `commentStart` — single-char line-comment prefix (default `"-"`)
 *   - `identifierQuotes` — single-char identifier wrappers (default `['"', "`]`)
 *
 * Adding a new dialect is `O(1)`: write a profile object, register it in
 * `DIALECTS`, and the existing tokenizer / renderer picks it up unchanged.
 */

export interface DialectProfile {
  readonly name: string;
  readonly keywords: ReadonlySet<string>;
  readonly functions: ReadonlySet<string>;
  /** Single-char string delimiters. Default `["'"]`. */
  readonly stringDelims?: readonly string[];
  /** Single-char line-comment prefix. Default `"-"` (so `--` opens). */
  readonly commentStart?: string;
  /** Single-char identifier wrappers. Default `['"', "`]`. */
  readonly identifierQuotes?: readonly string[];
}

const POSTGRESQL: DialectProfile = {
  name: "postgresql",
  keywords: new Set([
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS",
    "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "ON", "AS",
    "IS", "NULL", "LIKE", "BETWEEN", "GROUP", "BY", "ORDER", "HAVING",
    "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
    "DELETE", "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
    "DISTINCT", "UNION", "ALL", "ASC", "DESC", "CASE", "WHEN", "THEN",
    "ELSE", "END", "TRUE", "FALSE", "CAST", "DEFAULT",
    "WITH", "RETURNING", "USING", "EXCEPT", "INTERSECT",
    "WINDOW", "LATERAL", "ILIKE",
  ]),
  functions: new Set([
    "COUNT", "SUM", "AVG", "MAX", "MIN", "COALESCE", "NULLIF", "CAST",
    "ROUND", "CEIL", "FLOOR", "ABS", "LENGTH", "UPPER", "LOWER",
    "TRIM", "SUBSTRING", "CONCAT", "REPLACE", "NOW", "CURRENT_DATE",
    "CURRENT_TIMESTAMP", "DATE_PART", "EXTRACT", "TO_CHAR", "TO_DATE",
    "ROW_NUMBER", "RANK", "DENSE_RANK", "STRING_AGG", "ARRAY_AGG",
  ]),
  // Postgres treats "Foo" as an identifier by default, not a string — both
  // behaviours share the same lexer path here.
  identifierQuotes: ['"', '"'],
};

const MYSQL: DialectProfile = {
  name: "mysql",
  keywords: new Set([
    ...POSTGRESQL.keywords,
    "SHOW", "DESCRIBE", "EXPLAIN", "USE", "DATABASE", "RENAME",
    "TRUNCATE", "REPLACE", "DELAYED", "IGNORE", "DUAL",
  ]),
  functions: POSTGRESQL.functions,
  // MySQL line comments start with `--` (same as PG) AND `#`.
  commentStart: "-",
  identifierQuotes: ["`"],
};

const SQLITE: DialectProfile = {
  ...POSTGRESQL,
  name: "sqlite",
  keywords: new Set([...POSTGRESQL.keywords, "WITHOUT", "ROWID"]),
};

const REDIS_COMMANDS = [
  // strings
  "GET", "SET", "MGET", "MSET", "GETSET", "APPEND", "STRLEN", "GETRANGE", "SETRANGE",
  // keys
  "DEL", "EXISTS", "KEYS", "SCAN", "TYPE", "TTL", "EXPIRE", "PEXPIRE",
  "EXPIREAT", "PERSIST", "RENAME", "RENAMENX", "RANDOMKEY", "DBSIZE", "FLUSHDB", "FLUSHALL",
  // counters
  "INCR", "INCRBY", "INCRBYFLOAT", "DECR", "DECRBY",
  // hash
  "HSET", "HGET", "HMSET", "HMGET", "HGETALL", "HDEL", "HEXISTS", "HKEYS", "HVALS", "HLEN", "HINCRBY",
  // list
  "LPUSH", "RPUSH", "LPOP", "RPOP", "LLEN", "LRANGE", "LINDEX", "LSET", "LREM", "LINSERT", "RPOPLPUSH",
  // set
  "SADD", "SMEMBERS", "SREM", "SISMEMBER", "SCARD", "SPOP", "SRANDMEMBER", "SUNION", "SINTER", "SDIFF",
  // sorted set
  "ZADD", "ZRANGE", "ZSCORE", "ZCARD", "ZREM", "ZRANGEBYSCORE", "ZINCRBY", "ZCOUNT",
  // pub/sub
  "SUBSCRIBE", "UNSUBSCRIBE", "PUBLISH", "PUBSUB",
  // server
  "INFO", "PING", "ECHO", "TIME", "SAVE", "BGSAVE", "SHUTDOWN", "CONFIG", "CLIENT", "DEBUG",
  // generic
  "MULTI", "EXEC", "DISCARD", "WATCH", "UNWATCH",
];

const REDIS: DialectProfile = {
  name: "redis",
  // No "keywords" in the SQL sense — every command is also a function call.
  keywords: new Set(REDIS_COMMANDS),
  functions: new Set(REDIS_COMMANDS),
  // Redis has no comments per se; treat `#` as a line-comment for ergonomic
  // shells that wrap commands with descriptions.
  commentStart: "#",
  stringDelims: ['"', "'"],
  identifierQuotes: [],
};

export const DIALECTS: Record<string, DialectProfile> = {
  postgresql: POSTGRESQL,
  mysql: MYSQL,
  sqlite: SQLITE,
  redis: REDIS,
};

/** Resolve a dialect by name (case-insensitive). Falls back to postgresql. */
export function resolveDialect(name?: string | null): DialectProfile {
  if (!name) return POSTGRESQL;
  const k = name.toLowerCase();
  return DIALECTS[k] ?? POSTGRESQL;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type Token =
  | { kind: "string"; text: string }
  | { kind: "identifier"; text: string }
  | { kind: "number"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "operator"; text: string }
  | { kind: "whitespace"; text: string };

// Single-pass tokenizer against a profile. Output tokens are HTML-safe; the
// renderer decides keyword / function / plain based on identifier text.
function tokenize(text: string, profile: DialectProfile): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  const stringDelims = profile.stringDelims ?? ["'"];
  const idQuots = profile.identifierQuotes ?? ['"', "`"];
  const commentStart = profile.commentStart ?? "-";

  const push = (kind: Token["kind"], t: string) => {
    if (t.length > 0) tokens.push({ kind, text: t } as Token);
  };

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];

    // Line comment: <commentStart><commentStart> to EOL (Redis uses `#`)
    if (c === commentStart && next === commentStart) {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      push("comment", text.slice(i, j));
      i = j;
      continue;
    }

    // Block comment: /* ... */ (all SQL dialects; Redis typically not used)
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      push("comment", text.slice(i, j));
      i = j;
      continue;
    }

    // String literals — delimited by any of the profile's `stringDelims`.
    if (stringDelims.includes(c)) {
      const delim = c;
      let j = i + 1;
      while (j < n) {
        if (text[j] === delim && text[j + 1] === delim) { j += 2; continue; }
        if (text[j] === delim) { j++; break; }
        j++;
      }
      push("string", text.slice(i, j));
      i = j;
      continue;
    }

    // Quoted identifiers (MySQL backtick, Postgres double-quote, ...)
    if (idQuots.includes(c)) {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (text[j] === q && text[j + 1] === q) { j += 2; continue; }
        if (text[j] === q) { j++; break; }
        j++;
      }
      push("identifier", text.slice(i, j));
      i = j;
      continue;
    }

    // Number: digits with optional underscores, decimal, exponent
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9_]/.test(text[j])) j++;
      if (text[j] === ".") {
        j++;
        while (j < n && /[0-9_]/.test(text[j])) j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < n && /[0-9]/.test(text[j])) j++;
      }
      push("number", text.slice(i, j));
      i = j;
      continue;
    }

    // Identifier / keyword / function: [A-Za-z_][A-Za-z0-9_]*
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
      push("identifier", text.slice(i, j));
      i = j;
      continue;
    }

    // Whitespace run
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      push("whitespace", text.slice(i, j));
      i = j;
      continue;
    }

    // Operator / punctuation: single char for safety
    push("operator", c);
    i++;
  }

  return tokens;
}

// Render tokens to HTML. Identifiers become keyword spans when upper match
// is in profile.keywords; identifier + `(` becomes a function span.
function renderTokens(tokens: Token[], profile: DialectProfile): string {
  const out: string[] = [];
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    const safe = escapeHtml(t.text);
    switch (t.kind) {
      case "string":
      case "comment":
      case "number":
        out.push(`<span class="sql-${t.kind}">${safe}</span>`);
        break;
      case "identifier": {
        let next = idx + 1;
        while (next < tokens.length && tokens[next].kind === "whitespace") next++;
        const isFunc = tokens[next]?.kind === "operator" && tokens[next].text === "("
          && profile.functions.has(t.text.toUpperCase());
        if (isFunc) {
          out.push(`<span class="sql-function">${safe}</span>`);
        } else if (profile.keywords.has(t.text.toUpperCase())) {
          out.push(`<span class="sql-keyword">${safe}</span>`);
        } else if (t.text.startsWith('"') || t.text.startsWith("`") || t.text.startsWith("'")) {
          // Quoted identifier in any dialect — single quote here is technically
          // handled as a string, so guard against the rare `'name'` lexer case.
          out.push(`<span class="sql-identifier">${safe}</span>`);
        } else {
          out.push(safe);
        }
        break;
      }
      case "operator":
      case "whitespace":
        out.push(safe);
        break;
    }
  }
  return out.join("");
}

/**
 * Highlight text using the named dialect. When `dialect` is omitted or
 * unrecognised, falls back to postgresql.
 *
 * Trailing newline: a textarea renders a trailing empty line below the
 * final newline; without a corresponding extra span in the overlay the
 * two layers desync (cursor "floats" above empty line). We append an
 * invisible zero-width marker so the overlay gets one extra row of height.
 */
export function highlightSQL(text: string, dialect?: string | null): string {
  const profile = resolveDialect(dialect);
  if (!text) return ""; // single zero-width space so height > 0
  const rendered = renderTokens(tokenize(text, profile), profile);
  // Preserve a trailing newline's empty line so textarea `pre-wrap` rows
  // line up between textarea and overlay.
  if (text.endsWith("\n")) return rendered + "\n";
  return rendered;
}
