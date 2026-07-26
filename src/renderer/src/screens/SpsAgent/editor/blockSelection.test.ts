// blockSelection.test.ts — the range arithmetic behind multi-block selection.
// Every rule here is one the user feels directly: a range that drops a block is
// a block that survives a delete, and a range that empties the page leaves them
// with nowhere to type.
import { describe, expect, it } from "vitest";
import {
  deleteRange,
  extendRange,
  moveRange,
  rangeBlockIds,
  rangeBlocks,
  wholeDocumentRange,
} from "./blockSelection";
import type { Block } from "../types";

function page(): Block[] {
  return [
    { id: "a", type: "p", text: "Alpha" },
    { id: "b", type: "p", text: "Bravo" },
    { id: "c", type: "p", text: "Charlie" },
    { id: "d", type: "p", text: "Delta" },
  ];
}

describe("rangeBlockIds", () => {
  it("covers both ends of the range inclusively", () => {
    const ids = rangeBlockIds(page(), { anchorId: "b", headId: "d" });

    expect(ids).toEqual(["b", "c", "d"]);
  });

  it("reads the same range dragged upwards", () => {
    const ids = rangeBlockIds(page(), { anchorId: "d", headId: "b" });

    expect(ids).toEqual(["b", "c", "d"]);
  });

  it("covers nothing once an end has been deleted from under it", () => {
    const ids = rangeBlockIds(page(), { anchorId: "b", headId: "gone" });

    expect(ids).toEqual([]);
  });
});

describe("extendRange", () => {
  it("moves the head and leaves the anchor put", () => {
    const range = extendRange(page(), { anchorId: "b", headId: "b" }, 1);

    expect(range).toEqual({ anchorId: "b", headId: "c" });
  });

  it("shrinks back over the anchor when the direction reverses", () => {
    const range = extendRange(page(), { anchorId: "b", headId: "c" }, -1);

    expect(range).toEqual({ anchorId: "b", headId: "b" });
  });

  it("stops at the end of the document instead of wrapping", () => {
    const range = extendRange(page(), { anchorId: "c", headId: "d" }, 1);

    expect(range).toBeNull();
  });
});

describe("moveRange", () => {
  it("collapses a multi-block range onto its leading edge", () => {
    const range = moveRange(page(), { anchorId: "a", headId: "c" }, 1);

    expect(range).toEqual({ anchorId: "c", headId: "c" });
  });

  it("steps one block when the range is already a single block", () => {
    const range = moveRange(page(), { anchorId: "c", headId: "c" }, -1);

    expect(range).toEqual({ anchorId: "b", headId: "b" });
  });

  it("stops at the first block", () => {
    const range = moveRange(page(), { anchorId: "a", headId: "a" }, -1);

    expect(range).toBeNull();
  });
});

describe("wholeDocumentRange", () => {
  it("spans first to last", () => {
    expect(wholeDocumentRange(page())).toEqual({
      anchorId: "a",
      headId: "d",
    });
  });

  it("is null on an empty page", () => {
    expect(wholeDocumentRange([])).toBeNull();
  });
});

describe("deleteRange", () => {
  it("removes every block the range covers and keeps the rest in order", () => {
    const next = deleteRange(page(), { anchorId: "b", headId: "c" }, "new");

    expect(next.map((block) => block.id)).toEqual(["a", "d"]);
  });

  it("leaves one empty paragraph rather than an unusable page", () => {
    const next = deleteRange(page(), { anchorId: "a", headId: "d" }, "new");

    expect(next).toEqual([{ id: "new", type: "p", text: "" }]);
  });

  it("changes nothing when the range no longer covers anything", () => {
    const blocks = page();

    const next = deleteRange(blocks, { anchorId: "gone", headId: "d" }, "new");

    expect(next).toBe(blocks);
  });
});

describe("rangeBlocks", () => {
  it("returns the blocks themselves for serializing to the clipboard", () => {
    const covered = rangeBlocks(page(), { anchorId: "a", headId: "b" });

    expect(covered.map((block) => block.text)).toEqual(["Alpha", "Bravo"]);
  });
});
