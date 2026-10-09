// V0.4: 3D scene model built from the 2D layout + elevations (pure data, rendered by components/ThreeView).
// World axes for Three.js: X = local x (right), Y = up, Z = local y (down the screen = towards the viewer).
import type { LayoutObject } from "../api/types";
import { area, centroid, ringOf, type Pt } from "./geometry";

export interface Extrude { kind: "extrude"; code: string; type: string; pts: Pt[]; base: number; height: number; color: string; opacity: number }
export interface Ribbon { kind: "ribbon"; code: string; type: string; pts: Pt[]; width: number; base: number; color: string }
export interface Slot { x: number; z: number; y: number; ang: number; color: string }
export interface Crane {
  kind: "sts" | "rtg"; code: string; x: number; z: number; base: number;
  dir: Pt;              // unit vector of the span (legs apart along it); STS: towards the water, boom extends along it
  span: number; height: number; boom?: number; color: string;
}
export interface Vessel { code: string; x: number; z: number; ang: number; length: number; beam: number; base: number }
export interface Scene3D {
  prims: (Extrude | Ribbon)[]; containers: Slot[]; cranes: Crane[]; vessels: Vessel[];
  extent: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
  water: { pts: Pt[]; level: number } | null;
}

export const HEIGHT_DEFAULT: Record<string, number> = { building: 8, workshop: 10, cfs: 9, depot: 3, gate: 6, rail_yard: 0.3, reefer_rack: 4 };
const FLAT: Record<string, [string, number]> = {   // colour, opacity of flat surfaces
  boundary: ["#E7E5E4", 1], apron: ["#A8A29E", 1], zone: ["#D6D3D1", 0.8], buffer: ["#FECACA", 0.6],
  restricted_zone: ["#EF4444", 0.45], berth: ["#1E3A8A", 0.35],
};
const SOLID_COLOR: Record<string, string> = { building: "#F5F5F4", workshop: "#C4B5FD", cfs: "#FDBA74", depot: "#A16207", gate: "#14B8A6",
  rail_yard: "#57534E", reefer_rack: "#67E8F9" };
const BOX_COLORS = ["#B91C1C", "#1D4ED8", "#15803D", "#A16207", "#7C3AED", "#0E7490", "#BE185D", "#525252", "#EA580C"];
export const TEU = { length: 6.06, width: 2.44, height: 2.59 };
const SLOT_W: Record<string, number> = { RTG: 2.9, RMG: 2.9, ASC: 2.9, SC: 4.0, RS: 2.9, ECH: 2.9 };

function num(v: unknown, d: number): number {
  const x = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(x) ? d : x;
}

/** Deterministic pseudo-random in [0, 1) from integers (stable scenes between renders). */
export function hash01(...k: number[]): number {
  let h = 2166136261;
  for (const v of k) { h ^= v | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return ((h >>> 0) % 100000) / 100000;
}

/** Long axis of a (near) rectangle: corner, unit vectors along (u) / across (v), lengths. */
export function rectFrame(pts: Pt[]): { o: Pt; u: Pt; v: Pt; len: number; wid: number } {
  let best = 0, bi = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > best) { best = d; bi = i; }
  }
  const a = pts[bi], b = pts[(bi + 1) % pts.length];
  const u: Pt = [(b[0] - a[0]) / best, (b[1] - a[1]) / best];
  let v: Pt = [-u[1], u[0]];
  const c = centroid(pts);
  if ((c[0] - a[0]) * v[0] + (c[1] - a[1]) * v[1] < 0) v = [-v[0], -v[1]];
  const wid = best > 0 ? Math.abs(area(pts)) / best : 0;
  return { o: a, u, v, len: best, wid };
}

export function buildScene(objects: LayoutObject[], opts: { fill: number; stsCount: number; rtgCount: number; vessels: boolean }): Scene3D {
  const prims: (Extrude | Ribbon)[] = [];
  const containers: Slot[] = [];
  const cranes: Crane[] = [];
  const vessels: Vessel[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  const grow = (p: Pt) => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); };
  const blocks: { o: LayoutObject; f: ReturnType<typeof rectFrame>; base: number }[] = [];
  const berths: { o: LayoutObject; f: ReturnType<typeof rectFrame>; base: number }[] = [];
  let quay: Pt[] | null = null;

  for (const o of objects) {
    const pts = ringOf(o.geom);
    pts.forEach(grow);
    const pr = (o.props || {}) as Record<string, unknown>;
    const base = num(pr.elevation_m, 0);
    const t = o.object_type;
    if (o.geom.type === "Polygon") {
      if (t === "yard_block") {
        const f = rectFrame(pts);
        blocks.push({ o, f, base });
        prims.push({ kind: "extrude", code: o.code, type: t, pts, base, height: 0.25, color: "#78716C", opacity: 1 });
        const sys = String(pr.equipment_system || "RTG");
        const bays = Math.max(1, Math.round(num(pr.n_bay, f.len / 6.5)));
        const rows = Math.max(1, Math.round(num(pr.n_row, 6)));
        const tiers = Math.max(1, Math.round(num(pr.n_tier_op, num(pr.n_tier_max, 5))));
        const sl = f.len / bays, sw = Math.min(SLOT_W[sys] || 2.9, f.wid / rows);
        const off = Math.max(0, f.wid - rows * sw);          // truck lane on one side of the stack
        const ang = Math.atan2(f.u[1], f.u[0]);
        const seed = o.code.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0);
        for (let b = 0; b < bays; b++) {
          for (let r = 0; r < rows; r++) {
            // stack height: fill ratio with a smooth random variation per stack
            const hgt = Math.round(tiers * Math.min(1, Math.max(0, opts.fill + (hash01(seed, b, r) - 0.5) * 0.6)));
            const cx = f.o[0] + f.u[0] * (b + 0.5) * sl + f.v[0] * (off + (r + 0.5) * sw);
            const cz = f.o[1] + f.u[1] * (b + 0.5) * sl + f.v[1] * (off + (r + 0.5) * sw);
            for (let k = 0; k < hgt; k++) {
              containers.push({ x: cx, z: cz, y: base + 0.25 + (k + 0.5) * TEU.height, ang,
                color: BOX_COLORS[Math.floor(hash01(seed, b, r, k) * BOX_COLORS.length)] });
            }
          }
        }
        maxY = Math.max(maxY, base + tiers * TEU.height);
      } else if (t in HEIGHT_DEFAULT) {
        const hgt = num(pr.height_m, HEIGHT_DEFAULT[t]);
        prims.push({ kind: "extrude", code: o.code, type: t, pts, base, height: hgt, color: SOLID_COLOR[t] || "#E5E5E5", opacity: 1 });
        maxY = Math.max(maxY, base + hgt);
      } else {
        const [color, op] = FLAT[t] || ["#D6D3D1", 0.8];
        const lvl = t === "berth" ? base - 1.0 : base;
        prims.push({ kind: "extrude", code: o.code, type: t, pts, base: lvl, height: t === "boundary" ? 0.02 : 0.08, color, opacity: op });
        if (t === "berth") berths.push({ o, f: rectFrame(pts), base });
      }
    } else if (o.geom.type === "LineString") {
      const w = t === "road_centerline" ? 10 : t === "quay_wall" ? 1.5 : 1.2;
      const color = t === "road_centerline" ? "#44403C" : t === "quay_wall" ? "#1E293B" : "#57534E";
      prims.push({ kind: "ribbon", code: o.code, type: t, pts, width: w, base: base + 0.06, color });
      if (t === "quay_wall" && (!quay || pts.length > quay.length)) quay = pts;
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 100; minZ = 0; maxZ = 100; }

  // water: the side of the quay line away from the yard (or north of the extent when there is no quay)
  let water: Scene3D["water"] = null;
  if (quay && quay.length >= 2) {
    const a = quay[0], b = quay[quay.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let n: Pt = [-u[1], u[0]];
    const yc = blocks.length ? centroid(blocks.map((x) => centroid(ringOf(x.o.geom)))) : [(minX + maxX) / 2, (minZ + maxZ) / 2] as Pt;
    if ((yc[0] - a[0]) * n[0] + (yc[1] - a[1]) * n[1] > 0) n = [-n[0], -n[1]];          // n points to the water
    const ext = Math.max(maxX - minX, maxZ - minZ);
    const pad = 0.3 * ext;
    water = { level: -2, pts: [
      [a[0] - u[0] * pad, a[1] - u[1] * pad], [b[0] + u[0] * pad, b[1] + u[1] * pad],
      [b[0] + u[0] * pad + n[0] * ext * 0.6, b[1] + u[1] * pad + n[1] * ext * 0.6],
      [a[0] - u[0] * pad + n[0] * ext * 0.6, a[1] - u[1] * pad + n[1] * ext * 0.6]] };
    const qAng = Math.atan2(u[1], u[0]);
    // STS cranes spread along the berths (or the quay), legs on the apron, boom over the water
    const spans = berths.length ? berths.map((x) => ({ a: x.f.o, len: x.f.len, u: x.f.u })) : [{ a, len: L, u }];
    const total = spans.reduce((s, x) => s + x.len, 0);
    for (let i = 0; i < opts.stsCount; i++) {
      let d = ((i + 0.5) / opts.stsCount) * total;
      let sp = spans[0];
      for (const x of spans) { if (d <= x.len) { sp = x; break; } d -= x.len; }
      const px = sp.a[0] + sp.u[0] * d, pz = sp.a[1] + sp.u[1] * d;
      // project onto the quay line, then step 15 m inland (rail gauge 30 m centred on the apron)
      const t = (px - a[0]) * u[0] + (pz - a[1]) * u[1];
      cranes.push({ kind: "sts", code: `STS-${String(i + 1).padStart(2, "0")}`, x: a[0] + u[0] * t - n[0] * 15, z: a[1] + u[1] * t - n[1] * 15,
        dir: n, base: 0, span: 30, height: 48, boom: 60, color: "#EA580C" });
    }
    maxY = Math.max(maxY, 48);
    if (opts.vessels) {
      const list = berths.length ? berths.map((x) => ({ a: x.f.o, len: x.f.len, u: x.f.u })) : [{ a, len: L, u }];
      list.forEach((x, i) => {
        const len = Math.min(400, x.len * 0.85);
        const cx = x.a[0] + x.u[0] * x.len / 2, cz = x.a[1] + x.u[1] * x.len / 2;
        const t = (cx - a[0]) * u[0] + (cz - a[1]) * u[1];
        vessels.push({ code: `VS-${i + 1}`, x: a[0] + u[0] * t + n[0] * 22, z: a[1] + u[1] * t + n[1] * 22, ang: qAng, length: len, beam: 40, base: -2 });
      });
    }
  }
  // RTG/RMG: distributed over the blocks, spanning the stack
  for (let i = 0; i < Math.min(opts.rtgCount, Math.max(1, blocks.length) * 3) && blocks.length; i++) {
    const b = blocks[i % blocks.length];
    const k = Math.floor(i / blocks.length);
    const along = b.f.len * (0.25 + 0.5 * hash01(i, k, 7));
    const cx = b.f.o[0] + b.f.u[0] * along + b.f.v[0] * b.f.wid / 2, cz = b.f.o[1] + b.f.u[1] * along + b.f.v[1] * b.f.wid / 2;
    cranes.push({ kind: "rtg", code: `YC-${String(i + 1).padStart(2, "0")}`, x: cx, z: cz, dir: b.f.v,
      base: b.base, span: b.f.wid + 2, height: 6 * TEU.height + 3, color: "#FACC15" });
  }
  return { prims, containers, cranes, vessels, water, extent: { minX, maxX, minZ, maxZ, maxY } };
}
