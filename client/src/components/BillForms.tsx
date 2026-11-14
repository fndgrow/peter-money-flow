import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { billPaidMap, billRemaining, todayStr } from "../lib/money";
import { CategoryPicker } from "./CategoryPicker";
import type { Bill, Recurrence } from "../lib/types";
import { ConfirmDelete, Field, Sheet } from "./ui";

/**
 * Schedule a payment. direction "out": something I have to pay (a bill, money I owe someone).
 * direction "in": something someone owes me, which I expect to receive.
 */
export function BillForm({
  existing,
  onClose,
  presetPersonId,
  direction: directionProp,
}: {
  existing?: Bill;
  onClose: () => void;
  presetPersonId?: number;
  direction?: "out" | "in";
}) {
  const { state, run, refresh, currencies, currency: mainCurrency } = useData();
  const direction = existing?.direction ?? directionProp ?? "out";
  const incoming = direction === "in";
  const defaultCat = state.categories.find((c) => c.system === (incoming ? "people_in" : "people"));
  const [currency, setCurrency] = useState(existing?.currency ?? mainCurrency);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [personId, setPersonId] = useState(String(existing?.person_id ?? presetPersonId ?? ""));
  // For "in" records the debtor can be a person or a company; encoded as "p:<id>" / "c:<id>" in one select.
  const [debtor, setDebtor] = useState(existing?.project_id ? `c:${existing.project_id}` : existing?.person_id ?? presetPersonId ? `p:${existing?.person_id ?? presetPersonId}` : "");
  const companies = state.projects.filter((p) => p.status === "active" || p.id === existing?.project_id);
  const [categoryId, setCategoryId] = useState(String(existing?.category_id ?? defaultCat?.id ?? ""));
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
      setDebtor(`p:${r.id}`);
      if (!title) setTitle(name.trim());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addCompany() {
    const name = window.prompt("Company name");
    if (!name?.trim()) return;
    try {
      const r = await api.post<{ id: number }>("/api/projects", { name: name.trim() });
      await refresh();
      setDebtor(`c:${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const who = incoming
      ? { person_id: debtor.startsWith("p:") ? debtor.slice(2) : null, project_id: debtor.startsWith("c:") ? debtor.slice(2) : null }
      : { person_id: personId || null, project_id: null };
    const body = { title, ...who, category_id: categoryId || null, amount, currency, due_date: dueDate, recurrence: incoming ? "none" : recurrence, note, direction };
    const ok = await run(
      () => (existing ? api.put(`/api/bills/${existing.id}`, body) : api.post("/api/bills", body)),
      existing ? "Saved" : incoming ? "Recorded. It shows under Owed to me." : "Payment scheduled",
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
    <Sheet title={existing ? (incoming ? "Edit what they owe me" : "Edit scheduled payment") : incoming ? "Someone owes me" : "Schedule a payment"} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <Field label={incoming ? "What for?" : "What is it for?"}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={incoming ? "e.g. Website, Video editing, Loan" : "e.g. Rent, Car repair, Loan to Dan"}
            required
            maxLength={120}
            autoFocus
          />
        </Field>
        {incoming ? (
          <Field label="Who owes me" hint="A person or one of your companies.">
            <div className="flex">
              <select value={debtor} onChange={(e) => setDebtor(e.target.value)} style={{ flex: 1 }} required>
                <option value="">Choose…</option>
                <optgroup label="Companies">
                  {companies.map((c) => (
                    <option key={`c:${c.id}`} value={`c:${c.id}`}>
                      🏢 {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="People">
                  {people.map((p) => (
                    <option key={`p:${p.id}`} value={`p:${p.id}`}>
                      👤 {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <button type="button" className="btn sm" onClick={addCompany} title="New company">
                + 🏢
              </button>
              <button type="button" className="btn sm" onClick={addPerson} title="New person">
                + 👤
              </button>
            </div>
          </Field>
        ) : (
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
        )}
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
        <Field label={incoming ? "Expected by" : "Due date"}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
        {incoming ? (
          <Field label="Income category" hint="Where the money shows up in your income once they pay.">
            <CategoryPicker kind="income" value={categoryId} onChange={setCategoryId} allowNone={false} />
          </Field>
        ) : (
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
              <CategoryPicker kind="expense" value={categoryId} onChange={setCategoryId} allowNone={false} />
            </Field>
          </div>
        )}
        <Field label="Note">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500} />
        </Field>
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            {existing ? "Save" : incoming ? "Add" : "Schedule"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Record money moving against a bill. For "out" bills this is a payment I make (an expense).
 * For "in" bills it is money someone paid me (an income); the account must be chosen explicitly
 * so it is clear whether it arrived in cash or in the bank.
 */
export function PayBillForm({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { state, run, fmtIn, conv, currency: mainCurrency, secondary } = useData();
  const incoming = bill.direction === "in";
  const remaining = billRemaining(bill, billPaidMap(state));
  const billCur = bill.currency || mainCurrency;
  const fmtBill = fmtIn(billCur);
  // Payments go out of (or come into) day-to-day accounts (the second currency, e.g. MDL) when those exist.
  const active = state.accounts.filter((a) => !a.archived);
  const payAccounts = secondary && active.some((a) => a.currency === secondary.currency) ? active.filter((a) => a.currency === secondary.currency) : active;
  const defaultAccount = incoming ? undefined : (payAccounts.find((a) => a.type === "cash") ?? payAccounts.find((a) => a.type !== "savings") ?? payAccounts[0]);
  const [accountId, setAccountId] = useState(String(defaultAccount?.id ?? ""));
  const account = state.accounts.find((a) => String(a.id) === accountId);
  const currency = account?.currency || billCur;
  const [amount, setAmount] = useState(String(Math.round(conv(remaining, billCur, defaultAccount?.currency || billCur) * 100) / 100));
  const fmt = fmtIn(currency);
  // What this payment is worth in the bill's currency.
  const paidInBill = conv(Number(amount) || 0, currency, billCur);
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const person = state.people.find((p) => p.id === bill.person_id) ?? state.projects.find((p) => p.id === bill.project_id);
  const partial = paidInBill > 0 && paidInBill < remaining - 0.004;

  function chooseAccount(id: string) {
    const prevCur = currency;
    setAccountId(id);
    const nextCur = state.accounts.find((a) => String(a.id) === id)?.currency || billCur;
    if (nextCur !== prevCur) setAmount(String(Math.round(conv(Number(amount) || 0, prevCur, nextCur) * 100) / 100));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    setBusy(true);
    const draft = {
      id: -Date.now(),
      type: incoming ? ("income" as const) : ("expense" as const),
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
      partial
        ? `Recorded. ${fmtBill(remaining - paidInBill)} still ${incoming ? "to come" : "to pay"}`
        : incoming
          ? `Done. ${person?.name ?? "They"} paid in full.`
          : "Paid in full",
      (s) => ({ ...s, transactions: [draft, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id) }),
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet title={incoming ? "They paid me" : "Record payment"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="card flat mb">
          <div className="bold">{bill.title}</div>
          <div className="small muted">
            {person ? `${person.name} · ` : ""}
            {fmtBill(bill.amount)} total · <span className="bold">{fmtBill(remaining)} {incoming ? "still owed to me" : "remaining"}</span>
          </div>
        </div>
        <Field
          label={`${incoming ? "Amount received now" : "Amount paid now"} (${currency})`}
          className="amount"
          hint={
            partial
              ? `Partial. ${fmtBill(remaining - paidInBill)} will remain.`
              : currency !== billCur && Number(amount) > 0
                ? `≈ ${fmtBill(paidInBill)} of the ${incoming ? "debt" : "bill"}`
                : undefined
          }
        >
          <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
        </Field>
        <div className="grid2">
          <Field label={incoming ? "How did they pay?" : "From account"} hint={incoming && !accountId ? "Choose cash or bank to be able to mark it done." : undefined}>
            <select value={accountId} onChange={(e) => chooseAccount(e.target.value)} required>
              {incoming && <option value="">Choose…</option>}
              {payAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.type === "cash" ? "💵" : a.type === "savings" ? "💰" : "🏦"} {a.name} ({a.currency})
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
          <button className="btn primary" type="submit" disabled={busy || !accountId}>
            {incoming ? (partial ? "Record what they paid" : "Mark as done") : "Record payment"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
