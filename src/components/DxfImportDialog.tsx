// V0.4: DXF import – upload, map each CAD layer to an object type, choose units and placement, preview, then
// merge into the editor (the layout is saved with the normal "Lưu" button).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LayoutObject } from "../api/types";
import { api } from "../api/client";
import { OBJECT_TYPES } from "../lib/format";
import type { GeorefInfo, GeorefOrigin } from "../lib/georef";
import { Badge, Button, ErrorBox, Field, inputCls, Modal, Table } from "./ui";

interface LayerRow { layer: string; count: number; kinds: Record<string, number>; suggested: string; color: number }
export interface DxfPreview {
  objects: LayoutObject[]; layers: LayerRow[]; mapping: Record<string, string>; warnings: string[];
  georef_suggestion: GeorefOrigin | null; extent: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
  scale_to_m: number; version: string; mode: "append" | "replace"; file: string; project_georef: GeorefInfo;
}

const KIND_LABEL: Record<string, string> = { closed: "vùng kín", polyline: "đường", line: "đoạn", point: "điểm", text: "chữ", circle: "tròn" };

export default function DxfImportDialog({ scenarioId, onClose, onApply }: {
  scenarioId: string; onClose: () => void;
  onApply: (objects: LayoutObject[], mode: "append" | "replace", georefSuggestion: GeorefOrigin | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [unit, setUnit] = useState("auto");
  const [placement, setPlacement] = useState("min");
  const [system, setSystem] = useState("RTG");
  const [mode, setMode] = useState<"append" | "replace">("replace");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [prev, setPrev] = useState<DxfPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const caps = useQuery({ queryKey: ["cad-caps"], queryFn: () => api<{ dwg_import: boolean; postgis: string | null }>("GET", "/api/v1/cad/capabilities"), staleTime: 600_000 });

  async function preview(map = mapping) {
    if (!file) return;
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("options", JSON.stringify({ mapping: map, unit, placement, block_system: system, mode }));
    try {
      const r = await api<DxfPreview>("POST", `/api/v1/scenarios/${scenarioId}/cad/dxf/preview`, fd);
      setPrev(r);
      setMapping(r.mapping);
    } catch (x) { setErr(x); setPrev(null); } finally { setBusy(false); }
  }

  const counts = new Map<string, number>();
  prev?.objects.forEach((o) => counts.set(o.object_type, (counts.get(o.object_type) || 0) + 1));
  const georefOk = prev?.project_georef?.georeferenced;
  return (
    <Modal title="Nhập bản vẽ AutoCAD (DWG / DXF)" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-5">
          <Field label="Bản vẽ AutoCAD (.dwg / .dxf)" hint={caps.data?.dwg_import ? "DWG được chuyển tự động sang DXF" : "DWG: máy chủ chưa có bộ chuyển – lưu thành DXF trong AutoCAD (SAVEAS)"}>
            <input type="file" accept=".dxf,.dwg" className="text-xs" onChange={(e) => { setFile(e.target.files?.[0] || null); setPrev(null); setMapping({}); }} />
          </Field>
          <Field label="Đơn vị bản vẽ">
            <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="auto">Tự nhận ($INSUNITS)</option><option value="m">mét</option><option value="mm">mm</option><option value="cm">cm</option><option value="ft">feet</option>
            </select>
          </Field>
          <Field label="Đặt vào bản vẽ">
            <select className={inputCls} value={placement} onChange={(e) => setPlacement(e.target.value)}>
              <option value="min">Dời về gốc (góc trên trái)</option>
              <option value="georef">Theo hệ toạ độ dự án</option>
              <option value="none">Giữ nguyên toạ độ</option>
            </select>
          </Field>
          <Field label="Block bãi dùng">
            <select className={inputCls} value={system} onChange={(e) => setSystem(e.target.value)}>
              {["RTG", "RMG", "ASC", "SC", "RS", "ECH"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Cách đưa vào">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "append" | "replace")}>
              <option value="replace">Thay toàn bộ layout</option><option value="append">Thêm vào layout</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!file || busy} onClick={() => void preview()}>{busy ? "Đang đọc…" : "Đọc / xem trước"}</Button>
          {placement === "georef" && <span className="self-center text-xs text-slate-500">Cần khai báo hệ toạ độ dự án trước (nút "Hệ toạ độ").</span>}
        </div>
        <ErrorBox error={err} />

        {prev && (
          <>
            <Table head={["Lớp CAD", "Số đối tượng", "Loại hình", "Nhập thành"]}
              rows={prev.layers.map((L) => [
                L.layer, L.count,
                Object.entries(L.kinds).map(([k, v]) => `${KIND_LABEL[k] || k} ×${v}`).join(", "),
                <select key={L.layer} className={inputCls} value={mapping[L.layer] || "ignore"}
                  onChange={(e) => { const m = { ...mapping, [L.layer]: e.target.value }; setMapping(m); void preview(m); }}>
                  <option value="ignore">— bỏ qua —</option>
                  <option value="label">Nhãn (chữ đặt tên đối tượng)</option>
                  {OBJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.kind === "polygon" ? "vùng" : t.kind === "line" ? "đường" : "điểm"})</option>)}
                </select>,
              ])} />
            <div className="flex flex-wrap gap-2 text-xs">
              <span>Sẽ nhập <b>{prev.objects.length}</b> đối tượng:</span>
              {[...counts.entries()].map(([t, c]) => <Badge key={t}>{OBJECT_TYPES.find((x) => x.value === t)?.label || t}: {c}</Badge>)}
              {prev.extent && <span className="text-slate-500">· phạm vi {(prev.extent.max_x - prev.extent.min_x).toFixed(0)} × {(prev.extent.max_y - prev.extent.min_y).toFixed(0)} m · tỷ lệ đơn vị → m: {prev.scale_to_m}</span>}
              {prev.version && <span className="text-slate-500">· DXF {prev.version}</span>}
            </div>
            {prev.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-800">{prev.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            {prev.georef_suggestion && placement === "min" && (
              <p className="rounded bg-slate-50 p-2 text-xs text-slate-700">
                Gốc (0, 0) của bản vẽ sau khi nhập tương ứng toạ độ tệp E = {prev.georef_suggestion.e?.toLocaleString("vi-VN")}, N = {prev.georef_suggestion.n?.toLocaleString("vi-VN")}.
                {!georefOk && " Sau khi đưa vào, hộp thoại Hệ toạ độ sẽ mở với gốc này để bạn chọn hệ toạ độ (vd. VN-2000 / UTM 48N) và lưu."}
              </p>
            )}
            <p className="text-xs text-slate-500">Block bãi: số bay/hàng ước lượng từ kích thước hình chữ nhật (bay 6,5 m; hàng theo hệ {system}); kiểm tra lại ở bảng thuộc tính. Đối tượng chỉ được lưu khi bấm "Lưu" trên trang Mặt bằng.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Huỷ</Button>
              <Button disabled={!prev.objects.length} onClick={() => onApply(prev.objects, prev.mode, placement === "min" && !georefOk ? prev.georef_suggestion : null)}>
                Đưa vào bản vẽ ({prev.mode === "replace" ? "thay toàn bộ" : "thêm"})
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
