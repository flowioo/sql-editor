import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { call } from "../lib/ipc";
import type { ConnectionConfig } from "../types/connection";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ConnectionState {
  readonly config: ConnectionConfig | null;
  readonly displayName: string | null;
  readonly status: ConnectionStatus;
  readonly error: string | null;
}

export interface UseConnectionReturn extends ConnectionState {
  readonly connect: (config: ConnectionConfig) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly openSqliteFile: () => Promise<ConnectionConfig | null>;
}

export function useConnection(): UseConnectionReturn {
  const [state, setState] = useState<ConnectionState>({
    config: null,
    displayName: null,
    status: "disconnected",
    error: null,
  });

  const connect = useCallback(async (config: ConnectionConfig) => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));
    try {
      const displayName = await call<string>("connect", { config });
      setState({ config, displayName, status: "connected", error: null });
    } catch (e) {
      // The Rust `connect` command is fail-closed: on failure it clears the
      // previous driver, so a subsequent query cannot silently run against
      // the old connection. Mirror that here — report disconnected.
      setState({ config: null, displayName: null, status: "disconnected", error: String(e) });
    }
  }, []);

  const disconnectFn = useCallback(async () => {
    try {
      await call("disconnect");
    } catch {
      // ignore
    }
    setState({
      config: null,
      displayName: null,
      status: "disconnected",
      error: null,
    });
  }, []);

  const openSqliteFile = useCallback(async (): Promise<ConnectionConfig | null> => {
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
        return { type: "sqlite", path: selected };
      }
    } catch {
      // user cancelled or dialog error
    }
    return null;
  }, []);

  return { ...state, connect, disconnect: disconnectFn, openSqliteFile };
}
