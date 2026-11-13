import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/store";
import { categoryTotals, monthKey, monthLabel, monthSummary, projectTotals, shiftMonth, txInMain } from "../lib/money";
import { Empty } from "../components/ui";

export function Reports() {
  const { state, fmt, locale } = useData();
  const [month, setMonth] = useState(monthKey());
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const cur = monthKey();

  const summary = useMemo(() => monthSummary(state, month), [state, month]);
  const prev = useMemo(() => monthSummary(state, shiftMonth(month, -1)), [state, month]);

  const byCat = useMemo(() => {
    const totals = categoryTotals(state, month, kind);
    // Roll sub-categories up into their parent, keeping the detail for the sub-line.
    const byParent = new Map<number | null, { amount: number; children: Map<number, number> }>();
    for (const [id, amount] of totals) {
      const c = id ? state.categories.find((x) => x.id === id) : undefined;
      const pid = c?.parent_id ?? id;
      const e = byParent.get(pid) ?? { amount: 0, children: new Map<number, number>() };
      e.amount += amount;
      if (c?.parent_id && id) e.children.set(id, (e.children.get(id) ?? 0) + amount);
      byParent.set(pid, e);
    }
    const rows = [...byParent.entries()].map(([id, e]) => {
      const c = id ? state.categories.find((x) => x.id === id) : undefined;
      const detail = [...e.children.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cid, amt]) => ({ id: cid, name: state.categories.find((x) => x.id === cid)?.name ?? "", icon: state.categories.find((x) => x.id === cid)?.icon ?? "", amount: amt }));
      return { id, name: c?.name ?? "Uncategorised", icon: c?.icon ?? "📦", amount: e.amount, detail };
    });
    rows.sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { rows, total, max: rows[0]?.amount ?? 0 };
  }, [state, month, kind]);

  const byPerson = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of state.transactions) {
      if (t.type !== "expense" || !t.date.startsWith(month) || t.person_id === null) continue;
      m.set(t.person_id, (m.get(t.person_id) ?? 0) + txInMain(state, t));
    }
    return [...m.entries()]
      .map(([id, amount]) => ({ id, name: state.people.find((p) => p.id === id)?.name ?? "?", amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [state, month]);

  const months = useMemo(() => {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const key = shiftMonth(cur, -i);
      out.push(monthSummary(state, key));
    }
    return out.filter((m, i, arr) => m.income || m.expense || i === arr.length - 1);
  }, [state, cur]);
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));

  const projects = state.projects.map((p) => ({ ...p, ...projectTotals(state, p.id) }));

  const delta = (a: number, b: number) => {
    if (!b) return null;
    const pct = Math.round(((a - b) / b) * 100);
    return pct;
  };

  return (
    <div className="main">
      <div className="between mb">
        <div>
          <h1>Reports</h1>
          <Link to="/dashboard" className="small">
            ‹ Back to dashboard
          </Link>
        </div>
        <a className="btn sm" href="/api/export.xlsx" download>
          ⬇ Excel
        </a>
      </div>

      <div className="month-nav">
        <button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <h2>{monthLabel(month, locale)}</h2>
        <button className="btn sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= cur}>
          ›
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Income</div>
          <div className="v income">{fmt(summary.income)}</div>
          <Delta pct={delta(summary.income, prev.income)} />
        </div>
        <div className="stat">
          <div className="k">Spending</div>
          <div className="v expense">{fmt(summary.expense)}</div>
          <Delta pct={delta(summary.expense, prev.expense)} invert />
        </div>
        <div className="stat">
          <div className="k">Kept</div>
          <div className={`v ${summary.kept < 0 ? "expense" : ""}`}>{fmt(summary.kept)}</div>
          <div className="tiny muted">{summary.income > 0 ? `${Math.round((summary.kept / summary.income) * 100)}% of income` : ""}</div>
        </div>
      </div>
      {summary.toSavings > 0 && <div className="banner accent">You moved {fmt(summary.toSavings)} into savings this month.</div>}

      <div className="card">
        <div className="card-title">
          <h2>Where it went</h2>
          <div className="seg" style={{ width: 170 }}>
            <button className={kind === "expense" ? "active out" : ""} onClick={() => setKind("expense")}>
              Spending
            </button>
            <button className={kind === "income" ? "active in" : ""} onClick={() => setKind("income")}>
              Income
            </button>
          </div>
        </div>
        {byCat.rows.length === 0 ? (
          <Empty>Nothing recorded this month.</Empty>
        ) : (
          byCat.rows.map((r) => (
            <Link key={String(r.id)} to={`/transactions?month=${month}${r.id ? `&category=${r.id}` : ""}`} className={`bar-row ${kind === "income" ? "in" : ""}`} style={{ color: "inherit" }}>
              <div className="small">
                {r.icon} {r.name} <span className="muted tiny">{byCat.total ? Math.round((r.amount / byCat.total) * 100) : 0}%</span>
              </div>
              <div className="small bold">{fmt(r.amount)}</div>
              <div className="bar">
                <div style={{ width: `${byCat.max ? (r.amount / byCat.max) * 100 : 0}%` }} />
              </div>
              {r.detail.length > 0 && (
                <div className="tiny muted" style={{ gridColumn: "1 / -1" }}>
                  {r.detail.map((d) => `${d.icon} ${d.name} ${fmt(d.amount)}`).join(" · ")}
                </div>
              )}
            </Link>
          ))
        )}
      </div>

      {byPerson.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Paid to people</h2>
          </div>
          {byPerson.map((r) => (
            <Link key={r.id} to={`/transactions?month=${month}&person=${r.id}`} className="bar-row" style={{ color: "inherit" }}>
              <div className="small">👤 {r.name}</div>
              <div className="small bold">{fmt(r.amount)}</div>
              <div className="bar">
                <div style={{ width: `${(r.amount / byPerson[0].amount) * 100}%`, background: "var(--accent)" }} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <h2>Month by month</h2>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, padding: "0 2px" }}>
          {months.map((m) => (
            <button
              key={m.month}
              onClick={() => setMonth(m.month)}
              title={`${monthLabel(m.month, locale)}: in ${fmt(m.income)}, out ${fmt(m.expense)}`}
              style={{ flex: 1, display: "flex", gap: 2, alignItems: "flex-end", height: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", opacity: m.month === month ? 1 : 0.55 }}
            >
              <div style={{ flex: 1, height: `${(m.income / maxBar) * 100}%`, background: "var(--income)", borderRadius: 3, minHeight: 2 }} />
              <div style={{ flex: 1, height: `${(m.expense / maxBar) * 100}%`, background: "var(--expense)", borderRadius: 3, minHeight: 2 }} />
            </button>
          ))}
        </div>
        <table className="tbl mt">
          <thead>
            <tr>
              <th>Month</th>
              <th>In</th>
              <th>Out</th>
              <th>Kept</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month} className={m.month === month ? "cur" : ""} onClick={() => setMonth(m.month)} style={{ cursor: "pointer" }}>
                <td>{monthLabel(m.month, locale).replace(/(\w+) (\d{4})/, (_, mo: string, y: string) => `${mo.slice(0, 3)} ${y.slice(2)}`)}</td>
                <td className="income">{fmt(m.income)}</td>
                <td className="expense">{fmt(m.expense)}</td>
                <td className={m.kept < 0 ? "expense" : ""}>{fmt(m.kept)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {projects.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Project profit</h2>
            <Link to="/settings" className="link">
              Manage
            </Link>
          </div>
          <div className="list">
            {projects.map((p) => (
              <Link key={p.id} to={`/transactions?project=${p.id}`} className="row-item" style={{ color: "inherit" }}>
                <div className="ic">📁</div>
                <div className="body">
                  <div className="t">
                    {p.name} {p.status === "done" && <span className="pill">done</span>}
                  </div>
                  <div className="s">
                    In {fmt(p.income)} · costs {fmt(p.cost)}
                  </div>
                </div>
                <div className={`amt ${p.profit < 0 ? "expense" : "income"}`}>
                  {fmt(p.profit)}
                  <span className="sub">profit</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Delta({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return <div className="tiny muted">vs last month: —</div>;
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <div className={`tiny ${good ? "income" : "expense"}`}>
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} {Math.abs(pct)}% vs last month
    </div>
  );
}
