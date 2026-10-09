import { describe, expect, it } from "vitest";
import type { LayoutObject } from "../api/types";
import { buildScene, rectFrame } from "./scene3d";

const poly = (code: string, type: string, pts: number[][], props: Record<string, unknown> = {}): LayoutObject =>
  ({ code, object_type: type, layer: "x", geom: { type: "Polygon", coordinates: [[...pts, pts[0]]] }, props, rotation_deg: 0 } as LayoutObject);
const line = (code: string, type: string, pts: number[][]): LayoutObject =>
  ({ code, object_type: type, layer: "x", geom: { type: "LineString", coordinates: pts }, props: {}, rotation_deg: 0 } as LayoutObject);

const BLOCK = poly("A01", "yard_block", [[60, 100], [255, 100], [255, 124.4], [60, 124.4]],
  { equipment_system: "RTG", n_bay: 30, n_row: 6, n_tier_max: 5, elevation_m: 4.5 });
const LAYOUT = [
  BLOCK,
  poly("B1", "berth", [[40, -30], [400, -30], [400, 0], [40, 0]]),
  line("Q", "quay_wall", [[40, 0], [760, 0]]),
  poly("NHA", "building", [[60, 300], [130, 300], [130, 340], [60, 340]]),
];

describe("3D scene", () => {
  it("finds the long axis of a block", () => {
    const f = rectFrame([[60, 100], [255, 100], [255, 124.4], [60, 124.4]]);
    expect(f.len).toBeCloseTo(195);
    expect(f.wid).toBeCloseTo(24.4);
  });

  it("stacks one container per slot and tier at full fill, none when empty", () => {
    const full = buildScene(LAYOUT, { fill: 2, stsCount: 0, rtgCount: 0, vessels: false });
    expect(full.containers.length).toBe(30 * 6 * 5);
    expect(Math.min(...full.containers.map((c) => c.y))).toBeCloseTo(4.5 + 0.25 + 2.59 / 2);   // on the block's elevation
    expect(buildScene(LAYOUT, { fill: -1, stsCount: 0, rtgCount: 0, vessels: false }).containers.length).toBe(0);
  });

  it("puts water on the far side of the quay and cranes / vessels at the berth", () => {
    const s = buildScene(LAYOUT, { fill: 0.5, stsCount: 3, rtgCount: 4, vessels: true });
    expect(s.water).not.toBeNull();
    const wz = s.water!.pts.map((p) => p[1]);
    expect(Math.min(...wz)).toBeLessThan(0);                 // yard is at z > 0, water at z < 0
    const sts = s.cranes.filter((c) => c.kind === "sts");
    expect(sts.length).toBe(3);
    sts.forEach((c) => { expect(c.z).toBeCloseTo(15); expect(c.x).toBeGreaterThan(40); expect(c.x).toBeLessThan(400); });
    expect(s.cranes.filter((c) => c.kind === "rtg").length).toBe(3);   // at most 3 per block
    expect(s.vessels[0].z).toBeLessThan(0);
    const nha = s.prims.find((p) => p.code === "NHA");
    expect(nha && nha.kind === "extrude" ? nha.height : 0).toBe(8);
    expect(s.extent.maxY).toBeGreaterThanOrEqual(48);
  });
});
