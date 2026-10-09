import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiBases } from "../api/client";
import type { User } from "../api/types";
import { can, useAuth } from "../store/auth";
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Table } from "../components/ui";
import { ROLE_LABEL } from "../lib/format";


export default function AdminPage() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], enabled: can(me, "admin"), queryFn: () => api<User[]>("GET", "/api/v1/admin/users") });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<Record<string, unknown>>("GET", "/api/health") });
  const [f, setF] = useState({ email: "", full_name: "", password: "", role: "viewer" });
  const create = useMutation({
    mutationFn: () => api("POST", "/api/v1/admin/users", f),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["users"] }); setF({ email: "", full_name: "", password: "", role: "viewer" }); },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api("PATCH", `/api/v1/admin/users/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
  if (!can(me, "admin")) return <Empty text="Chỉ quản trị viên được truy cập." />;
  return (
    <div className="space-y-3">
      <Card title="Tình trạng hệ thống">
        <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify({ ...health.data, api: apiBases }, null, 1)}</pre>
      </Card>
      <Card title="Người dùng">
        <ErrorBox error={patch.error} />
        <Table head={["Email", "Tên", "Vai trò", "Trạng thái", ""]}
          rows={(users.data || []).map((u) => [u.email, u.full_name,
            <select className={inputCls} value={u.role} disabled={u.id === me?.id} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>,
            u.is_active ? <Badge tone="green">hoạt động</Badge> : <Badge tone="red">khoá</Badge>,
            u.id !== me?.id && <Button variant="ghost" onClick={() => patch.mutate({ id: u.id, body: { is_active: !u.is_active } })}>{u.is_active ? "Khoá" : "Mở"}</Button>])} />
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <Field label="Email"><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Tên"><input className={inputCls} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Mật khẩu (≥ 8 ký tự)"><input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Vai trò"><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <div className="flex items-end"><Button disabled={!f.email || f.password.length < 8} onClick={() => create.mutate()}>Thêm</Button></div>
        </div>
        <div className="mt-2"><ErrorBox error={create.error} /></div>
      </Card>
      <Card title="Nhật ký kiểm toán"><p className="text-sm">Xem, lọc và xuất CSV ở trang <a className="text-navy underline" href="/audit">Nhật ký</a>.</p></Card>
    </div>
  );
}
