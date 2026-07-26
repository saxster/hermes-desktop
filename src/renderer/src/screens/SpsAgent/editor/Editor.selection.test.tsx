// Editor.selection.test.tsx — acting on more than one block at a time.
// The agent now fills pages the owner did not write, so reacting to them means
// deleting a section or lifting it out as markdown. Both are impossible one
// block at a time, and a text selection cannot span two contentEditable hosts,
// so this is the only path to either.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
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

function editableAt(container: HTMLElement, index: number): HTMLElement {
  return container.querySelectorAll<HTMLElement>("[contenteditable]")[index];
}

function selectedIds(container: HTMLElement): string[] {
  const wraps = container.querySelectorAll<HTMLElement>(
    ".block-wrap[data-selected]",
  );
  return Array.from(wraps).map((wrap) => wrap.id.slice(3));
}

/** Real focus, so the caret genuinely leaves when the selection takes over. */
function focusBlock(el: HTMLElement): void {
  act(() => el.focus());
}

/** Put a real collapsed caret at the end of a block, as the edge guards read it. */
function caretAtEndOf(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Block-level keys arrive on the body: the caret has left the document. */
function pressOnPage(init: Partial<KeyboardEventInit> & { key: string }): void {
  fireEvent.keyDown(document.body, init);
}

const PAGE: Block[] = [
  { id: "a", type: "p", text: "Alpha" },
  { id: "b", type: "p", text: "Bravo" },
  { id: "c", type: "p", text: "Charlie" },
];

beforeEach(() => {
  stubApi();
  seed(structuredClone(PAGE));
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("Editor block selection", () => {
  it("selects the block on Escape and drops the caret", () => {
    const { container } = render(<Editor />);
    const first = editableAt(container, 0);
    focusBlock(first);

    fireEvent.keyDown(first, { key: "Escape" });

    expect(selectedIds(container)).toEqual(["a"]);
    expect(document.activeElement).not.toBe(first);
  });

  it("extends across blocks with Shift+ArrowDown from the block's end", () => {
    const { container } = render(<Editor />);
    const first = editableAt(container, 0);
    focusBlock(first);
    caretAtEndOf(first);

    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });

    expect(selectedIds(container)).toEqual(["a", "b"]);
  });

  it("keeps growing the range once the selection owns the keyboard", () => {
    const { container } = render(<Editor />);
    const first = editableAt(container, 0);
    focusBlock(first);
    caretAtEndOf(first);
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });

    pressOnPage({ key: "ArrowDown", shiftKey: true });

    expect(selectedIds(container)).toEqual(["a", "b", "c"]);
  });

  it("extends to a shift-clicked block", () => {
    const { container } = render(<Editor />);
    fireEvent.keyDown(editableAt(container, 0), { key: "Escape" });

    const third = container.querySelector<HTMLElement>("#bw-c");
    fireEvent.mouseDown(third!, { shiftKey: true });

    expect(selectedIds(container)).toEqual(["a", "b", "c"]);
  });

  it("deletes every selected block in one undo step", () => {
    const { container } = render(<Editor />);
    const first = editableAt(container, 0);
    focusBlock(first);
    caretAtEndOf(first);
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });

    pressOnPage({ key: "Backspace" });

    expect(currentBlocks().map((block) => block.id)).toEqual(["c"]);
    expect(selectedIds(container)).toEqual([]);

    fireEvent.keyDown(editableAt(container, 0), { key: "z", metaKey: true });

    expect(currentBlocks().map((block) => block.id)).toEqual(["a", "b", "c"]);
  });

  it("never deletes the page out from under the caret", () => {
    const { container } = render(<Editor />);
    fireEvent.keyDown(editableAt(container, 0), { key: "Escape" });
    pressOnPage({ key: "a", metaKey: true });
    expect(selectedIds(container)).toEqual(["a", "b", "c"]);

    pressOnPage({ key: "Delete" });

    expect(currentBlocks()).toHaveLength(1);
    expect(currentBlocks()[0].text).toBe("");
  });

  it("copies the selected blocks as markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    seed([
      { id: "a", type: "h2", text: "Heading" },
      { id: "b", type: "li", text: "Point" },
      { id: "c", type: "p", text: "Tail" },
    ]);
    const { container } = render(<Editor />);
    const first = editableAt(container, 0);
    focusBlock(first);
    caretAtEndOf(first);
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });

    pressOnPage({ key: "c", metaKey: true });

    expect(writeText).toHaveBeenCalledWith("## Heading\n\n- Point");
  });

  it("clears on Escape and on a plain click, leaving the page intact", () => {
    const { container } = render(<Editor />);
    fireEvent.keyDown(editableAt(container, 0), { key: "Escape" });
    expect(selectedIds(container)).toEqual(["a"]);

    pressOnPage({ key: "Escape" });
    expect(selectedIds(container)).toEqual([]);

    fireEvent.keyDown(editableAt(container, 0), { key: "Escape" });
    fireEvent.mouseDown(container.querySelector<HTMLElement>("#bw-c")!);

    expect(selectedIds(container)).toEqual([]);
    expect(currentBlocks()).toHaveLength(3);
  });

  it("ignores block commands typed into a real input elsewhere", () => {
    const { container } = render(<Editor />);
    fireEvent.keyDown(editableAt(container, 0), { key: "Escape" });
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "Backspace" });

    expect(currentBlocks()).toHaveLength(3);
    input.remove();
  });
});
