import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, download } from "../api/client";
import type { CompareTable, ProjectList, Report, Run, Scenario } from "../api/types";
import { Button, Card, Chart, ErrorBox, Field, inputCls, Table } from "../components/ui";
import { dateTime, fmt } from "../lib/format";

export default function ComparePage() {
  const projects = useQuery({ queryKey: ["projects", ""], queryFn: () => api<ProjectList>("GET", "/api/v1/projects?size=200") });
  const [pid, setPid] = useState("");
  const [runType, setRunType] = useState("capacity");
  const scenarios = useQuery({ queryKey: ["scenarios", pid], enabled: !!pid, queryFn: () => api<Scenario[]>("GET", `/api/v1/projects/${pid}/scenarios`) });
  const runLists = useQueries({
    queries: (scenarios.data || []).map((s) => ({
      queryKey: ["runs", s.id, runType],
      queryFn: () => api<Run[]>("GET", `/api/v1/scenarios/${s.id}/runs?run_type=${runType}`),
    })),
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [table, setTable] = useState<CompareTable | null>(null);
  const [kpi, setKpi] = useState("");
  const [err, setErr] = useState<unknown>(null);

  const candidates = (scenarios.data || []).flatMap((s, i) =>
    (runLists[i]?.data || []).filter((r) => r.status === "succeeded").slice(0, 5).map((r) => ({ s, r })));

  async function compare() {
    setErr(null);
    try {
      const t = await api<CompareTable>("POST", "/api/v1/compare", { run_ids: picked });
      setTable(t);
      setKpi(t.rows.find((r) => r.kpi_code === "S_CAPACITY" || r.kpi_code === "Y_PEAK_OCC")?.kpi_code || t.rows[0]?.kpi_code || "");
    } catch (e) { setErr(e); }
  }
  async function report(format: string) {
    setErr(null);
    try {
      const rep = await api<Report>("POST", "/api/v1/reports", { run_ids: picked, format });
      await download(`/api/v1/reports/${rep.id}/download`, `ctplanner_so_sanh.${format}`);
    } catch (e) { setErr(e); }
  }

  const row = table?.rows.find((r) => r.kpi_code === kpi);
  const chart = useMemo(() => row && table ? {
    grid: { left: 60, right: 20, top: 30, bottom: 60 },
    tooltip: {},
    xAxis: { type: "category", data: table.columns.map((c) => c.label), axisLabel: { interval: 0, rotate: 15 } },
    yAxis: { type: "value", name: row.unit },
    series: [{ type: "bar", data: row.values, itemStyle: { color: "#17365D" }, label: { show: true, position: "top" } }],
  } : null, [row, table]);

  return (
    <div className="space-y-3">
      <Card title="Chọn các lần chạy để so sánh (2–6, cùng loại)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Dự án">
            <select className={inputCls} value={pid} onChange={(e) => { setPid(e.target.value); setPicked([]); setTable(null); }}>
              <option value="">— chọn —</option>
              {projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
            </select>
          </Field>
          <Field label="Loại kết quả">
            <select className={inputCls} value={runType} onChange={(e) => { setRunType(e.target.value); setPicked([]); setTable(null); }}>
              <option value="capacity">Sức chứa & năng lực</option>
              <option value="yard_plan">Kế hoạch bãi</option>
              <option value="simulation">Mô phỏng</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 space-y-1 text-sm">
          {candidates.map(({ s, r }) => (
            <label key={r.id} className="flex items-center gap-2">
              <input type="checkbox" checked={picked.includes(r.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, r.id].slice(0, 6) : picked.filter((x) => x !== r.id))} />
              {s.name} v{s.version_no} · {dateTime(r.created_at)} · {r.input_hash.slice(0, 8)}
            </label>
          ))}
          {pid && !candidates.length && <p className="text-slate-500">Chưa có lần chạy thành công.</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={picked.length < 2} onClick={() => void compare()}>So sánh</Button>
          <Button variant="secondary" disabled={!picked.length} onClick={() => void report("xlsx")}>Báo cáo Excel</Button>
          <Button variant="secondary" disabled={!picked.length} onClick={() => void report("pdf")}>Báo cáo PDF</Button>
        </div>
        <div className="mt-2"><ErrorBox error={err} /></div>
      </Card>
      {table && (
        <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
          <Card title="Bảng so sánh (tỷ lệ so với cột đầu)">
            <Table head={["KPI", "Đơn vị", ...table.columns.map((c) => c.label), ...table.columns.slice(1).map((c) => `÷ ${c.label}`)]}
              rows={table.rows.map((r) => [
                <button className={`text-left ${r.kpi_code === kpi ? "font-semibold text-navy" : ""}`} onClick={() => setKpi(r.kpi_code)}>{r.name_vi}</button>,
                r.unit, ...r.values.map((v) => fmt(v, 3)), ...r.ratio_to_first.slice(1).map((v) => (v === null ? "—" : v.toFixed(3))),
              ])} />
          </Card>
          <Card title={row ? row.name_vi : "Biểu đồ"}>{chart && <Chart option={chart} height={320} />}</Card>
        </div>
      )}
    </div>
  );
}
