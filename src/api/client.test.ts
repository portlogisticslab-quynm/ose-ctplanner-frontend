import { describe, expect, it } from "vitest";
import { isLongPath } from "./client";

describe("isLongPath (V1.4.2: long requests go straight to the VPS)", () => {
  it("routes slow endpoints directly", () => {
    for (const p of [
      "/api/v1/runs/abc/replay?t0_h=0&t1_h=12",
      "/api/v1/previews/preview-1a2b/replay?t0_h=0&t1_h=12",
      "/api/v1/previews/preview-1a2b/report?format=xlsx",
      "/api/v1/reports",
      "/api/v1/reports/r1/download",
      "/api/v1/scenarios/s1/imports",
      "/api/v1/imports/i1/commit",
      "/api/v1/scenarios/s1/demo-data",
      "/api/v1/scenarios/s1/cad/dxf/preview",
      "/api/v1/scenarios/s1/cad/export.dxf",
      "/api/v1/projects/p1/export",
      "/api/v1/projects/import",
      "/api/v1/file-runs/capacity",
      "/api/v1/compare",
      "/api/v1/scenarios/s1/status",
      "/api/v1/scenarios/s1/validate",
      "/api/v1/scenarios/s1/clone",
      "/api/v1/scenarios/s1/runs/capacity",
      "/api/v1/scenarios/s1/runs/yard-plan",
    ]) expect(isLongPath(p), p).toBe(true);
  });

  it("keeps ordinary requests on the Worker", () => {
    for (const p of [
      "/api/v1/auth/me", "/api/v1/projects", "/api/v1/runs/abc", "/api/v1/scenarios/s1/runs",
      "/api/v1/scenarios/s1/runs/simulation", "/api/v1/previews/preview-1a2b", "/api/v1/scenarios/s1/layout",
      "/api/health",
    ]) expect(isLongPath(p), p).toBe(false);
  });
});
