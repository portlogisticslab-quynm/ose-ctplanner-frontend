import { describe, expect, it } from "vitest";
import { allowed } from "./rbac";

describe("project RBAC", () => {
  it("matches the backend capability table", () => {
    expect(allowed("planner", "write")).toBe(true);
    expect(allowed("analyst", "write")).toBe(false);
    expect(allowed("analyst", "run")).toBe(true);
    expect(allowed("reviewer", "review")).toBe(true);
    expect(allowed("planner", "manage")).toBe(false);
    expect(allowed("owner", "manage")).toBe(true);
    expect(allowed(null, "read")).toBe(false);
  });
  it("keeps the sample project read-only except for admins", () => {
    expect(allowed("owner", "write", { sample: true })).toBe(false);
    expect(allowed("owner", "write", { sample: true, admin: true })).toBe(true);
    expect(allowed("viewer", "read", { sample: true })).toBe(true);
  });
});
