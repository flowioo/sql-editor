import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./ui";
import type { SavedConnection } from "../lib/savedConnections";
import { DB_TYPE_ICON_LABEL } from "../lib/tokens";

interface SavedItemProps {
  readonly conn: SavedConnection;
  readonly onConnect: () => void;
  readonly onDelete: () => void;
  readonly onRename: (name: string) => void;
  readonly onDuplicate: () => void;
}

/** Single row in the saved-connection list. Encapsulates the inline
 *  rename state so the parent dialog stays focused on form
 *  wiring. */
export function SavedItem({ conn, onConnect, onDelete, onRename, onDuplicate }: SavedItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conn.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (editValue.trim() && editValue.trim() !== conn.name) {
      onRename(editValue);
    }
  };

  const detail =
    conn.config.type === "sqlite"
      ? conn.config.path
      : conn.config.type === "redis"
        ? `${conn.config.host}:${conn.config.port}/db${conn.config.database}`
        : `${conn.config.user}@${conn.config.host}:${conn.config.port}/${conn.config.database}`;

  return (
    <div
      className="saved-item"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".saved-actions")) return;
        onConnect();
      }}
    >
      <span className={`saved-type type-${conn.config.type}`}>
        {DB_TYPE_ICON_LABEL[conn.config.type] ?? "?"}
      </span>
      <div className="saved-info">
        {editing ? (
          <input
            ref={inputRef}
            className="saved-rename-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); setEditing(false); setEditValue(conn.name); }
            }}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <span className="saved-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(conn.name); }}>
            {conn.name}
          </span>
        )}
        <span className="saved-detail">{detail}</span>
      </div>
      <div className="saved-actions" onClick={(e) => e.stopPropagation()}>
        <Tooltip content="连接这个数据库">
          <button className="saved-action" onClick={onConnect}>连接</button>
        </Tooltip>
        <Tooltip content="重命名这个连接">
          <button className="saved-action" onClick={() => setEditing(true)}>重命名</button>
        </Tooltip>
        <Tooltip content="复制为新连接">
          <button className="saved-action" onClick={onDuplicate}>复制</button>
        </Tooltip>
        <Tooltip content="删除这个连接">
          <button className="saved-action danger" onClick={onDelete}>删除</button>
        </Tooltip>
      </div>
    </div>
  );
}
