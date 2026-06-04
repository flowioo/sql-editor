import { EditorState, StateField, StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

// Vim modes
export type VimMode = "insert" | "normal" | "visual";

// Effect to change mode
const setModeEffect = StateEffect.define<VimMode>();

// State field to persist vim mode
const vimModeField = StateField.define<VimMode>({
  create: () => "insert",
  update: (mode, tr) => {
    for (const e of tr.effects) {
      if (e.is(setModeEffect)) return e.value;
    }
    return mode;
  },
});

// Get vim mode from state
export function getVimMode(state: EditorState): VimMode {
  return state.field(vimModeField);
}

// Extension
export function vim(onModeChange?: (mode: VimMode) => void): readonly any[] {
  return [
    vimModeField,
    Prec.highest(
      keymap.of([
        // Escape -> normal
        {
          key: "Escape",
          run: (view) => {
            view.dispatch({ effects: setModeEffect.of("normal") });
            onModeChange?.("normal");
            return true;
          },
        },
        {
          key: "Ctrl-bracketLeft",
          run: (view) => {
            view.dispatch({ effects: setModeEffect.of("normal") });
            onModeChange?.("normal");
            return true;
          },
        },
        // i -> insert (from normal/visual)
        {
          key: "i",
          run: (view) => {
            const mode = getVimMode(view.state);
            if (mode !== "insert") {
              view.dispatch({ effects: setModeEffect.of("insert") });
              onModeChange?.("insert");
              return true;
            }
            return false;
          },
        },
        // v -> visual (from normal only)
        {
          key: "v",
          run: (view) => {
            const mode = getVimMode(view.state);
            if (mode === "normal") {
              view.dispatch({ effects: setModeEffect.of("visual") });
              onModeChange?.("visual");
              return true;
            }
            return false;
          },
        },
        // a/A/o/O -> insert (from normal)
        {
          key: "a",
          run: (view) => {
            const mode = getVimMode(view.state);
            if (mode === "normal") {
              view.dispatch({ effects: setModeEffect.of("insert") });
              onModeChange?.("insert");
              return true;
            }
            return false;
          },
        },
        {
          key: "A",
          run: (view) => {
            const mode = getVimMode(view.state);
            if (mode === "normal") {
              view.dispatch({ effects: setModeEffect.of("insert") });
              onModeChange?.("insert");
              return true;
            }
            return false;
          },
        },
        {
          key: "o",
          run: (view) => {
            const mode = getVimMode(view.state);
            if (mode === "normal") {
              view.dispatch({ effects: setModeEffect.of("insert") });
              onModeChange?.("insert");
              return true;
            }
            return false;
          },
        },
        {
          key: "O",
          run: (view) => {
            const mode = getVimMode(view.state);
            if (mode === "normal") {
              view.dispatch({ effects: setModeEffect.of("insert") });
              onModeChange?.("insert");
              return true;
            }
            return false;
          },
        },
        // Movement: h/j/k/l (normal mode only)
        {
          key: "h",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const cur = view.state.selection.main.head;
            if (cur > 0) {
              view.dispatch({ selection: { anchor: cur - 1 }, scrollIntoView: true });
            }
            return true;
          },
        },
        {
          key: "l",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const cur = view.state.selection.main.head;
            if (cur < view.state.doc.length) {
              view.dispatch({ selection: { anchor: cur + 1 }, scrollIntoView: true });
            }
            return true;
          },
        },
        {
          key: "j",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            if (line.number < view.state.doc.lines) {
              const nextLine = view.state.doc.line(line.number + 1);
              view.dispatch({ selection: { anchor: nextLine.from }, scrollIntoView: true });
            }
            return true;
          },
        },
        {
          key: "k",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            if (line.number > 1) {
              const prevLine = view.state.doc.line(line.number - 1);
              view.dispatch({ selection: { anchor: prevLine.from }, scrollIntoView: true });
            }
            return true;
          },
        },
        // Arrow keys
        {
          key: "ArrowLeft",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const cur = view.state.selection.main.head;
            if (cur > 0) {
              view.dispatch({ selection: { anchor: cur - 1 }, scrollIntoView: true });
            }
            return true;
          },
        },
        {
          key: "ArrowRight",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const cur = view.state.selection.main.head;
            if (cur < view.state.doc.length) {
              view.dispatch({ selection: { anchor: cur + 1 }, scrollIntoView: true });
            }
            return true;
          },
        },
        {
          key: "ArrowDown",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            if (line.number < view.state.doc.lines) {
              const nextLine = view.state.doc.line(line.number + 1);
              view.dispatch({ selection: { anchor: nextLine.from }, scrollIntoView: true });
            }
            return true;
          },
        },
        {
          key: "ArrowUp",
          run: (view) => {
            if (getVimMode(view.state) !== "normal") return false;
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            if (line.number > 1) {
              const prevLine = view.state.doc.line(line.number - 1);
              view.dispatch({ selection: { anchor: prevLine.from }, scrollIntoView: true });
            }
            return true;
          },
        },
      ])
    ),
  ];
}