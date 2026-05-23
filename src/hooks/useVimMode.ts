import { useCallback } from "react";

export type VimMode = "normal" | "insert" | "visual";

interface UseVimModeReturn {
  getVimModeLabel: (mode: VimMode) => string;
  getVimModeClass: (mode: VimMode) => string;
}

const MODE_LABELS: Record<VimMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
};

const MODE_CLASSES: Record<VimMode, string> = {
  normal: "",
  insert: "insert",
  visual: "visual",
};

export function useVimMode(): UseVimModeReturn {
  const getVimModeLabel = useCallback((mode: VimMode) => MODE_LABELS[mode], []);
  const getVimModeClass = useCallback((mode: VimMode) => MODE_CLASSES[mode], []);

  return { getVimModeLabel, getVimModeClass };
}
