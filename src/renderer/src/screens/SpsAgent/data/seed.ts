// seed.ts — sample workspace content + initial-workspace builder.
// Ported from data.jsx and the seeding half of store.jsx.
import { blk } from "../lib/ids";
import type {
  Block,
  Comment,
  Person,
  PersonKey,
  PrioDef,
  PrioKey,
  SeedTreeNode,
  StatusDef,
  StatusKey,
  Task,
  TreeNode,
  Workspace,
  PageMeta,
} from "../types";

// ---- the Home document ----
export const HOME_BLOCKS: Block[] = [blk("p", "")];

// ---- people / status / priority reference tables ----
// Single-user app: the only built-in person is "you". PersonKey is a free string,
// so additional people can still be added via @mentions / assignee pickers.
export const PEOPLE: Record<PersonKey, Person> = {
  you: { name: "You", initials: "Y", color: "#1B4F8A" },
};

export const STATUS: Record<StatusKey, StatusDef> = {
  todo: { label: "To do", cls: "s-todo", dot: "#8a8d93" },
  doing: { label: "In progress", cls: "s-doing", dot: "#C79400" },
  review: { label: "In review", cls: "s-review", dot: "#1B4F8A" },
  done: { label: "Done", cls: "s-done", dot: "#1F6B3A" },
  inbox: { label: "Brain Dump", cls: "s-inbox", dot: "#8a8d93" },
  this_week: { label: "This Week", cls: "s-this-week", dot: "#3A86C8" },
  blocked: { label: "Waiting / Blocked", cls: "s-blocked", dot: "#E05A47" },
};

export const PRIO: Record<PrioKey, PrioDef> = {
  high: { label: "High", cls: "p-high" },
  med: { label: "Medium", cls: "p-med" },
  low: { label: "Low", cls: "p-low" },
};

// Fresh task databases start empty.
export const TASKS: Task[] = [];

// ---- sidebar page tree seed ----
export const TREE: SeedTreeNode[] = [
  { id: "home", emoji: "🏠", label: "Home" },
];

// ---- initial blank workspace ----
function treeFromSeed(nodes: SeedTreeNode[]): TreeNode[] {
  return nodes.map((n) => ({
    id: n.id,
    children: n.children ? treeFromSeed(n.children) : [],
  }));
}

function metaFromSeed(
  nodes: SeedTreeNode[],
  acc: Record<string, PageMeta>,
): Record<string, PageMeta> {
  nodes.forEach((n) => {
    acc[n.id] = { icon: n.emoji, title: n.label, cover: null };
    if (n.children) metaFromSeed(n.children, acc);
  });
  return acc;
}

export function buildInitialWorkspace(): Workspace {
  const tree = treeFromSeed(TREE);
  const meta = metaFromSeed(TREE, {});
  meta.home = { icon: "🏠", title: "Home", cover: null };
  const docs: Record<string, Block[]> = { home: HOME_BLOCKS };
  // A genuinely fresh workspace contains no sample projects, tasks, or notes.
  const comments: Comment[] = [];
  return { tree, meta, docs, comments, trash: [], page: "home" };
}
