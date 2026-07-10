import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StorageSettings, TweaksPanel } from "./TweaksPanel";
import { useStore } from "../store";
import { setStorageMode } from "../lib/storageMode";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

beforeEach(() => {
  stubApi({});
  useStore.setState({ tweaksOpen: true });
  setStorageMode("blob");
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  useStore.setState({ tweaksOpen: false });
  setStorageMode("blob");
  vi.restoreAllMocks();
});

describe("StorageSettings", () => {
  it("retains the storage migration controls for Data & Privacy", async () => {
    await act(async () => render(<StorageSettings />));

    expect(screen.getByText("JSON blob")).toBeTruthy();
    expect(screen.getByText("Switch to markdown storage")).toBeTruthy();
  });
});

describe("TweaksPanel", () => {
  it("contains local layout controls without global appearance or storage", async () => {
    await act(async () => render(<TweaksPanel />));

    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.getByLabelText("Content width")).toBeTruthy();
    expect(screen.getByText("Sidebar sections")).toBeTruthy();
    expect(screen.queryByText("Appearance")).toBeNull();
    expect(screen.queryByText("Typography")).toBeNull();
    expect(screen.queryByText("Storage")).toBeNull();
  });
});
