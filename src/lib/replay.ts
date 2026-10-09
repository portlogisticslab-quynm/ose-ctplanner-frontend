// Equipment replay (V0.3): index the recorded movement segments by unit and compute positions at time t.
// Segment times are simulation minutes (warm-up included); points are a flat [x0, y0, x1, y1, ...] polyline in metres.

export interface Segment {
  u: string; k: "vessel" | "sts" | "veh" | "yc" | "truck"; t0: number; t1: number; s: string; p: number[];
  v?: number; b?: number; n?: number; open?: boolean;
}
export interface ReplayUnit { u: string; k: string; p: number[] }
export interface ReplayLayout {
  schematic: boolean; u: number[]; n: number[]; quay: number[][];
  berths: { code: string; a: number[]; b: number[] }[];
  blocks: { code: string; poly: number[][]; c: number[]; along_u?: boolean; width?: number }[];
  points: Record<string, number[]>; gate: number[]; road: number[][]; drawn_roads?: number[][];
  crane_points?: Record<string, number[]>; notes: string[];
}
export interface Replay {
  run_id: string; verified: boolean; seed: number; warmup_min: number; window_h: [number, number]; window_min: [number, number];
  layout: ReplayLayout; units: ReplayUnit[]; segments: Segment[]; truncated: boolean; ahead: Record<string, number>; notes: string[];
}

export interface Track { uid: string; kind: string; start: [number, number] | null; segs: Segment[] }
export interface UnitState {
  uid: string; kind: string; x: number; y: number; state: string; seg: Segment | null; moving: boolean;
  ang: number | null;   // heading in degrees while moving
}

export function buildTracks(r: Pick<Replay, "units" | "segments">): Track[] {
  const map = new Map<string, Track>();
  for (const un of r.units) map.set(un.u, { uid: un.u, kind: un.k, start: [un.p[0], un.p[1]], segs: [] });
  for (const s of r.segments) {
    let tr = map.get(s.u);
    if (!tr) { tr = { uid: s.u, kind: s.k, start: null, segs: [] }; map.set(s.u, tr); }
    tr.segs.push(s);
  }
  for (const tr of map.values()) tr.segs.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return [...map.values()].sort((a, b) => (a.uid < b.uid ? -1 : 1));
}

/** Point at fraction f (0..1) of the polyline length. */
export function along(p: number[], f: number): [number, number] {
  const n = p.length / 2;
  if (n <= 1) return [p[0], p[1]];
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = Math.hypot(p[2 * i + 2] - p[2 * i], p[2 * i + 3] - p[2 * i + 1]);
    lens.push(d); total += d;
  }
  if (total <= 0) return [p[0], p[1]];
  let rest = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] || i === lens.length - 1) {
      const g = lens[i] > 0 ? Math.min(1, rest / lens[i]) : 0;
      return [p[2 * i] + (p[2 * i + 2] - p[2 * i]) * g, p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * g];
    }
    rest -= lens[i];
  }
  return [p[p.length - 2], p[p.length - 1]];
}

/** Index of the last segment with t0 <= t (binary search), or -1. */
function lastStarted(segs: Segment[], t: number): number {
  let lo = 0, hi = segs.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].t0 <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const TRANSIENT = new Set(["vessel", "truck"]);

/** Position and state of a unit at time t; null when a transient unit (vessel, truck) is not in the terminal. */
export function stateAt(tr: Track, t: number): UnitState | null {
  const i = lastStarted(tr.segs, t);
  if (i >= 0) {
    // an earlier long segment may still be active (e.g. a vessel at berth while short segments follow)
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const s = tr.segs[j];
      if (t <= s.t1) {
        const f = s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 1;
        const [x, y] = along(s.p, f);
        let ang: number | null = null;
        if (s.p.length > 2) {
          const [x2, y2] = along(s.p, Math.min(1, f + 0.01));
          const [x1, y1] = f + 0.01 > 1 ? along(s.p, Math.max(0, f - 0.01)) : [x, y];
          if (Math.hypot(x2 - x1, y2 - y1) > 1e-6) ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        }
        return { uid: tr.uid, kind: tr.kind, x, y, state: s.s, seg: s, moving: s.p.length > 2, ang };
      }
    }
    if (TRANSIENT.has(tr.kind)) {
      // trucks between gate queue and drive have no gap; a gap means it left the terminal
      return null;
    }
    const s = tr.segs[i];
    return { uid: tr.uid, kind: tr.kind, x: s.p[s.p.length - 2], y: s.p[s.p.length - 1], state: "idle", seg: null, moving: false, ang: null };
  }
  if (tr.start && !TRANSIENT.has(tr.kind)) {
    return { uid: tr.uid, kind: tr.kind, x: tr.start[0], y: tr.start[1], state: "idle", seg: null, moving: false, ang: null };
  }
  return null;
}

export const STATE_LABEL: Record<string, string> = {
  wait: "chờ bến", berth: "đang làm hàng", move: "di chuyển", D: "dỡ hàng", L: "xếp hàng",
  empty: "chạy rỗng", loaded: "chạy có hàng", work: "nâng/hạ", queue: "chờ/qua cổng", drive: "chạy trong cảng", idle: "đứng chờ / rảnh",
};
export const KIND_LABEL: Record<string, string> = { vessel: "Tàu", sts: "Cẩu STS", veh: "Xe ngang", yc: "Cẩu bãi", truck: "Xe tải ngoài" };

export function clock(tMin: number, warmupMin: number): string {
  const m = Math.max(0, tMin - warmupMin);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = Math.floor(m % 60);
  return `Ngày ${d + 1} ${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Point-in-polygon (ray casting). */
export function inPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
