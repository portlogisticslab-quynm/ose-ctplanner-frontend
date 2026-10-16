import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Line, Rect, Stage, Text } from "react-konva";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, download } from "../api/client";
import type { KpiDef, Layout, Report, Run } from "../api/types";
import { Warnings } from "../components/RunPanel";
import EquipmentAnimation from "../components/EquipmentAnimation";
import { blockOccupancy, HEAT_GRADIENT, heat } from "../lib/occupancy";
import { Badge, Button, Card, Chart, Empty, ErrorBox, Field, inputCls, Table } from "../components/ui";
import { dateTime, fmt, pct } from "../lib/format";
import { isPreviewId, previewReport, saveRunJson, useBackupMode, usePreview, usePreviews } from "../store/previews";
import { bounds, centroid, ringOf, type Pt } from "../lib/geometry";
import { useScenario } from "./ScenarioShell";

interface Frame {
  t_h: number; berths_busy: number; vessels_waiting: number; sts_busy: number; veh_busy: number; veh_queue: number;
  yc_busy: number; yc_queue: number; gate_in_queue: number; inventory_teu: number; yard_occupancy: number | null;
  bo?: number[];   // V0.3.2: occupancy of each block (order: result.block_codes)
}
interface SimKpi { code: string; value: number; unit: string; std: number | null; ci_low: number | null; ci_high: number | null; n: number }

const RES_LABEL: Record<string, string> = { berth: "Bến", sts: "STS", vehicle: "Xe vận chuyển ngang", yard_crane: "Cẩu bãi", gate_in: "Cổng vào", gate_out: "Cổng ra" };
const SERIES: { key: keyof Frame; label: string }[] = [
  { key: "inventory_teu", label: "Tồn bãi (TEU)" }, { key: "berths_busy", label: "Bến bận" },
  { key: "vessels_waiting", label: "Tàu chờ" }, { key: "sts_busy", label: "STS được giao" },
  { key: "veh_busy", label: "Xe bận" }, { key: "veh_queue", label: "Hàng chờ xe" },
  { key: "yc_busy", label: "Cẩu bãi bận" }, { key: "yc_queue", label: "Hàng chờ cẩu bãi" },
  { key: "gate_in_queue", label: "Xe chờ cổng vào" },
];

export function HeatLegend({ perBlock }: { perBlock: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span>Chiếm dụng {perBlock ? "từng block" : "toàn bãi (lần chạy cũ chưa có số liệu từng block)"}:</span>
      <span className="relative inline-block h-3 w-48 rounded" style={{ background: HEAT_GRADIENT }} />
      <span>0%</span><span>· 50%</span><span>· 80%</span><span>· 100% (đỏ)</span><span>· ≥120%</span>
      <span className="text-slate-500">(so với sức chứa khai thác; khung 30 phút, replication 1)</span>
    </div>
  );
}

function Animation({ layout, frames, berths, codes }: { layout: Layout; frames: Frame[]; berths: number; codes: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  useEffect(() => { if (box.current) setW(box.current.clientWidth); }, []);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setI((k) => (k + 1 >= frames.length ? 0 : k + 1)), 1000 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, frames.length]);
  const b = bounds(layout.objects);
  if (!b || !frames.length) return <Empty text="Không có dữ liệu hoạt ảnh" />;
  const h = 420;
  const zoom = Math.min((w - 20) / Math.max(1, b.maxX - b.minX), (h - 20) / Math.max(1, b.maxY - b.minY));
  const f = frames[Math.min(i, frames.length - 1)];
  const occMap = blockOccupancy(f, codes);
  const px = 1 / zoom;
  // berth slots: layout berths, else equal segments of the first quay wall
  const berthPolys = layout.objects.filter((o) => o.object_type === "berth").map((o) => ringOf(o.geom));
  const quay = layout.objects.find((o) => o.object_type === "quay_wall");
  let slots: Pt[][] = berthPolys;
  if (!slots.length && quay) {
    const q = ringOf(quay.geom);
    const [a, c] = [q[0], q[q.length - 1]];
    slots = Array.from({ length: berths }, (_, k) => {
      const t0 = (k + 0.1) / berths, t1 = (k + 0.9) / berths;
      const p0: Pt = [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0];
      const p1: Pt = [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1];
      return [p0, p1, [p1[0], p1[1] - 30], [p0[0], p0[1] - 30]] as Pt[];
    });
  }
  const gate = layout.objects.find((o) => o.object_type === "gate");
  const gc = gate ? centroid(ringOf(gate.geom)) : null;
  return (
    <div ref={box} className="space-y-2">
      <Stage width={w} height={h} x={10 - b.minX * zoom} y={10 - b.minY * zoom + 30 * zoom} scaleX={zoom} scaleY={zoom}>
        <Layer>
          {layout.objects.filter((o) => o.geom.type !== "Point").map((o) => {
            const pts = ringOf(o.geom);
            const isBlock = o.object_type === "yard_block";
            const occ = isBlock ? occMap.get(o.code) ?? f.yard_occupancy : null;
            const c = isBlock ? centroid(pts) : null;
            return (
              <Fragment key={o.code}>
                <Line points={pts.flat()} closed={o.geom.type === "Polygon"} strokeWidth={px}
                  stroke={o.object_type === "boundary" ? "#334155" : "#94A3B8"}
                  fill={isBlock ? heat(occ) : undefined} opacity={isBlock ? 0.9 : 1} />
                {c && occ !== null && occ !== undefined && (
                  <Text x={c[0]} y={c[1]} offsetX={22 * px} offsetY={6 * px} width={44 * px} align="center" fontSize={11 * px}
                    fill="#fff" fontStyle="bold" text={`${o.code} ${Math.round(occ * 100)}%`} />
                )}
              </Fragment>
            );
          })}
          {slots.map((s, k) => (
            <Fragment key={`b${k}`}>
              <Line points={s.flat()} closed stroke="#1E3A8A" strokeWidth={1.5 * px} fill={k < f.berths_busy ? "#1E3A8A" : "#E2E8F0"} />
              {k < f.berths_busy && <Text x={centroid(s)[0]} y={centroid(s)[1]} text="TÀU" fontSize={10 * px} fill="#fff" offsetX={10 * px} offsetY={5 * px} />}
            </Fragment>
          ))}
          {f.vessels_waiting > 0 && slots[0] && (
            <Text x={slots[0][3][0]} y={slots[0][3][1] - 22 * px} fontSize={12 * px} fill="#B91C1C" text={`${f.vessels_waiting} tàu chờ bến`} />
          )}
          {gc && <Rect x={gc[0] - 2 * px} y={gc[1] - 2 * px} width={4 * px} height={4 * px} fill="#0F766E" />}
          {gc && <Text x={gc[0]} y={gc[1] + 6 * px} fontSize={11 * px} fill="#0F766E" text={`chờ cổng: ${f.gate_in_queue}`} />}
        </Layer>
      </Stage>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant="secondary" onClick={() => setPlaying(!playing)}>{playing ? "⏸ Dừng" : "▶ Chạy"}</Button>
        <input className="w-64" type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} />
        <span>giờ {fmt(f.t_h, 1)} (ngày {Math.floor(f.t_h / 24) + 1})</span>
        <label className="flex items-center gap-1">tốc độ
          <select className={inputCls} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 4, 12, 48].map((s) => <option key={s} value={s}>{s} khung/s</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
        <span>Chiếm dụng bãi: <b>{pct(f.yard_occupancy)}</b></span>
        <span>Tồn bãi: <b>{fmt(f.inventory_teu)}</b> TEU</span>
        <span>Bến bận: <b>{f.berths_busy}</b> / {berths}</span>
        <span>STS được giao: <b>{f.sts_busy}</b></span>
        <span>Xe bận: <b>{f.veh_busy}</b> · chờ {f.veh_queue}</span>
        <span>Cẩu bãi bận: <b>{f.yc_busy}</b> · chờ {f.yc_queue}</span>
        <span>Tàu chờ: <b>{f.vessels_waiting}</b></span>
        <span>Xe chờ cổng vào: <b>{f.gate_in_queue}</b></span>
      </div>
      <HeatLegend perBlock={!!f.bo} />
    </div>
  );
}

export default function SimulationPage() {
  const { scenario, canRun } = useScenario();
  const qc = useQueryClient();
  const [form, setForm] = useState({ horizon_days: 30, warmup_days: 5, replications: 5, seed: 12345, arrival: "poisson", service: "stochastic", travel_mode: "geometry" });
  const [selected, setSelected] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [seriesKey, setSeriesKey] = useState<keyof Frame>("inventory_teu");
  const backup = useBackupMode();
  const preview = usePreview(scenario.id, "simulation");
  const putPreview = usePreviews((st) => st.put);
  const runs = useQuery({
    queryKey: ["runs", scenario.id, "simulation"],
    queryFn: () => api<Run[]>("GET", `/api/v1/scenarios/${scenario.id}/runs?run_type=simulation`),
  });
  useEffect(() => {
    if (!selected && preview) setSelected(preview.id);
    else if (!selected && runs.data?.length) setSelected((runs.data.find((r) => r.status === "succeeded") || runs.data[0]).id);
  }, [runs.data, selected, preview]);
  const run = useQuery({
    queryKey: ["run", selected],
    enabled: !!selected,
    queryFn: async () => {
      if (!isPreviewId(selected)) return api<Run>("GET", `/api/v1/runs/${selected}`);
      const r = await api<Run>("GET", `/api/v1/previews/${selected}`);   // V1.3: preview kept in server memory
      putPreview(r);
      return r;
    },
  });
  const active = run.data && (run.data.status === "queued" || run.data.status === "running");
  const refetchRun = run.refetch;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      void refetchRun();
      void qc.invalidateQueries({ queryKey: ["runs", scenario.id, "simulation"] });
    }, 2000);
    return () => window.clearInterval(id);
  }, [active, refetchRun, qc, scenario.id]);
  const layout = useQuery({ queryKey: ["layout-view", scenario.id, scenario.layout_revision], queryFn: () => api<Layout>("GET", `/api/v1/scenarios/${scenario.id}/layout`) });
  const defs = useQuery({ queryKey: ["kpi-defs"], queryFn: () => api<KpiDef[]>("GET", "/api/v1/kpi-definitions"), staleTime: 3_600_000 });
  const defMap = new Map((defs.data || []).map((d) => [d.code, d]));

  async function submit() {
    setErr(null);
    try {
      if (backup) {   // V1.3: read-only backup → preview, not stored
        const p = await api<Run>("POST", `/api/v1/scenarios/${scenario.id}/preview/simulation`, form);
        putPreview(p);
        setSelected(p.id);
        return;
      }
      const r = await api<Run>("POST", `/api/v1/scenarios/${scenario.id}/runs/simulation`, form);
      await qc.invalidateQueries({ queryKey: ["runs", scenario.id, "simulation"] });
      setSelected(r.id);
    } catch (e) { setErr(e); }
  }
  async function cancel() {
    const path = isPreviewId(selected) ? `/api/v1/previews/${selected}/cancel` : `/api/v1/runs/${selected}/cancel`;
    try { await api("POST", path); void run.refetch(); } catch (e) { setErr(e); }
  }
  async function report(format: string) {
    try {
      const rep = await api<Report>("POST", "/api/v1/reports", { run_ids: [selected], format });
      await download(`/api/v1/reports/${rep.id}/download`, `ctplanner_simulation_${selected.slice(0, 8)}.${format}`);
    } catch (e) { setErr(e); }
  }

  const res = run.data?.status === "succeeded" ? run.data.result : null;
  const frames: Frame[] = res?.series || [];
  const util = (res?.utilization || {}) as Record<string, { mean: number; ci_low: number | null; ci_high: number | null }>;
  const utilChart = useMemo(() => ({
    grid: { left: 150, right: 50, top: 10, bottom: 30 },
    xAxis: { type: "value", max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` } },
    yAxis: { type: "category", inverse: true, data: Object.keys(util).map((k) => RES_LABEL[k] || k) },
    series: [{ type: "bar", data: Object.entries(util).map(([k, v]) => ({ value: v.mean, itemStyle: { color: k === res?.bottleneck ? "#B91C1C" : "#17365D" } })),
      label: { show: true, position: "right", formatter: (p: { value: number }) => `${(p.value * 100).toFixed(0)}%` } }],
  }), [util, res?.bottleneck]);
  const tsChart = useMemo(() => ({
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "value", name: "giờ", nameLocation: "middle", nameGap: 25 },
    yAxis: { type: "value" },
    series: [{ type: "line", showSymbol: false, data: frames.map((f) => [f.t_h, f[seriesKey]]), lineStyle: { color: "#17365D" } }],
  }), [frames, seriesKey]);

  return (
    <div className="space-y-3">
      <Card title="Mô phỏng sự kiện rời rạc (tàu – STS – xe – bãi – cổng)">
        {canRun && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Field label="Thời gian đo (ngày)"><input className={inputCls} type="number" min={1} max={400} value={form.horizon_days} onChange={(e) => setForm({ ...form, horizon_days: Number(e.target.value) })} /></Field>
            <Field label="Warm-up (ngày)"><input className={inputCls} type="number" min={0} value={form.warmup_days} onChange={(e) => setForm({ ...form, warmup_days: Number(e.target.value) })} /></Field>
            <Field label="Số replication"><input className={inputCls} type="number" min={1} max={50} value={form.replications} onChange={(e) => setForm({ ...form, replications: Number(e.target.value) })} /></Field>
            <Field label="Seed"><input className={inputCls} type="number" min={0} value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} /></Field>
            <Field label="Tàu đến">
              <select className={inputCls} value={form.arrival} onChange={(e) => setForm({ ...form, arrival: e.target.value })}>
                <option value="poisson">Ngẫu nhiên (Poisson)</option><option value="deterministic">Đều đặn</option>
              </select>
            </Field>
            <Field label="Thời gian phục vụ">
              <select className={inputCls} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
                <option value="stochastic">Ngẫu nhiên (Erlang-2)</option><option value="deterministic">Cố định</option>
              </select>
            </Field>
            <Field label="Quãng đường xe" hint="Thực: theo vị trí bến – block trên mặt bằng (có hoạt ảnh thiết bị)">
              <select className={inputCls} value={form.travel_mode} onChange={(e) => setForm({ ...form, travel_mode: e.target.value })}>
                <option value="geometry">Theo mặt bằng thực (B)</option><option value="average">Trung bình toàn bãi (A, như V0.2)</option>
              </select>
            </Field>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canRun && <Button disabled={!!active} onClick={() => void submit()}>{backup ? "Mô phỏng tạm (không lưu)" : "Gửi mô phỏng"}</Button>}
          <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— chọn lần chạy —</option>
            {preview && <option value={preview.id}>Kết quả tạm (chưa lưu) · {dateTime(preview.created_at)} · seed {preview.seed ?? "—"} · {preview.replications ?? "—"} rep</option>}
            {runs.data?.map((r) => <option key={r.id} value={r.id}>{dateTime(r.created_at)} · {r.status} · seed {r.seed ?? "—"} · {r.replications ?? "—"} rep</option>)}
          </select>
          {run.data && <Badge tone={run.data.status === "succeeded" ? "green" : run.data.status === "failed" ? "red" : run.data.status === "cancelled" ? "amber" : "blue"}>{run.data.status}</Badge>}
          {active && canRun && <Button variant="danger" onClick={() => void cancel()}>Huỷ</Button>}
          {run.data?.preview && <Badge tone="amber">tạm – không lưu</Badge>}
          {res && run.data?.preview && <>
            <Button variant="secondary" onClick={() => void previewReport(selected, "simulation", "xlsx").catch(setErr)}>Excel</Button>
            <Button variant="secondary" onClick={() => void previewReport(selected, "simulation", "pdf").catch(setErr)}>PDF</Button>
            <Button variant="secondary" onClick={() => saveRunJson(run.data as Run, "ctplanner_simulation_tam.json")}>JSON</Button>
          </>}
          {res && !run.data?.preview && <><Button variant="secondary" onClick={() => void report("xlsx")}>Excel</Button><Button variant="secondary" onClick={() => void report("pdf")}>PDF</Button></>}
        </div>
        {active && run.data && (
          <div className="mt-3">
            <div className="h-3 w-full overflow-hidden rounded bg-slate-200"><div className="h-3 bg-navy transition-all" style={{ width: `${Math.round(run.data.progress * 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-500">{run.data.status === "queued" ? "Đang chờ worker…" : `Đang chạy ${(run.data.progress * 100).toFixed(1)}%`}{run.data.preview ? " · tính tạm trên máy chủ dự phòng, giữ trang này mở" : ""}</p>
          </div>
        )}
        {run.data && <p className="mt-2 text-xs text-slate-500">model {run.data.model_version} · engine {run.data.engine_version} · input {run.data.input_hash.slice(0, 12)} · checksum {run.data.checksum.slice(0, 12) || "—"} · {run.data.elapsed_s ? `${run.data.elapsed_s.toFixed(1)} s` : ""}</p>}
        {backup && canRun && (
          <p className="mt-2 text-xs text-amber-800">
            Máy chủ dự phòng (chỉ đọc): mô phỏng tạm chạy trên dữ liệu đồng bộ gần nhất, tối đa 10 replication / 120 ngày đo / 15 phút,
            mỗi lúc một mô phỏng; máy chủ dự phòng chậm hơn máy nhà nhiều lần – nên thử 1–2 replication, 10–15 ngày đo. Kết quả không lưu vào lịch sử và mất sau 30 phút hoặc khi tải lại trang – tải Excel / PDF / JSON hoặc PNG/CSV ở tab Plot results để giữ lại.
          </p>
        )}
        <div className="mt-2"><ErrorBox error={err} /></div>
        {run.data?.status === "failed" && <Warnings items={((run.data.error as { issues?: [] })?.issues) || [{ code: "FAILED", message: JSON.stringify(run.data.error), severity: "error" }]} />}
      </Card>

      {!res ? <Empty text="Chưa có kết quả mô phỏng. Gửi một lần chạy (cần quyền Planner/Analyst)." /> : (
        <>
          {res.animation_available ? (
            <Card title="Hoạt ảnh thiết bị trên mặt bằng">
              <EquipmentAnimation key={selected} runId={selected} horizonH={Number(res.options?.horizon_days || 1) * 24}
                frames={frames} blockCodes={(res.block_codes as string[]) || []} />
              <div className="mt-2"><HeatLegend perBlock={!!frames[0]?.bo} /></div>
            </Card>
          ) : (
            <Card title="Hoạt ảnh thiết bị trên mặt bằng">
              <Empty text="Lần chạy này dùng quãng đường trung bình (hoặc chạy bằng V0.2) nên không có hoạt ảnh thiết bị. Gửi mô phỏng mới với 'Quãng đường xe: Theo mặt bằng thực'." />
            </Card>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Tổng quan bãi theo thời gian">{layout.data ? <Animation layout={layout.data} frames={frames} berths={Number(res.params?.berths || 1)} codes={(res.block_codes as string[]) || []} /> : <Empty text="Đang tải layout…" />}</Card>
            <div className="space-y-3">
              <Card title={<span>Hệ số sử dụng – nút thắt: <Badge tone="red">{RES_LABEL[res.bottleneck] || res.bottleneck}</Badge></span>}>
                <Chart option={utilChart} height={Math.max(180, Object.keys(util).length * 34)} />
              </Card>
              <Card title="Chuỗi thời gian (replication 1)" actions={
                <select className={inputCls} value={seriesKey} onChange={(e) => setSeriesKey(e.target.value as keyof Frame)}>
                  {SERIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>}>
                <Chart option={tsChart} height={240} />
              </Card>
            </div>
          </div>
          <Card title={`KPI (trung bình ${res.options?.replications} replication, khoảng tin cậy 95%)`}>
            <Table head={["Chỉ tiêu", "Trung bình", "CI 95%", "Độ lệch chuẩn", "Đơn vị"]}
              rows={(res.kpis as SimKpi[]).map((k) => [defMap.get(k.code)?.name_vi || k.code, fmt(k.value, 3),
                k.ci_low !== null && k.ci_high !== null ? `${fmt(k.ci_low, 3)} – ${fmt(k.ci_high, 3)}` : "—", fmt(k.std, 3), k.unit])} />
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Cảnh báo & ghi chú">
              <Warnings items={res.warnings} />
              {(res.notes as string[]).map((n, i) => <p key={i} className="mt-1 text-xs text-slate-600">• {n}</p>)}
              {res.sample_defaults_used?.length > 0 && <p className="mt-2 text-xs text-amber-800">SAMPLE: {res.sample_defaults_used.join(", ")}</p>}
            </Card>
            <Card title="Kiểm tra bảo toàn container (theo replication)">
              <Table head={["Seed", "Tồn đầu", "Vào bãi", "Ra bãi", "Tồn cuối", "Thiếu hàng xếp", "Sự kiện"]}
                rows={(res.replications as { seed: number; events: number; conservation: Record<string, number> }[]).map((r) => [
                  r.seed, fmt(r.conservation.initial), fmt(r.conservation.yard_in), fmt(r.conservation.yard_out), fmt(r.conservation.final),
                  r.conservation.load_shortfall, fmt(r.events)])} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
