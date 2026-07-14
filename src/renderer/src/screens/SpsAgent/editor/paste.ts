import { sanitizeHtml, sanitizePastedHtml } from "../lib/sanitize";
import { escapeHtml } from "../lib/html";
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
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && !lines[0].trim()) lines.shift();
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((line) => {
    const match = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/);
    const type: BlockType = match ? (match[3] ? "numli" : "li") : "p";
    const value = match ? match[4] : line;
    return {
      id: id(),
      type,
      text: value,
      html: escapeHtml(value),
      indent: match ? Math.floor(match[1].replace(/\t/g, "  ").length / 2) : 0,
    };
  });
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
