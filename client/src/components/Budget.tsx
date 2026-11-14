import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { catLabel, monthKey, monthLabel, todayStr } from "../lib/money";
import type { BudgetItem } from "../lib/types";
import { CategoryPicker } from "./CategoryPicker";
import { ConfirmDelete, Empty, Field, Sheet } from "./ui";

/**
 * Monthly plan: a list of what I expect to spend each month (subscriptions, family, haircut...).
 * It never moves money. Each line shows what was already spent this month in its category and what is left.
 */
export function useMonthlyPlan() {
  const { state, conv, currency: mainCurrency, secondary } = useData();
  const month = monthKey(todayStr());
  const defaultCur = secondary?.currency ?? mainCurrency;
  return useMemo(() => {
    const accCur = new Map(state.accounts.map((a) => [a.id, a.currency || mainCurrency]));
    // Category → its own id plus its sub-categories, so a plan line on "Car" counts Fuel and Repairs too.
    const family = (catId: number) => [catId, ...state.categories.filter((c) => c.parent_id === catId).map((c) => c.id)];
    const rows = state.budget.map((item) => {
      const cur = item.currency || defaultCur;
      const ids = item.category_id ? new Set(family(item.category_id)) : null;
      let spent = 0;
      if (ids) {
        for (const t of state.transactions) {
          if (t.type !== "expense" || !t.date.startsWith(month) || t.category_id === null || !ids.has(t.category_id)) continue;
          spent += conv(t.amount, accCur.get(t.account_id) ?? mainCurrency, cur);
        }
      }
      return { item, cur, spent, left: Math.max(0, item.amount - spent), over: spent > item.amount + 0.004 };
    });
    // Totals in the default currency (all lines share it in practice).
    const planned = rows.reduce((s, r) => s + conv(r.item.amount, r.cur, defaultCur), 0);
    const spent = rows.reduce((s, r) => s + conv(r.spent, r.cur, defaultCur), 0);
    const left = rows.reduce((s, r) => s + conv(r.left, r.cur, defaultCur), 0);
    return { month, rows, planned, spent, left, cur: defaultCur };
  }, [state, conv, mainCurrency, defaultCur, month]);
}

export function BudgetCard() {
  const { state, fmtIn, locale } = useData();
  const plan = useMonthlyPlan();
  const [manage, setManage] = useState(false);
  const [edit, setEdit] = useState<BudgetItem | "new" | null>(null);
  const f = fmtIn(plan.cur);
  const icon = (catId: number | null) => state.categories.find((c) => c.id === catId)?.icon ?? "📋";

  return (
    <>
      <div className="card">
        <div className="card-title">
          <div>
            <h2>Monthly plan</h2>
            <div className="tiny muted">{monthLabel(plan.month, locale)}</div>
          </div>
          <button className="btn ghost sm" onClick={() => setManage(true)}>
            {state.budget.length ? "Edit list" : "+ Add"}
          </button>
        </div>
        {plan.rows.length === 0 ? (
          <Empty>List what you spend every month (subscriptions, family, haircut…) and see here how much of it is already spent.</Empty>
        ) : (
          <>
            <div className="list">
              {plan.rows.map(({ item, cur, spent, left, over }) => {
                const fi = fmtIn(cur);
                const pct = Math.min(100, (spent / item.amount) * 100);
                const done = !over && item.amount - spent < 0.005;
                return (
                  <Link
                    key={item.id}
                    to={item.category_id ? `/transactions?category=${item.category_id}` : "/transactions"}
                    className={`plan-row ${over ? "over" : done ? "done" : ""}`}
                  >
                    <span className="pi">{done ? "✅" : icon(item.category_id)}</span>
                    <span className={`pn ${done ? "income" : over ? "expense" : ""}`}>{item.name}</span>
                    <span className={`pa ${done ? "income" : over ? "expense" : ""}`}>
                      {fi(spent)} <span className="muted">/ {fi(item.amount)}</span>
                      <span className={`sub ${over ? "expense" : done ? "income" : ""}`}>{over ? `${fi(spent - item.amount)} over` : done ? "paid ✓" : `${fi(left)} left`}</span>
                    </span>
                    <div className="bar">
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="plan-total">
              <span className="muted">
                Spent <b className="expense">{f(plan.spent)}</b> of {f(plan.planned)}
              </span>
              <span>
                <b>{f(plan.left)}</b> <span className="muted">still to spend</span>
              </span>
            </div>
          </>
        )}
      </div>

      {manage && (
        <Sheet title="Monthly plan" onClose={() => setManage(false)}>
          <p className="small muted mb">What you expect to spend each month. This list does not take any money; it only compares with what you really spent.</p>
          {state.budget.length === 0 ? (
            <Empty>Nothing in the list yet.</Empty>
          ) : (
            <div className="list">
              {state.budget.map((b) => (
                <button key={b.id} className="row-item" onClick={() => setEdit(b)}>
                  <div className="ic">{icon(b.category_id)}</div>
                  <div className="body">
                    <div className="t">{b.name}</div>
                    <div className="s">{b.category_id ? catLabel(state.categories, state.categories.find((c) => c.id === b.category_id)) : "No category"}</div>
                  </div>
                  <div className="amt">{fmtIn(b.currency || plan.cur)(b.amount)}</div>
                </button>
              ))}
            </div>
          )}
          <button className="btn primary mt" style={{ width: "100%" }} onClick={() => setEdit("new")}>
            + Add a line
          </button>
          <div className="plan-total">
            <span className="muted">Planned per month</span>
            <b>{f(plan.planned)}</b>
          </div>
        </Sheet>
      )}
      {edit && <BudgetItemForm existing={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function BudgetItemForm({ existing, onClose }: { existing?: BudgetItem; onClose: () => void }) {
  const { state, run, currencies, currency: mainCurrency, secondary } = useData();
  const [name, setName] = useState(existing?.name ?? "");
  const [categoryId, setCategoryId] = useState(String(existing?.category_id ?? ""));
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [currency, setCurrency] = useState(existing?.currency ?? secondary?.currency ?? mainCurrency);
  const [busy, setBusy] = useState(false);

  function pickCategory(id: string) {
    setCategoryId(id);
    // Name the line after the category unless a name was typed already.
    const c = state.categories.find((x) => String(x.id) === id);
    if (c && !name.trim()) setName(c.name);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, category_id: categoryId || null, amount, currency };
    const ok = await run(() => (existing ? api.put(`/api/budget/${existing.id}`, body) : api.post("/api/budget", body)), existing ? "Saved" : "Added to the plan");
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/budget/${existing.id}`), "Removed");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit line" : "Add to the monthly plan"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Spending category" hint="Spending in this category (and its sub-categories) counts against this line.">
          <CategoryPicker kind="expense" value={categoryId} onChange={pickCategory} allowNone={false} />
        </Field>
        <Field label="Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Subscriptions" required maxLength={60} />
        </Field>
        <div className="grid2">
          <Field label="Per month" className="amount">
            <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0" autoFocus={!!categoryId} />
          </Field>
          <Field label="Currency">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(currencies.includes(currency) ? currencies : [...currencies, currency]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy || !categoryId}>
            {existing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
