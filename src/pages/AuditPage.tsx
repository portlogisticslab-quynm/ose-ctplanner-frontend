// V1.0: audit log viewer – admins: whole system; project owners: their projects (?project=<id>).
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, download } from "../api/client";
import type { AuditPage as AuditData, ProjectList } from "../api/types";
import { can, useAuth } from "../store/auth";
import { Button, Card, ErrorBox, Field, inputCls, Loading, Table } from "../components/ui";
import { dateTime } from "../lib/format";

const ACTION_LABEL: Record<string, string> = {
  login: "Đăng nhập", create: "Tạo", update: "Sửa", delete: "Xoá", save_layout: "Lưu mặt bằng", run: "Chạy tính", enqueue: "Gửi mô phỏng",
  run_failed: "Chạy lỗi", run_cancelled: "Huỷ chạy", status: "Đổi trạng thái", lock: "Khoá", unlock: "Mở khoá", clone: "Nhân bản",
  import: "Nhập", commit_import: "Áp dụng import", rollback_import: "Hoàn tác import", export_report: "Xuất báo cáo",
  member_set: "Đặt vai trò thành viên", member_remove: "Gỡ thành viên", archive: "Lưu trữ", unarchive: "Bỏ lưu trữ",
  dxf_preview: "Đọc DXF", export_audit: "Xuất nhật ký", cancel: "Huỷ",
};

export default function AuditPage() {
  const me = useAuth((s) => s.user);
  const [sp, setSp] = useSearchParams();
  const project = sp.get("project") || "";
  const [f, setF] = useState({ action: "", entity: "", since: "", until: "", user_id: "" });
  const [page, setPage] = useState(1);
  const projects = useQuery({ queryKey: ["projects", "audit-owned"], queryFn: () => api<ProjectList>("GET", "/api/v1/projects?size=200&status=all") });
  const owned = (projects.data?.items || []).filter((p) => p.my_role === "owner" && !p.is_sample);
  const params = new URLSearchParams({ page: String(page), size: "100" });
  if (project) params.set("project_id", project);
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, k === "since" ? `${v}T00:00:00` : k === "until" ? `${v}T23:59:59` : v);
  const enabled = can(me, "admin") || !!project;
  const audit = useQuery({ queryKey: ["audit", params.toString()], enabled, queryFn: () => api<AuditData>("GET", `/api/v1/audit?${params}`) });
  const pages = Math.max(1, Math.ceil((audit.data?.total || 0) / 100));
  const names = new Map((projects.data?.items || []).map((p) => [p.id, p.code]));

  return (
    <div className="space-y-3">
      <Card title="Nhật ký kiểm toán" actions={enabled && (
        <Button variant="secondary" onClick={() => { params.delete("page"); params.delete("size"); void download(`/api/v1/audit/export.csv?${params}`, "ctplanner_audit.csv"); }}>Xuất CSV</Button>)}>
        <div className="grid gap-2 sm:grid-cols-6">
          <Field label="Dự án">
            <select className={inputCls} value={project} onChange={(e) => { setPage(1); setSp(e.target.value ? { project: e.target.value } : {}); }}>
              {can(me, "admin") ? <option value="">— toàn hệ thống —</option> : <option value="">— chọn dự án bạn sở hữu —</option>}
              {(can(me, "admin") ? (projects.data?.items || []) : owned).map((p) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
            </select>
          </Field>
          <Field label="Hành động">
            <select className={inputCls} value={f.action} onChange={(e) => { setPage(1); setF({ ...f, action: e.target.value }); }}>
              <option value="">Tất cả</option>
              {(audit.data?.actions || []).map((a) => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
            </select>
          </Field>
          <Field label="Đối tượng">
            <select className={inputCls} value={f.entity} onChange={(e) => { setPage(1); setF({ ...f, entity: e.target.value }); }}>
              <option value="">Tất cả</option>
              {["project", "scenario", "run", "user", "report", "import", "file", "equipment_type", "audit"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Từ ngày"><input className={inputCls} type="date" value={f.since} onChange={(e) => { setPage(1); setF({ ...f, since: e.target.value }); }} /></Field>
          <Field label="Đến ngày"><input className={inputCls} type="date" value={f.until} onChange={(e) => { setPage(1); setF({ ...f, until: e.target.value }); }} /></Field>
          <div className="flex items-end text-xs text-slate-500">{audit.data ? `${audit.data.total.toLocaleString("vi-VN")} bản ghi` : ""}</div>
        </div>
      </Card>
      {!enabled ? (
        <Card><p className="text-sm text-slate-600">{owned.length ? "Chọn một dự án bạn là chủ sở hữu để xem nhật ký." : "Bạn chưa là chủ sở hữu dự án nào; nhật ký toàn hệ thống chỉ dành cho admin."}</p></Card>
      ) : (
        <Card>
          {audit.isLoading && <Loading />}
          <ErrorBox error={audit.error} />
          {audit.data && (
            <>
              <Table head={["Thời điểm", "Người dùng", "Dự án", "Hành động", "Đối tượng", "Chi tiết"]}
                rows={audit.data.items.map((a) => [
                  dateTime(a.at),
                  a.user_email || (a.user_id ? a.user_id.slice(0, 8) : "hệ thống"),
                  a.project_id ? names.get(a.project_id) || a.project_id.slice(0, 8) : "—",
                  ACTION_LABEL[a.action] || a.action,
                  `${a.entity}${a.entity_id ? " " + a.entity_id.slice(0, 8) : ""}`,
                  <span className="break-all text-xs text-slate-600" title={JSON.stringify(a.detail)}>{JSON.stringify(a.detail).slice(0, 180)}</span>,
                ])} />
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Trước</Button>
                <span>Trang {page} / {pages}</span>
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau ›</Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
