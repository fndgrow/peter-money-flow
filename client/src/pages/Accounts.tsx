import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/store";
import { accountBalances, daysBetween, formatDate, todayStr } from "../lib/money";
import type { Account, Goal } from "../lib/types";
import { AccountForm, GoalForm } from "../components/EntityForms";
import { TransactionForm } from "../components/TransactionForm";
import { Empty, Money, Progress } from "../components/ui";

const TYPE_LABEL: Record<Account["type"], string> = { cash: "Cash", bank: "Bank accounts", savings: "Savings" };
const TYPE_ICON: Record<Account["type"], string> = { cash: "💵", bank: "🏦", savings: "🐷" };

export function Accounts() {
  const { state, fmt, fmt2, fmtIn, conv, currency, locale } = useData();
  const balances = useMemo(() => accountBalances(state.accounts, state.transactions), [state]);
  const inMain = (a: Account) => conv(balances.get(a.id) ?? 0, a.currency || currency, currency);
  const [editAccount, setEditAccount] = useState<Account | null | "new">(null);
  const [editGoal, setEditGoal] = useState<Goal | null | "new">(null);
  const [transfer, setTransfer] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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

        {(["bank", "cash", "savings"] as const).map((type) => {
          const list = active.filter((a) => a.type === type);
          if (!list.length) return null;
          return (
            <div className="card" key={type}>
              <div className="card-title">
                <h2>{TYPE_LABEL[type]}</h2>
                <span className="muted small">{fmt(list.reduce((s, a) => s + inMain(a), 0))}</span>
              </div>
              <div className="list">
                {list.map((a) => (
                  <AccountRow key={a.id} a={a} balance={balances.get(a.id) ?? 0} onEdit={() => setEditAccount(a)} />
                ))}
              </div>
            </div>
          );
        })}

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
                  <AccountRow key={a.id} a={a} balance={balances.get(a.id) ?? 0} onEdit={() => setEditAccount(a)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {editAccount && <AccountForm existing={editAccount === "new" ? undefined : editAccount} onClose={() => setEditAccount(null)} />}
      {editGoal && <GoalForm existing={editGoal === "new" ? undefined : editGoal} onClose={() => setEditGoal(null)} />}
      {transfer && <TransactionForm initialType="transfer" onClose={() => setTransfer(false)} />}
    </>
  );
}

function AccountRow({ a, balance, onEdit }: { a: Account; balance: number; onEdit: () => void }) {
  return (
    <div className="row-item" style={{ cursor: "default" }}>
      <div className="ic">{TYPE_ICON[a.type]}</div>
      <div className="body">
        <div className="t">
          {a.name} <span className="pill">{a.currency}</span>
        </div>
        <div className="s">
          <Link to={`/transactions?account=${a.id}`}>Transactions</Link> · <a href="#" onClick={(e) => (e.preventDefault(), onEdit())}>Edit</a>
        </div>
      </div>
      <div className={`amt ${balance < 0 ? "expense" : ""}`}>
        <Money value={balance} currency={a.currency} />
      </div>
    </div>
  );
}
