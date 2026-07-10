import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../SpsAgent/store";
import Insights from "./Insights";

const startNewChat = vi.fn();

describe("Insights", () => {
  beforeEach(() => {
    startNewChat.mockClear();
    useStore.setState({ startNewChat });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getUsageStats: vi.fn().mockResolvedValue({
          totals: {
            turns: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cost: 0,
          },
          byModel: {},
          byDay: {},
          bySession: {},
        }),
        getRunLedger: vi.fn().mockResolvedValue([]),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("explains the empty state and offers the relevant next action", async () => {
    render(<Insights profile="default" visible />);

    expect(
      await screen.findByRole("heading", { name: "No usage yet" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a chat" }));
    expect(startNewChat).toHaveBeenCalledOnce();
  });
});
