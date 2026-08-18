import { useCallback, useEffect, useRef, useState } from "react";
import { computeCaretCoords } from "./caret-coords";
import { getCompletions, type SchemaCompletion } from "../lib/schema-source";
import type { DatabaseSchema } from "../hooks/useSchema";

/** Coordinates for anchoring the dropdown just below the caret. */
export interface AutocompletePos {
  top: number;
  left: number;
}

/** Return type of the `useAutocomplete` hook. */
export interface UseAutocompleteReturn {
  readonly items: SchemaCompletion[];
  readonly index: number;
  readonly pos: AutocompletePos;
  readonly visible: boolean;
  readonly setIndex: (next: number) => void;
  readonly move: (delta: number) => void;
  readonly refresh: () => void;
  readonly hide: () => void;
  readonly accept: () => SchemaCompletion | null;
  readonly acceptItem: (item: SchemaCompletion) => void;
}

interface UseAutocompleteOptions {
  readonly textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  readonly schema: DatabaseSchema | null;
  readonly dialect?: "postgresql" | "mysql" | "sqlite" | "redis";
  /** Suppress for a short window after an autocomplete insert so we don't
   *  immediately re-pop right after the user picks an item. */
  readonly suppressMs?: number;
}

const DEFAULT_SUPPRESS_MS = 250;

/**
 * Autocomplete state machine for a textarea.
 *
 * `refresh()` is called on every relevant change (input key, post-paste,
 * focus, etc.). When the dropdown is open:
 *   - `move(+1|-1)` rotates the highlighted item
 *   - `accept()` inserts the highlighted item and returns it
 *   - `acceptItem(it)` inserts a specific item (e.g. mouse click)
 *   - `hide()` closes the dropdown
 *
 * Cursor restoration uses the live `ta.value` so we don't race with the
 * post-async "p" paste path. The dropdown position is computed via
 * `computeCaretCoords` (the standard mirror-div trick).
 */
export function useAutocomplete(opts: UseAutocompleteOptions): UseAutocompleteReturn {
  const { textareaRef, schema, dialect, suppressMs = DEFAULT_SUPPRESS_MS } = opts;

  const [items, setItems] = useState<SchemaCompletion[]>([]);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<AutocompletePos>({ top: 40, left: 12 });
  const [visible, setVisible] = useState(false);

  // Cooldown after an insert so we don't immediately re-open.
  const suppressUntilRef = useRef(0);

  const readLive = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return null;
    return { ta, text: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
  }, [textareaRef]);

  const move = useCallback((delta: number) => {
    setIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta)));
  }, [items.length]);

  const hide = useCallback(() => setVisible(false), []);

  const refresh = useCallback(() => {
    const live = readLive();
    if (!live) return;
    if (Date.now() < suppressUntilRef.current) return;

    const collected = getCompletions(
      live.text,
      live.start,
      schema,
      50,
      dialect ?? "postgresql",
    );
    if (collected.length === 0) {
      setVisible(false);
      return;
    }
    setItems(collected);
    setIndex(0);
    try {
      const caret = computeCaretCoords(live.ta, live.start);
      const cs = getComputedStyle(live.ta);
      const fontSize = parseFloat(cs.fontSize) || 14;
      const lhRaw = cs.lineHeight;
      const lhParsed = parseFloat(lhRaw);
      const lineH = Number.isFinite(lhParsed)
        ? (lhRaw.endsWith("px") ? lhParsed : fontSize * lhParsed)
        : fontSize * 1.7;
      setPos({ top: caret.top + lineH, left: caret.left });
    } catch (e) {
      console.warn("computeCaretCoords failed:", e);
      setPos({ top: 0, left: 0 });
    }
    setVisible(true);
  }, [readLive, schema, dialect]);

  const insertAt = useCallback(
    (item: SchemaCompletion, text: string, caretPos: number, ta: HTMLTextAreaElement) => {
      // Overwrite the in-progress [\w.] run before the cursor.
      let start = caretPos - 1;
      while (start >= 0 && /[\w.]/.test(text[start])) start--;
      start++;
      const insertText = item.apply ?? item.label;
      const newText = text.slice(0, start) + insertText + text.slice(caretPos);
      ta.value = newText;
      const newCaret = start + insertText.length;
      ta.setSelectionRange(newCaret, newCaret);
      suppressUntilRef.current = Date.now() + suppressMs;
      setVisible(false);
    },
    [suppressMs],
  );

  const acceptItem = useCallback((item: SchemaCompletion) => {
    const live = readLive();
    if (!live) return;
    insertAt(item, live.text, live.start, live.ta);
    // Fire a synthetic input so consumers (parent state) get notified
    // through the normal onInput handler.
    live.ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, [readLive, insertAt]);

  const accept = useCallback((): SchemaCompletion | null => {
    if (!visible || items.length === 0) return null;
    const picked = items[Math.max(0, Math.min(items.length - 1, index))];
    acceptItem(picked);
    return picked;
  }, [visible, items, index, acceptItem]);

  // Hide when schema/dialect changes to avoid stale candidates after
  // `acceptItem` consumed a now-stale value.
  useEffect(() => {
    setVisible(false);
  }, [schema, dialect]);

  return {
    items,
    index,
    pos,
    visible,
    setIndex,
    move,
    refresh,
    hide,
    accept,
    acceptItem,
  };
}
