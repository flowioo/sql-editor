import { quoteIdentifier, quoteSql, type SqlDialect } from "../../lib/schema-source";

/**
 * UPDATE-statement builder for inline result-grid edits. Pure domain logic —
 * no React, no module state. Extracted from ResultGrid.tsx so it is unit-
 * testable and reusable (a future "edit session" hook can call it without a
 * mounted component).
 */

/** Staged cell edit. `newValue` is null when the user cleared the cell
 *  (meaning SQL NULL). The original value is captured so the caller can skip
 *  writes that resolve back to the original (treat as no-op). */
export interface PendingEdit {
  readonly row: number;
  readonly col: number;
  readonly columnName: string;
  readonly originalValue: string | null;
  readonly newValue: string | null;
}

/** Build the WHERE clause for `rowIdx` using its primary-key columns. Returns
 *  null if the row has no usable PK value (caller should abort the batch). */
export function buildWhereClause(
  rowIdx: number,
  rows: readonly (readonly (string | null)[])[],
  columns: readonly string[],
  pkColumns: readonly string[],
  dialect: SqlDialect,
): string | null {
  const row = rows[rowIdx];
  if (!row) return null;
  const parts: string[] = [];
  for (const pk of pkColumns) {
    const colIdx = columns.indexOf(pk);
    if (colIdx < 0) return null;
    const val = row[colIdx];
    if (val === null || val === undefined) return null;
    parts.push(`${quoteIdentifier(pk, dialect)} = ${quoteSql(val, dialect)}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" AND ");
}

/** Build one UPDATE statement per row that has staged edits. Returns null if
 *  any row lacks a usable WHERE (missing PK); returns [] when there are no
 *  staged edits. Identifiers and values are quoted per `dialect`. */
export function buildUpdateStatements(
  pending: ReadonlyMap<string, PendingEdit>,
  rows: readonly (readonly (string | null)[])[],
  columns: readonly string[],
  tableName: string,
  pkColumns: readonly string[],
  dialect: SqlDialect,
): string[] | null {
  if (pending.size === 0) return [];
  const byRow = new Map<number, PendingEdit[]>();
  for (const edit of pending.values()) {
    const list = byRow.get(edit.row) ?? [];
    list.push(edit);
    byRow.set(edit.row, list);
  }
  const out: string[] = [];
  for (const [rowIdx, edits] of byRow.entries()) {
    const where = buildWhereClause(rowIdx, rows, columns, pkColumns, dialect);
    if (!where) return null;
    const setClause = edits
      .map(
        (e) =>
          `${quoteIdentifier(e.columnName, dialect)} = ${quoteSql(e.newValue, dialect)}`,
      )
      .join(", ");
    out.push(
      `UPDATE ${quoteIdentifier(tableName, dialect)} SET ${setClause} WHERE ${where};`,
    );
  }
  return out;
}
