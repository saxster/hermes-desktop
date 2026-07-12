import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemThemeSync } from "./SystemThemeSync";

const themeState = vi.hoisted(() => ({
  theme: "system" as "light" | "dark" | "system",
  resolved: "light" as "light" | "dark",
}));
const store = vi.hoisted(() => ({
  t: { dark: true },
  setTweak: vi.fn(),
}));

vi.mock("../../../components/ThemeProvider", () => ({
  useTheme: () => themeState,
}));

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

describe("SystemThemeSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    themeState.theme = "system";
    themeState.resolved = "light";
    store.t.dark = true;
  });

  it("updates the SPS theme when the resolved system appearance changes", async () => {
    const { rerender } = render(<SystemThemeSync />);
    await waitFor(() =>
      expect(store.setTweak).toHaveBeenCalledWith("dark", false),
    );

    store.t.dark = false;
    themeState.resolved = "dark";
    rerender(<SystemThemeSync />);
    await waitFor(() =>
      expect(store.setTweak).toHaveBeenLastCalledWith("dark", true),
    );
  });

  it("leaves explicit themes under the Settings control", () => {
    themeState.theme = "dark";

    render(<SystemThemeSync />);

    expect(store.setTweak).not.toHaveBeenCalled();
  });
});
