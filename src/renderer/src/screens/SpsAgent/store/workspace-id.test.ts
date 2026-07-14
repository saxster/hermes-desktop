import { beforeEach, describe, expect, it, vi } from "vitest";

const uidMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/ids", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ids")>();
  return { ...actual, uid: uidMock };
});

import { useStore } from ".";

describe("makePage id collisions", () => {
  beforeEach(() => {
    uidMock.mockReset();
    useStore.setState({
      tree: [
        { id: "home", children: [] },
        { id: "pg-existing", children: [] },
      ],
      meta: {
        home: { icon: "🏠", title: "Home", cover: null },
        "pg-existing": { icon: "📄", title: "Keep me", cover: null },
      },
      docs: {
        home: [],
        "pg-existing": [{ id: "old", type: "p", text: "Original" }],
      },
      page: "home",
    });
  });

  it("regenerates an id instead of clobbering an existing page", () => {
    uidMock.mockReturnValueOnce("pg-existing").mockReturnValueOnce("pg-fresh");

    const id = useStore
      .getState()
      .makePage(
        { title: "New page" },
        [{ id: "new", type: "p", text: "New" }],
        null,
      );

    expect(id).toBe("pg-fresh");
    expect(useStore.getState().meta["pg-existing"].title).toBe("Keep me");
    expect(useStore.getState().docs["pg-existing"][0].text).toBe("Original");
    expect(useStore.getState().meta["pg-fresh"].title).toBe("New page");
  });
});
