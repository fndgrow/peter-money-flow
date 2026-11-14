import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/store";
import { addDays, billPaidMap, billRemaining, daysBetween, formatDate, monthKey, overview, todayStr } from "../lib/money";
import type { Bill, Transaction } from "../lib/types";
import { TransactionForm } from "../components/TransactionForm";
import { BillForm, PayBillForm } from "../components/BillForms";
import { Empty } from "../components/ui";
import { TxRow } from "./Transactions";

export function Home() {
  const { state, fmt, fmt2, fmtIn, locale } = useData();
  const today = todayStr();
  const rolling = state.settings.savings_mode === "rolling";
  const ov = useMemo(() => overview(state, today), [state, today]);
  const paid = useMemo(() => billPaidMap(state), [state]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [newBill, setNewBill] = useState(false);

  const horizon = addDays(today, 30);
  const owedToMe = state.bills.filter((b) => b.status === "open" && b.direction === "in").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const upcoming = state.bills
    .filter((b) => b.status === "open" && b.direction !== "in" && b.due_date <= horizon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  const recent = state.transactions.slice(0, 5);
  const month = monthKey(today);
  function personName(id: number | null) {
    return id ? state.people.find((p) => p.id === id)?.name : undefined;
  }

  return (
    <>
      <div className="main">

        <div className="hero">
          {rolling ? (
            <>
              <div className="label">Total money</div>
              <div className="big">{fmt(ov.totalMoney)}</div>
              {fmt2 && <div className="sub2">≈ {fmt2(ov.totalMoney)}</div>}
              <div className="row">
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
                <div>
                  <div className="v">{fmt(ov.owedTotal)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.owedTotal)}</div>}
                  <div className="k">To pay</div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* The money in cash and bank right now; savings are shown separately below. */}
              <div className="label">This month</div>
              <div className="big">{fmt(ov.spendable)}</div>
              {fmt2 && <div className="sub2">≈ {fmt2(ov.spendable)}</div>}
              <div className="row">
                <div>
                  <div className="v">{fmt(ov.totalMoney)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.totalMoney)}</div>}
                  <div className="k">Total (with savings)</div>
                </div>
                <div>
                  <div className="v">{fmt(ov.savings)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.savings)}</div>}
                  <div className="k">Savings</div>
                </div>
                <div>
                  <div className="v">{fmt(ov.owedTotal)}</div>
                  {fmt2 && <div className="sub2">≈ {fmt2(ov.owedTotal)}</div>}
                  <div className="k">To pay</div>
                </div>
              </div>
            </>
          )}
          {rolling && (
            <div className="tiny" style={{ opacity: 0.8, marginTop: 10 }}>
              {ov.month.kept >= 0
                ? `What is left at the end of the month stays in savings. Spend more than you earn and it comes out of savings.`
                : `You are ${fmt(-ov.month.kept)} over this month's income, so savings are covering it.`}
            </div>
          )}
        </div>

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

        {owedToMe.length > 0 && (
          <div className="card">
            <div className="card-title">
              <h2>Owed to me</h2>
              <span className="bold income">{fmt(ov.owedToMe)}</span>
            </div>
            <div className="list">
              {owedToMe.slice(0, 5).map((b) => {
                const rem = billRemaining(b, paid);
                const d = daysBetween(today, b.due_date);
                return (
                  <button key={b.id} className="row-item" onClick={() => setPaying(b)}>
                    <div className="ic">🤝</div>
                    <div className="body">
                      <div className="t">{b.title}</div>
                      <div className="s">
                        {personName(b.person_id) ? `${personName(b.person_id)} · ` : ""}
                        {d < 0 ? <span className="warn bold">{-d} days late</span> : `expected ${formatDate(b.due_date, locale)}`}
                      </div>
                    </div>
                    <div className="amt income">
                      {fmtIn(b.currency)(rem)}
                      {rem < b.amount - 0.004 && <span className="sub">of {fmtIn(b.currency)(b.amount)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            {owedToMe.length > 5 && (
              <Link to="/people" className="link small">
                See all {owedToMe.length}
              </Link>
            )}
          </div>
        )}

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

      {editing && <TransactionForm existing={editing} onClose={() => setEditing(null)} />}
      {paying && <PayBillForm bill={paying} onClose={() => setPaying(null)} />}
      {newBill && <BillForm onClose={() => setNewBill(false)} />}
    </>
  );
}
