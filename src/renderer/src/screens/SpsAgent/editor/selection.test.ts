import { describe, expect, it } from "vitest";
import {
  editableSelectionFragments,
  isCaretAtStart,
  safeCssColor,
} from "./selection";

describe("safeCssColor", () => {
  it("accepts hex, rgb, and named colors", () => {
    expect(safeCssColor("#fff")).toBe("#fff");
    expect(safeCssColor("#112233")).toBe("#112233");
    expect(safeCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(safeCssColor("rebeccapurple")).toBe("rebeccapurple");
  });

  it("rejects CSS injection vectors", () => {
    expect(
      safeCssColor('red; background: url("https://evil")'),
    ).toBeUndefined();
    expect(safeCssColor("url(https://evil)")).toBeUndefined();
    expect(safeCssColor("expression(alert(1))")).toBeUndefined();
    expect(safeCssColor("")).toBeUndefined();
    expect(safeCssColor(undefined)).toBeUndefined();
  });
});

describe("editable selection helpers", () => {
  it("splits nested inline markup at the current caret", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<strong>Alpha beta</strong> tail";
    document.body.appendChild(editor);
    const text = editor.querySelector("strong")?.firstChild;
    const range = document.createRange();
    range.setStart(text!, 5);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    expect(editableSelectionFragments(editor)).toEqual({
      before: { html: "<strong>Alpha</strong>", text: "Alpha" },
      after: { html: "<strong> beta</strong> tail", text: " beta tail" },
    });
    expect(isCaretAtStart(editor)).toBe(false);
    editor.remove();
  });
});
