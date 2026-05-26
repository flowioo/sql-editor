import { useRef, useEffect, useState } from "react";
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

function getSQLToRun(view: EditorView): string {
  const sel = view.state.selection.main;
  if (sel.from !== sel.to) {
    return view.state.sliceDoc(sel.from, sel.to).trim();
  }

  const doc = view.state.doc;
  const cursorPos = sel.head;
  const currentLine = doc.lineAt(cursorPos);

  let startLine = currentLine.number;
  while (startLine > 1) {
    const prevLine = doc.line(startLine - 1);
    if (prevLine.text.trim() === "") break;
    if (prevLine.text.trimEnd().endsWith(";") && startLine !== currentLine.number) break;
    startLine--;
  }

  let endLine = currentLine.number;
  while (endLine < doc.lines) {
    const line = doc.line(endLine);
    if (line.text.trimEnd().endsWith(";")) break;
    const nextLine = doc.line(endLine + 1);
    if (nextLine.text.trim() === "") break;
    endLine++;
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
  const initializedRef = useRef(false);
  const { getVimModeLabel, getVimModeClass } = useVimMode();
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // Keep callbacks in refs to avoid stale closures and re-creation
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const onVimModeChangeRef = useRef(onVimModeChange);
  onVimModeChangeRef.current = onVimModeChange;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;
    initializedRef.current = true;

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
        onContentChangeRef.current?.(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        const pos = update.view.state.selection.main.head;
        const line = update.view.state.doc.lineAt(pos);
        const col = pos - line.from + 1;
        setCursorPos({ line: line.number, col });
        onCursorChangeRef.current?.(line.number, col);
      }
      // Update vim mode display
      try {
        const cm = (update.view as any).cm;
        if (cm?.state?.vim) {
          const vs = cm.state.vim;
          let mode: VimMode = "normal";
          if (vs.insertMode) mode = "insert";
          else if (vs.visualMode) mode = "visual";
          setVimMode(mode);
          onVimModeChangeRef.current?.(mode);
        }
      } catch {
        // ignore
      }
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
    setupVimLeaderMappings(view);
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
      initializedRef.current = false;
    };
  }, [initialContent]);

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
