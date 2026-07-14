// Editable.tsx — one rich-text contentEditable block. Ported from editor.jsx Editable.
import { useEffect, useRef, useState } from "react";
import { escapeHtml } from "../lib/html";
import { sanitizeHtml } from "../lib/sanitize";
import { isImeComposing } from "../../Chat/keyboard";
import { uid } from "../lib/ids";
import { isCaretAtStart } from "./selection";
import { parseClipboardBlocks } from "./paste";
import type { Block } from "../types";

export interface EditableProps {
  block: Block;
  cls?: string;
  placeholder?: string;
  phFocus?: string;
  color?: string | null;
  onInput: (id: string, html: string, text: string) => void;
  onEnter: (id: string, el: HTMLElement) => void;
  onBackspaceEmpty: (id: string) => void;
  onBackspaceAtStart?: (id: string) => void;
  onIndent: (id: string, dir: number) => void;
  onPasteBlocks?: (id: string, el: HTMLElement, blocks: Block[]) => void;
  onUndoStructure?: () => boolean;
  onRedoStructure?: () => boolean;
  onArrow?: (id: string, dir: number, el: HTMLElement) => boolean;
  registerRef?: (
    id: string,
    ref: React.RefObject<HTMLDivElement | null>,
  ) => void;
}

function readSanitizedContent(el: HTMLElement): {
  html: string;
  text: string;
} {
  const html = sanitizeHtml(el.innerHTML);
  const host = document.createElement("div");
  host.innerHTML = html;
  return { html, text: host.textContent || "" };
}

export function Editable({
  block,
  cls = "",
  placeholder,
  phFocus,
  color,
  onInput,
  onEnter,
  onBackspaceEmpty,
  onBackspaceAtStart,
  onIndent,
  onPasteBlocks,
  onUndoStructure,
  onRedoStructure,
  onArrow,
  registerRef,
}: EditableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(!block.text);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want =
      block.html != null
        ? sanitizeHtml(block.html)
        : escapeHtml(block.text || "");
    if (el.innerHTML !== want) el.innerHTML = want;
    setEmpty(!el.textContent);
  }, [block.html, block.id, block.text]);

  useEffect(() => {
    registerRef && registerRef(block.id, ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  return (
    <div
      ref={ref}
      className={`block ${cls} ${empty ? "empty" : ""} ${focused ? "focused" : ""}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-ph={placeholder}
      data-ph-focus={phFocus || placeholder}
      data-color={color || undefined}
      onInput={(e) => {
        const el = e.currentTarget;
        const content = readSanitizedContent(el);
        setEmpty(!content.text);
        onInput(block.id, content.html, content.text);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPaste={(e) => {
        e.preventDefault();
        const data = e.clipboardData.getData("text/plain");
        const html = e.clipboardData.getData("text/html");
        const sel = window.getSelection();
        const isUrl = /^https?:\/\/\S+$/.test((data || "").trim());
        if (isUrl && sel && !sel.isCollapsed) {
          document.execCommand("createLink", false, data.trim());
        } else if (onPasteBlocks) {
          onPasteBlocks(
            block.id,
            e.currentTarget,
            parseClipboardBlocks({ html, text: data }, () => uid("paste")),
          );
          return;
        } else {
          document.execCommand("insertText", false, data);
        }
        const el = ref.current;
        if (el) {
          const content = readSanitizedContent(el);
          onInput(block.id, content.html, content.text);
        }
      }}
      onKeyDown={(e) => {
        const el = ref.current;
        if (!el) return;
        if (isImeComposing(e)) return;
        const key = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && key === "z") {
          const handled = e.shiftKey
            ? onRedoStructure?.()
            : onUndoStructure?.();
          if (handled) e.preventDefault();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(key)) {
          e.preventDefault();
          document.execCommand(
            key === "b" ? "bold" : key === "i" ? "italic" : "underline",
          );
          const content = readSanitizedContent(el);
          onInput(block.id, content.html, content.text);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
          e.preventDefault();
          onEnter(block.id, el);
        } else if (e.key === "Tab") {
          e.preventDefault();
          onIndent(block.id, e.shiftKey ? -1 : 1);
        } else if (e.key === "Backspace" && !el.textContent) {
          e.preventDefault();
          onBackspaceEmpty(block.id);
        } else if (
          e.key === "Backspace" &&
          onBackspaceAtStart &&
          isCaretAtStart(el)
        ) {
          e.preventDefault();
          onBackspaceAtStart(block.id);
        } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && onArrow) {
          const moved = onArrow(block.id, e.key === "ArrowUp" ? -1 : 1, el);
          if (moved) e.preventDefault();
        }
      }}
    />
  );
}
