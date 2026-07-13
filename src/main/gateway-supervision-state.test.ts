import { describe, expect, it } from "vitest";
import { reduceGatewaySupervisionState } from "./gateway-supervision-state";

describe("gateway supervision state", () => {
  it("preserves the original outage start across recovery attempts", () => {
    const outage = reduceGatewaySupervisionState(
      { status: "healthy" },
      "down",
      1_000,
    );
    const recovering = reduceGatewaySupervisionState(
      outage,
      "recovering",
      2_000,
    );

    expect(recovering).toMatchObject({
      status: "recovering",
      outageStartedAt: 1_000,
      lastCheckAt: 2_000,
    });
  });

  it("records a completed outage duration when health returns", () => {
    const recovered = reduceGatewaySupervisionState(
      { status: "outage", outageStartedAt: 1_000 },
      "healthy",
      4_500,
    );

    expect(recovered).toMatchObject({
      status: "healthy",
      recoveredAt: 4_500,
      lastOutageDurationMs: 3_500,
      lastHealthyAt: 4_500,
    });
    expect(recovered.outageStartedAt).toBeUndefined();
  });
});
