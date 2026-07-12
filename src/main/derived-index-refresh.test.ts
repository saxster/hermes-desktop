import { describe, expect, it, vi } from "vitest";
import { bestEffortDerivedIndexRefresh } from "./derived-index-refresh";

describe("bestEffortDerivedIndexRefresh", () => {
  it("publishes a successful derived-index refresh", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await bestEffortDerivedIndexRefresh(
      async () => ({ notes: 1 }),
      onSuccess,
      onFailure,
    );

    expect(onSuccess).toHaveBeenCalledWith({ notes: 1 });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("contains a refresh failure so the durable write remains successful", async () => {
    const failure = new Error("index unavailable");
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await expect(
      bestEffortDerivedIndexRefresh(
        async () => {
          throw failure;
        },
        onSuccess,
        onFailure,
      ),
    ).resolves.toBeUndefined();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});
