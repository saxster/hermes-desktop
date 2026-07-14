import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlockInner } from "./BlockInner";

describe("BlockInner ordered-list marker", () => {
  it("seeds the CSS counter instead of rendering a hardcoded one", () => {
    const { container } = render(
      <BlockInner
        block={{ id: "n3", type: "numli", text: "Third" }}
        listNumber={3}
        updateBlock={vi.fn()}
        onEnter={vi.fn()}
        onBackspaceEmpty={vi.fn()}
        onIndent={vi.fn()}
        onArrow={vi.fn()}
        toggleTodo={vi.fn()}
        toggleCollapse={vi.fn()}
        registerRef={vi.fn()}
        setView={vi.fn()}
        onOpenTask={vi.fn()}
        setType={vi.fn()}
        onInputFromDom={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    const marker = container.querySelector(".marker.num") as HTMLElement;
    expect(marker.textContent).toBe("");
    expect(marker.style.counterReset).toBe("sps-numli 2");
  });
});
