import { useState, useCallback, useEffect, useRef } from "react";
import { call } from "../lib/ipc";

export interface QueryTab {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly filename: string;
  readonly createdAt: number;
  /** Connection id this tab belongs to. Captured at creation so a debounce
   *  save always writes to the right per-connection folder even after the
   *  active connection changes. "" maps to the "unassigned" folder. */
  readonly connId: string;
}

let nextTabId = Date.now();

const TABS_INDEX_KEY = "sql-editor-tabs-index";
const TAB_PREFIX = "tab_";
const SAVE_DEBOUNCE_MS = 1500;

function tabIdToFilename(id: string): string {
  return `${TAB_PREFIX}${id}.sql`;
}

function loadTabsIndex(): readonly QueryTab[] {
  try {
    const raw = localStorage.getItem(TABS_INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueryTab[];
  } catch {
    return [];
  }
}

function saveTabsIndex(tabs: readonly QueryTab[]): void {
  try {
    localStorage.setItem(TABS_INDEX_KEY, JSON.stringify(tabs));
  } catch {
    // ignore
  }
}

interface UseTabStoreReturn {
  readonly tabs: readonly QueryTab[];
  readonly activeTabId: string;
  readonly loaded: boolean;
  readonly addTab: (initialContent?: string) => Promise<string>;
  readonly removeTab: (id: string) => Promise<void>;
  readonly setActiveTab: (id: string) => void;
  readonly updateTabContent: (id: string, content: string) => void;
  readonly renameTab: (id: string, title: string) => void;
}

export function useTabStore(currentConnectionId: string | null): UseTabStoreReturn {
  // Used as the `connection_id` segment for all file-backed invokes.
  // Mirrors App's connIdFromConfig so tab files land in the same per-connection
  // folder as query-history files (see commands/files.rs::sanitize_conn_id).
  const connId = currentConnectionId ?? "";
  const [tabs, setTabs] = useState<readonly QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Persist tabs index
  useEffect(() => {
    if (loaded) saveTabsIndex(tabs);
  }, [tabs, loaded]);

  // (Re)load tabs whenever the active connection changes. Each connection's
  // saved query tabs live in their own folder; switching connections swaps the
  // working tab set. Pending debounced saves are flushed first so edits on the
  // outgoing connection are not lost.
  useEffect(() => {
    // Flush pending saves for the outgoing connection before swapping tabs.
    for (const [id] of saveTimers.current) {
      const timer = saveTimers.current.get(id);
      if (timer) clearTimeout(timer);
      const tab = tabsRef.current.find((t) => t.id === id);
      if (tab) {
        void call("save_query_file", {
          connectionId: tab.connId,
          filename: tab.filename,
          content: tab.content,
        }).catch((e) => console.error("Failed to flush tab save:", id, e));
      }
    }
    saveTimers.current.clear();

    // Cancelled flag — if the connection changes again (or the component
    // unmounts) before this effect finishes loading, we drop the result
    // instead of clobbering the newer state. StrictMode-friendly.
    let cancelled = false;

    (async () => {
      try {
        // List tab files for THIS connection's folder.
        const files = await call<Array<{ filename: string; modified: number; size: number }>>(
          "list_query_files",
          { connectionId: connId },
        );
        if (cancelled) return;
        const tabFiles = files.filter((f) => f.filename.startsWith(TAB_PREFIX));

        const index = loadTabsIndex();
        const loadedTabs: QueryTab[] = [];

        for (const file of tabFiles) {
          const id = file.filename.replace(TAB_PREFIX, "").replace(/\.sql$/, "");
          // Use saved index entry if exists, else create new
          const indexEntry = index.find((t) => t.id === id);
          try {
            const content = await call<string>("read_query_file", {
              connectionId: connId,
              filename: file.filename,
            });
            if (cancelled) return;
            loadedTabs.push({
              id,
              connId,
              filename: file.filename,
              title: indexEntry?.title ?? `查询 ${id.slice(-4)}`,
              content,
              createdAt: indexEntry?.createdAt ?? file.modified,
            });
          } catch (e) {
            console.error("Failed to load tab file:", file.filename, e);
          }
        }

        // Sort by createdAt
        loadedTabs.sort((a, b) => a.createdAt - b.createdAt);

        if (cancelled) return;
        if (loadedTabs.length === 0) {
          // Create first tab for this connection
          const newId = String(nextTabId++);
          const filename = tabIdToFilename(newId);
          const newTab: QueryTab = {
            id: newId,
            connId,
            title: "查询 1",
            content: "",
            filename,
            createdAt: Date.now(),
          };
          setTabs([newTab]);
          setActiveTabId(newId);
        } else {
          setTabs(loadedTabs);
          setActiveTabId(loadedTabs[0].id);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to load tabs:", e);
        // Fallback: create empty tab
        const newId = String(nextTabId++);
        const filename = tabIdToFilename(newId);
        const newTab: QueryTab = {
          id: newId,
          connId,
          title: "查询 1",
          content: "",
          filename,
          createdAt: Date.now(),
        };
        setTabs([newTab]);
        setActiveTabId(newId);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId]);

  // Save tab content to .sql file (debounced). Uses the tab's own connId so
  // the file lands in the right per-connection folder regardless of the
  // currently active connection.
  const saveTabFile = useCallback(async (id: string, content: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;

    try {
      await call("save_query_file", {
        connectionId: tab.connId,
        filename: tab.filename,
        content,
      });
    } catch (e) {
      console.error("Failed to save tab file:", e);
    }
  }, []);

  const updateTabContent = useCallback(
    (id: string, content: string) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)));

      // Debounced save
      const existing = saveTimers.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = window.setTimeout(() => {
        saveTabFile(id, content);
        saveTimers.current.delete(id);
      }, SAVE_DEBOUNCE_MS);
      saveTimers.current.set(id, timer);
    },
    [saveTabFile]
  );

  const addTab = useCallback(async (initialContent?: string): Promise<string> => {
    const newId = String(nextTabId++);
    const filename = tabIdToFilename(newId);
    const tabNumber = tabsRef.current.length + 1;
    const newTab: QueryTab = {
      id: newId,
      connId,
      title: `查询 ${tabNumber}`,
      content: initialContent ?? "",
      filename,
      createdAt: Date.now(),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);

    // Save file immediately
    try {
      await call("save_query_file", {
        connectionId: connId,
        filename,
        content: newTab.content,
      });
    } catch (e) {
      console.error("Failed to save new tab file:", e);
    }

    return newId;
  }, [connId]);

  const removeTab = useCallback(async (id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    if (tabsRef.current.length <= 1) return;

    // Clear pending save
    const timer = saveTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      saveTimers.current.delete(id);
    }

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });

    // Delete the underlying .sql file
    try {
      await call("delete_query_file", {
        connectionId: tab.connId,
        filename: tab.filename,
      });
    } catch (e) {
      console.error("Failed to delete tab file:", e);
    }
  }, [activeTabId]);

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const renameTab = useCallback((id: string, title: string) => {
    const trimmed = title.trim() || "未命名";
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title: trimmed } : t)));
  }, []);

  return {
    tabs,
    activeTabId,
    loaded,
    addTab,
    removeTab,
    setActiveTab,
    updateTabContent,
    renameTab,
  };
}