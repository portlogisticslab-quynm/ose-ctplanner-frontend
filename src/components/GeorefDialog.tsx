// V0.4: project coordinate system (EPSG or custom TM, e.g. VN-2000 provincial 3° zone) and the projected
// coordinates of the local layout origin (0, 0) – top-left of the drawing – plus its rotation.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Project } from "../api/types";
import type { CrsItem, GeorefInfo, GeorefOrigin } from "../lib/georef";
import { Button, ErrorBox, Field, inputCls, Modal } from "./ui";

export default function GeorefDialog({ project, editable, onClose, suggestion }: {
  project: Project; editable: boolean; onClose: () => void; suggestion?: GeorefOrigin | null;
}) {
  const qc = useQueryClient();
  const crs = useQuery({ queryKey: ["crs"], queryFn: () => api<{ crs: CrsItem[]; postgis: string | null }>("GET", "/api/v1/crs"), staleTime: 3_600_000 });
  const info = useQuery({ queryKey: ["georef", project.id], queryFn: () => api<GeorefInfo>("GET", `/api/v1/projects/${project.id}/georef`) });
  const o0 = (project.origin || {}) as GeorefOrigin;
  const start = { ...o0, ...(suggestion || {}) };
  const [epsg, setEpsg] = useState<number | "tm">(o0.tm ? "tm" : project.crs_epsg || 3405);
  const [e, setE] = useState(String(start.e ?? ""));
  const [n, setN] = useState(String(start.n ?? ""));
  const [rot, setRot] = useState(String(start.rotation_deg ?? 0));
  const [lon0, setLon0] = useState(String(o0.tm?.lon0 ?? 105.75));
  const [k0, setK0] = useState(String(o0.tm?.k0 ?? 0.9999));
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setErr(null);
    const origin: GeorefOrigin = { e: Number(e), n: Number(n), rotation_deg: Number(rot) || 0 };
    if (epsg === "tm") origin.tm = { type: "tm", lon0: Number(lon0), k0: Number(k0), fe: 500000, fn: 0, datum: "VN2000" };
    try {
      await api("PATCH", `/api/v1/projects/${project.id}`, { crs_epsg: epsg === "tm" ? null : epsg, origin });
      await qc.invalidateQueries({ queryKey: ["georef", project.id] });
      await qc.invalidateQueries({ queryKey: ["project", project.id] });
      await info.refetch();
      setSaved(true);
    } catch (x) { setErr(x); }
  }
  const projected = (crs.data?.crs || []).filter((c) => c.unit === "metre");
  return (
    <Modal title="Hệ toạ độ dự án (CAD/GIS)" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-600">
          Bản vẽ dùng toạ độ cục bộ (mét, trục y hướng xuống). Khai báo hệ toạ độ phẳng và toạ độ của điểm gốc (0, 0) – góc trên
          trái bản vẽ – để xuất DXF theo toạ độ thực, xuất GeoJSON (WGS 84) và nhập DXF đã vẽ theo VN-2000/UTM.
        </p>
        {suggestion && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Đã điền sẵn gốc toạ độ đề xuất từ tệp DXF vừa nhập. Chọn đúng hệ toạ độ của tệp rồi Lưu.</p>}
        <Field label="Hệ toạ độ">
          <select className={inputCls} value={String(epsg)} disabled={!editable} onChange={(x) => setEpsg(x.target.value === "tm" ? "tm" : Number(x.target.value))}>
            {projected.map((c) => <option key={c.epsg} value={c.epsg}>{c.code} – {c.name}</option>)}
            <option value="tm">VN-2000 / TM-3° địa phương (tuỳ chỉnh)</option>
          </select>
        </Field>
        {epsg === "tm" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kinh tuyến trục (°)" hint="vd. Hải Phòng 105°45′ = 105.75"><input className={inputCls} value={lon0} disabled={!editable} onChange={(x) => setLon0(x.target.value)} /></Field>
            <Field label="Hệ số k0"><input className={inputCls} value={k0} disabled={!editable} onChange={(x) => setK0(x.target.value)} /></Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label="E gốc (m)"><input className={inputCls} value={e} disabled={!editable} onChange={(x) => setE(x.target.value)} /></Field>
          <Field label="N gốc (m)"><input className={inputCls} value={n} disabled={!editable} onChange={(x) => setN(x.target.value)} /></Field>
          <Field label="Góc xoay (°)" hint="từ hướng Đông tới trục x, ngược chiều kim đồng hồ"><input className={inputCls} value={rot} disabled={!editable} onChange={(x) => setRot(x.target.value)} /></Field>
        </div>
        {info.data?.georeferenced && (
          <p className="text-xs text-slate-600">Hiện tại: <b>{info.data.crs?.name}</b>; gốc (0, 0) ≈ kinh độ {info.data.origin_lonlat?.[0].toFixed(6)}°, vĩ độ {info.data.origin_lonlat?.[1].toFixed(6)}° (WGS 84).
            {info.data.origin_lonlat && <> <a className="text-navy underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${info.data.origin_lonlat[1]}&mlon=${info.data.origin_lonlat[0]}#map=16/${info.data.origin_lonlat[1]}/${info.data.origin_lonlat[0]}`}>xem trên bản đồ</a></>}
          </p>
        )}
        <p className="text-xs text-slate-500">PostGIS: {crs.data?.postgis ? `đang bật (${crs.data.postgis}) – bản sao WGS 84 của hình học được cập nhật khi lưu` : "chưa bật (không bắt buộc)"}.</p>
        <ErrorBox error={err} />
        {saved && <p className="text-xs text-green-700">Đã lưu hệ toạ độ.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
          {editable && <Button disabled={!e || !n} onClick={() => void save()}>Lưu</Button>}
        </div>
      </div>
    </Modal>
  );
}
