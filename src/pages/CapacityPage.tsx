import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { KpiDef, Run, Subsystem } from "../api/types";
import RunPanel, { Warnings } from "../components/RunPanel";
import { Badge, Card, Chart, Empty, Table } from "../components/ui";
import { fmt, pct } from "../lib/format";
import { useScenario } from "./ScenarioShell";

export function useKpiDefs() {
  return useQuery({ queryKey: ["kpi-defs"], queryFn: () => api<KpiDef[]>("GET", "/api/v1/kpi-definitions"), staleTime: 3_600_000 });
}

const STATUS_TONE = { ok: "green", near: "amber", over: "red" } as const;

export default function CapacityPage() {
  const { scenario, canRun } = useScenario();
  const [run, setRun] = useState<Run | null>(null);
  const defs = useKpiDefs();
  const res = run?.status === "succeeded" ? run.result : null;
  const subs: Subsystem[] = res?.subsystems || [];

  const chart = useMemo(() => ({
    grid: { left: 140, right: 40, top: 10, bottom: 30 },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` } },
    yAxis: { type: "category" as const, data: subs.map((s) => s.name_vi), inverse: true },
    series: [{
      type: "bar" as const,
      data: subs.map((s) => ({ value: s.utilization ?? 0, itemStyle: { color: s.status === "over" ? "#B91C1C" : s.status === "near" ? "#D97706" : "#17365D" } })),
      label: { show: true, position: "right" as const, formatter: (p: { value: number }) => `${(p.value * 100).toFixed(0)}%` },
      markLine: { symbol: "none", data: [{ xAxis: 1 }], lineStyle: { color: "#B91C1C", type: "dashed" as const } },
    }],
    tooltip: { trigger: "axis" as const },
  }), [subs]);

  const defMap = new Map((defs.data || []).map((d) => [d.code, d]));
  return (
    <div className="space-y-3">
      <Card title="Tính sức chứa và năng lực tĩnh">
        <RunPanel scenarioId={scenario.id} runType="capacity" endpoint="capacity" canRun={canRun} onRun={setRun} />
      </Card>
      {run?.status === "failed" && <Card title="Lần chạy lỗi"><Warnings items={(run.error as { issues?: [] })?.issues || []} /></Card>}
      {!res ? <Empty text="Chưa có kết quả. Bấm “Chạy tính toán” (cần quyền Planner/Analyst)." /> : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title={<span>Cân bằng năng lực – nút thắt: <Badge tone="red">{subs.find((s) => s.code === res.bottleneck)?.name_vi || res.bottleneck}</Badge></span>}>
              <p className="mb-2 text-sm">Năng lực hệ thống (quy đổi theo bến): <b>{fmt(res.system_capacity_quay_teu)} TEU/năm</b> · nhu cầu {fmt(res.flows.quay_teu)} TEU/năm</p>
              <Chart option={chart} height={Math.max(220, subs.length * 34)} />
            </Card>
            <Card title="Phân hệ">
              <Table head={["Phân hệ", "Hệ số sử dụng", "Trạng thái", "Năng lực quy đổi (TEU/năm)", "Cần", "Có"]}
                rows={subs.map((s) => [s.name_vi, pct(s.utilization), <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>, fmt(s.capacity_quay_teu), s.required ?? "—", s.available ?? "—"])} />
            </Card>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Bãi theo loại hàng">
              <Table head={["Loại", "Lưu lượng (TEU/năm)", "Lưu bãi (ngày)", "H khai thác", "TGS cần", "TGS dành riêng"]}
                rows={Object.entries(res.yard.by_class as Record<string, Record<string, number>>).filter(([, v]) => v.flow_teu > 0).map(([k, v]) => [
                  k, fmt(v.flow_teu), fmt(v.dwell_days), fmt(v.h_op), fmt(v.tgs_required, 1), fmt(v.tgs_dedicated),
                ])} />
              <p className="mt-2 text-xs text-slate-500">Tổng TGS cần {fmt(res.yard.tgs_required, 1)} / có {fmt(res.yard.tgs_total)} · sức chứa tĩnh {fmt(res.yard.static_teu)} TEU · khai thác {fmt(res.yard.op_teu)} TEU</p>
            </Card>
            <Card title="Cảnh báo & giả định">
              <Warnings items={res.warnings} />
              {res.sample_defaults_used?.length > 0 && (
                <p className="mt-2 text-xs text-amber-800">Tham số dùng giá trị mặc định SAMPLE: {res.sample_defaults_used.join(", ")}</p>
              )}
              {(run?.params?.snapshot_notes as string[] | undefined)?.map((n, i) => <p key={i} className="mt-1 text-xs text-slate-600">• {n}</p>)}
            </Card>
          </div>
          <Card title="KPI">
            <Table head={["Nhóm", "Mã", "Chỉ tiêu", "Giá trị", "Đơn vị", "Công thức"]}
              rows={(res.kpis as { code: string; value: number; unit: string }[]).map((k) => {
                const d = defMap.get(k.code);
                return [d?.group || "", <code className="text-xs">{k.code}</code>, d?.name_vi || k.code, fmt(k.value, 3), k.unit, <span className="text-xs text-slate-500">{d?.formula}</span>];
              })} />
          </Card>
        </>
      )}
    </div>
  );
}
