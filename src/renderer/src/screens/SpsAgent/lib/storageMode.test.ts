// storageMode.test.ts — S6: the persisted blob/vault authority flag.
import { afterEach, describe, expect, it } from "vitest";
import {
  getStorageMode,
  setStorageMode,
  setStorageModeProfile,
} from "./storageMode";

afterEach(() => {
  localStorage.clear();
  setStorageModeProfile("default");
});

describe("storageMode", () => {
  it("defaults to blob (nothing changes until the user migrates)", () => {
    expect(getStorageMode()).toBe("blob");
  });
  it("persists vault and back to blob", () => {
    setStorageMode("vault");
    expect(getStorageMode()).toBe("vault");
    setStorageMode("blob");
    expect(getStorageMode()).toBe("blob");
  });
  it("treats any unknown stored value as blob", () => {
    localStorage.setItem("sps-agent-storage-mode-v1", "garbage");
    expect(getStorageMode()).toBe("blob");
  });
  it("keeps the authoritative mode isolated per Hermes profile", () => {
    setStorageModeProfile("default");
    setStorageMode("vault");

    setStorageModeProfile("work");
    expect(getStorageMode()).toBe("blob");
    setStorageMode("blob");

    setStorageModeProfile("research");
    setStorageMode("vault");

    setStorageModeProfile("work");
    expect(getStorageMode()).toBe("blob");
    setStorageModeProfile("research");
    expect(getStorageMode()).toBe("vault");
    setStorageModeProfile("default");
    expect(getStorageMode()).toBe("vault");
  });
});
