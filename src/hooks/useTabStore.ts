import { useState, useCallback } from "react";

export interface QueryTab {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

let nextTabId = 2;

const DEFAULT_SQL = `-- 查询近 30 天活跃用户及其订单总额
SELECT
  u.id,
  u.nickname,
  u.phone,
  COUNT(o.id) AS order_count,
  COALESCE(SUM(o.amount), 0) AS total_spent
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at >= NOW() - INTERVAL '30 days'
  AND u.status = 'active'
GROUP BY u.id, u.nickname, u.phone
ORDER BY total_spent DESC
LIMIT 100`;

const INITIAL_TABS: readonly QueryTab[] = [
  { id: "1", title: "查询 1", content: DEFAULT_SQL },
];

interface UseTabStoreReturn {
  readonly tabs: readonly QueryTab[];
  readonly activeTabId: string;
  readonly addTab: (initialContent?: string) => string;
  readonly removeTab: (id: string) => void;
  readonly setActiveTab: (id: string) => void;
  readonly updateTabContent: (id: string, content: string) => void;
}

export function useTabStore(): UseTabStoreReturn {
  const [tabs, setTabs] = useState<readonly QueryTab[]>(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState("1");

  const addTab = useCallback((initialContent?: string) => {
    const id = String(nextTabId++);
    const newTab: QueryTab = {
      id,
      title: `查询 ${id}`,
      content: initialContent ?? "-- 新查询\n\n",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, []);

  const removeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeTabId]);

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const updateTabContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content } : t)),
    );
  }, []);

  return { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabContent };
}
