// Vim Engine — minimal implementation inspired by IdeaVim.
//
// Conventions for MotionResult:
//   - `start` is the operator-anchor position (typically the cursor's old pos)
//   - `end`   is the cursor's NEW position after the motion
//   - For left/inverse motions (h, k) the operator range is [end, start)
//     and applyOperator normalises via Math.min/max when deleting.
//   - For forward motions (l, j, w, ...) the range is [start, end).
// Standalone motion just sets the cursor to `end`.

export type VimMode = "insert" | "normal" | "visual" | "pending";

// Text object types
export type TextObjectType = "word" | "WORD" | "sentence" | "paragraph" | "quote" | "bracket";

// Motion result
export interface MotionResult {
  start: number;
  end: number;
  exclusive: boolean; // true = exclusive (inclusive in vim), false = inclusive
}

// Operator types — stored VERBATIM in vim state (not the raw key).
// The caller (useVimKeydown) normalises d/y/c/>/<,/~ → delete/yank/change/indent/outdent/toggleCase
// before applying.
export type OperatorType = "delete" | "yank" | "change" | "indent" | "outdent" | "toggleCase";

// Vim state
export interface VimState {
  mode: VimMode;
  operator: OperatorType | null;
  motion: string | null;
  /** Pending target char for f/F/t/T motion; null when none. */
  pendingMotion: string | null;
  /** First key of a two-key motion (e.g. "g" before "gg"). null when none. */
  pendingPrefix: string | null;
  count: number;
  register: string;
  visualStart: number | null;
  visualEnd: number | null;
  lastOperator: OperatorType | null;
  lastMotion: string | null;
}

export function createVimState(): VimState {
  return {
    mode: "normal",
    operator: null,
    motion: null,
    pendingMotion: null,
    pendingPrefix: null,
    count: 0,
    register: '"',
    visualStart: null,
    visualEnd: null,
    lastOperator: null,
    lastMotion: null,
  };
}

// Word boundaries
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isSpaceChar(ch: string): boolean {
  return /\s/.test(ch);
}

// Find word start (after the current position's word+spaces)
function findWordStart(text: string, pos: number): number {
  if (pos >= text.length || isSpaceChar(text[pos])) {
    while (pos < text.length && isSpaceChar(text[pos])) pos++;
    return Math.min(pos, text.length);
  }
  const startWord = isWordChar(text[pos]);
  while (pos < text.length && isWordChar(text[pos]) === startWord) pos++;
  while (pos < text.length && isSpaceChar(text[pos])) pos++;
  return Math.min(pos, text.length);
}

// Find word end (start of next word-group boundary at or after pos)
function findWordEnd(text: string, pos: number): number {
  if (pos <= 0) return 0;
  const prevWord = isWordChar(text[pos - 1]);
  let end = pos;
  while (end < text.length && isWordChar(text[end]) === prevWord) end++;
  return end;
}

// Find previous word start (vim `b` semantics)
function findPrevWordStart(text: string, pos: number): number {
  if (pos <= 0) return 0;
  while (pos > 0 && isWordChar(text[pos - 1]) === isWordChar(text[pos])) pos--;
  while (pos > 0 && isSpaceChar(text[pos - 1])) pos--;
  while (pos > 0 && isWordChar(text[pos - 1])) pos--;
  return Math.max(0, pos);
}


// Motions
export const motions: Record<
  string,
  (text: string, pos: number, count: number, char?: string) => MotionResult
> = {
  // Character motions
  // h is leftward and exclusive; range = [end, start). The min/max sort in
  // applyOperator turns this into the correct delete range for "dh".
  h: (_text: string, pos: number, count: number): MotionResult => {
    const end = Math.max(0, pos - count);
    return { start: pos, end, exclusive: true };
  },

  l: (text: string, pos: number, count: number): MotionResult => ({
    start: pos,
    end: Math.min(text.length, pos + count),
    exclusive: true,
  }),

  // Line motions
  j: (text: string, pos: number, count: number): MotionResult => {
    const lines = text.slice(0, pos + 1).split("\n");
    const currentLine = lines.length - 1;
    const col = lines[currentLine].length; // visual column = end-of-line position (length, not last idx)
    const targetLine = Math.min(lines.length - 1, currentLine + count);
    const targetLines = text.split("\n");
    const targetCol = Math.min(col, (targetLines[targetLine] ?? "").length);
    let targetPos = 0;
    for (let i = 0; i < targetLine; i++) {
      targetPos += targetLines[i].length + 1;
    }
    targetPos += targetCol;
    return { start: pos, end: targetPos, exclusive: true };
  },

  k: (text: string, pos: number, count: number): MotionResult => {
    const lines = text.slice(0, pos + 1).split("\n");
    const currentLine = lines.length - 1;
    const col = lines[currentLine].length;
    const targetLine = Math.max(0, currentLine - count);
    const targetLines = text.split("\n");
    const targetCol = Math.min(col, (targetLines[targetLine] ?? "").length);
    let targetPos = 0;
    for (let i = 0; i < targetLine; i++) {
      targetPos += targetLines[i].length + 1;
    }
    targetPos += targetCol;
    return { start: pos, end: targetPos, exclusive: true };
  },

  "0": (_text: string, pos: number): MotionResult => {
    const lineStart = _text.lastIndexOf("\n", pos - 1) + 1;
    return { start: pos, end: lineStart, exclusive: true };
  },

  "$": (_text: string, pos: number): MotionResult => {
    const lineEnd = _text.indexOf("\n", pos);
    const end = lineEnd === -1 ? _text.length : lineEnd;
    return { start: pos, end, exclusive: true };
  },

  "^": (_text: string, pos: number): MotionResult => {
    const lineStart = _text.lastIndexOf("\n", pos - 1) + 1;
    let start = lineStart;
    while (start < _text.length && /\s/.test(_text[start])) start++;
    return { start: pos, end: Math.min(start, _text.length), exclusive: true };
  },

  // Word motions
  w: (text: string, pos: number, count: number): MotionResult => {
    let p = pos;
    for (let i = 0; i < count; i++) {
      p = findWordEnd(text, p);
      p = findWordStart(text, p);
    }
    return { start: pos, end: Math.min(p, text.length), exclusive: true };
  },

  b: (text: string, pos: number, count: number): MotionResult => {
    let p = pos;
    for (let i = 0; i < count; i++) {
      p = findPrevWordStart(text, p);
    }
    return { start: pos, end: Math.max(0, p), exclusive: true };
  },

  e: (text: string, pos: number, count: number): MotionResult => {
    let p = pos;
    for (let i = 0; i < count; i++) {
      p = findWordEnd(text, p + 1);
    }
    return { start: pos, end: Math.min(p, text.length), exclusive: true };
  },

  ge: (text: string, pos: number, count: number): MotionResult => {
    let p = pos;
    for (let i = 0; i < count; i++) {
      p = findPrevWordStart(text, p - 1);
      if (p > 0) p = findWordEnd(text, p);
    }
    return { start: pos, end: Math.max(0, p), exclusive: true };
  },

  // Document motions
  // gg → start of file (position 0). Two-key: caller must collect "g"+"g".
  gg: (_text: string, _pos: number): MotionResult => ({ start: _pos, end: 0, exclusive: true }),
  // G → start of LAST line (not end-of-file).
  G: (text: string, pos: number): MotionResult => {
    const lastNl = text.lastIndexOf("\n");
    const end = lastNl === -1 ? 0 : lastNl + 1;
    return { start: pos, end, exclusive: true };
  },

  // Find character (f/F/t/T) — `char` is provided by the caller after the
  // keydown loop collects the next printable key.
  f: (text: string, pos: number, count: number, char?: string): MotionResult => {
    if (!char) return { start: pos, end: pos, exclusive: true };
    let p = pos + 1;
    for (let i = 0; i < count; i++) {
      const found = text.indexOf(char, p);
      if (found === -1) { p = pos; break; }
      p = found + 1;
    }
    return { start: pos, end: p, exclusive: true };
  },

  F: (text: string, pos: number, count: number, char?: string): MotionResult => {
    if (!char) return { start: pos, end: pos, exclusive: true };
    let p = pos - 1;
    for (let i = 0; i < count; i++) {
      const found = text.lastIndexOf(char, p);
      if (found === -1) { p = pos; break; }
      p = found - 1;
    }
    return { start: pos, end: Math.max(0, p + 1), exclusive: true };
  },

  t: (text: string, pos: number, count: number, char?: string): MotionResult => {
    const result = motions.f(text, pos, count, char);
    if (result.end > pos) result.end = Math.max(pos + 1, result.end - 1);
    return result;
  },

  T: (text: string, pos: number, count: number, char?: string): MotionResult => {
    const result = motions.F(text, pos, count, char);
    if (result.end < pos) result.end = Math.min(pos - 1, result.end + 1);
    return result;
  },
};

// Text objects — return INCLUSIVE ranges, used by operators the same way as
// motions (the operator uses min/max so direction is irrelevant).
export const textObjects: Record<
  string,
  (text: string, pos: number) => MotionResult
> = {
  // Inner word: contiguous [A-Za-z0-9_] run touching the cursor.
  iw: (text: string, pos: number): MotionResult => {
    if (pos >= text.length) return { start: pos, end: pos, exclusive: false };
    const startWord = isWordChar(text[pos]);
    let start = pos, end = pos;
    while (start > 0 && isWordChar(text[start - 1]) === startWord) start--;
    while (end < text.length && isWordChar(text[end]) === startWord) end++;
    return { start, end, exclusive: false };
  },

  aw: (text: string, pos: number): MotionResult => {
    const inner = textObjects.iw(text, pos);
    if (inner.start === inner.end) return inner;
    const result: MotionResult = { start: inner.start, end: inner.end, exclusive: false };
    // Include trailing same-line whitespace.
    while (result.end < text.length && text[result.end] === " ") result.end++;
    // Include leading whitespace only if there was trailing whitespace
    // (vim's "aw" = a word + its surrounding single space, on the side
    // with whitespace).
    if (result.end > inner.end) {
      // trailing side already had space, nothing on leading
    } else if (result.start > 0 && text[result.start - 1] === " ") {
      result.start--;
    }
    return result;
  },

  // Sentence
  is: (_text: string, pos: number): MotionResult => {
    const sentences = _text.split(/(?<=[.!?])\s+/);
    let offset = 0;
    for (const s of sentences) {
      const start = offset;
      const end = offset + s.length;
      if (pos >= start && pos <= end) {
        return { start, end: Math.min(end, _text.length), exclusive: false };
      }
      offset = end + (s.endsWith("\n") ? 1 : 0);
    }
    return { start: pos, end: pos, exclusive: false };
  },

  as: (_text: string, pos: number): MotionResult => {
    const inner = textObjects.is(_text, pos);
    const result: MotionResult = { ...inner };
    while (result.start > 0 && /\s/.test(_text[result.start - 1])) result.start--;
    while (result.end < _text.length && /\s/.test(_text[result.end])) result.end++;
    return result;
  },

  // Paragraph (separated by blank lines)
  ip: (_text: string, pos: number): MotionResult => {
    const paragraphs = _text.split(/\n\s*\n/);
    let offset = 0;
    for (const p of paragraphs) {
      const start = offset;
      const end = offset + p.length;
      if (pos >= start && pos <= end) {
        return { start, end: Math.min(end, _text.length), exclusive: false };
      }
      offset = end + 1;
    }
    return { start: pos, end: pos, exclusive: false };
  },

  ap: (_text: string, pos: number): MotionResult => {
    const result = { ...textObjects.ip(_text, pos) };
    while (result.start > 0 && _text[result.start - 1] === "\n") result.start--;
    while (result.end < _text.length && _text[result.end] === "\n") result.end++;
    return result;
  },

  // Brackets: inner/around "()"/"[]"/"{}"
  ib: (text: string, pos: number): MotionResult => {
    const open = "([{";
    const close = ")]}";
    let best: MotionResult | null = null;
    let bestDist = Infinity;
    for (let i = pos; i < text.length; i++) {
      const ci = close.indexOf(text[i]);
      if (ci !== -1) {
        let depth = 1;
        for (let j = i - 1; j >= 0; j--) {
          if (text[j] === open[ci]) {
            depth--;
            if (depth === 0) {
              const dist = i - j;
              if (dist < bestDist) {
                bestDist = dist;
                best = { start: j + 1, end: i, exclusive: false };
              }
              break;
            }
          } else if (close.indexOf(text[j]) !== -1) {
            depth++;
          }
        }
      }
    }
    return best ?? { start: pos, end: pos, exclusive: false };
  },

  ab: (text: string, pos: number): MotionResult => {
    const inner = textObjects.ib(text, pos);
    if (inner.start === inner.end) return inner;
    const result: MotionResult = { start: inner.start - 1, end: inner.end + 1, exclusive: false };
    if (result.start < 0) result.start = 0;
    if (result.end > text.length) result.end = text.length;
    return result;
  },

  // Quotes — find nearest quote pair around pos
  iq: (text: string, pos: number): MotionResult => {
    const quotes = ['"', "'", "`"];
    for (const q of quotes) {
      let end = -1;
      for (let i = pos; i < text.length; i++) {
        if (text[i] === q) { end = i; break; }
      }
      let start = -1;
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === q) { start = i; break; }
      }
      if (start !== -1 && end !== -1 && pos > start && pos <= end) {
        return { start: start + 1, end, exclusive: false };
      }
    }
    return { start: pos, end: pos, exclusive: false };
  },

  aq: (text: string, pos: number): MotionResult => {
    const quotes = ['"', "'", "`"];
    for (const q of quotes) {
      let end = -1;
      for (let i = pos; i < text.length; i++) {
        if (text[i] === q) { end = i + 1; break; }
      }
      let start = -1;
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === q) { start = i; break; }
      }
      if (start !== -1 && end !== -1 && pos >= start && pos <= end) {
        return { start, end, exclusive: false };
      }
    }
    return { start: pos, end: pos, exclusive: false };
  },
};

// Operators — delete/yank/change are all range-based text mutations.
// delete and change are equivalent for our purposes (both splice out the range
// and enter insert mode is handled by the keymap, not the operator itself).
function spliceRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end);
}

export const operators = {
  delete: spliceRange,
  change: spliceRange,

  yank: (text: string, start: number, end: number): string => text.slice(start, end),

  indent: (text: string, start: number, end: number): string => {
    const lines = text.slice(start, end).split("\n");
    const indented = lines.map((l) => "  " + l).join("\n");
    return text.slice(0, start) + indented + text.slice(end);
  },

  outdent: (text: string, start: number, end: number): string => {
    const lines = text.slice(start, end).split("\n");
    const outdented = lines.map((l) => (l.startsWith("  ") ? l.slice(2) : l)).join("\n");
    return text.slice(0, start) + outdented + text.slice(end);
  },

  toggleCase: (text: string, start: number, end: number): string => {
    const before = text.slice(0, start);
    const chars = text.slice(start, end).split("");
    const toggled = chars.map((c) => {
      if (c === c.toUpperCase() && c !== c.toLowerCase()) return c.toLowerCase();
      if (c === c.toLowerCase() && c !== c.toUpperCase()) return c.toUpperCase();
      return c;
    }).join("");
    return before + toggled + text.slice(end);
  },
} as const;

/**
 * Map a raw key (`"d"`, `"y"`, `"c"`, `">"`, `"<"`, `"~"`) to a canonical
 * OperatorType. Used by useVimKeydown so the value stored in vimState.operator
 * matches what applyOperator expects — without this, `dw` silently no-ops
 * because applyOperator's switch never matches `"d"`.
 */
export function operatorFromKey(key: string): OperatorType | null {
  switch (key) {
    case "d": return "delete";
    case "y": return "yank";
    case "c": return "change";
    case ">": return "indent";
    case "<": return "outdent";
    case "~": return "toggleCase";
    default: return null;
  }
}
