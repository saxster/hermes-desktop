import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editable } from "./Editable";

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
