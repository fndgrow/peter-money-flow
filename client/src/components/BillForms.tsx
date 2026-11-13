import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { billPaidMap, billRemaining, categoryGroups, todayStr } from "../lib/money";
import type { Bill, Recurrence } from "../lib/types";
import { ConfirmDelete, Field, Sheet } from "./ui";

export function BillForm({ existing, onClose, presetPersonId }: { existing?: Bill; onClose: () => void; presetPersonId?: number }) {
  const { state, run, refresh, currencies, currency: mainCurrency } = useData();
  const peopleCat = state.categories.find((c) => c.system === "people");
  const [currency, setCurrency] = useState(existing?.currency ?? mainCurrency);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [personId, setPersonId] = useState(String(existing?.person_id ?? presetPersonId ?? ""));
  const [categoryId, setCategoryId] = useState(String(existing?.category_id ?? peopleCat?.id ?? ""));
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [dueDate, setDueDate] = useState(existing?.due_date ?? todayStr());
  const [recurrence, setRecurrence] = useState<Recurrence>(existing?.recurrence ?? "none");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const people = state.people.filter((p) => !p.archived || p.id === existing?.person_id);

  async function addPerson() {
    const name = window.prompt("Person's name");
    if (!name?.trim()) return;
    try {
      const r = await api.post<{ id: number }>("/api/people", { name: name.trim() });
      await refresh();
      setPersonId(String(r.id));
      if (!title) setTitle(name.trim());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { title, person_id: personId || null, category_id: categoryId || null, amount, currency, due_date: dueDate, recurrence, note };
    const ok = await run(
      () => (existing ? api.put(`/api/bills/${existing.id}`, body) : api.post("/api/bills", body)),
      existing ? "Saved" : "Payment scheduled",
    );
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/bills/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit scheduled payment" : "Schedule a payment"} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <Field label="What is it for?">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rent, Car repair, Loan to Dan" required maxLength={120} autoFocus />
        </Field>
        <Field label="Person (optional)" hint="Leave empty for bills that are not tied to a person, like rent or a subscription.">
          <div className="flex">
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} style={{ flex: 1 }}>
              <option value="">No person</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm" onClick={addPerson}>
              +
            </button>
          </div>
        </Field>
        <div className="grid2">
          <Field label="Amount" className="amount">
            <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0" />
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
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
        <div className="grid2">
          <Field label="Repeats">
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="none">Once</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </select>
          </Field>
          <Field label="Spending category">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categoryGroups(state.categories, "expense", existing?.category_id).map(({ parent, children }) =>
                children.length === 0 ? (
                  <option key={parent.id} value={parent.id}>
                    {parent.icon ? `${parent.icon} ` : ""}
                    {parent.name}
                  </option>
                ) : (
                  <optgroup key={parent.id} label={`${parent.icon ?? ""} ${parent.name}`}>
                    <option value={parent.id}>
                      {parent.icon ? `${parent.icon} ` : ""}
                      {parent.name} (general)
                    </option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon ? `${c.icon} ` : ""}
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </Field>
        </div>
        <Field label="Note">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500} />
        </Field>
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            {existing ? "Save" : "Schedule"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function PayBillForm({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { state, run, fmtIn, conv, currency: mainCurrency, secondary } = useData();
  const remaining = billRemaining(bill, billPaidMap(state));
  const billCur = bill.currency || mainCurrency;
  const fmtBill = fmtIn(billCur);
  // Payments go out of day-to-day accounts (the second currency, e.g. MDL) when those exist.
  const active = state.accounts.filter((a) => !a.archived);
  const payAccounts = secondary && active.some((a) => a.currency === secondary.currency) ? active.filter((a) => a.currency === secondary.currency) : active;
  const defaultAccount = payAccounts.find((a) => a.type === "bank") ?? payAccounts.find((a) => a.type !== "savings") ?? payAccounts[0];
  const [accountId, setAccountId] = useState(String(defaultAccount?.id ?? ""));
  const currency = state.accounts.find((a) => String(a.id) === accountId)?.currency || mainCurrency;
  const [amount, setAmount] = useState(String(Math.round(conv(remaining, billCur, defaultAccount?.currency || mainCurrency) * 100) / 100));
  const fmt = fmtIn(currency);
  // What this payment is worth in the bill's currency.
  const paidInBill = conv(Number(amount) || 0, currency, billCur);
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const person = state.people.find((p) => p.id === bill.person_id);
  const partial = paidInBill > 0 && paidInBill < remaining - 0.004;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const draft = {
      id: -Date.now(),
      type: "expense" as const,
      amount: Number(amount) || 0,
      date,
      account_id: Number(accountId),
      to_account_id: null,
      to_amount: null,
      category_id: bill.category_id,
      person_id: bill.person_id,
      bill_id: bill.id,
      project_id: null,
      note: note.trim() || bill.title,
      created_at: new Date().toISOString(),
    };
    const ok = await run(
      () => api.post(`/api/bills/${bill.id}/payments`, { amount, account_id: accountId, date, note }),
      partial ? `Recorded. ${fmtBill(remaining - paidInBill)} still to pay` : "Paid in full",
      (s) => ({ ...s, transactions: [draft, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id) }),
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet title="Record payment" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="card flat mb">
          <div className="bold">{bill.title}</div>
          <div className="small muted">
            {person ? `${person.name} · ` : ""}
            {fmtBill(bill.amount)} total · <span className="bold">{fmtBill(remaining)} remaining</span>
          </div>
        </div>
        <Field
          label={`Amount paid now (${currency})`}
          className="amount"
          hint={
            partial
              ? `Partial payment. ${fmtBill(remaining - paidInBill)} will remain.`
              : currency !== billCur && Number(amount) > 0
                ? `≈ ${fmtBill(paidInBill)} of the bill`
                : undefined
          }
        >
          <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <div className="grid2">
          <Field label="From account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {payAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Note">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500} />
        </Field>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            Record payment
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function SalaryConfirmForm({ onClose }: { onClose: () => void }) {
  const { state, run } = useData();
  const [amount, setAmount] = useState(state.settings.salary_amount ?? "");
  const [accountId, setAccountId] = useState(
    state.settings.salary_account_id ?? String(state.accounts.find((a) => !a.archived && a.type === "bank")?.id ?? state.accounts[0]?.id ?? ""),
  );
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() => api.post("/api/salary/confirm", { amount, account_id: accountId, date }), "Salary recorded");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet title="Salary arrived" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`Actual amount received (${state.accounts.find((a) => String(a.id) === accountId)?.currency ?? ""})`} className="amount">
          <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <div className="grid2">
          <Field label="Into account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {state.accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type === "savings" ? "💰 " : a.type === "cash" ? "💵 " : "🏦 "}
                    {a.name} ({a.currency})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            Confirm
          </button>
        </div>
      </form>
    </Sheet>
  );
}
