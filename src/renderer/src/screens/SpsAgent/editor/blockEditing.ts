import { escapeHtml } from "../lib/html";
import { sanitizeHtml } from "../lib/sanitize";
import type { Block, BlockType } from "../types";

export interface RichFragment {
  html: string;
  text: string;
}

const CARRY_TYPES = new Set<BlockType>(["todo", "li", "numli"]);
const EDITABLE_TYPES = new Set<BlockType>([
  "p",
  "h1",
  "h2",
  "h3",
  "quote",
  "code",
  "toggle",
  "callout",
  "todo",
  "li",
  "numli",
]);

function safeFragment(fragment: RichFragment): RichFragment {
  return { html: sanitizeHtml(fragment.html), text: fragment.text };
}

function blockHtml(block: Block): string {
  return sanitizeHtml(block.html ?? escapeHtml(block.text || ""));
}

function cloneBlocks(blocks: Block[]): Block[] {
  return structuredClone(blocks);
}

function sameBlocks(left: Block[], right: Block[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function splitBlockAtCaret(
  block: Block,
  beforeInput: RichFragment,
  afterInput: RichFragment,
  newId: string,
): [Block, Block] {
  const before = safeFragment(beforeInput);
  const after = safeFragment(afterInput);
  const nextType =
    block.type === "toggle"
      ? "p"
      : CARRY_TYPES.has(block.type) && Boolean(block.text)
        ? block.type
        : "p";
  const next: Block = {
    id: newId,
    type: nextType,
    text: after.text,
    html: after.html,
    indent:
      block.type === "toggle" ? (block.indent || 0) + 1 : block.indent || 0,
    done: nextType === "todo" ? false : undefined,
  };
  return [{ ...block, text: before.text, html: before.html }, next];
}

export function mergeBlockBackward(
  blocks: Block[],
  id: string,
): { blocks: Block[]; focus: { id: string; offset: number } } | null {
  const index = blocks.findIndex((block) => block.id === id);
  if (index <= 0) return null;
  const current = blocks[index];
  const previous = blocks[index - 1];
  if (!EDITABLE_TYPES.has(current.type) || !EDITABLE_TYPES.has(previous.type)) {
    return null;
  }
  const offset = previous.text?.length || 0;
  const merged: Block = {
    ...previous,
    html: sanitizeHtml(`${blockHtml(previous)}${blockHtml(current)}`),
    text: `${previous.text || ""}${current.text || ""}`,
  };
  const next = [...blocks];
  next.splice(index - 1, 2, merged);
  return { blocks: next, focus: { id: previous.id, offset } };
}

export function orderedListNumber(blocks: Block[], id: string): number | null {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0 || blocks[index].type !== "numli") return null;
  let segmentStart = index;
  while (segmentStart > 0 && blocks[segmentStart - 1].type === "numli") {
    segmentStart -= 1;
  }
  const indent = blocks[index].indent || 0;
  let count = 0;
  for (let i = segmentStart; i <= index; i += 1) {
    if ((blocks[i].indent || 0) === indent) count += 1;
  }
  return count;
}

export function pasteBlocksAtCaret(
  blocks: Block[],
  id: string,
  beforeInput: RichFragment,
  afterInput: RichFragment,
  pastedInput: Block[],
): Block[] {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0 || pastedInput.length === 0) return blocks;
  const before = safeFragment(beforeInput);
  const after = safeFragment(afterInput);
  const current = blocks[index];
  const pasted = pastedInput.map((block) => ({
    ...block,
    html: blockHtml(block),
  }));
  const replaceCurrentType = !before.text && !after.text && !current.text;
  const first = pasted[0];
  const firstBlock: Block = replaceCurrentType
    ? { ...first, id: current.id }
    : {
        ...current,
        html: sanitizeHtml(`${before.html}${blockHtml(first)}`),
        text: `${before.text}${first.text || ""}`,
      };
  if (pasted.length === 1) {
    firstBlock.html = sanitizeHtml(`${firstBlock.html || ""}${after.html}`);
    firstBlock.text = `${firstBlock.text || ""}${after.text}`;
    return [...blocks.slice(0, index), firstBlock, ...blocks.slice(index + 1)];
  }
  const inserted = [firstBlock, ...pasted.slice(1)];
  const last = inserted[inserted.length - 1];
  inserted[inserted.length - 1] = {
    ...last,
    html: sanitizeHtml(`${blockHtml(last)}${after.html}`),
    text: `${last.text || ""}${after.text}`,
  };
  return [...blocks.slice(0, index), ...inserted, ...blocks.slice(index + 1)];
}

interface HistoryEntry {
  before: Block[];
  after: Block[];
}

export interface StructuralHistory {
  apply: (before: Block[], update: (blocks: Block[]) => Block[]) => Block[];
  undo: (current: Block[]) => Block[] | null;
  redo: (current: Block[]) => Block[] | null;
  clear: () => void;
}

export function createStructuralHistory(limit = 100): StructuralHistory {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  // The document as it looked the last time a drifted undo was declined, so a
  // second press on an unmoved document can tell that the browser's own undo
  // is not going to rewind it.
  let declined: Block[] | null = null;
  return {
    apply(before, update) {
      const after = update(before);
      if (sameBlocks(before, after)) return after;
      undoStack.push({
        before: cloneBlocks(before),
        after: cloneBlocks(after),
      });
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
      declined = null;
      return after;
    },
    undo(current) {
      const entry = undoStack[undoStack.length - 1];
      if (!entry) return null;
      if (!sameBlocks(current, entry.after)) {
        // Text typed straight into a block never reaches this stack, and the
        // browser's own undo rewinds it with far better granularity than one
        // coarse step. So decline the first press and let it try. If the
        // document has not moved by the next press that native stack is gone
        // (rewriting innerHTML clears it, which the markdown shortcuts do), and
        // declining again would leave every entry below unreachable for the
        // rest of the session -- so rewind the drift here instead, keeping it
        // on the redo stack so nothing is discarded.
        if (!declined || !sameBlocks(current, declined)) {
          declined = cloneBlocks(current);
          return null;
        }
        declined = null;
        redoStack.push({
          before: cloneBlocks(entry.after),
          after: cloneBlocks(current),
        });
        return cloneBlocks(entry.after);
      }
      declined = null;
      undoStack.pop();
      redoStack.push(entry);
      return cloneBlocks(entry.before);
    },
    redo(current) {
      const entry = redoStack[redoStack.length - 1];
      if (!entry || !sameBlocks(current, entry.before)) return null;
      declined = null;
      redoStack.pop();
      undoStack.push(entry);
      return cloneBlocks(entry.after);
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      declined = null;
    },
  };
}
