import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startAssistantRecipeScheduler,
  stopAssistantRecipeScheduler,
} from "../src/main/assistant-recipes";
import {
  startScheduledResearch,
  stopScheduledResearch,
} from "../src/main/scheduled-research";

afterEach(() => {
  stopAssistantRecipeScheduler();
  stopScheduledResearch();
  vi.useRealTimers();
});

describe("main-process scheduler lifecycle", () => {
  it("cancels the assistant recipe startup pass and interval on stop", () => {
    vi.useFakeTimers();

    startAssistantRecipeScheduler(() => null);
    expect(vi.getTimerCount()).toBe(2);

    stopAssistantRecipeScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the scheduled research startup pass and interval on stop", () => {
    vi.useFakeTimers();

    startScheduledResearch(() => null);
    expect(vi.getTimerCount()).toBe(2);

    stopScheduledResearch();
    expect(vi.getTimerCount()).toBe(0);
  });
});
