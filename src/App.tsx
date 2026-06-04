import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { SQLEditor } from "./editor/SQLEditor";
import { StatusBar } from "./components/StatusBar";
import { ResultTabs } from "./components/ResultTabs";
import { ConsoleMessages } from "./components/ConsoleMessages";
import { ConnectionDialog } from "./components/ConnectionDialog";
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

export default function App() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent } = useTabStore();
  const [vimEnabled, setVimEnabled] = useState(true);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [structureTable, setStructureTable] = useState<string | null>(null);
  const [vimMode, setVimMode] = useState<string>("NORMAL");

  // Ref to get current content from editor
  const getContentRef = useRef<(() => string) | null>(null);

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
  const { history, savedFiles, addEntry, clearHistory, loadFileContent } = useQueryHistory();
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
      const sql = getContentRef.current?.() ?? "";
      if (connStatus !== "connected") return;
      if (!sql.trim()) return;
      executeQuery(sql).then((queryResult) => {
        const rowCount = queryResult
          ? queryResult.results.reduce((sum, r) => sum + (r.is_query ? r.rows.length : 0), 0)
          : null;
        addEntry({
          sql,
          executedAt: new Date().toISOString(),
          databaseName: displayName,
          rowCount,
          error: queryError,
        });
      });
    },
    [connStatus, executeQuery, addEntry, displayName, queryError],
  );

  const handleConnectionDialogConnect = useCallback(
    async (config: any) => {
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
      } catch (e) {
        console.error("Failed to load file:", e);
      }
    },
    [loadFileContent, addTab],
  );

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
        onHistorySelect={handleHistorySelect}
        onFileOpen={handleFileOpen}
        onClearHistory={clearHistory}
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
          onAddTab={addTab}
          onRemoveTab={removeTab}
          onSelectTab={setActiveTab}
        />
        {activeTab && (
          <SQLEditor
            key={activeTab.id}
            content={activeTab.content}
            enableVim={vimEnabled}
            getContentRef={getContentRef}
            onRun={handleRun}
            onModeChange={setVimMode}
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
            <ResultTabs results={result.results} totalDurationMs={result.total_duration_ms} />
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
        <ConnectionDialog onClose={() => setShowConnectionDialog(false)} onConnect={handleConnectionDialogConnect} />
      )}
    </div>
  );
}
