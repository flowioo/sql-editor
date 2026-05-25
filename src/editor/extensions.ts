import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { vim, Vim } from "@replit/codemirror-vim";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
} from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import { schemaCompletionSource, setSchema } from "../lib/schema-source";
import type { DatabaseSchema } from "../hooks/useSchema";

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
  ".cm-tooltip-autocomplete": {
    backgroundColor: "#1a1d27",
    border: "1px solid #2e3144",
    borderRadius: "6px",
    "& > ul > li": {
      padding: "2px 8px",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "rgba(124, 106, 239, 0.2)",
      color: "#e1e4ed",
    },
  },
  ".cm-completionLabel": {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "0.85em",
  },
  ".cm-completionDetail": {
    fontStyle: "normal",
    fontSize: "0.78em",
    color: "#8b8fa3",
    marginLeft: "8px",
  },
});

let schemaRefreshCallback: (() => void) | null = null;

export function setSchemaRefreshCallback(cb: () => void): void {
  schemaRefreshCallback = cb;
}

export function updateSchemaForAutocomplete(schema: DatabaseSchema): void {
  setSchema(schema);
}

export function setupVimLeaderMappings(_view: EditorView): void {
  try {
    Vim.mapCommand("<leader>rs", "action", "refreshSchema", {}, {
      callback: () => {
        schemaRefreshCallback?.();
      },
    });
  } catch {
    // vim extension may not be ready yet, safe to ignore
  }
}

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
    autocompletion({
      override: [schemaCompletionSource],
      activateOnTyping: true,
    }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
  ];
}
