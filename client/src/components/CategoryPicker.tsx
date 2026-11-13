import { useMemo, useState } from "react";
import { useData } from "../lib/store";
import { catLabel, categoryGroups } from "../lib/money";
import type { Category } from "../lib/types";
import { Sheet } from "./ui";

/**
 * Category chooser: a field-like button that opens a sheet with the category tree.
 * Groups with sub-categories are collapsed behind an arrow and only their sub-categories can be picked.
 * A parent that already holds the current value stays selectable, so older records can still be edited.
 */
export function CategoryPicker({
  kind,
  value,
  onChange,
  allowNone = true,
  noneLabel = "No category",
}: {
  kind: "income" | "expense";
  /** Category id as a string, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const { state } = useData();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const keepId = value ? Number(value) : undefined;
  const groups = useMemo(() => categoryGroups(state.categories, kind, keepId), [state.categories, kind, keepId]);
  const current = state.categories.find((c) => String(c.id) === value);
  const groupOfCurrent = current ? (current.parent_id ?? (groups.some((g) => g.parent.id === current.id && g.children.length > 0) ? current.id : null)) : null;

  function show() {
    setExpanded(new Set(groupOfCurrent ? [groupOfCurrent] : []));
    setOpen(true);
  }
  function toggle(id: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function pick(id: number | null) {
    onChange(id === null ? "" : String(id));
    setOpen(false);
  }

  const label = current ? `${current.icon ? `${current.icon} ` : ""}${catLabel(state.categories, current)}` : noneLabel;

  const leaf = (c: Category, sub = false, name = c.name) => {
    const selected = String(c.id) === value;
    return (
      <button type="button" key={c.id} className={`row-item ${selected ? "selected" : ""}`} onClick={() => pick(c.id)} aria-pressed={selected}>
        <div className="ic">{c.icon}</div>
        <div className="body">
          <div className={sub ? "t sub" : "t"}>{name}</div>
        </div>
        {selected && <span className="tick">✓</span>}
      </button>
    );
  };

  return (
    <>
      <button type="button" className={`pick ${current ? "" : "muted"}`} onClick={show}>
        <span className="pick-label">{label}</span>
        <span className="pick-arrow" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <Sheet title={kind === "income" ? "Income category" : "Spending category"} onClose={() => setOpen(false)}>
          <div className="list cat-list">
            {allowNone && (
              <button type="button" className={`row-item ${!value ? "selected" : ""}`} onClick={() => pick(null)}>
                <div className="ic">–</div>
                <div className="body">
                  <div className="t">{noneLabel}</div>
                </div>
                {!value && <span className="tick">✓</span>}
              </button>
            )}
            {groups.map(({ parent, children }) => {
              if (children.length === 0) return leaf(parent);
              const isOpen = expanded.has(parent.id);
              const holdsCurrent = String(parent.id) === value;
              return (
                <div key={parent.id} className={`cat-group ${isOpen ? "open" : ""}`}>
                  <button type="button" className="row-item" onClick={() => toggle(parent.id)} aria-expanded={isOpen}>
                    <div className="ic">{parent.icon}</div>
                    <div className="body">
                      <div className="t">{parent.name}</div>
                      {!isOpen && <div className="s">{children.map((c) => c.name).join(" · ")}</div>}
                    </div>
                    <span className={`chev ${isOpen ? "open" : ""}`} aria-hidden>
                      ›
                    </span>
                  </button>
                  {isOpen && (
                    <div className="cat-children">
                      {holdsCurrent && leaf(parent, true, `${parent.name} (general)`)}
                      {children.map((c) => leaf(c, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Sheet>
      )}
    </>
  );
}
