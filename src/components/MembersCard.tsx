// V1.0: project members and their project roles (owner manages; everyone in the project sees the list).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Member, ProjectRole } from "../api/types";
import { PROJECT_ROLE_HINT, PROJECT_ROLE_LABEL } from "../lib/rbac";
import { useAuth } from "../store/auth";
import { Badge, Button, Card, ErrorBox, Field, inputCls, Table } from "./ui";

interface Found { id: string; email: string; full_name: string; role: string }
const ROLES = Object.keys(PROJECT_ROLE_LABEL) as ProjectRole[];

export default function MembersCard({ projectId, manage }: { projectId: string; manage: boolean }) {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => api<Member[]>("GET", `/api/v1/projects/${projectId}/members`) });
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [role, setRole] = useState<ProjectRole>("viewer");
  const [err, setErr] = useState<unknown>(null);

  async function run(f: () => Promise<unknown>) {
    setErr(null);
    try { await f(); await qc.invalidateQueries({ queryKey: ["members", projectId] }); await qc.invalidateQueries({ queryKey: ["project", projectId] }); }
    catch (e) { setErr(e); }
  }
  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 2) return setFound([]);
    try { setFound(await api<Found[]>("GET", `/api/v1/users/lookup?q=${encodeURIComponent(v)}`)); } catch (e) { setErr(e); }
  }
  const ids = new Set((members.data || []).map((m) => m.user_id));
  return (
    <Card title={`Thành viên dự án (${members.data?.length ?? 0})`}>
      <ErrorBox error={err || members.error} />
      <Table head={["Email", "Tên", "Vai trò trong dự án", "Tài khoản", ""]}
        rows={(members.data || []).map((m) => [
          m.email, m.full_name,
          manage ? (
            <select className={inputCls} value={m.role} onChange={(e) => void run(() => api("PUT", `/api/v1/projects/${projectId}/members/${m.user_id}`, { role: e.target.value }))}>
              {ROLES.map((r) => <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>)}
            </select>
          ) : <Badge tone={m.role === "owner" ? "blue" : "slate"}>{PROJECT_ROLE_LABEL[m.role]}</Badge>,
          m.is_active ? <span className="text-xs text-slate-500">{m.global_role}</span> : <Badge tone="red">khoá</Badge>,
          (manage || m.user_id === me?.id) && (
            <Button variant="ghost" onClick={() => {
              if (window.confirm(m.user_id === me?.id ? "Rời khỏi dự án này?" : `Gỡ ${m.email} khỏi dự án?`))
                void run(() => api("DELETE", `/api/v1/projects/${projectId}/members/${m.user_id}`));
            }}>{m.user_id === me?.id ? "Rời dự án" : "Gỡ"}</Button>
          ),
        ])} />
      {manage && (
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Field label="Thêm người dùng (email/tên)">
            <input className={inputCls} value={q} placeholder="gõ ≥ 2 ký tự" onChange={(e) => void search(e.target.value)} />
          </Field>
          <Field label="Vai trò" hint={PROJECT_ROLE_HINT[role]}>
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2 flex flex-wrap items-end gap-1">
            {found.filter((u) => !ids.has(u.id)).map((u) => (
              <Button key={u.id} variant="secondary" onClick={() => void run(() => api("PUT", `/api/v1/projects/${projectId}/members/${u.id}`, { role })).then(() => { setQ(""); setFound([]); })}>
                + {u.email}
              </Button>
            ))}
            {q.trim().length >= 2 && !found.filter((u) => !ids.has(u.id)).length && <span className="text-xs text-slate-500">Không tìm thấy người dùng mới (admin tạo tài khoản ở trang Quản trị).</span>}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {ROLES.map((r) => `${PROJECT_ROLE_LABEL[r]}: ${PROJECT_ROLE_HINT[r]}`).join(" · ")}. Admin hệ thống có toàn quyền mọi dự án.
      </p>
    </Card>
  );
}
