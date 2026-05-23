import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ScanResult {
  readonly models_found: number;
  readonly columns_matched: number;
  readonly columns_unmatched: number;
}

export interface UseCodebaseScanReturn {
  readonly scanning: boolean;
  readonly scanResult: ScanResult | null;
  readonly error: string | null;
  readonly scanCodebase: () => Promise<void>;
}

export function useCodebaseScan(): UseCodebaseScanReturn {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scanCodebase = useCallback(async () => {
    const selected = await open({ directory: true, title: "选择代码目录" });
    if (!selected) return;

    const dirPath = typeof selected === "string" ? selected : selected[0];
    if (!dirPath) return;

    setScanning(true);
    setError(null);
    try {
      const result = await invoke<ScanResult>("scan_codebase", { dirPath });
      setScanResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  return { scanning, scanResult, error, scanCodebase };
}
