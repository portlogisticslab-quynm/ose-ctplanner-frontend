import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { EquipmentType } from "../api/types";
import { can, useAuth } from "../store/auth";
import { Badge, Button, Card, ErrorBox, Field, inputCls, Loading, Table } from "../components/ui";

const CATS = ["STS", "RTG", "RMG", "ASC", "SC", "RS", "ECH", "TT", "AGV", "ALV", "RAIL_CRANE"];
const PARAMS = ["productivity_mph", "availability", "speed_loaded_kmh", "speed_empty_kmh", "handling_time_min", "capex_per_unit", "opex_per_unit_year", "energy_kwh_per_move"];

export default function MasterDataPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ["equipment-types"], queryFn: () => api<EquipmentType[]>("GET", "/api/v1/master/equipment-types") });
  const [f, setF] = useState<{ code: string; category: string; name: string; source: string; params: Record<string, string> }>({ code: "", category: "RTG", name: "", source: "", params: {} });
  const create = useMutation({
    mutationFn: () => api("POST", "/api/v1/master/equipment-types", {
      code: f.code, category: f.category, name: f.name, source: f.source, is_sample: false,
      params: Object.fromEntries(Object.entries(f.params).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["equipment-types"] }); setF({ code: "", category: f.category, name: "", source: "", params: {} }); },
  });
  return (
    <div className="space-y-3">
      <Card title="Danh mục loại thiết bị">
        {types.isLoading ? <Loading /> : (
          <Table head={["Mã", "Loại", "Tên", "Tham số", "Nguồn", ""]}
            rows={(types.data || []).map((t) => [t.code, t.category, t.name,
              <span className="text-xs">{Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join(", ")}</span>,
              <span className="text-xs">{t.source}</span>, t.is_sample ? <Badge tone="amber">SAMPLE</Badge> : <Badge tone="green">dự án</Badge>])} />
        )}
      </Card>
      {can(user, "admin", "planner") && (
        <Card title="Thêm loại thiết bị">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Mã"><input className={inputCls} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="Loại"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Tên"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Nguồn số liệu"><input className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
            {PARAMS.map((p) => (
              <Field key={p} label={p}><input className={inputCls} type="number" step="any" value={f.params[p] ?? ""} onChange={(e) => setF({ ...f, params: { ...f.params, [p]: e.target.value } })} /></Field>
            ))}
          </div>
          <div className="mt-3 flex gap-2"><Button disabled={!f.code || !f.name || create.isPending} onClick={() => create.mutate()}>Thêm</Button></div>
          <div className="mt-2"><ErrorBox error={create.error} /></div>
        </Card>
      )}
    </div>
  );
}
