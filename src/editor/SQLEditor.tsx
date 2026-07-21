import { useRef, useEffect, useState, useCallback } from "react";
import {
  motions,
  textObjects,
  operators,
  createVimState,
  type VimMode,
  type OperatorType,
  type MotionResult,
} from "./vim-engine";
import {
  getCompletions,
  type SchemaCompletion,
} from "../lib/schema-source";
import "../styles/editor.css";

interface SQLEditorProps {
  readonly content: string;
  readonly enableVim: boolean;
  readonly getContentRef?: React.MutableRefObject<(() => string) | null>;
  readonly getSqlToExecuteRef?: React.MutableRefObject<(() => string) | null>;
  readonly onRun?: () => void;
  readonly onModeChange?: (mode: VimMode) => void;
  readonly onContentChange?: (content: string) => void;
}

// SQL Keywords for highlighting
const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "ON", "AS",
  "IS", "NULL", "LIKE", "BETWEEN", "GROUP", "BY", "ORDER", "HAVING",
  "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
  "DISTINCT", "UNION", "ALL", "ASC", "DESC", "CASE", "WHEN", "THEN",
  "ELSE", "END", "TRUE", "FALSE", "CAST", "DEFAULT",
  "COALESCE", "NULLIF", "COUNT", "SUM", "AVG", "MAX", "MIN",
]);

// Common SQL functions (uppercase comparison; rendered uppercase in output)
const SQL_FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MAX", "MIN", "COALESCE", "NULLIF", "CAST",
  "ROUND", "CEIL", "FLOOR", "ABS", "LENGTH", "UPPER", "LOWER",
  "TRIM", "SUBSTRING", "CONCAT", "REPLACE", "NOW", "CURRENT_DATE",
  "CURRENT_TIMESTAMP", "DATE_PART", "EXTRACT", "TO_CHAR", "TO_DATE",
]);

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

// Single-pass tokenizer. Output tokens are HTML-safe; keywords/functions
// resolved at render time so case is preserved while matching case-insensitive.
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;

  const push = (kind: Token["kind"], t: string) => {
    if (t.length > 0) tokens.push({ kind, text: t } as Token);
  };

  while (i < n) {
    const c = text[i];

    // Line comment: -- to EOL
    if (c === "-" && text[i + 1] === "-") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      push("comment", text.slice(i, j));
      i = j;
      continue;
    }

    // Block comment: /* ... */
    if (c === "/" && text[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      push("comment", text.slice(i, j));
      i = j;
      continue;
    }

    // Single-quoted string with '' escape
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") { j++; break; }
        j++;
      }
      push("string", text.slice(i, j));
      i = j;
      continue;
    }

    // Double-quoted identifier (Postgres/standard SQL)
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"' && text[j + 1] === '"') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      push("identifier", text.slice(i, j));
      i = j;
      continue;
    }

    // Backtick identifier (MySQL)
    if (c === "`") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "`" && text[j + 1] === "`") { j += 2; continue; }
        if (text[j] === "`") { j++; break; }
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
// is in SQL_KEYWORDS; otherwise plain text. This runs after tokenize so
// we never re-scan inside strings/comments (fixes bug #1, #2).
function renderTokens(tokens: Token[]): string {
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
        // Look ahead: if next non-whitespace token is `(`, treat as function
        let next = idx + 1;
        while (next < tokens.length && tokens[next].kind === "whitespace") next++;
        const isFunc = tokens[next]?.kind === "operator" && tokens[next].text === "("
          && SQL_FUNCTIONS.has(t.text.toUpperCase());
        if (isFunc) {
          out.push(`<span class="sql-function">${safe}</span>`);
        } else if (SQL_KEYWORDS.has(t.text.toUpperCase())) {
          out.push(`<span class="sql-keyword">${safe}</span>`);
        } else if (t.text.startsWith("`") || t.text.startsWith('"')) {
          // Quoted identifier (MySQL backtick / Postgres double-quote)
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

// Highlight SQL syntax — single-pass tokenizer + renderer.
function highlightSQL(text: string): string {
  if (!text) return "";
  return renderTokens(tokenize(text));
}

/**
 * Find the SQL statement that contains position `pos`. Splits on `;`
 * while respecting string literals ('..."..." / "..."), line comments
 * (-- ...), and block comments (/* ... *\/). Returns the trimmed
 * statement text, or '' if no non-empty statement exists.
 */
function extractCurrentStatement(text: string, pos: number): string {
  const n = text.length;
  // Scan left from pos to find start-of-statement (after `;` or BOF,
  // skipping comment/string tails).
  let left = pos;
  while (left > 0) {
    const prev = text[left - 1];
    // Walk past whitespace/comments/strings backward — for safety, we
    // only need to detect ';' as a real separator.
    if (prev === ";") {
      left--;
      break;
    }
    left--;
  }
  // Skip leading whitespace + comments after the previous `;`
  while (left < n && /\s/.test(text[left])) left++;
  // Skip leading `-- ...` line comment (rare right after `;` but be safe)
  if (text.slice(left, left + 2) === "--") {
    const nl = text.indexOf("\n", left);
    left = nl === -1 ? n : nl + 1;
  }

  // Scan right from pos to find end-of-statement (next `;` or EOF)
  let right = pos;
  while (right < n) {
    const c = text[right];
    if (c === "'") {
      // skip string
      right++;
      while (right < n) {
        if (text[right] === "'" && text[right + 1] === "'") { right += 2; continue; }
        if (text[right] === "'") { right++; break; }
        right++;
      }
      continue;
    }
    if (c === '"') {
      right++;
      while (right < n) {
        if (text[right] === '"' && text[right + 1] === '"') { right += 2; continue; }
        if (text[right] === '"') { right++; break; }
        right++;
      }
      continue;
    }
    if (c === "-" && text[right + 1] === "-") {
      const nl = text.indexOf("\n", right);
      right = nl === -1 ? n : nl;
      continue;
    }
    if (c === "/" && text[right + 1] === "*") {
      const end = text.indexOf("*/", right + 2);
      right = end === -1 ? n : end + 2;
      continue;
    }
    if (c === ";") {
      // statement ends at the semicolon
      break;
    }
    right++;
  }

  const stmt = text.slice(left, right).trim();
  return stmt;
}

/**
 * Returns the SQL that should be executed for a Run command:
 *   1. if the user has a non-empty native textarea selection, use it
 *   2. otherwise, the statement containing the cursor (split on `;`)
 *   3. if neither yields content, fall back to the full text
 */
function getSqlToExecute(ta: HTMLTextAreaElement): string {
  if (ta.selectionStart !== ta.selectionEnd) {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel.trim()) return sel;
  }
  const stmt = extractCurrentStatement(ta.value, ta.selectionStart);
  if (stmt) return stmt;
  return ta.value;
}

/**
 * Compute pixel coordinates of the caret inside `ta`, relative to the
 * textarea's top-left. Uses a hidden mirror div with identical font,
 * padding, line-wrap, and width settings; measures a marker span at
 * the caret position. This is the standard "fake textarea" trick.
 */
function computeCaretCoords(
  ta: HTMLTextAreaElement,
  pos: number,
): { top: number; left: number } {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  // Anchor mirror to the textarea's viewport position so layout origin
  // matches exactly. visibility:hidden + pointer-events:none keep it
  // invisible and non-interactive.
  mirror.style.top = `${ta.getBoundingClientRect().top + window.scrollY}px`;
  mirror.style.left = `${ta.getBoundingClientRect().left + window.scrollX}px`;
  const widthPx = ta.clientWidth;
  // CRITICAL: copy font, padding, border, box-sizing, width, line-height
  // so layout matches the textarea exactly.
  const props = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "lineHeight", "padding", "paddingTop", "paddingLeft",
    "paddingRight", "paddingBottom",
    "border", "borderTopWidth", "borderLeftWidth",
    "boxSizing", "letterSpacing", "tabSize", "textTransform",
    "textIndent", "direction",
  ] as const;
  for (const prop of props) {
    const cssName = prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
    mirror.style.setProperty(cssName, cs.getPropertyValue(cssName));
  }
  mirror.style.width = `${widthPx}px`;
  // Build text up to pos + marker span (single dot ensures the span
  // is rendered with measurable width, and `markerRect.left` lands
  // exactly at the caret position).
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const taRect = ta.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);
  // marker.left is the position of the dot's left edge = caret pos.
  // marker.top is the position of the dot's top = caret line top.
  return {
    top: markerRect.top - taRect.top,
    left: markerRect.left - taRect.left,
  };
}

export function SQLEditor({
  content,
  enableVim,
  getContentRef,
  getSqlToExecuteRef,
  onRun,
  onModeChange,
  onContentChange,
}: SQLEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [vimState, setVimState] = useState(createVimState);
  const vimStateRef = useRef(vimState);
  vimStateRef.current = vimState;

  // Suppress autocomplete re-trigger for a short window after insert.
  // Without this, the cursor lands mid-token (e.g. after "SELECT") and
  // the dropdown would immediately re-pop with the same item.
  const suppressAutocompleteUntilRef = useRef(0);

  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<SchemaCompletion[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [autocompletePos, setAutocompletePos] = useState<{ top: number; left: number }>({ top: 40, left: 12 });

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  // Sync scroll between textarea and highlight
  const syncScroll = useCallback(() => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // Sync content from props
  useEffect(() => {
    if (textareaRef.current && content !== undefined) {
      textareaRef.current.value = content;
      // Update highlight
      if (highlightRef.current) {
        highlightRef.current.innerHTML = highlightSQL(content);
      }
    }
  }, [content]);

  // Register getContentRef + getSqlToExecuteRef
  useEffect(() => {
    if (getContentRef) {
      getContentRef.current = () => textareaRef.current?.value ?? "";
    }
    if (getSqlToExecuteRef) {
      getSqlToExecuteRef.current = () => {
        const ta = textareaRef.current;
        if (!ta) return "";
        return getSqlToExecute(ta);
      };
    }
  }, [getContentRef, getSqlToExecuteRef]);

  // Update highlight on input
  const updateHighlight = useCallback(() => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.innerHTML = highlightSQL(textareaRef.current.value);
    }
  }, []);

  // Check for autocomplete trigger — uses unified schema-source logic
  // (table-context / column-context / default) so completions are biased
  // by the SQL position (FROM → tables, SELECT → columns).
  const checkAutocomplete = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    // Respect post-insert cooldown so the dropdown doesn't re-pop
    // immediately after the user picks an item.
    if (Date.now() < suppressAutocompleteUntilRef.current) {
      return;
    }

    const items = getCompletions(ta.value, ta.selectionStart);
    if (items.length > 0) {
      setAutocompleteItems(items);
      setAutocompleteIndex(0);
      try {
        const caret = computeCaretCoords(ta, ta.selectionStart);
        // Position just below the caret line.
        const cs = getComputedStyle(ta);
        const fontSize = parseFloat(cs.fontSize) || 14;
        const lhRaw = cs.lineHeight;
        const lhParsed = parseFloat(lhRaw);
        const lineH = Number.isFinite(lhParsed)
          ? (lhRaw.endsWith("px") ? lhParsed : fontSize * lhParsed)
          : fontSize * 1.7;
        setAutocompletePos({ top: caret.top + lineH, left: caret.left });
      } catch (e) {
        // If caret measurement fails (e.g. detached DOM), drop the
        // dropdown at the textarea's top-left so it's still visible.
        console.warn("computeCaretCoords failed:", e);
        setAutocompletePos({ top: 0, left: 0 });
      }
      setShowAutocomplete(true);
      return;
    }
    setShowAutocomplete(false);
  }, []);

  // Apply motion
  const applyMotion = useCallback((motionKey: string, count: number): MotionResult | null => {
    const ta = textareaRef.current;
    if (!ta) return null;
    const text = ta.value;
    const pos = ta.selectionStart;
    const motion = motions[motionKey as keyof typeof motions];
    if (!motion) return null;
    if (["f:", "F:", "t:", "T:"].includes(motionKey)) {
      return (motion as any)(text, pos, count, vimStateRef.current.motion || undefined);
    }
    return (motion as any)(text, pos, count);
  }, []);

  // Apply operator
  const applyOperator = useCallback((op: OperatorType, motion: MotionResult) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ta.value;
    let { start, end } = motion;
    if (start > end) [start, end] = [end, start];

    let newText: string;
    switch (op) {
      case "delete": newText = operators.delete(text, start, end); break;
      case "yank": navigator.clipboard.writeText(text.slice(start, end)); newText = text; break;
      case "change": newText = operators.change(text, start, end); break;
      case "indent": newText = operators.indent(text, start, end); break;
      case "outdent": newText = operators.outdent(text, start, end); break;
      case "toggleCase": newText = operators.toggleCase(text, start, end); break;
      default: newText = text;
    }

    if (newText !== text) {
      ta.value = newText;
      ta.setSelectionRange(start, start);
      updateHighlight();
    }
  }, [updateHighlight]);

  // Insert autocomplete item — uses item.apply (preserves table.column
  // strip for dot completion, "fn()" for functions).
  const insertAutocomplete = useCallback((item: SchemaCompletion) => {
    const ta = textareaRef.current;
    if (!ta) return;

    const pos = ta.selectionStart;
    const text = ta.value;

    // Find word before cursor
    let start = pos - 1;
    while (start >= 0 && /[\w.]/.test(text[start])) start--;
    start++;

    const insertText = item.apply ?? item.label;
    const newText = text.slice(0, start) + insertText + text.slice(pos);
    ta.value = newText;
    ta.setSelectionRange(start + insertText.length, start + insertText.length);
    // Suppress immediate re-trigger: the cursor lands at the end of
    // the inserted token, which is still "mid-word", so without a
    // cooldown the dropdown would re-pop right after we close it.
    suppressAutocompleteUntilRef.current = Date.now() + 250;
    updateHighlight();
    setShowAutocomplete(false);
  }, [updateHighlight]);

  // Handle keydown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!enableVim) return;

    const ta = textareaRef.current;
    if (!ta) return;

    const state = vimStateRef.current;
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    // Autocomplete navigation
    if (showAutocomplete) {
      if (key === "ArrowDown") {
        setAutocompleteIndex((i) => Math.min(i + 1, autocompleteItems.length - 1));
        e.preventDefault();
        return;
      }
      if (key === "ArrowUp") {
        setAutocompleteIndex((i) => Math.max(i - 1, 0));
        e.preventDefault();
        return;
      }
      if (key === "Enter" || key === "Tab") {
        insertAutocomplete(autocompleteItems[autocompleteIndex]);
        e.preventDefault();
        return;
      }
      if (key === "Escape") {
        setShowAutocomplete(false);
        e.preventDefault();
        return;
      }
    }

    // Pending mode
    if (state.mode === "pending") {
      if (key === "Escape") {
        setVimState((s) => ({ ...s, mode: "normal", motion: null }));
        onModeChangeRef.current?.("normal");
        return;
      }
      // Replace character
      const pos = ta.selectionStart;
      if (pos < ta.value.length) {
        ta.value = ta.value.slice(0, pos) + key + ta.value.slice(pos + 1);
        ta.setSelectionRange(pos + 1, pos + 1);
        updateHighlight();
      }
      setVimState((s) => ({ ...s, mode: "normal", motion: null }));
      onModeChangeRef.current?.("normal");
      return;
    }

    // Insert mode
    if (state.mode === "insert") {
      if (key === "Escape") {
        setVimState((s) => ({ ...s, mode: "normal" }));
        onModeChangeRef.current?.("normal");
        e.preventDefault();
        return;
      }
      if (key === "Enter" && (ctrl || e.metaKey)) {
        onRun?.();
        setShowAutocomplete(false);
        e.preventDefault();
        return;
      }
      // Force show full completions on Tab (useful when dropdown dismissed)
      if (key === "Tab") {
        checkAutocomplete();
      }
      return;
    }

    // Visual mode
    if (state.mode === "visual") {
      if (key === "Escape" || key === "Ctrl-c") {
        setVimState((s) => ({ ...s, mode: "normal", visualStart: null, visualEnd: null }));
        onModeChangeRef.current?.("normal");
        e.preventDefault();
        return;
      }
      if (key === "d" || key === "x") {
        const start = Math.min(state.visualStart ?? 0, ta.selectionStart);
        const end = Math.max(state.visualEnd ?? 0, ta.selectionEnd);
        ta.value = ta.value.slice(0, start) + ta.value.slice(end);
        ta.setSelectionRange(start, start);
        updateHighlight();
        setVimState((s) => ({ ...s, mode: "normal", visualStart: null, visualEnd: null }));
        onModeChangeRef.current?.("normal");
        e.preventDefault();
        return;
      }
      if (key === "y") {
        const start = Math.min(state.visualStart ?? 0, ta.selectionStart);
        const end = Math.max(state.visualEnd ?? 0, ta.selectionEnd);
        navigator.clipboard.writeText(ta.value.slice(start, end));
        setVimState((s) => ({ ...s, mode: "normal", visualStart: null, visualEnd: null }));
        onModeChangeRef.current?.("normal");
        e.preventDefault();
        return;
      }
      if (key === "c") {
        const start = Math.min(state.visualStart ?? 0, ta.selectionStart);
        const end = Math.max(state.visualEnd ?? 0, ta.selectionEnd);
        ta.value = ta.value.slice(0, start) + ta.value.slice(end);
        ta.setSelectionRange(start, start);
        updateHighlight();
        setVimState((s) => ({ ...s, mode: "normal", visualStart: null, visualEnd: null }));
        onModeChangeRef.current?.("normal");
        e.preventDefault();
        return;
      }
      if (key === "v") {
        setVimState((s) => ({ ...s, mode: "normal", visualStart: null, visualEnd: null }));
        onModeChangeRef.current?.("normal");
        e.preventDefault();
        return;
      }
      const motionResult = applyMotion(key, state.count);
      if (motionResult) {
        ta.setSelectionRange(motionResult.end, motionResult.end);
        setVimState((s) => ({ ...s, visualEnd: motionResult.end }));
        e.preventDefault();
        return;
      }
      e.preventDefault();
      return;
    }

    // Normal mode
    if (state.mode === "normal") {
      if (/[1-9]/.test(key) && !ctrl) {
        setVimState((s) => ({ ...s, count: s.count * 10 + parseInt(key) }));
        e.preventDefault();
        return;
      }

      if (key === "Escape" || key === "Ctrl-c") {
        setVimState((s) => ({ ...s, count: 1, operator: null, motion: null }));
        e.preventDefault();
        return;
      }

      if (["h", "j", "k", "l", "w", "b", "e", "0", "^", "$", "G", "gg", "f", "F", "t", "T"].includes(key)) {
        if (state.operator) {
          const motionKey = key === "gg" ? "gg" : key;
          const result = applyMotion(motionKey, state.count);
          if (result) applyOperator(state.operator, result);
          setVimState((s) => ({ ...s, count: 1, operator: null, motion: null }));
          e.preventDefault();
          return;
        }
        const motionKey = key === "gg" ? "gg" : key;
        const result = applyMotion(motionKey, state.count);
        if (result) ta.setSelectionRange(result.end, result.end);
        setVimState((s) => ({ ...s, count: 1 }));
        e.preventDefault();
        return;
      }

      const textObjKeys = ["iw", "aw", "iW", "aW", "is", "as", "ip", "ap", "ib", "ab", "iq", "aq"];
      if (textObjKeys.includes(key)) {
        const obj = textObjects[key as keyof typeof textObjects];
        if (obj) {
          const result = obj(ta.value, ta.selectionStart);
          if (state.operator) {
            applyOperator(state.operator, result);
            setVimState((s) => ({ ...s, count: 1, operator: null }));
          } else {
            ta.setSelectionRange(result.end, result.end);
          }
          e.preventDefault();
          return;
        }
      }

      if (["d", "y", "c", ">", "<", "~"].includes(key)) {
        if (state.operator && state.operator.length === 1 && state.count === 1) {
          const lineStart = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
          const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
          const end = lineEnd === -1 ? ta.value.length : lineEnd;
          const op = key === "d" ? "delete" : key === "y" ? "yank" : key === "c" ? "change" : key === ">" ? "indent" : key === "<" ? "outdent" : "toggleCase";
          applyOperator(op as OperatorType, { start: lineStart, end, exclusive: true });
          setVimState((s) => ({ ...s, count: 1, operator: null }));
          e.preventDefault();
          return;
        }
        setVimState((s) => ({ ...s, operator: key as OperatorType }));
        e.preventDefault();
        return;
      }

      if (key === "i") {
        setVimState((s) => ({ ...s, mode: "insert", count: 1, operator: null }));
        onModeChangeRef.current?.("insert");
        e.preventDefault();
        return;
      }

      if (key === "a") {
        const pos = ta.selectionStart;
        if (pos < ta.value.length && ta.value[pos] !== "\n") {
          ta.setSelectionRange(pos + 1, pos + 1);
        }
        setVimState((s) => ({ ...s, mode: "insert", count: 1, operator: null }));
        onModeChangeRef.current?.("insert");
        e.preventDefault();
        return;
      }

      if (key === "A") {
        const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
        const end = lineEnd === -1 ? ta.value.length : lineEnd;
        ta.setSelectionRange(end, end);
        setVimState((s) => ({ ...s, mode: "insert", count: 1, operator: null }));
        onModeChangeRef.current?.("insert");
        e.preventDefault();
        return;
      }

      if (key === "o") {
        const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
        const end = lineEnd === -1 ? ta.value.length : lineEnd;
        ta.value = ta.value.slice(0, end) + "\n" + ta.value.slice(end);
        ta.setSelectionRange(end + 1, end + 1);
        updateHighlight();
        setVimState((s) => ({ ...s, mode: "insert", count: 1, operator: null }));
        onModeChangeRef.current?.("insert");
        e.preventDefault();
        return;
      }

      if (key === "O") {
        const lineStart = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
        ta.value = ta.value.slice(0, lineStart) + "\n" + ta.value.slice(lineStart);
        ta.setSelectionRange(lineStart + 1, lineStart + 1);
        updateHighlight();
        setVimState((s) => ({ ...s, mode: "insert", count: 1, operator: null }));
        onModeChangeRef.current?.("insert");
        e.preventDefault();
        return;
      }

      if (key === "v") {
        setVimState((s) => ({ ...s, mode: "visual", visualStart: ta.selectionStart, visualEnd: ta.selectionStart }));
        onModeChangeRef.current?.("visual");
        e.preventDefault();
        return;
      }

      if (key === "V") {
        const lineStart = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
        const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
        const end = lineEnd === -1 ? ta.value.length : lineEnd;
        ta.setSelectionRange(lineStart, end);
        setVimState((s) => ({ ...s, mode: "visual", visualStart: lineStart, visualEnd: end }));
        onModeChangeRef.current?.("visual");
        e.preventDefault();
        return;
      }

      if (key === "x") {
        const pos = ta.selectionStart;
        if (pos < ta.value.length) {
          ta.value = ta.value.slice(0, pos) + ta.value.slice(pos + 1);
          ta.setSelectionRange(pos, pos);
          updateHighlight();
        }
        e.preventDefault();
        return;
      }

      if (key === "r") {
        setVimState((s) => ({ ...s, mode: "pending" }));
        e.preventDefault();
        return;
      }

      if (key === "p") {
        navigator.clipboard.readText().then((clipText) => {
          const pos = ta.selectionStart;
          ta.value = ta.value.slice(0, pos) + clipText + ta.value.slice(pos);
          ta.setSelectionRange(pos + clipText.length, pos + clipText.length);
          updateHighlight();
        });
        e.preventDefault();
        return;
      }

      if ((ctrl || e.metaKey) && key === "Enter") {
        onRun?.();
        setShowAutocomplete(false);
        e.preventDefault();
        return;
      }

      if (key.length === 1 && !ctrl) {
        e.preventDefault();
        return;
      }
    }
  }, [enableVim, applyMotion, applyOperator, onRun, showAutocomplete, autocompleteItems, autocompleteIndex, insertAutocomplete, checkAutocomplete, updateHighlight]);

  // Handle input changes
  const handleInput = useCallback(() => {
    const text = textareaRef.current?.value ?? "";
    updateHighlight();
    checkAutocomplete();
    onContentChange?.(text);
  }, [updateHighlight, checkAutocomplete, onContentChange]);

  // Auto focus
  useEffect(() => {
    if (enableVim && vimState.mode === "insert") {
      textareaRef.current?.focus();
    }
  }, [enableVim, vimState.mode]);

  return (
    <div className="editor-container">
      <div className="editor-header">
        <div className="vim-indicator">
          <span className="vim-mode">{enableVim ? vimState.mode.toUpperCase() : "PLAIN"}</span>
          {vimState.operator && <span className="vim-op">{vimState.operator}</span>}
          {vimState.count > 1 && <span className="vim-count">{vimState.count}</span>}
        </div>
      </div>
      <div className="editor-body sql-editor-body">
        <div ref={highlightRef} className="sql-highlight" />
        <textarea
          ref={textareaRef}
          className="sql-textarea"
          defaultValue={content}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onScroll={syncScroll}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {showAutocomplete && autocompleteItems.length > 0 && (
          <div
            className="sql-autocomplete"
            data-testid="sql-autocomplete"
            style={{ top: autocompletePos.top, left: autocompletePos.left }}
          >
            <div className="sql-autocomplete-items">
              {autocompleteItems.map((item, i) => (
                <div
                  key={item.label}
                  className={`sql-autocomplete-item ${i === autocompleteIndex ? "selected" : ""}`}
                  data-testid="sql-autocomplete-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertAutocomplete(item)}
                >
                  <span className={`sql-autocomplete-type ${item.type}`}>{item.type}</span>
                  <span className="sql-autocomplete-label">{item.label}</span>
                  <span className="sql-autocomplete-detail">{item.detail}</span>
                </div>
              ))}
            </div>
            <div className="sql-autocomplete-hint">
              <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
              <span><kbd>↵</kbd>/<kbd>Tab</kbd> 插入</span>
              <span><kbd>Esc</kbd> 关闭</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
