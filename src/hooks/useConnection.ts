import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ConnectionState {
  readonly path: string | null;
  readonly displayName: string | null;
  readonly status: ConnectionStatus;
  readonly error: string | null;
}

export interface UseConnectionReturn extends ConnectionState {
  readonly connect: (path: string) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly openFile: () => Promise<void>;
}

export function useConnection(): UseConnectionReturn {
  const [state, setState] = useState<ConnectionState>({
    path: null,
    displayName: null,
    status: "disconnected",
    error: null,
  });

  const connect = useCallback(async (filePath: string) => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));
    try {
      const displayName = await invoke<string>("connect_sqlite", {
        path: filePath,
      });
      setState({ path: filePath, displayName, status: "connected", error: null });
    } catch (e) {
      setState({
        path: null,
        displayName: null,
        status: "disconnected",
        error: String(e),
      });
    }
  }, []);

  const disconnectFn = useCallback(async () => {
    try {
      await invoke("disconnect");
    } catch {
      // ignore
    }
    setState({
      path: null,
      displayName: null,
      status: "disconnected",
      error: null,
    });
  }, []);

  const openFile = useCallback(async () => {
    try {
      const selected = await open({
        filters: [
          {
            name: "SQLite 数据库",
            extensions: ["db", "sqlite", "sqlite3"],
          },
        ],
        multiple: false,
      });
      if (typeof selected === "string" && selected.length > 0) {
        await connect(selected);
      }
    } catch {
      // user cancelled or dialog error
    }
  }, [connect]);

  return { ...state, connect, disconnect: disconnectFn, openFile };
}
