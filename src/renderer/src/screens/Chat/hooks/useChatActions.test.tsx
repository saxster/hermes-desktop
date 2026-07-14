import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChatActions } from "./useChatActions";

describe("useChatActions abort", () => {
  it("passes the active Hermes session key to abortChat", () => {
    const abortChat = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { abortChat },
    });

    const { result } = renderHook(() =>
      useChatActions({
        profile: "default",
        hermesSessionId: "session-resumed-1",
        messages: [],
        isLoading: true,
        setIsLoading: vi.fn(),
        setMessages: vi.fn(),
        chatInputRef: { current: null },
        localCommands: {
          isLocal: vi.fn().mockReturnValue(false),
          executeLocal: vi.fn().mockResolvedValue(false),
        },
        contextFolder: null,
        selectedModels: [],
      }),
    );

    act(() => result.current.handleAbort());

    expect(abortChat).toHaveBeenCalledWith("session-resumed-1");
  });
});
