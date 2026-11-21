import { describe, expect, it } from "vitest";
import golden from "./sizing.golden.json";
import { compute, inputsFromScenario, maxOccupancy, normalize, SizingInputError, tryCompute, wsRatio, type SizingResult } from "./sizing";

// The engine (ctp_engine/sizing.py) wrote these numbers; the browser copy must give the same (6 significant digits).
function digest(r: SizingResult) {
  const b = r.berth;
  return {
    vessels: { cap_avg_teu: r.vessels.cap_avg_teu, loa_mean_m: r.vessels.loa_mean_m, call_teu: r.vessels.call_teu, moves_per_call: r.vessels.moves_per_call, calls_year: r.vessels.calls_year },
    berth: { service_h: b.service_h, n_berths: b.n_berths, occupancy: b.occupancy,
      table: b.table.map((t) => ({ n: t.n, occupancy: t.occupancy, ws: t.ws, ok: t.ok, thoresen_ok: t.thoresen_ok, occupancy_max: t.occupancy_max, capacity_teu: t.capacity_teu })) },
    classes: r.vessels.classes.map((pc) => [pc.sts_used, pc.service_h]),
    quay: { length_wg185_m: r.quay.length_wg185_m, length_fixed_m: r.quay.length_fixed_m, length_mixed_m: r.quay.length_mixed_m, length_m: r.quay.length_m, apron_m: r.quay.apron_m, teu_per_m: r.quay.teu_per_m },
    sts: { count: r.sts.count, by_berth: r.sts.by_berth, by_throughput: r.sts.by_throughput, per_berth: r.sts.per_berth },
    berths: r.layout.berths.map((b) => [b.code, b.x0, b.x1, b.sts]),
    flows: r.yard.flows.map((f) => ({ key: f.key, teu_year: f.teu_year, inventory_teu: f.inventory_teu, capacity_teu: f.capacity_teu, ground_slots: f.ground_slots, a_teu_m2: f.a_teu_m2, area_b_m2: f.area_b_m2 })),
    groups: Object.fromEntries(Object.entries(r.yard.groups).map(([k, v]) => [k, { blocks: v.blocks, block_length_m: v.block_length_m, block_width_m: v.block_width_m, ground_slots: v.ground_slots }])),
    yard: { area_method_a_m2: r.yard.area_method_a_m2, area_method_b_m2: r.yard.area_method_b_m2, capacity_teu: r.yard.capacity_teu, inventory_teu: r.yard.inventory_teu },
    equipment: r.equipment.map((e) => [e.category, e.quantity]),
    gate: { lanes_in: r.gate.lanes_in, lanes_out: r.gate.lanes_out, peak_per_hour: r.gate.peak_per_hour },
    areas: { width_m: r.areas.width_m, depth_m: r.areas.depth_m, total_m2: r.areas.total_m2, m2_per_m: r.areas.m2_per_m },
    benchmarks: r.benchmarks.map((x) => [x.key, x.value, x.ok]),
    warnings: r.warnings.map((w) => w.code),
    blocks: r.layout.blocks.map((x) => [x.code, x.cx, x.cy, x.rotation_deg]),
    site_fits: r.site.fits,
  };
}

function same(a: unknown, b: unknown, path: string): void {
  if (typeof a === "number" && typeof b === "number") {
    const tol = Math.max(1e-9, Math.abs(b) * 2e-5);
    if (Math.abs(a - b) > tol) throw new Error(`${path}: ${a} ≠ ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) throw new Error(`${path}: length ${a.length} ≠ ${b.length}`);
    a.forEach((v, i) => same(v, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
    if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka} ≠ ${kb}`);
    for (const k of ka) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  if (a !== b) throw new Error(`${path}: ${String(a)} ≠ ${String(b)}`);
}

describe("sizing – same results as the engine", () => {
  for (const [name, c] of Object.entries((golden as { cases: Record<string, { inputs: unknown; expected: unknown }> }).cases)) {
    it(name, () => {
      expect(() => same(digest(compute(c.inputs)), c.expected, name)).not.toThrow();
    });
  }
});

describe("sizing – formulas", () => {
  it("reproduces PIANC 135 Table 3.10 and its 10 % limits", () => {
    expect(wsRatio(2, 0.6)).toBeCloseTo(0.22, 10);
    expect(wsRatio(3, 1)).toBe(Infinity);
    expect(maxOccupancy(2, 0.1)).toBeCloseTo(0.4667, 3);
    expect(wsRatio(2, 0.5, "none")).toBeCloseTo(0.18, 10);
    expect(wsRatio(2, 0.5, "high")).toBeCloseTo(0.084, 10);
  });

  it("fills STS by vessel size when a class gives none", () => {
    const r = compute({ vessels: { classes: [{ name: "A", capacity_teu: 400, loa_m: 118, beam_m: 20, draft_m: 7, share: 1 }] } });
    expect(r.vessels.classes[0].sts).toBe(1);
  });

  it("defaults give a CT15-like terminal", () => {
    const r = compute({});
    expect(r.berth.n_berths).toBe(4);
    expect(r.quay.length_m).toBe(810);
    expect(r.sts.count).toBe(8);
  });

  it("collects input problems and accepts a decimal comma", () => {
    expect(() => normalize({ cargo: { throughput_teu: -1 } })).toThrow(SizingInputError);
    const t = tryCompute({ cargo: { throughput_teu: -1 }, yard: { system: "X" } });
    expect(t.result).toBeNull();
    expect(t.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["cargo.throughput_teu", "yard.system"]));
    expect(normalize({ cargo: { teu_factor: "1,6" } }).cargo.teu_factor).toBe(1.6);
  });

  it("maps ctplanner scenario inputs", () => {
    const m = inputsFromScenario({ demand: { annual_quay_teu: 500000, mix: { import: 0.5, export: 0.4, empty: 0.1 } },
      vessels: [{ name: "Panamax", loa_m: 250, capacity_teu: 4500, share: 1 }], quay: { clearance_m: 15 } }, { code: "P1", name: "Dự án 1" });
    expect(m.cargo.throughput_teu).toBe(500000);
    expect(m.vessels.classes[0].capacity_teu).toBe(4500);
    expect(m.berth.gap_m).toBe(15);
    expect(m.project).toEqual({ code: "P1", name: "Dự án 1" });
    expect(compute(m).berth.n_berths).toBeGreaterThan(0);
  });
});
