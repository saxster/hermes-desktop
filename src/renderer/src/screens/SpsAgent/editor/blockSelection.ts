// blockSelection.ts — a contiguous run of selected blocks: which blocks a range
// covers, how the range moves, and what deleting it leaves behind. Kept pure so
// the keyboard rules can be tested without a caret or a DOM selection.
import type { Block } from "../types";

/** A contiguous run of blocks, anchored where the selection started. */
export interface BlockRange {
  anchorId: string;
  headId: string;
}

function indexOfId(blocks: Block[], id: string): number {
  return blocks.findIndex((block) => block.id === id);
}

/** The ids a range covers, in document order. Empty if either end is gone. */
export function rangeBlockIds(blocks: Block[], range: BlockRange): string[] {
  const anchor = indexOfId(blocks, range.anchorId);
  const head = indexOfId(blocks, range.headId);
  if (anchor < 0 || head < 0) return [];
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  return blocks.slice(from, to + 1).map((block) => block.id);
}

/** The blocks a range covers, in document order. */
export function rangeBlocks(blocks: Block[], range: BlockRange): Block[] {
  const covered = new Set(rangeBlockIds(blocks, range));
  return blocks.filter((block) => covered.has(block.id));
}

/** Move the head end one block, keeping the anchor put — Shift+Arrow. */
export function extendRange(
  blocks: Block[],
  range: BlockRange,
  dir: number,
): BlockRange | null {
  const head = indexOfId(blocks, range.headId);
  if (head < 0) return null;
  const next = blocks[head + dir];
  if (!next) return null;
  return { anchorId: range.anchorId, headId: next.id };
}

/** Collapse a multi-block range to its leading edge, or step one block — Arrow. */
export function moveRange(
  blocks: Block[],
  range: BlockRange,
  dir: number,
): BlockRange | null {
  const covered = rangeBlockIds(blocks, range);
  if (covered.length === 0) return null;
  const edgeId = dir < 0 ? covered[0] : covered[covered.length - 1];
  if (covered.length > 1) return { anchorId: edgeId, headId: edgeId };
  const edge = indexOfId(blocks, edgeId);
  const next = blocks[edge + dir];
  if (!next) return null;
  return { anchorId: next.id, headId: next.id };
}

/** The whole document as one range, or null when there is nothing to select. */
export function wholeDocumentRange(blocks: Block[]): BlockRange | null {
  if (blocks.length === 0) return null;
  return { anchorId: blocks[0].id, headId: blocks[blocks.length - 1].id };
}

/**
 * Remove every block the range covers.
 *
 * A page that deletes down to nothing has no contentEditable left to focus, so
 * the caret would have nowhere to go and the page would be unrecoverable from
 * the keyboard. One empty paragraph is kept in that case.
 */
export function deleteRange(
  blocks: Block[],
  range: BlockRange,
  emptyId: string,
): Block[] {
  const doomed = new Set(rangeBlockIds(blocks, range));
  if (doomed.size === 0) return blocks;
  const remaining = blocks.filter((block) => !doomed.has(block.id));
  if (remaining.length > 0) return remaining;
  return [{ id: emptyId, type: "p", text: "" }];
}
