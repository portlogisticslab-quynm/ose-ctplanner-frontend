// V1.4 "Tính từ file": upload a project JSON (exported by ctplanner) and/or the Excel input template, choose what to
// compute, see the result with its charts and download Excel / PDF / JSON. Nothing is stored in the database, so it
// also works on the read-only backup server (Render). Results stay 30 minutes on the server, until reload here.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Run } from "../api/types";
import EquipmentAnimation from "../components/EquipmentAnimation";
import PlotCard, { slug } from "../components/PlotCard";
import { Warnings } from "../components/RunPanel";
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Table } from "../components/ui";
import { fmt } from "../lib/format";
import { capacityPlots, simulationPlots, yardPlanPlots, type SimKpi } from "../lib/plots";
import { useAccess } from "../store/access";
import { can, useAuth } from "../store/auth";
import { previewReport, saveRunJson } from "../store/previews";
import { useKpiDefs } from "./CapacityPage";

type RunType = "capacity" | "yard_plan" | "simulation";
const ENDPOINT: Record<RunType, string> = { capacity: "capacity", yard_plan: "yard-plan", simulation: "simulation" };
const LABEL: Record<RunType, string> = { capacity: "Sức chứa & năng lực", yard_plan: "Kế hoạch khai thác bãi", simulation: "Mô phỏng" };

interface Inspect {
  kind: "json" | "xlsx";
  project: { code: string; name: string; location: string; is_sample: boolean };
  scenarios: { key: string; name: string; version_no: number; status: string | null; objects: number; baseline: boolean }[];
  errors: { sheet: string; row: number | null; col: string; code: string; severity: string; message: string }[];
  error_count: number; warning_count: number;
}

export default function FileRunPage() {
  const user = useAuth((s) => s.user);
  const access = useAccess();
  const defs = useKpiDefs();
  const kpiName = (c: string) => defs.data?.find((d) => d.code === c)?.name_vi || c;
  const [file, setFile] = useState<File | null>(null);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [key, setKey] = useState("");
  const [runType, setRunType] = useState<RunType>("capacity");
  const [applyPeak, setApplyPeak] = useState(true);
  const [sim, setSim] = useState({ horizon_days: 30, warmup_days: 5, replications: 3, seed: 12345, arrival: "poisson", service: "stochastic", travel_mode: "geometry" });
  const [job, setJob] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [repKpi, setRepKpi] = useState("SIM_VESSEL_WAIT_H");

  async function pick(f: File | null) {
    setFile(f); setInfo(null); setJob(null); setErr(null);
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const i = await api<Inspect>("POST", "/api/v1/file-runs/inspect", fd);
      setInfo(i);
      setKey((i.scenarios.find((s) => s.baseline) || i.scenarios[0])?.key || "");
    } catch (e) { setErr(e); }
  }

  async function run() {
    if (!file) return;
    setBusy(true); setErr(null); setJob(null);
    const fd = new FormData();
    fd.append("file", file);
    if (dataFile) fd.append("data_file", dataFile);
    if (key) fd.append("scenario_key", key);
    const options = runType === "simulation" ? sim : runType === "yard_plan" ? { apply_peak: applyPeak } : {};
    fd.append("options", JSON.stringify(options));
    try {
      setJob(await api<Run>("POST", `/api/v1/file-runs/${ENDPOINT[runType]}`, fd));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  // simulation: poll until finished
  const running = job?.status === "running";
  const jobId = job?.id;
  useEffect(() => {
    if (!running || !jobId) return;
    const t = window.setInterval(() => {
      api<Run>("GET", `/api/v1/previews/${jobId}`).then(setJob).catch((e) => { setErr(e); setJob(null); });
    }, 2000);
    return () => window.clearInterval(t);
  }, [running, jobId]);

  async function cancel() {
    if (jobId) try { setJob(await api<Run>("POST", `/api/v1/previews/${jobId}/cancel`)); } catch (e) { setErr(e); }
  }

  const res = job?.status === "succeeded" ? job.result : null;
  const plots = useMemo(() => {
    if (!res || !job) return [];
    if (job.run_type === "capacity") return capacityPlots(res, null);
    if (job.run_type === "yard_plan") return yardPlanPlots(res);
    return simulationPlots(res, repKpi, kpiName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, job?.run_type, repKpi, defs.data]);
  const prefix = `ctplanner_file_${slug(info?.project.code || info?.project.name || "file")}`;
  const kpis = (res?.kpis || []) as SimKpi[];

  if (!user) return <Empty text="Đăng nhập để tính từ file." />;
  if (access.plan !== "pro") {
    return (
      <Card title="Tính từ file">
        <p className="text-sm">Tính năng của bản đầy đủ. <a className="font-semibold text-navy underline" href={access.account_url} target="_blank" rel="noreferrer">Mua gói ctplanner tại Port & Logistics Hub</a>.</p>
      </Card>
    );
  }
  if (!can(user, "admin", "planner", "analyst")) return <Empty text="Cần vai trò Planner / Analyst để chạy tính toán." />;

  return (
    <div className="space-y-3">
      <Card title="Tính từ file (không lưu vào hệ thống)">
        <p className="mb-3 text-sm text-slate-600">
          Tải lên <b>file JSON dự án</b> (nút “Xuất JSON” ở trang dự án) hoặc <b>file Excel mẫu nhập liệu</b> (như tab “Nhập Excel”).
          Có thể thêm một <b>file Excel số liệu</b> để thay các sheet tương ứng của file chính – ví dụ mặt bằng từ JSON (nhập DXF) + lưu lượng,
          thiết bị, tham số từ Excel. Kết quả hiện ngay, tải về Excel / PDF / JSON / PNG / CSV; không ghi vào cơ sở dữ liệu, giữ 30 phút và mất khi tải lại trang.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="File chính: JSON dự án hoặc Excel mẫu (.json, .xlsx)">
            <input className={inputCls} type="file" accept=".json,.xlsx,.xlsm" onChange={(e) => void pick(e.target.files?.[0] || null)} />
          </Field>
          <Field label="File Excel số liệu bổ sung (tuỳ chọn)" hint="Các sheet có dữ liệu sẽ thay phần tương ứng của file chính; sheet trống giữ nguyên">
            <input className={inputCls} type="file" accept=".xlsx,.xlsm" onChange={(e) => { setDataFile(e.target.files?.[0] || null); setJob(null); }} />
          </Field>
        </div>
        {info && (
          <div className="mt-3 space-y-2 text-sm">
            <p>
              <Badge tone="blue">{info.kind === "json" ? "JSON dự án" : "Excel"}</Badge>{" "}
              <b>{info.project.code ? `${info.project.code} – ` : ""}{info.project.name}</b>{info.project.location ? ` · ${info.project.location}` : ""}
              {info.project.is_sample && <> <Badge tone="amber">SAMPLE</Badge></>}
            </p>
            {info.kind === "json" && (
              <Field label="Phương án">
                <select className={inputCls} value={key} onChange={(e) => { setKey(e.target.value); setJob(null); }}>
                  {info.scenarios.map((s) => <option key={s.key} value={s.key}>{s.name} v{s.version_no}{s.baseline ? " (cơ sở)" : ""} · {s.objects} đối tượng mặt bằng</option>)}
                </select>
              </Field>
            )}
            {info.errors.length > 0 && (
              <div>
                <p className={info.error_count ? "text-red-700" : "text-amber-700"}>{info.error_count} lỗi · {info.warning_count} cảnh báo</p>
                <Table head={["Sheet", "Dòng", "Cột", "Mã", "Nội dung"]} rows={info.errors.slice(0, 50).map((e) => [e.sheet, e.row ?? "", e.col, <code className="text-xs">{e.code}</code>, e.message])} />
              </div>
            )}
          </div>
        )}
        {file && (
          <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap gap-4 text-sm">
              {(Object.keys(LABEL) as RunType[]).map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input type="radio" name="rt" checked={runType === t} onChange={() => { setRunType(t); setJob(null); }} />{LABEL[t]}
                </label>
              ))}
            </div>
            {runType === "yard_plan" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyPeak} onChange={(e) => setApplyPeak(e.target.checked)} />Áp dụng hệ số cao điểm</label>
            )}
            {runType === "simulation" && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
                <Field label="Thời gian đo (ngày)"><input className={inputCls} type="number" min={1} max={120} value={sim.horizon_days} onChange={(e) => setSim({ ...sim, horizon_days: Number(e.target.value) })} /></Field>
                <Field label="Warm-up (ngày)"><input className={inputCls} type="number" min={0} value={sim.warmup_days} onChange={(e) => setSim({ ...sim, warmup_days: Number(e.target.value) })} /></Field>
                <Field label="Số replication"><input className={inputCls} type="number" min={1} max={10} value={sim.replications} onChange={(e) => setSim({ ...sim, replications: Number(e.target.value) })} /></Field>
                <Field label="Seed"><input className={inputCls} type="number" min={0} value={sim.seed} onChange={(e) => setSim({ ...sim, seed: Number(e.target.value) })} /></Field>
                <Field label="Tàu đến">
                  <select className={inputCls} value={sim.arrival} onChange={(e) => setSim({ ...sim, arrival: e.target.value })}>
                    <option value="poisson">Ngẫu nhiên (Poisson)</option><option value="deterministic">Đều đặn</option>
                  </select>
                </Field>
                <Field label="Thời gian phục vụ">
                  <select className={inputCls} value={sim.service} onChange={(e) => setSim({ ...sim, service: e.target.value })}>
                    <option value="stochastic">Ngẫu nhiên (Erlang-2)</option><option value="deterministic">Cố định</option>
                  </select>
                </Field>
                <Field label="Quãng đường xe">
                  <select className={inputCls} value={sim.travel_mode} onChange={(e) => setSim({ ...sim, travel_mode: e.target.value })}>
                    <option value="geometry">Theo mặt bằng thực</option><option value="average">Trung bình toàn bãi</option>
                  </select>
                </Field>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || running || (info?.error_count ?? 0) > 0} onClick={() => void run()}>{busy ? "Đang tính…" : `Tính ${LABEL[runType].toLowerCase()}`}</Button>
              {running && <Button variant="danger" onClick={() => void cancel()}>Huỷ</Button>}
              {runType === "simulation" && <span className="text-xs text-slate-500">Tối đa 10 replication / 120 ngày đo / 15 phút; mỗi lúc một mô phỏng trên máy chủ.</span>}
            </div>
            {running && job && (
              <div>
                <div className="h-3 w-full overflow-hidden rounded bg-slate-200"><div className="h-3 bg-navy transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
                <p className="mt-1 text-xs text-slate-500">Đang mô phỏng {(job.progress * 100).toFixed(1)}% – giữ trang này mở</p>
              </div>
            )}
          </div>
        )}
        <div className="mt-2"><ErrorBox error={err} /></div>
      </Card>

      {job && job.status !== "running" && job.status !== "succeeded" && (
        <Card title={`Lần tính ${job.status === "cancelled" ? "đã huỷ" : "lỗi"}`}>
          <Warnings items={((job.error as { issues?: [] })?.issues) || (job.error ? [{ code: "FAILED", message: JSON.stringify(job.error), severity: "error" }] : [])} />
        </Card>
      )}
      {res && job && (
        <>
          <Card title={<span>{LABEL[job.run_type as RunType]} – {job.scenario_version} <Badge tone="amber">tạm – không lưu</Badge></span>} actions={
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void previewReport(job.id, job.run_type, "xlsx").catch(setErr)}>Excel</Button>
              <Button variant="secondary" onClick={() => void previewReport(job.id, job.run_type, "pdf").catch(setErr)}>PDF</Button>
              <Button variant="secondary" onClick={() => saveRunJson(job, `ctplanner_${job.run_type}_tu_file.json`)}>JSON</Button>
            </span>}>
            <p className="text-xs text-slate-500">model {job.model_version} · engine {job.engine_version} · input {job.input_hash.slice(0, 12)} · checksum {job.checksum.slice(0, 12)} · {job.elapsed_s?.toFixed(2)} s</p>
            {res.bottleneck && <p className="mt-1 text-sm">Nút thắt: <Badge tone="red">{String(res.bottleneck)}</Badge>{res.system_capacity_quay_teu ? <> · năng lực hệ thống <b>{fmt(res.system_capacity_quay_teu)} TEU/năm</b></> : null}</p>}
            <div className="mt-2"><Warnings items={res.warnings || []} /></div>
            {(job.params?.snapshot_notes as string[] | undefined)?.map((n, i) => <p key={i} className="mt-1 text-xs text-slate-600">• {n}</p>)}
          </Card>
          <Card title="KPI">
            <Table head={["Chỉ tiêu", "Mã", "Giá trị", "CI 95%", "Đơn vị"]}
              rows={kpis.map((k) => [kpiName(k.code), <code className="text-xs">{k.code}</code>, fmt(k.value, 3),
                k.ci_low !== null && k.ci_low !== undefined && k.ci_high !== null && k.ci_high !== undefined ? `${fmt(k.ci_low, 3)} – ${fmt(k.ci_high, 3)}` : "—", k.unit])} />
          </Card>
          {job.run_type === "simulation" && res.animation_available && (
            <Card title="Hoạt ảnh thiết bị trên mặt bằng">
              <EquipmentAnimation key={job.id} runId={job.id} horizonH={Number(res.options?.horizon_days || 1) * 24}
                frames={res.series || []} blockCodes={(res.block_codes as string[]) || []} />
            </Card>
          )}
          {job.run_type === "simulation" && kpis.length > 0 && (
            <label className="flex items-center gap-2 text-sm">KPI cho biểu đồ replication
              <select className={inputCls} value={repKpi} onChange={(e) => setRepKpi(e.target.value)}>
                {kpis.map((k) => <option key={k.code} value={k.code}>{kpiName(k.code)}</option>)}
              </select>
            </label>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {plots.map((p) => <div key={p.id} className={p.id === "sim-series" ? "xl:col-span-2" : ""}><PlotCard plot={p} filePrefix={prefix} /></div>)}
          </div>
        </>
      )}
    </div>
  );
}
