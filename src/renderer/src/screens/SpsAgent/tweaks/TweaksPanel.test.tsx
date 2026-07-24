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
  it("retains the storage migration controls for Developer settings", async () => {
    await act(async () => render(<StorageSettings />));

    expect(screen.getByText("JSON blob")).toBeTruthy();
    expect(screen.getByText("Switch to markdown storage")).toBeTruthy();
  });
});

describe("TweaksPanel", () => {
  it("uses the same complete appearance editor as General settings", async () => {
    await act(async () => render(<TweaksPanel />));

    expect(screen.getByText("LIVE PREVIEW")).toBeTruthy();
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Reading font")).toBeTruthy();
    expect(screen.getByLabelText("Content width")).toBeTruthy();
    expect(screen.getByLabelText("Home page")).toBeTruthy();
    expect(screen.queryByText("Storage")).toBeNull();
  });
});
