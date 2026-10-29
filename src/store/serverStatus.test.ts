import { describe, expect, it } from "vitest";
import { useServerStatus } from "./serverStatus";

describe("serverStatus (V1.4.2)", () => {
  it("clears a sticky read-only flag when the main server answers again", () => {
    const s = useServerStatus.getState();
    s.setServedBy("home");
    s.setReadOnly(true);                       // e.g. one READ_ONLY_BACKUP answer
    expect(useServerStatus.getState().readOnly).toBe(true);
    useServerStatus.getState().setServedBy("home");   // next response from the main server
    expect(useServerStatus.getState().readOnly).toBe(false);
  });

  it("keeps the read-only flag while the backup answers", () => {
    useServerStatus.getState().setServedBy("render");
    useServerStatus.getState().setReadOnly(true);
    useServerStatus.getState().setServedBy("render");
    expect(useServerStatus.getState().readOnly).toBe(true);
    expect(useServerStatus.getState().servedBy).toBe("render");
  });
});
