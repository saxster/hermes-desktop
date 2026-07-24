import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CapabilitySummary from "./CapabilitySummary";

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
