import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { billPaidMap, billRemaining, todayStr } from "../lib/money";
import type { Bill, Recurrence } from "../lib/types";
import { ConfirmDelete, Field, Sheet } from "./ui";

export function BillForm({ existing, onClose, presetPersonId }: { existing?: Bill; onClose: () => void; presetPersonId?: number }) {
  const { state, run, refresh } = useData();
  const peopleCat = state.categories.find((c) => c.system === "people");
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
  const categories = state.categories.filter((c) => c.kind === "expense" && (!c.archived || c.id === existing?.category_id));

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
    const body = { title, person_id: personId || null, category_id: categoryId || null, amount, due_date: dueDate, recurrence, note };
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
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </Field>
        </div>
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
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ""}
                  {c.name}
                </option>
              ))}
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
  const { state, run, fmt, fmt2, secondary, currency } = useData();
  const remaining = billRemaining(bill, billPaidMap(state.transactions));
  const defaultAccount = state.accounts.find((a) => !a.archived && a.type === "bank") ?? state.accounts.find((a) => !a.archived);
  const [amount, setAmount] = useState(String(remaining));
  const [accountId, setAccountId] = useState(String(defaultAccount?.id ?? ""));
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const person = state.people.find((p) => p.id === bill.person_id);
  const partial = Number(amount) > 0 && Number(amount) < remaining - 0.004;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(
      () => api.post(`/api/bills/${bill.id}/payments`, { amount, account_id: accountId, date, note }),
      partial ? `Recorded. ${fmt(remaining - Number(amount))} still to pay` : "Paid in full",
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
            {fmt(bill.amount)} total · <span className="bold">{fmt(remaining)} remaining</span>
          </div>
        </div>
        <Field
          label={`Amount paid now (${currency})`}
          className="amount"
          hint={
            partial
              ? `Partial payment. ${fmt(remaining - Number(amount))} will remain.`
              : fmt2 && Number(amount) > 0
                ? `≈ ${fmt2(Number(amount))}`
                : undefined
          }
        >
          <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        {secondary && (
          <Field label={`Or type it in ${secondary.currency}`} hint={`Converted at 1 ${secondary.currency} = ${secondary.rate} ${currency}`}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setAmount(String(Math.round(v * secondary.rate * 100) / 100));
              }}
            />
          </Field>
        )}
        <div className="grid2">
          <Field label="From account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {state.accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
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
        <Field label="Actual amount received" className="amount">
          <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <div className="grid2">
          <Field label="Into account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {state.accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
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
