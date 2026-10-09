// V0.4: project georeference on the client (affine local ↔ projected; projections are done by the server)
// and map scale helpers for the 2D editor.

export interface GeorefOrigin { e?: number; n?: number; rotation_deg?: number; tm?: { type: "tm"; lon0: number; k0: number; fe?: number; fn?: number; datum?: string } }
export interface GeorefInfo {
  georeferenced: boolean; crs_epsg: number | null; origin: GeorefOrigin;
  crs: { code: string; name: string } | null; origin_lonlat: [number, number] | null;
}
export interface CrsItem { epsg: number; code: string; name: string; unit: string }

/** Local layout point (x right, y down, metres) → projected (E, N). Same formula as ctp_engine.gis.crs. */
export function localToProjected(x: number, y: number, o: GeorefOrigin): [number, number] {
  const th = ((o.rotation_deg || 0) * Math.PI) / 180;
  return [(o.e || 0) + x * Math.cos(th) + y * Math.sin(th), (o.n || 0) + x * Math.sin(th) - y * Math.cos(th)];
}

export function projectedToLocal(e: number, n: number, o: GeorefOrigin): [number, number] {
  const th = ((o.rotation_deg || 0) * Math.PI) / 180;
  const de = e - (o.e || 0), dn = n - (o.n || 0);
  return [de * Math.cos(th) + dn * Math.sin(th), de * Math.sin(th) - dn * Math.cos(th)];
}

/** Paper scale denominator at 96 dpi (1 px = 0.2646 mm) for a zoom in px per metre. */
export function scaleDenominator(zoomPxPerM: number): number {
  return zoomPxPerM > 0 ? 1 / (zoomPxPerM * 0.00026458) : 0;
}

/** A "round" scale-bar length (1, 2, 5 × 10^k m) about `targetPx` pixels long. */
export function niceBar(zoomPxPerM: number, targetPx = 120): { metres: number; px: number } {
  const raw = targetPx / Math.max(zoomPxPerM, 1e-9);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= raw).pop() || p;
  return { metres: m, px: m * zoomPxPerM };
}

export function roundScale(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return `1:${(Math.round(n / p) * p).toLocaleString("vi-VN")}`;
}
