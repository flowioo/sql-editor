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
import { materializeConfig } from "./lib/credentials";
import { AIPanel } from "./components/AIPanel";
import { TableStructure } from "./components/TableStructure";
import { useTabStore } from "./hooks/useTabStore";
import { useConnection } from "./hooks/useConnection";
import { useSchema } from "./hooks/useSchema";
import { useQuery } from "./hooks/useQuery";
import { useQueryHistory } from "./hooks/useQueryHistory";
import { useCodebaseScan } from "./hooks/useCodebaseScan";
import { useColumnDescriptions } from "./hooks/useColumnDescriptions";
import { useSettings } from "./hooks/useSettings";
import { connIdFromConfig, dialectOfConnection } from "./lib/connection-utils";
import "./styles/layout.css";
import "./styles/result-tabs.css";
import "./styles/history-files.css";
import "./styles/update-confirm-dialog.css";

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
  const {
    status: connStatus,
    displayName,
    config: currentConfig,
    connect: doConnect,
    disconnect: doDisconnect,
    error: connError,
  } = useConnection();
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent, renameTab } = useTabStore(
    currentConfig ? connIdFromConfig(currentConfig) : null,
  );
  const toast = useToast();
  const { settings, update: updateSettings } = useSettings();
  const vimEnabled = settings.vimEnabled;
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [structureTable, setStructureTable] = useState<string | null>(null);
  const [vimMode, setVimMode] = useState<string>("NORMAL");
  // Filename of the most recently opened .sql file, if any. Used by Sidebar
  // to highlight the active row in the Files tab.
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  // Pending UPDATE batch waiting for user confirmation in the dialog.
  const [pendingUpdates, setPendingUpdates] = useState<{
    readonly sqls: readonly string[];
    readonly changeCount: number;
  } | null>(null);
  // Track which table→SQL was last generated for the redis branch so we
  // can re-issue it without forcing the tree re-render.
  const redisTableCursorsRef = useRef<Map<string, string>>(new Map());

  // Ref to get current content from editor
  const getContentRef = useRef<(() => string) | null>(null);
  // Ref to get the SQL that should be executed (selection → current stmt → full)
  const getSqlToExecuteRef = useRef<(() => string) | null>(null);

  const {
    schema,
    loading: schemaLoading,
    error: schemaError,
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
  const { descriptions, states: descStates, loadDescriptions } = useColumnDescriptions();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Surface connection failures — useConnection stores the error but nothing
  // else reads it, so without this a failed connect looks like a dead click.
  useEffect(() => {
    if (connError) toast.error("连接失败", connError);
  }, [connError, toast]);

  // Surface schema refresh failures — same reasoning as connection errors.
  useEffect(() => {
    if (schemaError) toast.error("刷新数据库结构失败", schemaError);
  }, [schemaError, toast]);

  // Schema diff on connect
  useEffect(() => {
    if (connStatus === "connected") {
      loadFromCache();
      diffOnConnect();
    }
  }, [connStatus, loadFromCache, diffOnConnect]);

  // Load column descriptions for every newly-seen table. Runs in parallel
  // (Promise.all) so a slow description endpoint doesn't serialise the whole
  // batch. The per-table state map from useColumnDescriptions also serves as
  // the cache: tables that already have a successful entry are skipped.
  useEffect(() => {
    if (!schema) return;
    const fresh = schema.tables.filter((t) => {
      const state = descStates.get(t.name);
      // Only reload when there is no record (loading=false) yet, or when the
      // last attempt failed (so the user can recover by re-refreshing).
      return !state || (state.error !== null && !state.loading);
    });
    if (fresh.length === 0) return;
    void Promise.all(fresh.map((t) => loadDescriptions(t.name)));
  }, [schema, descStates, loadDescriptions]);

  const handleRun = useCallback(() => {
    // Guard against re-run while the previous query is still in flight. The
    // Toolbar button disables itself in this state; the editor's Cmd+Enter
    // path goes through this same callback so we don't need a separate check.
    if (queryLoading) return;
    // Smart execution: prefer selection → current statement → full text
    const sql = getSqlToExecuteRef.current?.() ?? getContentRef.current?.() ?? "";
    if (connStatus !== "connected") return;
    if (!sql.trim()) return;
    executeQuery(sql).then(({ result: queryResult, error }) => {
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
        error,
      });
    });
  },
    [queryLoading, connStatus, executeQuery, addEntry, displayName, currentConfig],
  );

  const handleConnectionDialogConnect = useCallback(
    async (config: any) => {
      await doConnect(config);
      setShowConnectionDialog(false);
      setEditingConnection(null);
    },
    [doConnect],
  );

  // Sidebar's saved-connection list sends the whole SavedConnection so the
  // keychain password can be materialized — the localStorage copy is
  // passwordless by design and would fail auth if passed straight through.
  const handleSavedConnectionConnect = useCallback(
    async (conn: SavedConnection) => {
      const config = await materializeConfig(conn);
      await doConnect(config);
    },
    [doConnect],
  );

  const handleConnectionDialogClose = useCallback(() => {
    // A new connection may have been added via URL/新建连接 + close.
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

  // Generate a SCAN query for a Redis pseudo-table. The schema tree represents
  // each key type as `string (123)`, `hash (45)`, etc. — parse the type
  // keyword out of the display string and emit a SCAN with TYPE.
  const buildRedisScan = useCallback((displayName: string, cursor: string): string => {
    const m = displayName.match(/^([a-zA-Z_]+)\s*\((\d+)\)$/);
    const type = m ? m[1] : "string";
    return `SCAN ${cursor} MATCH * COUNT 100 TYPE ${type}`;
  }, []);

  const handleTableSelect = useCallback(
    (tableName: string) => {
      if (currentConfig?.type === "redis") {
        const cursor = redisTableCursorsRef.current.get(tableName) ?? "0";
        const sql = buildRedisScan(tableName, cursor);
        if (activeTabId) updateTabContent(activeTabId, sql);
        executeQuery(sql);
        return;
      }
      const sql = `SELECT * FROM ${tableName} LIMIT 100;`;
      if (activeTabId) {
        updateTabContent(activeTabId, sql);
      }
      executeQuery(sql);
    },
    [activeTabId, updateTabContent, executeQuery, currentConfig, buildRedisScan],
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
    (sqls: readonly string[], changeCount: number) => {
      if (sqls.length === 0) return;
      if (connStatus !== "connected") return;
      setPendingUpdates({ sqls, changeCount });
    },
    [connStatus],
  );

  const handleConfirmUpdates = useCallback(async () => {
    if (!pendingUpdates) return;
    const batch = pendingUpdates.sqls.join("\n");
    const { error } = await executeQuery(batch);
    setPendingUpdates(null);
    if (error) {
      console.error("Failed to execute UPDATE:", error);
      toast.error("更新失败", error);
      // Keep staged edits on the grid so the user can revise and retry.
      return;
    }
    toast.success("更新已执行", `${pendingUpdates.sqls.length} 条语句`);
    // Staged edits auto-clear: executing the UPDATE batch produces a new query
    // result, which flows back as a new `result.sql` and resets ResultGrid's
    // pending state via its `useEffect([sql, rows])`.
  }, [pendingUpdates, executeQuery, toast]);

  const handleCancelUpdates = useCallback(() => {
    setPendingUpdates(null);
    // Staged edits intentionally stay on the grid so the user can revise.
  }, []);

  const dialect = dialectOfConnection(currentConfig);

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
        onHistorySelect={handleHistorySelect}
        onHistoryRemove={removeEntry}
        onFileOpen={handleFileOpen}
        onFileDelete={handleFileDelete}
        onClearHistory={clearHistory}
        onConnect={handleSavedConnectionConnect}
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
          onToggleVim={() => updateSettings("vimEnabled", !vimEnabled)}
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
            schema={schema}
            dialect={dialect}
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
              schema={schema}
              dialect={dialect === "redis" ? "postgresql" : dialect}
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
