import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Project, Scenario } from "../api/types";
import { can, useAuth } from "../store/auth";
import { allowed, PROJECT_ROLE_LABEL } from "../lib/rbac";
import MembersCard from "../components/MembersCard";
import { Badge, Button, Card, ErrorBox, Field, inputCls, Loading, Table } from "../components/ui";
import { dateTime, STATUS_LABEL } from "../lib/format";

const tone = { draft: "slate", validated: "blue", approved: "green", archived: "amber" } as const;

export default function ProjectPage() {
  const { projectId = "" } = useParams();
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => api<Project>("GET", `/api/v1/projects/${projectId}`) });
  const scenarios = useQuery({ queryKey: ["scenarios", projectId], queryFn: () => api<Scenario[]>("GET", `/api/v1/projects/${projectId}/scenarios`) });
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [showArchived, setShowArchived] = useState(false);   // V1.4.3: archived scenarios hidden by default
  const [err, setErr] = useState<unknown>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["scenarios", projectId] });
    void qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const act = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => { setErr(null); refresh(); },
    onError: (e) => setErr(e),
  });

  if (project.isLoading) return <Loading />;
  if (project.error) return <ErrorBox error={project.error} />;
  const p = project.data as Project;
  const rb = { sample: p.is_sample, admin: can(user, "admin") };
  const writer = allowed(p.my_role, "write", rb);
  const reviewer = allowed(p.my_role, "review", rb);
  const manager = allowed(p.my_role, "manage", rb);
  const all = scenarios.data ?? [];
  const nArchived = all.filter((s) => s.status === "archived").length;
  const visible = showArchived ? all : all.filter((s) => s.status !== "archived");
  const approver = (p.my_role === "reviewer" || can(user, "admin")) && !(p.is_sample && !can(user, "admin"));  // four-eyes

  async function exportJson() {
    const data = await api<unknown>("GET", `/api/v1/projects/${p.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${p.code}.ctplanner.json`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <Card title={<span>{p.code} – {p.name} {p.is_sample && <Badge tone="amber">SAMPLE · chỉ xem</Badge>}
        {p.archived_at && <Badge tone="amber">Lưu trữ</Badge>} {p.my_role && <Badge tone="blue">{PROJECT_ROLE_LABEL[p.my_role]}</Badge>}</span>}
        actions={<>
          <Button variant="secondary" onClick={() => void exportJson()}>Xuất JSON</Button>
          {manager && <Link className="rounded px-3 py-1.5 text-sm text-navy hover:bg-navy-light" to={`/audit?project=${p.id}`}>Nhật ký dự án</Link>}
          {manager && !p.is_sample && <Button variant="ghost" onClick={() => {
            if (window.confirm(p.archived_at ? "Đưa dự án ra khỏi lưu trữ?" : "Lưu trữ dự án? (ẩn khỏi danh mục đang hoạt động, dữ liệu giữ nguyên)"))
              act.mutate(() => api("POST", `/api/v1/projects/${p.id}/archive?archived=${!p.archived_at}`));
          }}>{p.archived_at ? "Bỏ lưu trữ" : "Lưu trữ"}</Button>}
        </>}>
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div><span className="text-slate-500">Loại:</span> {p.project_type === "greenfield" ? "Xây mới" : "Cảng hiện hữu"}</div>
          <div><span className="text-slate-500">Địa điểm:</span> {p.location || "—"}</div>
          <div><span className="text-slate-500">Đơn vị:</span> {p.unit_system} · {p.currency}</div>
          <div><span className="text-slate-500">Cập nhật:</span> {dateTime(p.updated_at)}</div>
        </div>
        <ProjectInfo p={p} editable={writer} onSaved={refresh} />
      </Card>

      <Card title="Phương án">
        <ErrorBox error={err} />
        {nArchived > 0 && (
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Hiện cả phương án lưu trữ ({nArchived})
          </label>
        )}
        {scenarios.data && (
          <Table head={["Phương án", "Trạng thái", "Revision layout", "Cập nhật", "Thao tác"]}
            rows={visible.map((s) => [
              <span>
                <Link className="font-medium text-navy underline" to={`/scenarios/${s.id}/layout`}>{s.name} v{s.version_no}</Link>
                {p.baseline_scenario_id === s.id && <> <Badge tone="blue">baseline</Badge></>}
              </span>,
              <span><Badge tone={tone[s.status]}>{STATUS_LABEL[s.status]}</Badge> {s.locked && <Badge tone="red">khoá</Badge>}</span>,
              s.layout_revision,
              dateTime(s.updated_at),
              <div className="flex flex-wrap gap-1">
                <Link className="rounded px-2 py-1 text-sm text-navy hover:bg-navy-light" to={`/scenarios/${s.id}/capacity`}>Kết quả</Link>
                {writer && <Button variant="ghost" disabled={act.isPending} onClick={() => {
                  const n = window.prompt("Tên phương án mới", `${s.name} (bản sao)`);
                  if (n) act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/clone`, { name: n }));
                }}>Clone</Button>}
                {writer && s.status === "draft" && <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/status`, { status: "validated" }))}>Kiểm tra → Validated</Button>}
                {writer && s.status === "validated" && <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/status`, { status: "draft" }))}>Về nháp</Button>}
                {approver && s.status === "validated" && <Button variant="ghost" disabled={act.isPending} onClick={() => {
                  const c = window.prompt("Ý kiến duyệt", "") ?? "";
                  act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/status`, { status: "approved", comment: c }));
                }}>Duyệt</Button>}
                {reviewer && s.status !== "approved" && <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/lock?locked=${!s.locked}`))}>{s.locked ? "Mở khoá" : "Khoá"}</Button>}
                {writer && p.baseline_scenario_id !== s.id && <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => api("PATCH", `/api/v1/projects/${p.id}`, { baseline_scenario_id: s.id }))}>Đặt baseline</Button>}
                {writer && p.baseline_scenario_id !== s.id && (s.status === "draft" || s.status === "validated") && <Button variant="ghost" disabled={act.isPending} onClick={() => {
                  if (window.confirm(`Lưu trữ phương án ${s.name} v${s.version_no}? (ẩn khỏi danh sách, khoá chỉnh sửa, giữ nguyên kết quả; có thể bỏ lưu trữ sau)`))
                    act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/status`, { status: "archived" }));
                }}>Lưu trữ</Button>}
                {writer && s.status === "archived" && <Button variant="ghost" disabled={act.isPending}
                  onClick={() => act.mutate(() => api("POST", `/api/v1/scenarios/${s.id}/status`, { status: "draft" }))}>Bỏ lưu trữ</Button>}
                {writer && p.baseline_scenario_id !== s.id && (s.status === "draft" || s.status === "archived") && !s.locked && <Button variant="ghost" disabled={act.isPending} onClick={() => {
                  if (window.confirm(`Xoá vĩnh viễn phương án ${s.name} v${s.version_no}?\n\nMọi kết quả chạy (công suất, kế hoạch bãi, mô phỏng) của phương án này cũng bị xoá và không khôi phục được.`))
                    act.mutate(() => api("DELETE", `/api/v1/scenarios/${s.id}?with_runs=true`));
                }}>Xoá</Button>}
              </div>,
            ])} />
        )}
        {writer && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="Tên phương án mới"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Tạo từ (tuỳ chọn)">
              <select className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">— phương án trống —</option>
                {scenarios.data?.map((s) => <option key={s.id} value={s.id}>{s.name} v{s.version_no}</option>)}
              </select>
            </Field>
            <div className="flex items-end">
              <Button disabled={!name || act.isPending} onClick={() => act.mutate(() => api("POST", `/api/v1/projects/${p.id}/scenarios`, { name, parent_id: parent || null }).then(() => setName("")))}>Tạo phương án</Button>
            </div>
          </div>
        )}
      </Card>
      {!p.is_sample && <MembersCard projectId={p.id} manage={manager} />}
    </div>
  );
}

function ProjectInfo({ p, editable, onSaved }: { p: Project; editable: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [pname, setPname] = useState(p.name);
  const [loc, setLoc] = useState(p.location || "");
  const [desc, setDesc] = useState(p.description || "");
  const [tags, setTags] = useState((p.tags || []).join(", "));
  const [err, setErr] = useState<unknown>(null);
  async function save() {
    try {
      await api("PATCH", `/api/v1/projects/${p.id}`, { name: pname.trim() || p.name, location: loc.trim(), description: desc, tags: tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) });
      setEdit(false); setErr(null); onSaved();
    } catch (e) { setErr(e); }
  }
  if (!edit) {
    return (
      <div className="mt-2 text-sm">
        {p.description ? <p className="whitespace-pre-line text-slate-700">{p.description}</p> : <p className="text-slate-400">Chưa có mô tả.</p>}
        <div className="mt-1 flex flex-wrap gap-1">{(p.tags || []).map((t) => <Badge key={t}>{t}</Badge>)}
          {editable && <Button variant="ghost" onClick={() => setEdit(true)}>Sửa tên / mô tả / nhãn</Button>}</div>
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-2 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Tên dự án"><input className={inputCls} value={pname} maxLength={200} onChange={(e) => setPname(e.target.value)} /></Field>
        <Field label="Địa điểm"><input className={inputCls} value={loc} maxLength={200} onChange={(e) => setLoc(e.target.value)} /></Field>
      </div>
      <Field label="Mô tả"><textarea className={`${inputCls} h-20`} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Field label="Nhãn (phân cách bằng dấu phẩy)"><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      <ErrorBox error={err} />
      <div className="flex gap-2"><Button onClick={() => void save()}>Lưu</Button><Button variant="secondary" onClick={() => setEdit(false)}>Huỷ</Button></div>
    </div>
  );
}
