import type { DatabaseSchema } from "../hooks/useSchema";

/**
 * Completion item shape. Designed to be framework-agnostic so it can be
 * consumed by both CodeMirror (legacy schemaCompletionSource) and the
 * textarea-based vim editor (SQLEditor).
 */
export interface SchemaCompletion {
  readonly label: string;
  readonly type: "table" | "column" | "keyword" | "function";
  readonly detail: string;
  readonly apply: string;
}

export type CompletionKind = "table-context" | "column-context" | "default";

let cachedSchema: DatabaseSchema | null = null;

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

/** Replace the cached schema. Called from App.tsx when useSchema updates. */
export function setSchema(schema: DatabaseSchema | null): void {
  cachedSchema = schema;
}

/** Read-only access for tests and the SQLEditor dropdown. */
export function getCachedSchema(): DatabaseSchema | null {
  return cachedSchema;
}

/**
 * Extract the current word being typed at position.
 * "Current" = the contiguous [\w.] run immediately preceding pos.
 * Returns { word, start } where start is the byte offset of word[0].
 * Returns null if cursor is at a word boundary (waiting for new input).
 */
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
    // Quick word-char test — most common case.
    if (/[\w.]/.test(c)) {
      // Don't trust the word-char in isolation — make sure we're
      // not inside a string or comment. Walk back further to verify.
      // For simplicity, scan again from pos-1 with a proper state
      // machine if we hit word chars inside an unbalanced context.
      // (See classifyAt below.)
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
      // line comment — confirm no newline between i+1 and pos
      const rest = text.slice(i, pos);
      if (!rest.includes("\n")) return "comment";
      return classifyAt(text, pos);
    }
    if (c === "*" && text[i + 1] === "/") {
      // closing */  — we're after a block comment, not inside
      return classifyAt(text, pos);
    }
    if (c === "/" && text[i + 1] === "*") {
      // opening /* — but only "inside" if there's no matching */
      // before pos. We just hit /* so look right for */.
      const closeAt = text.indexOf("*/", i + 2);
      if (closeAt === -1 || closeAt >= pos) return "comment";
      return classifyAt(text, pos);
    }
    i--;
  }
  return classifyAt(text, pos);
}

/**
 * Full state-machine classification at position `pos` in `text`.
 * Walks left tracking string/comment state to determine if `pos`
 * is inside a string or comment. Used as a fallback when the
 * simple left-scan hits a word char or non-state-tracking token.
 */
function classifyAt(
  text: string,
  pos: number,
): "word" | "boundary" | "string" | "comment" {
  // State: walk left, track current context.
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

  // Check what's at pos.
  if (inLineComment || blockCommentDepth > 0) return "comment";
  if (inSingle || inDouble) return "string";
  // Walk back from pos to classify boundary/word.
  let j = pos - 1;
  while (j >= lineStart && (text[j] === " " || text[j] === "\t")) j--;
  if (j < lineStart) return "boundary";
  const c = text[j];
  if (/[\w.]/.test(c)) {
    // j is on word char; check that we're really at end of word, not
    // mid-word where the user is typing — if pos-1 is also word char,
    // we're mid-word (return "word"); if pos-1 is non-word, end-of-word.
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
): void {
  if (!cachedSchema) return;
  for (const table of cachedSchema.tables) {
    if (table.name.toLowerCase().startsWith(prefix)) {
      out.push({
        label: table.name,
        type: "table",
        detail: `${table.columns.length} 列`,
        apply: table.name,
      });
    }
  }
}

export function fillColumnCompletions(
  prefix: string,
  out: SchemaCompletion[],
): void {
  if (!cachedSchema) return;
  for (const table of cachedSchema.tables) {
    for (const col of table.columns) {
      if (col.name.toLowerCase().startsWith(prefix)) {
        out.push({
          label: col.name,
          type: "column",
          detail: `${table.name}.${col.data_type || "unknown"}`,
          apply: col.name,
        });
      }
    }
  }
}

/**
 * Dot notation: "users.na" → returns columns of table 'users' starting
 * with 'na'. Pure — no CodeMirror types.
 */
export function fillDotCompletions(
  prefix: string,
  out: SchemaCompletion[],
): void {
  if (!cachedSchema) return;
  const dotIdx = prefix.indexOf(".");
  if (dotIdx < 0) return;
  const tableName = prefix.substring(0, dotIdx).toLowerCase();
  const colPrefix = prefix.substring(dotIdx + 1).toLowerCase();
  const table = cachedSchema.tables.find(
    (t) => t.name.toLowerCase() === tableName,
  );
  if (!table) return;
  for (const col of table.columns) {
    if (col.name.toLowerCase().startsWith(colPrefix)) {
      out.push({
        label: `${table.name}.${col.name}`,
        type: "column",
        detail: col.data_type || "unknown",
        apply: col.name,
      });
    }
  }
}

/**
 * Main entry for SQLEditor. Given current text + cursor pos, returns
 * up to `limit` completions biased by context.
 *
 * Behavior: if cursor is at a word boundary (e.g. just typed a space),
 * shows default-context completions (keywords/tables/columns).
 * If cursor is mid-word, shows filtered by prefix.
 */
export function getCompletions(
  text: string,
  pos: number,
  limit = 50,
): SchemaCompletion[] {
  if (text.length === 0 || pos <= 0) return [];

  // Gating: only show completions when the cursor is mid-word.
  // After spaces / semicolons / brackets / comments / strings,
  // the user has paused typing — hide the dropdown instead of
  // showing a stale list of unrelated candidates.
  const ctx = getCursorContext(text, pos);
  if (ctx !== "word") return [];

  const current = getCurrentWord(text, pos);
  const prefix = current?.word.toLowerCase() ?? "";

  const out: SchemaCompletion[] = [];

  // Dot notation: users.na → fill columns of 'users'
  if (current && current.word.includes(".")) {
    fillDotCompletions(prefix, out);
    return out.slice(0, limit);
  }

  const textBefore = text.slice(Math.max(0, pos - 80), pos);
  const context = detectContext(textBefore);

  switch (context) {
    case "table-context":
      fillTableCompletions(prefix, out);
      fillColumnCompletions(prefix, out);
      break;
    case "column-context":
      fillColumnCompletions(prefix, out);
      fillTableCompletions(prefix, out);
      fillKeywordCompletions(prefix, out);
      fillFunctionCompletions(prefix, out);
      break;
    default:
      fillKeywordCompletions(prefix, out);
      fillFunctionCompletions(prefix, out);
      fillTableCompletions(prefix, out);
      fillColumnCompletions(prefix, out);
  }

  return out.slice(0, limit);
}

/**
 * Legacy CodeMirror completion source. Kept for T-001b/c migration
 * path so existing CM6 callers don't break. Not used by SQLEditor.
 */
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

export function schemaCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }
  const before = context.state.doc.sliceString(
    Math.max(0, context.pos - 80),
    context.pos,
  );
  const completions = getCompletions(before + " ", before.length + 1);
  if (completions.length === 0) return null;
  return {
    from: word.from,
    options: completions,
    filter: false,
  };
}