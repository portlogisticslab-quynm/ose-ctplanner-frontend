// V1.2: chart builders for the "Plot results" tab. Pure functions: run results in, ECharts option + CSV table out.
// Colours: categorical slots in fixed order (identity), cargo classes keep CLASS_COLOR (same as the yard map),
// block occupancy keeps the heat scale of the animation. One y-scale per chart (no dual axes).
import { CLASS_COLOR, CLASS_LABEL } from "./format";
import { heat } from "./occupancy";

export const C = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100", magenta: "#e87ba4", green: "#008300", violet: "#6250d6" };
const SLOTS = [C.blue, C.orange, C.aqua, C.yellow, C.magenta, C.green, C.violet];
const INK = "#0b0b0b", INK2 = "#52514e", GRID = "#e4e3df", REF = "#8a8984", NEUTRAL = "#a8a7a0";

export type Opt = Record<string, unknown>;
export interface Csv { head: string[]; rows: (string | number | null)[][] }
export interface Plot { id: string; title: string; option: Opt; csv: Csv; height?: number; note?: string }

/* ------------------------------------------------------------------ helpers */
const r1 = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pctLabel = (v: number) => `${Math.round(v * 100)}%`;
const axisStyle = {
  axisLine: { lineStyle: { color: REF } }, axisTick: { show: false },
  axisLabel: { color: INK2 }, splitLine: { lineStyle: { color: GRID } }, nameTextStyle: { color: INK2 },
};
const base = (o: Opt): Opt => ({ textStyle: { fontFamily: "inherit", color: INK }, animation: false, ...o });
const refLine = (v: number, label: string, horizontal = false) => ({
  symbol: "none", silent: true, lineStyle: { color: REF, type: "dashed", width: 1 },
  label: { formatter: label, color: INK2, position: horizontal ? "insideEndTop" : "end" },
  data: [horizontal ? { yAxis: v } : { xAxis: v }],
});

/** Vertical error bars (CI) over a category axis. data: [index, low, high]. */
export function errorBars(data: [number, number | null, number | null][]): Opt {
  return {
    type: "custom", name: "Khoảng tin cậy 95%", z: 10, tooltip: { show: false },
    renderItem: (_p: unknown, api: { value(i: number): number; coord(v: number[]): number[] }) => {
      const lo = api.coord([api.value(0), api.value(1)]), hi = api.coord([api.value(0), api.value(2)]);
      const w = 6, st = { stroke: INK, lineWidth: 1.2 };
      return { type: "group", children: [
        { type: "line", shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: st },
        { type: "line", shape: { x1: lo[0] - w, y1: lo[1], x2: lo[0] + w, y2: lo[1] }, style: st },
        { type: "line", shape: { x1: hi[0] - w, y1: hi[1], x2: hi[0] + w, y2: hi[1] }, style: st },
      ] };
    },
    data: data.filter((d) => d[1] !== null && d[2] !== null),
  };
}

export function toCsv(c: Csv): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [c.head, ...c.rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/* ------------------------------------------------------------------ types of results (subset) */
interface Sub { code: string; name_vi: string; utilization: number | null; capacity_quay_teu: number | null; status: string; required?: number | null; available?: number | null }
export interface SimKpi { code: string; value: number; unit: string; ci_low: number | null; ci_high: number | null }
interface UtilCI { mean: number; ci_low: number | null; ci_high: number | null }
interface Frame { t_h: number; berths_busy: number; vessels_waiting: number; sts_busy: number; veh_busy: number; veh_queue: number; yc_busy: number; yc_queue: number; gate_in_queue: number; inventory_teu: number; yard_occupancy: number | null }

const SIM_RES: Record<string, string> = { berth: "Bến", sts: "Cẩu bờ STS", vehicle: "Xe vận chuyển ngang", yard_crane: "Cẩu bãi", gate_in: "Cổng vào", gate_out: "Cổng ra" };
/** static subsystem code → simulated resource */
export function simResourceOf(code: string): string | null {
  if (code === "berth" || code === "sts" || code === "gate_in" || code === "gate_out") return code;
  if (code === "horizontal") return "vehicle";
  if (code.startsWith("yard_eq_")) return "yard_crane";
  return null;
}

/* ------------------------------------------------------------------ capacity */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capacityPlots(cap: any, sim: any | null): Plot[] {
  const subs: Sub[] = cap?.subsystems || [];
  if (!subs.length) return [];
  const out: Plot[] = [];
  const util: Record<string, UtilCI> = sim?.utilization || {};
  const names = subs.map((s) => s.name_vi);
  const stat = subs.map((s) => r1(s.utilization, 4));
  const simv = subs.map((s) => { const k = simResourceOf(s.code); return k && util[k] ? r1(util[k].mean, 4) : null; });
  const hasSim = simv.some((v) => v !== null);
  const series: Opt[] = [{ name: "Tính tĩnh (thiết kế, cao điểm)", type: "bar", data: stat, itemStyle: { color: C.blue, borderRadius: [0, 4, 4, 0] }, barGap: "8%",
    label: { show: true, position: "right", color: INK, formatter: (p: { value: number }) => pctLabel(p.value) }, markLine: refLine(1, "100%") }];
  if (hasSim) series.push({ name: "Mô phỏng (trung bình kỳ đo)", type: "bar", data: simv, itemStyle: { color: C.orange, borderRadius: [0, 4, 4, 0] },
    label: { show: true, position: "right", color: INK, formatter: (p: { value: number | null }) => (p.value === null ? "" : pctLabel(p.value)) } });
  out.push({
    id: "cap-util", title: hasSim ? "Hệ số sử dụng theo phân hệ: tính tĩnh và mô phỏng" : "Hệ số sử dụng theo phân hệ (tính tĩnh)",
    height: Math.max(240, subs.length * (hasSim ? 52 : 34) + 70),
    note: hasSim ? "Tĩnh: nhu cầu cao điểm thiết kế so với năng lực; mô phỏng: thời gian bận trung bình trong kỳ đo. Bãi không có cột mô phỏng (xem biểu đồ chiếm dụng)." : undefined,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => (v === null ? "—" : pctLabel(v)) },
      legend: hasSim ? { bottom: 0, textStyle: { color: INK2 } } : undefined,
      grid: { left: 160, right: 60, top: 10, bottom: hasSim ? 40 : 25 },
      xAxis: { type: "value", ...axisStyle, axisLabel: { color: INK2, formatter: pctLabel } },
      yAxis: { type: "category", inverse: true, data: names, ...axisStyle, splitLine: { show: false } },
      series,
    }),
    csv: { head: ["Phân hệ", "Hệ số sử dụng tĩnh", "Hệ số sử dụng mô phỏng", "Trạng thái", "Cần", "Có"],
      rows: subs.map((s, i) => [s.name_vi, stat[i], simv[i], s.status, s.required ?? null, s.available ?? null]) },
  });

  const Q = cap?.flows?.quay_teu as number;
  const capv = subs.map((s) => (s.capacity_quay_teu !== null && Number.isFinite(s.capacity_quay_teu) ? Math.round(s.capacity_quay_teu as number) : null));
  out.push({
    id: "cap-capacity", title: "Năng lực quy đổi theo bến của từng phân hệ so với nhu cầu",
    height: Math.max(240, subs.length * 34 + 60),
    note: `Năng lực hệ thống = năng lực nhỏ nhất = ${Math.round(cap.system_capacity_quay_teu).toLocaleString("vi-VN")} TEU/năm (nút thắt: ${subs.find((s) => s.code === cap.bottleneck)?.name_vi || cap.bottleneck}).`,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => (v === null ? "—" : `${v.toLocaleString("vi-VN")} TEU/năm`) },
      grid: { left: 160, right: 90, top: 20, bottom: 25 },
      xAxis: { type: "value", name: "TEU/năm", ...axisStyle, axisLabel: { color: INK2, formatter: (v: number) => `${Math.round(v / 1000)}k` } },
      yAxis: { type: "category", inverse: true, data: names, ...axisStyle, splitLine: { show: false } },
      series: [{ type: "bar", name: "Năng lực", data: capv.map((v, i) => ({ value: v, itemStyle: { color: subs[i].code === cap.bottleneck ? C.orange : C.blue, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: INK, formatter: (p: { value: number }) => `${Math.round(p.value / 1000)}k` },
        markLine: refLine(Q, `Nhu cầu ${Math.round(Q / 1000)}k`) }],
    }),
    csv: { head: ["Phân hệ", "Năng lực quy đổi (TEU/năm)", "Nhu cầu (TEU/năm)"], rows: subs.map((s, i) => [s.name_vi, capv[i], Q]) },
  });

  const byClass = Object.entries((cap?.yard?.by_class || {}) as Record<string, Record<string, number>>).filter(([, v]) => v.flow_teu > 0);
  if (byClass.length) {
    const avail = cap.yard.tgs_total as number;
    out.push({
      id: "cap-tgs", title: "Số ô nền (TGS) cần theo loại hàng so với hiện có (F-Y01)",
      height: 200,
      option: base({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => (v === null ? "—" : `${Math.round(v).toLocaleString("vi-VN")} TGS`) },
        legend: { bottom: 0, textStyle: { color: INK2 } },
        grid: { left: 90, right: 40, top: 10, bottom: 45 },
        xAxis: { type: "value", name: "TGS", ...axisStyle },
        yAxis: { type: "category", data: ["Hiện có", "Cần"], ...axisStyle, splitLine: { show: false } },
        series: [
          ...byClass.map(([k, v]) => ({ type: "bar", stack: "need", name: `Cần – ${CLASS_LABEL[k] || k}`, data: [null, r1(v.tgs_required, 1)], itemStyle: { color: CLASS_COLOR[k], borderColor: "#fff", borderWidth: 1 }, barWidth: 26 })),
          { type: "bar", stack: "have", name: "Hiện có", data: [avail, null], itemStyle: { color: NEUTRAL, borderRadius: [0, 4, 4, 0] }, barWidth: 26,
            label: { show: true, position: "right", color: INK, formatter: (p: { value: number | null }) => (p.value ? Math.round(p.value).toLocaleString("vi-VN") : "") } },
        ],
      }),
      csv: { head: ["Loại hàng", "TGS cần", "TGS dành riêng"], rows: [...byClass.map(([k, v]) => [CLASS_LABEL[k] || k, r1(v.tgs_required, 1), v.tgs_dedicated]), ["Tổng hiện có", null, avail]] },
    });
    out.push({
      id: "cap-inventory", title: "Tồn bãi bình quân và cao điểm theo loại hàng",
      height: 260,
      option: base({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${Math.round(v).toLocaleString("vi-VN")} TEU` },
        legend: { bottom: 0, textStyle: { color: INK2 } },
        grid: { left: 60, right: 20, top: 20, bottom: 45 },
        xAxis: { type: "category", data: byClass.map(([k]) => CLASS_LABEL[k] || k), ...axisStyle, splitLine: { show: false } },
        yAxis: { type: "value", name: "TEU", ...axisStyle },
        series: [
          { type: "bar", name: "Bình quân (Q·t/D)", data: byClass.map(([, v]) => r1(v.mean_inventory_teu, 0)), itemStyle: { color: C.blue, borderRadius: [4, 4, 0, 0] } },
          { type: "bar", name: "Cao điểm (× f_p)", data: byClass.map(([, v]) => r1(v.peak_inventory_teu, 0)), itemStyle: { color: C.orange, borderRadius: [4, 4, 0, 0] } },
        ],
      }),
      csv: { head: ["Loại hàng", "Tồn bình quân (TEU)", "Tồn cao điểm (TEU)", "Lưu lượng (TEU/năm)", "Lưu bãi (ngày)"],
        rows: byClass.map(([k, v]) => [CLASS_LABEL[k] || k, r1(v.mean_inventory_teu, 0), r1(v.peak_inventory_teu, 0), v.flow_teu, v.dwell_days]) },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ yard plan */
const DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function yardPlanPlots(yp: any): Plot[] {
  const occ = (yp?.occupancy || []) as { day: number; total_inventory_teu: number; occupancy: number; by_class: Record<string, { inventory_teu: number; capacity_teu: number; occupancy: number | null }> }[];
  if (!occ.length) return [];
  const classes = Object.keys(occ[0].by_class).filter((k) => occ.some((d) => d.by_class[k].inventory_teu > 1e-6));
  const opTeu = yp.yard?.op_teu as number;
  const out: Plot[] = [];
  out.push({
    id: "yp-inventory", title: "Tồn bãi cuối ngày theo loại hàng – tuần điển hình",
    height: 300,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${Math.round(v).toLocaleString("vi-VN")} TEU` },
      legend: { bottom: 0, textStyle: { color: INK2 } },
      grid: { left: 60, right: 90, top: 20, bottom: 45 },
      xAxis: { type: "category", data: occ.map((d) => DAYS[d.day % 7]), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "value", name: "TEU", ...axisStyle },
      series: classes.map((k, i) => ({ type: "bar", stack: "inv", name: CLASS_LABEL[k] || k, data: occ.map((d) => r1(d.by_class[k].inventory_teu, 0)),
        itemStyle: { color: CLASS_COLOR[k], borderColor: "#fff", borderWidth: 1 },
        markLine: i === 0 ? refLine(opTeu, `Sức chứa khai thác ${Math.round(opTeu).toLocaleString("vi-VN")}`, true) : undefined })),
    }),
    csv: { head: ["Ngày", ...classes.map((k) => CLASS_LABEL[k] || k), "Tổng (TEU)", "Chiếm dụng toàn bãi"],
      rows: occ.map((d) => [DAYS[d.day % 7], ...classes.map((k) => r1(d.by_class[k].inventory_teu, 0)), r1(d.total_inventory_teu, 0), r1(d.occupancy, 4)]) },
  });
  const occClasses = classes.filter((k) => occ.some((d) => d.by_class[k].capacity_teu > 0));
  out.push({
    id: "yp-occupancy", title: "Chiếm dụng theo ngày: từng loại hàng và toàn bãi (F-O01)",
    height: 300,
    option: base({
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (v === null ? "—" : pctLabel(v)) },
      legend: { bottom: 0, textStyle: { color: INK2 } },
      grid: { left: 60, right: 50, top: 20, bottom: 45 },
      xAxis: { type: "category", data: occ.map((d) => DAYS[d.day % 7]), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle, axisLabel: { color: INK2, formatter: pctLabel } },
      series: [
        ...occClasses.map((k) => ({ type: "line", name: CLASS_LABEL[k] || k, data: occ.map((d) => r1(d.by_class[k].occupancy, 4)), lineStyle: { width: 2, color: CLASS_COLOR[k] }, itemStyle: { color: CLASS_COLOR[k] }, symbolSize: 8 })),
        { type: "line", name: "Toàn bãi", data: occ.map((d) => r1(d.occupancy, 4)), lineStyle: { width: 2, color: INK, type: "dashed" }, itemStyle: { color: INK }, symbolSize: 8, markLine: refLine(1, "100%", true) },
      ],
    }),
    csv: { head: ["Ngày", ...occClasses.map((k) => CLASS_LABEL[k] || k), "Toàn bãi"], rows: occ.map((d) => [DAYS[d.day % 7], ...occClasses.map((k) => r1(d.by_class[k].occupancy, 4)), r1(d.occupancy, 4)]) },
  });
  const need = (yp.required_op_teu || {}) as Record<string, number>, alloc = (yp.allocated_teu || {}) as Record<string, number>;
  const nc = Object.keys(need).filter((k) => (need[k] || 0) > 1e-6 || (alloc[k] || 0) > 1e-6);
  out.push({
    id: "yp-alloc", title: "Sức chứa khai thác cần và đã phân bổ theo loại hàng",
    height: 260,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${Math.round(v).toLocaleString("vi-VN")} TEU` },
      legend: { bottom: 0, textStyle: { color: INK2 } },
      grid: { left: 60, right: 20, top: 20, bottom: 45 },
      xAxis: { type: "category", data: nc.map((k) => CLASS_LABEL[k] || k), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "value", name: "TEU", ...axisStyle },
      series: [
        { type: "bar", name: "Cần (cao điểm / u)", data: nc.map((k) => r1(need[k], 0)), itemStyle: { color: C.blue, borderRadius: [4, 4, 0, 0] } },
        { type: "bar", name: "Đã phân bổ", data: nc.map((k) => r1(alloc[k], 0)), itemStyle: { color: C.aqua, borderRadius: [4, 4, 0, 0] } },
      ],
    }),
    csv: { head: ["Loại hàng", "Cần (TEU)", "Đã phân bổ (TEU)", "Thiếu (TEU)"], rows: nc.map((k) => [CLASS_LABEL[k] || k, r1(need[k], 0), r1(alloc[k], 0), r1(Math.max(0, (need[k] || 0) - (alloc[k] || 0)), 0)]) },
  });
  const yc = yp.yard_cranes as { by_day: { day: number; moves: number; peak_shift_moves: number; required: number }[]; available: number } | undefined;
  if (yc?.by_day?.length) out.push({
    id: "yp-cranes", title: "Cẩu bãi cần ở ca cao điểm theo ngày so với hiện có",
    height: 240,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 50, right: 80, top: 20, bottom: 30 },
      xAxis: { type: "category", data: yc.by_day.map((d) => DAYS[d.day % 7]), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "value", name: "chiếc", minInterval: 1, ...axisStyle },
      series: [{ type: "bar", name: "Cần", data: yc.by_day.map((d) => d.required), itemStyle: { color: C.blue, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: INK }, markLine: refLine(yc.available, `Hiện có ${yc.available}`, true) }],
    }),
    csv: { head: ["Ngày", "Move/ngày", "Move ca cao điểm", "Cẩu cần", "Cẩu hiện có"], rows: yc.by_day.map((d) => [DAYS[d.day % 7], r1(d.moves, 1), r1(d.peak_shift_moves, 1), d.required, yc.available]) },
  });
  return out;
}

/* ------------------------------------------------------------------ simulation */
const kpiOf = (kpis: SimKpi[], code: string) => kpis.find((k) => k.code === code);

function ciBars(id: string, title: string, unit: string, items: { label: string; k: SimKpi | undefined }[], color: string, note?: string): Plot | null {
  const xs = items.filter((i) => i.k);
  if (!xs.length) return null;
  return {
    id, title, height: 270, note,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => (v === null ? "—" : `${r1(v, 2)} ${unit}`) },
      grid: { left: 60, right: 20, top: 30, bottom: 30 },
      xAxis: { type: "category", data: xs.map((i) => i.label), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "value", name: unit, ...axisStyle },
      series: [
        { type: "bar", name: "Trung bình", data: xs.map((i) => r1(i.k?.value, 3)), barMaxWidth: 60, itemStyle: { color, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "insideTop", color: "#fff", formatter: (p: { value: number }) => `${r1(p.value, 1)}` } },
        errorBars(xs.map((i, j) => [j, i.k?.ci_low ?? null, i.k?.ci_high ?? null])),
      ],
    }),
    csv: { head: ["Chỉ tiêu", `Trung bình (${unit})`, "CI 95% thấp", "CI 95% cao"], rows: xs.map((i) => [i.label, r1(i.k?.value, 3), r1(i.k?.ci_low, 3), r1(i.k?.ci_high, 3)]) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function simulationPlots(sim: any, kpiPick = "SIM_VESSEL_WAIT_H", kpiName = (c: string) => c): Plot[] {
  if (!sim) return [];
  const out: Plot[] = [];
  const frames: Frame[] = sim.series || [];
  const kpis: SimKpi[] = sim.kpis || [];
  const p = sim.params || {};
  const days = frames.map((f) => r1(f.t_h / 24, 3) as number);
  if (frames.length) {
    const panels: { name: string; unit: string; get: (f: Frame) => number | null; ref?: number; pct?: boolean }[] = [
      { name: "Số tàu chờ bến", unit: "tàu", get: (f) => f.vessels_waiting },
      { name: "Hàng chờ xe vận chuyển ngang", unit: "lệnh", get: (f) => f.veh_queue },
      { name: "Hàng chờ cẩu bãi", unit: "lệnh", get: (f) => f.yc_queue },
      { name: "Chiếm dụng bãi so với sức chứa khai thác", unit: "%", get: (f) => (f.yard_occupancy === null ? null : r1(f.yard_occupancy * 100, 1)), ref: 100, pct: true },
    ];
    const n = panels.length, top = 30, gap = 40, h = 120;
    out.push({
      id: "sim-series", title: "Chuỗi thời gian – replication 1 (tàu chờ, hàng chờ, chiếm dụng bãi)",
      height: top + n * h + (n - 1) * gap + 50,
      option: base({
        tooltip: { trigger: "axis" }, axisPointer: { link: [{ xAxisIndex: "all" }] },
        title: panels.map((pn, i) => ({ text: pn.name, left: 55, top: top + i * (h + gap) - 24, textStyle: { fontSize: 12, fontWeight: 600, color: INK } })),
        grid: panels.map((_pn, i) => ({ left: 55, right: 20, top: top + i * (h + gap), height: h })),
        xAxis: panels.map((_pn, i) => ({ type: "value", gridIndex: i, min: 0, max: days.length ? days[days.length - 1] : undefined, ...axisStyle,
          name: i === n - 1 ? "Ngày đo (sau warm-up)" : "", nameLocation: "middle", nameGap: 25, axisLabel: { color: INK2, show: true } })),
        yAxis: panels.map((pn, i) => ({ type: "value", gridIndex: i, name: pn.unit, ...axisStyle, scale: !!pn.pct })),
        series: panels.map((pn, i) => ({ type: "line", name: pn.name, xAxisIndex: i, yAxisIndex: i, showSymbol: false, step: pn.pct ? undefined : "end",
          lineStyle: { width: 1.5, color: C.blue }, itemStyle: { color: C.blue }, data: frames.map((f, j) => [days[j], pn.get(f)]),
          markLine: pn.ref ? refLine(pn.ref, "100%", true) : undefined })),
      }),
      csv: { head: ["Giờ", "Ngày", ...panels.map((pn) => `${pn.name} (${pn.unit})`)], rows: frames.map((f, j) => [f.t_h, days[j], ...panels.map((pn) => pn.get(f))]) },
    });
    const caps: [string, keyof Frame, number][] = [["Bến", "berths_busy", p.berths], ["STS", "sts_busy", p.sts], ["Xe ngang", "veh_busy", p.vehicles], ["Cẩu bãi", "yc_busy", p.yard_cranes]];
    const usable = caps.filter(([, , n2]) => n2 && n2 < 1e5);
    if (usable.length) out.push({
      id: "sim-busy", title: "Tỷ lệ tài nguyên đang bận theo thời gian – replication 1",
      height: 300, note: "Tỷ lệ = số đơn vị bận ÷ tổng số đơn vị (mẫu 30 phút). Cẩu bãi tính cả thời gian di chuyển giữa các block.",
      option: base({
        tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
        legend: { bottom: 0, textStyle: { color: INK2 } },
        grid: { left: 55, right: 20, top: 20, bottom: 60 },
        xAxis: { type: "value", min: 0, name: "Ngày đo", nameLocation: "middle", nameGap: 25, ...axisStyle },
        yAxis: { type: "value", max: 100, name: "%", ...axisStyle },
        series: usable.map(([name, key, n2], i) => ({ type: "line", name, showSymbol: false, lineStyle: { width: 1.5, color: SLOTS[i] }, itemStyle: { color: SLOTS[i] },
          data: frames.map((f, j) => [days[j], r1(((f[key] as number) / n2) * 100, 1)]) })),
      }),
      csv: { head: ["Giờ", ...usable.map(([name, , n2]) => `${name} bận (% của ${n2})`)], rows: frames.map((f) => [f.t_h, ...usable.map(([, key, n2]) => r1(((f[key] as number) / n2) * 100, 1))]) },
    });
    if (p.yard_op_teu) out.push({
      id: "sim-inventory", title: "Tồn bãi theo thời gian so với sức chứa khai thác – replication 1",
      height: 260,
      option: base({
        tooltip: { trigger: "axis", valueFormatter: (v: number) => `${Math.round(v).toLocaleString("vi-VN")} TEU` },
        grid: { left: 65, right: 110, top: 20, bottom: 40 },
        xAxis: { type: "value", min: 0, name: "Ngày đo", nameLocation: "middle", nameGap: 25, ...axisStyle },
        yAxis: { type: "value", name: "TEU", ...axisStyle, scale: true },
        series: [{ type: "line", name: "Tồn bãi", showSymbol: false, lineStyle: { width: 1.5, color: C.blue }, itemStyle: { color: C.blue },
          areaStyle: { color: "rgba(42,120,214,0.08)" }, data: frames.map((f, j) => [days[j], f.inventory_teu]),
          markLine: refLine(p.yard_op_teu, `Sức chứa KT ${Math.round(p.yard_op_teu).toLocaleString("vi-VN")}`, true) }],
      }),
      csv: { head: ["Giờ", "Tồn bãi (TEU)", "Sức chứa khai thác (TEU)"], rows: frames.map((f) => [f.t_h, f.inventory_teu, p.yard_op_teu]) },
    });
  }
  const util: Record<string, UtilCI> = sim.utilization || {};
  const uk = Object.keys(util);
  if (uk.length) out.push({
    id: "sim-util", title: "Hệ số sử dụng tài nguyên (mô phỏng) và khoảng tin cậy 95%",
    height: 280, note: `Nút thắt mô phỏng: ${SIM_RES[sim.bottleneck] || sim.bottleneck || "—"} (hệ số sử dụng trung bình cao nhất).`,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => (v === null ? "—" : pctLabel(v)) },
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      xAxis: { type: "category", data: uk.map((k) => SIM_RES[k] || k), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: 1, ...axisStyle, axisLabel: { color: INK2, formatter: pctLabel } },
      series: [
        { type: "bar", name: "Trung bình", data: uk.map((k) => ({ value: r1(util[k].mean, 4), itemStyle: { color: k === sim.bottleneck ? C.orange : C.blue, borderRadius: [4, 4, 0, 0] } })),
          barMaxWidth: 60, label: { show: true, position: "insideTop", color: "#fff", formatter: (q: { value: number }) => pctLabel(q.value) } },
        errorBars(uk.map((k, j) => [j, util[k].ci_low, util[k].ci_high])),
      ],
    }),
    csv: { head: ["Tài nguyên", "Trung bình", "CI 95% thấp", "CI 95% cao"], rows: uk.map((k) => [SIM_RES[k] || k, r1(util[k].mean, 4), r1(util[k].ci_low, 4), r1(util[k].ci_high, 4)]) },
  });
  const vessel = ciBars("sim-vessel", "Thời gian của tàu (giờ): trung bình 5 replication và khoảng tin cậy 95%", "giờ", [
    { label: "Chờ bến – TB", k: kpiOf(kpis, "SIM_VESSEL_WAIT_H") }, { label: "Chờ bến – P95", k: kpiOf(kpis, "SIM_VESSEL_WAIT_P95_H") },
    { label: "Thời gian ở cảng", k: kpiOf(kpis, "SIM_TURNAROUND_H") }], C.blue);
  if (vessel) out.push(vessel);
  const land = ciBars("sim-landside", "Thời gian phía đất liền và chờ xe (phút)", "phút", [
    { label: "Xe tải ngoài trong cảng – TB", k: kpiOf(kpis, "SIM_TRUCK_TURN_MIN") }, { label: "Xe tải ngoài – P95", k: kpiOf(kpis, "SIM_TRUCK_TURN_P95_MIN") },
    { label: "Chờ cổng vào", k: kpiOf(kpis, "SIM_GATE_WAIT_MIN") }, { label: "STS chờ xe mỗi move", k: kpiOf(kpis, "SIM_QC_WAIT_VEH_MIN") }], C.aqua);
  if (land) out.push(land);
  const gross = kpiOf(kpis, "SIM_GROSS_CRANE_PROD"), berthP = kpiOf(kpis, "SIM_BERTH_PROD");
  if (gross && p.sts_cycle) {
    const nomCrane = 60 / p.sts_cycle, nomBerth = nomCrane * (p.sts_per_vessel || 1);
    const rows: [string, number, string][] = [["Cẩu – danh định (p·A)", nomCrane, NEUTRAL], ["Cẩu – mô phỏng", gross.value, C.blue]];
    if (berthP) rows.push(["Bến – danh định (k·p·A)", nomBerth, NEUTRAL], ["Bến – mô phỏng", berthP.value, C.blue]);
    out.push({
      id: "sim-prod", title: "Năng suất cẩu bờ và bến: danh định so với mô phỏng (move/h)", height: 260,
      note: `k = ${p.sts_per_vessel} STS mỗi tàu. Chênh lệch là thời gian STS chờ xe, tàu chờ cẩu và thao tác cập/rời bến.`,
      option: base({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${r1(v, 1)} move/h` },
        grid: { left: 50, right: 20, top: 30, bottom: 30 },
        xAxis: { type: "category", data: rows.map((r) => r[0]), ...axisStyle, splitLine: { show: false } },
        yAxis: { type: "value", name: "move/h", ...axisStyle },
        series: [{ type: "bar", data: rows.map((r) => ({ value: r1(r[1], 2), itemStyle: { color: r[2], borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 60,
          label: { show: true, position: "top", color: INK, formatter: (q: { value: number }) => `${r1(q.value, 1)}` } }],
      }),
      csv: { head: ["Chỉ tiêu", "move/h"], rows: rows.map((r) => [r[0], r1(r[1], 2)]) },
    });
  }
  const bom = sim.block_occupancy_max as Record<string, number> | undefined;
  if (bom && Object.keys(bom).length) {
    const codes = (sim.block_codes as string[] | undefined) || Object.keys(bom);
    out.push({
      id: "sim-blocks", title: "Chiếm dụng đỉnh của từng block (replication 1)", height: 280,
      note: "Màu theo thang chiếm dụng của hoạt ảnh: xanh 0% → vàng 50% → cam 80% → đỏ 100% → đỏ sẫm ≥ 120%.",
      option: base({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => pctLabel(v) },
        grid: { left: 50, right: 50, top: 25, bottom: 40 },
        xAxis: { type: "category", data: codes, ...axisStyle, splitLine: { show: false }, axisLabel: { color: INK2, interval: 0, rotate: codes.length > 14 ? 45 : 0 } },
        yAxis: { type: "value", min: 0, ...axisStyle, axisLabel: { color: INK2, formatter: pctLabel } },
        series: [{ type: "bar", data: codes.map((c) => ({ value: r1(bom[c], 4), itemStyle: { color: heat(bom[c]), borderRadius: [4, 4, 0, 0] } })),
          label: { show: codes.length <= 16, position: "top", color: INK, formatter: (q: { value: number }) => pctLabel(q.value) }, markLine: refLine(1, "100%", true) }],
      }),
      csv: { head: ["Block", "Chiếm dụng đỉnh"], rows: codes.map((c) => [c, r1(bom[c], 4)]) },
    });
  }
  const reps = (sim.replications || []) as { seed: number; kpis: Record<string, number> }[];
  const sel = kpiOf(kpis, kpiPick);
  if (reps.length && sel) {
    out.push({
      id: "sim-reps", title: `Giá trị từng replication – ${kpiName(kpiPick)}`, height: 260,
      note: "Mỗi điểm là một replication (seed khác nhau); đường đứt là trung bình, vùng tô là khoảng tin cậy 95%.",
      option: base({
        tooltip: { trigger: "item", formatter: (q: { value: [string, number] }) => `seed ${q.value[0]}: ${r1(q.value[1], 3)} ${sel.unit === "-" ? "" : sel.unit}` },
        grid: { left: 60, right: 20, top: 25, bottom: 40 },
        xAxis: { type: "category", data: reps.map((r) => String(r.seed)), name: "seed", nameLocation: "middle", nameGap: 25, ...axisStyle, splitLine: { show: false } },
        yAxis: { type: "value", name: sel.unit === "-" ? "" : sel.unit, ...axisStyle, scale: true },
        series: [{ type: "scatter", symbolSize: 12, itemStyle: { color: C.blue, borderColor: "#fff", borderWidth: 2 },
          data: reps.map((r) => [String(r.seed), r1(r.kpis[kpiPick], 4)]),
          markLine: { symbol: "none", silent: true, lineStyle: { color: INK, type: "dashed" }, label: { formatter: `TB ${r1(sel.value, 2)}`, color: INK2 }, data: [{ yAxis: sel.value }] },
          markArea: sel.ci_low !== null && sel.ci_high !== null ? { silent: true, itemStyle: { color: "rgba(42,120,214,0.10)" }, data: [[{ yAxis: sel.ci_low }, { yAxis: sel.ci_high }]] } : undefined }],
      }),
      csv: { head: ["Seed", kpiPick], rows: reps.map((r) => [r.seed, r1(r.kpis[kpiPick], 6)]) },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ scenario comparison */
export interface CompareItem { label: string; value: number | null; ci_low: number | null; ci_high: number | null }
export function comparePlot(title: string, unit: string, items: CompareItem[]): Plot {
  const pctUnit = unit === "-";
  const fmtv = (v: number) => (pctUnit ? pctLabel(v) : `${r1(v, 1)}`);
  return {
    id: "cmp", title, height: 320,
    option: base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => (v === null ? "—" : `${fmtv(v)} ${pctUnit ? "" : unit}`) },
      grid: { left: 60, right: 20, top: 30, bottom: 70 },
      xAxis: { type: "category", data: items.map((i) => i.label), ...axisStyle, splitLine: { show: false }, axisLabel: { color: INK2, interval: 0, rotate: items.length > 4 ? 20 : 0, width: 140, overflow: "break" } },
      yAxis: { type: "value", name: pctUnit ? "" : unit, ...axisStyle, axisLabel: { color: INK2, formatter: pctUnit ? pctLabel : undefined } },
      series: [
        { type: "bar", name: title, data: items.map((i) => r1(i.value, 4)), barMaxWidth: 70, itemStyle: { color: C.blue, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "insideTop", color: "#fff", formatter: (q: { value: number }) => fmtv(q.value) } },
        errorBars(items.map((i, j) => [j, i.ci_low, i.ci_high])),
      ],
    }),
    csv: { head: ["Phương án / lần chạy", `Giá trị (${unit})`, "CI 95% thấp", "CI 95% cao"], rows: items.map((i) => [i.label, r1(i.value, 4), r1(i.ci_low, 4), r1(i.ci_high, 4)]) },
  };
}
