import { useEffect, useState } from "react";
import type { LayoutObject } from "../api/types";
import { CLASS_LABEL, OBJECT_TYPES } from "../lib/format";
import { area, lengthOf, rebuildBlock, ringOf } from "../lib/geometry";
import { Button, Field, inputCls } from "../components/ui";

const SYSTEMS = ["RTG", "RMG", "ASC", "SC", "RS", "ECH"];

export default function Inspector({ obj, codes, layers, editable, onApply, onDelete }: {
  obj: LayoutObject; codes: Set<string>; layers: string[]; editable: boolean;
  onApply: (o: LayoutObject, oldCode: string) => void; onDelete: (code: string) => void;
}) {
  const [o, setO] = useState<LayoutObject>(obj);
  const [err, setErr] = useState("");
  useEffect(() => { setO(obj); setErr(""); }, [obj]);
  const pr = o.props as Record<string, unknown>;
  const setProp = (k: string, v: unknown) => setO({ ...o, props: { ...o.props, [k]: v } });
  const num = (k: string) => (pr[k] === undefined || pr[k] === null ? "" : String(pr[k]));
  const isBlock = o.object_type === "yard_block";

  function apply() {
    const code = o.code.trim();
    if (!code) return setErr("Mã không được trống");
    if (code !== obj.code && codes.has(code)) return setErr(`Mã ${code} đã tồn tại`);
    let next: LayoutObject = { ...o, code };
    if (isBlock) {
      const req = ["n_bay", "n_row", "n_tier_max"];
      for (const k of req) if (!(Number(pr[k]) >= 1)) return setErr(`${k} phải ≥ 1`);
      if (pr.n_tier_op && Number(pr.n_tier_op) > Number(pr.n_tier_max)) return setErr("n_tier_op phải ≤ n_tier_max");
      next = rebuildBlock(next, Number(o.rotation_deg) || 0);
    }
    setErr("");
    onApply(next, obj.code);
  }

  const pts = ringOf(o.geom);
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Mã"><input className={inputCls} value={o.code} disabled={!editable} onChange={(e) => setO({ ...o, code: e.target.value })} /></Field>
        <Field label="Lớp">
          <select className={inputCls} value={o.layer} disabled={!editable} onChange={(e) => setO({ ...o, layer: e.target.value })}>
            {Array.from(new Set([...layers, o.layer])).map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Loại">
          <select className={inputCls} value={o.object_type} disabled={!editable || isBlock} onChange={(e) => setO({ ...o, object_type: e.target.value })}>
            {OBJECT_TYPES.filter((t) => t.kind === (o.geom.type === "Polygon" ? "polygon" : o.geom.type === "LineString" ? "line" : "point"))
              .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <div className="text-xs text-slate-500">
          {o.geom.type === "Polygon" ? `Diện tích ${area(pts).toFixed(1)} m²` : o.geom.type === "LineString" ? `Dài ${lengthOf(pts).toFixed(1)} m` : `(${pts[0][0].toFixed(1)}, ${pts[0][1].toFixed(1)})`}
        </div>
      </div>
      {/* V0.4: elevations for the 3D view */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cao độ nền (m)" hint="so với mặt chuẩn; để trống = 0">
          <input className={inputCls} type="number" step="0.1" value={num("elevation_m")} disabled={!editable}
            onChange={(e) => setProp("elevation_m", e.target.value === "" ? undefined : Number(e.target.value))} />
        </Field>
        {!isBlock && o.geom.type === "Polygon" && (
          <Field label="Chiều cao 3D (m)" hint="công trình: mặc định 8 m">
            <input className={inputCls} type="number" step="0.5" min={0} value={num("height_m")} disabled={!editable}
              onChange={(e) => setProp("height_m", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Field>
        )}
      </div>
      {isBlock && (
        <div className="grid grid-cols-2 gap-2 rounded border border-slate-200 p-2">
          <Field label="Hệ thiết bị">
            <select className={inputCls} value={String(pr.equipment_system || "RTG")} disabled={!editable} onChange={(e) => setProp("equipment_system", e.target.value)}>
              {SYSTEMS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Loại hàng">
            <select className={inputCls} value={String(pr.cargo_class || "mixed")} disabled={!editable} onChange={(e) => setProp("cargo_class", e.target.value)}>
              {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {(["n_bay", "n_row", "n_tier_max", "n_tier_op", "reefer_plugs"] as const).map((k) => (
            <Field key={k} label={{ n_bay: "Số bay 20'", n_row: "Số hàng", n_tier_max: "Tầng tối đa", n_tier_op: "Tầng khai thác (tuỳ chọn)", reefer_plugs: "Ổ cắm lạnh" }[k]}>
              <input className={inputCls} type="number" min={0} disabled={!editable} value={num(k)}
                onChange={(e) => setProp(k, e.target.value === "" ? null : Number(e.target.value))} />
            </Field>
          ))}
          <Field label="Góc xoay (độ)">
            <input className={inputCls} type="number" disabled={!editable} value={o.rotation_deg} onChange={(e) => setO({ ...o, rotation_deg: Number(e.target.value) })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={!!pr.dg_allowed} onChange={(e) => setProp("dg_allowed", e.target.checked)} /> Cho phép hàng nguy hiểm (DG)</label>
        </div>
      )}
      {o.object_type === "berth" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Chiều dài bến (m)" hint="Trống = cạnh dài nhất"><input className={inputCls} type="number" disabled={!editable} value={num("length_m")} onChange={(e) => setProp("length_m", e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Độ sâu (m)"><input className={inputCls} type="number" disabled={!editable} value={num("depth_m")} onChange={(e) => setProp("depth_m", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        </div>
      )}
      {err && <p className="text-xs text-red-700">{err}</p>}
      {editable && (
        <div className="flex gap-2">
          <Button onClick={apply}>Áp dụng</Button>
          <Button variant="danger" onClick={() => onDelete(obj.code)}>Xoá</Button>
        </div>
      )}
    </div>
  );
}
