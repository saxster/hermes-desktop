// Editor.undo.test.tsx — undo has to cover the block changes the app teaches
// first: the markdown shortcut ("# ") and the slash-menu conversions both go
// through setType, and a change that never reaches the history stack is both
// un-undoable itself and a permanent blocker for every entry beneath it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Editor } from "./Editor";
import { useStore } from "../store";
import type { Block, PageMeta } from "../types";

function stubApi(overrides: Record<string, unknown> = {}): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

function meta(title: string): PageMeta {
  return { icon: "📄", title, cover: null };
}

function seed(blocks: Block[]): void {
  useStore.setState({
    tree: [{ id: "p1", children: [] }],
    meta: { p1: meta("Page") },
    docs: { p1: blocks },
    comments: [],
    trash: [],
    page: "p1",
  });
}

function currentBlocks(): Block[] {
  return useStore.getState().docs.p1;
}

/** The contentEditable host for a block, keyed by its position on the page. */
function editableAt(container: HTMLElement, index: number): HTMLElement {
  const nodes = container.querySelectorAll<HTMLElement>("[contenteditable]");
  return nodes[index];
}

function typeInto(el: HTMLElement, text: string): void {
  el.textContent = text;
  fireEvent.input(el);
}

function pressUndo(el: HTMLElement): void {
  fireEvent.keyDown(el, { key: "z", metaKey: true });
}

beforeEach(() => {
  stubApi();
  seed([{ id: "a", type: "p", text: "" }]);
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("Editor undo", () => {
  it("undoes a markdown shortcut that converted the block", () => {
    const { container } = render(<Editor />);

    typeInto(editableAt(container, 0), "# ");
    expect(currentBlocks()[0].type).toBe("h1");

    pressUndo(editableAt(container, 0));

    expect(currentBlocks()[0].type).toBe("p");
  });

  it("still undoes an earlier split after a block conversion", () => {
    seed([{ id: "a", type: "p", text: "Alpha" }]);
    const { container } = render(<Editor />);
    const first = editableAt(container, 0);
    first.textContent = "Alpha";

    fireEvent.keyDown(first, { key: "Enter" });
    expect(currentBlocks()).toHaveLength(2);

    typeInto(editableAt(container, 1), "- ");
    expect(currentBlocks()[1].type).toBe("li");

    pressUndo(editableAt(container, 1));
    expect(currentBlocks()[1].type).toBe("p");

    // The "- " the user typed is not on the structural stack. The first press
    // defers to the browser's own undo; the markdown shortcut wiped that stack
    // when it cleared the block's innerHTML, so the next press rewinds the
    // typing here rather than leaving the split below it stranded.
    pressUndo(editableAt(container, 1));
    pressUndo(editableAt(container, 1));
    expect(currentBlocks()[1].text).toBe("");

    pressUndo(editableAt(container, 1));
    expect(currentBlocks()).toHaveLength(1);
  });

  it("undoes a todo toggle instead of jamming the stack", () => {
    seed([{ id: "a", type: "p", text: "Alpha" }]);
    const { container } = render(<Editor />);

    typeInto(editableAt(container, 0), "[] ");
    expect(currentBlocks()[0].type).toBe("todo");

    const checkbox = container.querySelector<HTMLElement>(".b-todo .check");
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    expect(currentBlocks()[0].done).toBe(true);

    pressUndo(editableAt(container, 0));
    expect(currentBlocks()[0].done).toBe(false);
  });
});
