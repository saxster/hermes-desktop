import {
  act,
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
        spsReadRow: vi
          .fn()
          .mockResolvedValue(
            '---\ntitle: "Dashboard scratchpad"\nsystem: true\n---\n\nA calm note\n',
          ),
        spsExportRow: vi.fn().mockResolvedValue(true),
        spsDeletePage: vi.fn().mockResolvedValue(true),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("renders a calm Today view with a folder-backed local scratchpad", async () => {
    const { container } = render(<Dashboard />);

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(container.querySelector(".postit-card")).toBeNull();
    expect(screen.queryByText("S&P 500")).toBeNull();

    const scratchpad = await screen.findByDisplayValue("A calm note");
    fireEvent.change(scratchpad, {
      target: { value: "Updated note" },
    });
    const api = window.hermesAPI as unknown as {
      spsExportRow: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "_dashboard",
        "scratchpad",
        expect.stringContaining("Updated note"),
      ),
    );
    expect(useStore.getState().docs.dashboard_scratchpad).toBeUndefined();
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

  it("coalesces rapid scratchpad edits and persists only the latest value", async () => {
    vi.useFakeTimers();
    render(<Dashboard />);
    await act(async () => {
      await Promise.resolve();
    });
    const api = window.hermesAPI as unknown as {
      spsExportRow: ReturnType<typeof vi.fn>;
    };
    const scratchpad = screen.getByLabelText("Today scratchpad");

    fireEvent.change(scratchpad, { target: { value: "A" } });
    fireEvent.change(scratchpad, { target: { value: "AB" } });
    fireEvent.change(scratchpad, { target: { value: "ABC" } });

    expect(api.spsExportRow).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(api.spsExportRow).toHaveBeenCalledTimes(1);
    expect(api.spsExportRow).toHaveBeenCalledWith(
      "_dashboard",
      "scratchpad",
      expect.stringContaining("ABC"),
    );
    vi.useRealTimers();
  });

  it("warns when the scratchpad cannot be saved", async () => {
    vi.useFakeTimers();
    vi.mocked(window.hermesAPI.spsExportRow).mockResolvedValue(false);
    render(<Dashboard />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText("Today scratchpad"), {
      target: { value: "Unsaved" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(useStore.getState().toast?.text).toMatch(/not saved/i);
    vi.useRealTimers();
  });
});
