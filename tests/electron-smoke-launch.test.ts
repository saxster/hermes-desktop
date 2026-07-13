import { describe, expect, it, vi } from "vitest";
import { launchElectronSmoke } from "../scripts/lib/electron-smoke-launch.mjs";

describe("launchElectronSmoke", () => {
  it("retries one transient launch failure", async () => {
    const app = { firstWindow: vi.fn() };
    const electron = {
      launch: vi
        .fn()
        .mockRejectedValueOnce(new Error("transient launch failure"))
        .mockResolvedValueOnce(app),
    };

    await expect(
      launchElectronSmoke(electron, { args: ["."] }, { retryDelayMs: 0 }),
    ).resolves.toBe(app);
    expect(electron.launch).toHaveBeenCalledTimes(2);
  });

  it("reports both failures after the bounded retry", async () => {
    const electron = {
      launch: vi
        .fn()
        .mockRejectedValueOnce(new Error("first"))
        .mockRejectedValueOnce(new Error("second")),
    };

    await expect(
      launchElectronSmoke(electron, { args: ["."] }, { retryDelayMs: 0 }),
    ).rejects.toThrow("failed to launch twice");
  });
});
