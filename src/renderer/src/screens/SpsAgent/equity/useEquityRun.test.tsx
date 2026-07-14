import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEquityRun } from "./useEquityRun";

describe("useEquityRun stream isolation", () => {
  it("accepts chat signals only for its current client run id", async () => {
    let onChunk: ((chunk: string, runId?: string) => void) | undefined;
    let onTool: ((tool: string, runId?: string) => void) | undefined;
    let onDone: ((sessionId?: string, runId?: string) => void) | undefined;
    let finishSend:
      | ((value: { response: string; sessionId?: string }) => void)
      | undefined;
    const sendMessage = vi.fn().mockReturnValue(
      new Promise<{ response: string; sessionId?: string }>((resolve) => {
        finishSend = resolve;
      }),
    );
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listInstalledSkills: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn().mockResolvedValue("0"),
        sendMessage,
        onChatChunk: vi.fn((callback) => {
          onChunk = callback;
          return vi.fn();
        }),
        onChatToolProgress: vi.fn((callback) => {
          onTool = callback;
          return vi.fn();
        }),
        onChatDone: vi.fn((callback) => {
          onDone = callback;
          return vi.fn();
        }),
        onChatApprovalRequest: vi.fn(() => vi.fn()),
        onChatApprovalAuto: vi.fn(() => vi.fn()),
        onChatCheckpoint: vi.fn(() => vi.fn()),
        onChatDelegateProgress: vi.fn(() => vi.fn()),
      },
    });

    const { result } = renderHook(() => useEquityRun());
    act(() => result.current.start("INFY", "quick"));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    const runId = sendMessage.mock.calls[0]?.[7] as string;
    expect(runId).toBeTruthy();

    act(() => {
      onChunk?.("wrong", "another-run");
      onTool?.("wrong-tool", "another-run");
      onDone?.("session-other", "another-run");
    });
    expect(result.current.transcript).toBe("");
    expect(result.current.toolProgress).toBeNull();
    expect(result.current.status).toBe("running");

    act(() => {
      onChunk?.("right", runId);
      onTool?.("fetch", runId);
    });
    expect(result.current.transcript).toBe("right");
    expect(result.current.toolProgress).toBe("fetch");

    act(() => onDone?.("session-current", runId));
    expect(result.current.status).toBe("done");
    expect(result.current.toolProgress).toBeNull();

    await act(async () => {
      finishSend?.({ response: "right" });
      await Promise.resolve();
    });
  });
});
