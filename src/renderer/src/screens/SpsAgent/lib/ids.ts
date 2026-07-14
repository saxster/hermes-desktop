// ids.ts — id generation + block factory. Ported from data.jsx (uid, blk).
import type { Block, BlockType } from "../types";

/** Cryptographically strong id with the caller's short type prefix. */
export const uid = (p = "b"): string => `${p}${crypto.randomUUID()}`;

/** Block factory. `extra` carries type-specific fields (done, emoji, view, …). */
export const blk = (
  type: BlockType,
  text = "",
  extra: Partial<Block> = {},
): Block => ({
  id: uid(),
  type,
  text,
  ...extra,
});
