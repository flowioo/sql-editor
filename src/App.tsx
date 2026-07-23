import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { SQLEditor } from "./editor/SQLEditor";
import { StatusBar } from "./components/StatusBar";
import { ResultTabs } from "./components/ResultTabs";
import { UpdateConfirmDialog } from "./components/UpdateConfirmDialog";
import { ToastProvider, TooltipProvider, useToast } from "./components/ui";
import { ConsoleMessages } from "./components/ConsoleMessages";
import { ConnectionDialog, type SavedConnection } from "./components/ConnectionDialog";
import { clearResultGridPending } from "./components/ResultGrid";
import { AIPanel } from "./components/AIPanel";
import { TableStructure } from "./components/TableStructure";
import { useTabStore } from "./hooks/useTabStore";
import { useConnection } from "./hooks/useConnection";
import { useSchema } from "./hooks/useSchema";
import { useQuery } from "./hooks/useQuery";
import { useQueryHistory } from "./hooks/useQueryHistory";
import { useCodebaseScan } from "./hooks/useCodebaseScan";
import { useColumnDescriptions } from "./hooks/useColumnDescriptions";
import { updateSchemaForAutocomplete } from "./editor/extensions";
import "./styles/layout.css";
import "./styles/result-tabs.css";
import "./styles/history-files.css";
import "./styles/update-confirm-dialog.css";

/** Stable id used to bucket history / files per connection.
 *  Mirrors the scheme in src-tauri/src/commands/files.rs::sanitize_conn_id
 *  so the localStorage connectionId and the Rust-side subdirectory line up. */
function connIdFromConfig(c: import("./types/connection").ConnectionConfig): string {
  switch (c.type) {
    case "sqlite":
      return c.path;
    case "postgresql":
      return `postgresql://${c.user}@${c.host}:${c.port}/${c.database}`;
    case "mysql":
      return `mysql://${c.user}@${c.host}:${c.port}/${c.database}`;
  }
}

export default function App() {
  // Wrap the real tree in <ToastProvider> so descendants can use useToast().
  return (
    <TooltipProvider delayDuration={300}>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </TooltipProvider>
  );
}

function AppInner() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent, renameTab } = useTabStore();
  const toast = useToast();
  const [vimEnabled, setVimEnabled] = useState(true);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [structureTable, setStructureTable] = useState<string | null>(null);
  const [vimMode, setVimMode] = useState<string>("NORMAL");
  // Bumped whenever a connection is added/renamed/deleted; Sidebar re-reads
  // localStorage on change so the list reflects the latest state.
  const [savedConnectionsVersion, setSavedConnectionsVersion] = useState(0);
  // Filename of the most recently opened .sql file, if any. Used by Sidebar
  // to highlight the active row in the Files tab.
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  // Pending UPDATE batch waiting for user confirmation in the dialog.
  const [pendingUpdates, setPendingUpdates] = useState<{
    readonly sqls: readonly string[];
    readonly changeCount: number;
  } | null>(null);

  // Ref to get current content from editor
  const getContentRef = useRef<(() => string) | null>(null);
  // Ref to get the SQL that should be executed (selection → current stmt → full)
  const getSqlToExecuteRef = useRef<(() => string) | null>(null);

  const {
    status: connStatus,
    displayName,
    config: currentConfig,
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
  const {
    history,
    savedFiles,
    addEntry,
    removeEntry,
    clearHistory,
    loadFileContent,
    deleteFile,
    saveCurrentAsFile,
  } = useQueryHistory(currentConfig ? connIdFromConfig(currentConfig) : null);
  const { scanning, scanResult, scanCodebase } = useCodebaseScan();
  const { descriptions, loadDescriptions } = useColumnDescriptions();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Schema diff on connect
  useEffect(() => {
    if (connStatus === "connected") {
      loadFromCache();
      diffOnConnect();
    }
  }, [connStatus, loadFromCache, diffOnConnect]);

  // Push schema to autocomplete
  useEffect(() => {
    if (schema) {
      updateSchemaForAutocomplete(schema);
    }
  }, [schema]);

  // Load column descriptions
  useEffect(() => {
    if (schema) {
      for (const table of schema.tables) {
        loadDescriptions(table.name);
      }
    }
  }, [schema, loadDescriptions]);

  const handleRun = useCallback(() => {
      // Smart execution: prefer selection → current statement → full text
      const sql = getSqlToExecuteRef.current?.() ?? getContentRef.current?.() ?? "";
      if (connStatus !== "connected") return;
      if (!sql.trim()) return;
      executeQuery(sql).then((queryResult) => {
        const rowCount = queryResult
          ? queryResult.results.reduce((sum, r) => sum + (r.is_query ? r.rows.length : 0), 0)
          : null;
        addEntry({
          sql,
          executedAt: new Date().toISOString(),
          connectionId: currentConfig ? connIdFromConfig(currentConfig) : null,
          connectionName: displayName,
          databaseName: displayName,
          rowCount,
          error: queryError,
        });
      });
    },
    [connStatus, executeQuery, addEntry, displayName, queryError, currentConfig],
  );

  const handleConnectionDialogConnect = useCallback(
    async (config: any) => {
      await doConnect(config);
      setSavedConnectionsVersion((v) => v + 1);
      setShowConnectionDialog(false);
      setEditingConnection(null);
    },
    [doConnect],
  );

  const handleConnectionDialogClose = useCallback(() => {
    // A new connection may have been added via URL/新建连接 + close.
    setSavedConnectionsVersion((v) => v + 1);
    setShowConnectionDialog(false);
    setEditingConnection(null);
  }, []);

  const handleNewConnection = useCallback(() => {
    setEditingConnection(null);
    setShowConnectionDialog(true);
  }, []);

  const handleEditConnection = useCallback((conn: SavedConnection) => {
    setEditingConnection(conn);
    setShowConnectionDialog(true);
  }, []);

  const handleHistorySelect = useCallback(
    (sql: string) => {
      // Load AND run — re-running an old query is the common case.
      if (activeTabId) {
        updateTabContent(activeTabId, sql);
      }
      if (connStatus === "connected") {
        executeQuery(sql);
      }
    },
    [activeTabId, updateTabContent, connStatus, executeQuery],
  );

  const handleTableSelect = useCallback(
    (tableName: string) => {
      const sql = `SELECT * FROM ${tableName} LIMIT 100;`;
      if (activeTabId) {
        updateTabContent(activeTabId, sql);
      }
      executeQuery(sql);
    },
    [activeTabId, updateTabContent, executeQuery],
  );

  const handleInsertSQL = useCallback(
    (sql: string) => {
      if (activeTabId) {
        updateTabContent(activeTabId, sql);
      }
    },
    [activeTabId, updateTabContent],
  );

  const handleFileOpen = useCallback(
    async (filename: string) => {
      try {
        const content = await loadFileContent(filename);
        const tabTitle = filename.replace(/^\d{8}_\d{6}_/, "").replace(/\.sql$/, "");
        addTab(`-- ${tabTitle}\n${content}`);
        setActiveFilename(filename);
      } catch (e) {
        console.error("Failed to load file:", e);
        toast.error("无法加载文件", String(e));
      }
    },
    [loadFileContent, addTab, toast],
  );

  const handleFileDelete = useCallback(
    async (filename: string) => {
      try {
        await deleteFile(filename);
        if (activeFilename === filename) setActiveFilename(null);
        toast.success("文件已删除", filename);
      } catch (e) {
        console.error("Failed to delete file:", e);
        toast.error("删除文件失败", String(e));
      }
    },
    [deleteFile, activeFilename, toast],
  );

  /** Toolbar "+" button: open a new query window. If the active tab has
   *  SQL content, snapshot it as a `.sql` file first (the "create query
   *  window" gesture is the deliberate save point the user requested —
   *  subsequent runs do not auto-save, so the file folder stays curated). */
  const handleNewTab = useCallback(async () => {
    const currentSql = getContentRef.current?.() ?? "";
    if (currentSql.trim()) {
      // Fire and forget — don't block the tab open on file I/O.
      void saveCurrentAsFile(currentSql);
    }
    await addTab();
  }, [addTab, saveCurrentAsFile]);

  // ResultGrid calls this with one UPDATE per row that has staged edits.
  // We don't run them yet — instead open a confirmation dialog so the user
  // can review the SQL before it touches the database.
  const handleStageUpdates = useCallback(
    (sqls: readonly string[]) => {
      if (sqls.length === 0) return;
      if (connStatus !== "connected") return;
      setPendingUpdates({ sqls, changeCount: sqls.length });
    },
    [connStatus],
  );

  const handleConfirmUpdates = useCallback(async () => {
    if (!pendingUpdates) return;
    const batch = pendingUpdates.sqls.join("\n");
    try {
      await executeQuery(batch);
      toast.success("更新已执行", `${pendingUpdates.sqls.length} 条语句`);
    } catch (e) {
      console.error("Failed to execute UPDATE:", e);
      toast.error("更新失败", String(e));
    } finally {
      setPendingUpdates(null);
      // Clear staged edits on the grid so the user can re-run the SELECT
      // to see the post-update state without their pending changes lingering.
      clearResultGridPending();
    }
  }, [pendingUpdates, executeQuery, toast]);

  const handleCancelUpdates = useCallback(() => {
    setPendingUpdates(null);
    // Staged edits intentionally stay on the grid so the user can revise.
  }, []);

  const schemaContext = useMemo(() => {
    if (!schema) return "";
    return schema.tables
      .map((t) => {
        const cols = t.columns
          .map((c) => `  ${c.name} ${c.data_type}${c.is_primary_key ? " PK" : ""}`)
          .join("\n");
        return `TABLE ${t.name} (\n${cols}\n)`;
      })
      .join("\n\n");
  }, [schema]);

  return (
    <div className="app">
      <Sidebar
        schema={schema}
        lastRefreshedAt={lastRefreshedAt}
        offline={offline}
        descriptions={descriptions}
        history={history}
        savedFiles={savedFiles}
        currentConnectionId={displayName}
        activeFilename={activeFilename}
        savedConnectionsVersion={savedConnectionsVersion}
        onHistorySelect={handleHistorySelect}
        onHistoryRemove={removeEntry}
        onFileOpen={handleFileOpen}
        onFileDelete={handleFileDelete}
        onClearHistory={clearHistory}
        onConnect={handleConnectionDialogConnect}
        onNewConnection={handleNewConnection}
        onEditConnection={handleEditConnection}
        onTableSelect={handleTableSelect}
        onTableStructure={setStructureTable}
      />
      <div className="editor-area">
        <Toolbar
          connectionStatus={connStatus}
          connectionName={displayName}
          queryLoading={queryLoading}
          schemaLoading={schemaLoading}
          scanning={scanning}
          scanResult={scanResult}
          onConnect={() => setShowConnectionDialog(true)}
          onDisconnect={doDisconnect}
          onRun={handleRun}
          onRefreshSchema={refreshSchema}
          onScanCodebase={scanCodebase}
          onToggleAI={() => setShowAI(!showAI)}
          onToggleVim={() => setVimEnabled(!vimEnabled)}
          showAI={showAI}
          vimEnabled={vimEnabled}
          vimMode={vimEnabled ? vimMode : undefined}
        />
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onAddTab={handleNewTab}
          removeTab={removeTab}
          onSelectTab={setActiveTab}
          onRenameTab={renameTab}
        />
        {activeTab && (
          <SQLEditor
            key={activeTab.id}
            content={activeTab.content}
            enableVim={vimEnabled}
            getContentRef={getContentRef}
            getSqlToExecuteRef={getSqlToExecuteRef}
            onRun={handleRun}
            onModeChange={setVimMode}
            onContentChange={(content) => updateTabContent(activeTab.id, content)}
          />
        )}

        {queryError && (
          <div className="query-error">
            <span className="error-icon">x</span>
            <span>{queryError}</span>
          </div>
        )}

        {result && (
          <>
            <ResultTabs
              results={result.results}
              totalDurationMs={result.total_duration_ms}
              onSubmitUpdate={handleStageUpdates}
            />
            <ConsoleMessages results={result.results} />
          </>
        )}

        {structureTable && schema && (() => {
          const table = schema.tables.find((t) => t.name === structureTable);
          if (!table) return null;
          return <TableStructure table={table} onClose={() => setStructureTable(null)} />;
        })()}

        <StatusBar vimMode={vimMode} cursorLine={1} cursorCol={1} />
      </div>

      {showAI && (
        <AIPanel schemaContext={schemaContext} connectionName={displayName} onInsertSQL={handleInsertSQL} />
      )}

      {showConnectionDialog && (
        <ConnectionDialog
          editTarget={editingConnection}
          onClose={handleConnectionDialogClose}
          onConnect={handleConnectionDialogConnect}
        />
      )}

      {pendingUpdates && (
        <UpdateConfirmDialog
          sqls={pendingUpdates.sqls}
          changeCount={pendingUpdates.changeCount}
          onConfirm={handleConfirmUpdates}
          onCancel={handleCancelUpdates}
        />
      )}
    </div>
  );
}
