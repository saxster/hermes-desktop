import type { GatewayStartResult } from "../shared/gateway";
import type {
  EngineCapabilityState,
  EngineCapabilitySnapshot,
} from "../shared/engine-capabilities";
import type { EngineContractVerificationResult } from "../shared/engine-contract";
import { unknownEngineCapabilitySnapshot } from "../shared/engine-capabilities";
import {
  getConnectionConfig,
  getEngineCapabilityState,
  recordEngineCapabilitySnapshot,
  recordEngineContractVerification,
} from "./config";
import { refreshEngineCapabilities } from "./engine-capabilities";
import {
  verifyAndRecordEngineContract,
  verifyEngineContract,
} from "./engine-contract-verify";
import {
  isGatewayRunning,
  restartGateway,
  startGatewayWithRecovery,
  stopGateway,
} from "./hermes/gateway-process";
import { getInstalledEngineSha } from "./installer";

export interface CheckedGatewayStartResult extends GatewayStartResult {
  contractStatus: EngineContractVerificationResult["status"];
}

interface GatewayCompatibilityDependencies {
  getConnectionMode: () => "local" | "remote" | "ssh";
  getInstalledSha: () => Promise<string | null>;
  getCapabilityState: (profile?: string) => EngineCapabilityState;
  recordCapabilitySnapshot: (
    snapshot: EngineCapabilitySnapshot,
    profile?: string,
  ) => EngineCapabilityState;
  recordContractVerification: (
    verification: EngineContractVerificationResult,
    profile?: string,
  ) => EngineCapabilityState;
  verifyContract: (
    profile?: string,
    options?: Parameters<typeof verifyEngineContract>[1],
  ) => Promise<EngineContractVerificationResult>;
  verifyAndRecordContract: (
    profile?: string,
  ) => Promise<EngineContractVerificationResult>;
  refreshCapabilities: (profile?: string) => Promise<EngineCapabilityState>;
  isRunning: (profile?: string) => boolean;
  startWithRecovery: (profile?: string) => Promise<boolean>;
  restart: (profile?: string) => Promise<boolean>;
  stop: (profile?: string, force?: boolean) => void;
}

const defaultDependencies: GatewayCompatibilityDependencies = {
  getConnectionMode: () => getConnectionConfig().mode,
  getInstalledSha: () => getInstalledEngineSha(),
  getCapabilityState: (profile) => getEngineCapabilityState(profile),
  recordCapabilitySnapshot: (snapshot, profile) =>
    recordEngineCapabilitySnapshot(snapshot, profile),
  recordContractVerification: (verification, profile) =>
    recordEngineContractVerification(verification, profile),
  verifyContract: (profile, options) => verifyEngineContract(profile, options),
  verifyAndRecordContract: (profile) =>
    verifyAndRecordEngineContract(profile),
  refreshCapabilities: (profile) => refreshEngineCapabilities(profile),
  isRunning: (profile) => isGatewayRunning(profile),
  startWithRecovery: (profile) => startGatewayWithRecovery(profile),
  restart: (profile) => restartGateway(profile),
  stop: (profile, force) => stopGateway(profile, force),
};

function brokenContractMessage(
  verification: EngineContractVerificationResult,
): string {
  const broken = verification.findings
    .filter((finding) => finding.verdict === "broken")
    .map((finding) => `${finding.value}: ${finding.detail}`);
  return [
    "Hermes Agent compatibility verification failed; the gateway was not started.",
    ...broken,
  ].join(" ");
}

export async function startCompatibleGateway(
  profile?: string,
  dependencies: GatewayCompatibilityDependencies = defaultDependencies,
): Promise<CheckedGatewayStartResult> {
  if (dependencies.getConnectionMode() !== "local") {
    return {
      success: false,
      running: false,
      contractStatus: "unknown",
      error:
        "The checked local gateway launcher is only available in local connection mode.",
    };
  }

  const installedSha = await dependencies.getInstalledSha();
  const previousState = dependencies.getCapabilityState(profile);
  const changedEngine =
    installedSha !== null && installedSha !== previousState.lastVerifiedSha;

  let contractStatus: EngineContractVerificationResult["status"] =
    installedSha && installedSha === previousState.lastVerifiedSha
      ? previousState.lastVerification?.status || "passed"
      : "unknown";

  if (changedEngine) {
    dependencies.recordCapabilitySnapshot(
      unknownEngineCapabilitySnapshot(
        "local",
        installedSha,
        "Gateway capabilities have not been probed for this engine revision.",
      ),
      profile,
    );
    const prelaunch = await dependencies.verifyContract(profile, {
      getCapabilityState: dependencies.getCapabilityState,
    });
    dependencies.recordContractVerification(prelaunch, profile);
    contractStatus = prelaunch.status;
    if (prelaunch.status === "broken") {
      return {
        success: false,
        running: dependencies.isRunning(profile),
        contractStatus,
        error: brokenContractMessage(prelaunch),
      };
    }
  }

  const running = dependencies.isRunning(profile);
  const started =
    changedEngine && running
      ? await dependencies.restart(profile)
      : await dependencies.startWithRecovery(profile);
  if (!started) {
    return {
      success: false,
      running: false,
      contractStatus,
      error: "Hermes gateway did not become healthy after startup recovery.",
    };
  }

  if (changedEngine) {
    await dependencies.refreshCapabilities(profile);
    const postlaunch = await dependencies.verifyAndRecordContract(profile);
    contractStatus = postlaunch.status;
    if (postlaunch.status === "broken") {
      dependencies.stop(profile, true);
      return {
        success: false,
        running: false,
        contractStatus,
        error: brokenContractMessage(postlaunch),
      };
    }
  }

  return {
    success: true,
    running: true,
    alreadyRunning: running && !changedEngine,
    contractStatus,
  };
}
