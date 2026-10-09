import { describe, expect, it } from "vitest";
import { area, blockDimensions, centroid, generateBlocks, rebuildBlock, rect, ringOf, translateGeom } from "./geometry";
import { useHistory } from "../store/history";

describe("geometry", () => {
  it("block footprint matches engine SAMPLE dimensions", () => {
    const d = blockDimensions({ equipment_system: "RTG", n_bay: 30, n_row: 6, n_tier_max: 5 });
    expect(d.length).toBeCloseTo(195);
    expect(d.width).toBeCloseTo(6 * 2.9 + 7);
  });

  it("rotated rectangle keeps area", () => {
    expect(area(rect(10, 20, 30, 10, 37))).toBeCloseTo(300, 3);
  });

  it("generates non-overlapping grid of blocks", () => {
    const props = { equipment_system: "RMG", n_bay: 10, n_row: 9, n_tier_max: 6 };
    const blocks = generateBlocks({ props, count: 4, perRow: 2, x0: 0, y0: 0, gapX: 10, gapY: 20, rotationDeg: 0, prefix: "M", startIndex: 1 });
    expect(blocks.map((b) => b.code)).toEqual(["M01", "M02", "M03", "M04"]);
    const c1 = centroid(ringOf(blocks[0].geom));
    const c2 = centroid(ringOf(blocks[1].geom));
    expect(c2[0] - c1[0]).toBeCloseTo(65 + 10);
  });

  it("translate and rebuild keep the centre", () => {
    const [b] = generateBlocks({ props: { equipment_system: "RTG", n_bay: 4, n_row: 6, n_tier_max: 5 }, count: 1, perRow: 1, x0: 0, y0: 0, gapX: 0, gapY: 0, rotationDeg: 0, prefix: "R", startIndex: 1 });
    const moved = { ...b, geom: translateGeom(b.geom, 100, 50) };
    const rotated = rebuildBlock(moved, 90);
    const c0 = centroid(ringOf(moved.geom));
    const c1 = centroid(ringOf(rotated.geom));
    expect(c1[0]).toBeCloseTo(c0[0]);
    expect(c1[1]).toBeCloseTo(c0[1]);
    expect(rotated.rotation_deg).toBe(90);
  });
});

describe("undo/redo history", () => {
  it("undo and redo restore snapshots", () => {
    const h = useHistory.getState();
    h.reset([]);
    useHistory.getState().commit([{ code: "A", object_type: "zone", layer: "default", rotation_deg: 0, props: {}, geom: { type: "Point", coordinates: [0, 0] } }]);
    useHistory.getState().commit([]);
    expect(useHistory.getState().objects).toHaveLength(0);
    useHistory.getState().undo();
    expect(useHistory.getState().objects).toHaveLength(1);
    useHistory.getState().redo();
    expect(useHistory.getState().objects).toHaveLength(0);
  });
});
