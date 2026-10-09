import { describe, expect, it } from "vitest";
import { localToProjected, niceBar, projectedToLocal, roundScale, scaleDenominator } from "./georef";

describe("georef", () => {
  it("matches the engine formula (y down = south) and round-trips with rotation", () => {
    expect(localToProjected(10, 20, { e: 697000, n: 2301500 })).toEqual([697010, 2301480]);
    const o = { e: 1000, n: 2000, rotation_deg: 30 };
    const [e, n] = localToProjected(123.4, -56.7, o);
    const [x, y] = projectedToLocal(e, n, o);
    expect(x).toBeCloseTo(123.4, 9);
    expect(y).toBeCloseTo(-56.7, 9);
  });

  it("computes map scale and a round scale bar", () => {
    expect(scaleDenominator(1)).toBeCloseTo(3779.5, 0);       // 1 px/m on a 96 dpi screen ≈ 1:3 780
    expect(niceBar(1)).toEqual({ metres: 100, px: 100 });
    expect(niceBar(2.5).metres).toBe(20);
    expect(roundScale(3779.5)).toBe("1:3.800");
  });
});
