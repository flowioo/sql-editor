import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { vim } from "@replit/codemirror-vim";
import { oneDark } from "@codemirror/theme-one-dark";
import { lineNumbers, highlightActiveLineGutter, highlightActiveLine, keymap, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap, autocompletion } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

const THEME = EditorView.theme({
  "&": {
    backgroundColor: "#0f1117",
    color: "#e1e4ed",
  },
  ".cm-content": {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
    caretColor: "#7c6aef",
  },
  ".cm-cursor": {
    borderLeftColor: "#7c6aef",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(124, 106, 239, 0.3) !important",
  },
  ".cm-gutters": {
    backgroundColor: "#0f1117",
    borderRight: "1px solid #2e3144",
    color: "#5c6072",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "#7c6aef",
    fontWeight: "600",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(124, 106, 239, 0.05)",
  },
  ".cm-line": {
    padding: "0 4px",
  },
});

export function createEditorExtensions(): Extension[] {
  return [
    THEME,
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    rectangularSelection(),
    highlightSelectionMatches(),
    sql(),
    vim(),
    oneDark,
    autocompletion(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
  ];
}
