import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/store";
import { addDays, daysBetween, formatDate, makeConv, monthEnd, monthKey, monthLabel, shiftMonth, todayStr } from "../lib/money";
import type { Category, Transaction } from "../lib/types";
import { Bars, Donut, Legend, Line, OTHER_COLOR, SERIES, type Slice } from "../components/charts";
import { Empty } from "../components/ui";

type PeriodKey = "month" | "last" | "3m" | "6m" | "year" | "all";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

function periodRange(key: PeriodKey, today: string, firstDate: string): { from: string; to: string } {
  const m = monthKey(today);
  switch (key) {
    case "month":
      return { from: `${m}-01`, to: today };
    case "last": {
      const lm = shiftMonth(m, -1);
      return { from: `${lm}-01`, to: monthEnd(lm) };
    }
    case "3m":
      return { from: `${shiftMonth(m, -2)}-01`, to: today };
    case "6m":
      return { from: `${shiftMonth(m, -5)}-01`, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: firstDate < today ? firstDate : today, to: today };
  }
}

export function Dashboard() {
  const { state, fmt, fmt2, currency, locale } = useData();
  const today = todayStr();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [view, setView] = useState<"overview" | "spending" | "income">("overview");
  const [showTable, setShowTable] = useState(false);
  const [showIncomeTable, setShowIncomeTable] = useState(false);
  const c = useMemo(() => makeConv(state.settings), [state.settings]);
  const accCur = useMemo(() => new Map(state.accounts.map((a) => [a.id, a.currency || c.main])), [state.accounts, c.main]);
  const inMain = (t: Transaction) => c.conv(t.amount, accCur.get(t.account_id) ?? c.main, c.main);
  const firstDate = state.transactions.length ? state.transactions[state.transactions.length - 1].date : today;
  const range = periodRange(period, today, firstDate);
  const prevLen = daysBetween(range.from, range.to) + 1;
  const prevRange = { from: addDays(range.from, -prevLen), to: addDays(range.from, -1) };

  const inRange = (t: Transaction, r: { from: string; to: string }) => t.date >= r.from && t.date <= r.to;
  const sum = (r: { from: string; to: string }, type: "income" | "expense") =>
    state.transactions.filter((t) => t.type === type && inRange(t, r)).reduce((s, t) => s + inMain(t), 0);

  const income = sum(range, "income");
  const expense = sum(range, "expense");
  const prevIncome = sum(prevRange, "income");
  const prevExpense = sum(prevRange, "expense");
  const kept = income - expense;
  const days = Math.max(1, daysBetween(range.from, range.to) + 1);
  const perDay = expense / days;
  const rate = income > 0 ? Math.round((kept / income) * 100) : null;

  // Stable colour per top-level expense category: ranked by all-time spending, first 7 get a slot, rest fold into Other.
  const topLevel = (cat: Category | undefined) => (cat?.parent_id ? state.categories.find((p) => p.id === cat.parent_id) : cat);
  const colorMap = useMemo(() => {
    const allTime = new Map<number, number>();
    for (const t of state.transactions) {
      if (t.type !== "expense") continue;
      const top = topLevel(state.categories.find((x) => x.id === t.category_id));
      if (!top) continue;
      allTime.set(top.id, (allTime.get(top.id) ?? 0) + inMain(t));
    }
    const ranked = [...allTime.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const m = new Map<number, string>();
    ranked.slice(0, 7).forEach((id, i) => m.set(id, SERIES[i]));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Spending by top-level category in the period (+ previous period for deltas).
  const byCat = useMemo(() => {
    const cur = new Map<number | null, number>();
    const prev = new Map<number | null, number>();
    for (const t of state.transactions) {
      if (t.type !== "expense") continue;
      const top = topLevel(state.categories.find((x) => x.id === t.category_id));
      const id = top?.id ?? null;
      if (inRange(t, range)) cur.set(id, (cur.get(id) ?? 0) + inMain(t));
      else if (inRange(t, prevRange)) prev.set(id, (prev.get(id) ?? 0) + inMain(t));
    }
    const rows = [...cur.entries()]
      .map(([id, amount]) => {
        const cat = id ? state.categories.find((x) => x.id === id) : undefined;
        return { id, name: cat?.name ?? "Uncategorised", icon: cat?.icon ?? "📦", amount, prev: prev.get(id) ?? 0, color: id ? (colorMap.get(id) ?? OTHER_COLOR) : OTHER_COLOR };
      })
      .sort((a, b) => b.amount - a.amount);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to, colorMap]);

  const slices: Slice[] = useMemo(() => {
    const named = byCat.filter((r) => r.color !== OTHER_COLOR);
    const other = byCat.filter((r) => r.color === OTHER_COLOR).reduce((s, r) => s + r.amount, 0);
    const out: Slice[] = named.map((r) => ({ key: String(r.id), label: `${r.icon} ${r.name}`, value: r.amount, color: r.color }));
    if (other > 0) out.push({ key: "other", label: "Other", value: other, color: OTHER_COLOR });
    return out;
  }, [byCat]);

  // Income by category in the period.
  const incomeByCat = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const t of state.transactions) {
      if (t.type !== "income" || !inRange(t, range)) continue;
      m.set(t.category_id, (m.get(t.category_id) ?? 0) + inMain(t));
    }
    return [...m.entries()]
      .map(([id, amount]) => {
        const cat = id ? state.categories.find((x) => x.id === id) : undefined;
        return { id, name: cat?.name ?? "Other", icon: cat?.icon ?? "➕", amount };
      })
      .sort((a, b) => b.amount - a.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to]);

  // Monthly income vs spending for the last 12 months (or all months in range when longer).
  const months = useMemo(() => {
    const cur = monthKey(today);
    const count = period === "all" ? Math.max(12, (daysBetween(firstDate, today) / 30) | 0) : period === "year" ? 12 : 12;
    const keys: string[] = [];
    for (let i = count - 1; i >= 0; i--) keys.push(shiftMonth(cur, -i));
    const rows = keys.map((k) => {
      let inc = 0, exp = 0;
      for (const t of state.transactions) {
        if (!t.date.startsWith(k) || t.type === "transfer") continue;
        if (t.type === "income") inc += inMain(t);
        else exp += inMain(t);
      }
      return { key: k, label: monthLabel(k, locale).slice(0, 3), income: inc, expense: exp };
    });
    const firstNonZero = rows.findIndex((r) => r.income || r.expense);
    return firstNonZero > 0 ? rows.slice(Math.max(0, Math.min(firstNonZero, rows.length - 6))) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, period, locale]);

  // Daily spending in the period (bars), capped to the last 62 days for readability.
  const daily = useMemo(() => {
    const from = daysBetween(range.from, range.to) > 62 ? addDays(range.to, -61) : range.from;
    const m = new Map<string, number>();
    for (let d = from; d <= range.to; d = addDays(d, 1)) m.set(d, 0);
    for (const t of state.transactions) {
      if (t.type !== "expense" || t.date < from || t.date > range.to) continue;
      m.set(t.date, (m.get(t.date) ?? 0) + inMain(t));
    }
    return [...m.entries()].map(([d, v]) => ({ label: formatDate(d, locale, { day: "numeric", month: "short" }), value: v, date: d }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to, locale]);
  const biggestDay = daily.reduce((b, d) => (d.value > b.value ? d : b), { label: "", value: 0, date: "" });

  // Total money at the end of each of the last 12 months.
  const wealth = useMemo(() => {
    const cur = monthKey(today);
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) keys.push(shiftMonth(cur, -i));
    const opening = state.accounts.filter((a) => !a.archived).reduce((s, a) => s + c.conv(a.opening_balance, a.currency || c.main, c.main), 0);
    const active = new Set(state.accounts.filter((a) => !a.archived).map((a) => a.id));
    return keys.map((k) => {
      const end = monthEnd(k);
      let total = opening;
      for (const t of state.transactions) {
        if (t.date > end) continue;
        if (t.type === "income" && active.has(t.account_id)) total += inMain(t);
        else if (t.type === "expense" && active.has(t.account_id)) total -= inMain(t);
        else if (t.type === "transfer") {
          if (active.has(t.account_id)) total -= inMain(t);
          if (t.to_account_id !== null && active.has(t.to_account_id)) total += c.conv(t.to_amount ?? t.amount, accCur.get(t.to_account_id) ?? c.main, c.main);
        }
      }
      return { label: monthLabel(k, locale).slice(0, 3), value: total };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, locale]);

  // Top people paid in the period.
  const people = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of state.transactions) {
      if (t.type !== "expense" || t.person_id === null || !inRange(t, range)) continue;
      m.set(t.person_id, (m.get(t.person_id) ?? 0) + inMain(t));
    }
    return [...m.entries()]
      .map(([id, amount]) => ({ id, name: state.people.find((p) => p.id === id)?.name ?? "?", amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to]);

  // Income by company (project) in the period, biggest payer first; income with no company counted separately.
  const companies = useMemo(() => {
    const m = new Map<number, number>();
    let unassigned = 0;
    for (const t of state.transactions) {
      if (t.type !== "income" || !inRange(t, range)) continue;
      if (t.project_id === null) unassigned += inMain(t);
      else m.set(t.project_id, (m.get(t.project_id) ?? 0) + inMain(t));
    }
    const rows = [...m.entries()]
      .map(([id, amount]) => ({ id, name: state.projects.find((p) => p.id === id)?.name ?? "?", amount }))
      .sort((a, b) => b.amount - a.amount);
    return { rows, unassigned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to]);

  // Income by source as donut slices (fixed colours by all-time rank).
  const incomeColor = useMemo(() => {
    const allTime = new Map<number | null, number>();
    for (const t of state.transactions) if (t.type === "income") allTime.set(t.category_id, (allTime.get(t.category_id) ?? 0) + inMain(t));
    const m = new Map<number | null, string>();
    [...allTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).forEach(([id], i) => m.set(id, SERIES[i]));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const incomeSlices: Slice[] = useMemo(() => {
    const named = incomeByCat.filter((r) => incomeColor.has(r.id));
    const other = incomeByCat.filter((r) => !incomeColor.has(r.id)).reduce((s, r) => s + r.amount, 0);
    const out: Slice[] = named.map((r) => ({ key: String(r.id), label: `${r.icon} ${r.name}`, value: r.amount, color: incomeColor.get(r.id)! }));
    if (other > 0) out.push({ key: "other", label: "Other", value: other, color: OTHER_COLOR });
    return out;
  }, [incomeByCat, incomeColor]);

  // Spending by paying account (cash vs bank) in the period.
  const expenseByAccount = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of state.transactions) if (t.type === "expense" && inRange(t, range)) m.set(t.account_id, (m.get(t.account_id) ?? 0) + inMain(t));
    return [...m.entries()]
      .map(([id, amount]) => {
        const a = state.accounts.find((x) => x.id === id);
        return { id, name: a?.name ?? "?", type: a?.type ?? "bank", amount };
      })
      .sort((a, b) => b.amount - a.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to]);

  // Income by receiving account, and the biggest single entries in the period.
  const incomeByAccount = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of state.transactions) if (t.type === "income" && inRange(t, range)) m.set(t.account_id, (m.get(t.account_id) ?? 0) + inMain(t));
    return [...m.entries()]
      .map(([id, amount]) => ({ id, name: state.accounts.find((a) => a.id === id)?.name ?? "?", amount }))
      .sort((a, b) => b.amount - a.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, range.from, range.to]);
  const biggest = (type: "income" | "expense") =>
    state.transactions
      .filter((t) => t.type === type && inRange(t, range))
      .map((t) => ({ t, v: inMain(t) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
  const topIncomes = useMemo(() => biggest("income"), [state, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const topExpenses = useMemo(() => biggest("expense"), [state, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const txTitle = (t: Transaction) => {
    const cat = state.categories.find((x) => x.id === t.category_id);
    const person = t.person_id ? state.people.find((p) => p.id === t.person_id) : undefined;
    return t.note || (cat ? `${cat.icon ?? ""} ${cat.name}` : "") || person?.name || "—";
  };
  const avgMonthlyIncome = months.length ? months.reduce((s, m) => s + m.income, 0) / Math.max(1, months.filter((m) => m.income > 0).length) : 0;

  const delta = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
  const Delta = ({ now, before, invert }: { now: number; before: number; invert?: boolean }) => {
    const d = delta(now, before);
    if (d === null) return <div className="d muted">no previous period</div>;
    const good = invert ? d <= 0 : d >= 0;
    return (
      <div className={`d ${good ? "income" : "expense"}`}>
        {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)}% vs previous
      </div>
    );
  };

  const hasData = state.transactions.length > 0;
  const rangeLabel = `${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}`;

  return (
    <div className="main">
      <div className="between mb">
        <div>
          <h1>Dashboard</h1>
          <div className="muted small">{rangeLabel}</div>
        </div>
        <Link to="/reports" className="btn sm">
          Details & Excel
        </Link>
      </div>

      <div className="seg mb">
        <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
          Overview
        </button>
        <button className={view === "spending" ? "active out" : ""} onClick={() => setView("spending")}>
          Spending
        </button>
        <button className={view === "income" ? "active in" : ""} onClick={() => setView("income")}>
          Income
        </button>
      </div>

      <div className="chips mb">
        {PERIODS.map((p) => (
          <button key={p.key} className={`chip ${period === p.key ? "active" : ""}`} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {!hasData && (
        <div className="card">
          <Empty>No transactions yet. Add your first income or expense and the dashboard fills in.</Empty>
        </div>
      )}

      {view === "income" && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="k">Income</div>
              <div className="v income">{fmt(income)}</div>
              {fmt2 && <div className="sub2">≈ {fmt2(income)}</div>}
              <Delta now={income} before={prevIncome} />
            </div>
            <div className="kpi">
              <div className="k">Sources</div>
              <div className="v">{incomeByCat.length}</div>
              <div className="d muted">{incomeByCat[0] ? `${incomeByCat[0].icon} ${incomeByCat[0].name} is the biggest` : "none yet"}</div>
            </div>
            <div className="kpi">
              <div className="k">Average month</div>
              <div className="v">{fmt(avgMonthlyIncome)}</div>
              <div className="d muted">over months with income</div>
            </div>
            <div className="kpi">
              <div className="k">Kept of it</div>
              <div className={`v ${kept < 0 ? "expense" : ""}`}>{rate !== null ? `${rate}%` : "—"}</div>
              <div className="d muted">{fmt(kept)} after spending</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Where the money came from</h2>
              <button className="btn ghost sm" onClick={() => setShowIncomeTable((v) => !v)}>
                {showIncomeTable ? "Chart" : "Table"}
              </button>
            </div>
            {incomeByCat.length === 0 ? (
              <Empty>No income in this period.</Empty>
            ) : showIncomeTable ? (
              <table className="viz-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Amount</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeByCat.map((r) => (
                    <tr key={String(r.id)}>
                      <td>
                        {r.icon} {r.name}
                      </td>
                      <td>{fmt(r.amount)}</td>
                      <td>{income ? Math.round((r.amount / income) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="donut-row">
                <Donut
                  slices={incomeSlices}
                  total={income}
                  format={fmt}
                  center={
                    <>
                      <div className="v">{fmt(income)}</div>
                      <div className="k">received</div>
                    </>
                  }
                />
                <Legend items={incomeSlices.map((s) => ({ label: s.label, color: s.color, value: `${income ? Math.round((s.value / income) * 100) : 0}%` }))} />
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Income by company</h2>
            </div>
            {companies.rows.length === 0 ? (
              <Empty>No income is linked to a company in this period.</Empty>
            ) : (
              <div className="rank">
                {companies.rows.map((p) => (
                  <Link key={p.id} to={`/transactions?project=${p.id}`} className="rank-row" style={{ color: "inherit" }}>
                    <span className="n">🏢 {p.name}</span>
                    <span className="amt">
                      {fmt(p.amount)} <span className="muted tiny">{income ? Math.round((p.amount / income) * 100) : 0}%</span>
                    </span>
                    <div className="bar">
                      <div style={{ width: `${(p.amount / companies.rows[0].amount) * 100}%`, background: "var(--income)" }} />
                    </div>
                  </Link>
                ))}
                {companies.unassigned > 0.004 && (
                  <div className="rank-row muted">
                    <span className="n">No company</span>
                    <span className="amt">
                      {fmt(companies.unassigned)} <span className="tiny">{income ? Math.round((companies.unassigned / income) * 100) : 0}%</span>
                    </span>
                    <div className="bar">
                      <div style={{ width: `${(companies.unassigned / companies.rows[0].amount) * 100}%`, background: "var(--line)" }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Income by month</h2>
            </div>
            <Bars groups={months.map((m) => ({ label: m.label, values: [m.income] }))} series={[{ name: "Income", color: "var(--s3)" }]} format={fmt} />
          </div>

          {incomeByAccount.length > 0 && (
            <div className="card">
              <div className="card-title">
                <h2>Received into</h2>
              </div>
              <div className="rank">
                {incomeByAccount.map((r) => (
                  <Link key={r.id} to={`/transactions?account=${r.id}`} className="rank-row" style={{ color: "inherit" }}>
                    <span className="n">🏦 {r.name}</span>
                    <span className="amt">{fmt(r.amount)}</span>
                    <div className="bar">
                      <div style={{ width: `${(r.amount / incomeByAccount[0].amount) * 100}%`, background: "var(--s3)" }} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {topIncomes.length > 0 && (
            <div className="card">
              <div className="card-title">
                <h2>Biggest entries</h2>
              </div>
              <div className="rank">
                {topIncomes.map(({ t, v }) => (
                  <Link key={t.id} to={`/transactions?month=${t.date.slice(0, 7)}`} className="rank-row" style={{ color: "inherit" }}>
                    <span className="n">{txTitle(t)}</span>
                    <span className="amt income">{fmt(v)}</span>
                    <span className="tiny muted" style={{ gridColumn: "2 / 3" }}>
                      {formatDate(t.date, locale, { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {view === "spending" && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="k">Spending</div>
              <div className="v expense">{fmt(expense)}</div>
              {fmt2 && <div className="sub2">≈ {fmt2(expense)}</div>}
              <Delta now={expense} before={prevExpense} invert />
            </div>
            <div className="kpi">
              <div className="k">Per day</div>
              <div className="v">{fmt(perDay)}</div>
              <div className="d muted">~{fmt(perDay * 30)} / month at this pace</div>
            </div>
            <div className="kpi">
              <div className="k">Biggest category</div>
              <div className="v" style={{ fontSize: "1rem" }}>{byCat[0] ? `${byCat[0].icon} ${byCat[0].name}` : "—"}</div>
              <div className="d muted">{byCat[0] ? `${fmt(byCat[0].amount)} · ${expense ? Math.round((byCat[0].amount / expense) * 100) : 0}%` : ""}</div>
            </div>
            <div className="kpi">
              <div className="k">Of income</div>
              <div className={`v ${income > 0 && expense > income ? "expense" : ""}`}>{income > 0 ? `${Math.round((expense / income) * 100)}%` : "—"}</div>
              <div className="d muted">{income > 0 ? (expense > income ? `${fmt(expense - income)} over` : `${fmt(income - expense)} under`) : "no income in period"}</div>
            </div>
          </div>
        </>
      )}

      {view === "overview" && (
      <div className="kpis">
        <div className="kpi">
          <div className="k">Income</div>
          <div className="v income">{fmt(income)}</div>
          {fmt2 && <div className="sub2">≈ {fmt2(income)}</div>}
          <Delta now={income} before={prevIncome} />
        </div>
        <div className="kpi">
          <div className="k">Spending</div>
          <div className="v expense">{fmt(expense)}</div>
          {fmt2 && <div className="sub2">≈ {fmt2(expense)}</div>}
          <Delta now={expense} before={prevExpense} invert />
        </div>
        <div className="kpi">
          <div className="k">Kept</div>
          <div className={`v ${kept < 0 ? "expense" : ""}`}>{fmt(kept)}</div>
          {fmt2 && <div className="sub2">≈ {fmt2(kept)}</div>}
          <div className="d muted">{rate !== null ? `${rate}% of income saved` : "no income yet"}</div>
        </div>
        <div className="kpi">
          <div className="k">Per day</div>
          <div className="v">{fmt(perDay)}</div>
          {fmt2 && <div className="sub2">≈ {fmt2(perDay)}</div>}
          <div className="d muted">
            {days} day{days === 1 ? "" : "s"} · ~{fmt(perDay * 30)} / month
          </div>
        </div>
      </div>
      )}

      {view !== "income" && (
      <div className="card">
        <div className="card-title">
          <h2>Where the money went</h2>
          <button className="btn ghost sm" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Chart" : "Table"}
          </button>
        </div>
        {byCat.length === 0 ? (
          <Empty>No spending in this period.</Empty>
        ) : showTable ? (
          <table className="viz-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Amount</th>
                <th>Share</th>
                <th>Previous</th>
              </tr>
            </thead>
            <tbody>
              {byCat.map((r) => (
                <tr key={String(r.id)}>
                  <td>
                    {r.icon} {r.name}
                  </td>
                  <td>{fmt(r.amount)}</td>
                  <td>{expense ? Math.round((r.amount / expense) * 100) : 0}%</td>
                  <td className="muted">{fmt(r.prev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="donut-row">
            <Donut
              slices={slices}
              total={expense}
              format={fmt}
              center={
                <>
                  <div className="v">{fmt(expense)}</div>
                  <div className="k">spent</div>
                </>
              }
            />
            <Legend items={slices.map((s) => ({ label: s.label, color: s.color, value: `${expense ? Math.round((s.value / expense) * 100) : 0}%` }))} />
          </div>
        )}
      </div>
      )}

      {view !== "income" && (
      <div className="card">
        <div className="card-title">
          <h2>Top categories</h2>
          <span className="muted tiny">vs previous {days} days</span>
        </div>
        <div className="rank">
          {byCat.slice(0, 8).map((r) => {
            const d = delta(r.amount, r.prev);
            return (
              <Link key={String(r.id)} to={`/transactions?category=${r.id ?? ""}`} className="rank-row" style={{ color: "inherit" }}>
                <span className="n">
                  {r.icon} {r.name}
                </span>
                <span className="amt">{fmt(r.amount)}</span>
                <div className="bar">
                  <div style={{ width: `${byCat[0].amount ? (r.amount / byCat[0].amount) * 100 : 0}%`, background: r.color }} />
                </div>
                <span className={`delta ${d === null ? "muted" : d > 0 ? "expense" : "income"}`} style={{ gridColumn: "3 / 4" }}>
                  {d === null ? "new" : `${d > 0 ? "+" : ""}${d}%`}
                </span>
              </Link>
            );
          })}
          {byCat.length === 0 && <Empty>Nothing yet.</Empty>}
        </div>
      </div>
      )}

      {view === "spending" && topExpenses.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Biggest expenses</h2>
          </div>
          <div className="rank">
            {topExpenses.map(({ t, v }) => (
              <Link key={t.id} to={`/transactions?month=${t.date.slice(0, 7)}`} className="rank-row" style={{ color: "inherit" }}>
                <span className="n">{txTitle(t)}</span>
                <span className="amt expense">{fmt(v)}</span>
                <span className="tiny muted" style={{ gridColumn: "2 / 3" }}>
                  {formatDate(t.date, locale, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {view === "spending" && expenseByAccount.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Paid from</h2>
          </div>
          <div className="rank">
            {expenseByAccount.map((r) => (
              <Link key={r.id} to={`/transactions?account=${r.id}`} className="rank-row" style={{ color: "inherit" }}>
                <span className="n">
                  {r.type === "cash" ? "💵" : r.type === "savings" ? "💰" : "🏦"} {r.name}
                </span>
                <span className="amt">
                  {fmt(r.amount)} <span className="muted tiny">{expense ? Math.round((r.amount / expense) * 100) : 0}%</span>
                </span>
                <div className="bar">
                  <div style={{ width: `${(r.amount / expenseByAccount[0].amount) * 100}%`, background: "var(--expense)" }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {view === "spending" && (
        <div className="card">
          <div className="card-title">
            <h2>Spending by month</h2>
          </div>
          <Bars groups={months.map((m) => ({ label: m.label, values: [m.expense] }))} series={[{ name: "Spending", color: "var(--s2)" }]} format={fmt} />
        </div>
      )}

      {view === "overview" && (
      <div className="card">
        <div className="card-title">
          <h2>Income vs spending by month</h2>
        </div>
        <Bars
          groups={months.map((m) => ({ label: m.label, values: [m.income, m.expense], meta: <span className="muted">kept {fmt(m.income - m.expense)}</span> }))}
          series={[
            { name: "Income", color: "var(--s3)" },
            { name: "Spending", color: "var(--s2)" },
          ]}
          format={fmt}
        />
        <Legend items={[{ label: "Income", color: "var(--s3)" }, { label: "Spending", color: "var(--s2)" }]} />
      </div>
      )}

      {view !== "income" && (
      <div className="card">
        <div className="card-title">
          <h2>Spending per day</h2>
          {biggestDay.value > 0 && (
            <span className="muted tiny">
              peak {biggestDay.label}: {fmt(biggestDay.value)}
            </span>
          )}
        </div>
        {daily.every((d) => d.value === 0) ? (
          <Empty>No spending in this period.</Empty>
        ) : (
          <Bars groups={daily.map((d) => ({ label: d.label.split(" ")[0], values: [d.value], meta: <span className="muted">{d.label}</span> }))} series={[{ name: "Spent", color: "var(--s2)" }]} format={fmt} height={130} />
        )}
      </div>
      )}

      {view === "overview" && (
      <div className="card">
        <div className="card-title">
          <h2>Total money, last 12 months</h2>
          <span className="muted tiny">end of each month, in {currency}</span>
        </div>
        <Line points={wealth.map((w) => w.value)} labels={wealth.map((w) => w.label)} format={fmt} color="var(--s1)" />
      </div>
      )}

      {view === "overview" && incomeByCat.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Income sources</h2>
          </div>
          <div className="rank">
            {incomeByCat.map((r) => (
              <Link key={String(r.id)} to={`/transactions?category=${r.id ?? ""}`} className="rank-row" style={{ color: "inherit" }}>
                <span className="n">
                  {r.icon} {r.name}
                </span>
                <span className="amt">{fmt(r.amount)}</span>
                <div className="bar">
                  <div style={{ width: `${(r.amount / incomeByCat[0].amount) * 100}%`, background: "var(--s3)" }} />
                </div>
                <span className="delta muted" style={{ gridColumn: "3 / 4" }}>
                  {income ? Math.round((r.amount / income) * 100) : 0}%
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {view !== "income" && people.length > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Paid to people</h2>
          </div>
          <div className="rank">
            {people.map((p) => (
              <Link key={p.id} to={`/transactions?person=${p.id}`} className="rank-row" style={{ color: "inherit" }}>
                <span className="n">👤 {p.name}</span>
                <span className="amt">{fmt(p.amount)}</span>
                <div className="bar">
                  <div style={{ width: `${(p.amount / people[0].amount) * 100}%`, background: "var(--s7)" }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
