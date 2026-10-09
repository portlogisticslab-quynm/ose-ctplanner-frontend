import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, download } from "../api/client";
import type { Project, ProjectList } from "../api/types";
import { can, useAuth } from "../store/auth";
import { Badge, Button, Card, ErrorBox, Field, inputCls, Loading, Table } from "../components/ui";
import { dateTime } from "../lib/format";
import { PROJECT_ROLE_LABEL } from "../lib/rbac";

export default function ProjectsPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState({ q: "", project_type: "", status: "active", tag: "", sort: "updated", mine: false });
  const [view, setView] = useState<"cards" | "table">(() => { try { return (localStorage.getItem("ctp.catalog.view") as "cards" | "table") || "cards"; } catch { return "cards"; } });
  const qs = new URLSearchParams({ size: "200", q: f.q, project_type: f.project_type, status: f.status, tag: f.tag, sort: f.sort, mine: String(f.mine) }).toString();
  const list = useQuery({ queryKey: ["projects", qs], queryFn: () => api<ProjectList>("GET", `/api/v1/projects?${qs}`) });
  const allTags = Array.from(new Set((list.data?.items || []).flatMap((p) => p.tags || []))).sort();
  function setV(v: "cards" | "table") { setView(v); try { localStorage.setItem("ctp.catalog.view", v); } catch { /* storage unavailable */ } }
  const [form, setForm] = useState({ code: "", name: "", location: "", project_type: "greenfield", currency: "USD" });
  const create = useMutation({
    mutationFn: () => api<Project>("POST", "/api/v1/projects", form),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["projects"] }); nav(`/projects/${p.id}`); },
  });
  const [file, setFile] = useState<File | null>(null);
  const [newCode, setNewCode] = useState("");
  const importJson = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file as File);
      return api<Project>("POST", `/api/v1/projects/import${newCode ? `?code=${encodeURIComponent(newCode)}` : ""}`, fd);
    },
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["projects"] }); nav(`/projects/${p.id}`); },
  });
  const canWrite = can(user, "admin", "planner");

  return (
    <div className="space-y-4">
      <Card title={`Danh mục dự án (${list.data?.total ?? 0})`} actions={
        <div className="flex gap-1">
          <Button variant={view === "cards" ? "primary" : "secondary"} onClick={() => setV("cards")}>Thẻ</Button>
          <Button variant={view === "table" ? "primary" : "secondary"} onClick={() => setV("table")}>Bảng</Button>
        </div>}>
        <div className="mb-3 grid gap-2 sm:grid-cols-6">
          <input className={`${inputCls} sm:col-span-2`} placeholder="Tìm mã, tên, địa điểm, mô tả" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <select className={inputCls} value={f.project_type} onChange={(e) => setF({ ...f, project_type: e.target.value })}>
            <option value="">Mọi loại</option><option value="greenfield">Xây mới</option><option value="existing">Cảng hiện hữu</option>
          </select>
          <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Đang hoạt động</option><option value="archived">Lưu trữ</option><option value="all">Tất cả</option>
          </select>
          <select className={inputCls} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}>
            <option value="">Mọi nhãn</option>{allTags.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className={inputCls} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
            <option value="updated">Mới cập nhật</option><option value="name">Theo tên</option><option value="code">Theo mã</option><option value="created">Mới tạo</option>
          </select>
          {can(user, "admin") && (
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} /> chỉ dự án tôi là thành viên</label>
          )}
        </div>
        {list.isLoading ? <Loading /> : <ErrorBox error={list.error} />}
        {list.data && !list.data.items.length && <p className="py-4 text-center text-sm text-slate-500">Không có dự án phù hợp. Dự án chỉ hiện khi bạn là thành viên (chủ dự án thêm bạn ở trang dự án).</p>}
        {list.data && view === "cards" && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.items.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="block rounded-lg border border-slate-200 p-3 transition hover:border-navy hover:shadow">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">{p.code}</div>
                    <div className="font-semibold text-navy">{p.name}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.is_sample && <Badge tone="amber">SAMPLE</Badge>}
                    {p.archived_at && <Badge tone="amber">Lưu trữ</Badge>}
                    {p.my_role && <Badge tone="blue">{PROJECT_ROLE_LABEL[p.my_role]}</Badge>}
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-600">{p.project_type === "greenfield" ? "Xây mới" : "Cảng hiện hữu"}{p.location ? ` · ${p.location}` : ""}</div>
                {p.description && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{p.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1">{(p.tags || []).map((t) => <Badge key={t}>{t}</Badge>)}</div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs text-slate-500">
                  <span><b className="text-slate-700">{p.scenario_count ?? 0}</b> phương án</span>
                  <span><b className="text-slate-700">{p.member_count ?? 0}</b> thành viên</span>
                  <span title="Lần chạy gần nhất">{p.last_run_at ? `chạy ${dateTime(p.last_run_at)}` : "chưa chạy"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {list.data && view === "table" && (
          <Table head={["Mã", "Tên", "Loại", "Địa điểm", "Vai trò", "Phương án", "Thành viên", "Lần chạy gần nhất", "Cập nhật"]}
            rows={list.data.items.map((p) => [
              <Link className="font-medium text-navy underline" to={`/projects/${p.id}`}>{p.code}</Link>,
              <span>{p.name} {p.is_sample && <Badge tone="amber">SAMPLE</Badge>} {p.archived_at && <Badge tone="amber">Lưu trữ</Badge>}</span>,
              p.project_type === "greenfield" ? "Xây mới" : "Cảng hiện hữu",
              p.location,
              p.my_role ? PROJECT_ROLE_LABEL[p.my_role] : "—",
              p.scenario_count ?? 0,
              p.member_count ?? 0,
              p.last_run_at ? dateTime(p.last_run_at) : "—",
              dateTime(p.updated_at),
            ])} />
        )}
      </Card>

      {canWrite && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Tạo dự án">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }}>
              <Field label="Mã dự án" hint="Chữ, số, - _ ."><input className={inputCls} required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field label="Tên"><input className={inputCls} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Địa điểm"><input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
              <Field label="Loại dự án">
                <select className={inputCls} value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })}>
                  <option value="greenfield">Xây mới (greenfield)</option>
                  <option value="existing">Cảng hiện hữu</option>
                </select>
              </Field>
              <Field label="Tiền tệ">
                <select className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option>USD</option><option>VND</option>
                </select>
              </Field>
              <div className="flex items-end"><Button type="submit" disabled={create.isPending}>Tạo</Button></div>
            </form>
            <div className="mt-3"><ErrorBox error={create.error} /></div>
          </Card>
          <Card title="Nhập dự án từ JSON">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void download("/api/v1/templates/project.json", "ctplanner_demo_project.json")}>Tải mẫu JSON (dự án demo)</Button>
                <Button variant="secondary" onClick={() => void download("/api/v1/imports/template?sample=true", "ctplanner_template_SAMPLE.xlsx")}>Tải mẫu Excel</Button>
              </div>
              <p className="text-xs text-slate-500">Mẫu JSON là dự án demo hoàn chỉnh (2 phương án, mặt bằng DXF VN-2000): tải về rồi chọn tệp đó và bấm Nhập để có ngay dự án chạy thử.</p>
              <input type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Field label="Mã mới (để trống = giữ mã cũ)"><input className={inputCls} value={newCode} onChange={(e) => setNewCode(e.target.value)} /></Field>
              <Button disabled={!file || importJson.isPending} onClick={() => importJson.mutate()}>Nhập</Button>
              <ErrorBox error={importJson.error} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
