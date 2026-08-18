import { useCallback, useMemo, useRef, useState } from "react";
import {
  motions,
  textObjects,
  operators,
  operatorFromKey,
  createVimState,
  type VimMode,
  type OperatorType,
  type MotionResult,
  type VimState,
} from "./vim-engine";
import { highlightSQL } from "./highlight";
import type { UseAutocompleteReturn } from "./useAutocomplete";

export interface UseVimKeydownOptions {
  readonly textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  readonly enableVim: boolean;
  readonly highlightRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly dialect?: "postgresql" | "mysql" | "sqlite" | "redis";
  readonly onRun?: () => void;
  readonly onModeChange?: (mode: VimMode) => void;
  readonly onContentChange?: (text: string) => void;
  readonly autocomplete: UseAutocompleteReturn;
}

export interface UseVimKeydownReturn {
  readonly mode: VimMode;
  readonly operator: OperatorType | null;
  readonly count: number;
  readonly handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly commitEdit: (newText: string, caret: number, caretEnd?: number) => void;
  /** Programmatic sync of the textarea value (for tab switch / prop change). */
  readonly syncFromProp: (text: string) => void;
}

// Keys that follow "g" or "i"/"a" in a two-key sequence.
const MOTION_KEYS = new Set([
  "h", "j", "k", "l", "w", "b", "e",
  "0", "^", "$", "G",
]);

// Two-key motion prefixes — after the prefix is set, the next printable
// key completes the motion (or, for `gg`, must be the same `g`).
function isCharMotionPrefix(k: string): boolean {
  return k === "f" || k === "F" || k === "t" || k === "T";
}

/**
 * Vim keymap hook — owns the vim state machine + the textarea keyboard
 * handler. Returns the handler + a few read-only fields for the header UI.
 *
 * The handler is responsible for:
 *   - IME composition guard (must short-circuit BEFORE any vim logic)
 *   - Cmd/Ctrl+Enter run query (independent of enableVim)
 *   - Autocomplete keyboard handling (independent of enableVim)
 *   - Vim normal/insert/visual/pending state machine
 *   - All imperative text mutation through `commitEdit`, which propagates
 *     to the parent store + highlights the overlay.
 */
export function useVimKeydown(opts: UseVimKeydownOptions): UseVimKeydownReturn {
  const {
    textareaRef,
    enableVim,
    highlightRef,
    dialect,
    onRun,
    onModeChange,
    onContentChange,
    autocomplete,
  } = opts;

  const [vimState, setVimState] = useState<VimState>(createVimState);
  const vimStateRef = useRef(vimState);
  vimStateRef.current = vimState;

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const setMode = useCallback((mode: VimMode) => {
    onModeChangeRef.current?.(mode);
  }, []);

  /** Apply a programmatic mutation: update textarea + highlight + content. */
  const commitEdit = useCallback(
    (newText: string, caret: number, caretEnd?: number) => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.value = newText;
      ta.setSelectionRange(caret, caretEnd ?? caret);
      if (highlightRef.current) {
        highlightRef.current.innerHTML = highlightSQL(newText, dialect);
      }
      onContentChangeRef.current?.(newText);
    },
    [textareaRef, highlightRef, dialect],
  );

  /** Sync textarea + highlight from an external prop without re-running
   *  user-input handlers (no IME/imperative loops). Called on content
   *  change + tab switch. */
  const syncFromProp = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (ta.value !== text) ta.value = text;
      if (highlightRef.current) {
        highlightRef.current.innerHTML = highlightSQL(text, dialect);
      }
    },
    [textareaRef, highlightRef, dialect],
  );

  // ------ Motion / operator appliers ----------------------------------------

  const applyMotion = useCallback(
    (motionKey: string, count: number, char?: string): MotionResult | null => {
      const ta = textareaRef.current;
      if (!ta) return null;
      const motion = motions[motionKey];
      if (!motion) return null;
      return motion(ta.value, ta.selectionStart, count, char);
    },
    [textareaRef],
  );

  const applyOperator = useCallback(
    (op: OperatorType, motion: MotionResult, _count: number) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const text = ta.value;
      let { start, end } = motion;
      if (start > end) [start, end] = [end, start];
      const opFn = operators[op];
      let newText: string;
      switch (op) {
        case "yank":
          navigator.clipboard.writeText(text.slice(start, end)).catch(() => {});
          newText = text;
          break;
        case "indent":
        case "outdent": {
          // Line-aware: indent/outdent one count of full lines.
          const lineStart = text.lastIndexOf("\n", start - 1) + 1;
          let lineEnd = text.indexOf("\n", end);
          if (lineEnd === -1) lineEnd = text.length;
          newText = opFn(text, lineStart, lineEnd);
          // Place caret at the start of the first indented line (vim behaviour).
          commitEdit(newText, lineStart);
          return;
        }
        default:
          newText = opFn(text, start, end);
      }

      if (op === "change") {
        commitEdit(newText, start);
        setVimState((s) => ({ ...s, mode: "insert", count: 0, operator: null }));
        setMode("insert");
        return;
      }

      if (newText !== text) {
        if (op === "delete") {
          // After delete, place caret at `start` (the leftmost deleted position).
          commitEdit(newText, start);
        } else {
          commitEdit(newText, start);
        }
      }
    },
    [textareaRef, commitEdit, setMode],
  );

  // ------ Pending helpers --------------------------------------------------

  /** Run a motion by key (or its char-arg variant for f/F/t/T). */
  const runMotion = useCallback(
    (key: string, count: number, char: string | undefined, op: OperatorType | null) => {
      const result = applyMotion(key, count, char);
      if (!result) return;
      if (op) {
        applyOperator(op, result, count);
      } else {
        const ta = textareaRef.current;
        if (ta) ta.setSelectionRange(result.end, result.end);
      }
    },
    [applyMotion, applyOperator, textareaRef],
  );

  // ------ Key handler ------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;
      if (!ta) return;

      // IME composition MUST short-circuit BEFORE any vim logic.
      // Browsers translate IME input into a single composition end with
      // key=undefined and isComposing=true; touching them through vim
      // corrupts the typed character.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;

      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+Enter: always run query, regardless of vim mode.
      if (ctrl && key === "Enter") {
        onRun?.();
        autocomplete.hide();
        e.preventDefault();
        return;
      }

      // Autocomplete navigation is independent of enableVim — a user can
      // have vim disabled but still want arrow-key navigation in the
      // dropdown.
      if (autocomplete.visible) {
        if (key === "ArrowDown") { autocomplete.move(1); e.preventDefault(); return; }
        if (key === "ArrowUp")   { autocomplete.move(-1); e.preventDefault(); return; }
        if (key === "Enter" || key === "Tab") {
          autocomplete.accept();
          e.preventDefault();
          return;
        }
        if (key === "Escape") { autocomplete.hide(); e.preventDefault(); return; }
      }

      if (!enableVim) return;

      const state = vimStateRef.current;
      const count = state.count || 1;

      // ----- Pending character-collecting motion (f/F/t/T) --------------
      if (state.pendingMotion) {
        if (key === "Escape") {
          setVimState((s) => ({ ...s, pendingMotion: null, count: 0 }));
          e.preventDefault();
          return;
        }
        const motionKey = state.pendingMotion;
        const char = key.length === 1 ? key : undefined;
        const op = state.operator;
        runMotion(motionKey, count, char, op);
        setVimState((s) => ({
          ...s,
          pendingMotion: null,
          operator: null,
          count: 0,
          lastMotion: motionKey,
          lastOperator: op,
        }));
        e.preventDefault();
        return;
      }

      // ----- Pending prefix (gg, i*, a*) --------------------------------
      if (state.pendingPrefix) {
        if (key === "Escape") {
          setVimState((s) => ({ ...s, pendingPrefix: null, count: 0 }));
          e.preventDefault();
          return;
        }
        const prefix = state.pendingPrefix;
        // gg
        if (prefix === "g") {
          if (key === "g") {
            runMotion("gg", count, undefined, state.operator);
            setVimState((s) => ({
              ...s,
              pendingPrefix: null,
              operator: null,
              count: 0,
              lastMotion: "gg",
            }));
            e.preventDefault();
            return;
          }
          // not gg → reset and let the key fall through below
          setVimState((s) => ({ ...s, pendingPrefix: null }));
          // fall through
        }

        // i*/a* text objects
        if (prefix === "i" || prefix === "a") {
          const objKey = prefix + key;
          const obj = textObjects[objKey];
          if (obj) {
            const result = obj(ta.value, ta.selectionStart);
            const op = state.operator;
            if (op) applyOperator(op, result, count);
            else ta.setSelectionRange(result.end, result.end);
            setVimState((s) => ({
              ...s,
              pendingPrefix: null,
              operator: null,
              count: 0,
              lastMotion: objKey,
            }));
            e.preventDefault();
            return;
          }
          // unknown second key — abort pending
          setVimState((s) => ({ ...s, pendingPrefix: null }));
          // fall through (don't preventDefault for unknown)
        }
      }

      // ----- Pending mode: replace single character -----------------------
      if (state.mode === "pending") {
        if (key === "Escape") {
          setVimState((s) => ({ ...s, mode: "normal", count: 0 }));
          setMode("normal");
          return;
        }
        const pos = ta.selectionStart;
        if (pos < ta.value.length) {
          commitEdit(ta.value.slice(0, pos) + key + ta.value.slice(pos + 1), pos + 1);
        }
        setVimState((s) => ({ ...s, mode: "normal", count: 0 }));
        setMode("normal");
        return;
      }

      // ----- Insert mode ------------------------------------------------
      if (state.mode === "insert") {
        if (key === "Escape") {
          // Cursor back one char — vim's `<Esc>` exits before the last
          // inserted character, not on top of it.
          const p = ta.selectionStart;
          const newPos = Math.max(0, (ta.selectionEnd ?? p) - 1);
          ta.setSelectionRange(newPos, newPos);
          setVimState((s) => ({ ...s, mode: "normal", count: 0, operator: null }));
          setMode("normal");
          e.preventDefault();
          return;
        }
        if (key === "Tab") {
          if (autocomplete.visible) {
            autocomplete.accept();
            e.preventDefault();
            return;
          }
          // No autocomplete: insert a real tab and stop propagation so the
          // browser doesn't refocus the next field.
          const pos = ta.selectionStart;
          commitEdit(ta.value.slice(0, pos) + "\t" + ta.value.slice(pos), pos + 1);
          e.preventDefault();
          return;
        }
        return; // let native input through
      }

      // ----- Visual mode ------------------------------------------------
      if (state.mode === "visual") {
        if (key === "Escape" || (ctrl && key === "c")) {
          // Collapse to the original anchor (visualStart).
          ta.setSelectionRange(state.visualStart ?? 0, state.visualStart ?? 0);
          setVimState((s) => ({
            ...s,
            mode: "normal",
            visualStart: null,
            visualEnd: null,
            count: 0,
          }));
          setMode("normal");
          e.preventDefault();
          return;
        }
        if (key === "d" || key === "x") {
          const start = Math.min(state.visualStart ?? 0, ta.selectionStart);
          const end = Math.max(state.visualEnd ?? 0, ta.selectionEnd);
          commitEdit(ta.value.slice(0, start) + ta.value.slice(end), start);
          setVimState((s) => ({
            ...s, mode: "normal", visualStart: null, visualEnd: null, count: 0,
          }));
          setMode("normal");
          e.preventDefault();
          return;
        }
        if (key === "y") {
          const start = Math.min(state.visualStart ?? 0, ta.selectionStart);
          const end = Math.max(state.visualEnd ?? 0, ta.selectionEnd);
          navigator.clipboard.writeText(ta.value.slice(start, end)).catch(() => {});
          ta.setSelectionRange(start, start);
          setVimState((s) => ({
            ...s, mode: "normal", visualStart: null, visualEnd: null, count: 0,
          }));
          setMode("normal");
          e.preventDefault();
          return;
        }
        if (key === "c") {
          const start = Math.min(state.visualStart ?? 0, ta.selectionStart);
          const end = Math.max(state.visualEnd ?? 0, ta.selectionEnd);
          commitEdit(ta.value.slice(0, start) + ta.value.slice(end), start);
          setVimState((s) => ({
            ...s, mode: "insert", visualStart: null, visualEnd: null, count: 0,
          }));
          setMode("insert");
          e.preventDefault();
          return;
        }
        if (key === "v") {
          ta.setSelectionRange(state.visualStart ?? 0, state.visualStart ?? 0);
          setVimState((s) => ({
            ...s, mode: "normal", visualStart: null, visualEnd: null, count: 0,
          }));
          setMode("normal");
          e.preventDefault();
          return;
        }
        // Extend the visual selection by the motion.
        if (MOTION_KEYS.has(key) || isCharMotionPrefix(key)) {
          if (isCharMotionPrefix(key)) {
            // Visual f<char>: defer to next keystroke — set pendingMotion
            // and keep the selection anchors.
            setVimState((s) => ({ ...s, pendingMotion: key }));
            e.preventDefault();
            return;
          }
          if (key === "G") {
            const targetPos = ta.value.length;
            const anchor = state.visualStart ?? ta.selectionStart;
            ta.setSelectionRange(anchor, targetPos);
            setVimState((s) => ({ ...s, visualEnd: targetPos, count: 0 }));
            e.preventDefault();
            return;
          }
          const result = applyMotion(key, count);
          if (result) {
            const anchor = state.visualStart ?? ta.selectionStart;
            const head = result.end;
            ta.setSelectionRange(anchor, head);
            setVimState((s) => ({ ...s, visualEnd: head, count: 0 }));
            e.preventDefault();
            return;
          }
        }
        // Allow unhandled keys (e.g. typing letters in visual mode would
        // replace the selection — vim behaviour) to pass through naturally.
        return;
      }

      // ----- Normal mode ------------------------------------------------
      if (state.mode === "normal") {
        // Count accumulator
        if (/[0-9]/.test(key) && !ctrl) {
          if (key === "0" && state.count === 0) {
            // bare 0 → line-start motion, not count
            runMotion("0", 1, undefined, null);
            setVimState((s) => ({ ...s, count: 0 }));
            e.preventDefault();
            return;
          }
          setVimState((s) => ({ ...s, count: s.count * 10 + parseInt(key, 10) }));
          e.preventDefault();
          return;
        }

        if (key === "Escape" || (ctrl && key === "c")) {
          setVimState((s) => ({ ...s, count: 0, operator: null, pendingPrefix: null, pendingMotion: null }));
          e.preventDefault();
          return;
        }

        // Operator keys
        const newOp = operatorFromKey(key);
        if (newOp) {
          // Double-operator (dd, yy, cc, >>, <<, ~~) → whole-line operator
          // with the current count.
          if (state.operator === newOp) {
            const start = ta.selectionStart;
            const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
            let lineEnd = ta.value.indexOf("\n", start);
            if (lineEnd === -1) lineEnd = ta.value.length;
            applyOperator(newOp, { start: lineStart, end: lineEnd, exclusive: true }, count);
            setVimState((s) => ({
              ...s, operator: null, count: 0, lastOperator: newOp, lastMotion: "line",
            }));
            e.preventDefault();
            return;
          }
          // Different operator re-starts the sequence (e.g. `d` then `c`
          // in raw mode would just become a new `c` op).
          setVimState((s) => ({ ...s, operator: newOp, count: 0 }));
          e.preventDefault();
          return;
        }

        // Motion keys
        if (MOTION_KEYS.has(key)) {
          runMotion(key, count, undefined, state.operator);
          setVimState((s) => ({
            ...s, operator: null, count: 0,
            lastMotion: key, lastOperator: state.operator,
          }));
          e.preventDefault();
          return;
        }
        if (isCharMotionPrefix(key)) {
          setVimState((s) => ({ ...s, pendingMotion: key, count: 0 }));
          e.preventDefault();
          return;
        }
        if (key === "g") {
          setVimState((s) => ({ ...s, pendingPrefix: "g", count: 0 }));
          e.preventDefault();
          return;
        }

        // Mode switches
        if (key === "i") {
          // `i` alone = insert at cursor. `i` with pending op = text-object
          // prefix.
          if (state.operator) {
            setVimState((s) => ({ ...s, pendingPrefix: "i", count: 0 }));
          } else {
            setVimState((s) => ({ ...s, mode: "insert", count: 0, operator: null }));
            setMode("insert");
          }
          e.preventDefault();
          return;
        }
        if (key === "a") {
          if (state.operator) {
            setVimState((s) => ({ ...s, pendingPrefix: "a", count: 0 }));
          } else {
            const pos = ta.selectionStart;
            if (pos < ta.value.length && ta.value[pos] !== "\n") {
              ta.setSelectionRange(pos + 1, pos + 1);
            }
            setVimState((s) => ({ ...s, mode: "insert", count: 0, operator: null }));
            setMode("insert");
          }
          e.preventDefault();
          return;
        }
        if (key === "A") {
          const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
          const end = lineEnd === -1 ? ta.value.length : lineEnd;
          ta.setSelectionRange(end, end);
          setVimState((s) => ({ ...s, mode: "insert", count: 0, operator: null }));
          setMode("insert");
          e.preventDefault();
          return;
        }
        if (key === "o") {
          const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
          const end = lineEnd === -1 ? ta.value.length : lineEnd;
          commitEdit(ta.value.slice(0, end) + "\n" + ta.value.slice(end), end + 1);
          setVimState((s) => ({ ...s, mode: "insert", count: 0, operator: null }));
          setMode("insert");
          e.preventDefault();
          return;
        }
        if (key === "O") {
          const lineStart = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
          commitEdit(ta.value.slice(0, lineStart) + "\n" + ta.value.slice(lineStart), lineStart + 1);
          setVimState((s) => ({ ...s, mode: "insert", count: 0, operator: null }));
          setMode("insert");
          e.preventDefault();
          return;
        }
        if (key === "v") {
          const p = ta.selectionStart;
          ta.setSelectionRange(p, p);
          setVimState((s) => ({
            ...s, mode: "visual", visualStart: p, visualEnd: p, count: 0,
          }));
          setMode("visual");
          e.preventDefault();
          return;
        }
        if (key === "V") {
          const lineStart = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
          const lineEnd = ta.value.indexOf("\n", ta.selectionStart);
          const end = lineEnd === -1 ? ta.value.length : lineEnd;
          ta.setSelectionRange(lineStart, end);
          setVimState((s) => ({
            ...s, mode: "visual", visualStart: lineStart, visualEnd: end, count: 0,
          }));
          setMode("visual");
          e.preventDefault();
          return;
        }
        if (key === "x") {
          const pos = ta.selectionStart;
          if (pos < ta.value.length) {
            commitEdit(ta.value.slice(0, pos) + ta.value.slice(pos + 1), pos);
          }
          e.preventDefault();
          return;
        }
        if (key === "r") {
          setVimState((s) => ({ ...s, mode: "pending", count: 0 }));
          e.preventDefault();
          return;
        }
        if (key === "p") {
          // Async paste — re-read the live value at resolve time so any
          // keystrokes typed between `p` and clipboard resolution don't
          // get clobbered.
          const cursorAtPress = ta.selectionStart;
          navigator.clipboard.readText()
            .then((clipText) => {
              const live = textareaRef.current;
              if (!live) return;
              const before = live.value.slice(0, cursorAtPress);
              const after = live.value.slice(cursorAtPress);
              const merged = before + clipText + after;
              live.value = merged;
              const newCaret = before.length + clipText.length;
              live.setSelectionRange(newCaret, newCaret);
              if (highlightRef.current) {
                highlightRef.current.innerHTML = highlightSQL(merged, dialect);
              }
              onContentChangeRef.current?.(merged);
            })
            .catch(() => {});
          e.preventDefault();
          return;
        }

        // Unhandled key in normal mode: swallow so accidental letters
        // (e.g. typing "garbage" in normal mode) don't pollute the buffer.
        if (key.length === 1 && !ctrl) {
          e.preventDefault();
          return;
        }
      }
    },
    [
      enableVim, textareaRef, highlightRef, dialect,
      autocomplete, onRun,
      applyMotion, applyOperator, runMotion, commitEdit, setMode,
    ],
  );

  return useMemo(
    () => ({
      mode: vimState.mode,
      operator: vimState.operator,
      count: vimState.count,
      handleKeyDown,
      commitEdit,
      syncFromProp,
    }),
    [vimState.mode, vimState.operator, vimState.count, handleKeyDown, commitEdit, syncFromProp],
  );
}
