// Breadcrumbs.tsx — clickable page-path trail. Ported from app.jsx crumb block.
import { Fragment, useMemo } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { computePathIds } from "../store/selectors";

export function Breadcrumbs() {
  const tree = useStore((s) => s.tree);
  const page = useStore((s) => s.page);
  const meta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);
  const pathIds = useMemo(() => computePathIds(tree, page), [tree, page]);
  const ancestorIds = pathIds.slice(0, -1);

  return (
    <div className="crumb" aria-label="Parent pages">
      {ancestorIds.map((id, i) => {
        const m = meta[id] || { icon: "📄", title: "Untitled" };
        return (
          <Fragment key={id}>
            {i > 0 && (
              <span className="sep">
                <Icon name="chevR" size={14} />
              </span>
            )}
            <button
              type="button"
              className="seg"
              onClick={() => selectPage(id)}
            >
              {m.icon} {m.title}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
