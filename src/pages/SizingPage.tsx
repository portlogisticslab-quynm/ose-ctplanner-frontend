// V1.7 – tab "Quy hoạch sơ bộ": sizes a container terminal from its annual throughput after PIANC 135 / WG 185 /
// WG 208 / Thoresen. Results are computed in the browser while typing (src/lib/sizing.ts = engine copy); the server only
// builds the Excel / JSON files (POST /api/v1/sizing/export), so the tab also works on the read-only backup.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Project, ProjectList, Scenario } from "../api/types";
import SizingDrawing from "../components/SizingDrawing";
import { Badge, Button, Card, Chart, ErrorBox, Modal, Table, inputCls } from "../components/ui";
import { fmt, pct } from "../lib/format";
import {
  DEFAULTS, FLOW_KEYS, FLOW_LABEL, LENGTH_RULE_LABEL, LIMIT_OF, STS_RULE_LABEL, SIZING_VERSION, SYSTEM_LABEL, SYSTEM_PRESET, SYSTEMS, getPath, inputsFromScenario,
  setPath, tryCompute, withDefaults, wsRatio, type LengthRule, type SizingInputs, type SizingResult, type StsRule, type YardSystem,
} from "../lib/sizing";
import { can, useAuth } from "../store/auth";

const DRAFT_KEY = "ctplanner.sizing.draft";
type Inputs = SizingInputs;

// typical ranges (yellow when outside) and where the default comes from
const SOFT: Record<string, [number, number, string]> = {
  "cargo.teu_factor": [1.4, 1.7, "PIANC 135 / Thoresen: 1,4–1,7"],
  "cargo.peak_factor": [1.2, 1.3, "PIANC 135: 1,2–1,3"],
  "cargo.dwell_days.import": [6, 7, "PIANC 135: nhập 6–7 ngày (Thoresen 7)"],
  "cargo.dwell_days.export": [4, 5, "PIANC 135: xuất 4–5 ngày (Thoresen 5)"],
  "cargo.dwell_days.empty": [10, 20, "PIANC 135: rỗng 10–20 ngày"],
  "cargo.dwell_days.transship": [3, 5, "Trung chuyển 3–5 ngày"],
  "vessels.exchange_ratio": [0.3, 0.8, "Feeder 0,6–0,8; tàu mẹ 0,3–0,4"],
  "berth.gcr_mph": [20, 30, "PIANC 135: STS 20–25 cont/h (> 30 khung kép), MHC 15–20"],
  "berth.efficiency": [0.8, 0.9, "PIANC 135: 0,8–0,9"],
  "berth.t0_h": [2, 4, "Cập / rời / chuẩn bị 2–4 h"],
  "berth.availability": [0.95, 1, "PIANC 115: khai thác được ≥ 95% thời gian"],
  "berth.ws_target": [0.05, 0.15, "PIANC 135: W/S ≈ 10%"],
  "berth.gap_m": [15, 30, "WG 185: 15–30 m (≈ B/2 hoặc 10% LOA)"],
  "berth.sts_moves_year": [50000, 150000, "PIANC 135: 20.000–150.000 cont/STS/năm"],
  "apron.edge_m": [2, 6, "PIANC 135: 2–4 m (≥ 6 m cẩu lớn)"],
  "apron.rail_span_m": [15, 30.48, "PIANC 135: 30,48 m (15–20 m cẩu nhỏ)"],
  "apron.backreach_m": [15, 25, "PIANC 135: ≥ 15 m"],
  "apron.lane_width_m": [3.5, 5.5, "PIANC 135: TT 3,5 m; SC 5,5 m"],
  "yard.utilization": [0.65, 0.9, "PIANC 135: 0,65–0,9"],
  "yard.height_ratio": [0.75, 0.9, "PIANC 135: ví dụ 26/30 = 0,87"],
  "yard.tiers": [4, 6, "PIANC 135: RTG/RMG 4–6 tầng"],
  "yard.block_gap_m": [3, 6, "PIANC 135: 6 m cho vượt xe; 3–4 m ray sát lưng"],
  "yard.end_aisle_m": [20, 32, "PIANC 135: 20–32 m"],
  "yard.reefer_tiers": [1, 4, "PIANC 135: hàng lạnh ≤ 4 tầng"],
  "yard.empty_tiers": [5, 7, "Xe nâng rỗng 6–7 tầng"],
  "yard.empty_aisle_m": [16, 18, "PIANC 135: lối RS 16–18 m"],
  "equipment.horizontal_per_sts": [3, 6, "PIANC 135: TT 3–6/STS; AGV 3–4/STS"],
  "equipment.yard_per_sts": [2, 3, "PIANC 135: 2–3 RTG/RMG/RS mỗi STS"],
  "equipment.spare": [0.05, 0.15, "Dự phòng bảo dưỡng 5–15%"],
  "equipment.boxes_per_truck": [1.1, 1.3, "Thoresen P = 1,1–1,3"],
  "equipment.peak_hour_factor": [1.5, 2, "Giờ cao điểm 1,5–2,0 × giờ trung bình"],
  "equipment.gate_service_in_min": [2, 10, "2–5 phút có OCR; 5–10 phút thủ công"],
  "equipment.gate_service_out_min": [2, 10, "2–5 phút có OCR; 5–10 phút thủ công"],
  "land.reserve_share": [0.25, 0.4, "Thoresen: dự phòng 25–40%"],
  "thoresen.H": [0.5, 0.8, "Thoresen: 0,5–0,8"], "thoresen.Bf": [0.05, 0.1, "Thoresen: 0,05–0,10"],
  "thoresen.N": [0.6, 0.75, "Thoresen: 0,6–0,75"], "thoresen.L": [0.7, 1, "Thoresen: 0,7–1,0"], "thoresen.S": [0.8, 1, "Thoresen: 0,8–1,0"],
};
const ROWS_SOFT: Record<YardSystem, [number, number, string]> = {
  RTG: [6, 7, "PIANC 135: RTG 6 + 1 hoặc 7 + 1"], RMG: [8, 13, "RMG song song 9–13 hàng"], ASC: [8, 10, "PIANC 135: RMG vuông góc 8–10 hàng"],
};
const BAYS_SOFT: Record<YardSystem, [number, number, string]> = {
  RTG: [20, 30, "PIANC 135: khối RTG 20–30 TEU (125–190 m)"], RMG: [30, 55, "RMG song song 35–55 TEU"], ASC: [30, 40, "PIANC 135: 30–40 TEU (WG 208: 30–59)"],
};
// PIANC 135 Table 1.1 (quick pick of a vessel class)
const PIANC_VESSELS = [
  [400, 118, 20.1, 6.8], [600, 135, 20.8, 7.6], [1000, 158, 23.3, 8.7], [1300, 177, 25.4, 9.5], [1700, 192, 28.8, 10.2],
  [2100, 206, 30.2, 10.8], [2800, 230, 32.3, 11.8], [3500, 250, 32.3, 12.6], [4200, 268, 32.3, 13.4], [4900, 285, 40.3, 14],
  [5700, 300, 40.3, 14.5], [6400, 313, 42.8, 14.5], [7100, 326, 42.8, 14.5], [9074, 367, 43, 15], [15500, 397, 56.4, 15.5], [18000, 400, 59, 16],
];

function loadDraft(): unknown {
  try {
    const t = localStorage.getItem(DRAFT_KEY);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}
function saveDraft(v: unknown): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
}
function stamp(): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "QHSB";

// ---------------------------------------------------------------- form pieces
function NumField({ inputs, path, label, unit, scale = 1, step, issues, onSet, softOverride }: {
  inputs: Inputs; path: string; label: string; unit?: string; scale?: number; step?: number;
  issues: Record<string, string>; onSet: (path: string, v: unknown) => void; softOverride?: [number, number, string];
}) {
  const raw = getPath(inputs, path);
  const shown = typeof raw === "number" ? String(Number((raw * scale).toPrecision(10))) : raw === null || raw === undefined ? "" : String(raw);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(shown); }, [shown]);
  const err = issues[path];
  const soft = softOverride || SOFT[path];
  const val = typeof raw === "number" ? raw : null;
  const outSoft = !err && soft && val !== null && (val < soft[0] - 1e-9 || val > soft[1] + 1e-9);
  const hard = LIMIT_OF[path];
  const title = [soft ? `Tham khảo: ${soft[2]}` : "", hard ? `Cho phép ${hard[0] * scale}–${hard[1] * scale}${scale === 100 ? " %" : ""}` : ""].filter(Boolean).join("\n");
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="flex items-center gap-1 text-slate-700">
        {label}{unit && <span className="text-slate-400">({unit})</span>}
        {soft && <span className="cursor-help text-[10px] text-sky-700" title={title}>ⓘ</span>}
      </span>
      <input inputMode="decimal" step={step} value={text} title={title}
        className={`${inputCls} w-full ${err ? "border-red-500 bg-red-50" : outSoft ? "border-amber-400 bg-amber-50" : ""}`}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(shown); }}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim().replace(",", ".");
          const n = t === "" ? NaN : Number(t);
          onSet(path, Number.isFinite(n) ? n / scale : e.target.value);
        }} />
      {err && <span className="text-[11px] text-red-600">{err}</span>}
      {!err && outSoft && <span className="text-[11px] text-amber-700">Ngoài khoảng thường dùng ({soft[2]})</span>}
    </label>
  );
}

function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-navy">{title}</summary>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

function Kpi({ value, label, sub, tone }: { value: ReactNode; label: string; sub?: ReactNode; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${tone === "warn" ? "border-amber-400" : "border-slate-200"}`}>
      <div className="text-lg font-semibold text-navy">{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function SizingPage() {
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const [inputs, setInputs] = useState<Inputs>(() => withDefaults(loadDraft() || {}));
  const [tab, setTab] = useState<"berth" | "yard" | "equip" | "bench" | "warn">("berth");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const { result: computed, issues } = useMemo(() => tryCompute(inputs), [inputs]);
  // keep showing the last good result while a field is being corrected
  const last = useRef<SizingResult | null>(null);
  if (computed) last.current = computed;
  const r = computed || last.current;
  const issueMap = useMemo(() => Object.fromEntries(issues.map((i) => [i.path, i.message])), [issues]);

  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(inputs), 500);
    return () => window.clearTimeout(t);
  }, [inputs]);

  const set = (path: string, v: unknown) => setInputs((cur) => setPath(cur, path, v));
  const field = (path: string, label: string, unit?: string, scale = 1, soft?: [number, number, string]) =>
    <NumField key={path} inputs={inputs} path={path} label={label} unit={unit} scale={scale} issues={issueMap} onSet={set} softOverride={soft} />;
  const sys = (SYSTEMS.includes(inputs.yard.system) ? inputs.yard.system : "RTG") as YardSystem;

  function setSystem(s: YardSystem) {
    setInputs((cur) => ({ ...cur, yard: { ...cur.yard, system: s, ...SYSTEM_PRESET[s] } }));
  }

  async function exportFile(format: "xlsx" | "json") {
    if (!computed) return;
    setBusy(format); setErr(null);
    try {
      const name = `${safe(computed.inputs.project.code)}_sizing_${stamp()}.${format}`;
      const data = await api<unknown>("POST", `/api/v1/sizing/export?format=${format}`, { inputs: computed.inputs });
      saveBlob(data instanceof Blob ? data : new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), name);
    } catch (e) { setErr(e); } finally { setBusy(""); }
  }

  async function projectFile(): Promise<File> {
    const doc = await api<{ ctplanner_project: unknown }>("POST", "/api/v1/sizing/export?format=json", { inputs: computed?.inputs });
    return new File([JSON.stringify(doc.ctplanner_project)], `${safe(computed?.inputs.project.code || "QHSB")}.ctplanner.json`, { type: "application/json" });
  }

  async function createProject() {
    if (!computed) return;
    setBusy("project"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", await projectFile());
      const p = await api<Project>("POST", "/api/v1/projects/import", fd);
      nav(`/projects/${p.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr(new ApiError(409, e.code, `Mã dự án ${computed.inputs.project.code} đã có – đổi "Mã dự án" ở nhóm A rồi tạo lại`, []));
      else setErr(e);
    } finally { setBusy(""); }
  }

  async function checkBySimulation() {
    if (!computed) return;
    setBusy("sim"); setErr(null);
    try {
      nav("/file-run", { state: { file: await projectFile(), runType: "simulation" } });
    } catch (e) { setErr(e); setBusy(""); }
  }

  function applyLoaded(over: Record<string, unknown>, msg: string) {
    setInputs(withDefaults(over));
    setNote(msg);
    setLoadOpen(false);
  }

  const canWrite = can(user, "admin", "planner");
  const canRun = can(user, "admin", "planner", "analyst");
  const classes = inputs.vessels.classes || [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-navy">Quy hoạch sơ bộ bến & bãi</h1>
          <p className="text-xs text-slate-500">PIANC 135 · WG 185 · WG 208 · Thoresen — {SIZING_VERSION}. Kết quả tính ngay trên trình duyệt khi đổi số liệu.</p>
        </div>
        <Button variant="secondary" onClick={() => { setInputs(withDefaults({})); setNote("Đã đặt lại giá trị mặc định PIANC"); }}>Mặc định PIANC</Button>
        <Button variant="secondary" onClick={() => setLoadOpen(true)}>Nạp từ dự án / file</Button>
        <Button disabled={!computed || !!busy} onClick={() => exportFile("xlsx")}>{busy === "xlsx" ? "Đang xuất…" : "Xuất Excel"}</Button>
        <Button disabled={!computed || !!busy} onClick={() => exportFile("json")}>{busy === "json" ? "Đang xuất…" : "Xuất JSON"}</Button>
        {canWrite && <Button variant="secondary" disabled={!computed || !!busy} onClick={createProject} title="Tạo dự án ctplanner mới từ kết quả (mặt bằng, bến, thiết bị, phương án)">{busy === "project" ? "Đang tạo…" : "Tạo dự án ctplanner"}</Button>}
        {canRun && <Button variant="secondary" disabled={!computed || !!busy} onClick={checkBySimulation} title="Mở Tính từ file với dự án vừa tính để chạy mô phỏng DES">Kiểm tra bằng mô phỏng</Button>}
      </div>
      {note && <p className="rounded border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800">{note} <button className="ml-2 underline" onClick={() => setNote("")}>ẩn</button></p>}
      <ErrorBox error={err} />
      {issues.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {issues.length} ô chưa hợp lệ – kết quả bên phải là của lần tính hợp lệ gần nhất: {issues.slice(0, 4).map((i) => i.message).join("; ")}{issues.length > 4 ? "…" : ""}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* ------------------------------------------------ inputs */}
        <div className="space-y-2">
          <Group title="A. Hàng hoá">
            <label className="col-span-2 flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Tên dự án</span>
              <input className={inputCls} value={inputs.project.name} onChange={(e) => set("project.name", e.target.value)} /></label>
            <label className="flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Mã dự án</span>
              <input className={inputCls} value={inputs.project.code} onChange={(e) => set("project.code", e.target.value)} /></label>
            <label className="flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Địa điểm</span>
              <input className={inputCls} value={inputs.project.location} onChange={(e) => set("project.location", e.target.value)} /></label>
            {field("cargo.throughput_teu", "Sản lượng qua bến", "TEU/năm")}
            {field("cargo.teu_factor", "Hệ số TEU", "TEU/cont")}
            {field("cargo.transship_share", "Trung chuyển", "%", 100)}
            {field("cargo.peak_factor", "Hệ số cao điểm", "-")}
            {field("cargo.mix.import", "Nhập (cửa ngõ)", "%", 100)}
            {field("cargo.mix.export", "Xuất (cửa ngõ)", "%", 100)}
            {field("cargo.mix.empty", "Rỗng (cửa ngõ)", "%", 100)}
            {field("cargo.operating_days", "Ngày khai thác", "ngày/năm")}
            {field("cargo.reefer_share", "Lạnh / hàng có hàng", "%", 100)}
            {field("cargo.dg_share", "Nguy hiểm / có hàng", "%", 100)}
            <p className="col-span-2 mt-1 text-[11px] font-medium text-slate-600">Ngày lưu bãi</p>
            {FLOW_KEYS.map((k) => field(`cargo.dwell_days.${k}`, FLOW_LABEL[k], "ngày"))}
          </Group>

          <Group title="B. Tàu">
            {field("vessels.exchange_ratio", "Tỷ lệ xếp dỡ mỗi chuyến", "-")}
            <label className="flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Thêm lớp tàu (PIANC 135 Bảng 1.1)</span>
              <select className={inputCls} value="" onChange={(e) => {
                const row = PIANC_VESSELS[Number(e.target.value)];
                if (!row) return;
                // STS per vessel by size (typical practice): feeder 2, ≤ 3.500 TEU 3, ≤ 7.100 TEU 4, larger 5–6
                const sts = row[0] <= 1700 ? 2 : row[0] <= 3500 ? 3 : row[0] <= 7100 ? 4 : row[0] <= 12000 ? 5 : 6;
                set("vessels.classes", [...classes, { name: `${row[0]} TEU`, capacity_teu: row[0], loa_m: row[1], beam_m: row[2], draft_m: row[3], share: 0, sts }]);
              }}>
                <option value="">Chọn…</option>
                {PIANC_VESSELS.map((v, i) => <option key={i} value={i}>{`${v[0].toLocaleString("vi-VN")} TEU – LOA ${v[1]} m`}</option>)}
              </select></label>
            <div className="col-span-2">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[11px] font-normal text-slate-500"><th>Tên</th><th>TEU</th><th>LOA m</th><th>B m</th><th>Mớn m</th><th>%</th><th title="Số STS cùng làm hàng cho một tàu của lớp này">STS</th><th /></tr></thead>
                <tbody>
                  {classes.map((v, i) => (
                    <tr key={i}>
                      <td className="pr-0.5"><input className={`${inputCls} w-[64px] !px-1 !text-[11px]`} value={v.name} onChange={(e) => set(`vessels.classes.${i}.name`, e.target.value)} /></td>
                      {(["capacity_teu", "loa_m", "beam_m", "draft_m", "share", "sts"] as const).map((k) => {
                        const p = `vessels.classes.${i}.${k}`;
                        const sc = k === "share" ? 100 : 1;
                        const val = getPath(inputs, p);
                        return (
                          <td key={k} className="pr-0.5"><input inputMode="decimal" title={issueMap[p] || ""} className={`${inputCls} ${k === "capacity_teu" ? "w-[50px]" : k === "sts" ? "w-[32px]" : "w-[42px]"} !px-1 !text-[11px] ${issueMap[p] ? "border-red-500 bg-red-50" : ""}`}
                            defaultValue={typeof val === "number" ? String(Number((val * sc).toPrecision(8))) : String(val ?? "")}
                            key={`${i}-${k}-${JSON.stringify(val)}`}
                            onBlur={(e) => { const n = Number(e.target.value.replace(",", ".")); set(p, Number.isFinite(n) && e.target.value.trim() ? n / sc : e.target.value); }} /></td>
                        );
                      })}
                      <td><button className="px-1 text-red-600" title="Xoá lớp tàu" onClick={() => set("vessels.classes", classes.filter((_, j) => j !== i))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {issueMap["vessels.classes"] && <p className="text-[11px] text-red-600">{issueMap["vessels.classes"]}</p>}
              <p className="mt-1 text-[11px] text-slate-500">Tàu có LOA lớn nhất là tàu thiết kế (bến B1); tàu chiếm bến lâu nhất (% chuyến × thời gian làm hàng) là tàu thường gặp (các bến còn lại). STS: số cẩu cùng làm hàng cho một tàu của lớp đó (để trống = "STS mặc định" ở nhóm C). Tổng % chuyến khác 100% sẽ được chuẩn hoá.</p>
            </div>
          </Group>

          <Group title="C. Bến">
            <label className="col-span-2 flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Cách tính tổng số STS</span>
              <select className={inputCls} value={inputs.berth.sts_rule} onChange={(e) => set("berth.sts_rule", e.target.value as StsRule)}>
                {(Object.keys(STS_RULE_LABEL) as StsRule[]).map((k) => <option key={k} value={k}>{STS_RULE_LABEL[k]}</option>)}
              </select></label>
            {field("berth.sts_per_ship", "STS mặc định mỗi tàu", "chiếc")}
            {field("berth.sts_spare", "STS dự phòng", "chiếc")}
            {inputs.berth.sts_rule === "per_berth" && field("berth.sts_per_berth", "STS bố trí mỗi bến", "chiếc")}
            {inputs.berth.sts_rule === "per_berth" && <span />}
            {field("berth.gcr_mph", "Năng suất gộp STS", "cont/h")}
            {field("berth.efficiency", "Hệ số hiệu quả η", "-")}
            {field("berth.t0_h", "Cập / rời T0", "h")}
            {field("berth.availability", "Khai thác được A_w", "%", 100)}
            {field("berth.ws_target", "W/S mục tiêu", "%", 100)}
            {field("berth.gap_m", "Khe hở tàu B_gap", "m")}
            <label className="col-span-2 flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Cách tính chiều dài bến</span>
              <select className={inputCls} value={inputs.berth.length_rule} onChange={(e) => set("berth.length_rule", e.target.value as LengthRule)}>
                {(Object.keys(LENGTH_RULE_LABEL) as LengthRule[]).map((k) => <option key={k} value={k}>{LENGTH_RULE_LABEL[k][0].toUpperCase() + LENGTH_RULE_LABEL[k].slice(1)}</option>)}
              </select></label>
            <label className="flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Kiểm soát giờ tàu đến</span>
              <select className={inputCls} value={inputs.berth.arrival_control} onChange={(e) => set("berth.arrival_control", e.target.value)}>
                <option value="none">Không</option><option value="average">Trung bình</option><option value="high">Cao (lịch cố định)</option>
              </select></label>
            {field("berth.sts_moves_year", "Năng lực năm mỗi STS", "cont")}
            {field("berth.min_berths", "Số bến tối thiểu", "bến")}
            {field("berth.max_berths", "Số bến tối đa xét", "bến")}
            <p className="col-span-2 mt-1 text-[11px] font-medium text-slate-600">Tuyến trước bến W = A + B + C + E</p>
            {field("apron.edge_m", "A: mép bến – ray", "m")}
            {field("apron.rail_span_m", "B: khẩu độ ray", "m")}
            {field("apron.backreach_m", "C: back-reach", "m")}
            {field("apron.lanes", "E: số làn", "làn")}
            {field("apron.lane_width_m", "Bề rộng làn", "m")}
          </Group>

          <Group title="D. Bãi">
            <label className="col-span-2 flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Hệ bãi</span>
              <select className={inputCls} value={sys} onChange={(e) => setSystem(e.target.value as YardSystem)}>
                {SYSTEMS.map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s]}</option>)}
              </select></label>
            {field("yard.rows", "Số hàng mỗi khối", "hàng", 1, ROWS_SOFT[sys])}
            {field("yard.tiers", "Số tầng tối đa", "tầng")}
            {field("yard.bays", "Chiều dài khối", "TEU", 1, BAYS_SOFT[sys])}
            {field("yard.utilization", "Hệ số sử dụng ô u", "-")}
            {field("yard.height_ratio", "Tỷ lệ chiều cao H", "-")}
            {field("yard.block_gap_m", "Khe giữa khối", "m")}
            {field("yard.end_aisle_m", "Lối đầu khối", "m")}
            {field("yard.road_m", "Đường nội bộ", "m")}
            {field("yard.rows_per_road", "Dãy khối giữa 2 đường", "dãy")}
            {sys === "ASC" && field("yard.transfer_zone_m", "Vùng giao nhận đầu khối", "m")}
            {field("yard.reefer_tiers", "Tầng hàng lạnh", "tầng")}
            <p className="col-span-2 mt-1 text-[11px] font-medium text-slate-600">Bãi rỗng (xe nâng rỗng ECH)</p>
            {field("yard.empty_tiers", "Số tầng", "tầng")}
            {field("yard.empty_rows", "Số hàng mỗi khối", "hàng")}
            {field("yard.empty_height_ratio", "H bãi rỗng", "-")}
            {field("yard.empty_aisle_m", "Lối giữa khối", "m")}
          </Group>

          <Group title="E. Thiết bị, cổng, đất" open={false}>
            <label className="flex flex-col gap-0.5 text-xs"><span className="text-slate-700">Vận chuyển ngang</span>
              <select className={inputCls} value={inputs.equipment.horizontal} onChange={(e) => set("equipment.horizontal", e.target.value)}>
                <option value="TT">Xe đầu kéo (TT)</option><option value="AGV">AGV</option>
              </select></label>
            {field("equipment.horizontal_per_sts", "Xe ngang mỗi STS", "xe")}
            {field("equipment.yard_per_sts", "Cẩu bãi mỗi STS", "chiếc")}
            {field("equipment.spare", "Dự phòng", "%", 100)}
            {field("equipment.ech_moves_year", "Năng lực năm xe nâng rỗng", "lượt")}
            {field("equipment.truck_share", "Tỷ lệ đường bộ", "%", 100)}
            {field("equipment.boxes_per_truck", "Cont mỗi lượt xe", "cont")}
            {field("equipment.peak_hour_factor", "Hệ số giờ cao điểm", "-")}
            {field("equipment.gate_hours", "Giờ mở cổng", "h/ngày")}
            {field("equipment.gate_service_in_min", "Phục vụ cổng vào", "phút")}
            {field("equipment.gate_service_out_min", "Phục vụ cổng ra", "phút")}
            {field("land.back_zone_m", "Dải cổng + nhà", "m")}
            {field("land.cfs_share", "Kho CFS", "%", 100)}
            {field("land.reserve_share", "Đất dự phòng", "%", 100)}
            {field("land.site_length_m", "Ranh đất: dài (tuỳ chọn)", "m")}
            {field("land.site_depth_m", "Ranh đất: sâu (tuỳ chọn)", "m")}
            <p className="col-span-2 mt-1 text-[11px] font-medium text-slate-600">Hệ số Thoresen (phương pháp B)</p>
            {field("thoresen.H", "H", "-")}{field("thoresen.Bf", "Bf", "-")}{field("thoresen.N", "N", "-")}
            {field("thoresen.L", "L", "-")}{field("thoresen.S", "S", "-")}
          </Group>
          <p className="px-1 text-[11px] text-slate-500">Ô viền vàng: ngoài khoảng thường dùng (rê chuột vào ⓘ để xem nguồn). Ô viền đỏ: không hợp lệ. Số liệu đang nhập được lưu tạm trên trình duyệt này.</p>
        </div>

        {/* ------------------------------------------------ drawing + results */}
        <div className="min-w-0 space-y-3">
          {!r ? <Card><p className="text-sm text-slate-500">Nhập số liệu hợp lệ để xem kết quả.</p></Card> : (
            <>
              <Card title="Hình minh hoạ"><SizingDrawing r={r} /></Card>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Kpi value={`${r.berth.n_berths} bến`} label={`W/S ${fmt(r.berth.ws ?? 0, 3)} · φ ${pct(r.berth.occupancy)}`}
                  sub={`chờ TB ≈ ${fmt(r.berth.wait_h, 1)} h/chuyến`} tone={r.warnings.some((w) => w.code === "BERTHS_NOT_ENOUGH") ? "warn" : undefined} />
                <Kpi value={`${fmt(r.quay.length_m)} m`} label="chiều dài tuyến bến" sub={`${fmt(r.quay.teu_per_m)} TEU/m · apron ${fmt(r.quay.apron_m, 1)} m`} />
                <Kpi value={`${r.sts.count} STS`} label={`${fmt(r.sts.moves_per_sts)} cont/STS/năm`} sub={`theo tàu ${r.sts.base_per_berth.join(" + ")} = ${r.sts.by_berth}${r.sts.count > r.sts.by_berth ? ` + ${r.sts.count - r.sts.by_berth} bổ sung (${r.sts.by_throughput > r.sts.by_berth ? `sản lượng cần ${r.sts.by_throughput}` : ""}${r.sts.spare ? `${r.sts.by_throughput > r.sts.by_berth ? ", " : ""}${r.sts.spare} dự phòng` : ""})` : ""}`} />
                <Kpi value={`${r.yard.blocks} khối`} label={SYSTEM_LABEL[r.yard.system]}
                  sub={`${r.yard.groups.main.rows} × ${r.yard.groups.main.bays} TEU × ${r.yard.groups.main.tiers} tầng · ${fmt(r.yard.capacity_teu)} TEU`} />
                <Kpi value={`${fmt(r.areas.total_m2 / 1e4, 1)} ha`} label={`cảng ${fmt(r.areas.width_m)} × ${fmt(r.areas.depth_m)} m`}
                  sub={`${fmt(r.areas.m2_per_m)} m²/m bến · + dự phòng ${fmt(r.areas.reserve_m2 / 1e4, 1)} ha`} tone={r.site.fits ? undefined : "warn"} />
                <Kpi value={r.equipment.filter((e) => e.category !== "STS").map((e) => `${e.quantity} ${e.category}`).join(" · ")} label="thiết bị bãi và vận chuyển ngang"
                  sub={`cổng ${r.gate.lanes_in} làn vào / ${r.gate.lanes_out} làn ra`} />
              </div>
              <Card title="Kết quả chi tiết" actions={
                <div className="flex flex-wrap gap-1">
                  {([["berth", "Bến"], ["yard", "Bãi"], ["equip", "Thiết bị"], ["bench", "Chỉ tiêu"], ["warn", `Cảnh báo (${r.warnings.length})`]] as const).map(([k, l]) => (
                    <Button key={k} variant={tab === k ? "primary" : "secondary"} onClick={() => setTab(k)}>{l}</Button>
                  ))}
                </div>}>
                {tab === "berth" && <BerthTab r={r} />}
                {tab === "yard" && <YardTab r={r} />}
                {tab === "equip" && <EquipTab r={r} />}
                {tab === "bench" && <BenchTab r={r} />}
                {tab === "warn" && (r.warnings.length
                  ? <ul className="list-disc space-y-1 pl-5 text-sm">{r.warnings.map((w, i) => <li key={i}>{w.message} <span className="text-xs text-slate-400">{w.code}</span></li>)}</ul>
                  : <p className="text-sm text-green-700">Không có cảnh báo: mọi chỉ tiêu nằm trong khoảng tham khảo.</p>)}
              </Card>
            </>
          )}
        </div>
      </div>
      {loadOpen && <LoadDialog onClose={() => setLoadOpen(false)} onLoad={applyLoaded} />}
    </div>
  );
}

// ---------------------------------------------------------------- result tabs
function BerthTab({ r }: { r: SizingResult }) {
  const b = r.berth, v = r.vessels;
  const option = useMemo(() => {
    const xs = Array.from({ length: 19 }, (_, i) => 0.05 + i * 0.05);
    const ns = [1, 2, 3, 4, 5, 6].filter((n) => n <= Math.max(b.n_berths + 1, 3));
    return {
      tooltip: { trigger: "axis" },
      legend: { bottom: 0 },
      grid: { left: 50, right: 20, top: 30, bottom: 50 },
      xAxis: { type: "value", name: "φ", min: 0, max: 1, axisLabel: { formatter: (x: number) => `${Math.round(x * 100)}%` } },
      yAxis: { type: "value", name: "W/S", min: 0, max: 0.5 },
      series: [
        ...ns.map((n) => ({ name: `${n} bến`, type: "line", showSymbol: false, data: xs.map((x) => [x, Math.min(wsRatio(n, x), 0.6)]),
          lineStyle: { width: n === b.n_berths ? 3 : 1.5 } })),
        { name: "W/S mục tiêu", type: "line", showSymbol: false, data: [[0, r.inputs.berth.ws_target], [1, r.inputs.berth.ws_target]], lineStyle: { type: "dashed", color: "#E74C3C" } },
        { name: "Phương án", type: "scatter", symbolSize: 12, data: [[b.occupancy, b.ws ?? 0]], itemStyle: { color: "#C0392B" } },
      ],
    };
  }, [b, r.inputs.berth.ws_target]);
  return (
    <div className="space-y-3 text-sm">
      <p>Tàu TB {fmt(v.cap_avg_teu)} TEU, xếp dỡ {fmt(v.call_teu)} TEU = {fmt(v.moves_per_call)} cont/chuyến → <b>{fmt(v.calls_year)} chuyến/năm</b> ({fmt(v.calls_week, 1)}/tuần).
        Thời gian làm hàng bình quân theo lớp tàu T_s = {fmt(b.service_h, 2)} h; cần {fmt(b.berth_hours)} giờ-bến/năm, mỗi bến khai thác được {fmt(b.available_h)} h/năm.
        Tàu thiết kế: {v.design.name} (LOA {v.design.loa_m} m, B {v.design.beam_m} m, mớn {v.design.draft_m} m).</p>
      <Table head={["Lớp tàu", "% chuyến", "% thời gian chiếm bến", "STS/tàu", "Cont/chuyến", "T_s (h)", "Chuyến/năm"]}
        rows={v.classes.map((pc) => [<span key="n">{pc.name}{pc.name === v.design.name ? <Badge tone="blue">thiết kế · B1</Badge> : null}{pc.typical ? <Badge tone="green">thường gặp</Badge> : null}</span>, pct(pc.share), pct(pc.berth_time_share ?? 0), pc.sts_used < pc.sts ? <span key="s" className="text-amber-700" title={`Cần ${pc.sts}, mỗi bến chỉ có ${pc.sts_used}`}>{pc.sts_used} / {pc.sts}</span> : pc.sts,
          fmt(pc.moves_per_call), fmt(pc.service_h, 2), fmt(pc.calls_year)])} />
      <Table head={["Số bến", "φ", "W/S", "Đạt W/S", "Ngưỡng Thoresen", "φ tối đa", "Năng lực tối đa (TEU/năm)"]}
        rows={b.table.map((t) => [
          <b key="n" className={t.n === b.n_berths ? "text-navy" : ""}>{t.n}{t.n === b.n_berths ? " ✔" : ""}</b>, pct(t.occupancy),
          t.ws === null ? "∞" : fmt(t.ws, 3), t.ok ? <Badge tone="green">Đạt</Badge> : <Badge tone="red">Không</Badge>,
          <span key="t" className={t.thoresen_ok ? "" : "text-amber-700"}>{pct(t.thoresen_limit)}</span>, pct(t.occupancy_max), fmt(t.capacity_teu)])} />
      <p className="text-xs text-slate-500">Cột cuối = sản lượng lớn nhất mà số bến đó còn giữ được W/S mục tiêu – mốc phải mở thêm bến. 1–3 bến: bảng UNCTAD E2/E2/n (PIANC 135 Bảng 3.10); từ 4 bến: Erlang C × 0,38.</p>
      <Chart option={option} height={260} />
      <p>Chiều dài tuyến bến: WG 185 = {fmt(r.quay.length_wg185_m, 1)} m; bến cố định theo tàu thiết kế = {fmt(r.quay.length_fixed_m, 1)} m;
        1 bến tàu lớn nhất + bến tàu thường gặp = {fmt(r.quay.length_mixed_m, 1)} m → chọn theo "{LENGTH_RULE_LABEL[r.quay.length_rule]}": <b>{fmt(r.quay.length_m)} m</b>
        ({r.layout.berths.map((bt) => `${bt.code} ${fmt(bt.x1 - bt.x0)} m, ${bt.sts} STS`).join("; ")}).
        Hố neo đậu (tham khảo): dài {fmt(r.quay.pocket.length_tug_m)} m có tàu lai ({fmt(r.quay.pocket.length_no_tug_m)} m không lai), rộng {fmt(r.quay.pocket.width_m, 1)} m, sâu {fmt(r.quay.pocket.depth_m, 1)} m.</p>
    </div>
  );
}

function YardTab({ r }: { r: SizingResult }) {
  const y = r.yard;
  return (
    <div className="space-y-3 text-sm">
      <Table head={["Dòng hàng", "TEU/năm", "Lưu bãi", "Tồn bãi TB", "Sức chứa cần", "Tầng × H", "Ô nền", "A_TEU", "DT Thoresen"]}
        rows={y.flows.map((f) => [f.label, fmt(f.teu_year), `${fmt(f.dwell_days, 1)} ng`, fmt(f.inventory_teu), fmt(f.capacity_teu),
          `${f.tiers} × ${f.height_ratio}`, fmt(f.ground_slots), `${fmt(f.a_teu_m2, 1)} m²`, `${fmt(f.area_b_m2 / 1e4, 2)} ha`])} />
      <Table head={["Nhóm khối", "Hệ", "Hàng × bay × tầng", "Ô nền cần", "Số khối", "Kích thước khối", "Sức chứa"]}
        rows={(["main", "reefer", "empty"] as const).map((k) => {
          const g = y.groups[k];
          return [{ main: "Có hàng", reefer: "Lạnh", empty: "Rỗng" }[k], g.system, `${g.rows} × ${g.bays} × ${g.tiers}`, fmt(g.ground_slots), <b key="b">{g.blocks}</b>,
            `${fmt(g.block_length_m, 1)} × ${fmt(g.block_width_m, 1)} m`, `${fmt(g.capacity_teu)} TEU`];
        })} />
      <div className="grid gap-2 md:grid-cols-3">
        <Kpi value={`${fmt(y.area_method_a_m2 / 1e4, 2)} ha`} label="A – ô nền, theo bố trí khối" sub={`riêng khối ${fmt(y.block_area_m2 / 1e4, 2)} ha`} />
        <Kpi value={`${fmt(y.area_method_b_m2 / 1e4, 2)} ha`} label="B – Thoresen (m²/TEU)" sub="A_T = C·D·A_TEU·(1+Bf) / (365·H·N·L·S)" />
        <Kpi value={`${y.method_diff >= 0 ? "+" : ""}${pct(y.method_diff)}`} label="chênh lệch A so với B" tone={Math.abs(y.method_diff) > 0.3 ? "warn" : undefined}
          sub="> ±30%: xem lại u, H, chiều cao xếp" />
      </div>
    </div>
  );
}

function EquipTab({ r }: { r: SizingResult }) {
  const g = r.gate;
  return (
    <div className="space-y-3 text-sm">
      <Table head={["Loại", "Số lượng", "Khu vực", "Cách tính"]} rows={r.equipment.map((e) => [<b key="c">{e.category}</b>, e.quantity, e.area, <span key="r" className="text-xs">{e.rule}</span>])} />
      <p>Cổng: {fmt(g.truck_visits_year)} lượt xe/năm → {fmt(g.trucks_per_hour, 1)} xe/h mỗi chiều, giờ cao điểm {fmt(g.peak_per_hour, 1)} xe/h →
        <b> {g.lanes_in} làn vào</b> (kể cả 1 làn quá khổ) và <b>{g.lanes_out} làn ra</b>. Làn 3,4–3,5 m, làn quá khổ 5,6–6,1 m, tĩnh không mái che 5,6 m.</p>
    </div>
  );
}

function BenchTab({ r }: { r: SizingResult }) {
  const a = r.areas;
  return (
    <div className="space-y-3 text-sm">
      <Table head={["Chỉ tiêu", "Dự án", "Khoảng tham khảo", "", "Nguồn"]}
        rows={r.benchmarks.map((b) => [b.label, <b key="v">{fmt(b.value, b.value < 10 ? 2 : 0)}</b>, `${fmt(b.low)} – ${fmt(b.high)}`,
          b.ok ? <Badge tone="green">Trong khoảng</Badge> : <Badge tone="amber">Ngoài khoảng</Badge>, <span key="s" className="text-xs">{b.reference}</span>])} />
      <Table head={["Khu", "Diện tích", "Tỷ lệ"]} rows={[
        ["Tuyến trước bến", `${fmt(a.apron_m2 / 1e4, 2)} ha`, pct(a.apron_m2 / a.total_m2)],
        ["Bãi (gồm đường nội bộ)", `${fmt(a.yard_m2 / 1e4, 2)} ha`, pct(a.yard_m2 / a.total_m2)],
        ["Cổng, nhà, xưởng", `${fmt(a.back_m2 / 1e4, 2)} ha`, pct(a.back_m2 / a.total_m2)],
        ["Kho CFS", `${fmt(a.cfs_m2 / 1e4, 2)} ha`, pct(a.cfs_m2 / a.total_m2)],
        [<b key="t">Tổng cảng</b>, <b key="v">{`${fmt(a.total_m2 / 1e4, 2)} ha`}</b>, "100%"],
        ["Đất dự phòng", `${fmt(a.reserve_m2 / 1e4, 2)} ha`, pct(r.inputs.land.reserve_share)],
      ]} />
      <p className="text-xs text-slate-500">Thoresen: tuyến trước bến 5–15%, bãi 50–75%, CFS 15–30%, nhà xưởng cổng 10–20%, dự phòng thêm 25–40%. Cảng nước sâu thực tế 560–810 m² đất mỗi mét bến (Rotterdam, Lạch Huyện).</p>
    </div>
  );
}

// ---------------------------------------------------------------- loading inputs
function LoadDialog({ onClose, onLoad }: { onClose: () => void; onLoad: (inputs: Record<string, unknown>, note: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [pid, setPid] = useState("");
  const [scs, setScs] = useState<Scenario[]>([]);
  const [sid, setSid] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<ProjectList>("GET", "/api/v1/projects?size=200").then((l) => setProjects(l.items)).catch(setErr); }, []);
  useEffect(() => {
    if (!pid) { setScs([]); return; }
    api<Scenario[]>("GET", `/api/v1/projects/${pid}/scenarios`).then((l) => { setScs(l); setSid(l[0]?.id || ""); }).catch(setErr);
  }, [pid]);

  async function fromScenario() {
    setBusy(true); setErr(null);
    try {
      const raw = await api<Record<string, { data: unknown }>>("GET", `/api/v1/scenarios/${sid}/inputs`);
      const secs = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v?.data]));
      const p = projects?.find((x) => x.id === pid);
      const sc = scs.find((x) => x.id === sid);
      onLoad(inputsFromScenario(secs, p ? { code: `${p.code}-QHSB`, name: p.name, location: p.location } : null),
        `Đã nạp số liệu từ dự án ${p?.code} – phương án ${sc?.name}. Các ô dự án không có giữ giá trị mặc định.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  async function fromFile(f: File | null) {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      if (f.name.toLowerCase().endsWith(".json")) {
        const data = JSON.parse(await f.text());
        if (data?.format === "ctplanner-sizing/1") { onLoad(data.inputs || {}, `Đã nạp ${f.name}`); return; }
        if (data?.format === "ctplanner-project/1" && data.scenarios?.length) {
          const sc = data.scenarios.find((s: { key: string }) => s.key === data.baseline_key) || data.scenarios[0];
          const secs = Object.fromEntries(Object.entries(sc.inputs || {}).map(([k, v]) => [k, (v as { data?: unknown })?.data ?? v]));
          onLoad(inputsFromScenario(secs, data.project), `Đã nạp phương án "${sc.name}" từ ${f.name}`);
          return;
        }
        throw new Error("JSON phải là file của tab Quy hoạch sơ bộ hoặc dự án ctplanner");
      }
      const fd = new FormData();
      fd.append("file", f);
      const out = await api<{ inputs: Record<string, unknown>; notes: string[] }>("POST", "/api/v1/sizing/parse", fd);
      onLoad(out.inputs, [`Đã nạp ${f.name}`, ...out.notes].join(". "));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <Modal title="Nạp số liệu" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium text-navy">Từ dự án trong ctplanner</h3>
          <select className={`${inputCls} w-full`} value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">{projects === null ? "Đang tải…" : `Chọn dự án (${projects.length})`}</option>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
          </select>
          {scs.length > 0 && (
            <select className={`${inputCls} w-full`} value={sid} onChange={(e) => setSid(e.target.value)}>
              {scs.map((s) => <option key={s.id} value={s.id}>{s.name} (v{s.version_no})</option>)}
            </select>
          )}
          <Button disabled={!sid || busy} onClick={fromScenario}>Nạp phương án</Button>
          <p className="text-xs text-slate-500">Lấy sản lượng, cơ cấu hàng, ngày lưu bãi, lớp tàu, khe hở tàu, thời gian cổng và hệ số sử dụng bãi.</p>
        </section>
        <section className="space-y-2">
          <h3 className="font-medium text-navy">Từ file</h3>
          <input type="file" accept=".json,.xlsx,.xlsm" onChange={(e) => fromFile(e.target.files?.[0] || null)} />
          <p className="text-xs text-slate-500">File Excel / JSON đã xuất từ tab này, file JSON dự án ctplanner, hoặc mẫu Excel nhập liệu ctplanner.</p>
        </section>
        <ErrorBox error={err} />
        <p className="text-xs text-slate-400">Giá trị mặc định ({DEFAULTS.cargo.throughput_teu.toLocaleString("vi-VN")} TEU, tàu feeder) dùng cho các ô file không có.</p>
      </div>
    </Modal>
  );
}
