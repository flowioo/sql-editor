import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { SQLEditor } from "./editor/SQLEditor";
import { StatusBar } from "./components/StatusBar";
import { ResultGrid } from "./components/ResultGrid";
import { useTabStore } from "./hooks/useTabStore";
import { useConnection } from "./hooks/useConnection";
import { useSchema } from "./hooks/useSchema";
import { useQuery } from "./hooks/useQuery";
import type { VimMode } from "./hooks/useVimMode";
import "./styles/layout.css";

export default function App() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent } =
    useTabStore();
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const { status: connStatus, displayName, openFile, disconnect: doDisconnect } = useConnection();
  const { schema, loading: schemaLoading, loadFromCache, refresh: refreshSchema } = useSchema();
  const { result, loading: queryLoading, error: queryError, execute: executeQuery } = useQuery();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Auto-load schema when connected
  useEffect(() => {
    if (connStatus === "connected") {
      loadFromCache();
    }
  }, [connStatus, loadFromCache]);

  const handleContentChange = useCallback(
    (content: string) => {
      if (activeTabId) {
        updateTabContent(activeTabId, content);
      }
    },
    [activeTabId, updateTabContent],
  );

  const handleRun = useCallback(() => {
    if (connStatus !== "connected") return;
    const sql = activeTab?.content;
    if (sql) {
      executeQuery(sql);
    }
  }, [connStatus, activeTab?.content, executeQuery]);

  return (
    <div className="app">
      <Sidebar schema={schema} />
      <div className="editor-area">
        <Toolbar
          connectionStatus={connStatus}
          connectionName={displayName}
          queryLoading={queryLoading}
          schemaLoading={schemaLoading}
          onConnect={openFile}
          onDisconnect={doDisconnect}
          onRun={handleRun}
          onRefreshSchema={refreshSchema}
        />
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
            onRun={handleRun}
          />
        )}

        {queryError && (
          <div className="query-error">
            <span className="error-icon">✗</span>
            <span>{queryError}</span>
          </div>
        )}

        {result && <ResultGrid result={result} />}

        <div style={{ flex: 1 }} />
        <StatusBar
          vimMode={vimMode}
          cursorLine={cursorPos.line}
          cursorCol={cursorPos.col}
        />
      </div>
    </div>
  );
}
