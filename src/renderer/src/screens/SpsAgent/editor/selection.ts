// selection.ts — caret/selection + @-mention DOM helpers. Ported from editor.jsx
// (caretRect, mentionQuery, insertMentionChip, placeCaretEnd).
export interface MentionItem {
  kind: "person" | "page" | "date";
  id: string;
  label: string;
  color?: string;
  initials?: string;
  emoji?: string;
}

export interface EditableSelectionFragments {
  before: { html: string; text: string };
  after: { html: string; text: string };
}

/** Allow only simple CSS color tokens for mention chips (no url()/expression). */
export function safeCssColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{3,8}$/.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*[\d.\s%,]+\)$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]{1,20}$/.test(trimmed)) return trimmed;
  return undefined;
}

export function caretRect(): DOMRect | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange();
  r.collapse(true);
  let rect = r.getBoundingClientRect();
  const start = r.startContainer as Element & {
    getBoundingClientRect?: () => DOMRect;
  };
  if (
    (!rect || (rect.left === 0 && rect.top === 0)) &&
    start.getBoundingClientRect
  ) {
    rect = start.getBoundingClientRect();
  }
  return rect;
}

/** Returns the current "@query" being typed, or null. */
export function mentionQuery(): string | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.isCollapsed) return null;
  const node = s.anchorNode;
  if (!node || node.nodeType !== 3) return null;
  const before = (node.textContent || "").slice(0, s.anchorOffset);
  const m = before.match(/(?:^|\s)@(\w{0,20})$/);
  return m ? m[1] : null;
}

export function insertMentionChip(
  _el: HTMLElement,
  item: MentionItem,
  queryLen: number,
): void {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return;
  const range = s.getRangeAt(0);
  // delete '@' + query
  range.setStart(
    range.startContainer,
    Math.max(0, range.startOffset - queryLen - 1),
  );
  range.deleteContents();
  const span = document.createElement("span");
  span.contentEditable = "false";
  if (item.kind === "person") {
    // DOM APIs only — label/color come from vault person pages and must not
    // go through innerHTML (S2 XSS if a title embeds markup).
    span.className = "mention";
    const pico = document.createElement("span");
    pico.className = "pico";
    const safeColor = safeCssColor(item.color);
    if (safeColor) pico.style.background = safeColor;
    const initial = (item.initials?.[0] ?? "").slice(0, 1);
    pico.textContent = initial;
    span.appendChild(pico);
    span.appendChild(document.createTextNode(item.label));
  } else if (item.kind === "page") {
    span.className = "mention page";
    span.textContent = `${item.emoji ?? ""} ${item.label}`.trim();
  } else {
    span.className = "mention date";
    span.textContent = "📅 " + item.label.replace(/\s*\(.*\)/, "");
  }
  range.insertNode(span);
  const space = document.createTextNode(" ");
  span.after(space);
  const nr = document.createRange();
  nr.setStartAfter(space);
  nr.collapse(true);
  s.removeAllRanges();
  s.addRange(nr);
}

export function placeCaretEnd(el: HTMLElement): void {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  if (!s) return;
  s.removeAllRanges();
  s.addRange(r);
}

function fragmentContent(fragment: DocumentFragment): {
  html: string;
  text: string;
} {
  const host = document.createElement("div");
  host.appendChild(fragment);
  return { html: host.innerHTML, text: host.textContent || "" };
}

export function editableSelectionFragments(
  el: HTMLElement,
): EditableSelectionFragments {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return {
      before: { html: el.innerHTML, text: el.textContent || "" },
      after: { html: "", text: "" },
    };
  }
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
    return {
      before: { html: el.innerHTML, text: el.textContent || "" },
      after: { html: "", text: "" },
    };
  }
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  return {
    before: fragmentContent(before.cloneContents()),
    after: fragmentContent(after.cloneContents()),
  };
}

export function isCaretAtStart(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  return (before.cloneContents().textContent || "").length === 0;
}

export function isCaretAtEnd(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(range.startContainer, range.startOffset);
  return (after.cloneContents().textContent || "").length === 0;
}

export function placeCaretAtTextOffset(
  el: HTMLElement,
  requestedOffset: number,
): void {
  const selection = window.getSelection();
  if (!selection) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, requestedOffset);
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }
  placeCaretEnd(el);
}
