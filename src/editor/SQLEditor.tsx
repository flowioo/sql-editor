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
import { useSchema } from "../hooks/useSchema";
import "../styles/editor.css";

interface SQLEditorProps {
  readonly content: string;
  readonly enableVim: boolean;
  readonly getContentRef?: React.MutableRefObject<(() => string) | null>;
  readonly onRun?: () => void;
  readonly onModeChange?: (mode: VimMode) => void;
}

// SQL Keywords for highlighting
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "EXISTS",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "ON", "AS",
  "IS", "NULL", "LIKE", "BETWEEN", "GROUP", "BY", "ORDER", "HAVING",
  "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
  "DISTINCT", "UNION", "ALL", "ASC", "DESC", "CASE", "WHEN", "THEN",
  "ELSE", "END", "TRUE", "FALSE", "CAST", "DEFAULT", "DISTINCT",
  "COALESCE", "NULLIF", "COUNT", "SUM", "AVG", "MAX", "MIN",
];

// Highlight SQL syntax
function highlightSQL(text: string): string {
  if (!text) return "";

  // Escape HTML first
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Highlight strings
  html = html.replace(/'([^']*)'/g, '<span class="sql-string">\'$1\'</span>');

  // Highlight comments
  html = html.replace(/(--.*$)/gm, '<span class="sql-comment">$1</span>');

  // Highlight keywords (case insensitive)
  const kwPattern = new RegExp(`\\b(${SQL_KEYWORDS.join("|")})\\b`, "gi");
  html = html.replace(kwPattern, '<span class="sql-keyword">$1</span>');

  // Highlight numbers
  html = html.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="sql-number">$1</span>');

  return html;
}

// Get schema for autocomplete
function getSchemaCompletions(schema: any, word: string): Array<{ label: string; detail: string; type: string }> {
  if (!schema?.tables) return [];
  const items: Array<{ label: string; detail: string; type: string }> = [];
  const lowerWord = word.toLowerCase();

  for (const table of schema.tables) {
    if (table.name.toLowerCase().startsWith(lowerWord)) {
      items.push({ label: table.name, detail: `${table.columns.length} columns`, type: "table" });
    }
    if (lowerWord.includes(".")) {
      const [t, c] = lowerWord.split(".");
      if (t === table.name.toLowerCase()) {
        for (const col of table.columns) {
          if (col.name.toLowerCase().startsWith(c)) {
            items.push({ label: `${table.name}.${col.name}`, detail: col.data_type, type: "column" });
          }
        }
      }
    } else {
      for (const col of table.columns) {
        if (col.name.toLowerCase().startsWith(lowerWord)) {
          items.push({ label: col.name, detail: `${table.name}.${col.data_type}`, type: "column" });
        }
      }
    }
  }
  return items.slice(0, 10);
}

export function SQLEditor({
  content,
  enableVim,
  getContentRef,
  onRun,
  onModeChange,
}: SQLEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [vimState, setVimState] = useState(createVimState);
  const vimStateRef = useRef(vimState);
  vimStateRef.current = vimState;

  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<Array<{ label: string; detail: string; type: string }>>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  // Get schema - using placeholder since hook needs connection
  const { schema } = useSchema();

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

  // Register getContentRef
  useEffect(() => {
    if (getContentRef) {
      getContentRef.current = () => textareaRef.current?.value ?? "";
    }
  }, [getContentRef]);

  // Update highlight on input
  const updateHighlight = useCallback(() => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.innerHTML = highlightSQL(textareaRef.current.value);
    }
  }, []);

  // Check for autocomplete trigger
  const checkAutocomplete = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !schema) return;

    const pos = ta.selectionStart;
    const text = ta.value;

    // Find word before cursor
    let start = pos - 1;
    while (start >= 0 && /[\w.]/.test(text[start])) start--;
    start++;
    const word = text.slice(start, pos);

    if (word.length >= 1) {
      const items = getSchemaCompletions(schema, word);
      if (items.length > 0) {
        setAutocompleteItems(items);
        setAutocompleteIndex(0);
        setShowAutocomplete(true);
        return;
      }
    }
    setShowAutocomplete(false);
  }, [schema]);

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

  // Insert autocomplete item
  const insertAutocomplete = useCallback((item: { label: string; detail: string }) => {
    const ta = textareaRef.current;
    if (!ta) return;

    const pos = ta.selectionStart;
    const text = ta.value;

    // Find word before cursor
    let start = pos - 1;
    while (start >= 0 && /[\w.]/.test(text[start])) start--;
    start++;

    const newText = text.slice(0, start) + item.label + text.slice(pos);
    ta.value = newText;
    ta.setSelectionRange(start + item.label.length, start + item.label.length);
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
      if (key === "Enter" && ctrl) {
        onRun?.();
        e.preventDefault();
        return;
      }
      // Trigger autocomplete on trigger characters
      if (key === " " || key === "." || key === "(") {
        setTimeout(checkAutocomplete, 0);
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

      if (ctrl && key === "Enter") {
        onRun?.();
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
    updateHighlight();
    checkAutocomplete();
  }, [updateHighlight, checkAutocomplete]);

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
          <div className="sql-autocomplete">
            {autocompleteItems.map((item, i) => (
              <div
                key={item.label}
                className={`sql-autocomplete-item ${i === autocompleteIndex ? "selected" : ""}`}
                onClick={() => insertAutocomplete(item)}
              >
                <span className={`sql-autocomplete-type ${item.type}`}>{item.type}</span>
                <span className="sql-autocomplete-label">{item.label}</span>
                <span className="sql-autocomplete-detail">{item.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
