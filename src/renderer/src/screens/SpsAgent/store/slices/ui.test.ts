import { beforeEach, describe, expect, it, vi } from "vitest";

describe("initial SPS surface", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("uses the persisted home-surface preference", async () => {
    localStorage.setItem(
      "sps-agent-tweaks-v1",
      JSON.stringify({ homeSurface: "cockpit" }),
    );

    const { useStore } = await import("../index");

    expect(useStore.getState().surface).toBe("cockpit");
  });

  it("opens the operator cockpit for a new profile", async () => {
    const { useStore } = await import("../index");

    expect(useStore.getState().surface).toBe("cockpit");
  });
});
