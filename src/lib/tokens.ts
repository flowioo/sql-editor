/**
 * Design tokens — TypeScript mirror of `src/styles/tokens.css`.
 *
 * This file exists so that TS code can reference the same names as CSS,
 * without typos drifting between the two. It is NOT the source of truth —
 * the CSS file is. If you change a value here, change tokens.css too.
 *
 * Usage in TS:
 *   - Mostly for switch/dispatch logic that varies by token name
 *     (e.g. dynamic accent colour for db-type icons).
 *   - For just *using* a token in style, prefer `var(--name)` in CSS.
 */

export type ColorToken =
  // Surfaces
  | "bg"
  | "surface"
  | "surface2"
  | "surface3"
  // Borders
  | "border"
  | "border2"
  // Text
  | "text"
  | "text2"
  | "text3"
  // Accent
  | "accent"
  | "accent2"
  | "accent-light"
  // Semantic
  | "green"
  | "blue"
  | "orange"
  | "red"
  | "yellow"
  // Vim
  | "vim-green"
  | "vim-bg";

export const COLOR_TOKENS: readonly ColorToken[] = [
  "bg",
  "surface",
  "surface2",
  "surface3",
  "border",
  "border2",
  "text",
  "text2",
  "text3",
  "accent",
  "accent2",
  "accent-light",
  "green",
  "blue",
  "orange",
  "red",
  "yellow",
  "vim-green",
  "vim-bg",
] as const;

/**
 * Per-database-type icon label shown in Sidebar/ConnectionDialog.
 * Keep in sync with the type badges the user sees.
 */
export const DB_TYPE_ICON_LABEL: Readonly<Record<string, string>> = {
  sqlite: "SQLite",
  postgresql: "PG",
  mysql: "MY",
  redis: "RD",
};

/**
 * Default port per database type. Used by the config form to pre-fill.
 */
export const DB_TYPE_DEFAULT_PORT: Readonly<Record<string, number>> = {
  postgresql: 5432,
  mysql: 3306,
  redis: 6379,
};