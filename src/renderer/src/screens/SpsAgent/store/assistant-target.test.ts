import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantResult } from "../assistant/types";

const respond = vi.hoisted(() => vi.fn());

vi.mock("../assistant/AssistantProvider", () => ({
  getAssistantProvider: () => ({ respond }),
}));

import { useStore } from ".";

describe("assistant mutation targets", () => {
  beforeEach(() => {
    respond.mockReset();
    const conversation = useStore.getState().conversations[0];
    useStore.setState({
      tree: [
        { id: "page-a", children: [] },
        { id: "page-b", children: [] },
      ],
      meta: {
        "page-a": { icon: "📄", title: "Alpha", cover: null },
        "page-b": { icon: "📄", title: "Beta", cover: null },
      },
      docs: {
        "page-a": [{ id: "a1", type: "p", text: "Original alpha paragraph" }],
        "page-b": [{ id: "b1", type: "p", text: "Original beta paragraph" }],
      },
      page: "page-a",
      conversations: [conversation],
      activeConvId: conversation.id,
    });
  });

  it("applies an async AI edit to the page that initiated it", async () => {
    let resolveResponse: ((value: AssistantResult) => void) | undefined;
    respond.mockReturnValue(
      new Promise<AssistantResult>((resolve) => {
        resolveResponse = resolve;
      }),
    );

    useStore.getState().runAgent("Tighten this");
    useStore.getState().selectPage("page-b");
    resolveResponse?.({
      kind: "diff",
      reply: ["Proposed"],
      label: "Tighten",
      edits: [{ find: "Original alpha", html: "Tighter alpha" }],
    });

    await vi.waitFor(() =>
      expect(useStore.getState().docs["page-a"][0].diff).toBeDefined(),
    );
    expect(useStore.getState().docs["page-b"][0]).toEqual({
      id: "b1",
      type: "p",
      text: "Original beta paragraph",
    });
  });

  it("creates assistant-added tasks for the owner without inventing a due date", () => {
    useStore.setState((state) => ({
      docs: {
        ...state.docs,
        "page-a": [
          {
            id: "db1",
            type: "database",
            text: "Tasks",
            rows: [],
            view: "table",
          },
        ],
      },
      page: "page-a",
    }));

    useStore
      .getState()
      .applyDbAction("message-1", { type: "addTask", title: "Follow up" });

    const row = useStore.getState().docs["page-a"][0].rows?.[0];
    expect(row).toEqual(
      expect.objectContaining({
        title: "Follow up",
        who: "you",
        due: "",
      }),
    );
  });
});
