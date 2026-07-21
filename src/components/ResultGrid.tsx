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
  /** Called when an inline edit is confirmed. Receives the UPDATE SQL. */
  readonly onSubmitUpdate?: (sql: string) => void;
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

export function ResultGrid({ result, onSubmitUpdate }: ResultGridProps) {
  const { sql, columns, rows, affected_rows, truncated } = result;

  const totalHeight = useMemo(() => rows.length * ROW_HEIGHT, [rows.length]);
  const [copied, setCopied] = useState<CellRef | null>(null);
  // Inline editor state — when not null, the given cell is in edit mode.
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

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
      const cell = rows[row]?.[col];
      setEditValue(cell ?? "");
      setEditError(null);
      setEditing({ row, col });
      setCopied(null);
    },
    [rows, editable, handleCellClick],
  );

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const { row, col } = editing;
    const where = buildWhereClause(row);
    if (!where) {
      setEditError("无法构造 WHERE 子句");
      return;
    }
    const columnName = columns[col];
    if (!columnName) {
      setEditError("列名无效");
      return;
    }
    if (!tableName) {
      setEditError("无法识别表名");
      return;
    }
    const newValue = editValue;
    const sqlOut = `UPDATE ${tableName} SET ${columnName} = ${quoteSql(newValue)} WHERE ${where};`;
    onSubmitUpdate?.(sqlOut);
    setEditing(null);
    setEditValue("");
    setEditError(null);
  }, [editing, editValue, tableName, columns, buildWhereClause, onSubmitUpdate]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditValue("");
    setEditError(null);
  }, []);

  const toastText = useMemo(() => {
    if (editError) return editError;
    if (editing) {
      return `编辑 [${columns[editing.col] ?? ""}] — 回车保存 / Esc 取消`;
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
    ? "单击复制 · 双击编辑"
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
                  {row.map((cell, ci) => (
                    <CellTd
                      key={ci}
                      row={ri}
                      col={ci}
                      cell={cell}
                      editing={editing}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      editInputRef={editInputRef}
                      commitEdit={commitEdit}
                      cancelEdit={cancelEdit}
                      copied={copied}
                      onClick={handleCellClick}
                      onDoubleClick={handleCellDoubleClick}
                    />
                  ))}
                </tr>
              ))
            ) : (
              <VirtualizedRows
                rows={rows}
                columns={columns}
                visibleRows={VISIBLE_ROWS}
                totalHeight={totalHeight}
                editing={editing}
                editValue={editValue}
                setEditValue={setEditValue}
                editInputRef={editInputRef}
                copied={copied}
                commitEdit={commitEdit}
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

interface CellTdProps {
  readonly row: number;
  readonly col: number;
  readonly cell: string | null;
  readonly editing: CellRef | null;
  readonly editValue: string;
  readonly setEditValue: (v: string) => void;
  readonly editInputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly commitEdit: () => void;
  readonly cancelEdit: () => void;
  readonly copied: CellRef | null;
  readonly onClick: (row: number, col: number) => void;
  readonly onDoubleClick: (row: number, col: number) => void;
}

function CellTd({
  row,
  col,
  cell,
  editing,
  editValue,
  setEditValue,
  editInputRef,
  commitEdit,
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
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={commitEdit}
          spellCheck={false}
        />
      </td>
    );
  }
  const isCopied = copied?.row === row && copied?.col === col;
  return (
    <td
      className={`${cell === null ? "cell-null" : ""} ${isCopied ? "cell-copied" : ""}`}
      onClick={() => onClick(row, col)}
      onDoubleClick={() => onDoubleClick(row, col)}
      title="单击复制 · 双击编辑"
    >
      {cell ?? "NULL"}
    </td>
  );
}

interface VirtualizedRowsProps {
  readonly rows: readonly (readonly (string | null)[])[];
  readonly columns: readonly string[];
  readonly visibleRows: number;
  readonly totalHeight: number;
  readonly editing: CellRef | null;
  readonly editValue: string;
  readonly setEditValue: (v: string) => void;
  readonly editInputRef: React.MutableRefObject<HTMLInputElement | null>;
  readonly copied: CellRef | null;
  readonly commitEdit: () => void;
  readonly cancelEdit: () => void;
  readonly onCellClick: (row: number, col: number) => void;
  readonly onCellDoubleClick: (row: number, col: number) => void;
}

function VirtualizedRows({
  rows,
  columns,
  visibleRows,
  totalHeight,
  editing,
  editValue,
  setEditValue,
  editInputRef,
  copied,
  commitEdit,
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
                    {row.map((cell, ci) => (
                      <CellTd
                        key={ci}
                        row={ri}
                        col={ci}
                        cell={cell}
                        editing={editing}
                        editValue={editValue}
                        setEditValue={setEditValue}
                        editInputRef={editInputRef}
                        commitEdit={commitEdit}
                        cancelEdit={cancelEdit}
                        copied={copied}
                        onClick={onCellClick}
                        onDoubleClick={onCellDoubleClick}
                      />
                    ))}
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