import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editable } from "./Editable";

function placeCaretAt(el: HTMLElement, offset: number): void {
  const node = el.firstChild!;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

type ArrowHandler = (id: string, dir: number, el: HTMLElement) => boolean;

function renderArrowBlock(onArrow: ArrowHandler): HTMLElement {
  const { container } = render(
    <Editable
      block={{ id: "a", type: "p", text: "Alpha beta" }}
      onInput={vi.fn()}
      onEnter={vi.fn()}
      onBackspaceEmpty={vi.fn()}
      onIndent={vi.fn()}
      onArrow={onArrow}
    />,
  );
  const editor = container.firstElementChild as HTMLElement;
  editor.textContent = "Alpha beta";
  return editor;
}

describe("Editable arrow-key block navigation", () => {
  it("stays in the block when the caret is mid-block", () => {
    const onArrow = vi.fn(() => true);
    const editor = renderArrowBlock(onArrow);

    placeCaretAt(editor, 5);
    fireEvent.keyDown(editor, { key: "ArrowDown" });

    expect(onArrow).not.toHaveBeenCalled();
  });

  it("leaves the block when the caret is already at the end", () => {
    const onArrow = vi.fn(() => true);
    const editor = renderArrowBlock(onArrow);

    placeCaretAt(editor, "Alpha beta".length);
    fireEvent.keyDown(editor, { key: "ArrowDown" });

    expect(onArrow).toHaveBeenCalledWith("a", 1, editor);
  });

  it("stays in the block when ArrowUp is pressed away from the start", () => {
    const onArrow = vi.fn(() => true);
    const editor = renderArrowBlock(onArrow);

    placeCaretAt(editor, 5);
    fireEvent.keyDown(editor, { key: "ArrowUp" });

    expect(onArrow).not.toHaveBeenCalled();
  });

  it("leaves the block when ArrowUp is pressed at the start", () => {
    const onArrow = vi.fn(() => true);
    const editor = renderArrowBlock(onArrow);

    placeCaretAt(editor, 0);
    fireEvent.keyDown(editor, { key: "ArrowUp" });

    expect(onArrow).toHaveBeenCalledWith("a", -1, editor);
  });
});

describe("Editable IME handling", () => {
  it("does not split a block while an IME composition is active", () => {
    const onEnter = vi.fn();
    const { container } = render(
      <Editable
        block={{ id: "a", type: "p", text: "文字" }}
        onInput={vi.fn()}
        onEnter={onEnter}
        onBackspaceEmpty={vi.fn()}
        onIndent={vi.fn()}
      />,
    );
    const editor = container.firstElementChild as HTMLElement;

    fireEvent.keyDown(editor, {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
    });

    expect(onEnter).not.toHaveBeenCalled();
  });

  it("sanitizes HTML before handing it to persistent state", () => {
    const onInput = vi.fn();
    const { container } = render(
      <Editable
        block={{ id: "a", type: "p", text: "" }}
        onInput={onInput}
        onEnter={vi.fn()}
        onBackspaceEmpty={vi.fn()}
        onIndent={vi.fn()}
      />,
    );
    const editor = container.firstElementChild as HTMLElement;
    editor.innerHTML =
      'Safe<script>steal()</script><a href="javascript:steal()">link</a>';

    fireEvent.input(editor);

    expect(onInput).toHaveBeenCalledWith("a", "Safe<a>link</a>", "Safelink");
  });
});
