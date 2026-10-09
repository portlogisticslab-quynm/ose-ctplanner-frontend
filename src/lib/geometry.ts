// Client-side geometry helpers (display and editing only; the backend engine is authoritative).
import type { Geom, LayoutObject } from "../api/types";

export type Pt = [number, number];

// SAMPLE dimensions — keep identical to engine/ctp_engine/geometry/footprint.py
export const SLOT_LENGTH_M = 6.5;
export const SLOT_WIDTH_M: Record<string, number> = { RTG: 2.9, RMG: 2.9, ASC: 2.9, SC: 4.0, RS: 2.9, ECH: 2.9 };
export const EXTRA_WIDTH_M: Record<string, number> = { RTG: 7.0, RMG: 6.0, ASC: 2.0, SC: 0, RS: 0, ECH: 0 };

export interface BlockProps {
  equipment_system: string; n_bay: number; n_row: number; n_tier_max: number; n_tier_op?: number | null;
  cargo_class?: string; orientation?: string; reefer_plugs?: number; dg_allowed?: boolean;
  slot_length_m?: number; slot_width_m?: number; extra_width_m?: number;
}

export function blockDimensions(p: BlockProps): { length: number; width: number } {
  const s = p.equipment_system;
  const length = p.n_bay * (p.slot_length_m || SLOT_LENGTH_M);
  const width = p.n_row * (p.slot_width_m || SLOT_WIDTH_M[s] || 2.9) + (p.extra_width_m ?? EXTRA_WIDTH_M[s] ?? 0);
  return { length, width };
}

export function rect(cx: number, cy: number, length: number, width: number, rotationDeg = 0): Pt[] {
  const t = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const hl = length / 2, hw = width / 2;
  const corners: Pt[] = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  return corners.map(([dx, dy]) => [round4(cx + dx * c - dy * s), round4(cy + dx * s + dy * c)] as Pt);
}

export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function ringOf(g: Geom): Pt[] {
  if (g.type === "Polygon") {
    const r = g.coordinates[0] || [];
    const pts = r.map((p) => [p[0], p[1]] as Pt);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  }
  if (g.type === "LineString") return g.coordinates.map((p) => [p[0], p[1]] as Pt);
  return [[g.coordinates[0], g.coordinates[1]]];
}

export function polygonGeom(pts: Pt[]): Geom {
  const ring = pts.map((p) => [round4(p[0]), round4(p[1])]);
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}

export function area(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function centroid(pts: Pt[]): Pt {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function lengthOf(pts: Pt[]): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += dist(pts[i], pts[i + 1]);
  return L;
}

export function translateGeom(g: Geom, dx: number, dy: number): Geom {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map((r) => r.map((p) => [round4(p[0] + dx), round4(p[1] + dy)])) };
  if (g.type === "LineString") return { type: "LineString", coordinates: g.coordinates.map((p) => [round4(p[0] + dx), round4(p[1] + dy)]) };
  return { type: "Point", coordinates: [round4(g.coordinates[0] + dx), round4(g.coordinates[1] + dy)] };
}

export function snap(v: number, grid: number, on: boolean): number {
  return on && grid > 0 ? Math.round(v / grid) * grid : v;
}

/** Rebuild a yard block polygon from its props around its current centre. */
export function rebuildBlock(o: LayoutObject, rotationDeg?: number): LayoutObject {
  const pts = ringOf(o.geom);
  const [cx, cy] = centroid(pts);
  const rot = rotationDeg ?? o.rotation_deg ?? 0;
  const { length, width } = blockDimensions(o.props as unknown as BlockProps);
  return { ...o, rotation_deg: rot, geom: polygonGeom(rect(cx, cy, length, width, rot)) };
}

export function bounds(objects: LayoutObject[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objects) for (const [x, y] of ringOf(o.geom)) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Generate a row/column grid of yard blocks starting at (x0, y0) (top-left of the first block). */
export function generateBlocks(opts: {
  props: BlockProps; count: number; perRow: number; x0: number; y0: number; gapX: number; gapY: number;
  rotationDeg: number; prefix: string; startIndex: number;
}): LayoutObject[] {
  const { length, width } = blockDimensions(opts.props);
  const out: LayoutObject[] = [];
  for (let i = 0; i < opts.count; i++) {
    const col = i % opts.perRow;
    const row = Math.floor(i / opts.perRow);
    const cx = opts.x0 + length / 2 + col * (length + opts.gapX);
    const cy = opts.y0 + width / 2 + row * (width + opts.gapY);
    const code = `${opts.prefix}${String(opts.startIndex + i).padStart(2, "0")}`;
    out.push({ code, object_type: "yard_block", layer: "yard", rotation_deg: opts.rotationDeg,
      props: { ...opts.props, cargo_class: opts.props.cargo_class || "mixed" } as Record<string, unknown>,
      geom: polygonGeom(rect(cx, cy, length, width, opts.rotationDeg)) });
  }
  return out;
}
