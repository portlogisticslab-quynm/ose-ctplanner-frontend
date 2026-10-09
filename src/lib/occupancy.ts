// Block occupancy colour scale (V0.3.2), shared by the yard overview and the equipment animation.
const STOPS: [number, [number, number, number]][] = [
  [0.0, [22, 163, 74]],    // green  – empty
  [0.5, [234, 179, 8]],    // yellow – half
  [0.8, [249, 115, 22]],   // orange – near operational capacity
  [1.0, [220, 38, 38]],    // red    – at operational capacity
  [1.2, [127, 29, 29]],    // dark red – overflow
];

export function heat(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "#CBD5E1";
  const x = Math.max(0, Math.min(STOPS[STOPS.length - 1][0], v));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
    if (x <= b) {
      const f = (x - a) / (b - a);
      const c = ca.map((k, j) => Math.round(k + (cb[j] - k) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  const c = STOPS[STOPS.length - 1][1];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const HEAT_GRADIENT = `linear-gradient(to right, ${STOPS.map(([v]) => `${heat(v)} ${(v / 1.2) * 100}%`).join(", ")})`;

/** Occupancy of each block (by code) in one series frame; falls back to the whole-yard value. */
export function blockOccupancy(frame: { bo?: number[]; yard_occupancy: number | null } | undefined, codes: string[]): Map<string, number | null> {
  const m = new Map<string, number | null>();
  if (!frame) return m;
  codes.forEach((c, i) => m.set(c, frame.bo ? frame.bo[i] ?? null : frame.yard_occupancy));
  return m;
}

/** Index of the series frame at simulation minute t (frames start at the end of warm-up). */
export function frameIndex(frames: { t_h: number }[], tMin: number, warmupMin: number): number {
  if (frames.length < 2) return 0;
  const step = frames[1].t_h - frames[0].t_h || 0.5;
  const i = Math.round(((tMin - warmupMin) / 60 - frames[0].t_h) / step);
  return Math.max(0, Math.min(frames.length - 1, i));
}
