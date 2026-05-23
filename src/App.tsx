import { useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { SQLEditor } from "./editor/SQLEditor";
import { StatusBar } from "./components/StatusBar";
import { useTabStore } from "./hooks/useTabStore";
import type { VimMode } from "./hooks/useVimMode";
import "./styles/layout.css";

export default function App() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent } = useTabStore();
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeTabId) {
        updateTabContent(activeTabId, content);
      }
    },
    [activeTabId, updateTabContent],
  );

  const handleRun = useCallback(() => {
    // placeholder — will connect to Tauri backend in M2
  }, []);

  const handleSave = useCallback(() => {
    // placeholder — will connect to filesystem in M2
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <div className="editor-area">
        <Toolbar onRun={handleRun} onSave={handleSave} />
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onAddTab={addTab}
          onRemoveTab={removeTab}
          onSelectTab={setActiveTab}
        />
        {activeTab && (
          <SQLEditor
            key={activeTab.id}
            initialContent={activeTab.content}
            onContentChange={handleContentChange}
            onVimModeChange={setVimMode}
            onCursorChange={(line, col) => setCursorPos({ line, col })}
          />
        )}
        <div style={{ flex: 1 }} />
        <StatusBar vimMode={vimMode} cursorLine={cursorPos.line} cursorCol={cursorPos.col} />
      </div>
    </div>
  );
}
