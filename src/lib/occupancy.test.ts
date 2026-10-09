import { describe, expect, it } from "vitest";
import { blockOccupancy, frameIndex, heat } from "./occupancy";

describe("occupancy colours", () => {
  it("maps the scale end points and clamps", () => {
    expect(heat(0)).toBe("rgb(22,163,74)");
    expect(heat(1)).toBe("rgb(220,38,38)");
    expect(heat(5)).toBe("rgb(127,29,29)");
    expect(heat(null)).toBe("#CBD5E1");
    expect(heat(0.25)).not.toBe(heat(0.75));
  });

  it("uses per-block values when present, else the whole yard", () => {
    expect(blockOccupancy({ bo: [0.2, 0.9], yard_occupancy: 0.5 }, ["A", "B"]).get("B")).toBe(0.9);
    expect(blockOccupancy({ yard_occupancy: 0.5 }, ["A"]).get("A")).toBe(0.5);
  });

  it("finds the frame of a replay time", () => {
    const frames = [{ t_h: 0 }, { t_h: 0.5 }, { t_h: 1 }, { t_h: 1.5 }];
    expect(frameIndex(frames, 1440 + 60, 1440)).toBe(2);
    expect(frameIndex(frames, 0, 1440)).toBe(0);
    expect(frameIndex(frames, 99999, 1440)).toBe(3);
  });
});
