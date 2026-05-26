import { useRef, useEffect, useState, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { createEditorExtensions, setupVimLeaderMappings } from "./extensions";
import type { VimMode } from "../hooks/useVimMode";
import { useVimMode } from "../hooks/useVimMode";
import "../styles/editor.css";

interface SQLEditorProps {
  readonly initialContent: string;
  readonly onContentChange?: (content: string) => void;
  readonly onVimModeChange?: (mode: VimMode) => void;
  readonly onCursorChange?: (line: number, col: number) => void;
  readonly onRun?: (sql: string) => void;
}

function getVimModeFromView(view: EditorView): VimMode {
  try {
    const cm = (view as any).cm ?? (view.state as any).field?.(Symbol.for("cm5"));
    if (cm?.state?.vim) {
      const vs = cm.state.vim;
      if (vs.insertMode) return "insert";
      if (vs.visualMode) return "visual";
    }
  } catch {
    // ignore
  }
  return "normal";
}

/**
 * Get the SQL to execute:
 * 1. If there's a selection, use it
 * 2. Otherwise find the current statement (text between empty lines or ; boundaries)
 */
function getSQLToRun(view: EditorView): string {
  const sel = view.state.selection.main;

  // If there's an actual selection (not just a cursor), use it
  if (sel.from !== sel.to) {
    return view.state.sliceDoc(sel.from, sel.to).trim();
  }

  // No selection — find the current statement
  const doc = view.state.doc;
  const cursorPos = sel.head;
  const currentLine = doc.lineAt(cursorPos);

  // Scan backwards to find statement start (empty line or beginning of doc)
  let startLine = currentLine.number;
  while (startLine > 1) {
    const prevLine = doc.line(startLine - 1);
    if (prevLine.text.trim() === "") break;
    // Check if previous line ends with ;
    if (prevLine.text.trimEnd().endsWith(";") && startLine !== currentLine.number) break;
    startLine--;
  }

  // Scan forwards to find statement end (empty line or ; or end of doc)
  let endLine = currentLine.number;
  while (endLine < doc.lines) {
    const line = doc.line(endLine);
    if (line.text.trimEnd().endsWith(";")) break;
    const nextLine = doc.line(endLine + 1);
    if (nextLine.text.trim() === "") break;
    endLine++;
  }
  // Include the last line even if it doesn't end with ;
  if (endLine < doc.lines && !doc.line(endLine).text.trimEnd().endsWith(";")) {
    // Check one more line
    const lastLineText = doc.line(endLine).text.trimEnd();
    if (!lastLineText.endsWith(";")) {
      // Already at a natural boundary
    }
  }

  const from = doc.line(startLine).from;
  const to = doc.line(endLine).to;
  return view.state.sliceDoc(from, to).trim();
}

export function SQLEditor({
  initialContent,
  onContentChange,
  onVimModeChange,
  onCursorChange,
  onRun,
}: SQLEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { getVimModeLabel, getVimModeClass } = useVimMode();
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const updateVimMode = useCallback(
    (view: EditorView) => {
      const mode = getVimModeFromView(view);
      setVimMode(mode);
      onVimModeChange?.(mode);
    },
    [onVimModeChange],
  );

  const updateCursor = useCallback(
    (view: EditorView) => {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from + 1;
      setCursorPos({ line: line.number, col });
      onCursorChange?.(line.number, col);
    },
    [onCursorChange],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Use rAF to ensure the container has been laid out with its final height
    // before CM6 measures it. Without this, flex-based layouts may report 0.
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled || !container) return;

      const runKeymap = keymap.of([
        {
          key: "Ctrl-Enter",
          run: (view) => {
            const sql = getSQLToRun(view);
            if (sql) onRunRef.current?.(sql);
            return true;
          },
        },
        {
          key: "Ctrl-r",
          run: (view) => {
            const sql = getSQLToRun(view);
            if (sql) onRunRef.current?.(sql);
            return true;
          },
        },
      ]);

      const onUpdate = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onContentChange?.(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          updateCursor(update.view);
        }
        updateVimMode(update.view);
      });

      const state = EditorState.create({
        doc: initialContent,
        extensions: [...createEditorExtensions(), runKeymap, onUpdate],
      });

      const view = new EditorView({
        state,
        parent: container,
      });

      viewRef.current = view;
      updateCursor(view);
      updateVimMode(view);
      setupVimLeaderMappings(view);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="editor-container">
      <div className="editor-header">
        <div className="vim-indicator">
          <span className={`vim-mode ${getVimModeClass(vimMode)}`}>
            {getVimModeLabel(vimMode)}
          </span>
          <span className="vim-mode-text">— Ctrl+Enter / Ctrl+R 执行选中或当前语句</span>
        </div>
        <div className="cursor-info">
          Ln {cursorPos.line}, Col {cursorPos.col}
        </div>
      </div>
      <div ref={containerRef} className="editor-body" />
    </div>
  );
}
