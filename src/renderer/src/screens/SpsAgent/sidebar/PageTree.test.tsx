import { describe, expect, it } from "vitest";
import { countTreeNodes, flattenVisibleTree } from "./PageTree";
import type { TreeNode } from "../types";

const tree: TreeNode[] = [
  {
    id: "root",
    children: [
      { id: "child-a", children: [] },
      {
        id: "child-b",
        children: [{ id: "grandchild", children: [] }],
      },
    ],
  },
  { id: "other", children: [] },
];

describe("virtualized page-tree projection", () => {
  it("counts the full tree when deciding whether to virtualize", () => {
    expect(countTreeNodes(tree)).toBe(5);
  });

  it("flattens only expanded branches with stable depths", () => {
    expect(flattenVisibleTree(tree, new Set(["root"]))).toEqual([
      { node: tree[0], depth: 0 },
      { node: tree[0].children[0], depth: 1 },
      { node: tree[0].children[1], depth: 1 },
      { node: tree[1], depth: 0 },
    ]);
    expect(flattenVisibleTree(tree, new Set(["root", "child-b"]))).toEqual([
      { node: tree[0], depth: 0 },
      { node: tree[0].children[0], depth: 1 },
      { node: tree[0].children[1], depth: 1 },
      { node: tree[0].children[1].children[0], depth: 2 },
      { node: tree[1], depth: 0 },
    ]);
  });
});
