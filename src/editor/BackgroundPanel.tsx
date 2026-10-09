import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Background, StoredFile } from "../api/types";
import type { Pt } from "../lib/geometry";
import { Button, ErrorBox, Field, inputCls } from "../components/ui";

/** World point → image pixel for the current background transform. */
export function worldToPx(bg: Background, w: Pt): [number, number] {
  const mpp = bg.m_per_px || 1;
  const ox = bg.origin_m[0] - bg.origin_px[0] * mpp;
  const oy = bg.origin_m[1] - bg.origin_px[1] * mpp;
  return [(w[0] - ox) / mpp, (w[1] - oy) / mpp];
}

export default function BackgroundPanel({ projectId, background, editable, calibPts, onBackground, onStartCalibrate, onCancelCalibrate }: {
  projectId: string; background: Background | null; editable: boolean; calibPts: Pt[];
  onBackground: (b: Background | null) => void; onStartCalibrate: () => void; onCancelCalibrate: () => void;
}) {
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ["files", projectId], queryFn: () => api<StoredFile[]>("GET", `/api/v1/projects/${projectId}/files?kind=background`) });
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [distance, setDistance] = useState(100);
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file as File);
      fd.append("page", String(page));
      return api<StoredFile>("POST", `/api/v1/projects/${projectId}/files`, fd);
    },
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ["files", projectId] });
      onBackground({ file_id: f.id, m_per_px: 1, origin_px: [0, 0], origin_m: [0, 0], opacity: 0.6 });
    },
  });
  const calibrate = useMutation({
    mutationFn: () => {
      const bg = background as Background;
      const p1 = worldToPx(bg, calibPts[0]);
      const p2 = worldToPx(bg, calibPts[1]);
      const om = origin ?? [calibPts[0][0], calibPts[0][1]];
      return api<StoredFile>("PUT", `/api/v1/files/${bg.file_id}/calibration`, { p1_px: p1, p2_px: p2, distance_m: distance, origin_px: p1, origin_m: om });
    },
    onSuccess: (f) => {
      const c = f.calibration as { m_per_px: number; origin_px: number[]; origin_m: number[] };
      onBackground({ file_id: f.id, m_per_px: c.m_per_px, origin_px: c.origin_px, origin_m: c.origin_m, opacity: background?.opacity ?? 0.6 });
      onCancelCalibrate();
      void qc.invalidateQueries({ queryKey: ["files", projectId] });
    },
  });

  function choose(id: string) {
    if (!id) return onBackground(null);
    const f = files.data?.find((x) => x.id === id);
    const c = (f?.calibration || {}) as { m_per_px?: number; origin_px?: number[]; origin_m?: number[] };
    onBackground({ file_id: id, m_per_px: c.m_per_px || 1, origin_px: c.origin_px || [0, 0], origin_m: c.origin_m || [0, 0], opacity: background?.opacity ?? 0.6 });
  }

  return (
    <div className="space-y-2 text-sm">
      <Field label="Ảnh nền">
        <select className={inputCls} value={background?.file_id || ""} disabled={!editable} onChange={(e) => choose(e.target.value)}>
          <option value="">— không dùng —</option>
          {files.data?.map((f) => <option key={f.id} value={f.id}>{f.original_name} {f.calibration?.m_per_px ? "✓" : "(chưa hiệu chỉnh)"}</option>)}
        </select>
      </Field>
      {background && (
        <Field label={`Độ mờ ${Math.round((background.opacity ?? 0.6) * 100)}%`}>
          <input type="range" min={0.1} max={1} step={0.05} value={background.opacity ?? 0.6} onChange={(e) => onBackground({ ...background, opacity: Number(e.target.value) })} />
        </Field>
      )}
      {editable && (
        <div className="space-y-1 rounded border border-slate-200 p-2">
          <p className="text-xs text-slate-500">Tải ảnh PNG/JPG hoặc một trang PDF làm nền.</p>
          <input type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file?.name.toLowerCase().endsWith(".pdf") && <Field label="Trang PDF"><input className={inputCls} type="number" min={1} value={page} onChange={(e) => setPage(Number(e.target.value))} /></Field>}
          <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>Tải lên</Button>
          <ErrorBox error={upload.error} />
        </div>
      )}
      {editable && background && (
        <div className="space-y-1 rounded border border-slate-200 p-2">
          <p className="text-xs text-slate-500">Hiệu chỉnh tỷ lệ: bấm “Chọn 2 điểm”, click hai điểm có khoảng cách đã biết trên ảnh, nhập khoảng cách thực.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onStartCalibrate}>Chọn 2 điểm</Button>
            <Button variant="ghost" onClick={onCancelCalibrate}>Huỷ</Button>
          </div>
          <p className="text-xs">Đã chọn {calibPts.length}/2 điểm</p>
          <Field label="Khoảng cách thực (m)"><input className={inputCls} type="number" value={distance} onChange={(e) => setDistance(Number(e.target.value))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Toạ độ X điểm 1 (m)"><input className={inputCls} type="number" value={origin?.[0] ?? ""} placeholder="giữ nguyên" onChange={(e) => setOrigin([Number(e.target.value), origin?.[1] ?? 0])} /></Field>
            <Field label="Toạ độ Y điểm 1 (m)"><input className={inputCls} type="number" value={origin?.[1] ?? ""} placeholder="giữ nguyên" onChange={(e) => setOrigin([origin?.[0] ?? 0, Number(e.target.value)])} /></Field>
          </div>
          <Button disabled={calibPts.length < 2 || distance <= 0 || calibrate.isPending} onClick={() => calibrate.mutate()}>Lưu hiệu chỉnh</Button>
          <ErrorBox error={calibrate.error} />
        </div>
      )}
    </div>
  );
}
