import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useData } from "../lib/store";
import { formatDate, monthKey, monthLabel, shiftMonth } from "../lib/money";
import type { Transaction, TxType } from "../lib/types";
import { TransactionForm } from "../components/TransactionForm";
import { Empty, Money } from "../components/ui";

export function TxRow({ t, onClick }: { t: Transaction; onClick: () => void }) {
  const { state, locale } = useData();
  const acc = state.accounts.find((a) => a.id === t.account_id);
  const to = t.to_account_id ? state.accounts.find((a) => a.id === t.to_account_id) : undefined;
  const cat = t.category_id ? state.categories.find((c) => c.id === t.category_id) : undefined;
  const person = t.person_id ? state.people.find((p) => p.id === t.person_id) : undefined;
  const project = t.project_id ? state.projects.find((p) => p.id === t.project_id) : undefined;
  const icon = t.type === "transfer" ? "🔁" : (cat?.icon ?? (t.type === "income" ? "➕" : "➖"));
  const title = t.type === "transfer" ? `${acc?.name ?? "?"} → ${to?.name ?? "?"}` : (t.note || cat?.name || person?.name || (t.type === "income" ? "Income" : "Expense"));
  const parts = [formatDate(t.date, locale)];
  if (t.type !== "transfer") {
    if (t.note && cat) parts.push(cat.name);
    if (person) parts.push(person.name);
    if (acc) parts.push(acc.name);
    if (project) parts.push(`📁 ${project.name}`);
  } else if (t.note) parts.push(t.note);
  return (
    <button className="row-item" onClick={onClick}>
      <div className="ic">{icon}</div>
      <div className="body">
        <div className="t">{title}</div>
        <div className="s">{parts.join(" · ")}</div>
      </div>
      <div className="amt">
        {t.type === "transfer" ? <Money value={t.amount} className="muted" /> : <Money value={t.type === "income" ? t.amount : -t.amount} signed />}
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
      if (categoryId && String(t.category_id) !== categoryId) return false;
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
      if (t.type === "income") inc += t.amount;
      else if (t.type === "expense") exp += t.amount;
    }
    return { inc, exp };
  }, [list]);

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of list) {
      const arr = m.get(t.date) ?? [];
      arr.push(t);
      m.set(t.date, arr);
    }
    return [...m.entries()];
  }, [list]);

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
          <h1>Transactions</h1>
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
                  {state.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
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
          groups.map(([date, items]) => (
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
          ))
        )}
      </div>
      {adding && <TransactionForm onClose={() => setAdding(false)} />}
      {editing && <TransactionForm existing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
