import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StatementResult } from "../hooks/useQuery";
import {
  extractTableFromSql,
  getColumnsForTable,
  getPrimaryKeyColumns,
} from "../lib/schema-source";
import "../styles/result-grid.css";

interface ResultGridProps {
  readonly result: StatementResult;
  /** Called when the user confirms the staged edits. Receives one or more
   *  UPDATE statements (one per modified row). */
  readonly onSubmitUpdate?: (sqls: readonly string[]) => void;
}

const ROW_HEIGHT = 28;
const VISIBLE_ROWS = 50;
const TOAST_DURATION_MS = 1400;

interface CellRef {
  readonly row: number;
  readonly col: number;
}

/** SQL string-literal escaping: doubles single quotes per SQL convention. */
function quoteSql(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

/** Staged edit: a single cell change. The original value is captured so we
 *  can skip writes that resolve back to the original (treat as no-op). */
interface PendingEdit {
  readonly row: number;
  readonly col: number;
  readonly columnName: string;
  readonly originalValue: string | null;
  readonly newValue: string;
}

export function ResultGrid({ result, onSubmitUpdate }: ResultGridProps) {
  const { sql, columns, rows, affected_rows, truncated } = result;

  const totalHeight = useMemo(() => rows.length * ROW_HEIGHT, [rows.length]);
  const [copied, setCopied] = useState<CellRef | null>(null);
  // Inline editor state — when not null, the given cell is in edit mode.
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [editValue, setEditValue] = useState("");
  // Staged edits keyed by `${row}:${col}`. Multiple cells across the result
  // can be edited before the user clicks Submit.
  const [pending, setPending] = useState<Map<string, PendingEdit>>(
    () => new Map(),
  );
  const [editError, setEditError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Reset staged edits whenever a fresh result arrives (e.g. after re-run).
  useEffect(() => {
    setPending(new Map());
    setEditing(null);
    setEditValue("");
    setEditError(null);
  }, [sql, rows]);

  // Auto-focus the inline editor input when entering edit mode.
  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  // Try to derive the target table from the SELECT statement. If we
  // can't (e.g. ad-hoc query), inline editing is disabled.
  const tableName = useMemo(() => extractTableFromSql(sql), [sql]);
  const pkColumns = useMemo(
    () => (tableName ? getPrimaryKeyColumns(tableName) : []),
    [tableName],
  );
  const editable = tableName !== null && pkColumns.length > 0;

  // Compute WHERE-clause value expressions from the row using pk
  // columns. Returns null if any pk value is missing.
  const buildWhereClause = useCallback(
    (rowIdx: number): string | null => {
      if (!tableName) return null;
      const row = rows[rowIdx];
      if (!row) return null;
      const parts: string[] = [];
      for (const pk of pkColumns) {
        const colIdx = columns.indexOf(pk);
        if (colIdx < 0) return null;
        const val = row[colIdx];
        if (val === null || val === undefined) return null;
        parts.push(`${pk} = ${quoteSql(val)}`);
      }
      if (parts.length === 0) return null;
      return parts.join(" AND ");
    },
    [tableName, pkColumns, columns, rows],
  );

  /** Stage an edit; if `newValue` matches the original, the entry is removed. */
  const stageEdit = useCallback(
    (row: number, col: number, originalValue: string | null, newValue: string) => {
      const columnName = columns[col];
      if (!columnName) return;
      const key = `${row}:${col}`;
      setPending((prev) => {
        const next = new Map(prev);
        // No-op if value didn't change.
        const orig = originalValue ?? "";
        const next2 = newValue ?? "";
        if (orig === next2) {
          next.delete(key);
        } else {
          next.set(key, { row, col, columnName, originalValue, newValue });
        }
        return next;
      });
    },
    [columns],
  );

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      // Don't interfere with inline edit input.
      if (editing) return;
      const cell = rows[row]?.[col];
      const value = cell ?? "NULL";
      void navigator.clipboard
        .writeText(value)
        .then(() => {
          setCopied({ row, col });
          setEditing(null);
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            setCopied(null);
            timerRef.current = null;
          }, TOAST_DURATION_MS);
        })
        .catch(() => {
          // Clipboard unavailable; no-op.
        });
    },
    [rows, editing],
  );

  const handleCellDoubleClick = useCallback(
    (row: number, col: number) => {
      if (!editable) {
        // Fall back to copy behavior when we can't construct an UPDATE.
        handleCellClick(row, col);
        return;
      }
      const cell = rows[row]?.[col] ?? "";
      setEditValue(cell);
      setEditError(null);
      setEditing({ row, col });
      setCopied(null);
    },
    [rows, editable, handleCellClick],
  );

  /** Commit the current inline edit into the staged map. Does NOT execute. */
  const stageCurrentEdit = useCallback(() => {
    if (!editing) return;
    const { row, col } = editing;
    const originalValue = rows[row]?.[col] ?? null;
    stageEdit(row, col, originalValue, editValue);
    setEditing(null);
    setEditValue("");
    setEditError(null);
  }, [editing, rows, editValue, stageEdit]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditValue("");
    setEditError(null);
  }, []);

  const cancelAllPending = useCallback(() => {
    setPending(new Map());
    setEditing(null);
    setEditValue("");
    setEditError(null);
  }, []);

  /** Group staged edits by row, generate one UPDATE statement per row. */
  const buildUpdateStatements = useCallback((): string[] | null => {
    if (!tableName) return null;
    if (pending.size === 0) return [];
    const byRow = new Map<number, PendingEdit[]>();
    for (const edit of pending.values()) {
      const list = byRow.get(edit.row) ?? [];
      list.push(edit);
      byRow.set(edit.row, list);
    }
    const out: string[] = [];
    for (const [rowIdx, edits] of byRow.entries()) {
      const where = buildWhereClause(rowIdx);
      if (!where) return null;
      const setClause = edits
        .map((e) => `${e.columnName} = ${quoteSql(e.newValue)}`)
        .join(", ");
      out.push(`UPDATE ${tableName} SET ${setClause} WHERE ${where};`);
    }
    return out;
  }, [tableName, pending, buildWhereClause]);

  const handleSubmit = useCallback(() => {
    const statements = buildUpdateStatements();
    if (!statements) {
      setEditError("无法构造 UPDATE 语句(缺少主键或表名)");
      return;
    }
    if (statements.length === 0) return;
    onSubmitUpdate?.(statements);
    // Don't clear pending here — the parent dialog will call back on confirm/cancel.
  }, [buildUpdateStatements, onSubmitUpdate]);

  /** Expose imperative control so App can clear pending after a confirmed
   *  execution (or restore on cancel). Wired via ref below. */
  useEffect(() => {
    (ResultGrid as unknown as { __controller?: GridController }).__controller = {
      clearPending: () => setPending(new Map()),
      restorePending: () => {
        // Pending edits stay in state; nothing to do here. Kept for symmetry.
      },
    };
    return () => {
      delete (ResultGrid as unknown as { __controller?: GridController })
        .__controller;
    };
  }, []);

  const toastText = useMemo(() => {
    if (editError) return editError;
    if (editing) {
      return `编辑 [${columns[editing.col] ?? ""}] — 回车暂存 / Esc 取消`;
    }
    if (!copied) return null;
    const columnName = columns[copied.col] ?? "";
    return `已复制: [${columnName}] ${rows[copied.row]?.[copied.col] ?? "NULL"}`;
  }, [copied, editError, editing, columns, rows]);

  const allColumns = useMemo(
    () => (tableName ? getColumnsForTable(tableName) : []),
    [tableName],
  );
  const hintText = editable
    ? "单击复制 · 双击编辑 · 编辑多个后点「提交」"
    : "双击单元格复制内容";

  return (
    <>
      <div className="result-header">
        <span className="result-count">
          {rows.length === affected_rows
            ? `${rows.length} 行`
            : `${rows.length} 行 (影响 ${affected_rows} 行)`}
        </span>
        {truncated && (
          <span className="result-truncated">
            结果已截断，最多显示 {rows.length} 行
          </span>
        )}
        {tableName && (
          <span className="result-table">表: {tableName}</span>
        )}
        {editable && pkColumns.length > 0 && (
          <span className="result-pk">主键: {pkColumns.join(", ")}</span>
        )}
        <span className="result-hint">{hintText}</span>
        {pending.size > 0 && (
          <span className="result-pending">
            待提交: <strong>{pending.size}</strong> 处
            <button
              className="result-pending-cancel"
              onClick={cancelAllPending}
              title="丢弃所有待提交修改"
            >
              取消全部
            </button>
            <button
              className="result-pending-submit"
              onClick={handleSubmit}
              title="生成 UPDATE 语句并弹出确认"
            >
              提交
            </button>
          </span>
        )}
        {toastText && <span className="result-toast">{toastText}</span>}
      </div>
      <div className="result-scroll">
        <table className="result-grid">
          <thead>
            <tr>
              <th className="row-num" />
              {columns.map((col, i) => (
                <th
                  key={i}
                  title={allColumns.includes(col) ? "" : "未匹配到 schema 列"}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="result-empty">
                  无数据
                </td>
              </tr>
            ) : rows.length <= VISIBLE_ROWS ? (
              rows.map((row, ri) => (
                <tr key={ri} style={{ height: ROW_HEIGHT }}>
                  <td className="row-num">{ri + 1}</td>
                  {row.map((cell, ci) => {
                    const pendingKey = `${ri}:${ci}`;
                    const staged = pending.get(pendingKey);
                    return (
                      <CellTd
                        key={ci}
                        row={ri}
                        col={ci}
                        cell={cell}
                        staged={staged}
                        editing={editing}
                        editValue={editValue}
                        setEditValue={setEditValue}
                        editInputRef={editInputRef}
                        stageCurrentEdit={stageCurrentEdit}
                        cancelEdit={cancelEdit}
                        copied={copied}
                        onClick={handleCellClick}
                        onDoubleClick={handleCellDoubleClick}
                      />
                    );
                  })}
                </tr>
              ))
            ) : (
              <VirtualizedRows
                rows={rows}
                columns={columns}
                visibleRows={VISIBLE_ROWS}
                totalHeight={totalHeight}
                pending={pending}
                editing={editing}
                editValue={editValue}
                setEditValue={setEditValue}
                editInputRef={editInputRef}
                copied={copied}
                stageCurrentEdit={stageCurrentEdit}
                cancelEdit={cancelEdit}
                onCellClick={handleCellClick}
                onCellDoubleClick={handleCellDoubleClick}
              />
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Imperative controller exposed via module-level singleton. Used by App to
 *  clear staged edits after a confirmed execution. */
interface GridController {
  readonly clearPending: () => void;
  readonly restorePending: () => void;
}

export function clearResultGridPending(): void {
  const ctrl = (ResultGrid as unknown as { __controller?: GridController })
    .__controller;
  ctrl?.clearPending();
}

interface CellTdProps {
  readonly row: number;
  readonly col: number;
  readonly cell: string | null;
  readonly staged: PendingEdit | undefined;
  readonly editing: CellRef | null;
  readonly editValue: string;
  readonly setEditValue: (v: string) => void;
  readonly editInputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly stageCurrentEdit: () => void;
  readonly cancelEdit: () => void;
  readonly copied: CellRef | null;
  readonly onClick: (row: number, col: number) => void;
  readonly onDoubleClick: (row: number, col: number) => void;
}

function CellTd({
  row,
  col,
  cell,
  staged,
  editing,
  editValue,
  setEditValue,
  editInputRef,
  stageCurrentEdit,
  cancelEdit,
  copied,
  onClick,
  onDoubleClick,
}: CellTdProps) {
  const isEditing = editing?.row === row && editing?.col === col;
  if (isEditing) {
    return (
      <td className="cell-editing">
        <input
          ref={editInputRef}
          className="cell-edit-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              stageCurrentEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          // Stay in edit mode on blur; the user might click another cell.
          spellCheck={false}
        />
      </td>
    );
  }
  const isCopied = copied?.row === row && copied?.col === col;
  const display = staged ? staged.newValue : cell ?? "NULL";
  const isStaged = staged !== undefined;
  return (
    <td
      className={[
        cell === null && !isStaged ? "cell-null" : "",
        isCopied ? "cell-copied" : "",
        isStaged ? "cell-staged" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onClick(row, col)}
      onDoubleClick={() => onDoubleClick(row, col)}
      title={
        isStaged
          ? `原值: ${staged?.originalValue ?? "NULL"} → 新值: ${staged?.newValue ?? ""}`
          : "单击复制 · 双击编辑"
      }
    >
      {display}
    </td>
  );
}

interface VirtualizedRowsProps {
  readonly rows: readonly (readonly (string | null)[])[];
  readonly columns: readonly string[];
  readonly visibleRows: number;
  readonly totalHeight: number;
  readonly pending: Map<string, PendingEdit>;
  readonly editing: CellRef | null;
  readonly editValue: string;
  readonly setEditValue: (v: string) => void;
  readonly editInputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly copied: CellRef | null;
  readonly stageCurrentEdit: () => void;
  readonly cancelEdit: () => void;
  readonly onCellClick: (row: number, col: number) => void;
  readonly onCellDoubleClick: (row: number, col: number) => void;
}

function VirtualizedRows({
  rows,
  columns,
  visibleRows,
  totalHeight,
  pending,
  editing,
  editValue,
  setEditValue,
  editInputRef,
  copied,
  stageCurrentEdit,
  cancelEdit,
  onCellClick,
  onCellDoubleClick,
}: VirtualizedRowsProps) {
  return (
    <tr>
      <td colSpan={columns.length + 1} style={{ padding: 0 }}>
        <div
          className="virtual-scroll-viewport"
          style={{ height: visibleRows * ROW_HEIGHT, overflowY: "auto" }}
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            <table className="result-grid virtual-table">
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ height: ROW_HEIGHT }}>
                    <td className="row-num">{ri + 1}</td>
                    {row.map((cell, ci) => {
                      const staged = pending.get(`${ri}:${ci}`);
                      return (
                        <CellTd
                          key={ci}
                          row={ri}
                          col={ci}
                          cell={cell}
                          staged={staged}
                          editing={editing}
                          editValue={editValue}
                          setEditValue={setEditValue}
                          editInputRef={editInputRef}
                          stageCurrentEdit={stageCurrentEdit}
                          cancelEdit={cancelEdit}
                          copied={copied}
                          onClick={onCellClick}
                          onDoubleClick={onCellDoubleClick}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}