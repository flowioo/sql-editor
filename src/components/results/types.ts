export type ResultRendererId = "table" | "json";

export interface ResultRendererMeta {
  readonly id: ResultRendererId;
  readonly label: string;
}

const REGISTRY: ResultRendererMeta[] = [
  { id: "table", label: "表格" },
  { id: "json", label: "JSON" },
];

export function registerRenderer(r: ResultRendererMeta): void {
  if (REGISTRY.some((existing) => existing.id === r.id)) return;
  REGISTRY.push(r);
}

export function listRenderers(): readonly ResultRendererMeta[] {
  return REGISTRY;
}
