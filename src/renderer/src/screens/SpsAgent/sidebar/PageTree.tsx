import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PageMeta, TreeNode as TreeNodeT } from "../types";
import type { TreeDnd } from "./dnd";
import { TreeNode } from "./TreeNode";

const VIRTUALIZE_AT = 80;
const MAX_TREE_HEIGHT = 360;

interface PageTreeProps {
  nodes: TreeNodeT[];
  meta: Record<string, PageMeta>;
  activeId: string;
  onSelect: (id: string) => void;
  onNewSubPage: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  dnd: TreeDnd;
}

interface VisibleTreeRow {
  node: TreeNodeT;
  depth: number;
}

export function countTreeNodes(nodes: TreeNodeT[]): number {
  let count = 0;
  const visit = (items: TreeNodeT[]): void => {
    for (const node of items) {
      count += 1;
      visit(node.children);
    }
  };
  visit(nodes);
  return count;
}

export function flattenVisibleTree(
  nodes: TreeNodeT[],
  expanded: ReadonlySet<string>,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  const visit = (items: TreeNodeT[], depth: number): void => {
    for (const node of items) {
      rows.push({ node, depth });
      if (node.children.length > 0 && expanded.has(node.id)) {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return rows;
}

function VirtualizedPageTree(props: PageTreeProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(props.nodes.map((node) => node.id)),
  );

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      for (const node of props.nodes) {
        if (!next.has(node.id)) {
          next.add(node.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.nodes]);

  const rows = useMemo(
    () => flattenVisibleTree(props.nodes, expanded),
    [expanded, props.nodes],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
    getItemKey: (index) => rows[index]?.node.id ?? index,
  });
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="page-tree-virtual scroll"
      style={{ height: Math.min(Math.max(totalSize, 28), MAX_TREE_HEIGHT) }}
      role="tree"
      aria-label="Workspace pages"
    >
      <div className="page-tree-virtual-inner" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const open = expanded.has(row.node.id);
          return (
            <div
              key={row.node.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="page-tree-virtual-row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <TreeNode
                {...props}
                node={row.node}
                depth={row.depth}
                open={open}
                flat
                renderChildren={false}
                onOpenChange={(nextOpen) => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (nextOpen) next.add(row.node.id);
                    else next.delete(row.node.id);
                    return next;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PageTree(props: PageTreeProps): React.JSX.Element {
  if (countTreeNodes(props.nodes) >= VIRTUALIZE_AT) {
    return <VirtualizedPageTree {...props} />;
  }
  return (
    <>
      {props.nodes.map((node) => (
        <TreeNode key={node.id} {...props} node={node} depth={0} />
      ))}
    </>
  );
}
