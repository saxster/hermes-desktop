import { describe, expect, it } from "vitest";
import { dueDateKey, parseDue, parseDueParts } from "./taskUtils";

describe("task due dates", () => {
  it("normalizes every format advertised by Task Drawer", () => {
    expect(dueDateKey("Jul 12", 2026)).toBe("2026-07-12");
    expect(dueDateKey("Jul 12, 2027", 2026)).toBe("2027-07-12");
    expect(dueDateKey("2026-07-12", 2026)).toBe("2026-07-12");
  });

  it("rejects impossible dates", () => {
    expect(dueDateKey("Feb 30", 2026)).toBeNull();
    expect(dueDateKey("2026-02-30", 2026)).toBeNull();
  });

  it("uses both accepted formats in calendar and sort views", () => {
    expect(parseDueParts("Jul 12")).toEqual({ mon: 6, day: 12 });
    expect(parseDueParts("2026-07-12")).toEqual({ mon: 6, day: 12 });
    expect(parseDue("Jul 12")).toBe(parseDue("2026-07-12"));
  });
});
