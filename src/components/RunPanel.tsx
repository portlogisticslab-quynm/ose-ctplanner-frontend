// Shared header for run pages: run button, history selector, report export.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, download } from "../api/client";
import type { Report, Run } from "../api/types";
import { dateTime } from "../lib/format";
import { isPreviewId, previewReport, saveRunJson, useBackupMode, usePreview, usePreviews } from "../store/previews";
import { Badge, Button, ErrorBox, inputCls } from "./ui";

export function useRuns(scenarioId: string, runType: string) {
  return useQuery({ queryKey: ["runs", scenarioId, runType], queryFn: () => api<Run[]>("GET", `/api/v1/scenarios/${scenarioId}/runs?run_type=${runType}`) });
}

export default function RunPanel({ scenarioId, runType, endpoint, canRun, body, onRun }: {
  scenarioId: string; runType: string; endpoint: string; canRun: boolean; body?: Record<string, unknown>;
  onRun: (r: Run | null) => void;
}) {
  const qc = useQueryClient();
  const runs = useRuns(scenarioId, runType);
  const [selected, setSelected] = useState<string>("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const backup = useBackupMode();
  const preview = usePreview(scenarioId, runType);
  const putPreview = usePreviews((st) => st.put);

  useEffect(() => {
    const ok = runs.data?.find((r) => r.status === "succeeded");
    if (!selected && (preview || ok)) setSelected((preview || ok)!.id);   // latest preview first (backup server)
  }, [runs.data, selected, preview]);

  useEffect(() => {
    if (!selected) { onRun(null); return; }
    if (isPreviewId(selected)) { onRun(preview?.id === selected ? preview : null); return; }
    api<Run>("GET", `/api/v1/runs/${selected}`).then(onRun).catch(setErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function run() {
    setBusy(true); setErr(null);
    if (backup) {   // V1.3: read-only backup → compute without storing
      try {
        const r = await api<Run>("POST", `/api/v1/scenarios/${scenarioId}/preview/${endpoint}`, body ?? {});
        putPreview(r);
        setSelected(r.id);
        onRun(r);
      } catch (e) { setErr(e); } finally { setBusy(false); }
      return;
    }
    try {
      const r = await api<Run>("POST", `/api/v1/scenarios/${scenarioId}/runs/${endpoint}`, body ?? {});
      await qc.invalidateQueries({ queryKey: ["runs", scenarioId, runType] });
      setSelected(r.id);
      onRun(r);
    } catch (e) {
      setErr(e);
      void qc.invalidateQueries({ queryKey: ["runs", scenarioId, runType] });
    } finally { setBusy(false); }
  }

  async function report(format: "xlsx" | "pdf" | "json") {
    setErr(null);
    try {
      const rep = await api<Report>("POST", "/api/v1/reports", { run_ids: [selected], format });
      await download(`/api/v1/reports/${rep.id}/download`, `ctplanner_${runType}_${selected.slice(0, 8)}.${format}`);
    } catch (e) { setErr(e); }
  }

  const cur = isPreviewId(selected) ? preview : runs.data?.find((r) => r.id === selected);
  const stored = !isPreviewId(selected);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canRun && <Button disabled={busy} onClick={() => void run()}>{busy ? "Đang tính…" : backup ? "Tính tạm (không lưu)" : "Chạy tính toán"}</Button>}
        <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— chọn lần chạy —</option>
          {preview && <option value={preview.id}>Kết quả tạm (chưa lưu) · {dateTime(preview.created_at)} · {preview.input_hash.slice(0, 8)}</option>}
          {runs.data?.map((r) => <option key={r.id} value={r.id}>{dateTime(r.created_at)} · {r.status} · {r.input_hash.slice(0, 8)}</option>)}
        </select>
        {cur && <Badge tone={cur.status === "succeeded" ? "green" : "red"}>{cur.status}</Badge>}
        {cur?.preview && <Badge tone="amber">tạm – không lưu</Badge>}
        {cur?.status === "succeeded" && !stored && (
          <>
            <Button variant="secondary" onClick={() => void previewReport(cur.id, runType, "xlsx").catch(setErr)}>Excel</Button>
            <Button variant="secondary" onClick={() => void previewReport(cur.id, runType, "pdf").catch(setErr)}>PDF</Button>
            <Button variant="secondary" onClick={() => saveRunJson(cur, `ctplanner_${runType}_tam.json`)}>JSON</Button>
          </>
        )}
        {cur?.status === "succeeded" && stored && (
          <>
            <Button variant="secondary" onClick={() => void report("xlsx")}>Excel</Button>
            <Button variant="secondary" onClick={() => void report("pdf")}>PDF</Button>
            <Button variant="secondary" onClick={() => void report("json")}>JSON</Button>
          </>
        )}
      </div>
      {cur && (
        <p className="text-xs text-slate-500">
          model {cur.model_version} · engine {cur.engine_version} · {cur.scenario_version} · input {cur.input_hash.slice(0, 12)} · checksum {cur.checksum.slice(0, 12)} · {cur.elapsed_s?.toFixed(3)} s
        </p>
      )}
      {backup && canRun && (
        <p className="text-xs text-amber-800">
          Máy chủ dự phòng (chỉ đọc): “Tính tạm” chạy trên dữ liệu đồng bộ gần nhất và chỉ hiển thị kết quả – không lưu vào lịch sử,
          mất khi tải lại trang. Xem biểu đồ ở tab Plot results; tải Excel / PDF / JSON hoặc PNG/CSV để giữ lại.
        </p>
      )}
      <ErrorBox error={err} />
    </div>
  );
}

export function Warnings({ items }: { items: { code: string; message: string; severity: string }[] }) {
  if (!items?.length) return <p className="text-sm text-green-700">Không có cảnh báo.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((w, i) => (
        <li key={i} className={w.severity === "error" ? "text-red-700" : "text-amber-700"}><code className="text-xs">{w.code}</code> {w.message}</li>
      ))}
    </ul>
  );
}
