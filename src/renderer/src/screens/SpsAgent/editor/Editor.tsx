// Editor.tsx — block editor orchestrator: rich text, markdown shortcuts, nesting,
// toggles, mentions, slash menu, block menu, drag reorder/nest, AI proposals.
// Ported from editor.jsx Editor. Reads/writes the current page via the store.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Icon } from "../components/Icon";
import { MentionMenu } from "../components/pickers/MentionMenu";
import { blk, uid } from "../lib/ids";
import { sanitizeHtml } from "../lib/sanitize";
import { useStore } from "../store";
import { selectCurrentBlocks } from "../store/selectors";
import { BlockInner } from "./BlockInner";
import { BlockMenu } from "./BlockMenu";
import { BlockRow } from "./BlockRow";
import { SlashMenu, type SlashItem } from "./SlashMenu";
import { detectMarkdown } from "./markdown";
import {
  caretRect,
  editableSelectionFragments,
  insertMentionChip,
  mentionQuery,
  placeCaretAtTextOffset,
  placeCaretEnd,
  type MentionItem,
} from "./selection";
import {
  createStructuralHistory,
  mergeBlockBackward,
  orderedListNumber,
  pasteBlocksAtCaret,
  splitBlockAtCaret,
} from "./blockEditing";
import {
  deleteRange,
  extendRange,
  moveRange,
  rangeBlockIds,
  rangeBlocks,
  wholeDocumentRange,
  type BlockRange,
} from "./blockSelection";
import { blocksToMarkdown } from "./blockMarkdown";
import type { Block, BlockType, DbView, Task } from "../types";

interface MenuState {
  blockId: string;
  x: number;
  y: number;
  query: string;
}

type Row =
  | { kind: "block"; block: Block }
  | { kind: "proposal"; proposalId: string; label?: string; blocks: Block[] };

/** Take the caret out of the document so a block selection owns the keyboard. */
function blurActiveEditable(): void {
  const active = document.activeElement as HTMLElement | null;
  // The attribute, not `isContentEditable`: the latter reports the computed
  // editing host, which not every DOM implementation fills in.
  if (active?.closest?.("[contenteditable]")) active.blur();
}

export function Editor() {
  const blocks = useStore(selectCurrentBlocks);
  const setBlocks = useStore((s) => s.setBlocks);
  const onOpenTask = useStore((s) => s.setOpenTask);
  const focusReq = useStore((s) => s.focusReq);
  const setFocusReq = useStore((s) => s.setFocusReq);
  const onProposalDecision = useStore((s) => s.decideProposal);
  const onComment = useStore((s) => s.addBlockComment);
  const onToast = useStore((s) => s.flash);
  const createChildPage = useStore((s) => s.createChildPage);
  const onOpenPage = useStore((s) => s.selectPage);
  const runPlan = useStore((s) => s.runPlan);
  const runWork = useStore((s) => s.runWork);
  const pageMeta = useStore((s) => s.meta);
  const page = useStore((s) => s.page);
  const historyRef = useRef(createStructuralHistory());

  useEffect(() => {
    historyRef.current.clear();
    setSelection(null);
  }, [page]);

  // Copy an Obsidian block ref and mark the block so markdown keeps its ^id.
  const copyBlockLink = (id: string): void => {
    setBlocks((bs) =>
      bs.map((b) => (b.id === id ? { ...b, anchor: true } : b)),
    );
    navigator.clipboard
      ?.writeText(`[[${page}#^${id}]]`)
      .then(() => onToast("Link to block copied"))
      .catch(() => onToast("Couldn't copy link", { tone: "warn" }));
  };

  const refs = useRef<Record<string, RefObject<HTMLDivElement | null>>>({});
  const blocksRef = useRef<HTMLDivElement>(null);
  const [slash, setSlash] = useState<MenuState | null>(null);
  const [mention, setMention] = useState<MenuState | null>(null);
  const [bmenu, setBmenu] = useState<{
    block: Block;
    x: number;
    y: number;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overIndent, setOverIndent] = useState(0);
  const [selection, setSelection] = useState<BlockRange | null>(null);

  const registerRef = useCallback(
    (id: string, r: RefObject<HTMLDivElement | null>) => {
      refs.current[id] = r;
    },
    [],
  );

  useEffect(() => {
    if (focusReq && refs.current[focusReq]) {
      const el = refs.current[focusReq].current;
      if (el) {
        el.focus();
        placeCaretEnd(el);
      }
      setFocusReq(null);
    }
    // refs is a stable ref container and setFocusReq is stable; only a new
    // focusReq should trigger the focus one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  // Every change to a block's shape -- type, order, indent, done, colour --
  // goes through here so it lands on the undo stack. Text/html edits are the
  // deliberate exception: the browser's own undo already handles those with
  // per-word granularity and free caret restoration.
  const commitStructure = (update: (current: Block[]) => Block[]) =>
    setBlocks((current) => historyRef.current.apply(current, update));

  const setType = (id: string, patch: Partial<Block>) =>
    commitStructure((bs) =>
      bs.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    );

  const focusSoon = (id: string) =>
    requestAnimationFrame(() => {
      const el = refs.current[id]?.current;
      if (el) el.focus();
    });

  const focusAtOffsetSoon = (id: string, offset: number) =>
    requestAnimationFrame(() => {
      const el = refs.current[id]?.current;
      if (!el) return;
      el.focus();
      placeCaretAtTextOffset(el, offset);
    });

  const insertAfter = (id: string, nb: Block) =>
    commitStructure((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const next = [...bs];
      const indent = bs[i] ? bs[i].indent || 0 : 0;
      next.splice(i + 1, 0, {
        ...nb,
        indent: nb.indent != null ? nb.indent : indent,
      });
      return next;
    });

  const updateBlock = (id: string, html: string, text: string) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, html, text } : b)));
    // markdown shortcuts
    const md = detectMarkdown(text);
    if (md) {
      const el = refs.current[id]?.current;
      if (md.type === "divider") {
        setType(id, { type: "divider", html: "", text: "" });
        const nb = blk("p", "");
        insertAfter(id, nb);
        focusSoon(nb.id);
      } else {
        setType(id, {
          type: md.type,
          html: "",
          text: "",
          done: md.type === "todo" ? false : undefined,
          collapsed: md.type === "toggle" ? false : undefined,
        });
        if (el) {
          el.innerHTML = "";
          requestAnimationFrame(() => el.focus());
        }
      }
      setSlash(null);
      setMention(null);
      return;
    }
    // slash
    if (text === "/" || (text.startsWith("/") && !text.includes(" "))) {
      const r = caretRect();
      if (r)
        setSlash({
          blockId: id,
          x: r.left,
          y: r.bottom + 6,
          query: text.slice(1),
        });
    } else if (slash && slash.blockId === id) setSlash(null);
    // mention
    const mq = mentionQuery();
    if (mq != null) {
      const r = caretRect();
      if (r) setMention({ blockId: id, x: r.left, y: r.bottom + 6, query: mq });
    } else if (mention) setMention(null);
  };

  const onEnter = (id: string, el: HTMLElement) => {
    const fragments = editableSelectionFragments(el);
    const newId = uid("b");
    commitStructure((current) => {
      const index = current.findIndex((block) => block.id === id);
      if (index < 0) return current;
      const split = splitBlockAtCaret(
        current[index],
        fragments.before,
        fragments.after,
        newId,
      );
      const next = [...current];
      next.splice(index, 1, ...split);
      return next;
    });
    focusAtOffsetSoon(newId, 0);
  };

  const onBackspaceEmpty = (id: string) => {
    const cur = blocks.find((b) => b.id === id);
    if (cur && (cur.indent || 0) > 0) {
      commitStructure((current) =>
        current.map((block) =>
          block.id === id
            ? { ...block, indent: (block.indent || 0) - 1 }
            : block,
        ),
      );
      return;
    }
    if (cur && cur.type !== "p") {
      commitStructure((current) =>
        current.map((block) =>
          block.id === id ? { ...block, type: "p" } : block,
        ),
      );
      return;
    }
    commitStructure((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      if (i <= 0) return bs;
      const prev = bs[i - 1];
      requestAnimationFrame(() => {
        const el = refs.current[prev.id]?.current;
        if (el) {
          el.focus();
          placeCaretEnd(el);
        }
      });
      return bs.filter((b) => b.id !== id);
    });
  };

  const onBackspaceAtStart = (id: string) => {
    const merged = mergeBlockBackward(blocks, id);
    if (!merged) return;
    commitStructure(() => merged.blocks);
    focusAtOffsetSoon(merged.focus.id, merged.focus.offset);
  };

  const onIndent = (id: string, dir: number) =>
    commitStructure((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const maxIndent = i > 0 ? (bs[i - 1].indent || 0) + 1 : 0;
      const cur = Math.max(
        0,
        Math.min((bs[i].indent || 0) + dir, dir > 0 ? maxIndent : 99),
      );
      return bs.map((b) => (b.id === id ? { ...b, indent: cur } : b));
    });

  const onPasteBlocks = (id: string, el: HTMLElement, pasted: Block[]) => {
    if (pasted.length === 0) return;
    const fragments = editableSelectionFragments(el);
    const focusId = pasted.length > 1 ? pasted[pasted.length - 1].id : id;
    const focusOffset =
      pasted.length > 1
        ? pasted[pasted.length - 1].text.length
        : fragments.before.text.length + pasted[0].text.length;
    commitStructure((current) =>
      pasteBlocksAtCaret(
        current,
        id,
        fragments.before,
        fragments.after,
        pasted,
      ),
    );
    focusAtOffsetSoon(focusId, focusOffset);
  };

  const onUndoStructure = (): boolean => {
    let handled = false;
    setBlocks((current) => {
      const restored = historyRef.current.undo(current);
      handled = restored !== null;
      return restored ?? current;
    });
    return handled;
  };

  const onRedoStructure = (): boolean => {
    let handled = false;
    setBlocks((current) => {
      const restored = historyRef.current.redo(current);
      handled = restored !== null;
      return restored ?? current;
    });
    return handled;
  };

  const onArrow = (id: string, dir: number): boolean => {
    const i = blocks.findIndex((b) => b.id === id);
    const t = blocks[i + dir];
    if (t && refs.current[t.id]?.current) {
      const el = refs.current[t.id].current!;
      el.focus();
      placeCaretEnd(el);
      return true;
    }
    return false;
  };

  // ── multi-block selection ─────────────────────────────────────────────────
  // A text selection cannot span two contentEditable hosts, so acting on more
  // than one block at a time needs its own selection model: a contiguous range,
  // kept here, with the caret taken out of the document while it is live.

  const selectedIds = new Set(
    selection ? rangeBlockIds(blocks, selection) : [],
  );

  const onSelectBlock = (id: string): void => {
    // Escape belongs to an open menu first — it closes itself.
    if (slash || mention) return;
    blurActiveEditable();
    setSelection({ anchorId: id, headId: id });
  };

  const onSelectNeighbour = (id: string, dir: number): boolean => {
    const index = blocks.findIndex((block) => block.id === id);
    const neighbour = blocks[index + dir];
    if (!neighbour) return false;
    blurActiveEditable();
    setSelection({ anchorId: id, headId: neighbour.id });
    return true;
  };

  const copySelection = (range: BlockRange): void => {
    const covered = rangeBlocks(blocks, range);
    if (covered.length === 0) return;
    const markdown = blocksToMarkdown(covered);
    const noun = covered.length === 1 ? "block" : "blocks";
    navigator.clipboard
      ?.writeText(markdown)
      .then(() => onToast(`Copied ${covered.length} ${noun} as markdown`))
      .catch(() => onToast("Couldn't copy", { tone: "warn" }));
  };

  const deleteSelection = (range: BlockRange): void => {
    const removed = new Set(rangeBlockIds(blocks, range));
    if (removed.size === 0) {
      setSelection(null);
      return;
    }
    const firstIndex = blocks.findIndex((block) => removed.has(block.id));
    const next = deleteRange(blocks, range, uid("b"));
    // The block that slid up into the gap is where the caret belongs; at the
    // end of the page that is the new last block instead.
    const focusTarget = next[Math.min(firstIndex, next.length - 1)];
    commitStructure(() => next);
    setSelection(null);
    if (focusTarget) focusSoon(focusTarget.id);
  };

  // While a range is selected no contentEditable is focused, so the block
  // commands have to be read off the window — there is nothing else to carry
  // them. Anything typed into a real input elsewhere is left alone.
  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']"))
        return;
      if (event.key === "Escape") {
        setSelection(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelection(selection);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const covered = rangeBlockIds(blocks, selection);
        const lastId = covered[covered.length - 1];
        setSelection(null);
        if (lastId) setFocusReq(lastId);
        return;
      }
      const chord = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (chord && key === "a") {
        event.preventDefault();
        setSelection(wholeDocumentRange(blocks));
        return;
      }
      if (chord && (key === "c" || key === "x")) {
        event.preventDefault();
        copySelection(selection);
        if (key === "x") deleteSelection(selection);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const dir = event.key === "ArrowUp" ? -1 : 1;
        const next = event.shiftKey
          ? extendRange(blocks, selection, dir)
          : moveRange(blocks, selection, dir);
        if (next) setSelection(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // copySelection/deleteSelection are rebuilt every render and close over the
    // same `blocks`, so listing them would resubscribe on each keystroke for no
    // behavioural gain; setFocusReq is a stable store action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, blocks]);

  // One handler covers both mouse gestures: Shift+click extends the live range
  // to the clicked block, a plain click anywhere in the page dismisses it.
  const onBlocksMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!selection) return;
    const wrap = (event.target as HTMLElement).closest(".block-wrap");
    const clickedId = wrap?.id.startsWith("bw-") ? wrap.id.slice(3) : null;
    if (event.shiftKey && clickedId) {
      event.preventDefault();
      setSelection({ anchorId: selection.anchorId, headId: clickedId });
      return;
    }
    setSelection(null);
  };

  const applySlash = (item: SlashItem) => {
    if (!slash) return;
    const id = slash.blockId;
    setSlash(null);
    // AI/workflow actions don't insert a block — they dispatch to the assistant.
    if (item.action) {
      const block = blocks.find((b) => b.id === id);
      const idea = block?.text ?? "";
      if (item.action === "plan") runPlan(idea);
      else if (item.action === "work") runWork();
      return;
    }
    if (item.type === "divider") {
      setType(id, { type: "divider", html: "", text: "" });
      const nb = blk("p", "");
      insertAfter(id, nb);
      focusSoon(nb.id);
      return;
    }
    if (item.type === "database") {
      setType(id, { type: "database", html: "", text: "", view: "board" });
      return;
    }
    if (
      item.type === "image" ||
      item.type === "audio" ||
      item.type === "video" ||
      item.type === "file"
    ) {
      setType(id, { type: item.type, html: "", text: "" });
      return;
    }
    if (item.type === "mermaid") {
      setType(id, { type: "mermaid", html: "", text: "" });
      return;
    }
    if (item.type === "excalidraw") {
      // No src yet — the block mints its assetId and writes the sidecar on the
      // first edit, then records the preview-svg path back into `src`.
      setType(id, { type: "excalidraw", html: "", text: "", src: null });
      return;
    }
    if (item.type === "bookmark") {
      setType(id, { type: "bookmark", html: "", text: "", bm: null });
      return;
    }
    if (item.type === "columns") {
      // Seed two columns, each with one empty paragraph to type into; the block's
      // own control adds a third (max 3).
      setType(id, {
        type: "columns",
        html: "",
        text: "",
        columns: [[blk("p", "")], [blk("p", "")]],
      });
      return;
    }
    if (item.type === "button") {
      // Seed an editable label + empty prompt; the block opens its editor when
      // run with no prompt set. Templates ship a preset agentPrompt instead.
      setType(id, {
        type: "button",
        html: "",
        text: "Run",
        emoji: "✨",
        agentPrompt: "",
      });
      return;
    }
    if (item.type === "page") {
      const pid = createChildPage();
      if (pid) setType(id, { type: "page", pageId: pid, html: "", text: "" });
      return;
    }
    if (!item.type) return;
    setType(id, {
      type: item.type,
      html: "",
      text: "",
      done: item.type === "todo" ? false : undefined,
      collapsed: item.type === "toggle" ? false : undefined,
    });
    const el = refs.current[id]?.current;
    if (el) {
      el.innerHTML = "";
      focusSoon(id);
    }
  };

  const onInputFromDom = (id: string, el?: HTMLElement) => {
    const node = el || refs.current[id]?.current;
    if (!node) return;
    setBlocks((bs) =>
      bs.map((b) =>
        b.id === id
          ? {
              ...b,
              html: sanitizeHtml(node.innerHTML),
              text: node.textContent || "",
            }
          : b,
      ),
    );
  };

  const pickMention = (item: MentionItem) => {
    if (!mention) return;
    const id = mention.blockId;
    const el = refs.current[id]?.current;
    setMention(null);
    if (!el) return;
    insertMentionChip(el, item, mention.query.length);
    onInputFromDom(id, el);
  };

  // Manual "Suggest details": ask the AI to propose fragments/tags for a
  // contact. Nothing is written to the row — the result lands in the Review
  // Queue. Best-effort: a gateway/contact miss just toasts and moves on.
  const proposeEnrichment = (personId: string): void => {
    setMention(null);
    (async () => {
      try {
        const res =
          await window.hermesAPI.spsProposeContactEnrichment?.(personId);
        if (res?.created) {
          onToast(
            `Suggested ${res.fragments ?? 0} fragment(s) + ${res.tags ?? 0} tag(s) — review in the AI Review Queue`,
          );
        } else {
          onToast("No new contact details to suggest");
        }
      } catch {
        onToast("Could not suggest contact details");
      }
    })().catch((error: unknown) => {
      console.error("Contact enrichment failed:", error);
      onToast("Could not suggest contact details", { tone: "warn" });
    });
  };

  // Manual "Suggest properties" (autofill, not data entry): the AI proposes
  // property updates for the contact from notes that mention them — landed as
  // update-frontmatter operations in the Review Queue, never written directly.
  const proposeAutofill = (personId: string): void => {
    setMention(null);
    (async () => {
      try {
        const res = await window.hermesAPI.spsProposePropertyAutofill?.(
          "people",
          personId,
        );
        if (res?.created) {
          const count = res.updates ?? 0;
          onToast(
            `Suggested ${count} propert${count === 1 ? "y" : "ies"} — review in the AI Review Queue`,
          );
        } else {
          const reasons: Record<string, string> = {
            "no-context": "No notes mention this contact yet",
            "nothing-new": "No new properties to suggest",
            unsupported: "Autofill is not available for this row",
          };
          onToast(reasons[res?.reason ?? ""] ?? "Could not suggest properties");
        }
      } catch {
        onToast("Could not suggest properties");
      }
    })().catch((error: unknown) => {
      console.error("Property autofill failed:", error);
      onToast("Could not suggest properties", { tone: "warn" });
    });
  };

  const toggleTodo = (id: string) =>
    commitStructure((bs) =>
      bs.map((b) => (b.id === id ? { ...b, done: !b.done } : b)),
    );
  const toggleCollapse = (id: string) =>
    commitStructure((bs) =>
      bs.map((b) => (b.id === id ? { ...b, collapsed: !b.collapsed } : b)),
    );
  const setView = (id: string, view: DbView) => setType(id, { view });

  const turnInto = (id: string, type: BlockType) =>
    commitStructure((current) =>
      current.map((block) =>
        block.id === id
          ? {
              ...block,
              type,
              done: type === "todo" ? false : undefined,
              collapsed: type === "toggle" ? false : undefined,
            }
          : block,
      ),
    );
  const colorBlock = (
    id: string,
    patch: { color?: string | null; bg?: string | null },
  ) =>
    commitStructure((bs) =>
      bs.map((b) =>
        b.id === id
          ? {
              ...b,
              color: "color" in patch ? patch.color : b.color,
              bg: "bg" in patch ? patch.bg : b.bg,
            }
          : b,
      ),
    );
  const duplicate = (id: string) =>
    commitStructure((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const copy = { ...bs[i], id: uid("b") };
      const n = [...bs];
      n.splice(i + 1, 0, copy);
      return n;
    });
  const removeBlock = (id: string) =>
    commitStructure((bs) => bs.filter((b) => b.id !== id));

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    commitStructure((bs) => {
      const from = bs.findIndex((b) => b.id === dragId);
      const to = bs.findIndex((b) => b.id === targetId);
      const n = [...bs];
      const [m] = n.splice(from, 1);
      const insertAt = to;
      n.splice(insertAt, 0, m);
      const prev = n[insertAt - 1];
      const max = prev ? (prev.indent || 0) + 1 : 0;
      n[insertAt] = { ...m, indent: Math.max(0, Math.min(overIndent, max)) };
      return n;
    });
    setDragId(null);
    setOverId(null);
  };
  const computeIndent = (clientX: number) => {
    const left = blocksRef.current
      ? blocksRef.current.getBoundingClientRect().left
      : 0;
    setOverIndent(
      Math.max(0, Math.min(Math.round((clientX - left - 2) / 24), 6)),
    );
  };

  // group proposals + compute toggle visibility
  const rows: Row[] = [];
  let hideDeeper: number | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (hideDeeper != null) {
      if ((b.indent || 0) > hideDeeper) continue;
      else hideDeeper = null;
    }
    if (b.proposalId) {
      const group = [b];
      while (
        i + 1 < blocks.length &&
        blocks[i + 1].proposalId === b.proposalId
      ) {
        group.push(blocks[i + 1]);
        i++;
      }
      rows.push({
        kind: "proposal",
        proposalId: b.proposalId,
        label: b.proposalLabel,
        blocks: group,
      });
    } else {
      rows.push({ kind: "block", block: b });
      if (b.type === "toggle" && b.collapsed) hideDeeper = b.indent || 0;
    }
  }

  const innerProps = {
    updateBlock,
    onEnter,
    onBackspaceEmpty,
    onBackspaceAtStart,
    onIndent,
    onPasteBlocks,
    onUndoStructure,
    onRedoStructure,
    onArrow,
    onSelectBlock,
    onSelectNeighbour,
    toggleTodo,
    toggleCollapse,
    registerRef,
    setView,
    onOpenTask: onOpenTask as (t: Task) => void,
    setType,
    onInputFromDom: (id: string) => onInputFromDom(id),
    onDecision: onProposalDecision,
    onOpenPage,
    pageMeta,
  };

  return (
    <div className="blocks" ref={blocksRef} onMouseDown={onBlocksMouseDown}>
      {rows.map((row) =>
        row.kind === "block" ? (
          <BlockRow
            key={row.block.id}
            block={row.block}
            selected={selectedIds.has(row.block.id)}
            dragId={dragId}
            overId={overId}
            overIndent={overIndent}
            setDragId={setDragId}
            setOverId={setOverId}
            onDrop={onDrop}
            computeIndent={computeIndent}
            onMenu={(rect) =>
              setBmenu({ block: row.block, x: rect.right + 4, y: rect.top })
            }
            onAdd={(rect) =>
              setSlash({
                blockId: row.block.id,
                x: rect.right + 4,
                y: rect.bottom + 4,
                query: "",
              })
            }
          >
            <BlockInner
              block={row.block}
              listNumber={orderedListNumber(blocks, row.block.id)}
              {...innerProps}
            />
          </BlockRow>
        ) : (
          <div
            className="proposed-group"
            id={`grp-${row.proposalId}`}
            key={row.proposalId}
          >
            <div className="proposed-head">
              <span className="dot"></span>
              <Icon name="sparkle" size={13} /> {row.label || "Suggested edit"}
              <div className="proposed-actions">
                <button
                  className="pa-btn pa-reject"
                  onClick={() => onProposalDecision(row.proposalId, false)}
                >
                  Discard
                </button>
                <button
                  className="pa-btn pa-accept"
                  onClick={() => onProposalDecision(row.proposalId, true)}
                >
                  <Icon name="check" size={13} /> Accept
                </button>
              </div>
            </div>
            {row.blocks.map((b) => (
              <BlockInner key={b.id} block={b} {...innerProps} />
            ))}
          </div>
        ),
      )}

      {slash && (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          query={slash.query}
          onPick={applySlash}
          onClose={() => setSlash(null)}
        />
      )}
      {mention && (
        <MentionMenu
          x={mention.x}
          y={mention.y}
          query={mention.query}
          onPick={pickMention}
          onClose={() => setMention(null)}
          onProposeEnrichment={proposeEnrichment}
          onProposeAutofill={proposeAutofill}
        />
      )}
      {bmenu && (
        <BlockMenu
          x={bmenu.x}
          y={bmenu.y}
          block={bmenu.block}
          onClose={() => setBmenu(null)}
          onTurnInto={turnInto}
          onColor={colorBlock}
          onDuplicate={duplicate}
          onCopyLink={copyBlockLink}
          onDelete={removeBlock}
          onComment={(id) => onComment(id, bmenu.block.text || "block")}
        />
      )}
    </div>
  );
}
