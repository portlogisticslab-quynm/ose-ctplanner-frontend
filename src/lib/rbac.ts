// V1.0 project-level RBAC on the client (mirrors backend deps.CAPS). Global admins are "owner" everywhere.
import type { ProjectRole } from "../api/types";

export type Cap = "read" | "write" | "run" | "review" | "manage";
export const CAPS: Record<Cap, ProjectRole[]> = {
  read: ["owner", "planner", "analyst", "reviewer", "viewer"],
  write: ["owner", "planner"],
  run: ["owner", "planner", "analyst"],
  review: ["owner", "reviewer"],
  manage: ["owner"],
};
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Chủ sở hữu", planner: "Quy hoạch", analyst: "Phân tích", reviewer: "Duyệt", viewer: "Xem",
};
export const PROJECT_ROLE_HINT: Record<ProjectRole, string> = {
  owner: "toàn quyền dự án, quản lý thành viên, xem nhật ký",
  planner: "sửa dữ liệu, mặt bằng, chạy tính toán",
  analyst: "chạy tính toán, mô phỏng, báo cáo",
  reviewer: "duyệt / lưu trữ phương án",
  viewer: "chỉ xem",
};

export function allowed(role: ProjectRole | null | undefined, cap: Cap, opts: { sample?: boolean; admin?: boolean } = {}): boolean {
  if (!role) return false;
  if (cap !== "read" && opts.sample && !opts.admin) return false;
  return CAPS[cap].includes(role);
}
