import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Line, Stage, Text } from "react-konva";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Layout, Run } from "../api/types";
import RunPanel, { Warnings } from "../components/RunPanel";
import { Card, Chart, Empty, Table } from "../components/ui";
import { CLASS_COLOR, CLASS_LABEL, fmt, pct } from "../lib/format";
import { bounds, centroid, ringOf } from "../lib/geometry";
import { useScenario } from "./ScenarioShell";

const DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
interface Alloc { block: string; cargo_class: string; share: number; op_teu: number; source: string }

function AllocationMap({ layout, allocs }: { layout: Layout; allocs: Alloc[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(700);
  useEffect(() => { if (ref.current) setW(ref.current.clientWidth); }, []);
  const h = 420;
  const b = bounds(layout.objects);
  if (!b) return <Empty text="Layout trống" />;
  const zoom = Math.min((w - 20) / Math.max(1, b.maxX - b.minX), (h - 20) / Math.max(1, b.maxY - b.minY));
  const main = new Map<string, Alloc>();
  for (const a of allocs) if (!main.has(a.block) || a.share > (main.get(a.block) as Alloc).share) main.set(a.block, a);
  return (
    <div ref={ref}>
      <Stage width={w} height={h} x={10 - b.minX * zoom} y={10 - b.minY * zoom} scaleX={zoom} scaleY={zoom}>
        <Layer>
          {layout.objects.filter((o) => o.geom.type !== "Point").map((o) => {
            const pts = ringOf(o.geom);
            const isBlock = o.object_type === "yard_block";
            const a = main.get(o.code);
            const color = isBlock ? (a ? CLASS_COLOR[a.cargo_class] : "#E5E7EB") : "#94A3B8";
            const c = centroid(pts);
            return (
              <Fragment key={o.code}>
                <Line points={pts.flat()} closed={o.geom.type === "Polygon"} stroke={isBlock ? "#334155" : color}
                  strokeWidth={1 / zoom} fill={isBlock ? color : undefined} opacity={isBlock ? 0.85 : 1} />
                {isBlock && <Text x={c[0]} y={c[1]} text={`${o.code}${a && a.share < 0.999 ? ` ${Math.round(a.share * 100)}%` : ""}`}
                  fontSize={10 / zoom} fill="#fff" offsetX={12 / zoom} offsetY={5 / zoom} />}
              </Fragment>
            );
          })}
        </Layer>
      </Stage>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {Object.entries(CLASS_LABEL).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: CLASS_COLOR[k] }} />{v}</span>
        ))}
      </div>
    </div>
  );
}

export default function YardOpsPage() {
  const { scenario, canRun } = useScenario();
  const [run, setRun] = useState<Run | null>(null);
  const [applyPeak, setApplyPeak] = useState(true);
  const layout = useQuery({ queryKey: ["layout-view", scenario.id, scenario.layout_revision], queryFn: () => api<Layout>("GET", `/api/v1/scenarios/${scenario.id}/layout`) });
  const res = run?.status === "succeeded" ? run.result : null;

  const occChart = useMemo(() => {
    if (!res) return null;
    const occ = res.occupancy as { day: number; occupancy: number; by_class: Record<string, { inventory_teu: number }> }[];
    const classes = Object.keys(occ[0]?.by_class || {}).filter((k) => occ.some((d) => d.by_class[k].inventory_teu > 0.01));
    return {
      tooltip: { trigger: "axis" as const },
      legend: { top: 0 },
      grid: { left: 60, right: 60, top: 40, bottom: 30 },
      xAxis: { type: "category" as const, data: occ.map((d) => DAYS[d.day]) },
      yAxis: [{ type: "value" as const, name: "TEU" }, { type: "value" as const, name: "Chiếm dụng", max: 1.2, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` } }],
      series: [
        ...classes.map((k) => ({ name: CLASS_LABEL[k], type: "bar" as const, stack: "inv", data: occ.map((d) => Math.round(d.by_class[k].inventory_teu)), itemStyle: { color: CLASS_COLOR[k] } })),
        { name: "Chiếm dụng toàn bãi", type: "line" as const, yAxisIndex: 1, data: occ.map((d) => Number(d.occupancy.toFixed(3))), itemStyle: { color: "#111827" } },
      ],
    };
  }, [res]);

  return (
    <div className="space-y-3">
      <Card title="Kế hoạch khai thác bãi (tĩnh, tuần điển hình)">
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={applyPeak} onChange={(e) => setApplyPeak(e.target.checked)} /> Tuần thiết kế (nhân hệ số cao điểm)</label>
        <RunPanel scenarioId={scenario.id} runType="yard_plan" endpoint="yard-plan" canRun={canRun} body={{ apply_peak: applyPeak }} onRun={setRun} />
      </Card>
      {run?.status === "failed" && <Card title="Lần chạy lỗi"><Warnings items={(run.error as { issues?: [] })?.issues || []} /></Card>}
      {!res ? <Empty text="Chưa có kết quả kế hoạch bãi." /> : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Phân bổ block theo loại hàng">
              {layout.data ? <AllocationMap layout={layout.data} allocs={res.allocations} /> : <Empty text="Đang tải layout…" />}
            </Card>
            <Card title="Tồn bãi và chiếm dụng theo ngày">
              {occChart && <Chart option={occChart} height={380} />}
            </Card>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Card title="Sức chứa cần / đã phân bổ">
              <Table head={["Loại", "Cần (TEU)", "Đã phân bổ (TEU)", "Đủ"]}
                rows={Object.entries(res.required_op_teu as Record<string, number>).filter(([, v]) => v > 0).map(([k, v]) => [
                  CLASS_LABEL[k], fmt(v), fmt(res.allocated_teu[k]), pct(res.allocated_teu[k] / v),
                ])} />
            </Card>
            <Card title="Ổ cắm lạnh & cẩu bãi">
              <p className="text-sm">Ổ cắm lạnh cần: <b>{res.reefer.plugs_required}</b> / có {res.reefer.plugs_available}</p>
              <p className="text-sm">Cẩu bãi ca cao điểm cần: <b>{res.yard_cranes.peak_required}</b> / có {res.yard_cranes.available}</p>
              <Table head={["Ngày", "Move/ngày", "Move ca cao điểm", "Cẩu cần"]}
                rows={(res.yard_cranes.by_day as { day: number; moves: number; peak_shift_moves: number; required: number }[]).map((d) => [DAYS[d.day], fmt(d.moves), fmt(d.peak_shift_moves), d.required])} />
            </Card>
            <Card title="Cảnh báo">
              <Warnings items={res.warnings} />
              {res.sample_defaults_used?.length > 0 && <p className="mt-2 text-xs text-amber-800">SAMPLE: {res.sample_defaults_used.join(", ")}</p>}
            </Card>
          </div>
          <Card title="Chi tiết phân bổ">
            <Table head={["Block", "Loại hàng", "Tỷ lệ", "TEU khai thác", "Nguồn"]}
              rows={(res.allocations as Alloc[]).map((a) => [a.block, CLASS_LABEL[a.cargo_class], pct(a.share), fmt(a.op_teu), a.source])} />
          </Card>
        </>
      )}
    </div>
  );
}
