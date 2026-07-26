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

  it("turns pasted markdown into the blocks it describes", () => {
    let id = 0;
    const blocks = parseClipboardBlocks(
      {
        html: "",
        text: [
          "# Weekly plan",
          "",
          "> Standup moved to 9:30",
          "",
          "- [ ] Chase the invoice",
          "- Call the vendor",
          "",
          "```js",
          "const x = 1;",
          "```",
        ].join("\n"),
      },
      () => `paste-${++id}`,
    );

    expect(blocks.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "h1", text: "Weekly plan" },
      { type: "quote", text: "Standup moved to 9:30" },
      { type: "todo", text: "Chase the invoice" },
      { type: "li", text: "Call the vendor" },
      { type: "code", text: "const x = 1;" },
    ]);
    expect(blocks[2].done).toBe(false);
  });

  it("keeps inline markdown marks when pasting a single line", () => {
    const [block] = parseClipboardBlocks(
      { html: "", text: "Ship **today**, not [later](https://example.com)" },
      () => "paste-1",
    );

    expect(block.type).toBe("p");
    expect(block.html).toContain("<strong>today</strong>");
    expect(block.html).toContain('href="https://example.com"');
  });

  it("never lets a pasted metadata comment smuggle in executable html", () => {
    const payload = btoa(
      JSON.stringify({
        type: "p",
        text: "innocent",
        html: '<img src=x onerror="steal()"><script>steal()</script>',
      }),
    );
    const [block] = parseClipboardBlocks(
      { html: "", text: `<!-- sps:${payload} -->` },
      () => "paste-1",
    );

    expect(block.html ?? "").not.toMatch(/script|onerror/i);
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
