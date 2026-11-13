import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { addDays, billPaidMap, billRemaining, daysBetween, formatDate, monthLabel, monthKey, overview, shiftMonth, todayStr } from "../lib/money";
import type { Bill, SweepPreview, Transaction, TxType } from "../lib/types";
import { TransactionForm } from "../components/TransactionForm";
import { BillForm, PayBillForm } from "../components/BillForms";
import { Empty, Money, Sheet } from "../components/ui";
import { TxRow } from "./Transactions";

export function Home() {
  const { state, fmt, fmt2, fmtIn, locale, run, offline } = useData();
  const today = todayStr();
  const rolling = state.settings.savings_mode === "rolling";
  const sweepOn = !rolling && state.settings.sweep_enabled === "1";
  const [sweep, setSweep] = useState<{ cur: SweepPreview; prev: SweepPreview } | null>(null);
  useEffect(() => {
    if (!sweepOn || offline) return;
    const m = monthKey(today);
    Promise.all([api.get<SweepPreview>(`/api/sweep/preview?month=${m}`), api.get<SweepPreview>(`/api/sweep/preview?month=${shiftMonth(m, -1)}`)])
      .then(([cur, prev]) => setSweep({ cur, prev }))
      .catch(() => setSweep(null));
  }, [sweepOn, offline, state, today]);
  const ov = useMemo(() => overview(state, today), [state, today]);
  const paid = useMemo(() => billPaidMap(state), [state]);
  const [adding, setAdding] = useState<TxType | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [pickBill, setPickBill] = useState(false);
  const [newBill, setNewBill] = useState(false);

  const horizon = addDays(today, 30);
  const upcoming = state.bills
    .filter((b) => b.status === "open" && b.due_date <= horizon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  const openBills = state.bills.filter((b) => b.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const recent = state.transactions.slice(0, 5);
  const month = monthKey(today);
  function personName(id: number | null) {
    return id ? state.people.find((p) => p.id === id)?.name : undefined;
  }

  return (
    <>
      <div className="main">

        <div className="hero">
          <div className="label">Total money</div>
          <div className="big">{fmt(ov.totalMoney)}</div>
          {fmt2 && <div className="sub2">≈ {fmt2(ov.totalMoney)}</div>}
          <div className="row">
            {rolling ? (
              <>
                <div>
                  <div className="v">{fmt(ov.savedBefore)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.savedBefore)}</div>}
                  <div className="k">Savings (before this month)</div>
                </div>
                <div>
                  <div className="v">{ov.month.kept > 0 ? "+" : ""}{fmt(ov.month.kept)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.month.kept)}</div>}
                  <div className="k">This month so far</div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="v">{fmt(ov.available)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.available)}</div>}
                  <div className="k">Free after payments</div>
                </div>
                <div>
                  <div className="v">{fmt(ov.savings)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.savings)}</div>}
                  <div className="k">In savings</div>
                </div>
              </>
            )}
            <div>
              <div className="v">{fmt(ov.owedSoon)}</div>
              {fmt2 && <div className="sub2">≈ {fmt2(ov.owedSoon)}</div>}
              <div className="k">Owed this month</div>
            </div>
          </div>
          {rolling && (
            <div className="tiny" style={{ opacity: 0.8, marginTop: 10 }}>
              {ov.month.kept >= 0
                ? `What is left at the end of the month stays in savings. Spend more than you earn and it comes out of savings.`
                : `You are ${fmt(-ov.month.kept)} over this month's income, so savings are covering it.`}
            </div>
          )}
        </div>

        <div className="quick">
          <button className="btn in" onClick={() => setAdding("income")}>
            <span className="big-ic">＋</span>Add income
          </button>
          <button className="btn out" onClick={() => setAdding("expense")}>
            <span className="big-ic">－</span>Add expense
          </button>
          <button className="btn pay" onClick={() => (openBills.length ? setPickBill(true) : setNewBill(true))}>
            <span className="big-ic">✓</span>Record payment
          </button>
        </div>

        {sweepOn && sweep && (
          <div className="card">
            {(() => {
              const f = fmtIn(sweep.cur.currency);
              const since = state.settings.sweep_enabled_since || "";
              const prevRelevant = !sweep.prev.done && (!since || sweep.prev.month >= since) && Math.abs(sweep.prev.amount) >= 0.01;
              const p = prevRelevant ? sweep.prev : sweep.cur;
              const isCur = p === sweep.cur;
              const title = p.done
                ? `${monthLabel(p.month, locale)} closed`
                : isCur
                  ? `${monthLabel(p.month, locale)} so far`
                  : `Close ${monthLabel(p.month, locale)}`;
              const line =
                p.amount > 0
                  ? `${f(p.amount)} ${p.done ? "moved" : "will move"} into savings`
                  : p.amount < 0
                    ? `${f(-p.amount)} ${p.done ? "came" : "will come"} back from savings to cover the shortfall`
                    : "Nothing to move: income and spending are equal";
              return (
                <>
                  <div className="between">
                    <div>
                      <div className="bold">{title}</div>
                      <div className="small muted">
                        Income {f(p.income)} − spending {f(p.expense)} = <span className={p.kept < 0 ? "expense bold" : "income bold"}>{f(p.kept)}</span>
                      </div>
                      <div className="small mt" style={{ marginTop: 4 }}>
                        {line}
                        {isCur && !p.done ? " on the 1st" : ""}
                      </div>
                      {p.capped && <div className="tiny warn">{p.note}</div>}
                    </div>
                    {p.done ? (
                      <span className="pill good">Done</span>
                    ) : (
                      <button
                        className="btn sm"
                        onClick={() => {
                          if (isCur && !window.confirm(`Close ${monthLabel(p.month, locale)} now? Anything you add later this month will not be moved.`)) return;
                          run(() => api.post("/api/sweep/run", { month: p.month }), "Month closed");
                        }}
                      >
                        Close now
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="k">Income</div>
            <div className="v income">{fmt(ov.month.income)}</div>
            {fmt2 && <div className="sub2">≈ {fmt2(ov.month.income)}</div>}
          </div>
          <div className="stat">
            <div className="k">Spending</div>
            <div className="v expense">{fmt(ov.month.expense)}</div>
            {fmt2 && <div className="sub2">≈ {fmt2(ov.month.expense)}</div>}
          </div>
          <div className="stat">
            <div className="k">Kept</div>
            <div className={`v ${ov.month.kept < 0 ? "expense" : ""}`}>{fmt(ov.month.kept)}</div>
            {fmt2 && <div className="sub2">≈ {fmt2(ov.month.kept)}</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Upcoming payments</h2>
            <Link to="/people" className="link">
              See all
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <Empty>
              Nothing due in the next 30 days.{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), setNewBill(true))}>
                Schedule a payment
              </a>
            </Empty>
          ) : (
            <div className="list">
              {upcoming.map((b) => {
                const rem = billRemaining(b, paid);
                const d = daysBetween(today, b.due_date);
                return (
                  <button key={b.id} className="row-item" onClick={() => setPaying(b)}>
                    <div className="ic">{d < 0 ? "⚠️" : "📅"}</div>
                    <div className="body">
                      <div className="t">{b.title}</div>
                      <div className="s">
                        {personName(b.person_id) ? `${personName(b.person_id)} · ` : ""}
                        {d < 0 ? <span className="expense bold">{-d} days overdue</span> : d === 0 ? <span className="warn bold">Due today</span> : `Due ${formatDate(b.due_date, locale)}`}
                        {b.recurrence !== "none" ? " · repeats" : ""}
                      </div>
                    </div>
                    <div className="amt">
                      {fmtIn(b.currency)(rem)}
                      {rem < b.amount - 0.004 && <span className="sub">of {fmtIn(b.currency)(b.amount)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Recent</h2>
            <Link to="/transactions" className="link">
              All transactions
            </Link>
          </div>
          {recent.length === 0 ? (
            <Empty>No transactions yet. Start by setting opening balances in Accounts, then add your first income or expense.</Empty>
          ) : (
            <div className="list">
              {recent.map((t) => (
                <TxRow key={t.id} t={t} onClick={() => setEditing(t)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {adding && <TransactionForm initialType={adding} onClose={() => setAdding(null)} />}
      {editing && <TransactionForm existing={editing} onClose={() => setEditing(null)} />}
      {paying && <PayBillForm bill={paying} onClose={() => setPaying(null)} />}
      {newBill && <BillForm onClose={() => setNewBill(false)} />}
      {pickBill && (
        <Sheet title="Which payment?" onClose={() => setPickBill(false)}>
          <div className="list">
            {openBills.map((b) => (
              <button
                key={b.id}
                className="row-item"
                onClick={() => {
                  setPickBill(false);
                  setPaying(b);
                }}
              >
                <div className="ic">👤</div>
                <div className="body">
                  <div className="t">{b.title}</div>
                  <div className="s">
                    {personName(b.person_id) ? `${personName(b.person_id)} · ` : ""}due {formatDate(b.due_date, locale)}
                  </div>
                </div>
                <div className="amt">
                  <Money value={billRemaining(b, paid)} currency={b.currency} />
                </div>
              </button>
            ))}
          </div>
          <button
            className="btn block mt"
            onClick={() => {
              setPickBill(false);
              setNewBill(true);
            }}
          >
            + Schedule a new payment
          </button>
        </Sheet>
      )}
    </>
  );
}
