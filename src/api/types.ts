// Hand-written mirror of backend/app/schemas.py (V0.1). Keep in sync with /api/openapi.json.
export type Role = "admin" | "planner" | "analyst" | "reviewer" | "viewer";
export type CargoClass = "import" | "export" | "transship" | "empty" | "reefer" | "dg" | "oog";
export type StackSystem = "RTG" | "RMG" | "ASC" | "SC" | "RS" | "ECH";

export interface User { id: string; email: string; full_name: string; role: Role; is_active: boolean }
export interface TokenOut { access_token: string; expires_in: number; user: User }

export interface Project {
  id: string; code: string; name: string; location: string; project_type: "greenfield" | "existing";
  unit_system: string; currency: string; crs_epsg: number | null; origin: Record<string, unknown>;
  description?: string | null; tags?: string[] | null; archived_at?: string | null; my_role?: ProjectRole | null;
  scenario_count?: number | null; member_count?: number | null; last_run_at?: string | null;
  baseline_scenario_id: string | null; is_sample: boolean; created_at: string; updated_at: string;
}
export interface ProjectList { items: Project[]; total: number; page: number; size: number }

export interface Scenario {
  id: string; project_id: string; parent_id: string | null; name: string; version_no: number;
  status: "draft" | "validated" | "approved" | "archived"; locked: boolean;
  assumptions: Record<string, unknown>; layout_revision: number; created_at: string; updated_at: string;
}

export type Geom =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Point"; coordinates: number[] };

export interface LayoutObject {
  code: string; object_type: string; layer: string; geom: Geom;
  props: Record<string, unknown>; rotation_deg: number;
}
export interface Layer { name: string; visible: boolean; locked: boolean }
export interface RoadGraph {
  nodes: { code: string; x: number; y: number }[];
  edges: { code: string; from: string; to: string; width_m?: number; direction?: string; speed_kmh?: number }[];
}
export interface Background { file_id: string; m_per_px: number; origin_px: number[]; origin_m: number[]; opacity?: number }
export interface Layout { revision: number; layers: Layer[]; objects: LayoutObject[]; road_graph: RoadGraph | null; background: Background | null }

export interface Issue { code: string; message: string; severity: "error" | "warning"; path?: string; detail?: Record<string, unknown>; source?: string }
export interface CheckResult {
  issues: Issue[];
  summary: { objects: number; errors: number; warnings: number; overlaps: string[][]; out_of_boundary: string[]; clearance: unknown[]; connected: boolean };
}

export interface EquipmentType { id: string; code: string; category: string; name: string; params: Record<string, number>; source: string; is_sample: boolean }
export interface FleetItem { id?: string; equipment_type_id: string; quantity: number; availability: number | null; zone_code: string | null; overrides: Record<string, number>; category?: string; type_code?: string }

export interface ImportError { sheet: string; row: number | null; col: string; code: string; severity: "error" | "warning"; message: string }
export interface ImportJob {
  id: string; scenario_id: string; status: "validated" | "rejected" | "committed" | "rolled_back";
  summary: { error_count: number; warning_count: number; preview: Record<string, unknown> };
  errors?: ImportError[]; created_at: string; committed_at: string | null;
}

export interface Subsystem { code: string; name_vi: string; utilization: number | null; capacity_quay_teu: number | null; status: "ok" | "near" | "over"; required?: number; available?: number }
export interface Kpi { kpi_code: string; value: number | null; unit: string }
export interface Run {
  id: string; scenario_id: string; run_type: string; status: string; input_hash: string; scenario_version: string;
  model_version: string; engine_version: string; params: Record<string, unknown>; progress: number;
  started_at: string | null; finished_at: string | null; elapsed_s: number | null; error: unknown; checksum: string; created_at: string;
  seed?: number | null; replications?: number | null; cancel_requested?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}
export interface KpiDef { code: string; name_vi: string; name_en: string; group: string; formula: string; unit: string; better: string }
export interface CompareTable {
  columns: { run_id: string; label: string; run_type: string }[];
  rows: { kpi_code: string; name_vi: string; group: string; unit: string; better: string; values: (number | null)[]; ratio_to_first: (number | null)[] }[];
}
export interface StoredFile { id: string; project_id: string; kind: string; original_name: string; mime: string; size_bytes: number; width_px: number | null; height_px: number | null; calibration: Record<string, unknown>; created_at: string }
export interface Report { id: string; project_id: string; run_ids: string[]; format: string; file_id: string; created_at: string }

export type ProjectRole = "owner" | "planner" | "analyst" | "reviewer" | "viewer";
export interface Member { user_id: string; email: string; full_name: string; global_role: string; role: ProjectRole; is_active: boolean; created_at: string | null }
export interface AuditRow { id: number; at: string; user_id: string | null; user_email: string | null; project_id: string | null; entity: string; entity_id: string | null; action: string; detail: Record<string, unknown> }
export interface AuditPage { total: number; page: number; size: number; actions: string[]; items: AuditRow[] }
