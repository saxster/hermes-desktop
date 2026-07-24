import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../SpsAgent/store";
import { TWEAK_DEFAULTS } from "../SpsAgent/lib/theme";
import { WorkspaceAppearanceSettings } from "./WorkspaceAppearanceSettings";

describe("WorkspaceAppearanceSettings", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { listSkins: vi.fn().mockResolvedValue([]) },
    });
    useStore.setState({ t: { ...TWEAK_DEFAULTS } });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("edits theme, color, typography, spacing, and layout from one live surface", async () => {
    await act(async () => render(<WorkspaceAppearanceSettings />));

    expect(screen.getByText("LIVE PREVIEW")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Warm Dark/ }));
    fireEvent.click(screen.getByRole("button", { name: "Teal" }));
    fireEvent.click(screen.getByRole("button", { name: /Editorial Serif/ }));
    fireEvent.change(screen.getByLabelText("Text size"), {
      target: { value: "large" },
    });
    fireEvent.change(screen.getByLabelText("Line spacing"), {
      target: { value: "relaxed" },
    });
    fireEvent.change(screen.getByLabelText("Content width"), {
      target: { value: "wide" },
    });

    expect(useStore.getState().t.darkSkin).toBe("warm");
    expect(useStore.getState().t.accent).toBe("#0F6B78");
    expect(useStore.getState().t.bodyfont).toBe("serif");
    expect(useStore.getState().t.textScale).toBe("large");
    expect(useStore.getState().t.lineSpacing).toBe("relaxed");
    expect(useStore.getState().t.width).toBe("wide");
  });
});
