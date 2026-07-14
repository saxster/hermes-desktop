import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ retryWorkspaceHydration: vi.fn() }));
const store = vi.hoisted(() => ({
  workspaceLoadIssue: {
    kind: "error" as const,
    error: "temporary read failure",
  } as { kind: "error"; error: string } | null,
}));

vi.mock("../store/lifecycle", () => ({
  retryWorkspaceHydration: lifecycle.retryWorkspaceHydration,
}));
vi.mock("../store", () => {
  const useStore = Object.assign(
    (selector: (state: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return { useStore };
});

import { WorkspaceRecovery } from "./WorkspaceRecovery";

beforeEach(() => {
  vi.clearAllMocks();
  store.workspaceLoadIssue = {
    kind: "error",
    error: "temporary read failure",
  };
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    spsListBackups: vi.fn().mockResolvedValue([]),
  };
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("WorkspaceRecovery", () => {
  it("notifies the host to restart lifecycle side effects after retry succeeds", async () => {
    const onWorkspaceReady = vi.fn();
    lifecycle.retryWorkspaceHydration.mockImplementationOnce(async () => {
      store.workspaceLoadIssue = null;
    });

    render(<WorkspaceRecovery onWorkspaceReady={onWorkspaceReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry load" }));

    await waitFor(() => expect(onWorkspaceReady).toHaveBeenCalledTimes(1));
  });
});
