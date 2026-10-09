export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return "∞";
  if (Number.isInteger(v) || Math.abs(v) >= 1000) return Math.round(v).toLocaleString("vi-VN");
  return v.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("vi-VN");
}

export const CLASS_LABEL: Record<string, string> = {
  import: "Nhập", export: "Xuất", transship: "Trung chuyển", empty: "Rỗng", reefer: "Lạnh", dg: "Nguy hiểm", oog: "Quá khổ", mixed: "Hỗn hợp",
};
export const CLASS_COLOR: Record<string, string> = {
  import: "#2E86C1", export: "#E67E22", transship: "#8E44AD", empty: "#95A5A6", reefer: "#16A085", dg: "#C0392B", oog: "#D4AC0D", mixed: "#5D6D7E",
};
export const STATUS_LABEL: Record<string, string> = { draft: "Nháp", validated: "Đã kiểm tra", approved: "Đã duyệt", archived: "Lưu trữ" };
export const ROLE_LABEL: Record<string, string> = { admin: "Quản trị", planner: "Quy hoạch", analyst: "Phân tích", reviewer: "Duyệt", viewer: "Xem" };

export const OBJECT_TYPES: { value: string; label: string; kind: "polygon" | "line" | "point"; color: string }[] = [
  { value: "boundary", label: "Ranh giới", kind: "polygon", color: "#1B2631" },
  { value: "yard_block", label: "Block bãi", kind: "polygon", color: "#5D6D7E" },
  { value: "berth", label: "Bến", kind: "polygon", color: "#1F618D" },
  { value: "apron", label: "Apron", kind: "polygon", color: "#AED6F1" },
  { value: "gate", label: "Cổng", kind: "polygon", color: "#117A65" },
  { value: "building", label: "Công trình", kind: "polygon", color: "#7D6608" },
  { value: "cfs", label: "CFS", kind: "polygon", color: "#A04000" },
  { value: "depot", label: "Depot", kind: "polygon", color: "#6E2C00" },
  { value: "workshop", label: "Xưởng", kind: "polygon", color: "#4A235A" },
  { value: "rail_yard", label: "Bãi đường sắt", kind: "polygon", color: "#424949" },
  { value: "restricted_zone", label: "Vùng cấm", kind: "polygon", color: "#C0392B" },
  { value: "buffer", label: "Vùng đệm", kind: "polygon", color: "#F5B7B1" },
  { value: "zone", label: "Khu chức năng", kind: "polygon", color: "#D5D8DC" },
  { value: "quay_wall", label: "Mép bến", kind: "line", color: "#154360" },
  { value: "rail_track", label: "Đường ray", kind: "line", color: "#424949" },
  { value: "road_centerline", label: "Tim đường", kind: "line", color: "#B7950B" },
  { value: "sts_rail", label: "Ray STS", kind: "line", color: "#21618C" },
  { value: "transfer_point", label: "Điểm chuyển tải", kind: "point", color: "#E74C3C" },
  { value: "vessel_position", label: "Vị trí tàu", kind: "point", color: "#2874A6" },
  { value: "equipment_position", label: "Vị trí thiết bị", kind: "point", color: "#7B241C" },
];
export const TYPE_INFO = Object.fromEntries(OBJECT_TYPES.map((t) => [t.value, t]));
