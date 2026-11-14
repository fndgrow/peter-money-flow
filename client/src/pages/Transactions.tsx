import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "../lib/store";
import { catLabel, categoryGroups, formatDate, monthKey, monthLabel, shiftMonth, txInMain } from "../lib/money";
import type { Transaction, TxType } from "../lib/types";
import { TransactionForm } from "../components/TransactionForm";
import { Empty, Money } from "../components/ui";

export function TxRow({ t, onClick }: { t: Transaction; onClick: () => void }) {
  const { state, locale, fmtIn, currency } = useData();
  const acc = state.accounts.find((a) => a.id === t.account_id);
  const to = t.to_account_id ? state.accounts.find((a) => a.id === t.to_account_id) : undefined;
  const cat = t.category_id ? state.categories.find((c) => c.id === t.category_id) : undefined;
  const person = t.person_id ? state.people.find((p) => p.id === t.person_id) : undefined;
  const project = t.project_id ? state.projects.find((p) => p.id === t.project_id) : undefined;
  const icon = t.type === "transfer" ? "🔁" : (cat?.icon ?? (t.type === "income" ? "➕" : "➖"));
  const catName = catLabel(state.categories, cat);
  const title = t.type === "transfer" ? `${acc?.name ?? "?"} → ${to?.name ?? "?"}` : (t.note || catName || person?.name || (t.type === "income" ? "Income" : "Expense"));
  const parts = [formatDate(t.date, locale)];
  if (t.type !== "transfer") {
    if (t.note && cat) parts.push(catName);
    if (person) parts.push(person.name);
    if (acc) parts.push(acc.name);
    if (project) parts.push(`🏢 ${project.name}`);
  } else if (t.note) parts.push(t.note);
  return (
    <button className="row-item" onClick={onClick}>
      <div className="ic">{icon}</div>
      <div className="body">
        <div className="t">{title}</div>
        <div className="s">{parts.join(" · ")}</div>
      </div>
      <div className="amt">
        {t.type === "transfer" ? (
          t.to_amount !== null && to && to.currency !== acc?.currency ? (
            <>
              <span className="muted">{fmtIn(acc?.currency || currency)(t.amount)}</span>
              <span className="sub">→ {fmtIn(to.currency)(t.to_amount)}</span>
            </>
          ) : (
            <Money value={t.amount} currency={acc?.currency} className="muted" />
          )
        ) : (
          <Money value={t.type === "income" ? t.amount : -t.amount} currency={acc?.currency} signed />
        )}
      </div>
    </button>
  );
}

type Filter = "all" | TxType;

export function Transactions() {
  const { state, fmt, locale } = useData();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState<string>(params.get("month") || monthKey());
  const [allTime, setAllTime] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [accountId, setAccountId] = useState(params.get("account") || "");
  const [categoryId, setCategoryId] = useState(params.get("category") || "");
  const [personId, setPersonId] = useState(params.get("person") || "");
  const [projectId, setProjectId] = useState(params.get("project") || "");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showFilters, setShowFilters] = useState(!!(accountId || categoryId || personId || projectId));

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.transactions.filter((t) => {
      if (!allTime && !t.date.startsWith(month)) return false;
      if (filter !== "all" && t.type !== filter) return false;
      if (accountId && String(t.account_id) !== accountId && String(t.to_account_id) !== accountId) return false;
      if (categoryId) {
        // A parent category also matches its sub-categories.
        const tc = state.categories.find((c) => c.id === t.category_id);
        if (String(t.category_id) !== categoryId && String(tc?.parent_id ?? "") !== categoryId) return false;
      }
      if (personId && String(t.person_id) !== personId) return false;
      if (projectId && String(t.project_id) !== projectId) return false;
      if (needle) {
        const cat = state.categories.find((c) => c.id === t.category_id)?.name ?? "";
        const person = state.people.find((p) => p.id === t.person_id)?.name ?? "";
        const hay = `${t.note ?? ""} ${cat} ${person} ${t.amount}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [state, month, allTime, filter, accountId, categoryId, personId, projectId, q]);

  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    for (const t of list) {
      if (t.type === "income") inc += txInMain(state, t);
      else if (t.type === "expense") exp += txInMain(state, t);
    }
    return { inc, exp };
  }, [list, state]);

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of list) {
      const arr = m.get(t.date) ?? [];
      arr.push(t);
      m.set(t.date, arr);
    }
    return [...m.entries()];
  }, [list]);

  // Long lists (all time, broad filters) are rendered in pages so the phone does not lay out 1,000 rows at once.
  const PAGE = 80;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [list]);
  const shown = useMemo(() => {
    let n = 0;
    const out: [string, Transaction[]][] = [];
    for (const [date, items] of groups) {
      if (n >= limit) break;
      const take = items.slice(0, limit - n);
      out.push([date, take]);
      n += take.length;
    }
    return out;
  }, [groups, limit]);
  const hidden = list.length - Math.min(list.length, limit);

  function clearFilters() {
    setAccountId("");
    setCategoryId("");
    setPersonId("");
    setProjectId("");
    setQ("");
    setParams({});
  }
  const hasFilters = !!(accountId || categoryId || personId || projectId || q);

  return (
    <>
      <div className="main">
        <div className="between mb">
          <div>
            <h1>Transactions</h1>
            <Link to="/" className="small">
              ‹ Back to home
            </Link>
          </div>
          <button className="btn primary sm" onClick={() => setAdding(true)}>
            + Add
          </button>
        </div>

        <div className="month-nav">
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))} disabled={allTime}>
            ‹
          </button>
          <button className="btn ghost sm" onClick={() => setAllTime((v) => !v)}>
            {allTime ? "All time" : monthLabel(month, locale)}
          </button>
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={allTime}>
            ›
          </button>
        </div>

        <div className="chips mb">
          {(["all", "expense", "income", "transfer"] as Filter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button className={`chip ${showFilters ? "active" : ""}`} onClick={() => setShowFilters((v) => !v)}>
            Filter{hasFilters ? " •" : ""}
          </button>
        </div>

        {showFilters && (
          <div className="card flat">
            <div className="field">
              <input type="search" placeholder="Search notes, categories, people…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Account</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Any</option>
                  {state.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Any</option>
                  {(["expense", "income"] as const).flatMap((k) =>
                    categoryGroups(state.categories, k, -1).flatMap(({ parent, children }) => [
                      <option key={parent.id} value={parent.id}>
                        {parent.icon} {parent.name}
                      </option>,
                      ...children.map((c) => (
                        <option key={c.id} value={c.id}>
                          {"  "}› {c.icon} {c.name}
                        </option>
                      )),
                    ]),
                  )}
                </select>
              </div>
              <div className="field">
                <label>Person</label>
                <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                  <option value="">Any</option>
                  {state.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Project</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Any</option>
                  {state.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {hasFilters && (
              <button className="btn sm" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="k">In</div>
            <div className="v income">{fmt(totals.inc)}</div>
          </div>
          <div className="stat">
            <div className="k">Out</div>
            <div className="v expense">{fmt(totals.exp)}</div>
          </div>
          <div className="stat">
            <div className="k">Net</div>
            <div className={`v ${totals.inc - totals.exp < 0 ? "expense" : ""}`}>{fmt(totals.inc - totals.exp)}</div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="card">
            <Empty>No transactions match.</Empty>
          </div>
        ) : (
          <>
            {shown.map(([date, items]) => (
              <div className="card" key={date}>
                <div className="tiny muted bold mb" style={{ textTransform: "uppercase" }}>
                  {formatDate(date, locale, { weekday: "short", day: "numeric", month: "long" })}
                </div>
                <div className="list">
                  {items.map((t) => (
                    <TxRow key={t.id} t={t} onClick={() => setEditing(t)} />
                  ))}
                </div>
              </div>
            ))}
            {hidden > 0 && (
              <button className="btn block mb" onClick={() => setLimit((l) => l + PAGE * 2)}>
                Show more ({hidden} more)
              </button>
            )}
          </>
        )}
      </div>
      {adding && <TransactionForm onClose={() => setAdding(false)} />}
      {editing && <TransactionForm existing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
