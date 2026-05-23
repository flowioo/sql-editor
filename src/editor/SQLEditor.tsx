import { useRef, useEffect, useState, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { createEditorExtensions } from "./extensions";
import type { VimMode } from "../hooks/useVimMode";
import { useVimMode } from "../hooks/useVimMode";
import "../styles/editor.css";

interface SQLEditorProps {
  readonly initialContent: string;
  readonly onContentChange?: (content: string) => void;
  readonly onVimModeChange?: (mode: VimMode) => void;
  readonly onCursorChange?: (line: number, col: number) => void;
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

export function SQLEditor({
  initialContent,
  onContentChange,
  onVimModeChange,
  onCursorChange,
}: SQLEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { getVimModeLabel, getVimModeClass } = useVimMode();
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

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
      extensions: [...createEditorExtensions(), onUpdate],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    updateCursor(view);
    updateVimMode(view);

    return () => {
      view.destroy();
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
          <span className="vim-mode-text">— Vim 模式已启用</span>
        </div>
        <div className="cursor-info">
          行 {cursorPos.line}，列 {cursorPos.col}
        </div>
      </div>
      <div ref={containerRef} className="editor-body" />
    </div>
  );
}
