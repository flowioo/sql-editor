import { useState, useRef, useEffect } from "react";
import type { QueryTab } from "../hooks/useTabStore";
import "../styles/tabs.css";

interface TabBarProps {
  readonly tabs: readonly QueryTab[];
  readonly activeTabId: string;
  readonly onAddTab: () => void;
  readonly removeTab: (id: string) => Promise<void>;
  readonly onSelectTab: (id: string) => void;
  readonly onRenameTab: (id: string, title: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onAddTab,
  removeTab,
  onSelectTab,
  onRenameTab,
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startEdit = (tab: QueryTab) => {
    setEditingId(tab.id);
    setEditValue(tab.title);
  };

  const commitEdit = () => {
    if (!editingId) return;
    onRenameTab(editingId, editValue);
    setEditingId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  return (
    <div className="tabs-bar">
      {tabs.map((tab) => {
        const isEditing = editingId === tab.id;
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`editor-tab${isActive ? " active" : ""}`}
            onClick={() => !isEditing && onSelectTab(tab.id)}
            onDoubleClick={() => startEdit(tab)}
          >
            {isEditing ? (
              <input
                ref={editInputRef}
                className="tab-rename-input"
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
            ) : (
              <span className="tab-title">{tab.title}</span>
            )}
            {tabs.length > 1 && !isEditing && (
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeTab(tab.id);
                }}
                title="关闭"
              >
                ×
              </span>
            )}
          </div>
        );
      })}
      <button className="tab-add" onClick={() => onAddTab()} title="新建查询">
        +
      </button>
    </div>
  );
}