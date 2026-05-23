import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { SQLEditor } from "./editor/SQLEditor";
import { StatusBar } from "./components/StatusBar";
import { ResultGrid } from "./components/ResultGrid";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { useTabStore } from "./hooks/useTabStore";
import { useConnection } from "./hooks/useConnection";
import { useSchema } from "./hooks/useSchema";
import { useQuery } from "./hooks/useQuery";
import { useQueryHistory } from "./hooks/useQueryHistory";
import { setSchemaRefreshCallback } from "./editor/extensions";
import type { VimMode } from "./hooks/useVimMode";
import type { ConnectionConfig } from "./types/connection";
import "./styles/layout.css";

export default function App() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent } =
    useTabStore();
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);

  const {
    status: connStatus,
    displayName,
    connect: doConnect,
    disconnect: doDisconnect,
  } = useConnection();
  const {
    schema,
    loading: schemaLoading,
    lastRefreshedAt,
    offline,
    loadFromCache,
    refresh: refreshSchema,
    diffOnConnect,
  } = useSchema();
  const {
    result,
    loading: queryLoading,
    error: queryError,
    execute: executeQuery,
  } = useQuery();
  const { history, addEntry, clearHistory } = useQueryHistory();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Schema diff on connect
  useEffect(() => {
    if (connStatus === "connected") {
      loadFromCache();
      diffOnConnect();
    }
  }, [connStatus, loadFromCache, diffOnConnect]);

  // Wire up leader+rs vim keybinding
  useEffect(() => {
    setSchemaRefreshCallback(() => refreshSchema);
  }, [refreshSchema]);

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
      executeQuery(sql).then((queryResult) => {
        addEntry({
          sql,
          executedAt: new Date().toISOString(),
          databaseName: displayName,
          rowCount: queryResult?.rows.length ?? null,
          error: queryError,
        });
      });
    }
  }, [connStatus, activeTab?.content, executeQuery, addEntry, displayName, queryError]);

  const handleConnectionDialogConnect = useCallback(
    async (config: ConnectionConfig) => {
      await doConnect(config);
      setShowConnectionDialog(false);
    },
    [doConnect],
  );

  const handleHistorySelect = useCallback(
    (sql: string) => {
      if (activeTabId) {
        updateTabContent(activeTabId, sql);
      }
    },
    [activeTabId, updateTabContent],
  );

  return (
    <div className="app">
      <Sidebar
        schema={schema}
        lastRefreshedAt={lastRefreshedAt}
        offline={offline}
        history={history}
        onHistorySelect={handleHistorySelect}
        onClearHistory={clearHistory}
      />
      <div className="editor-area">
        <Toolbar
          connectionStatus={connStatus}
          connectionName={displayName}
          queryLoading={queryLoading}
          schemaLoading={schemaLoading}
          onConnect={() => setShowConnectionDialog(true)}
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
            <span className="error-icon">x</span>
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

      {showConnectionDialog && (
        <ConnectionDialog
          onClose={() => setShowConnectionDialog(false)}
          onConnect={handleConnectionDialogConnect}
        />
      )}
    </div>
  );
}
