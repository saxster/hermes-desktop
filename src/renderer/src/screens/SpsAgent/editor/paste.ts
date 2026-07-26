import { sanitizeHtml, sanitizePastedHtml } from "../lib/sanitize";
import { escapeHtml } from "../lib/html";
import { markdownToBlocks } from "./blockMarkdown";
import type { Block, BlockType } from "../types";

interface ClipboardContent {
  html: string;
  text: string;
}

function blockFromElement(
  element: Element,
  type: BlockType,
  id: () => string,
  indent = 0,
): Block {
  const html = sanitizeHtml(element.innerHTML);
  const host = document.createElement("div");
  host.innerHTML = html;
  return {
    id: id(),
    type,
    html,
    text: host.textContent || "",
    indent,
  };
}

function listItemBlock(
  item: Element,
  type: "li" | "numli",
  id: () => string,
  indent: number,
): Block {
  const clone = item.cloneNode(true) as Element;
  clone.querySelectorAll("ul, ol").forEach((list) => list.remove());
  return blockFromElement(clone, type, id, indent);
}

function visitElement(
  element: Element,
  id: () => string,
  output: Block[],
  indent = 0,
): void {
  const tag = element.tagName.toLowerCase();
  if (tag === "div") {
    const structuralChildren = Array.from(element.children).filter((child) =>
      ["div", "p", "h1", "h2", "h3", "blockquote", "pre", "ul", "ol"].includes(
        child.tagName.toLowerCase(),
      ),
    );
    if (structuralChildren.length > 0) {
      structuralChildren.forEach((child) =>
        visitElement(child, id, output, indent),
      );
      return;
    }
  }
  if (tag === "ul" || tag === "ol") {
    const type = tag === "ol" ? "numli" : "li";
    Array.from(element.children).forEach((child) => {
      if (child.tagName.toLowerCase() !== "li") return;
      output.push(listItemBlock(child, type, id, indent));
      Array.from(child.children).forEach((nested) => {
        const nestedTag = nested.tagName.toLowerCase();
        if (nestedTag === "ul" || nestedTag === "ol") {
          visitElement(nested, id, output, indent + 1);
        }
      });
    });
    return;
  }
  const type: BlockType =
    tag === "h1" || tag === "h2" || tag === "h3"
      ? tag
      : tag === "blockquote"
        ? "quote"
        : tag === "pre"
          ? "code"
          : "p";
  output.push(blockFromElement(element, type, id, indent));
}

function parsePlainText(text: string, id: () => string): Block[] {
  const body = text.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  // markdownToBlocks is the substrate's own parser -- the inverse of the
  // serializer that writes every vault page -- so markdown pasted as plain text
  // lands as the blocks it describes rather than flat paragraphs. The clipboard
  // is untrusted, so the html it yields is re-sanitized here just like the html
  // clipboard path; a block that carries none falls back to escaped text.
  return markdownToBlocks(body).map((block) => ({
    ...block,
    id: id(),
    html: block.html ? sanitizeHtml(block.html) : escapeHtml(block.text ?? ""),
  }));
}

export function parseClipboardBlocks(
  content: ClipboardContent,
  id: () => string,
): Block[] {
  if (!content.html.trim()) return parsePlainText(content.text, id);
  const template = document.createElement("template");
  template.innerHTML = sanitizePastedHtml(content.html);
  const output: Block[] = [];
  Array.from(template.content.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      visitElement(node as Element, id, output);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      output.push(...parsePlainText(node.textContent, id));
    }
  });
  return output.length ? output : parsePlainText(content.text, id);
}
