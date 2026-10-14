import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, download } from "../api/client";
import type { ImportJob } from "../api/types";
import { Badge, Button, Card, ErrorBox, Table } from "../components/ui";
import { useScenario } from "./ScenarioShell";

export default function ImportPage() {
  const { scenario, editable, readOnlyReason, refetch } = useScenario();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function wrap(f: () => Promise<void>) {
    setBusy(true); setErr(null); setMsg("");
    try { await f(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function loadDemo(layout: "dxf" | "excel") {
    if (!window.confirm("Thay dữ liệu đầu vào, đội thiết bị và mặt bằng của phương án này bằng dữ liệu demo?")) return;
    await wrap(async () => {
      const r = await api<{ sections: number; objects: number; fleet: number; georef_set: boolean }>(
        "POST", `/api/v1/scenarios/${scenario.id}/demo-data?layout=${layout}`);
      refreshAll();
      for (const k of ["layout-view", "georef", "project"]) void qc.invalidateQueries({ queryKey: [k] });
      setMsg(`Đã nạp: ${r.sections} mục dữ liệu, ${r.fleet} loại thiết bị, ${r.objects} đối tượng mặt bằng`
        + (r.georef_set ? "; dự án được gán hệ toạ độ VN-2000 / UTM 48N" : "") + ". Mở tab Mặt bằng 2D / Sức chứa để chạy thử.");
    });
  }

  const refreshAll = () => {
    for (const k of ["inputs", "fleet", "scenario"]) void qc.invalidateQueries({ queryKey: [k, scenario.id] });
    refetch();
  };

  return (
    <div className="space-y-3">
      <Card title="Dữ liệu mẫu (demo)">
        <p className="mb-2 text-sm text-slate-600">
          Nạp ngay số liệu mẫu G1 (nhu cầu, bến, bãi, cổng, chi phí, đội thiết bị) và một mặt bằng vào phương án này để chạy thử.
          Thao tác <b>thay</b> dữ liệu đầu vào, đội thiết bị và mặt bằng hiện có của phương án (chỉ phương án Nháp).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!editable || busy} onClick={() => void loadDemo("dxf")}>Nạp dữ liệu demo + mặt bằng DXF (12 block, VN-2000)</Button>
          <Button variant="secondary" disabled={!editable || busy} onClick={() => void loadDemo("excel")}>Nạp dữ liệu demo + mặt bằng Excel (10 block)</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void wrap(() => download("/api/v1/templates/project.json", "ctplanner_demo_project.json"))}>Tải mẫu JSON (dự án demo)</Button>
          <Button variant="ghost" onClick={() => void wrap(() => download("/api/v1/templates/sample.dxf", "ctp_sample_terminal_vn2000_utm48.dxf"))}>Tải bản vẽ DXF mẫu</Button>
        </div>
        {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      </Card>
      <Card title="Workbook mẫu">
        <p className="mb-2 text-sm text-slate-600">
          Workbook gồm các sheet Metadata, Site, Nautical, VesselClasses, VesselCalls, Demand, Berths, YardBlocks, Roads, Equipment,
          GateProfile, RailCFS, Rules, Costs, Environment. Không đổi tên sheet, tên cột và đơn vị. File mẫu chứa số liệu SAMPLE của cảng G1.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void wrap(() => download("/api/v1/imports/template?sample=true", "ctplanner_template_SAMPLE.xlsx"))}>Tải mẫu có số liệu SAMPLE</Button>
          <Button variant="secondary" onClick={() => void wrap(() => download("/api/v1/imports/template?sample=false", "ctplanner_template_trong.xlsx"))}>Tải mẫu trống</Button>
        </div>
      </Card>
      {editable ? (
        <Card title="Nhập dữ liệu (Upload → Kiểm tra → Ghi)">
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button disabled={!file || busy} onClick={() => void wrap(async () => {
              const fd = new FormData();
              fd.append("file", file as File);
              setJob(await api<ImportJob>("POST", `/api/v1/scenarios/${scenario.id}/imports`, fd));
            })}>Tải lên & kiểm tra (dry run)</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Ghi là nguyên khối: còn lỗi mức error thì không ghi gì. Phần có trong file (dữ liệu, layout, đội thiết bị) sẽ thay thế phần tương ứng của phương án.</p>
        </Card>
      ) : <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">Phương án chỉ xem – không nhập được. {readOnlyReason}</p>}
      <ErrorBox error={err} />
      {msg && <p className="rounded bg-green-50 p-2 text-sm text-green-800">{msg}</p>}
      {job && (
        <Card title={<span>Lần import <Badge tone={job.status === "rejected" ? "red" : job.status === "committed" ? "green" : "blue"}>{job.status}</Badge></span>}
          actions={<>
            {job.status === "validated" && <Button disabled={busy} onClick={() => void wrap(async () => {
              const r = await api<{ applied: Record<string, number> }>("POST", `/api/v1/imports/${job.id}/commit`);
              setJob({ ...job, status: "committed" });
              setMsg(`Đã ghi: ${r.applied.sections} mục dữ liệu, ${r.applied.objects} đối tượng hình học, ${r.applied.fleet} dòng thiết bị.`);
              refreshAll();
            })}>Ghi vào phương án</Button>}
            {job.status === "committed" && <Button variant="danger" disabled={busy} onClick={() => void wrap(async () => {
              await api("POST", `/api/v1/imports/${job.id}/rollback`);
              setJob({ ...job, status: "rolled_back" });
              setMsg("Đã khôi phục trạng thái trước lần import.");
              refreshAll();
            })}>Rollback</Button>}
          </>}>
          <p className="mb-2 text-sm">
            {job.summary.error_count} lỗi · {job.summary.warning_count} cảnh báo ·
            xem trước: {JSON.stringify(job.summary.preview)}
          </p>
          <Table head={["Mức", "Sheet", "Dòng", "Cột", "Mã", "Nội dung"]} empty="Không có lỗi"
            rows={(job.errors || []).map((e) => [
              <Badge tone={e.severity === "error" ? "red" : "amber"}>{e.severity}</Badge>, e.sheet, e.row ?? "—", e.col, e.code, e.message,
            ])} />
        </Card>
      )}
    </div>
  );
}
