import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { EquipmentType, FleetItem } from "../api/types";
import { Badge, Button, Card, ErrorBox, Field, inputCls, Loading } from "../components/ui";
import { useScenario } from "./ScenarioShell";

type F = { key: string; label: string; unit?: string; required?: boolean; int?: boolean; text?: boolean };
type SectionSpec = { section: string; title: string; fields: F[]; table?: { key: string; cols: F[] } };

const SPECS: SectionSpec[] = [
  { section: "demand", title: "Nhu cầu", fields: [
    { key: "annual_quay_teu", label: "Sản lượng qua bến", unit: "TEU/năm", required: true },
    { key: "teu_factor", label: "Hệ số TEU", unit: "TEU/box" },
    { key: "transship_share", label: "Tỷ lệ trung chuyển", unit: "0–1" },
    { key: "mix.import", label: "Tỷ lệ nhập (gateway)", required: true }, { key: "mix.export", label: "Tỷ lệ xuất (gateway)", required: true },
    { key: "mix.empty", label: "Tỷ lệ rỗng (gateway)", required: true },
    { key: "special_shares.reefer", label: "Tỷ lệ hàng lạnh" }, { key: "special_shares.dg", label: "Tỷ lệ hàng nguy hiểm" },
    { key: "special_shares.oog", label: "Tỷ lệ hàng quá khổ" },
    ...["import", "export", "transship", "empty", "reefer", "dg", "oog"].map((k) => ({ key: `dwell_days.${k}`, label: `Lưu bãi ${k}`, unit: "ngày", required: true })),
    { key: "peak_factor", label: "Hệ số cao điểm" }, { key: "operating_days", label: "Ngày khai thác/năm", unit: "ngày" },
    { key: "landside.truck_share", label: "Tỷ lệ xe tải" }, { key: "landside.rail_share", label: "Tỷ lệ đường sắt" }, { key: "landside.barge_share", label: "Tỷ lệ sà lan" },
  ] },
  { section: "quay", title: "Bến", fields: [
    { key: "gross_berth_productivity_mph", label: "Năng suất gộp bến", unit: "move/h", required: true },
    { key: "berth_occupancy_max", label: "Chiếm dụng bến cho phép", unit: "0–1" },
    { key: "operating_hours_per_year", label: "Giờ khai thác/năm", unit: "h" },
    { key: "clearance_m", label: "Khoảng hở giữa tàu", unit: "m" }, { key: "design_vessel_loa_m", label: "LOA tàu thiết kế", unit: "m" },
  ], table: { key: "berths", cols: [{ key: "code", label: "Mã bến", text: true, required: true }, { key: "length_m", label: "Dài (m)", required: true }, { key: "depth_m", label: "Sâu (m)" }] } },
  { section: "gate", title: "Cổng", fields: [
    { key: "lanes_in", label: "Làn vào", int: true, required: true }, { key: "lanes_out", label: "Làn ra", int: true, required: true },
    { key: "service_time_in_min", label: "Phục vụ vào", unit: "phút", required: true }, { key: "service_time_out_min", label: "Phục vụ ra", unit: "phút", required: true },
    { key: "peak_hour_share", label: "Tỷ lệ giờ cao điểm" }, { key: "rho_max", label: "Hệ số sử dụng làn mục tiêu" }, { key: "boxes_per_truck", label: "Box/lượt xe" },
  ] },
  { section: "yard_params", title: "Tham số bãi", fields: [
    { key: "u_max", label: "Chiếm dụng bãi cho phép", unit: "0–1" }, { key: "reshuffle_factor", label: "Đảo chuyển thêm", unit: "move/box" },
    { key: "reefer_plug_margin", label: "Biên ổ cắm lạnh", unit: "0–1" },
  ] },
  { section: "operations", title: "Khai thác", fields: [
    { key: "shifts_per_day", label: "Số ca/ngày", int: true }, { key: "hours_per_shift", label: "Giờ/ca", unit: "h" },
    { key: "rho_max_equipment", label: "Hệ số sử dụng thiết bị mục tiêu" }, { key: "peak_shift_share", label: "Tỷ lệ ca cao điểm" },
  ] },
  { section: "horizontal", title: "Vận chuyển ngang", fields: [{ key: "avg_distance_m", label: "Quãng đường bến–bãi TB (trống = từ layout)", unit: "m" }] },
  { section: "rail", title: "Đường sắt / CFS", fields: [
    { key: "trains_per_day", label: "Chuyến tàu/ngày" }, { key: "teu_per_train", label: "TEU/chuyến" },
    { key: "cfs_area_m2", label: "Diện tích CFS", unit: "m²" }, { key: "depot_area_m2", label: "Diện tích depot", unit: "m²" },
  ] },
  { section: "costs", title: "Chi phí", fields: [
    { key: "currency", label: "Tiền tệ (USD/VND)", text: true }, { key: "discount_rate", label: "Suất chiết khấu", unit: "0–1" },
    { key: "economic_life_years", label: "Tuổi thọ kinh tế", unit: "năm" }, { key: "other_opex_year", label: "OPEX khác", unit: "/năm" },
  ] },
  { section: "environment", title: "Môi trường", fields: [{ key: "co2_kg_per_kwh", label: "Hệ số phát thải điện", unit: "kgCO2e/kWh" }] },
];

function getPath(o: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);
}
function setPath(o: Record<string, unknown>, path: string, v: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const out: Record<string, unknown> = { ...o };
  let cur = out;
  keys.slice(0, -1).forEach((k) => { cur[k] = { ...((cur[k] as Record<string, unknown>) || {}) }; cur = cur[k] as Record<string, unknown>; });
  const last = keys[keys.length - 1];
  if (v === "" || v === null || v === undefined) delete cur[last];
  else cur[last] = v;
  return out;
}
function prune(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const p = prune(v as Record<string, unknown>);
      if (Object.keys(p).length) out[k] = p;
    } else if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

function SectionForm({ spec, scenarioId, editable, initial, isSample }: { spec: SectionSpec; scenarioId: string; editable: boolean; initial: unknown; isSample: boolean }) {
  const qc = useQueryClient();
  const [data, setData] = useState<Record<string, unknown>>((initial as Record<string, unknown>) || {});
  useEffect(() => setData((initial as Record<string, unknown>) || {}), [initial]);
  const save = useMutation({
    mutationFn: () => api("PUT", `/api/v1/scenarios/${scenarioId}/inputs/${spec.section}`, prune(data)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inputs", scenarioId] }),
  });
  const rows = (spec.table ? (data[spec.table.key] as Record<string, unknown>[]) : null) || [];
  const setRows = (r: Record<string, unknown>[]) => spec.table && setData({ ...data, [spec.table.key]: r });
  const val = (f: F, v: string) => (f.text ? v : v === "" ? "" : f.int ? parseInt(v, 10) : Number(v));
  return (
    <Card title={<span>{spec.title} {isSample && <Badge tone="amber">SAMPLE</Badge>}</span>}
      actions={editable && <Button disabled={save.isPending} onClick={() => save.mutate()}>Lưu</Button>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spec.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}${f.required ? " *" : ""}`}>
            <input className={inputCls} type={f.text ? "text" : "number"} step="any" disabled={!editable}
              value={(getPath(data, f.key) as string | number | undefined) ?? ""}
              onChange={(e) => setData(setPath(data, f.key, val(f, e.target.value)))} />
          </Field>
        ))}
      </div>
      {spec.table && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              {spec.table!.cols.map((c) => (
                <Field key={c.key} label={c.label}>
                  <input className={inputCls} type={c.text ? "text" : "number"} disabled={!editable} value={(r[c.key] as string | number | undefined) ?? ""}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [c.key]: val(c, e.target.value) } : x)))} />
                </Field>
              ))}
              {editable && <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Xoá</Button>}
            </div>
          ))}
          {editable && <Button variant="secondary" onClick={() => setRows([...rows, {}])}>+ Thêm bến</Button>}
          <p className="text-xs text-slate-500">Nếu layout có đối tượng “Bến”, engine dùng bến trong layout thay cho bảng này.</p>
        </div>
      )}
      <div className="mt-2"><ErrorBox error={save.error} /></div>
    </Card>
  );
}

function FleetForm({ scenarioId, editable }: { scenarioId: string; editable: boolean }) {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ["equipment-types"], queryFn: () => api<EquipmentType[]>("GET", "/api/v1/master/equipment-types") });
  const fleet = useQuery({ queryKey: ["fleet", scenarioId], queryFn: () => api<FleetItem[]>("GET", `/api/v1/scenarios/${scenarioId}/fleet`) });
  const [rows, setRows] = useState<FleetItem[]>([]);
  useEffect(() => { if (fleet.data) setRows(fleet.data); }, [fleet.data]);
  const save = useMutation({
    mutationFn: () => api<FleetItem[]>("PUT", `/api/v1/scenarios/${scenarioId}/fleet`, rows.map((r) => ({
      equipment_type_id: r.equipment_type_id, quantity: r.quantity, availability: r.availability, zone_code: r.zone_code, overrides: r.overrides || {},
    }))),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["fleet", scenarioId] }),
  });
  const OVR = ["productivity_mph", "speed_loaded_kmh", "speed_empty_kmh", "handling_time_min", "capex_per_unit", "opex_per_unit_year", "energy_kwh_per_move"];
  if (types.isLoading || fleet.isLoading) return <Loading />;
  return (
    <Card title="Đội thiết bị" actions={editable && <Button disabled={save.isPending} onClick={() => save.mutate()}>Lưu</Button>}>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const t = types.data?.find((x) => x.id === r.equipment_type_id);
          return (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded border border-slate-100 p-2">
              <Field label="Loại thiết bị">
                <select className={inputCls} disabled={!editable} value={r.equipment_type_id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, equipment_type_id: e.target.value } : x)))}>
                  {types.data?.map((x) => <option key={x.id} value={x.id}>{x.category} · {x.code}{x.is_sample ? " (SAMPLE)" : ""}</option>)}
                </select>
              </Field>
              <Field label="Số lượng"><input className={`${inputCls} w-20`} type="number" min={0} disabled={!editable} value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: parseInt(e.target.value || "0", 10) } : x)))} /></Field>
              <Field label="Sẵn sàng"><input className={`${inputCls} w-20`} type="number" step="0.01" disabled={!editable} value={r.availability ?? ""} placeholder={String(t?.params.availability ?? "")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, availability: e.target.value === "" ? null : Number(e.target.value) } : x)))} /></Field>
              {OVR.map((k) => (
                <Field key={k} label={k}>
                  <input className={`${inputCls} w-24`} type="number" step="any" disabled={!editable} value={r.overrides?.[k] ?? ""} placeholder={t?.params[k] !== undefined ? String(t.params[k]) : ""}
                    onChange={(e) => {
                      const o = { ...(r.overrides || {}) };
                      if (e.target.value === "") delete o[k]; else o[k] = Number(e.target.value);
                      setRows(rows.map((x, j) => (j === i ? { ...x, overrides: o } : x)));
                    }} />
                </Field>
              ))}
              {editable && <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Xoá</Button>}
            </div>
          );
        })}
        {editable && types.data && types.data.length > 0 && (
          <Button variant="secondary" onClick={() => setRows([...rows, { equipment_type_id: types.data![0].id, quantity: 1, availability: null, zone_code: null, overrides: {} }])}>+ Thêm thiết bị</Button>
        )}
        <p className="text-xs text-slate-500">Ô trống dùng giá trị của loại thiết bị (gợi ý mờ). Giá trị SAMPLE cần thay bằng số liệu dự án.</p>
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}

export default function InputsPage() {
  const { scenario, editable } = useScenario();
  const inputs = useQuery({ queryKey: ["inputs", scenario.id], queryFn: () => api<Record<string, { data: unknown; is_sample: boolean }>>("GET", `/api/v1/scenarios/${scenario.id}/inputs`) });
  if (inputs.isLoading) return <Loading />;
  if (inputs.error) return <ErrorBox error={inputs.error} />;
  const d = inputs.data || {};
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Ô trống dùng giá trị mặc định SAMPLE của engine (được liệt kê trong mỗi kết quả tính). Block bãi, ranh giới và mạng đường nhập ở tab Mặt bằng 2D hoặc qua Excel.</p>
      {SPECS.map((s) => <SectionForm key={s.section} spec={s} scenarioId={scenario.id} editable={editable} initial={d[s.section]?.data} isSample={!!d[s.section]?.is_sample} />)}
      <FleetForm scenarioId={scenario.id} editable={editable} />
    </div>
  );
}
