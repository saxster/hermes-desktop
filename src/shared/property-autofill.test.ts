import { describe, expect, it } from "vitest";
import {
  autofillSchemaForFolder,
  parsePropertyAutofill,
} from "./property-autofill";

describe("parsePropertyAutofill", () => {
  it("keeps allowlisted delta updates only", () => {
    const updates = parsePropertyAutofill(
      {
        updates: [
          { key: "organization", value: "Bluebay" },
          { key: "email", value: "ravi@bluebay.example" },
          { key: "tags", value: "vip" }, // reserved, not allowlisted
          { key: "phone", value: 12345 }, // wrong type
        ],
      },
      "person",
      { organization: "Bluebay" }, // already set — delta dropped
    );
    expect(updates).toEqual([{ key: "email", value: "ravi@bluebay.example" }]);
  });

  it("coerces followUpAt from YYYY-MM-DD to epoch ms", () => {
    const updates = parsePropertyAutofill(
      { updates: [{ key: "followUpAt", value: "2026-08-01" }] },
      "person",
      {},
    );
    expect(updates).toEqual([
      { key: "followUpAt", value: Date.parse("2026-08-01T09:00:00") },
    ]);
  });

  it("drops a followUpAt that matches the current value", () => {
    const ms = Date.parse("2026-08-01T09:00:00");
    expect(
      parsePropertyAutofill(
        { updates: [{ key: "followUpAt", value: "2026-08-01" }] },
        "person",
        { followUpAt: ms },
      ),
    ).toEqual([]);
  });

  it("validates prio and due on project updates", () => {
    const updates = parsePropertyAutofill(
      {
        updates: [
          { key: "prio", value: "HIGH" },
          { key: "due", value: "next Friday" },
          { key: "status", value: "Blocked on permits" },
        ],
      },
      "project",
      {},
    );
    expect(updates).toEqual([
      { key: "prio", value: "high" },
      { key: "status", value: "Blocked on permits" },
    ]);
  });

  it("dedupes keys and caps the update count", () => {
    const updates = parsePropertyAutofill(
      {
        updates: [
          { key: "status", value: "one" },
          { key: "status", value: "two" },
          ...Array.from({ length: 10 }, (_, i) => ({
            key: "nextStep",
            value: `step ${i}`,
          })),
        ],
      },
      "project",
      {},
    );
    expect(updates[0]).toEqual({ key: "status", value: "one" });
    expect(updates.length).toBeLessThanOrEqual(6);
  });

  it("degrades garbage to an empty list", () => {
    expect(parsePropertyAutofill("nope", "person", {})).toEqual([]);
    expect(parsePropertyAutofill({ updates: "yes" }, "project", {})).toEqual(
      [],
    );
  });
});

describe("autofillSchemaForFolder", () => {
  it("maps supported folders and rejects others", () => {
    expect(autofillSchemaForFolder("people")).toBe("person");
    expect(autofillSchemaForFolder("projects")).toBe("project");
    expect(autofillSchemaForFolder("tasks")).toBe(null);
    expect(autofillSchemaForFolder("_inbox")).toBe(null);
  });
});
