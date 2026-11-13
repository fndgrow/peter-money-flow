import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/store";
import { addDays, billPaidMap, billRemaining, daysBetween, formatDate, monthLabel, monthKey, overview, todayStr } from "../lib/money";
import type { Bill, Transaction, TxType } from "../lib/types";
import { TransactionForm } from "../components/TransactionForm";
import { BillForm, PayBillForm, SalaryConfirmForm } from "../components/BillForms";
import { Empty, Money, Sheet } from "../components/ui";
import { TxRow } from "./Transactions";

export function Home() {
  const { state, fmt, locale } = useData();
  const today = todayStr();
  const ov = useMemo(() => overview(state, today), [state, today]);
  const paid = useMemo(() => billPaidMap(state.transactions), [state.transactions]);
  const [adding, setAdding] = useState<TxType | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [pickBill, setPickBill] = useState(false);
  const [newBill, setNewBill] = useState(false);
  const [salary, setSalary] = useState(false);

  const horizon = addDays(today, 30);
  const upcoming = state.bills
    .filter((b) => b.status === "open" && b.due_date <= horizon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  const openBills = state.bills.filter((b) => b.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const recent = state.transactions.slice(0, 5);
  const month = monthKey(today);
  const name = state.settings.owner_name;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  function personName(id: number | null) {
    return id ? state.people.find((p) => p.id === id)?.name : undefined;
  }

  return (
    <>
      <div className="main">
        <div className="between mb">
          <div>
            <div className="muted small">
              {greeting}
              {name ? `, ${name}` : ""}
            </div>
            <h1>{monthLabel(month, locale)}</h1>
          </div>
          <Link to="/settings" className="btn ghost sm">
            Settings
          </Link>
        </div>

        <div className="hero">
          <div className="label">Available after upcoming payments</div>
          <div className="big">{fmt(ov.available)}</div>
          <div className="row">
            <div>
              <div className="v">{fmt(ov.totalMoney)}</div>
              <div className="k">Total money</div>
            </div>
            <div>
              <div className="v">{fmt(ov.owedSoon)}</div>
              <div className="k">Owed this month</div>
            </div>
            <div>
              <div className="v">{fmt(ov.savings)}</div>
              <div className="k">In savings</div>
            </div>
          </div>
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

        {ov.salary && (
          <div className="card">
            {ov.salary.received ? (
              <div className="between">
                <div>
                  <div className="bold">Salary received</div>
                  <div className="small muted">{fmt(ov.salary.receivedAmount)} this month</div>
                </div>
                <span className="pill good">Done</span>
              </div>
            ) : (
              <div className="between">
                <div>
                  <div className="bold">Expected salary {fmt(ov.salary.expected)}</div>
                  <div className="small muted">
                    Usually around the {ov.salary.payday}
                    {ordinal(ov.salary.payday)}. Not counted until you confirm it.
                  </div>
                </div>
                <button className="btn primary sm" onClick={() => setSalary(true)}>
                  It arrived
                </button>
              </div>
            )}
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="k">Income</div>
            <div className="v income">{fmt(ov.month.income)}</div>
          </div>
          <div className="stat">
            <div className="k">Spending</div>
            <div className="v expense">{fmt(ov.month.expense)}</div>
          </div>
          <div className="stat">
            <div className="k">Kept</div>
            <div className={`v ${ov.month.kept < 0 ? "expense" : ""}`}>{fmt(ov.month.kept)}</div>
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
                      {fmt(rem)}
                      {rem < b.amount - 0.004 && <span className="sub">of {fmt(b.amount)}</span>}
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
      {salary && <SalaryConfirmForm onClose={() => setSalary(false)} />}
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
                  <Money value={billRemaining(b, paid)} />
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

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
