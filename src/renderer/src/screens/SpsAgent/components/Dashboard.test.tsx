import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("sps-pinned-pages", JSON.stringify(["alpha"]));
    localStorage.setItem("sps-recent-visited-pages", JSON.stringify(["alpha"]));
    useStore.setState((state) => ({
      meta: {
        ...state.meta,
        alpha: { icon: "📄", title: "Alpha", cover: null },
      },
      docs: {
        ...state.docs,
        home: [{ id: "home-p", type: "p", text: "" }],
        dashboard_scratchpad: [
          { id: "sp-1", type: "p", text: "A calm note" },
        ],
      },
    }));
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsExportPage: vi.fn().mockResolvedValue(undefined),
        spsExportRow: vi.fn().mockResolvedValue(true),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("renders a calm Today view with an inline local scratchpad", () => {
    const { container } = render(<Dashboard />);

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(container.querySelector(".postit-card")).toBeNull();
    expect(screen.queryByText("S&P 500")).toBeNull();

    fireEvent.change(screen.getByLabelText("Today scratchpad"), {
      target: { value: "Updated note" },
    });
    expect(
      useStore.getState().docs.dashboard_scratchpad[0]?.text,
    ).toBe("Updated note");
  });

  it("creates a canonical folder-backed task from a clean workspace", async () => {
    render(<Dashboard />);

    fireEvent.click(screen.getByRole("button", { name: "New task" }));

    const api = window.hermesAPI as unknown as {
      spsExportRow: ReturnType<typeof vi.fn>;
    };
    await waitFor(() => expect(api.spsExportRow).toHaveBeenCalledOnce());
    expect(api.spsExportRow).toHaveBeenCalledWith(
      "tasks",
      expect.stringMatching(/^task/),
      expect.stringContaining('title: "New task"'),
    );
    expect(useStore.getState().openTask).toMatchObject({
      title: "New task",
      status: "todo",
    });
    expect(useStore.getState().openTask?.id).toMatch(/^tasks\/task.*\.md$/);
  });
});
