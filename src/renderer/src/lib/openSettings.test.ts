import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_LAST_VIEW_KEY,
  normalizeAdminView,
  readLastAdminView,
  writeLastAdminView,
} from "./openSettings";

describe("openSettings view normalization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("maps legacy admin tabs to task-based Control Center views", () => {
    expect(normalizeAdminView("providers")).toBe("aiSetup");
    expect(normalizeAdminView("gateway")).toBe("connectedApps");
    expect(normalizeAdminView("settings")).toBe("preferences");
    expect(normalizeAdminView("spsAgent")).toBe("preferences");
    expect(normalizeAdminView("models")).toBe("models");
    expect(normalizeAdminView("general")).toBe("preferences");
    expect(normalizeAdminView("assistant")).toBe("aiSetup");
    expect(normalizeAdminView("connections")).toBe("connectedApps");
    expect(normalizeAdminView("help")).toBe("troubleshooting");
    expect(normalizeAdminView("developer")).toBe("advanced");
  });

  it("falls back to General for missing or unknown values", () => {
    expect(normalizeAdminView()).toBe("preferences");
    expect(normalizeAdminView("not-real")).toBe("preferences");
  });

  it("reads and writes only normalized last views", () => {
    localStorage.setItem(ADMIN_LAST_VIEW_KEY, "gateway");
    expect(readLastAdminView()).toBe("connectedApps");

    writeLastAdminView("providers");
    expect(localStorage.getItem(ADMIN_LAST_VIEW_KEY)).toBe("aiSetup");
    expect(readLastAdminView()).toBe("aiSetup");
  });
});
