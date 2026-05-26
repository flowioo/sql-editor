import type { QueryTab } from "../hooks/useTabStore";
import "../styles/tabs.css";

interface TabBarProps {
  readonly tabs: readonly QueryTab[];
  readonly activeTabId: string;
  readonly onAddTab: () => void;
  readonly onRemoveTab: (id: string) => void;
  readonly onSelectTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onAddTab, onRemoveTab, onSelectTab }: TabBarProps) {
  return (
    <div className="tabs-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`editor-tab${tab.id === activeTabId ? " active" : ""}`}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.title}
          {tabs.length > 1 && (
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTab(tab.id);
              }}
            >
              ×
            </span>
          )}
        </button>
      ))}
      <button className="tab-add" onClick={() => onAddTab()}>+</button>
    </div>
  );
}
