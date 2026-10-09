import { describe, expect, it } from "vitest";
import { along, buildTracks, clock, inPoly, stateAt, type Segment } from "./replay";

const seg = (u: string, k: Segment["k"], t0: number, t1: number, s: string, p: number[]): Segment => ({ u, k, t0, t1, s, p });

describe("replay", () => {
  it("interpolates along a polyline by length", () => {
    const p = [0, 0, 10, 0, 10, 30];          // 10 m then 30 m
    expect(along(p, 0)).toEqual([0, 0]);
    expect(along(p, 0.25)).toEqual([10, 0]);
    expect(along(p, 0.5)[1]).toBeCloseTo(10);
    expect(along(p, 1)).toEqual([10, 30]);
    expect(along([5, 5], 0.7)).toEqual([5, 5]);
  });

  it("positions a vehicle during, between and before its movements", () => {
    const tr = buildTracks({
      units: [{ u: "V-001", k: "veh", p: [1, 1] }],
      segments: [seg("V-001", "veh", 10, 20, "loaded", [0, 0, 100, 0]), seg("V-001", "veh", 30, 40, "empty", [100, 0, 100, 50])],
    })[0];
    expect(stateAt(tr, 5)).toMatchObject({ x: 1, y: 1, state: "idle" });
    expect(stateAt(tr, 15)).toMatchObject({ x: 50, y: 0, state: "loaded", moving: true });
    expect(stateAt(tr, 25)).toMatchObject({ x: 100, y: 0, state: "idle" });
    expect(stateAt(tr, 35)).toMatchObject({ x: 100, y: 25, state: "empty" });
    expect(stateAt(tr, 99)).toMatchObject({ x: 100, y: 50, state: "idle" });
  });

  it("shows transient units only while they have a segment", () => {
    const [tr] = buildTracks({ units: [], segments: [seg("XT-1", "truck", 10, 12, "queue", [5, 5]), seg("XT-1", "truck", 12, 20, "drive", [5, 5, 5, 85])] });
    expect(stateAt(tr, 9)).toBeNull();
    expect(stateAt(tr, 11)?.state).toBe("queue");
    expect(stateAt(tr, 16)?.y).toBeCloseTo(45);
    expect(stateAt(tr, 21)).toBeNull();
  });

  it("keeps a long vessel segment active while later segments start", () => {
    const [tr] = buildTracks({ units: [], segments: [seg("VS-1", "vessel", 0, 100, "berth", [0, 0])] });
    expect(stateAt(tr, 50)?.state).toBe("berth");
  });

  it("formats the clock after warm-up", () => {
    expect(clock(1440 + 75, 1440)).toBe("Ngày 1 01:15");
    expect(clock(1440 * 3 + 60, 1440)).toBe("Ngày 3 01:00");
  });

  it("gives the heading of a moving vehicle along its lane", () => {
    const [tr] = buildTracks({ units: [], segments: [seg("V-1", "veh", 0, 10, "loaded", [0, 0, 100, 0, 100, 100])] });
    expect(stateAt(tr, 2)?.ang).toBeCloseTo(0);
    expect(stateAt(tr, 8)?.ang).toBeCloseTo(90);
    expect(stateAt(tr, 10)?.ang).toBeCloseTo(90);
  });

  it("finds the block containing a yard crane", () => {
    const sq = [[0, 0], [10, 0], [10, 5], [0, 5]];
    expect(inPoly(5, 2.5, sq)).toBe(true);
    expect(inPoly(11, 2.5, sq)).toBe(false);
  });
});
