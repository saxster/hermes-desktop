import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../SpsAgent/store";
import { WorkspaceAppearanceSettings } from "./WorkspaceAppearanceSettings";

describe("WorkspaceAppearanceSettings", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { listSkins: vi.fn().mockResolvedValue([]) },
    });
    useStore.setState((state) => ({
      t: {
        ...state.t,
        dark: true,
        darkSkin: "black",
        accent: "#C79400",
        density: "comfortable",
        bodyfont: "sans",
      },
    }));
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("keeps global workspace appearance controls together in Preferences", () => {
    render(<WorkspaceAppearanceSettings />);

    fireEvent.change(screen.getByLabelText("Dark palette"), {
      target: { value: "warm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    fireEvent.change(screen.getByLabelText("Interface density"), {
      target: { value: "compact" },
    });
    fireEvent.change(screen.getByLabelText("Authored content font"), {
      target: { value: "serif" },
    });

    expect(useStore.getState().t.darkSkin).toBe("warm");
    expect(useStore.getState().t.accent).toBe("#1B4F8A");
    expect(useStore.getState().t.density).toBe("compact");
    expect(useStore.getState().t.bodyfont).toBe("serif");
  });
});
