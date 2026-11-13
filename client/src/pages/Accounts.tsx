import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/store";
import { accountBalances, daysBetween, formatDate, monthKey, monthLabel, todayStr } from "../lib/money";
import type { Account, Goal, Transaction } from "../lib/types";
import { AccountForm, GoalForm } from "../components/EntityForms";
import { TransactionForm } from "../components/TransactionForm";
import { Empty, Money, Progress, Sheet } from "../components/ui";
import { TxRow } from "./Transactions";

const TYPE_ICON: Record<Account["type"], string> = { cash: "💵", bank: "🏦", savings: "🐷" };

export function Accounts() {
  const { state, fmt, fmt2, fmtIn, conv, currency, locale } = useData();
  const balances = useMemo(() => accountBalances(state.accounts, state.transactions), [state]);
  const inMain = (a: Account) => conv(balances.get(a.id) ?? 0, a.currency || currency, currency);
  const [editAccount, setEditAccount] = useState<Account | null | "new">(null);
  const [editGoal, setEditGoal] = useState<Goal | null | "new">(null);
  const [transfer, setTransfer] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<Account | null>(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);

  const active = state.accounts.filter((a) => !a.archived);
  const archived = state.accounts.filter((a) => a.archived);
  const total = active.reduce((s, a) => s + inMain(a), 0);
  const savings = active.filter((a) => a.type === "savings").reduce((s, a) => s + inMain(a), 0);
  const today = todayStr();

  return (
    <>
      <div className="main">
        <div className="between mb">
          <h1>Accounts & Savings</h1>
          <button className="btn primary sm" onClick={() => setTransfer(true)}>
            🔁 Transfer
          </button>
        </div>

        {active.length > 3 && (
          <div className="hero">
            <div className="label">Total money</div>
            <div className="big">{fmt(total)}</div>
            {fmt2 && <div className="sub2">≈ {fmt2(total)}</div>}
            <div className="row">
              <div>
                <div className="v">{fmt(total - savings)}</div>
                {fmt2 && <div className="sub2">≈ {fmt2(total - savings)}</div>}
                <div className="k">Spendable</div>
              </div>
              <div>
                <div className="v">{fmt(savings)}</div>
                {fmt2 && <div className="sub2">≈ {fmt2(savings)}</div>}
                <div className="k">Savings</div>
              </div>
            </div>
          </div>
        )}

        {(
          [
            { key: "current", title: "My current status", hint: "Bank + cash, the money you live on this month", list: active.filter((a) => a.type !== "savings") },
            { key: "savings", title: "My savings", hint: "What you keep aside", list: active.filter((a) => a.type === "savings") },
          ] as const
        ).map((g) => (
          <div className="card" key={g.key}>
            <div className="card-title" style={{ alignItems: "flex-start" }}>
              <div>
                <h2>{g.title}</h2>
                <div className="tiny muted">{g.hint}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="bold">{fmt(g.list.reduce((s, a) => s + inMain(a), 0))}</div>
                {fmt2 && <div className="sub2">≈ {fmt2(g.list.reduce((s, a) => s + inMain(a), 0))}</div>}
              </div>
            </div>
            <div className="list">
              {g.list.map((a) => (
                <AccountRow key={a.id} a={a} balance={balances.get(a.id) ?? 0} onEdit={() => setEditAccount(a)} onOpen={() => setOpen(a)} />
              ))}
              {g.list.length === 0 && <Empty>No account here yet.</Empty>}
            </div>
          </div>
        ))}

        <button className="btn block mb" onClick={() => setEditAccount("new")}>
          + Add account
        </button>

        <div className="card">
          <div className="card-title">
            <h2>Savings goals</h2>
            <button className="btn sm" onClick={() => setEditGoal("new")}>
              + Goal
            </button>
          </div>
          {state.goals.length === 0 ? (
            <Empty>Set a goal and link it to a savings account to see your progress.</Empty>
          ) : (
            <div className="list">
              {state.goals.map((g) => {
                const current = g.account_id ? (balances.get(g.account_id) ?? 0) : 0;
                const gf = fmtIn(state.accounts.find((a) => a.id === g.account_id)?.currency || currency);
                const pct = g.target_amount > 0 ? Math.min(100, Math.round((current / g.target_amount) * 100)) : 0;
                const days = g.target_date ? daysBetween(today, g.target_date) : null;
                const left = Math.max(0, g.target_amount - current);
                const perMonth = days && days > 0 && left > 0 ? left / Math.max(1, days / 30.4) : null;
                return (
                  <button key={g.id} className="row-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }} onClick={() => setEditGoal(g)}>
                    <div className="between">
                      <div className="t">{g.name}</div>
                      <div className="amt">
                        {gf(current)} <span className="muted" style={{ fontWeight: 500 }}>/ {gf(g.target_amount)}</span>
                      </div>
                    </div>
                    <Progress value={current} max={g.target_amount} good={pct >= 100} />
                    <div className="s">
                      {pct}% there
                      {pct >= 100 ? " · goal reached 🎉" : ""}
                      {g.target_date && pct < 100 ? ` · by ${formatDate(g.target_date, locale, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                      {perMonth ? ` · about ${gf(perMonth)} / month` : ""}
                      {!g.account_id ? " · not linked to an account" : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {archived.length > 0 && (
          <div className="card flat">
            <button className="btn ghost sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide" : "Show"} {archived.length} archived account{archived.length === 1 ? "" : "s"}
            </button>
            {showArchived && (
              <div className="list mt">
                {archived.map((a) => (
                  <AccountRow key={a.id} a={a} balance={balances.get(a.id) ?? 0} onEdit={() => setEditAccount(a)} onOpen={() => setOpen(a)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {editAccount && <AccountForm existing={editAccount === "new" ? undefined : editAccount} onClose={() => setEditAccount(null)} />}
      {editGoal && <GoalForm existing={editGoal === "new" ? undefined : editGoal} onClose={() => setEditGoal(null)} />}
      {transfer && <TransactionForm initialType="transfer" onClose={() => setTransfer(false)} />}
      {open && !editTx && (
        <AccountDetail
          a={open}
          balance={balances.get(open.id) ?? 0}
          onClose={() => setOpen(null)}
          onEdit={() => {
            const a = open;
            setOpen(null);
            setEditAccount(a);
          }}
          onTx={(t) => setEditTx(t)}
        />
      )}
      {editTx && <TransactionForm existing={editTx} onClose={() => setEditTx(null)} />}
    </>
  );
}

function AccountRow({ a, balance, onEdit, onOpen }: { a: Account; balance: number; onEdit: () => void; onOpen: () => void }) {
  return (
    <button className="row-item" onClick={onOpen}>
      <div className="ic">{TYPE_ICON[a.type]}</div>
      <div className="body">
        <div className="t">
          {a.name} <span className="pill">{a.currency}</span>
        </div>
        <div className="s">
          {a.type === "savings" ? "Savings" : a.type === "cash" ? "Cash" : "Bank"} ·{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </a>
        </div>
      </div>
      <div className={`amt ${balance < 0 ? "expense" : ""}`}>
        <Money value={balance} currency={a.currency} />
      </div>
    </button>
  );
}

/** Everything about one account: balance, this month, and its recent movements. */
function AccountDetail({ a, balance, onClose, onEdit, onTx }: { a: Account; balance: number; onClose: () => void; onEdit: () => void; onTx: (t: Transaction) => void }) {
  const { state, fmtIn, locale } = useData();
  const f = fmtIn(a.currency);
  const month = monthKey();
  let inc = 0, out = 0, movedIn = 0, movedOut = 0;
  const mine = state.transactions.filter((t) => t.account_id === a.id || t.to_account_id === a.id);
  for (const t of mine) {
    if (!t.date.startsWith(month)) continue;
    if (t.type === "income") inc += t.amount;
    else if (t.type === "expense") out += t.amount;
    else if (t.account_id === a.id) movedOut += t.amount;
    else movedIn += t.to_amount ?? t.amount;
  }
  const recent = mine.slice(0, 15);
  return (
    <Sheet title={a.name} onClose={onClose}>
      <div className="hero" style={{ marginBottom: 12 }}>
        <div className="label">Balance</div>
        <div className="big">{f(balance)}</div>
        <div className="row">
          <div>
            <div className="v">+{f(inc + movedIn)}</div>
            <div className="k">In this month</div>
          </div>
          <div>
            <div className="v">−{f(out + movedOut)}</div>
            <div className="k">Out this month</div>
          </div>
          <div>
            <div className={`v`}>{inc + movedIn - out - movedOut >= 0 ? "+" : ""}{f(inc + movedIn - out - movedOut)}</div>
            <div className="k">{monthLabel(month, locale)}</div>
          </div>
        </div>
      </div>
      <div className="flex mb">
        <Link to={`/transactions?account=${a.id}`} className="btn grow" onClick={onClose}>
          All transactions
        </Link>
        <button className="btn" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="card flat">
        <div className="tiny muted bold mb">RECENT</div>
        {recent.length === 0 ? (
          <Empty>No movements yet.</Empty>
        ) : (
          <div className="list">
            {recent.map((t) => (
              <TxRow key={t.id} t={t} onClick={() => onTx(t)} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
