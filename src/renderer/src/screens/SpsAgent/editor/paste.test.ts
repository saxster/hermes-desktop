import { describe, expect, it } from "vitest";
import { parseClipboardBlocks } from "./paste";

describe("structured editor paste", () => {
  it("preserves headings and lists while sanitizing stored HTML", () => {
    let id = 0;
    const blocks = parseClipboardBlocks(
      {
        html: [
          '<h2 onclick="steal()">Plan<script>steal()</script></h2>',
          '<p><strong>Safe</strong> <a href="javascript:steal()">link</a></p>',
          "<ul><li>First</li><li>Second</li></ul>",
          "<ol><li>Third</li></ol>",
        ].join(""),
        text: "Plan\nSafe link\nFirst\nSecond\nThird",
      },
      () => `paste-${++id}`,
    );

    expect(blocks.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "h2", text: "Plan" },
      { type: "p", text: "Safe link" },
      { type: "li", text: "First" },
      { type: "li", text: "Second" },
      { type: "numli", text: "Third" },
    ]);
    expect(blocks.map((block) => block.html).join(" ")).not.toMatch(
      /script|onclick|javascript:/i,
    );
    expect(blocks[1].html).toContain("<strong>Safe</strong>");
  });

  it("expands common div-wrapped clipboard paragraphs", () => {
    let id = 0;
    const blocks = parseClipboardBlocks(
      {
        html: "<div><p>First paragraph</p><p>Second paragraph</p></div>",
        text: "First paragraph\nSecond paragraph",
      },
      () => `paste-${++id}`,
    );

    expect(blocks.map((block) => block.text)).toEqual([
      "First paragraph",
      "Second paragraph",
    ]);
  });

  it("treats plain-text angle brackets as text, not markup", () => {
    const [block] = parseClipboardBlocks(
      { html: "", text: "<b>literal</b>" },
      () => "paste-1",
    );

    expect(block).toMatchObject({
      text: "<b>literal</b>",
      html: "&lt;b&gt;literal&lt;/b&gt;",
    });
  });
});
