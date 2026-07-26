// go-home.test.ts — returning to the configured Home surface.
//
// Before `goHome` existed, `loadTweaks().homeSurface` was read exactly once, at
// store construction (slices/ui.ts). Nothing set it again, so with the default
// Home of "cockpit" you could leave home but never get back without restarting
// the app. These tests pin the way back for every Home setting.
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "./index";
import { saveTweaks, loadTweaks } from "./slices/tweaks";

afterEach(() => {
  localStorage.clear();
});

function setHomeSurface(home: "doc" | "cockpit" | "chats" | "inbox"): void {
  saveTweaks({ ...loadTweaks(), homeSurface: home });
}

describe("goHome", () => {
  it("returns to a non-doc Home from an unrelated surface", () => {
    setHomeSurface("cockpit");
    useStore.getState().setSurface("graph");

    useStore.getState().goHome();

    expect(useStore.getState().surface).toBe("cockpit");
  });

  it("selects the home page when Home is the doc surface", () => {
    setHomeSurface("doc");
    useStore.getState().setSurface("graph");
    useStore.getState().selectPage("some-other-page");

    useStore.getState().goHome();

    expect(useStore.getState().surface).toBe("doc");
    expect(useStore.getState().page).toBe("home");
  });

  it("leaves the selected page alone when Home is not the doc surface", () => {
    setHomeSurface("inbox");
    useStore.getState().selectPage("some-other-page");

    useStore.getState().goHome();

    expect(useStore.getState().surface).toBe("inbox");
    expect(useStore.getState().page).toBe("some-other-page");
  });

  it("re-reads the tweak, so changing Home takes effect without a restart", () => {
    setHomeSurface("cockpit");
    useStore.getState().goHome();
    expect(useStore.getState().surface).toBe("cockpit");

    setHomeSurface("chats");
    useStore.getState().goHome();

    expect(useStore.getState().surface).toBe("chats");
  });
});
