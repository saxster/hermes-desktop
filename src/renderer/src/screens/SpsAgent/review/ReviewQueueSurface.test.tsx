import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewQueueSurface } from "./ReviewQueueSurface";

const chatApi = vi.hoisted(() => ({
  respondApproval: vi.fn(),
}));

vi.mock("../../../lib/api/chat", () => chatApi);

const store = vi.hoisted(() => ({
  ingestCommitPage: vi.fn(),
  flash: vi.fn(),
  setSurface: vi.fn(),
  selectPage: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

describe("ReviewQueueSurface", () => {
  const listAttention = vi.fn();
  const resolveAttention = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listAttention.mockResolvedValue([
      {
        contractVersion: 1,
        id: "attention-1",
        profile: "default",
        kind: "failed-run",
        status: "pending",
        source: "active-work",
        title: "Morning briefing failed",
        summary: "The required skill is missing.",
        idempotencyKey: "run-1:failed:1",
        runId: "run-1",
        choices: [
          { id: "review-run", label: "Review run", tone: "primary" },
          { id: "dismiss", label: "Dismiss" },
        ],
        resume: { kind: "active-work", ref: "run-1" },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    resolveAttention.mockResolvedValue({ ok: true });
    chatApi.respondApproval.mockResolvedValue({ ok: true });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsListVaultProposals: vi.fn().mockResolvedValue([]),
        spsListHumanAttention: listAttention,
        spsResolveHumanAttention: resolveAttention,
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("shows durable assistant check-ins and resolves a declared choice", async () => {
    render(<ReviewQueueSurface />);
    expect(
      await screen.findByText("Morning briefing failed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The required skill is missing."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review run" }));
    await waitFor(() =>
      expect(resolveAttention).toHaveBeenCalledWith(
        "attention-1",
        { choiceId: "review-run" },
        "default",
      ),
    );
    expect(store.setSurface).toHaveBeenCalledWith("activeWork");
  });

  it("shows a truthful empty state", async () => {
    listAttention.mockResolvedValue([]);
    render(<ReviewQueueSurface />);
    expect(
      await screen.findByText("Nothing needs your attention."),
    ).toBeInTheDocument();
  });

  it("answers a Hermes approval upstream before resolving the inbox item", async () => {
    listAttention.mockResolvedValue([
      {
        contractVersion: 1,
        id: "approval-1",
        profile: "default",
        kind: "approval",
        status: "pending",
        source: "hermes-run-event",
        title: "Hermes needs approval",
        summary: "Run the requested command.",
        idempotencyKey: "hermes-approval:run-1:req-1",
        runId: "run-1",
        requestId: "req-1",
        choices: [
          { id: "once", label: "Allow once", tone: "primary" },
          { id: "deny", label: "Deny", tone: "danger" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(<ReviewQueueSurface />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));

    await waitFor(() =>
      expect(chatApi.respondApproval).toHaveBeenCalledWith(
        "req-1",
        "once",
        "default",
      ),
    );
    expect(resolveAttention).toHaveBeenCalledWith(
      "approval-1",
      { choiceId: "once" },
      "default",
    );
    expect(chatApi.respondApproval.mock.invocationCallOrder[0]).toBeLessThan(
      resolveAttention.mock.invocationCallOrder[0],
    );
  });

  it("keeps an approval pending when the gateway rejects the response", async () => {
    listAttention.mockResolvedValue([
      {
        contractVersion: 1,
        id: "approval-1",
        profile: "default",
        kind: "approval",
        status: "pending",
        source: "hermes-run-event",
        title: "Hermes needs approval",
        summary: "Run the requested command.",
        idempotencyKey: "hermes-approval:run-1:req-1",
        runId: "run-1",
        requestId: "req-1",
        choices: [{ id: "deny", label: "Deny", tone: "danger" }],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    chatApi.respondApproval.mockResolvedValue({
      ok: false,
      error: "The gateway no longer has this request.",
    });

    render(<ReviewQueueSurface />);
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    expect(
      await screen.findByText("The gateway no longer has this request."),
    ).toBeInTheDocument();
    expect(resolveAttention).not.toHaveBeenCalled();
  });
});
