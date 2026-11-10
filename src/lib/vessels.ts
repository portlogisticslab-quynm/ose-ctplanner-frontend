// V1.6.4: one colour per vessel class, shared by the yard overview and the equipment animation so a vessel looks the
// same in both views (index = vessel class index of the run; runs without classes use index 0).
export const CLASS_COLORS = ["#1E3A8A", "#7C3AED", "#0F766E", "#C2410C", "#BE123C", "#4D7C0F"];
export const classColor = (i: number | null | undefined) => CLASS_COLORS[Math.max(0, i ?? 0) % CLASS_COLORS.length];

export const BERTH_RULE_LABEL: Record<string, string> = {
  order: "Theo thứ tự dọc mép bến",
  nearest_yard: "Gần bãi nhất",
  round_robin: "Luân phiên (bến rảnh lâu nhất)",
};
