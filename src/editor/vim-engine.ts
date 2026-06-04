// Vim Engine - 极简实现参考 IdeaVim

export type VimMode = "insert" | "normal" | "visual" | "pending";

// Text object types
export type TextObjectType = "word" | "WORD" | "sentence" | "paragraph" | "quote" | "bracket";

// Motion result
export interface MotionResult {
  start: number;
  end: number;
  exclusive: boolean; // true = exclusive (inclusive in vim), false = inclusive
}

// Operator types
export type OperatorType = "delete" | "yank" | "change" | "indent" | "outdent" | "toggleCase";

// Vim state
export interface VimState {
  mode: VimMode;
  operator: OperatorType | null;
  motion: string | null;
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
    count: 1,
    register: '"',
    visualStart: null,
    visualEnd: null,
    lastOperator: null,
    lastMotion: null,
  };
}

// Word boundaries
function isWordChar(ch: string): boolean {
  return /[\w]/.test(ch);
}

function isSpaceChar(ch: string): boolean {
  return /\s/.test(ch);
}

// Find word start
function findWordStart(text: string, pos: number): number {
  if (pos >= text.length || isSpaceChar(text[pos])) {
    // Move to end of current word
    while (pos < text.length && isSpaceChar(text[pos])) pos++;
    return Math.min(pos, text.length);
  }
  const startWord = isWordChar(text[pos]);
  while (pos < text.length && isWordChar(text[pos]) === startWord) pos++;
  while (pos < text.length && isSpaceChar(text[pos])) pos++;
  return Math.min(pos, text.length);
}

// Find word end
function findWordEnd(text: string, pos: number): number {
  if (pos <= 0) return 0;
  const prevWord = isWordChar(text[pos - 1]);
  let end = pos;
  while (end < text.length && isWordChar(text[end]) === prevWord) end++;
  return end;
}

// Find prev word start
function findPrevWordStart(text: string, pos: number): number {
  if (pos <= 0) return 0;
  // Skip current word
  while (pos > 0 && isWordChar(text[pos - 1]) === isWordChar(text[pos])) pos--;
  while (pos > 0 && isSpaceChar(text[pos - 1])) pos--;
  // Skip prev word
  while (pos > 0 && isWordChar(text[pos - 1])) pos--;
  return Math.max(0, pos);
}

// Motions
export const motions = {
  // Character motions
  h: (_text: string, pos: number, count: number): MotionResult => ({
    start: Math.max(0, pos - count),
    end: pos,
    exclusive: true,
  }),

  l: (text: string, pos: number, count: number): MotionResult => ({
    start: pos,
    end: Math.min(text.length, pos + count),
    exclusive: true,
  }),

  // Line motions
  j: (text: string, pos: number, count: number): MotionResult => {
    const lines = text.slice(0, pos + 1).split("\n");
    const currentLine = lines.length - 1;
    const col = lines[currentLine].length - 1;
    const targetLine = Math.min(lines.length - 1, currentLine + count);
    const targetLines = text.split("\n");
    const targetCol = Math.min(col, (targetLines[targetLine] || "").length);
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
    const col = lines[currentLine].length - 1;
    const targetLine = Math.max(0, currentLine - count);
    const targetLines = text.split("\n");
    const targetCol = Math.min(col, (targetLines[targetLine] || "").length);
    let targetPos = 0;
    for (let i = 0; i < targetLine; i++) {
      targetPos += targetLines[i].length + 1;
    }
    targetPos += targetCol;
    return { start: targetPos, end: pos, exclusive: true };
  },

  "0": (_text: string, pos: number): MotionResult => {
    const lineStart = _text.lastIndexOf("\n", pos - 1) + 1;
    return { start: pos, end: lineStart, exclusive: true };
  },

  "$:": (_text: string, pos: number): MotionResult => {
    const lineEnd = _text.indexOf("\n", pos);
    const end = lineEnd === -1 ? _text.length : lineEnd;
    return { start: pos, end: end, exclusive: true };
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
  gg: (_text: string, _pos: number): MotionResult => ({ start: _pos, end: 0, exclusive: true }),
  G: (_text: string, pos: number): MotionResult => ({ start: pos, end: _text.length, exclusive: true }),

  // Find character
  "f:": (text: string, pos: number, count: number, char?: string): MotionResult => {
    if (!char) return { start: pos, end: pos, exclusive: true };
    let p = pos + 1;
    for (let i = 0; i < count; i++) {
      const found = text.indexOf(char, p);
      if (found === -1) {
        p = pos;
        break;
      }
      p = found + 1;
    }
    return { start: pos, end: p, exclusive: true };
  },

  "F:": (text: string, pos: number, count: number, char?: string): MotionResult => {
    if (!char) return { start: pos, end: pos, exclusive: true };
    let p = pos - 1;
    for (let i = 0; i < count; i++) {
      const found = text.lastIndexOf(char, p);
      if (found === -1) {
        p = pos;
        break;
      }
      p = found - 1;
    }
    return { start: pos, end: Math.max(0, p + 1), exclusive: true };
  },

  "t:": (text: string, pos: number, count: number, char?: string): MotionResult => {
    const result = motions["f:"](text, pos, count, char);
    if (result.end > pos) result.end = Math.max(pos + 1, result.end - 1);
    return result;
  },

  "T:": (text: string, pos: number, count: number, char?: string): MotionResult => {
    const result = motions["F:"](text, pos, count, char);
    if (result.end < pos) result.end = Math.min(pos - 1, result.end + 1);
    return result;
  },
};

// Text objects
export const textObjects = {
  iw: (text: string, pos: number): MotionResult => {
    // inner word
    if (pos >= text.length) return { start: pos, end: pos, exclusive: true };
    const startWord = isWordChar(text[pos]);
    let start = pos,
      end = pos;
    while (start > 0 && isWordChar(text[start - 1]) === startWord) start--;
    while (end < text.length && isWordChar(text[end]) === startWord) end++;
    return { start, end, exclusive: false };
  },

  aw: (text: string, pos: number): MotionResult => {
    const result = textObjects.iw(text, pos);
    // Include trailing space
    while (result.end < text.length && /\s/.test(text[result.end]) && text[result.end] !== "\n") {
      result.end++;
    }
    // Include leading space
    while (result.start > 0 && /\s/.test(text[result.start - 1]) && text[result.start - 1] !== "\n") {
      result.start--;
    }
    return result;
  },

  iW: (text: string, pos: number): MotionResult => {
    // inner WORD (whitespace separated)
    if (pos >= text.length) return { start: pos, end: pos, exclusive: true };
    const startSpace = isSpaceChar(text[pos]);
    let start = pos,
      end = pos;
    while (start > 0 && isSpaceChar(text[start - 1]) === startSpace) start--;
    while (end < text.length && isSpaceChar(text[end]) === startSpace) end++;
    return { start, end, exclusive: false };
  },

  aW: (text: string, pos: number): MotionResult => {
    const result = textObjects.iW(text, pos);
    while (result.end < text.length && /\s/.test(text[result.end])) result.end++;
    while (result.start > 0 && /\s/.test(text[result.start - 1])) result.start--;
    return result;
  },

  is: (_text: string, pos: number): MotionResult => {
    // inner sentence
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
    const result = textObjects.is(_text, pos);
    // Include leading whitespace
    while (result.start > 0 && /\s/.test(_text[result.start - 1])) result.start--;
    // Include trailing whitespace
    while (result.end < _text.length && /\s/.test(_text[result.end])) result.end++;
    return result;
  },

  ip: (_text: string, pos: number): MotionResult => {
    // inner paragraph
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
    const result = textObjects.ip(_text, pos);
    // Include empty line before/after
    while (result.start > 0 && _text[result.start - 1] === "\n") result.start--;
    while (result.end < _text.length && _text[result.end] === "\n") result.end++;
    return result;
  },

  // Brackets
  ib: (text: string, pos: number): MotionResult => {
    const open = "([{";
    const close = ")]}";
    let best: MotionResult | null = null;
    let bestDist = Infinity;

    // Find matching bracket
    for (let i = pos; i < text.length; i++) {
      const ci = close.indexOf(text[i]);
      if (ci !== -1) {
        // Find open
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
    return best || { start: pos, end: pos, exclusive: false };
  },

  ab: (text: string, pos: number): MotionResult => {
    const result = textObjects.ib(text, pos);
    if (result.start !== result.end) {
      result.start--;
      result.end++;
    }
    return result;
  },

  // Quotes
  iq: (text: string, pos: number): MotionResult => {
    const quotes = ['"', "'", "`"];
    for (const q of quotes) {
      let start = -1,
        end = -1;
      for (let i = pos; i < text.length; i++) {
        if (text[i] === q) {
          end = i;
          break;
        }
      }
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === q) {
          start = i;
          break;
        }
      }
      if (start !== -1 && end !== -1 && pos > start && pos <= end) {
        return { start: start + 1, end: end, exclusive: false };
      }
    }
    return { start: pos, end: pos, exclusive: false };
  },

  aq: (text: string, pos: number): MotionResult => {
    const quotes = ['"', "'", "`"];
    for (const q of quotes) {
      let start = -1,
        end = -1;
      for (let i = pos; i < text.length; i++) {
        if (text[i] === q) {
          end = i + 1;
          break;
        }
      }
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === q) {
          start = i;
          break;
        }
      }
      if (start !== -1 && end !== -1 && pos >= start && pos <= end) {
        return { start, end, exclusive: false };
      }
    }
    return { start: pos, end: pos, exclusive: false };
  },
};

// Operators
export const operators = {
  delete: (text: string, start: number, end: number): string => {
    return text.slice(0, start) + text.slice(end);
  },

  yank: (text: string, start: number, end: number): string => {
    return text.slice(start, end);
  },

  change: (text: string, start: number, end: number): string => {
    return text.slice(0, start) + text.slice(end);
  },

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
};
