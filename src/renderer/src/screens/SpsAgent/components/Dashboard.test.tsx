import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        dashboard_scratchpad: [
          { id: "sp-1", type: "p", text: "A calm note" },
        ],
      },
    }));
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { spsExportPage: vi.fn().mockResolvedValue(undefined) },
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
});
