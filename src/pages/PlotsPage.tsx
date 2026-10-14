// V1.2: "Plot results" tab – every result of the scenario as charts (capacity, yard plan, simulation) plus a
// comparison of the scenarios of the project, each chart exportable as PNG / CSV; "export all" and print to PDF.
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Run, Scenario } from "../api/types";
import PlotCard, { PLOT_REGISTRY, saveBlob, slug } from "../components/PlotCard";
import { useRuns } from "../components/RunPanel";
import { Button, Card, Empty, Field, inputCls } from "../components/ui";
import { dateTime } from "../lib/format";
import { capacityPlots, comparePlot, simulationPlots, yardPlanPlots, type CompareItem, type SimKpi } from "../lib/plots";
import { useKpiDefs } from "./CapacityPage";
import { useScenario } from "./ScenarioShell";

type Section = "capacity" | "yard_plan" | "simulation" | "compare";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "capacity", label: "Sức chứa & năng lực" }, { key: "yard_plan", label: "Khai thác bãi" },
  { key: "simulation", label: "Mô phỏng" }, { key: "compare", label: "So sánh phương án" },
];

function RunSelect({ label, runs, value, onChange }: { label: string; runs: Run[] | undefined; value: string; onChange: (v: string) => void }) {
  const ok = (runs || []).filter((r) => r.status === "succeeded");
  return (
    <Field label={label}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{ok.length ? "— không dùng —" : "— chưa có lần chạy thành công —"}</option>
        {ok.map((r) => <option key={r.id} value={r.id}>{dateTime(r.created_at)} · {r.input_hash.slice(0, 8)}</option>)}
      </select>
    </Field>
  );
}

function useRunResult(id: string) {
  return useQuery({ queryKey: ["run", id], enabled: !!id, staleTime: 600_000, queryFn: () => api<Run>("GET", `/api/v1/runs/${id}`) });
}
const firstOk = (rs: Run[] | undefined) => rs?.find((r) => r.status === "succeeded")?.id || "";

export default function PlotsPage() {
  const { scenario, project } = useScenario();
  const defs = useKpiDefs();
  const kpiName = (c: string) => defs.data?.find((d) => d.code === c)?.name_vi || c;
  const capRuns = useRuns(scenario.id, "capacity");
  const ypRuns = useRuns(scenario.id, "yard_plan");
  const simRuns = useRuns(scenario.id, "simulation");
  const [capId, setCapId] = useState<string | null>(null);
  const [ypId, setYpId] = useState<string | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const cap = useRunResult(capId ?? firstOk(capRuns.data));
  const yp = useRunResult(ypId ?? firstOk(ypRuns.data));
  const sim = useRunResult(simId ?? firstOk(simRuns.data));
  const [show, setShow] = useState<Record<Section, boolean>>({ capacity: true, yard_plan: true, simulation: true, compare: true });
  const [repKpi, setRepKpi] = useState("SIM_VESSEL_WAIT_H");
  const prefix = `ctplanner_${slug(project.code)}_${slug(scenario.name)}`;

  const capRes = cap.data?.status === "succeeded" ? cap.data.result : null;
  const ypRes = yp.data?.status === "succeeded" ? yp.data.result : null;
  const simRes = sim.data?.status === "succeeded" ? sim.data.result : null;
  const capPlots = useMemo(() => (capRes ? capacityPlots(capRes, simRes) : []), [capRes, simRes]);
  const ypPlots = useMemo(() => (ypRes ? yardPlanPlots(ypRes) : []), [ypRes]);
  const simPlots = useMemo(() => (simRes ? simulationPlots(simRes, repKpi, kpiName) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simRes, repKpi, defs.data]);

  /* ---------------- comparison across the scenarios of the project */
  const [cmpType, setCmpType] = useState<"simulation" | "capacity">("simulation");
  const [cmpKpi, setCmpKpi] = useState("SIM_VESSEL_WAIT_H");
  const scenarios = useQuery({ queryKey: ["scenarios", project.id], queryFn: () => api<Scenario[]>("GET", `/api/v1/projects/${project.id}/scenarios`) });
  const lists = useQueries({ queries: (scenarios.data || []).map((s) => ({
    queryKey: ["runs", s.id, cmpType], queryFn: () => api<Run[]>("GET", `/api/v1/scenarios/${s.id}/runs?run_type=${cmpType}`) })) });
  const latest = (scenarios.data || []).map((s, i) => ({ s, id: firstOk(lists[i]?.data) })).filter((x) => x.id);
  const [excluded, setExcluded] = useState<string[]>([]);
  const details = useQueries({ queries: latest.map((x) => ({ queryKey: ["run", x.id], staleTime: 600_000, queryFn: () => api<Run>("GET", `/api/v1/runs/${x.id}`) })) });
  const cmpReady = details.every((d) => d.data);
  const cmpCodes = useMemo(() => {
    const k = details.find((d) => d.data?.result?.kpis)?.data?.result?.kpis as SimKpi[] | undefined;
    return (k || []).map((x) => x.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmpReady, cmpType, latest.length]);
  useEffect(() => { if (cmpCodes.length && !cmpCodes.includes(cmpKpi)) setCmpKpi(cmpCodes[0]); }, [cmpCodes, cmpKpi]);
  const cmp = useMemo(() => {
    if (!cmpReady || !latest.length) return null;
    const items: CompareItem[] = [];
    let unit = "";
    latest.forEach((x, i) => {
      if (excluded.includes(x.s.id)) return;
      const k = ((details[i].data?.result?.kpis || []) as SimKpi[]).find((q) => q.code === cmpKpi);
      unit = k?.unit || unit;
      items.push({ label: `${x.s.name} v${x.s.version_no}`, value: k?.value ?? null, ci_low: k?.ci_low ?? null, ci_high: k?.ci_high ?? null });
    });
    if (!items.length) return null;
    return comparePlot(`${kpiName(cmpKpi)} – các phương án của dự án ${project.code}`, unit, items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmpReady, cmpKpi, excluded, latest.length, defs.data, cmpType]);

  async function exportAll() {
    const items = [...PLOT_REGISTRY.entries()].filter(([k]) => k.startsWith(`${prefix}:`));
    for (const [k, e] of items) {
      const b = await e.png();
      if (b) saveBlob(b, `${prefix}_${k.split(":")[1]}.png`);
      await new Promise((r) => setTimeout(r, 300));   // browsers block bursts of downloads
    }
  }
  function exportCsvAll() {
    const items = [...PLOT_REGISTRY.entries()].filter(([k]) => k.startsWith(`${prefix}:`));
    const text = items.map(([, e]) => `# ${e.title}\r\n${e.csv().replace(/^﻿/, "")}`).join("\r\n\r\n");
    saveBlob(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), `${prefix}_tat_ca_bieu_do.csv`);
  }

  const simKpis = (simRes?.kpis || []) as SimKpi[];
  const none = !capPlots.length && !ypPlots.length && !simPlots.length;
  return (
    <div className="space-y-3 plots-page">
      <Card title="Biểu đồ kết quả (Plot results)" actions={<span className="flex flex-wrap gap-2 print:hidden">
        <Button variant="secondary" onClick={() => void exportAll()}>Tải tất cả PNG</Button>
        <Button variant="secondary" onClick={exportCsvAll}>Tải dữ liệu CSV</Button>
        <Button variant="secondary" onClick={() => window.print()}>In / lưu PDF</Button>
      </span>}>
        <div className="grid gap-3 print:hidden sm:grid-cols-3">
          <RunSelect label="Lần chạy sức chứa & năng lực" runs={capRuns.data} value={capId ?? firstOk(capRuns.data)} onChange={setCapId} />
          <RunSelect label="Lần chạy kế hoạch khai thác bãi" runs={ypRuns.data} value={ypId ?? firstOk(ypRuns.data)} onChange={setYpId} />
          <RunSelect label="Lần chạy mô phỏng" runs={simRuns.data} value={simId ?? firstOk(simRuns.data)} onChange={setSimId} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm print:hidden">
          {SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-1">
              <input type="checkbox" checked={show[s.key]} onChange={(e) => setShow({ ...show, [s.key]: e.target.checked })} />{s.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Mặc định lấy lần chạy thành công mới nhất của mỗi loại. Chạy tính toán ở các tab Sức chứa & năng lực, Khai thác bãi, Mô phỏng. Mỗi biểu đồ có nút
          PNG (kèm tiêu đề) và CSV (số liệu của biểu đồ); "In / lưu PDF" in toàn bộ trang bằng hộp thoại in của trình duyệt (chọn "Lưu dưới dạng PDF").
        </p>
      </Card>

      {none && !show.compare && <Empty text="Chưa có kết quả để vẽ. Chạy tính toán ở các tab kết quả trước." />}

      {show.capacity && capPlots.length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-navy">Sức chứa & năng lực (tính tĩnh)</h3>
          <div className="grid gap-3 xl:grid-cols-2">{capPlots.map((p) => <PlotCard key={p.id} plot={p} filePrefix={prefix} />)}</div>
        </>
      )}
      {show.yard_plan && ypPlots.length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-navy">Kế hoạch khai thác bãi</h3>
          <div className="grid gap-3 xl:grid-cols-2">{ypPlots.map((p) => <PlotCard key={p.id} plot={p} filePrefix={prefix} />)}</div>
        </>
      )}
      {show.simulation && simPlots.length > 0 && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2 pt-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-navy">Mô phỏng</h3>
            <label className="flex items-center gap-2 text-sm print:hidden">KPI cho biểu đồ replication
              <select className={inputCls} value={repKpi} onChange={(e) => setRepKpi(e.target.value)}>
                {simKpis.map((k) => <option key={k.code} value={k.code}>{kpiName(k.code)}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {simPlots.map((p) => <div key={p.id} className={p.id === "sim-series" ? "xl:col-span-2" : ""}><PlotCard plot={p} filePrefix={prefix} /></div>)}
          </div>
        </>
      )}
      {show.compare && (
        <>
          <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-navy">So sánh các phương án của dự án</h3>
          <Card>
            <div className="grid gap-3 print:hidden sm:grid-cols-3">
              <Field label="Loại kết quả">
                <select className={inputCls} value={cmpType} onChange={(e) => setCmpType(e.target.value as "simulation" | "capacity")}>
                  <option value="simulation">Mô phỏng (có khoảng tin cậy 95%)</option>
                  <option value="capacity">Sức chứa & năng lực</option>
                </select>
              </Field>
              <Field label="KPI">
                <select className={inputCls} value={cmpKpi} onChange={(e) => setCmpKpi(e.target.value)}>
                  {cmpCodes.map((c) => <option key={c} value={c}>{kpiName(c)}</option>)}
                </select>
              </Field>
              <div className="text-sm">
                <span className="font-medium text-slate-700">Phương án (lần chạy mới nhất)</span>
                {latest.map((x) => (
                  <label key={x.s.id} className="flex items-center gap-1">
                    <input type="checkbox" checked={!excluded.includes(x.s.id)}
                      onChange={(e) => setExcluded(e.target.checked ? excluded.filter((i) => i !== x.s.id) : [...excluded, x.s.id])} />
                    {x.s.name} v{x.s.version_no}
                  </label>
                ))}
                {!latest.length && <p className="text-xs text-slate-500">Chưa có phương án nào có lần chạy loại này.</p>}
              </div>
            </div>
          </Card>
          {cmp ? <PlotCard plot={cmp} filePrefix={prefix} /> : latest.length > 0 && <Empty text="Đang tải kết quả các phương án…" />}
        </>
      )}
    </div>
  );
}
