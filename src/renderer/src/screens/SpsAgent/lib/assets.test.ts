import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import { referencedAssets, referencedAssetsInDocs } from "./assets";

function block(overrides: Partial<Block> = {}): Block {
  return { id: "block", type: "p", text: "", ...overrides };
}

describe("asset references", () => {
  it("finds assets nested inside column blocks", () => {
    const blocks = [
      block({
        id: "columns",
        type: "columns",
        columns: [
          [block({ id: "left", assetPath: "left.png" })],
          [
            block({
              id: "nested-columns",
              type: "columns",
              columns: [[block({ id: "deep", assetPath: "deep.png" })]],
            }),
          ],
        ],
      }),
    ];

    expect(referencedAssets(blocks)).toEqual(["left.png", "deep.png"]);
    expect(referencedAssetsInDocs({ page: blocks })).toEqual([
      "left.png",
      "deep.png",
    ]);
  });
});
