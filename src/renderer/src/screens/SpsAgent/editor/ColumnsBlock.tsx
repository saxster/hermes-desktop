// ColumnsBlock.tsx — a side-by-side layout block (2–3 columns), where each column
// is its OWN list of blocks (todos, headings, lists, quotes, …), not just rich
// text. Columns live in `block.columns` (Block[][]). Still a "special" block: it
// is NOT in the serializer's cleanTypes, so the whole nested structure round-trips
// losslessly through the generic Tier-2 `<!-- sps:… -->` meta comment.
//
// Each column runs a small, self-contained editor (ColumnEditor) that reuses
// BlockInner for rendering and the same markdown-shortcut / Enter / Backspace /
// indent grammar as the page editor — but with no slash menu, so a column can't
// nest another columns block (no recursion) or a database/media block.
import { useCallback, useRef, type RefObject } from "react";
import { Icon } from "../components/Icon";
import { uid } from "../lib/ids";
import { stripHtml } from "../lib/html";
import { sanitizeHtml } from "../lib/sanitize";
import { detectMarkdown } from "./markdown";
import {
  editableSelectionFragments,
  placeCaretAtTextOffset,
  placeCaretEnd,
} from "./selection";
import { BlockInner } from "./BlockInner";
import {
  createStructuralHistory,
  mergeBlockBackward,
  orderedListNumber,
  pasteBlocksAtCaret,
  splitBlockAtCaret,
} from "./blockEditing";
import { useStore } from "../store";
import type { Block } from "../types";

const MIN_COLS = 1;
const MAX_COLS = 3;
interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

/** A fresh empty paragraph — every column keeps at least one block to type into. */
function emptyBlock(): Block {
  return { id: uid(), type: "p", text: "" };
}

/** Coerce stored columns into Block[][], tolerating the legacy rich-text shape
 *  (string per column) and guaranteeing every column has at least one block. */
function normalizeColumns(raw: Block["columns"]): Block[][] {
  const cols: unknown[] = raw && raw.length ? (raw as unknown[]) : [[], []];
  return cols.map((col) => {
    if (typeof col === "string") {
      const html = col;
      return html.trim()
        ? [{ id: uid(), type: "p", text: stripHtml(html), html }]
        : [emptyBlock()];
    }
    const arr = Array.isArray(col) ? (col as Block[]) : [];
    return arr.length ? arr : [emptyBlock()];
  });
}

export function ColumnsBlock({ block, setType }: Props) {
  const cols = normalizeColumns(block.columns);

  const setColumn = (i: number, blocks: Block[]): void => {
    const next = cols.map((c, j) => (j === i ? blocks : c));
    setType(block.id, { columns: next });
  };

  const addColumn = (): void => {
    if (cols.length >= MAX_COLS) return;
    setType(block.id, { columns: [...cols, [emptyBlock()]] });
  };

  const removeColumn = (i: number): void => {
    if (cols.length <= MIN_COLS) return;
    setType(block.id, { columns: cols.filter((_, j) => j !== i) });
  };

  return (
    <div
      className="b-columns"
      style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
    >
      {cols.map((colBlocks, i) => (
        <div key={i} className="b-col">
          {cols.length > MIN_COLS && (
            <button
              className="b-col-del"
              title="Remove column"
              onMouseDown={(e) => {
                e.preventDefault();
                removeColumn(i);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
          <ColumnEditor
            blocks={colBlocks}
            onChange={(next) => setColumn(i, next)}
          />
        </div>
      ))}
      {cols.length < MAX_COLS && (
        <button
          className="b-col-add"
          title="Add column"
          onMouseDown={(e) => {
            e.preventDefault();
            addColumn();
          }}
        >
          <Icon name="plus" size={15} />
        </button>
      )}
    </div>
  );
}

/** A minimal block editor over one column's Block[]. Reuses BlockInner + the page
 *  editor's keyboard grammar, scoped to `blocks` via `onChange`. */
function ColumnEditor({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
}) {
  const refs = useRef<Record<string, RefObject<HTMLDivElement | null>>>({});
  const historyRef = useRef(createStructuralHistory());
  const pageMeta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);

  const set = (updater: (bs: Block[]) => Block[]): void =>
    onChange(updater(blocks));
  const commitStructure = (updater: (bs: Block[]) => Block[]): void =>
    onChange(historyRef.current.apply(blocks, updater));
  const setType = (id: string, patch: Partial<Block>): void =>
    set((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const focusSoon = (id: string): void =>
    void requestAnimationFrame(() => refs.current[id]?.current?.focus());
  const focusAtOffsetSoon = (id: string, offset: number): void =>
    void requestAnimationFrame(() => {
      const el = refs.current[id]?.current;
      if (!el) return;
      el.focus();
      placeCaretAtTextOffset(el, offset);
    });

  const registerRef = useCallback(
    (id: string, r: RefObject<HTMLDivElement | null>) => {
      refs.current[id] = r;
    },
    [],
  );

  const insertAfter = (id: string, nb: Block): void =>
    set((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const indent = bs[i] ? bs[i].indent || 0 : 0;
      const next = [...bs];
      next.splice(i + 1, 0, {
        ...nb,
        indent: nb.indent != null ? nb.indent : indent,
      });
      return next;
    });

  const updateBlock = (id: string, html: string, text: string): void => {
    set((bs) => bs.map((b) => (b.id === id ? { ...b, html, text } : b)));
    const md = detectMarkdown(text);
    if (!md) return;
    const el = refs.current[id]?.current;
    if (md.type === "divider") {
      setType(id, { type: "divider", html: "", text: "" });
      const nb = emptyBlock();
      insertAfter(id, nb);
      focusSoon(nb.id);
      return;
    }
    setType(id, {
      type: md.type,
      html: "",
      text: "",
      done: md.type === "todo" ? false : undefined,
      collapsed: md.type === "toggle" ? false : undefined,
    });
    if (el) {
      // Clear the typed markdown prefix from the DOM (the block's html/text are
      // already reset above; Editable won't re-seed since the id is unchanged).
      // eslint-disable-next-line react-hooks/immutability
      el.innerHTML = "";
      requestAnimationFrame(() => el.focus());
    }
  };

  const onEnter = (id: string, el: HTMLElement): void => {
    const fragments = editableSelectionFragments(el);
    const newId = uid("b");
    commitStructure((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) return current;
      const next = [...current];
      next.splice(
        index,
        1,
        ...splitBlockAtCaret(
          current[index],
          fragments.before,
          fragments.after,
          newId,
        ),
      );
      return next;
    });
    focusAtOffsetSoon(newId, 0);
  };

  const onBackspaceEmpty = (id: string): void => {
    const cur = blocks.find((b) => b.id === id);
    if (cur && (cur.indent || 0) > 0) {
      commitStructure((current) =>
        current.map((item) =>
          item.id === id ? { ...item, indent: (item.indent || 0) - 1 } : item,
        ),
      );
      return;
    }
    if (cur && cur.type !== "p") {
      commitStructure((current) =>
        current.map((item) => (item.id === id ? { ...item, type: "p" } : item)),
      );
      return;
    }
    commitStructure((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      if (i <= 0) return bs; // keep the column's first block — never empties out
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

  const onBackspaceAtStart = (id: string): void => {
    const merged = mergeBlockBackward(blocks, id);
    if (!merged) return;
    commitStructure(() => merged.blocks);
    focusAtOffsetSoon(merged.focus.id, merged.focus.offset);
  };

  const onPasteBlocks = (
    id: string,
    el: HTMLElement,
    pasted: Block[],
  ): void => {
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

  const onIndent = (id: string, dir: number): void =>
    commitStructure((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const maxIndent = i > 0 ? (bs[i - 1].indent || 0) + 1 : 0;
      const cur = Math.max(
        0,
        Math.min((bs[i].indent || 0) + dir, dir > 0 ? maxIndent : 99),
      );
      return bs.map((b) => (b.id === id ? { ...b, indent: cur } : b));
    });

  const onUndoStructure = (): boolean => {
    const restored = historyRef.current.undo(blocks);
    if (!restored) return false;
    onChange(restored);
    return true;
  };

  const onRedoStructure = (): boolean => {
    const restored = historyRef.current.redo(blocks);
    if (!restored) return false;
    onChange(restored);
    return true;
  };

  const onArrow = (id: string, dir: number): boolean => {
    const i = blocks.findIndex((b) => b.id === id);
    const t = blocks[i + dir];
    const el = t && refs.current[t.id]?.current;
    if (el) {
      el.focus();
      placeCaretEnd(el);
      return true;
    }
    return false;
  };

  const onInputFromDom = (id: string, el?: HTMLElement): void => {
    const node = el || refs.current[id]?.current;
    if (!node) return;
    set((bs) =>
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

  return (
    <div className="col-editor">
      {blocks.map((b) => (
        <div
          key={b.id}
          className="col-block"
          style={b.indent ? { marginLeft: b.indent * 18 } : undefined}
        >
          <BlockInner
            block={b}
            updateBlock={updateBlock}
            onEnter={onEnter}
            onBackspaceEmpty={onBackspaceEmpty}
            onBackspaceAtStart={onBackspaceAtStart}
            onIndent={onIndent}
            onPasteBlocks={onPasteBlocks}
            onUndoStructure={onUndoStructure}
            onRedoStructure={onRedoStructure}
            onArrow={onArrow}
            toggleTodo={(id) =>
              set((bs) =>
                bs.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
              )
            }
            toggleCollapse={(id) =>
              set((bs) =>
                bs.map((x) =>
                  x.id === id ? { ...x, collapsed: !x.collapsed } : x,
                ),
              )
            }
            registerRef={registerRef}
            setView={(id, view) => setType(id, { view })}
            onOpenTask={() => {}}
            setType={setType}
            onInputFromDom={onInputFromDom}
            onDecision={() => {}}
            onOpenPage={selectPage}
            pageMeta={pageMeta}
            listNumber={orderedListNumber(blocks, b.id)}
          />
        </div>
      ))}
    </div>
  );
}
