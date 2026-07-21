import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface QueryTab {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly filename: string;
  readonly createdAt: number;
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

export function useTabStore(): UseTabStoreReturn {
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

  // Load tabs on mount
  useEffect(() => {
    (async () => {
      try {
        // List all .sql files in queries dir
        const files = await invoke<Array<{ filename: string; modified: number; size: number }>>(
          "list_query_files"
        );
        const tabFiles = files.filter((f) => f.filename.startsWith(TAB_PREFIX));

        const index = loadTabsIndex();
        const loadedTabs: QueryTab[] = [];

        for (const file of tabFiles) {
          const id = file.filename.replace(TAB_PREFIX, "").replace(/\.sql$/, "");
          // Use saved index entry if exists, else create new
          const indexEntry = index.find((t) => t.id === id);
          try {
            const content = await invoke<string>("read_query_file", { filename: file.filename });
            loadedTabs.push({
              id,
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

        if (loadedTabs.length === 0) {
          // Create first tab
          const newId = String(nextTabId++);
          const filename = tabIdToFilename(newId);
          const newTab: QueryTab = {
            id: newId,
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
        console.error("Failed to load tabs:", e);
        // Fallback: create empty tab
        const newId = String(nextTabId++);
        const filename = tabIdToFilename(newId);
        const newTab: QueryTab = {
          id: newId,
          title: "查询 1",
          content: "",
          filename,
          createdAt: Date.now(),
        };
        setTabs([newTab]);
        setActiveTabId(newId);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Save tab content to .sql file (debounced)
  const saveTabFile = useCallback(async (id: string, content: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;

    try {
      await invoke("save_query_file", { filename: tab.filename, content });
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
      title: `查询 ${tabNumber}`,
      content: initialContent ?? "",
      filename,
      createdAt: Date.now(),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);

    // Save file immediately
    try {
      await invoke("save_query_file", { filename, content: newTab.content });
    } catch (e) {
      console.error("Failed to save new tab file:", e);
    }

    return newId;
  }, []);

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
      await invoke("delete_query_file", { filename: tab.filename });
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