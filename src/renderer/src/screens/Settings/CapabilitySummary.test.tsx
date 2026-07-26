import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  CapabilityRiskReport,
  CapabilityRiskSummary,
} from "../../../../shared/capability-risk";
import CapabilitySummary from "./CapabilitySummary";

function riskReport(
  overrides: Partial<CapabilityRiskReport> = {},
): CapabilityRiskReport {
  return {
    id: "mcp:desktop",
    kind: "mcp",
    name: "desktop",
    enabled: false,
    installedFingerprint: "abc",
    source: { localPath: "/opt/homebrew/bin/node" },
    status: "safe",
    updateStatus: "rescanPassed",
    reviewState: "needsReview",
    findings: [],
    summary: "No deterministic risk findings.",
    lastCheckedAt: 1,
    scanner: "deterministic-v1",
    ...overrides,
  };
}

function riskSummary(reports: CapabilityRiskReport[]): CapabilityRiskSummary {
  return {
    checkedAt: 1,
    reports,
    scanners: [],
    stats: {
      total: reports.length,
      safe: reports.filter((r) => r.status === "safe").length,
      warning: 0,
      blocked: 0,
      unreviewed: reports.filter((r) => r.reviewState !== "reviewed").length,
      updates: 0,
      failed: 0,
    },
  };
}

const api = {
  listInstalledSkills: vi.fn(),
  getToolsets: vi.fn(),
  listMcpServers: vi.fn(),
  getCapabilityRiskSummary: vi.fn(),
  listAutonomyGrants: vi.fn(),
  listAutonomyDecisions: vi.fn(),
  revokeAutonomyGrant: vi.fn(),
  checkCapabilityRisksNow: vi.fn(),
  reviewCapabilityRisk: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  api.listInstalledSkills.mockResolvedValue([{ name: "one" }]);
  api.getToolsets.mockResolvedValue([
    { key: "terminal", label: "Terminal", enabled: true },
  ]);
  api.listMcpServers.mockResolvedValue([
    { name: "web", type: "stdio", enabled: true },
  ]);
  api.getCapabilityRiskSummary.mockResolvedValue(null);
  api.listAutonomyGrants.mockResolvedValue([
    {
      contractVersion: 1,
      id: "grant-1",
      kind: "external-action",
      runId: "run-1",
      toolName: "mail.send",
      target: "recipient@example.com",
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    },
  ]);
  api.listAutonomyDecisions.mockResolvedValue([
    {
      contractVersion: 1,
      decisionId: "decision-1",
      runId: "run-1",
      mode: "SCOPED_AUTOMATION",
      risk: "UNKNOWN",
      action: "gateway-approval",
      allowed: false,
      needsUser: true,
      rule: "unknown-fails-closed",
      reason: "Unknown action.",
      createdAt: 1,
    },
  ]);
  api.revokeAutonomyGrant.mockResolvedValue(true);
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("CapabilitySummary autonomy visibility", () => {
  it("shows exact active grants and recent held actions, and supports revocation", async () => {
    render(<CapabilitySummary active profile="default" />);

    expect(
      await screen.findByText("1 active scoped grants"),
    ).toBeInTheDocument();
    expect(screen.getByText("1/1 recent actions held")).toBeInTheDocument();
    expect(
      screen.getByText(/mail\.send → recipient@example\.com/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.revokeAutonomyGrant).toHaveBeenCalledWith(
        "grant-1",
        "default",
      ),
    );
    expect(screen.getByText("0 active scoped grants")).toBeInTheDocument();
  });
});

describe("CapabilitySummary capability review", () => {
  it("reviews the capability whose button was pressed and drops the row", async () => {
    const desktop = riskReport();
    const other = riskReport({ id: "mcp:openalex", name: "openalex" });
    api.getCapabilityRiskSummary.mockResolvedValue(
      riskSummary([other, desktop]),
    );
    api.reviewCapabilityRisk.mockResolvedValue(
      riskSummary([
        other,
        riskReport({ reviewState: "reviewed", updateStatus: "current" }),
      ]),
    );

    render(<CapabilitySummary active profile="default" />);
    await screen.findByText("Review needed (2):");

    fireEvent.click(
      screen.getByRole("button", { name: "Mark desktop reviewed" }),
    );

    await waitFor(() =>
      expect(api.reviewCapabilityRisk).toHaveBeenCalledWith(
        "mcp:desktop",
        "default",
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Review needed (1):")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Mark desktop reviewed" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a failed review instead of silently leaving the row unchanged", async () => {
    api.getCapabilityRiskSummary.mockResolvedValue(riskSummary([riskReport()]));
    api.reviewCapabilityRisk.mockRejectedValue(new Error("registry is locked"));

    render(<CapabilitySummary active profile="default" />);
    await screen.findByText("Review needed (1):");

    fireEvent.click(
      screen.getByRole("button", { name: "Mark desktop reviewed" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't review desktop: registry is locked",
    );
    expect(
      screen.getByRole("button", { name: "Mark desktop reviewed" }),
    ).toBeInTheDocument();
  });
});
