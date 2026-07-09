import { afterEach, describe, expect, it } from "vitest";
import {
  ADMIN_LAST_VIEW_KEY,
  normalizeAdminView,
  readLastAdminView,
  writeLastAdminView,
} from "./openSettings";

afterEach(() => {
  localStorage.clear();
});

describe("normalizeAdminView", () => {
  it("maps legacy admin views to stable Control Center views", () => {
    expect(normalizeAdminView("providers")).toBe("aiSetup");
    expect(normalizeAdminView("gateway")).toBe("connectedApps");
    expect(normalizeAdminView("settings")).toBe("overview");
    expect(normalizeAdminView("spsAgent")).toBe("overview");
  });
});

describe("admin view persistence", () => {
  it("returns overview for unknown stored values", () => {
    localStorage.setItem(ADMIN_LAST_VIEW_KEY, "not-a-real-view");

    expect(readLastAdminView()).toBe("overview");
  });

  it("stores and reads normalized legacy aliases", () => {
    writeLastAdminView("providers");

    expect(localStorage.getItem(ADMIN_LAST_VIEW_KEY)).toBe("aiSetup");
    expect(readLastAdminView()).toBe("aiSetup");
  });

  it("round-trips direct stable views unchanged", () => {
    writeLastAdminView("advanced");

    expect(localStorage.getItem(ADMIN_LAST_VIEW_KEY)).toBe("advanced");
    expect(readLastAdminView()).toBe("advanced");
  });
});
