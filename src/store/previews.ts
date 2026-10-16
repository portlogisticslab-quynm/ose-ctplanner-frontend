// V1.3: results of preview runs ("tính tạm") on the read-only backup server. Kept in memory only (lost on reload),
// keyed by scenario + run type, so the result pages and the Plot results tab can show the latest preview.
import { create } from "zustand";
import { download } from "../api/client";
import type { Run } from "../api/types";
import { useServerStatus } from "./serverStatus";

export const isPreviewId = (id: string | null | undefined) => !!id && id.startsWith("preview-");

interface Previews {
  byKey: Record<string, Run>;
  put: (r: Run) => void;
}

export const usePreviews = create<Previews>((set) => ({
  byKey: {},
  put: (r) => set((st) => ({ byKey: { ...st.byKey, [`${r.scenario_id}:${r.run_type}`]: r } })),
}));

export function usePreview(scenarioId: string, runType: string): Run | undefined {
  return usePreviews((s) => s.byKey[`${scenarioId}:${runType}`]);
}

/** true while the app talks to the read-only backup: runs become previews and are not stored. */
export function useBackupMode(): boolean {
  return useServerStatus((s) => s.servedBy === "render" || s.readOnly);
}

/** Excel / PDF / JSON report of a preview, built by the server from memory (nothing stored). */
export function previewReport(id: string, runType: string, format: "xlsx" | "pdf" | "json"): Promise<void> {
  return download(`/api/v1/previews/${id}/report?format=${format}`, `ctplanner_${runType}_tam.${format}`);
}

/** Save a run result as a JSON file in the browser (previews cannot use the server-side report export). */
export function saveRunJson(r: Run, name: string): void {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
