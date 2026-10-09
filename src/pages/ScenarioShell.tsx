import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Project, Scenario } from "../api/types";
import { can, useAuth } from "../store/auth";
import { allowed } from "../lib/rbac";
import { Badge, ErrorBox, Loading } from "../components/ui";
import { STATUS_LABEL } from "../lib/format";

export interface ScenarioCtx {
  scenario: Scenario;
  project: Project;
  editable: boolean;   // user may change data and scenario is not locked/approved
  canRun: boolean;
  refetch: () => void;
}

export function useScenario(): ScenarioCtx {
  return useOutletContext<ScenarioCtx>();
}

export default function ScenarioShell() {
  const { scenarioId = "" } = useParams();
  const user = useAuth((s) => s.user);
  const sc = useQuery({ queryKey: ["scenario", scenarioId], queryFn: () => api<Scenario>("GET", `/api/v1/scenarios/${scenarioId}`) });
  const pid = sc.data?.project_id;
  const pj = useQuery({ queryKey: ["project", pid], enabled: !!pid, queryFn: () => api<Project>("GET", `/api/v1/projects/${pid}`) });
  if (sc.isLoading || pj.isLoading) return <Loading />;
  if (sc.error || pj.error) return <ErrorBox error={sc.error || pj.error} />;
  const scenario = sc.data as Scenario;
  const project = pj.data as Project;
  const frozen = scenario.locked || scenario.status === "approved" || scenario.status === "archived";
  const rb = { sample: project.is_sample, admin: can(user, "admin") };
  const editable = allowed(project.my_role, "write", rb) && !frozen;
  const canRun = allowed(project.my_role, "run", rb);
  const tab = ({ isActive }: { isActive: boolean }) =>
    `border-b-2 px-3 py-2 text-sm font-bold ${isActive ? "border-navy text-navy" : "border-transparent text-slate-600 hover:text-navy"}`;
  const ctx: ScenarioCtx = { scenario, project, editable, canRun, refetch: () => void sc.refetch() };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link className="text-sm text-navy underline" to={`/projects/${project.id}`}>{project.code}</Link>
        <span className="text-slate-400">/</span>
        <h1 className="text-lg font-semibold text-navy">{scenario.name} v{scenario.version_no}</h1>
        <Badge tone={scenario.status === "approved" ? "green" : scenario.status === "validated" ? "blue" : "slate"}>{STATUS_LABEL[scenario.status]}</Badge>
        {scenario.locked && <Badge tone="red">khoá</Badge>}
        {project.is_sample && <Badge tone="amber">SAMPLE</Badge>}
        {!editable && <span className="text-xs text-slate-500">(chỉ xem)</span>}
      </div>
      <nav className="flex flex-wrap border-b border-slate-200">
        <NavLink to="layout" className={tab}>Mặt bằng 2D</NavLink>
        <NavLink to="inputs" className={tab}>Dữ liệu đầu vào</NavLink>
        <NavLink to="import" className={tab}>Nhập Excel</NavLink>
        <NavLink to="capacity" className={tab}>Sức chứa & năng lực</NavLink>
        <NavLink to="yard-ops" className={tab}>Khai thác bãi</NavLink>
        <NavLink to="simulation" className={tab}>Mô phỏng</NavLink>
        <NavLink to="3d" className={tab}>3D</NavLink>
      </nav>
      <Outlet context={ctx} />
    </div>
  );
}
