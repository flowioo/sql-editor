import { useEffect, useRef } from "react";
import { highlightSQL } from "./highlight";
import { getSqlToExecute } from "./statement";
import { useAutocomplete } from "./useAutocomplete";
import { useVimKeydown } from "./useVimKeydown";
import type { DatabaseSchema } from "../hooks/useSchema";
import type { VimMode, OperatorType } from "./vim-engine";
import "../styles/editor.css";

interface SQLEditorProps {
  readonly content: string;
  readonly enableVim: boolean;
  /** Database schema for autocomplete. Injected via props so completion is
   *  a pure function of (text, pos, schema). */
  readonly schema: DatabaseSchema | null;
  readonly getContentRef?: React.MutableRefObject<(() => string) | null>;
  readonly getSqlToExecuteRef?: React.MutableRefObject<(() => string) | null>;
  readonly onRun?: () => void;
  readonly onModeChange?: (mode: VimMode) => void;
  readonly onContentChange?: (content: string) => void;
  /** SQL dialect. Defaults to "postgresql" when omitted. */
  readonly dialect?: "postgresql" | "mysql" | "sqlite" | "redis";
}

/**
 * Minimal SQL editor — a textarea on top of a syntax-highlighted overlay.
 * Vim semantics live in `useVimKeydown`; autocomplete lives in
 * `useAutocomplete`. This file is the wiring layer and JSX shell.
 *
 * The textarea is *transparent* (color: transparent) so the overlay shows
 * coloured tokens, but during IME composition the user must see what they
 * are typing — we toggle a `.composing` class on the textarea to render
 * its text in foreground colour, then drop it on `compositionend`.
 */
export function SQLEditor({
  content,
  enableVim,
  schema,
  getContentRef,
  getSqlToExecuteRef,
  onRun,
  onModeChange,
  onContentChange,
  dialect = "postgresql",
}: SQLEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const autocomplete = useAutocomplete({ textareaRef, schema, dialect });
  const vim = useVimKeydown({
    textareaRef,
    enableVim,
    highlightRef,
    dialect,
    onRun,
    onModeChange,
    onContentChange,
    autocomplete,
  });

  // Sync overlay + scroll whenever content prop changes (e.g. tab switch).
  // Skip highlight re-render when the textarea already matches — otherwise
  // every keystroke triggered a double full-text highlight pass.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.value !== content) {
      ta.value = content;
    }
    if (highlightRef.current) {
      highlightRef.current.innerHTML = highlightSQL(content, dialect);
    }
  }, [content, dialect]);

  // Sync scroll between textarea and highlight overlay.
  useEffect(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    const sync = () => {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    };
    ta.addEventListener("scroll", sync);
    return () => ta.removeEventListener("scroll", sync);
  }, []);

  // IME composition: textarea is normally transparent (overlay does the
  // colouring), but during composition the pre-edit text must be visible.
  // Toggle `.composing` so CSS can override `color: transparent` while
  // the textarea temporarily shows foreground colour. We also mark the
  // editor body with `.has-composing` so the overlay can hide itself and
  // avoid the double-image artifact.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const body = ta.closest(".sql-editor-body");
    const onStart = () => {
      ta.classList.add("composing");
      body?.classList.add("has-composing");
    };
    const onEnd = () => {
      ta.classList.remove("composing");
      body?.classList.remove("has-composing");
      // Defer refresh to next tick so the final composed text lands first.
      requestAnimationFrame(() => autocomplete.refresh());
    };
    ta.addEventListener("compositionstart", onStart);
    ta.addEventListener("compositionend", onEnd);
    return () => {
      ta.removeEventListener("compositionstart", onStart);
      ta.removeEventListener("compositionend", onEnd);
    };
  }, [autocomplete]);

  // Expose getContent + getSqlToExecute to App via the injected refs.
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

  // Re-focus on insert-mode entry (vim moves focus to it visually).
  useEffect(() => {
    if (enableVim && vim.mode === "insert") {
      textareaRef.current?.focus();
    }
  }, [enableVim, vim.mode]);

  // Merge IME-derived input with normal input. Native `input` runs after
  // compositionend; both fire it. requestAnimationFrame coalesces bursts.
  const handleInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      if (highlightRef.current) {
        highlightRef.current.innerHTML = highlightSQL(ta.value, dialect);
      }
      autocomplete.refresh();
      onContentChangeRef.current?.(ta.value);
    });
  };

  return (
    <div className="editor-container">
      <div className="editor-header">
        <div className="vim-indicator">
          <span className="vim-mode">
            {enableVim ? vim.mode.toUpperCase() : "PLAIN"}
          </span>
          {enableVim && vim.operator && <span className="vim-op">{vim.operator}</span>}
          {enableVim && vim.count > 0 && <span className="vim-count">{vim.count}</span>}
        </div>
      </div>
      <div className="editor-body sql-editor-body">
        <div ref={highlightRef} className="sql-highlight" />
        <textarea
          ref={textareaRef}
          className="sql-textarea"
          defaultValue={content}
          onKeyDown={vim.handleKeyDown}
          onInput={handleInput}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {autocomplete.visible && autocomplete.items.length > 0 && (
          <div
            className="sql-autocomplete"
            data-testid="sql-autocomplete"
            style={{ top: autocomplete.pos.top, left: autocomplete.pos.left }}
          >
            <div className="sql-autocomplete-items">
              {autocomplete.items.map((item, i) => (
                <div
                  key={`${item.type}:${item.label}:${item.detail}`}
                  className={`sql-autocomplete-item ${i === autocomplete.index ? "selected" : ""}`}
                  data-testid="sql-autocomplete-item"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => autocomplete.acceptItem(item)}
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

export type { VimMode, OperatorType };
