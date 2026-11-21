// V1.7 – tab "Quy hoạch sơ bộ": preliminary terminal sizing after PIANC (live results while typing).
// Line-by-line copy of engine/ctp_engine/sizing.py of the backend repository. Both copies are checked against the same
// golden cases (src/lib/sizing.golden.json = tests/fixtures/sizing_golden.json, written by scripts/make_sizing_golden.py):
// change a formula in both files, then regenerate the golden file.
// Sources: PIANC 135 (2014), PIANC WG 185, PIANC WG 208, Thoresen – Port Designer's Handbook (4th ed.).

/* eslint-disable @typescript-eslint/no-explicit-any */
export const SIZING_FORMAT = "ctplanner-sizing/1";
export const SIZING_VERSION = "pianc-2026.11.4"; // V1.7.2: STS per vessel class, STS and quay-length rules
const HOURS_YEAR = 8760;

const WS_TABLE: Record<number, [number, number][]> = {
  1: [[0, 0], [0.3, 0.13], [0.4, 0.24], [0.5, 0.39], [0.6, 0.63], [0.7, 1.04], [0.8, 1.87], [0.9, 4.36]],
  2: [[0, 0], [0.3, 0.02], [0.4, 0.06], [0.5, 0.12], [0.6, 0.22], [0.7, 0.41], [0.8, 0.83], [0.9, 2.0]],
  3: [[0, 0], [0.3, 0.01], [0.4, 0.02], [0.5, 0.05], [0.6, 0.11], [0.7, 0.23], [0.8, 0.46], [0.9, 1.2]],
};
export const ERLANG_FACTOR = 0.38;
const THORESEN_BOR: Record<number, [number, number, number]> = {
  1: [0.25, 0.35, 0.45], 2: [0.4, 0.45, 0.5], 3: [0.45, 0.5, 0.55], 4: [0.55, 0.6, 0.65], 5: [0.6, 0.65, 0.7], 6: [0.65, 0.7, 0.75],
};
export const ARRIVAL: Record<string, number> = { none: 0, average: 1, high: 2 };
// V1.7.4: control of arrivals scales the waiting time (Allen–Cunneen, Erlang-2 service): random arrivals × 1.5,
// the UNCTAD E2/E2/n table × 1, vessels on a fixed schedule × 0.7.
export const ARRIVAL_WS_FACTOR: Record<string, number> = { none: 1.5, average: 1.0, high: 0.7 };
export const ARRIVAL_LABEL: Record<string, string> = {
  none: "Không – đến ngẫu nhiên (W/S × 1,5)", average: "Trung bình – một phần theo lịch (UNCTAD)", high: "Cao – lịch cố định (W/S × 0,7)",
};
const A_TEU_GANTRY: Record<number, [number, number, number]> = { 2: [21, 18, 15], 3: [14, 12, 10], 4: [11, 9, 8], 5: [8, 7, 6] };
const A_TEU_RS: Record<number, number> = { 1: 72, 2: 36, 3: 24, 4: 18 };
export type YardSystem = "RTG" | "RMG" | "ASC";
export const SYSTEMS: YardSystem[] = ["RTG", "RMG", "ASC"];
export const SYSTEM_LABEL: Record<YardSystem, string> = { RTG: "RTG song song bến", RMG: "RMG song song bến", ASC: "RMG/ASC vuông góc bến" };
export const FLOW_KEYS = ["import", "export", "transship", "dg", "reefer", "empty"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];
export const FLOW_LABEL: Record<FlowKey, string> = { import: "Nhập", export: "Xuất", transship: "Trung chuyển", dg: "Nguy hiểm", reefer: "Lạnh", empty: "Rỗng" };
const FLOW_GROUP: Record<FlowKey, Group> = { import: "main", export: "main", transship: "main", dg: "main", reefer: "reefer", empty: "empty" };
export type Group = "main" | "reefer" | "empty";
export type StsRule = "mixed" | "per_berth";
export type LengthRule = "max" | "wg185" | "fixed" | "mixed";
export const STS_RULE_LABEL: Record<StsRule, string> = { mixed: "Tàu lớn nhất + (n − 1) × tàu thường gặp", per_berth: "Số bến × STS mỗi bến" };
export const LENGTH_RULE_LABEL: Record<LengthRule, string> = {
  max: "lớn hơn của WG 185 và tàu thiết kế", wg185: "PIANC WG 185 (tuyến bến liền)", fixed: "bến cố định theo tàu thiết kế",
  mixed: "1 bến tàu lớn nhất + bến tàu thường gặp",
};
/** Typical block shape per yard system (set when the system changes in the tab). */
export const SYSTEM_PRESET: Record<YardSystem, { rows: number; bays: number; tiers: number; block_gap_m: number }> = {
  RTG: { rows: 6, bays: 30, tiers: 5, block_gap_m: 6 },
  RMG: { rows: 9, bays: 35, tiers: 5, block_gap_m: 4 },
  ASC: { rows: 10, bays: 40, tiers: 5, block_gap_m: 3 },
};

// footprint (copy of engine geometry/footprint.py)
const SLOT_LENGTH_M = 6.5;
const SLOT_WIDTH_M: Record<string, number> = { RTG: 2.9, RMG: 2.9, ASC: 2.9, SC: 4.0, RS: 2.9, ECH: 2.9 };
const EXTRA_WIDTH_M: Record<string, number> = { RTG: 7.0, RMG: 6.0, ASC: 2.0, SC: 0.0, RS: 0.0, ECH: 0.0 };
export function blockDimensions(system: string, rows: number, bays: number): [number, number] {
  return [bays * SLOT_LENGTH_M, rows * SLOT_WIDTH_M[system] + EXTRA_WIDTH_M[system]];
}

export interface VesselClass { name: string; capacity_teu: number; loa_m: number; beam_m: number; draft_m: number; share: number; sts: number | null }
export interface SizingInputs {
  project: { code: string; name: string; location: string };
  cargo: {
    throughput_teu: number; teu_factor: number; transship_share: number; mix: { import: number; export: number; empty: number };
    reefer_share: number; dg_share: number; dwell_days: Record<FlowKey, number>; peak_factor: number; operating_days: number;
  };
  vessels: { exchange_ratio: number; classes: VesselClass[] };
  berth: {
    gcr_mph: number; efficiency: number; t0_h: number; availability: number; ws_target: number; gap_m: number;
    arrival_control: "none" | "average" | "high"; sts_per_berth: number; sts_moves_year: number; min_berths: number; max_berths: number;
    sts_rule: StsRule; sts_spare: number; length_rule: LengthRule;
  };
  apron: { edge_m: number; rail_span_m: number; backreach_m: number; lanes: number; lane_width_m: number };
  yard: {
    system: YardSystem; rows: number; tiers: number; bays: number; utilization: number; height_ratio: number; block_gap_m: number;
    end_aisle_m: number; road_m: number; rows_per_road: number; transfer_zone_m: number; reefer_tiers: number; empty_tiers: number;
    empty_height_ratio: number; empty_rows: number; empty_aisle_m: number;
  };
  equipment: {
    horizontal: "TT" | "AGV"; horizontal_per_sts: number; yard_per_sts: number; spare: number; ech_moves_year: number;
    boxes_per_truck: number; truck_share: number; peak_hour_factor: number; gate_hours: number; gate_service_in_min: number;
    gate_service_out_min: number;
  };
  land: { back_zone_m: number; margin_m: number; cfs_share: number; reserve_share: number; site_length_m: number | null; site_depth_m: number | null };
  thoresen: { H: number; Bf: number; N: number; L: number; S: number };
}

export const DEFAULTS: SizingInputs = {
  project: { code: "QHSB-01", name: "Quy hoạch sơ bộ", location: "" },
  cargo: {
    throughput_teu: 850000, teu_factor: 1.55, transship_share: 0, mix: { import: 0.45, export: 0.45, empty: 0.1 },
    reefer_share: 0.04, dg_share: 0.01, dwell_days: { import: 6, export: 4.5, transship: 4, empty: 12, reefer: 5, dg: 3 },
    peak_factor: 1.25, operating_days: 365,
  },
  vessels: {
    exchange_ratio: 0.7, classes: [
      { name: "Feeder 600 TEU", capacity_teu: 600, loa_m: 135, beam_m: 20.8, draft_m: 7.6, share: 0.3, sts: 2 },
      { name: "Feeder 1000 TEU", capacity_teu: 1000, loa_m: 158, beam_m: 23.3, draft_m: 8.7, share: 0.4, sts: 2 },
      { name: "Feeder 1300 TEU", capacity_teu: 1300, loa_m: 177, beam_m: 25.4, draft_m: 9.5, share: 0.3, sts: 2 },
    ],
  },
  berth: {
    gcr_mph: 25, efficiency: 0.85, t0_h: 2, availability: 0.95, ws_target: 0.1, gap_m: 20,
    arrival_control: "average", sts_per_berth: 2, sts_moves_year: 100000, min_berths: 1, max_berths: 8,
    sts_rule: "mixed", sts_spare: 0, length_rule: "max",
  },
  apron: { edge_m: 3, rail_span_m: 30.48, backreach_m: 15, lanes: 3, lane_width_m: 3.5 },
  yard: {
    system: "RTG", rows: 6, tiers: 5, bays: 30, utilization: 0.75, height_ratio: 0.8, block_gap_m: 6, end_aisle_m: 25, road_m: 15,
    rows_per_road: 3, transfer_zone_m: 20, reefer_tiers: 4, empty_tiers: 6, empty_height_ratio: 0.9, empty_rows: 6, empty_aisle_m: 17,
  },
  equipment: {
    horizontal: "TT", horizontal_per_sts: 4, yard_per_sts: 2.5, spare: 0.1, ech_moves_year: 60000, boxes_per_truck: 1.2,
    truck_share: 1, peak_hour_factor: 1.8, gate_hours: 24, gate_service_in_min: 4, gate_service_out_min: 3,
  },
  land: { back_zone_m: 80, margin_m: 10, cfs_share: 0, reserve_share: 0.25, site_length_m: null, site_depth_m: null },
  thoresen: { H: 0.7, Bf: 0.07, N: 0.7, L: 1, S: 0.9 },
};

/** [path, min, max, label] – same list as LIMITS of the engine. */
export const LIMITS: [string, number, number, string][] = [
  ["cargo.throughput_teu", 1000, 5e7, "Sản lượng (TEU/năm)"], ["cargo.teu_factor", 1, 2, "Hệ số TEU"],
  ["cargo.transship_share", 0, 0.95, "Tỷ lệ trung chuyển"], ["cargo.reefer_share", 0, 0.5, "Tỷ lệ hàng lạnh"],
  ["cargo.dg_share", 0, 0.3, "Tỷ lệ hàng nguy hiểm"], ["cargo.peak_factor", 1, 3, "Hệ số cao điểm"],
  ["cargo.operating_days", 200, 366, "Số ngày khai thác"],
  ["vessels.exchange_ratio", 0.05, 2, "Tỷ lệ xếp dỡ mỗi chuyến"],
  ["berth.gcr_mph", 5, 60, "Năng suất STS"],
  ["berth.efficiency", 0.3, 1, "Hệ số hiệu quả η"], ["berth.t0_h", 0, 24, "T0"],
  ["berth.availability", 0.5, 1, "A_w"], ["berth.ws_target", 0.01, 1, "W/S mục tiêu"],
  ["berth.gap_m", 0, 100, "Khe hở tàu"], ["berth.sts_per_berth", 1, 12, "STS mỗi bến"],
  ["berth.sts_moves_year", 10000, 400000, "Năng lực năm mỗi STS"],
  ["berth.min_berths", 1, 20, "Số bến tối thiểu"], ["berth.max_berths", 1, 20, "Số bến tối đa"],
  ["berth.sts_spare", 0, 20, "STS dự phòng"],
  ["apron.edge_m", 0, 20, "Khoảng mép bến–ray"], ["apron.rail_span_m", 0, 60, "Khẩu độ ray"],
  ["apron.backreach_m", 0, 60, "Back-reach"], ["apron.lanes", 0, 12, "Số làn sau ray"],
  ["apron.lane_width_m", 2.5, 8, "Bề rộng làn"],
  ["yard.rows", 2, 14, "Số hàng/khối"], ["yard.tiers", 2, 7, "Số tầng"], ["yard.bays", 5, 80, "Số bay/khối"],
  ["yard.utilization", 0.4, 0.95, "Hệ số sử dụng ô u"], ["yard.height_ratio", 0.5, 1, "Tỷ lệ chiều cao H"],
  ["yard.block_gap_m", 0, 30, "Khe giữa khối"], ["yard.end_aisle_m", 0, 60, "Lối đầu khối"],
  ["yard.road_m", 0, 40, "Đường nội bộ"], ["yard.rows_per_road", 1, 20, "Số dãy khối giữa hai đường"],
  ["yard.transfer_zone_m", 0, 60, "Vùng giao nhận"], ["yard.reefer_tiers", 1, 6, "Tầng hàng lạnh"],
  ["yard.empty_tiers", 1, 8, "Tầng hàng rỗng"], ["yard.empty_height_ratio", 0.5, 1, "H bãi rỗng"],
  ["yard.empty_rows", 2, 12, "Số hàng/khối rỗng"], ["yard.empty_aisle_m", 0, 40, "Lối giữa khối rỗng"],
  ["equipment.horizontal_per_sts", 1, 10, "Xe ngang/STS"], ["equipment.yard_per_sts", 1, 6, "Cẩu bãi/STS"],
  ["equipment.spare", 0, 0.5, "Dự phòng thiết bị"], ["equipment.ech_moves_year", 5000, 200000, "Năng lực xe nâng rỗng"],
  ["equipment.boxes_per_truck", 1, 2, "Cont/lượt xe"], ["equipment.truck_share", 0, 1, "Tỷ lệ đường bộ"],
  ["equipment.peak_hour_factor", 1, 4, "Hệ số giờ cao điểm"], ["equipment.gate_hours", 4, 24, "Giờ mở cổng"],
  ["equipment.gate_service_in_min", 0.5, 30, "Phục vụ cổng vào"], ["equipment.gate_service_out_min", 0.5, 30, "Phục vụ cổng ra"],
  ["land.back_zone_m", 20, 400, "Dải cổng + nhà"], ["land.margin_m", 0, 100, "Lề hai đầu"],
  ["land.cfs_share", 0, 0.5, "Tỷ lệ CFS"], ["land.reserve_share", 0, 1, "Đất dự phòng"],
  ["thoresen.H", 0.3, 1, "Thoresen H"], ["thoresen.Bf", 0, 0.5, "Thoresen Bf"], ["thoresen.N", 0.3, 1, "Thoresen N"],
  ["thoresen.L", 0.3, 1, "Thoresen L"], ["thoresen.S", 0.3, 1, "Thoresen S"],
];
const INT_KEYS = new Set(["berth.sts_per_berth", "berth.sts_spare", "berth.min_berths", "berth.max_berths", "apron.lanes",
  "yard.rows", "yard.tiers", "yard.bays", "yard.rows_per_road", "yard.reefer_tiers", "yard.empty_tiers", "yard.empty_rows"]);
export const LIMIT_OF: Record<string, [number, number]> = Object.fromEntries(LIMITS.map(([p, lo, hi]) => [p, [lo, hi]]));

export interface Issue { path: string; code: string; message: string }
export class SizingInputError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.issues = issues;
  }
}

// ---------------------------------------------------------------- inputs
function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
function merge(base: any, over: any): any {
  if (isObj(base) && isObj(over)) {
    const out: Record<string, any> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : clone(v);
    return out;
  }
  return over !== null && over !== undefined ? clone(over) : clone(base);
}
export function num(v: unknown): number | null {
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(",", ".");
    if (t === "") return null;
    const f = Number(t);
    return Number.isFinite(f) ? f : null;
  }
  return null;
}
/** Python round(): half to even (same integer as the engine for x.5). */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
const g = (s: number) => String(Number(s.toPrecision(6)));

export function normalize(inputs: unknown): SizingInputs {
  const x = merge(DEFAULTS, isObj(inputs) ? inputs : {}) as any;
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, code: "INVALID", message });
  for (const [path, lo, hi, label] of LIMITS) {
    const [sec, key] = path.split(".");
    const v = num(x[sec]?.[key]);
    if (v === null) { bad(path, `${label}: cần một số`); continue; }
    if (v < lo || v > hi) bad(path, `${label} = ${g(v)} ngoài khoảng ${g(lo)}–${g(hi)}`);
    x[sec][key] = INT_KEYS.has(path) ? roundHalfEven(v) : v;
  }
  const c = x.cargo;
  for (const k of ["import", "export", "empty"] as const) {
    const v = num(c.mix?.[k]);
    if (v === null || v < 0 || v > 1) bad(`cargo.mix.${k}`, `Tỷ lệ ${FLOW_LABEL[k].toLowerCase()} phải trong 0–1`);
    else c.mix[k] = v;
  }
  if (!issues.length && Math.abs(c.mix.import + c.mix.export + c.mix.empty - 1) > 1e-3) bad("cargo.mix", "Tỷ lệ nhập + xuất + rỗng phải bằng 1");
  for (const k of Object.keys(FLOW_LABEL) as FlowKey[]) {
    const v = num(c.dwell_days?.[k]);
    if (v === null || v <= 0 || v > 90) bad(`cargo.dwell_days.${k}`, `Ngày lưu bãi ${FLOW_LABEL[k].toLowerCase()} phải trong (0, 90]`);
    else c.dwell_days[k] = v;
  }
  if (num(c.reefer_share) !== null && num(c.dg_share) !== null && c.reefer_share + c.dg_share > 0.8) {
    bad("cargo.reefer_share", "Hàng lạnh + nguy hiểm quá lớn so với hàng có hàng");
  }
  let classes: any[] = x.vessels.classes || [];
  if (!Array.isArray(classes) || !classes.length) { bad("vessels.classes", "Cần ít nhất một lớp tàu"); classes = []; }
  else if (classes.length > 20) { bad("vessels.classes", "Tối đa 20 lớp tàu"); classes = classes.slice(0, 20); }
  const clean: VesselClass[] = [];
  classes.forEach((v0, i) => {
    const v = isObj(v0) ? v0 : {};
    const row: any = { name: String(v.name || `Tàu ${i + 1}`).slice(0, 80) };
    for (const [k, lo, hi] of [["capacity_teu", 50, 30000], ["loa_m", 30, 450], ["beam_m", 5, 70], ["draft_m", 2, 25], ["share", 0, 1]] as [string, number, number][]) {
      const n = num(v[k]);
      if (n === null || n < lo || n > hi) bad(`vessels.classes.${i}.${k}`, `${row.name}: ${k} phải trong ${g(lo)}–${g(hi)}`);
      row[k] = n !== null ? n : 0;
    }
    const st = v.sts;
    if (st === null || st === undefined || st === "") row.sts = null;
    else {
      const ns = num(st);
      if (ns === null || ns < 1 || ns > 12) { bad(`vessels.classes.${i}.sts`, `${row.name}: STS/tàu phải trong 1–12`); row.sts = null; }
      else row.sts = roundHalfEven(ns);
    }
    clean.push(row);
  });
  x.vessels.classes = clean;
  if (clean.length && !issues.length && clean.reduce((s, v) => s + v.share, 0) <= 0) bad("vessels.classes", "Tổng tỷ lệ chuyến của các lớp tàu phải > 0");
  if (!SYSTEMS.includes(x.yard.system)) bad("yard.system", "Hệ bãi phải là RTG, RMG hoặc ASC");
  if (!["TT", "AGV"].includes(x.equipment.horizontal)) bad("equipment.horizontal", "Thiết bị vận chuyển ngang phải là TT hoặc AGV");
  if (!["mixed", "per_berth"].includes(x.berth.sts_rule)) bad("berth.sts_rule", "Cách tính số STS: mixed hoặc per_berth");
  if (!["max", "wg185", "fixed", "mixed"].includes(x.berth.length_rule)) bad("berth.length_rule", "Cách tính chiều dài bến: max, wg185, fixed hoặc mixed");
  if (!(x.berth.arrival_control in ARRIVAL)) bad("berth.arrival_control", "Mức kiểm soát giờ tàu: none, average hoặc high");
  if (!issues.length && x.berth.min_berths > x.berth.max_berths) bad("berth.min_berths", "Số bến tối thiểu lớn hơn tối đa");
  for (const k of ["site_length_m", "site_depth_m"]) {
    const v = x.land[k];
    if (v === null || v === undefined || v === "" || v === 0) x.land[k] = null;
    else {
      const n = num(v);
      if (n === null || n < 50 || n > 20000) bad(`land.${k}`, "Ranh đất phải trong 50–20.000 m (để trống nếu chưa có)");
      x.land[k] = n;
    }
  }
  const p = x.project;
  p.code = (String(p.code || "QHSB-01").trim() || "QHSB-01").slice(0, 40);
  p.name = (String(p.name || "Quy hoạch sơ bộ").trim() || "Quy hoạch sơ bộ").slice(0, 200);
  p.location = String(p.location || "").slice(0, 200);
  if (issues.length) throw new SizingInputError(issues);
  for (const v of clean) if (v.sts === null) v.sts = stsForSize(v.capacity_teu);
  return x as SizingInputs;
}

// ---------------------------------------------------------------- queueing
function interp(pts: [number, number][], x: number): number {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x0 <= x && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}
export function erlangC(n: number, a: number): number {
  let term = 1, s = 1;
  for (let k = 1; k < n; k++) { term *= a / k; s += term; }
  const last = term * a / n / (1 - a / n);
  return last / (s + last);
}
/** STS working one vessel when the class gives none (V1.7.4), by vessel size. */
export function stsForSize(capacityTeu: number): number {
  for (const [cap, sts] of [[500, 1], [1700, 2], [3500, 3], [7100, 4], [12000, 5]]) if (capacityTeu <= cap) return sts;
  return 6;
}
export function wsRatio(n: number, rho: number, control = "average"): number {
  return ARRIVAL_WS_FACTOR[control] * wsE2(n, rho);
}
function wsE2(n: number, rho: number): number {
  if (rho <= 0) return 0;
  if (rho >= 1) return Infinity;
  const t = WS_TABLE[n];
  if (t) {
    if (rho <= 0.9) return interp(t, rho);
    return t[t.length - 1][1] * (erlangC(n, n * rho) / (1 - rho)) / (erlangC(n, n * 0.9) / 0.1);
  }
  return ERLANG_FACTOR * erlangC(n, n * rho) / (n * (1 - rho));
}
export function maxOccupancy(n: number, target: number, control = "average"): number {
  let lo = 0, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (wsRatio(n, mid, control) <= target) lo = mid; else hi = mid;
  }
  return lo;
}
export function thoresenLimit(n: number, control: string): number {
  return THORESEN_BOR[Math.min(n, 6)][ARRIVAL[control]];
}
export function aTeu(system: string, rows: number, tiers: number): number {
  if (system === "RS" || system === "ECH") return A_TEU_RS[tiers] ?? 72 / tiers;
  const k = tiers - 1;
  const atK = (kk: number) => {
    const w = Math.min(Math.max(rows, 5), 9);
    const v = A_TEU_GANTRY[kk];
    return interp([[5, v[0]], [7, v[1]], [9, v[2]]], w);
  };
  if (k < 2) return atK(2) * 3 / (k + 1);
  if (k > 5) return atK(5) * 6 / (k + 1);
  return atK(k);
}

// ---------------------------------------------------------------- results
export interface BerthRow { n: number; occupancy: number; ws: number | null; ok: boolean; thoresen_limit: number; thoresen_ok: boolean; occupancy_max: number; capacity_teu: number }
export interface Flow { key: FlowKey; label: string; group: Group; teu_year: number; dwell_days: number; inventory_teu: number; capacity_teu: number; tiers: number; height_ratio: number; ground_slots: number; a_teu_m2: number; area_b_m2: number }
export interface BlockGroup { system: string; rows: number; bays: number; tiers: number; ground_slots: number; slots_per_block: number; blocks: number; block_length_m: number; block_width_m: number; capacity_teu: number }
export interface Equip { category: string; type_code: string; quantity: number; area: string; rule: string; params: Record<string, number> }
export interface Benchmark { key: string; label: string; value: number; low: number; high: number; ok: boolean; reference: string }
export interface PlacedBlock { code: string; group: Group; cx: number; cy: number; length_m: number; width_m: number; rotation_deg: number }
export interface LayoutBerth { code: string; x0: number; x1: number; sts: number; sts_base: number; vessel: string; vessel_loa_m: number; vessel_beam_m: number }
export interface Layout { width_m: number; depth_m: number; apron_m: number; yard_start_m: number; yard_end_m: number; back_m: number; yard_area_m2: number; blocks: PlacedBlock[]; berths: LayoutBerth[]; gap_m: number }
export interface ClassService { name: string; share: number; sts: number; sts_used: number; loa_m: number; moves_per_call: number; service_h: number; calls_year: number; berth_time_share?: number; typical?: boolean }
export interface SizingResult {
  inputs: SizingInputs;
  vessels: { cap_avg_teu: number; loa_mean_m: number; design: VesselClass; typical: VesselClass; call_teu: number; moves_per_call: number; calls_year: number; calls_week: number; classes: ClassService[] };
  berth: { service_h: number; berth_hours: number; available_h: number; table: BerthRow[]; n_berths: number; occupancy: number; ws: number | null; wait_h: number; capacity_teu: number };
  quay: { length_wg185_m: number; length_fixed_m: number; length_mixed_m: number; length_rule: LengthRule; length_m: number; berth_length_m: number; apron_m: number; teu_per_m: number; pocket: { length_tug_m: number; length_no_tug_m: number; width_m: number; depth_m: number } };
  sts: { count: number; by_berth: number; by_throughput: number; spare: number; rule: StsRule; sts_max: number; sts_typical: number; per_berth: number[]; base_per_berth: number[]; moves_year: number; moves_per_sts: number; teu_per_sts: number };
  yard: { system: YardSystem; flows: Flow[]; groups: Record<Group, BlockGroup>; inventory_teu: number; capacity_teu: number; ground_slots: number; blocks: number; area_method_b_m2: number; area_method_a_m2: number; block_area_m2: number; method_diff: number };
  equipment: Equip[];
  gate: { truck_visits_year: number; trucks_per_hour: number; peak_per_hour: number; lanes_in: number; lanes_out: number; peak_hour_share: number };
  areas: { width_m: number; depth_m: number; apron_m2: number; yard_m2: number; back_m2: number; core_m2: number; cfs_m2: number; total_m2: number; reserve_m2: number; with_reserve_m2: number; m2_per_m: number; ha_per_berth: number; stacking_share: number };
  site: { length_m: number | null; depth_m: number | null; fits: boolean };
  benchmarks: Benchmark[];
  warnings: { code: string; message: string }[];
  layout: Layout;
}

const pctS = (v: number) => `${Math.round(v * 100)}%`;
const intS = (v: number) => Math.round(v).toLocaleString("en-US");

export function compute(inputs: unknown): SizingResult {
  const x = normalize(inputs);
  const { cargo: c, vessels: vs, berth: b, apron: ap, yard: y, equipment: eq, land, thoresen: th } = x;
  const warnings: { code: string; message: string }[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });
  const C = c.throughput_teu, fTeu = c.teu_factor;

  // vessels
  const classes = vs.classes;
  const totShare = classes.reduce((s, v) => s + v.share, 0);
  if (Math.abs(totShare - 1) > 1e-3) warn("VESSEL_SHARES", `Tổng tỷ lệ chuyến các lớp tàu = ${totShare.toFixed(2)}; đã chuẩn hoá về 1`);
  const w = classes.map((v) => v.share / totShare);
  let capAvg = 0, loaMean = 0;
  classes.forEach((v, i) => { capAvg += w[i] * v.capacity_teu; });
  classes.forEach((v, i) => { loaMean += w[i] * v.loa_m; });
  let design = classes[0];
  for (const v of classes) if (v.loa_m > design.loa_m || (v.loa_m === design.loa_m && v.capacity_teu > design.capacity_teu)) design = v;
  const callTeu = capAvg * vs.exchange_ratio;
  const movesCall = callTeu / fTeu;
  const callsYear = C / callTeu;
  // service time per class: its own call size and its own number of STS (V1.7.2); rule per_berth caps the STS
  const capSts = b.sts_rule === "per_berth" ? b.sts_per_berth : 99;
  const perClass: ClassService[] = classes.map((v, i) => {
    const m = v.capacity_teu * vs.exchange_ratio / fTeu;
    const used = Math.min(v.sts as number, capSts);
    return { name: v.name, share: w[i], sts: v.sts as number, sts_used: used, loa_m: v.loa_m, moves_per_call: m, service_h: m / (used * b.gcr_mph * b.efficiency) + b.t0_h, calls_year: callsYear * w[i] };
  });
  // "typical" vessel = the class that occupies the berths longest (calls × service time), not simply the most frequent
  let kTyp = 0;
  perClass.forEach((pc, i) => { if (pc.share * pc.service_h > perClass[kTyp].share * perClass[kTyp].service_h) kTyp = i; });
  const typical = classes[kTyp];
  const btTot = perClass.reduce((a, pc) => a + pc.share * pc.service_h, 0);
  perClass.forEach((pc, i) => { pc.berth_time_share = pc.share * pc.service_h / btTot; pc.typical = i === kTyp; });
  const vessels = { cap_avg_teu: capAvg, loa_mean_m: loaMean, design: { ...design }, typical: { ...typical }, call_teu: callTeu, moves_per_call: movesCall, calls_year: callsYear, calls_week: callsYear / 52, classes: perClass };

  // berths
  let serviceH = 0;
  for (const pc of perClass) serviceH += pc.share * pc.service_h;
  const berthHours = callsYear * serviceH;
  const availH = HOURS_YEAR * b.availability;
  const table: BerthRow[] = [];
  let chosen: number | null = null;
  for (let n = 1; n <= Math.max(b.max_berths, 8); n++) {
    const rho = berthHours / (n * availH);
    const ws = wsRatio(n, rho, b.arrival_control);
    const lim = thoresenLimit(n, b.arrival_control);
    const rhoMax = maxOccupancy(n, b.ws_target, b.arrival_control);
    const cap = rhoMax * n * availH / serviceH * callTeu;
    const ok = rho < 1 && ws <= b.ws_target + 1e-12;
    table.push({ n, occupancy: rho, ws: Number.isFinite(ws) ? ws : null, ok, thoresen_limit: lim, thoresen_ok: rho <= lim, occupancy_max: rhoMax, capacity_teu: cap });
    if (chosen === null && ok && b.min_berths <= n && n <= b.max_berths) chosen = n;
  }
  if (chosen === null) {
    chosen = b.max_berths;
    warn("BERTHS_NOT_ENOUGH", `Cả ${b.max_berths} bến vẫn chưa đạt W/S ≤ ${pctS(b.ws_target)}: tăng số bến tối đa, số STS mỗi tàu hoặc năng suất`);
  }
  const row = table[chosen - 1];
  if (chosen === 1) warn("ONE_BERTH", "PIANC 135 khuyến nghị tối thiểu 2 bến ngay giai đoạn đầu");
  if (!row.thoresen_ok) warn("THORESEN_BOR", `Hệ số khai thác ${pctS(row.occupancy)} vượt ngưỡng Thoresen ${pctS(row.thoresen_limit)} cho ${chosen} bến`);
  const berth = { service_h: serviceH, berth_hours: berthHours, available_h: availH, table, n_berths: chosen, occupancy: row.occupancy, ws: row.ws, wait_h: (row.ws || 0) * serviceH, capacity_teu: row.capacity_teu };

  // quay + apron
  const gap = b.gap_m, n = chosen;
  const lqWg = n === 1 ? design.loa_m + 2 * gap : 1.1 * n * (loaMean + gap) + gap;
  const lqFixed = n * design.loa_m + (n + 1) * gap;
  const lqMixed = design.loa_m + (n - 1) * loaMean + (n + 1) * gap;
  const lqRaw = { max: Math.max(lqWg, lqFixed), wg185: lqWg, fixed: lqFixed, mixed: lqMixed }[b.length_rule];
  const lq = Math.ceil(lqRaw / 10) * 10;
  let apronM = ap.edge_m + ap.rail_span_m + ap.backreach_m + ap.lanes * ap.lane_width_m;
  if (y.system === "ASC") apronM = Math.max(apronM, 100);
  const quay = {
    length_wg185_m: lqWg, length_fixed_m: lqFixed, length_mixed_m: lqMixed, length_rule: b.length_rule, length_m: lq, berth_length_m: lq / n, apron_m: apronM, teu_per_m: C / lq,
    pocket: { length_tug_m: 1.25 * design.loa_m, length_no_tug_m: 1.5 * design.loa_m, width_m: 1.25 * design.beam_m, depth_m: design.draft_m * 1.1 },
  };

  // STS
  const movesYear = C / fTeu;
  const stsMax = Math.max(...classes.map((v) => v.sts as number));
  const stsTyp = typical.sts as number;
  let base: number[];
  if (b.sts_rule === "mixed") base = [stsMax, ...Array(n - 1).fill(stsTyp)];
  else {
    base = Array(n).fill(b.sts_per_berth);
    if (stsMax > b.sts_per_berth) warn("STS_PER_BERTH", `Lớp tàu cần ${stsMax} STS nhưng mỗi bến chỉ bố trí ${b.sts_per_berth}: đã tính thời gian làm hàng của tàu đó với ${b.sts_per_berth} STS`);
  }
  const byBerth = base.reduce((a, v) => a + v, 0);
  const byThr = Math.ceil(movesYear / b.sts_moves_year);
  const nSts = Math.max(byBerth, byThr) + b.sts_spare;
  const perBerth = [...base];
  for (let e = 0; e < nSts - byBerth; e++) {
    let k = 0;
    for (let i = 1; i < n; i++) if (perBerth[i] < perBerth[k]) k = i;
    perBerth[k] += 1;
  }
  const sts = { count: nSts, by_berth: byBerth, by_throughput: byThr, spare: b.sts_spare, rule: b.sts_rule, sts_max: stsMax, sts_typical: stsTyp, per_berth: perBerth, base_per_berth: base, moves_year: movesYear, moves_per_sts: movesYear / nSts, teu_per_sts: C / nSts };

  // yard flows
  const ts = c.transship_share;
  const gw = C * (1 - ts);
  const dry = 1 - c.reefer_share - c.dg_share;
  // reefer / DG are shares of the laden boxes (import + export + transhipment), as in ctp_engine.capacity.flows
  const laden = gw * (c.mix.import + c.mix.export) + C * ts / 2;
  const teu: Record<FlowKey, number> = {
    import: gw * c.mix.import * dry, export: gw * c.mix.export * dry, transship: C * ts / 2 * dry,
    dg: laden * c.dg_share, reefer: laden * c.reefer_share, empty: gw * c.mix.empty,
  };
  const sysm = y.system;
  const tiers: Record<Group, number> = { main: y.tiers, reefer: Math.min(y.reefer_tiers, y.tiers), empty: y.empty_tiers };
  const hr: Record<Group, number> = { main: y.height_ratio, reefer: y.height_ratio, empty: y.empty_height_ratio };
  const flows: Flow[] = [];
  const gs: Record<Group, number> = { main: 0, reefer: 0, empty: 0 };
  for (const k of FLOW_KEYS) {
    const grp = FLOW_GROUP[k];
    const inv = teu[k] * c.dwell_days[k] / c.operating_days;
    const capt = inv * c.peak_factor / y.utilization;
    const slots = capt / (tiers[grp] * hr[grp]);
    gs[grp] += slots;
    const a = aTeu(grp === "empty" ? "ECH" : sysm, grp === "empty" ? y.empty_rows : y.rows, tiers[grp]);
    const areaB = teu[k] * c.dwell_days[k] * a * (1 + th.Bf) / (c.operating_days * th.H * th.N * th.L * th.S);
    flows.push({ key: k, label: FLOW_LABEL[k], group: grp, teu_year: teu[k], dwell_days: c.dwell_days[k], inventory_teu: inv, capacity_teu: capt, tiers: tiers[grp], height_ratio: hr[grp], ground_slots: slots, a_teu_m2: a, area_b_m2: areaB });
  }
  const groups = {} as Record<Group, BlockGroup>;
  for (const [grp, sysG, rowsG] of [["main", sysm, y.rows], ["reefer", sysm, y.rows], ["empty", "ECH", y.empty_rows]] as [Group, string, number][]) {
    const per = rowsG * y.bays;
    const nb = gs[grp] > 0 ? Math.ceil(gs[grp] / per - 1e-9) : 0;
    const [L, W] = blockDimensions(sysG, rowsG, y.bays);
    groups[grp] = { system: sysG, rows: rowsG, bays: y.bays, tiers: tiers[grp], ground_slots: gs[grp], slots_per_block: per, blocks: nb, block_length_m: L, block_width_m: W, capacity_teu: nb * per * tiers[grp] };
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const yard = {
    system: sysm, flows, groups, inventory_teu: sum(flows.map((f) => f.inventory_teu)), capacity_teu: sum(flows.map((f) => f.capacity_teu)),
    ground_slots: gs.main + gs.reefer + gs.empty, blocks: groups.main.blocks + groups.reefer.blocks + groups.empty.blocks,
    area_method_b_m2: sum(flows.map((f) => f.area_b_m2)), area_method_a_m2: 0, block_area_m2: 0, method_diff: 0,
  };
  const lay = layout(x, lq, apronM, groups, n, design, typical, loaMean, perBerth, base);
  yard.area_method_a_m2 = lay.yard_area_m2;
  yard.block_area_m2 = sum((["main", "reefer", "empty"] as Group[]).map((k) => groups[k].blocks * groups[k].block_length_m * groups[k].block_width_m));
  yard.method_diff = yard.area_method_b_m2 ? (yard.area_method_a_m2 - yard.area_method_b_m2) / yard.area_method_b_m2 : 0;
  if (Math.abs(yard.method_diff) > 0.3) {
    warn("YARD_METHODS", `Diện tích bãi theo ô nền lệch ${yard.method_diff > 0 ? "+" : ""}${pctS(yard.method_diff)} so với Thoresen (m²/TEU): kiểm tra u, H, chiều cao xếp và các hệ số Thoresen`);
  }

  // equipment
  const spare = 1 + eq.spare;
  const ratio = Math.ceil(nSts * eq.yard_per_sts - 1e-9);
  const gantryBlocks = groups.main.blocks + groups.reefer.blocks;
  let yardNeed: number, rule: string;
  if (sysm === "RTG") { yardNeed = ratio; rule = `${g(eq.yard_per_sts)} RTG/STS`; }
  else if (sysm === "RMG") { yardNeed = Math.max(ratio, gantryBlocks); rule = `max(${g(eq.yard_per_sts)}/STS; 1/khối)`; }
  else { yardNeed = Math.max(ratio, 2 * gantryBlocks); rule = `max(${g(eq.yard_per_sts)}/STS; 2/khối)`; }
  const nYard = Math.ceil(yardNeed * spare - 1e-9);
  const emptyMoves = 2 * teu.empty / fTeu;
  const nEch = teu.empty > 0 ? Math.ceil(Math.max(2, Math.ceil(emptyMoves / eq.ech_moves_year - 1e-9)) * spare - 1e-9) : 0;
  const nHor = Math.ceil(nSts * eq.horizontal_per_sts * spare - 1e-9);
  const hcat = eq.horizontal;
  const sp = pctS(eq.spare);
  const equipment: Equip[] = [
    { category: "STS", type_code: "STS-QHSB", quantity: nSts, area: "Bến", rule: `${b.sts_rule === "mixed" ? `max(${stsMax} + ${n - 1} × ${stsTyp}` : `max(${n} bến × ${b.sts_per_berth}`}; ${intS(movesYear)} cont ÷ ${intS(b.sts_moves_year)})${b.sts_spare ? ` + ${b.sts_spare} dự phòng` : ""}`, params: { productivity_mph: b.gcr_mph, availability: 0.9 } },
    { category: sysm, type_code: `${sysm}-QHSB`, quantity: nYard, area: "Bãi", rule: `${rule} × (1 + ${sp})`, params: { productivity_mph: { RTG: 20, RMG: 22, ASC: 20 }[sysm], availability: 0.9 } },
  ];
  if (nEch) equipment.push({ category: "ECH", type_code: "ECH-QHSB", quantity: nEch, area: "Bãi rỗng", rule: `${intS(emptyMoves)} lượt ÷ ${intS(eq.ech_moves_year)}/xe × (1 + ${sp})`, params: { productivity_mph: 15, availability: 0.9 } });
  equipment.push({
    category: hcat, type_code: `${hcat}-QHSB`, quantity: nHor, area: "Bến – bãi", rule: `${g(eq.horizontal_per_sts)}/STS × (1 + ${sp})`,
    params: hcat === "TT" ? { availability: 0.9, speed_loaded_kmh: 20, speed_empty_kmh: 25, handling_time_min: 4 } : { availability: 0.9, speed_loaded_kmh: 18, speed_empty_kmh: 21, handling_time_min: 3 },
  });

  // gate
  const landBoxes = gw / fTeu * eq.truck_share;
  const trucks = landBoxes / eq.boxes_per_truck;
  const perH = trucks / 2 / (c.operating_days * eq.gate_hours);
  const peakH = perH * eq.peak_hour_factor;
  const lanesIn = trucks > 0 ? Math.ceil(peakH / (60 / eq.gate_service_in_min) - 1e-9) + 1 : 0;
  const lanesOut = trucks > 0 ? Math.ceil(peakH / (60 / eq.gate_service_out_min) - 1e-9) : 0;
  const gate = { truck_visits_year: trucks, trucks_per_hour: perH, peak_per_hour: peakH, lanes_in: Math.max(lanesIn, trucks ? 1 : 0), lanes_out: Math.max(lanesOut, trucks ? 1 : 0), peak_hour_share: eq.peak_hour_factor / eq.gate_hours };

  // areas
  const core = lay.width_m * lay.depth_m;
  const total = core / (1 - land.cfs_share);
  const areas = {
    width_m: lay.width_m, depth_m: lay.depth_m, apron_m2: lay.width_m * apronM, yard_m2: lay.yard_area_m2, back_m2: lay.width_m * lay.back_m,
    core_m2: core, cfs_m2: total - core, total_m2: total, reserve_m2: total * land.reserve_share, with_reserve_m2: total * (1 + land.reserve_share),
    m2_per_m: total / lq, ha_per_berth: total / 1e4 / n, stacking_share: lay.yard_area_m2 / total,
  };
  const site = { length_m: land.site_length_m, depth_m: land.site_depth_m, fits: true };
  if (land.site_length_m && lay.width_m > land.site_length_m + 1e-6) { site.fits = false; warn("SITE_LENGTH", `Chiều dài bến ${intS(lq)} m vượt ranh đất ${intS(land.site_length_m)} m`); }
  if (land.site_depth_m && lay.depth_m > land.site_depth_m + 1e-6) { site.fits = false; warn("SITE_DEPTH", `Chiều sâu cảng ${intS(lay.depth_m)} m vượt ranh đất ${intS(land.site_depth_m)} m`); }

  // benchmarks
  const bm: [string, string, number, number, number, string][] = [
    ["teu_per_m", "TEU/m bến/năm", C / lq, 500, 2500, "Thoresen 500–2.500 (PIANC 135: 1.000–1.400 bến vừa và nhỏ)"],
    ["moves_per_sts", "cont/STS/năm", movesYear / nSts, 20000, 150000, "PIANC 135: 20.000–150.000"],
    ["teu_per_sts", "TEU/STS/năm", C / nSts, 50000, 350000, "Thoresen 50.000–350.000 (TB 110.000)"],
    ["m2_per_m", "m² đất/m bến", areas.m2_per_m, 300, 800, "PIANC 135: 400–500; Thoresen 300–700; cảng nước sâu 560–810"],
    ["ha_per_berth", "ha/bến", areas.ha_per_berth, 10, 100, "Thoresen 10–100"],
    ["teu_per_m2_yard", "TEU/m² bãi/năm", C / Math.max(lay.yard_area_m2, 1), 0.5, 7, "Thoresen 0,5–7 (TB 2)"],
    ["m_quay_per_sts", "m bến/STS", lq / nSts, 60, 150, "WG 208: 90–150 (cảng tự động hoá)"],
  ];
  if (sysm === "ASC" && gantryBlocks) bm.push(["m_quay_per_block", "m bến/khối vuông góc", lq / gantryBlocks, 35, 75, "WG 208: 35–75"]);
  const benchmarks: Benchmark[] = bm.map(([key, label, value, low, high, reference]) => {
    const ok = low <= value && value <= high;
    if (!ok) warn(`BENCH_${key.toUpperCase()}`, `${label} = ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ngoài khoảng tham khảo (${reference})`);
    return { key, label, value, low, high, ok, reference };
  });

  return { inputs: x, vessels, berth, quay, sts, yard, equipment, gate, areas, site, benchmarks, warnings, layout: lay };
}

function berthSegments(x: SizingInputs, lq: number, n: number, design: VesselClass, typical: VesselClass, loaMean: number, sts: number[], stsBase: number[]): LayoutBerth[] {
  const gap = x.berth.gap_m;
  const need = x.berth.length_rule === "mixed" && n > 1 ? [design.loa_m + gap, ...Array(n - 1).fill(loaMean + gap)] : Array(n).fill(1);
  const tot = need.reduce((a: number, v: number) => a + v, 0);
  const out: LayoutBerth[] = [];
  let x0 = 0;
  for (let i = 0; i < n; i++) {
    const x1 = i === n - 1 ? lq : x0 + lq * need[i] / tot;
    const ship = i === 0 ? design : typical;
    out.push({ code: `B${i + 1}`, x0, x1, sts: sts[i], sts_base: stsBase[i], vessel: ship.name, vessel_loa_m: ship.loa_m, vessel_beam_m: ship.beam_m });
    x0 = x1;
  }
  return out;
}

function layout(x: SizingInputs, lq: number, apronM: number, groups: Record<Group, BlockGroup>, nBerths: number, design: VesselClass, typical: VesselClass, loaMean: number, sts: number[], stsBase: number[]): Layout {
  const { yard: y, land, berth: b } = x;
  const width = lq, m = land.margin_m, road = y.road_m;
  const y0 = apronM + road;
  const blocks: PlacedBlock[] = [];
  let cur = y0;
  const prefix: Record<Group, string> = { main: "A", reefer: "R", empty: "E" };
  const seq = (names: Group[]): [Group, string][] => {
    const out: [Group, string][] = [];
    for (const grp of names) for (let i = 0; i < groups[grp].blocks; i++) out.push([grp, `${prefix[grp]}${String(i + 1).padStart(2, "0")}`]);
    return out;
  };
  const placeParallel = (names: Group[], aisleX: number, gapY: number) => {
    const items = seq(names);
    if (!items.length) return;
    const L = groups[names[0]].block_length_m, W = groups[names[0]].block_width_m;
    const perRow = Math.max(1, Math.floor((width - 2 * m + aisleX) / (L + aisleX)));
    const rows = Math.ceil(items.length / perRow);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      if (r && r % y.rows_per_road === 0) cur += road - gapY;
      const inRow = Math.min(perRow, items.length - k);
      const used = inRow * L + (inRow - 1) * aisleX;
      const xs = (width - used) / 2;
      for (let j = 0; j < inRow; j++) {
        const [grp, code] = items[k];
        k += 1;
        blocks.push({ code, group: grp, cx: xs + j * (L + aisleX) + L / 2, cy: cur + W / 2, length_m: L, width_m: W, rotation_deg: 0 });
      }
      cur += W + gapY;
    }
    cur += road - gapY;
  };
  if (y.system === "ASC") {
    const items = seq(["main", "reefer"]);
    if (items.length) {
      const L = groups.main.block_length_m, W = groups.main.block_width_m;
      const pitch = W + y.block_gap_m;
      const perRow = Math.max(1, Math.floor((width - 2 * m + y.block_gap_m) / pitch));
      const depth = L + 2 * y.transfer_zone_m;
      let k = 0;
      for (let r = 0; r < Math.ceil(items.length / perRow); r++) {
        const inRow = Math.min(perRow, items.length - k);
        const used = inRow * W + (inRow - 1) * y.block_gap_m;
        const xs = (width - used) / 2;
        for (let j = 0; j < inRow; j++) {
          const [grp, code] = items[k];
          k += 1;
          blocks.push({ code, group: grp, cx: xs + j * pitch + W / 2, cy: cur + depth / 2, length_m: L, width_m: W, rotation_deg: 90 });
        }
        cur += depth + road;
      }
    }
  } else {
    placeParallel(["main", "reefer"], y.end_aisle_m, y.block_gap_m);
  }
  placeParallel(["empty"], y.end_aisle_m, y.empty_aisle_m);
  const yardEnd = blocks.length ? cur : y0;
  const back = land.back_zone_m;
  return {
    width_m: width, depth_m: yardEnd + back, apron_m: apronM, yard_start_m: y0, yard_end_m: yardEnd, back_m: back,
    yard_area_m2: width * (yardEnd - apronM), blocks,
    berths: berthSegments(x, lq, nBerths, design, typical, loaMean, sts, stsBase),
    gap_m: b.gap_m,
  };
}

/** Safe wrapper for the page: result or the list of input problems. */
export function tryCompute(inputs: unknown): { result: SizingResult | null; issues: Issue[] } {
  try {
    return { result: compute(inputs), issues: [] };
  } catch (e) {
    if (e instanceof SizingInputError) return { result: null, issues: e.issues };
    return { result: null, issues: [{ path: "", code: "INTERNAL", message: String(e) }] };
  }
}

/** Inputs of the tab from ctplanner scenario sections (copy of services/sizing_export.inputs_from_scenario). */
export function inputsFromScenario(sections: Record<string, any>, project?: { code?: string; name?: string; location?: string } | null): Record<string, any> {
  const out: Record<string, any> = {};
  const d = sections.demand || {};
  if (Object.keys(d).length) {
    const cargo: Record<string, any> = {};
    for (const [src, dst] of [["annual_quay_teu", "throughput_teu"], ["teu_factor", "teu_factor"], ["transship_share", "transship_share"], ["peak_factor", "peak_factor"], ["operating_days", "operating_days"]]) {
      if (d[src] !== null && d[src] !== undefined) cargo[dst] = d[src];
    }
    if (d.mix) cargo.mix = Object.fromEntries((["import", "export", "empty"] as const).filter((k) => d.mix[k] !== null && d.mix[k] !== undefined).map((k) => [k, d.mix[k]]));
    const sp = d.special_shares || {};
    if (sp.reefer !== null && sp.reefer !== undefined) cargo.reefer_share = sp.reefer;
    if (sp.dg !== null && sp.dg !== undefined) cargo.dg_share = sp.dg;
    const dw = d.dwell_days || {};
    if (Object.keys(dw).length) cargo.dwell_days = Object.fromEntries(FLOW_KEYS.filter((k) => dw[k] !== null && dw[k] !== undefined).map((k) => [k, dw[k]]));
    out.cargo = cargo;
  }
  const vs: any[] = sections.vessels || [];
  if (vs.length) {
    out.vessels = {
      classes: vs.map((v) => {
        const loa = Number(v.loa_m || 150);
        const cap = v.capacity_teu || Math.max(300, Math.min(18000, (loa - 100) * 13));
        return { name: v.name || "Tàu", capacity_teu: cap, loa_m: v.loa_m, beam_m: v.beam_m || Math.round(loa * 0.145 * 10) / 10,
          draft_m: v.draft_m || Math.round(loa * 0.05 * 10) / 10, share: v.share !== null && v.share !== undefined ? v.share : 1 / vs.length,
          ...(v.max_sts ? { sts: v.max_sts } : {}) };
      }),
    };
    const ex = vs.find((v) => v.exchange_ratio)?.exchange_ratio;
    if (ex) out.vessels.exchange_ratio = ex;
  }
  const q = sections.quay || {};
  const berth: Record<string, any> = {};
  if (q.clearance_m !== null && q.clearance_m !== undefined) berth.gap_m = q.clearance_m;
  if (q.operating_hours_per_year) berth.availability = Math.min(1, Math.max(0.5, q.operating_hours_per_year / HOURS_YEAR));
  if (Object.keys(berth).length) out.berth = berth;
  const gt = sections.gate || {};
  const eqo: Record<string, any> = {};
  for (const [src, dst] of [["service_time_in_min", "gate_service_in_min"], ["service_time_out_min", "gate_service_out_min"], ["boxes_per_truck", "boxes_per_truck"]]) {
    if (gt[src] !== null && gt[src] !== undefined) eqo[dst] = gt[src];
  }
  if (Object.keys(eqo).length) out.equipment = eqo;
  const u = (sections.yard_params || {}).u_max;
  if (typeof u === "number") out.yard = { utilization: u };
  if (project) out.project = Object.fromEntries((["code", "name", "location"] as const).filter((k) => project[k]).map((k) => [k, project[k]]));
  return out;
}

/** Inputs merged with the defaults (no checking), for the form. */
export function withDefaults(inputs: unknown): SizingInputs {
  return merge(DEFAULTS, isObj(inputs) ? inputs : {}) as SizingInputs;
}

/** Read / write a value by its dotted path (form fields). */
export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const out: any = clone(obj);
  const keys = path.split(".");
  let o = out;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
  return out;
}
