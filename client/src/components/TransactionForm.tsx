import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { todayStr } from "../lib/money";
import type { Transaction, TxType } from "../lib/types";
import { ConfirmDelete, Field, Segmented, Sheet } from "./ui";

interface Props {
  initialType?: TxType;
  existing?: Transaction;
  onClose: () => void;
}

export function TransactionForm({ initialType = "expense", existing, onClose }: Props) {
  const { state, run, refresh, currency, fmt2, secondary } = useData();
  const [type, setType] = useState<TxType>(existing?.type ?? initialType);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing?.date ?? todayStr());
  const defaultAccount = state.accounts.find((a) => !a.archived && a.type === "bank") ?? state.accounts.find((a) => !a.archived);
  const [accountId, setAccountId] = useState(String(existing?.account_id ?? defaultAccount?.id ?? ""));
  const [toAccountId, setToAccountId] = useState(String(existing?.to_account_id ?? ""));
  const [categoryId, setCategoryId] = useState(String(existing?.category_id ?? ""));
  const [personId, setPersonId] = useState(String(existing?.person_id ?? ""));
  const [projectId, setProjectId] = useState(String(existing?.project_id ?? ""));
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const accounts = state.accounts.filter((a) => !a.archived || a.id === existing?.account_id || a.id === existing?.to_account_id);
  const categories = state.categories.filter((c) => c.kind === type && (!c.archived || c.id === existing?.category_id));
  const people = state.people.filter((p) => !p.archived || p.id === existing?.person_id);
  const projects = state.projects.filter((p) => p.status === "active" || p.id === existing?.project_id);
  const isBillPayment = !!existing?.bill_id;

  async function addPerson() {
    const name = window.prompt("Person's name");
    if (!name?.trim()) return;
    try {
      const r = await api.post<{ id: number }>("/api/people", { name: name.trim() });
      await refresh();
      setPersonId(String(r.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addCategory() {
    const name = window.prompt(`New ${type} category name`);
    if (!name?.trim()) return;
    try {
      const r = await api.post<{ id: number }>("/api/categories", { name: name.trim(), kind: type });
      await refresh();
      setCategoryId(String(r.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = {
      type,
      amount,
      date,
      account_id: accountId,
      to_account_id: type === "transfer" ? toAccountId : null,
      category_id: type === "transfer" ? null : categoryId || null,
      person_id: type === "transfer" ? null : personId || null,
      project_id: type === "transfer" ? null : projectId || null,
      note,
    };
    const ok = await run(
      () => (existing ? api.put(`/api/transactions/${existing.id}`, body) : api.post("/api/transactions", body)),
      existing ? "Saved" : type === "income" ? "Income added" : type === "expense" ? "Expense added" : "Transfer recorded",
    );
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/transactions/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  const title = existing ? "Edit transaction" : type === "income" ? "Add income" : type === "expense" ? "Add expense" : "Transfer";

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {!isBillPayment && (
          <div className="mb">
            <Segmented
              value={type}
              onChange={(v) => {
                setType(v);
                setCategoryId("");
              }}
              options={[
                { value: "expense", label: "Expense", cls: "out" },
                { value: "income", label: "Income", cls: "in" },
                { value: "transfer", label: "Transfer" },
              ]}
            />
          </div>
        )}
        {isBillPayment && <div className="banner accent">This is a payment toward a scheduled bill. Amount changes update what is still owed.</div>}
        {error && <div className="form-error">{error}</div>}

        <Field label={`Amount (${currency})`} className="amount" hint={fmt2 && Number(amount) > 0 ? `≈ ${fmt2(Number(amount))}` : undefined}>
          <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
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
          <Field label={type === "transfer" ? "From account" : type === "income" ? "Into account" : "From account"}>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {type === "transfer" ? (
            <Field label="To account">
              <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
                <option value="">Choose…</option>
                {accounts
                  .filter((a) => String(a.id) !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          )}
        </div>
        {type === "transfer" && (
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        )}

        {type !== "transfer" && (
          <>
            <Field label="Category">
              <div className="flex">
                <select className="grow" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ flex: 1 }}>
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn sm" onClick={addCategory} title="New category">
                  +
                </button>
              </div>
            </Field>
            <div className="grid2">
              <Field label={type === "expense" ? "Paid to (person)" : "Received from (person)"}>
                <div className="flex">
                  <select value={personId} onChange={(e) => setPersonId(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Nobody in particular</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn sm" onClick={addPerson} title="New person">
                    +
                  </button>
                </div>
              </Field>
              <Field label="Project (optional)">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">None</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}

        <Field label="Note">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500} />
        </Field>

        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            {existing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
