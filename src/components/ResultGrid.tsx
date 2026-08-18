import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import type { StatementResult } from "../hooks/useQuery";
import {
  extractTableFromSql,
  getColumnsForTable,
  getPrimaryKeyColumns,
  type SqlDialect,
} from "../lib/schema-source";
import type { DatabaseSchema } from "../hooks/useSchema";
import { buildUpdateStatements, type PendingEdit } from "../domain/sql/updateBuilder";
import { Tooltip, useToast } from "./ui";
import "../styles/result-grid.css";

interface ResultGridProps {
  readonly result: StatementResult;
  /** Database schema — used to resolve primary keys / columns for inline
   *  editing (UPDATE generation). Injected via props rather than read from a
   *  module global so the component is a pure function of its props. */
  readonly schema: DatabaseSchema | null;
  /** SQL dialect — drives identifier quoting and string escaping in the
   *  generated UPDATE. Defaults to PostgreSQL. */
  readonly dialect?: SqlDialect;
  /** Called when the user confirms the staged edits. Receives one or more
   *  UPDATE statements (one per modified row) and the total number of
   *  changed cells across them. */
  readonly onSubmitUpdate?: (sqls: readonly string[], changeCount: number) => void;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 10;
const DEFAULT_VIEWPORT_HEIGHT = 50 * ROW_HEIGHT; // ~50 rows visible
const TOAST_DURATION_MS = 1400;

interface CellRef {
  readonly row: number;
  readonly col: number;
}

export const ResultGrid = memo(function ResultGrid({ result, schema, dialect = "postgresql", onSubmitUpdate }: ResultGridProps) {
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const timerRef = useRef<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();

  // Measure the actual viewport height once mounted. Falls back to the
  // default if the element isn't ready yet.
  useLayoutEffect(() => {
    if (scrollRef.current) {
      setViewportHeight(scrollRef.current.clientHeight);
    }
  }, []);

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
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
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
    () => (tableName ? getPrimaryKeyColumns(tableName, schema) : []),
    [tableName],
  );
  const editable = tableName !== null && pkColumns.length > 0;

  /** Stage an edit; if `newValue` matches the original, the entry is removed. */
  const stageEdit = useCallback(
    (row: number, col: number, originalValue: string | null, newValue: string | null) => {
      const columnName = columns[col];
      if (!columnName) return;
      const key = `${row}:${col}`;
      setPending((prev) => {
        const next = new Map(prev);
        // No-op only when the value is genuinely unchanged (NULL === NULL).
        // Previously NULL was coerced to "" which made NULL<->"" edits no-ops.
        if (originalValue === newValue) {
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
    // Empty input is interpreted as NULL (clearing the cell). This lets users
    // change a value to NULL by deleting all text; a literal empty string is
    // not reachable this way (rare in practice — see README).
    const newValue = editValue === "" ? null : editValue;
    stageEdit(row, col, originalValue, newValue);
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

  const handleSubmit = useCallback(() => {
    if (!tableName) return;
    const statements = buildUpdateStatements(
      pending,
      rows,
      columns,
      tableName,
      pkColumns,
      dialect,
    );
    if (!statements) {
      setEditError("无法构造 UPDATE 语句(缺少主键或表名)");
      return;
    }
    if (statements.length === 0) return;
    onSubmitUpdate?.(statements, pending.size);
    // Don't clear pending here — staged edits auto-reset via the
    // `useEffect([sql, rows])` above when the result changes after execution.
  }, [tableName, pending, rows, columns, pkColumns, dialect, onSubmitUpdate]);

  // Local toast text rendered in the header; only used for inline edit
  // hints / errors. Clip confirmations move to the global toast so the
  // header stays uncluttered.
  useEffect(() => {
    if (copied) {
      const columnName = columns[copied.col] ?? "";
      const value = rows[copied.row]?.[copied.col] ?? "NULL";
      toast.info(`已复制: [${columnName}]`, value);
    }
  }, [copied, columns, rows, toast]);

  useEffect(() => {
    if (editError) toast.error("编辑失败", editError);
  }, [editError, toast]);

  const allColumns = useMemo(
    () => (tableName ? getColumnsForTable(tableName, schema) : []),
    [tableName],
  );
  const hintText = editable
    ? "单击复制 · 双击编辑 · 编辑多个后点「提交」"
    : "双击单元格复制内容";

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Compute the visible row range. Overscan keeps the scrollbar smooth
  // when the user drags quickly — we render a few extra rows above/below
  // the visible window.
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [rows, startIndex, endIndex],
  );

  // Render the JSON view when the user has switched renderers.
  if (rows.length === 0) {
    return (
      <div className="result-container">
        <div className="result-header">
          <span className="result-count">0 行</span>
        </div>
        <div className="result-scroll">
          <table className="result-grid">
            <thead>
              <tr>
                <th className="row-num" />
                {columns.map((col, i) => (
                  <th key={i}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={columns.length + 1} className="result-empty">无数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="result-container">
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
            <Tooltip content="丢弃所有待提交修改">
              <button
                className="result-pending-cancel"
                onClick={cancelAllPending}
              >
                取消全部
              </button>
            </Tooltip>
            <Tooltip content="生成 UPDATE 语句并弹出确认">
              <button
                className="result-pending-submit"
                onClick={handleSubmit}
              >
                提交
              </button>
            </Tooltip>
          </span>
        )}
      </div>
      <div className="result-scroll" ref={scrollRef} onScroll={onScroll}>
        <table className="result-grid">
          <colgroup>
            <col style={{ width: 36 }} />
            {columns.map((_, i) => (
              <col key={i} />
            ))}
          </colgroup>
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
            <tr>
              <td colSpan={columns.length + 1} style={{ padding: 0, border: "none" }}>
                <div
                  className="virtual-scroll-viewport"
                  style={{ height: Math.min(totalHeight, viewportHeight) }}
                >
                  <div className="virtual-scroll-spacer" style={{ height: totalHeight }}>
                    {visibleRows.map((row, vi) => {
                      const ri = startIndex + vi;
                      const isEditingRow = editing?.row === ri;
                      return (
                        <div
                          key={ri}
                          className="virtual-row"
                          style={{ top: ri * ROW_HEIGHT, height: ROW_HEIGHT }}
                        >
                          <div className="cell row-num-cell">{ri + 1}</div>
                          {row.map((cell, ci) => {
                            const pendingKey = `${ri}:${ci}`;
                            const staged = pending.get(pendingKey);
                            const isEditingCell = isEditingRow && editing?.col === ci;
                            const isCopied = copied?.row === ri && copied?.col === ci;
                            const isStaged = staged !== undefined;
                            const display = staged ? staged.newValue : cell ?? "NULL";
                            return (
                              <div
                                key={ci}
                                className={[
                                  "cell",
                                  cell === null && !isStaged ? "cell-null" : "",
                                  isCopied ? "cell-copied" : "",
                                  isStaged ? "cell-staged" : "",
                                ].filter(Boolean).join(" ")}
                                onClick={() => handleCellClick(ri, ci)}
                                onDoubleClick={() => handleCellDoubleClick(ri, ci)}
                                title={
                                  isStaged
                                    ? `原值: ${staged?.originalValue ?? "NULL"} → 新值: ${staged?.newValue ?? ""}`
                                    : "单击复制 · 双击编辑"
                                }
                              >
                                {isEditingCell ? (
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
                                    onClick={(e) => e.stopPropagation()}
                                    spellCheck={false}
                                  />
                                ) : (
                                  display
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});
