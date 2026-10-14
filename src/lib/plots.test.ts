import { describe, expect, it } from "vitest";
import { capacityPlots, comparePlot, errorBars, simResourceOf, simulationPlots, toCsv, yardPlanPlots } from "./plots";

const cap = {
  flows: { quay_teu: 500000 }, bottleneck: "yard", system_capacity_quay_teu: 394634,
  subsystems: [
    { code: "berth", name_vi: "Bến", utilization: 0.528, capacity_quay_teu: 946080, status: "ok", required: 2, available: 2 },
    { code: "yard", name_vi: "Bãi", utilization: 1.267, capacity_quay_teu: 394634, status: "over", required: 2737, available: 2160 },
    { code: "horizontal", name_vi: "Vận chuyển ngang", utilization: 0.416, capacity_quay_teu: 1200629, status: "ok" },
    { code: "yard_eq_RTG", name_vi: "Thiết bị bãi RTG", utilization: 0.778, capacity_quay_teu: 642717, status: "ok" },
  ],
  yard: { tgs_total: 2160, by_class: {
    import: { flow_teu: 225000, dwell_days: 5, tgs_required: 1219.3, tgs_dedicated: 0, mean_inventory_teu: 3082, peak_inventory_teu: 3699 },
    reefer: { flow_teu: 0, dwell_days: 4, tgs_required: 0, tgs_dedicated: 0, mean_inventory_teu: 0, peak_inventory_teu: 0 },
  } },
};
const sim = {
  bottleneck: "vehicle", params: { berths: 2, sts: 4, vehicles: 20, yard_cranes: 10, sts_cycle: 2.6667, sts_per_vessel: 3, yard_op_teu: 9360 },
  utilization: { berth: { mean: 0.82, ci_low: 0.71, ci_high: 0.94 }, vehicle: { mean: 0.84, ci_low: 0.75, ci_high: 0.93 }, yard_crane: { mean: 0.54, ci_low: null, ci_high: null } },
  kpis: [{ code: "SIM_VESSEL_WAIT_H", value: 59.3, unit: "h", ci_low: 13, ci_high: 105.6 }, { code: "SIM_GROSS_CRANE_PROD", value: 10.3, unit: "move/h", ci_low: 9.3, ci_high: 11.2 }],
  series: [
    { t_h: 0, berths_busy: 2, vessels_waiting: 4, sts_busy: 4, veh_busy: 20, veh_queue: 5, yc_busy: 3, yc_queue: 96, gate_in_queue: 0, inventory_teu: 12291, yard_occupancy: 1.313 },
    { t_h: 0.5, berths_busy: 2, vessels_waiting: 4, sts_busy: 4, veh_busy: 19, veh_queue: 2, yc_busy: 4, yc_queue: 90, gate_in_queue: 0, inventory_teu: 12300, yard_occupancy: null },
  ],
  block_occupancy_max: { A01: 1.43, A02: 1.46 }, block_codes: ["A01", "A02"],
  replications: [{ seed: 12345, kpis: { SIM_VESSEL_WAIT_H: 117.9 } }, { seed: 12346, kpis: { SIM_VESSEL_WAIT_H: 30.1 } }],
};

describe("plots", () => {
  it("maps static subsystems to simulated resources", () => {
    expect(simResourceOf("horizontal")).toBe("vehicle");
    expect(simResourceOf("yard_eq_RMG")).toBe("yard_crane");
    expect(simResourceOf("yard")).toBeNull();
  });

  it("builds capacity plots with the simulated series when a simulation is given", () => {
    const ps = capacityPlots(cap, sim);
    expect(ps.map((p) => p.id)).toEqual(["cap-util", "cap-capacity", "cap-tgs", "cap-inventory"]);
    const u = ps[0];
    const series = (u.option.series as { data: (number | null)[] }[]);
    expect(series).toHaveLength(2);
    expect(series[1].data).toEqual([0.82, null, 0.84, 0.54]);     // yard has no simulated utilisation
    expect(u.csv.rows[1]).toEqual(["Bãi", 1.267, null, "over", 2737, 2160]);
    expect(ps[3].csv.rows).toHaveLength(1);                         // classes without flow are left out
    expect(capacityPlots(cap, null)[0].title).toContain("tính tĩnh");
  });

  it("builds simulation plots and drops CI bars without bounds", () => {
    const ps = simulationPlots(sim);
    const ids = ps.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["sim-series", "sim-busy", "sim-inventory", "sim-util", "sim-vessel", "sim-prod", "sim-blocks", "sim-reps"]));
    const util = ps.find((p) => p.id === "sim-util")!;
    const eb = (util.option.series as { type: string; data: unknown[] }[]).find((s) => s.type === "custom")!;
    expect(eb.data).toHaveLength(2);
    const prod = ps.find((p) => p.id === "sim-prod")!;
    expect(prod.csv.rows[0][1]).toBeCloseTo(22.5, 1);                // 60 / sts_cycle
    expect(ps.find((p) => p.id === "sim-busy")!.csv.rows[0]).toEqual([0, 100, 100, 100, 30]);
  });

  it("yard plan, comparison and CSV", () => {
    const yp = {
      yard: { op_teu: 9360 }, required_op_teu: { import: 5284, empty: 2348 }, allocated_teu: { import: 5133, empty: 0 },
      occupancy: [0, 1].map((day) => ({ day, total_inventory_teu: 8301, occupancy: 0.887, by_class: {
        import: { inventory_teu: 3699, capacity_teu: 5133, occupancy: 0.72 }, empty: { inventory_teu: 1644, capacity_teu: 0, occupancy: null },
      } })),
      yard_cranes: { by_day: [{ day: 0, moves: 2520.5, peak_shift_moves: 840.2, required: 8 }], available: 10 },
    };
    expect(yardPlanPlots(yp).map((p) => p.id)).toEqual(["yp-inventory", "yp-occupancy", "yp-alloc", "yp-cranes"]);
    expect(yardPlanPlots(yp)[2].csv.rows[1]).toEqual(["Rỗng", 2348, 0, 2348]);
    const c = comparePlot("Tàu chờ", "h", [{ label: "A", value: 59.3, ci_low: 13, ci_high: 105.6 }, { label: "B", value: 12.2, ci_low: null, ci_high: null }]);
    expect((errorBars([[0, 1, 2], [1, null, 3]]).data as unknown[]).length).toBe(1);
    expect(toCsv(c.csv).startsWith("﻿")).toBe(true);
    expect(toCsv({ head: ["a"], rows: [['x,"y"']] })).toContain('"x,""y"""');
  });
});
