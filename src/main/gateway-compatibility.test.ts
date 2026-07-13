import { describe, expect, it, vi } from "vitest";
import type { EngineCapabilityState } from "../shared/engine-capabilities";
import type { EngineContractVerificationResult } from "../shared/engine-contract";
import { unknownEngineCapabilitySnapshot } from "../shared/engine-capabilities";
import { startCompatibleGateway } from "./gateway-compatibility";

type TestDependencies = NonNullable<
  Parameters<typeof startCompatibleGateway>[1]
>;

function verification(
  status: EngineContractVerificationResult["status"],
): EngineContractVerificationResult {
  return {
    checkedAt: "2026-07-13T00:00:00.000Z",
    status,
    findings:
      status === "broken"
        ? [
            {
              entryId: "gateway",
              kind: "cli",
              value: "gateway run",
              tier: "fail",
              verdict: "broken",
              detail: "command missing",
            },
          ]
        : [],
  };
}

function harness(options: {
  installedSha?: string | null;
  lastVerifiedSha?: string | null;
  prelaunch?: EngineContractVerificationResult["status"];
  postlaunch?: EngineContractVerificationResult["status"];
  running?: boolean;
} = {}): {
  dependencies: TestDependencies;
  getState: () => EngineCapabilityState;
} {
  let state: EngineCapabilityState = {
    installedSha: options.installedSha ?? "new-sha",
    lastVerifiedSha: options.lastVerifiedSha ?? "old-sha",
    lastVerification: verification("passed"),
    snapshot: unknownEngineCapabilitySnapshot(),
  };
  const dependencies: TestDependencies = {
    getConnectionMode: vi.fn(() => "local" as const),
    getInstalledSha: vi.fn(async () => options.installedSha ?? "new-sha"),
    getCapabilityState: vi.fn(() => state),
    recordCapabilitySnapshot: vi.fn((snapshot) => {
      state = { ...state, installedSha: snapshot.engineSha, snapshot };
      return state;
    }),
    recordContractVerification: vi.fn((result) => {
      state = { ...state, lastVerification: result };
      return state;
    }),
    verifyContract: vi.fn(async () => verification(options.prelaunch ?? "unknown")),
    verifyAndRecordContract: vi.fn(async () =>
      verification(options.postlaunch ?? "passed"),
    ),
    refreshCapabilities: vi.fn(async () => state),
    isRunning: vi.fn(() => options.running ?? false),
    startWithRecovery: vi.fn(async () => true),
    restart: vi.fn(async () => true),
    stop: vi.fn(),
  };
  return { dependencies, getState: () => state };
}

describe("startCompatibleGateway", () => {
  it("blocks a changed engine when the pre-launch CLI contract is broken", async () => {
    const { dependencies } = harness({ prelaunch: "broken" });

    const result = await startCompatibleGateway("work", dependencies);

    expect(result).toMatchObject({
      success: false,
      running: false,
      contractStatus: "broken",
    });
    expect(result.error).toContain("gateway run: command missing");
    expect(dependencies.startWithRecovery).not.toHaveBeenCalled();
  });

  it("restarts a running gateway after a checkout change and verifies HTTP after launch", async () => {
    const { dependencies } = harness({ running: true });

    const result = await startCompatibleGateway("work", dependencies);

    expect(result).toMatchObject({
      success: true,
      running: true,
      contractStatus: "passed",
    });
    expect(dependencies.restart).toHaveBeenCalledWith("work");
    expect(dependencies.refreshCapabilities).toHaveBeenCalledWith("work");
    expect(dependencies.verifyAndRecordContract).toHaveBeenCalledWith("work");
  });

  it("stops the gateway when the post-launch HTTP contract is broken", async () => {
    const { dependencies } = harness({ postlaunch: "broken" });

    const result = await startCompatibleGateway("work", dependencies);

    expect(result.contractStatus).toBe("broken");
    expect(result.success).toBe(false);
    expect(dependencies.stop).toHaveBeenCalledWith("work", true);
  });

  it("uses the normal recovery path for an already verified revision", async () => {
    const { dependencies } = harness({
      installedSha: "same-sha",
      lastVerifiedSha: "same-sha",
      running: true,
    });

    const result = await startCompatibleGateway("work", dependencies);

    expect(result).toMatchObject({
      success: true,
      alreadyRunning: true,
      contractStatus: "passed",
    });
    expect(dependencies.startWithRecovery).toHaveBeenCalledWith("work");
    expect(dependencies.verifyContract).not.toHaveBeenCalled();
    expect(dependencies.refreshCapabilities).not.toHaveBeenCalled();
  });
});
