import { useState } from "react";
import type { LayoutObject } from "../api/types";
import { CLASS_LABEL } from "../lib/format";
import { blockDimensions, generateBlocks } from "../lib/geometry";
import { Button, Field, inputCls } from "../components/ui";

export default function BlockGenerator({ existing, start, onCreate, onClose }: {
  existing: Set<string>; start: [number, number]; onCreate: (objs: LayoutObject[]) => void; onClose: () => void;
}) {
  const [f, setF] = useState({
    equipment_system: "RTG", n_bay: 30, n_row: 6, n_tier_max: 5, cargo_class: "mixed", count: 4, perRow: 2,
    gapX: 20, gapY: 15, rotation: 0, prefix: "Y", x0: Math.round(start[0]), y0: Math.round(start[1]),
  });
  const [err, setErr] = useState("");
  const set = (k: string, v: string | number) => setF({ ...f, [k]: v });
  const dims = blockDimensions({ equipment_system: f.equipment_system, n_bay: f.n_bay, n_row: f.n_row, n_tier_max: f.n_tier_max });

  function create() {
    let startIndex = 1;
    while (existing.has(`${f.prefix}${String(startIndex).padStart(2, "0")}`)) startIndex++;
    const objs = generateBlocks({
      props: { equipment_system: f.equipment_system, n_bay: f.n_bay, n_row: f.n_row, n_tier_max: f.n_tier_max, cargo_class: f.cargo_class,
        orientation: f.rotation % 180 === 0 ? "parallel" : "perpendicular" },
      count: f.count, perRow: Math.max(1, f.perRow), x0: f.x0, y0: f.y0, gapX: f.gapX, gapY: f.gapY,
      rotationDeg: f.rotation, prefix: f.prefix, startIndex,
    });
    const clash = objs.find((o) => existing.has(o.code));
    if (clash) return setErr(`Mã ${clash.code} đã tồn tại, đổi tiền tố`);
    onCreate(objs);
    onClose();
  }

  const numField = (k: keyof typeof f, label: string) => (
    <Field label={label}><input className={inputCls} type="number" value={f[k] as number} onChange={(e) => set(k, Number(e.target.value))} /></Field>
  );
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Hệ thiết bị">
          <select className={inputCls} value={f.equipment_system} onChange={(e) => set("equipment_system", e.target.value)}>
            {["RTG", "RMG", "ASC", "SC", "RS", "ECH"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Loại hàng">
          <select className={inputCls} value={f.cargo_class} onChange={(e) => set("cargo_class", e.target.value)}>
            {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {numField("n_bay", "Số bay 20'")}
        {numField("n_row", "Số hàng")}
        {numField("n_tier_max", "Tầng tối đa")}
        {numField("count", "Số block")}
        {numField("perRow", "Số block mỗi dãy")}
        {numField("rotation", "Góc xoay (0 = song song mép bến)")}
        {numField("gapX", "Khoảng cách dọc (m)")}
        {numField("gapY", "Khoảng cách ngang (m)")}
        {numField("x0", "X bắt đầu (m)")}
        {numField("y0", "Y bắt đầu (m)")}
        <Field label="Tiền tố mã"><input className={inputCls} value={f.prefix} onChange={(e) => set("prefix", e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} /></Field>
      </div>
      <p className="text-xs text-slate-500">Kích thước mỗi block (SAMPLE): {dims.length.toFixed(1)} × {dims.width.toFixed(1)} m</p>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <div className="flex gap-2"><Button onClick={create}>Sinh block</Button><Button variant="secondary" onClick={onClose}>Đóng</Button></div>
    </div>
  );
}
