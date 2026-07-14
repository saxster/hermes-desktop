import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import {
  createStructuralHistory,
  mergeBlockBackward,
  orderedListNumber,
  pasteBlocksAtCaret,
  splitBlockAtCaret,
} from "./blockEditing";

const paragraph = (
  id: string,
  text: string,
  patch: Partial<Block> = {},
): Block => ({ id, type: "p", text, ...patch });

describe("block editing transformations", () => {
  it("splits a rich-text block at the caret and carries list type", () => {
    const block = paragraph("a", "Alpha beta", {
      type: "numli",
      html: "<strong>Alpha</strong> beta",
      indent: 1,
    });

    expect(
      splitBlockAtCaret(
        block,
        { html: "<strong>Alpha</strong>", text: "Alpha" },
        { html: " beta", text: " beta" },
        "b",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "a",
        type: "numli",
        html: "<strong>Alpha</strong>",
        text: "Alpha",
      }),
      expect.objectContaining({
        id: "b",
        type: "numli",
        html: " beta",
        text: " beta",
        indent: 1,
      }),
    ]);
  });

  it("merges a non-empty block backward and returns the join caret", () => {
    const result = mergeBlockBackward(
      [
        paragraph("a", "Alpha", { html: "<strong>Alpha</strong>" }),
        paragraph("b", " beta", { html: " <em>beta</em>" }),
      ],
      "b",
    );

    expect(result).toEqual({
      blocks: [
        expect.objectContaining({
          id: "a",
          text: "Alpha beta",
          html: "<strong>Alpha</strong> <em>beta</em>",
        }),
      ],
      focus: { id: "a", offset: 5 },
    });
  });

  it("numbers contiguous ordered-list items per indent level", () => {
    const blocks = [
      paragraph("a", "One", { type: "numli" }),
      paragraph("b", "Nested one", { type: "numli", indent: 1 }),
      paragraph("c", "Nested two", { type: "numli", indent: 1 }),
      paragraph("d", "Two", { type: "numli" }),
      paragraph("e", "Break"),
      paragraph("f", "Restart", { type: "numli" }),
    ];

    expect(blocks.map((block) => orderedListNumber(blocks, block.id))).toEqual([
      1,
      1,
      2,
      2,
      null,
      1,
    ]);
  });

  it("pastes structured blocks at a caret without flattening the document", () => {
    const blocks = [paragraph("a", "Before after")];
    const pasted = [
      paragraph("p1", "Heading", { type: "h2" }),
      paragraph("p2", "Item", { type: "li" }),
    ];

    expect(
      pasteBlocksAtCaret(
        blocks,
        "a",
        { html: "Before ", text: "Before " },
        { html: " after", text: " after" },
        pasted,
      ),
    ).toEqual([
      expect.objectContaining({ id: "a", text: "Before Heading" }),
      expect.objectContaining({
        id: "p2",
        type: "li",
        text: "Item after",
      }),
    ]);
  });

  it("undoes structure only while the document still matches that operation", () => {
    const history = createStructuralHistory();
    const before = [paragraph("a", "Alpha")];
    const after = history.apply(before, (blocks) => [
      { ...blocks[0], text: "Al" },
      paragraph("b", "pha"),
    ]);

    expect(history.undo(after)).toEqual(before);
    expect(history.redo(before)).toEqual(after);

    const typedAfter = after.map((block) =>
      block.id === "b" ? { ...block, text: "pha!" } : block,
    );
    expect(history.undo(typedAfter)).toBeNull();
  });
});
