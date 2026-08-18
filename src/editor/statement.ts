/**
 * SQL statement extraction for the Run command.
 *
 * Determines which SQL to execute: the native textarea selection if present,
 * otherwise the statement containing the cursor (split on top-level `;`
 * while respecting string literals and comments), falling back to the full
 * text.
 */

/**
 * Walk text from index 0 to `pos`, tracking SQL context (string literal,
 * block comment, line comment). Returns the byte offset of the last `;`
 * that occurs OUTSIDE any string/comment at or before `pos`, or -1 if
 * none exists. Symmetrical to `findStatementEnd` so we use the same helper
 * to skip over the same kinds of contexts in both directions.
 */
function findStatementStart(text: string, pos: number): number {
  let lastSemi = -1;
  let i = 0;
  const n = Math.min(pos, text.length);
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let blockCommentDepth = 0;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (c === "*" && next === "/") { blockCommentDepth--; i += 2; continue; }
      if (c === "/" && next === "*") { blockCommentDepth++; i += 2; continue; }
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && next === "'") { i += 2; continue; }
      if (c === "'") { inSingle = false; i++; continue; }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"' && next === '"') { i += 2; continue; }
      if (c === '"') { inDouble = false; i++; continue; }
      i++;
      continue;
    }
    if (c === "-" && next === "-") { inLineComment = true; i += 2; continue; }
    if (c === "/" && next === "*") { blockCommentDepth++; i += 2; continue; }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === ";") lastSemi = i;
    i++;
  }
  return lastSemi;
}

/**
 * Walk text from `pos` to end, tracking SQL context, and return the byte
 * offset of the first `;` outside string/comment, or text.length if none
 * (treated as end-of-statement).
 */
function findStatementEnd(text: string, pos: number): number {
  let i = pos;
  const n = text.length;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let blockCommentDepth = 0;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (c === "*" && next === "/") { blockCommentDepth--; i += 2; continue; }
      if (c === "/" && next === "*") { blockCommentDepth++; i += 2; continue; }
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && next === "'") { i += 2; continue; }
      if (c === "'") { inSingle = false; i++; continue; }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"' && next === '"') { i += 2; continue; }
      if (c === '"') { inDouble = false; i++; continue; }
      i++;
      continue;
    }
    if (c === "-" && next === "-") { inLineComment = true; i += 2; continue; }
    if (c === "/" && next === "*") { blockCommentDepth++; i += 2; continue; }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === ";") return i;
    i++;
  }
  return n;
}

/**
 * Skip leading whitespace + line comments at `i`. Returns the next
 * non-whitespace, non-line-comment index.
 */
function skipLeadingNoise(text: string, i: number): number {
  const n = text.length;
  let j = i;
  while (j < n) {
    const c = text[j];
    if (/\s/.test(c)) { j++; continue; }
    if (c === "-" && text[j + 1] === "-") {
      const nl = text.indexOf("\n", j);
      j = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && text[j + 1] === "*") {
      const end = text.indexOf("*/", j + 2);
      j = end === -1 ? n : end + 2;
      continue;
    }
    break;
  }
  return j;
}

/**
 * Find the SQL statement that contains position `pos`. Splits on `;`
 * while respecting string literals ('...' / "..."), line comments (-- ...),
 * and block comments. Returns the trimmed statement text, or '' if no
 * non-empty statement exists.
 */
function extractCurrentStatement(text: string, pos: number): string {
  // Clamp pos into the text so we still work when the textarea cursor is
  // at EOF (selectionStart can equal value.length).
  const p = Math.max(0, Math.min(pos, text.length));

  // Walk left of p looking for the previous top-level ';'. We use the same
  // block-comment/string-tracker as the right scan so ';' inside either
  // is correctly skipped.
  let leftStart = 0;
  const lastSemi = findStatementStart(text, p);
  if (lastSemi !== -1) leftStart = skipLeadingNoise(text, lastSemi + 1);

  // Walk right of p looking for the next top-level ';'.
  let rightEnd = findStatementEnd(text, p);

  const stmt = text.slice(leftStart, rightEnd).trim();
  return stmt;
}

/**
 * Returns the SQL that should be executed for a Run command:
 *   1. if the user has a non-empty native textarea selection, use it
 *   2. otherwise, the statement containing the cursor (split on `;`)
 *   3. if neither yields content, fall back to the full text
 */
export function getSqlToExecute(ta: HTMLTextAreaElement): string {
  if (ta.selectionStart !== ta.selectionEnd) {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel.trim()) return sel;
  }
  const stmt = extractCurrentStatement(ta.value, ta.selectionStart);
  if (stmt) return stmt;
  return ta.value;
}
