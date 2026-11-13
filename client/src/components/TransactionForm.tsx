import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { todayStr } from "../lib/money";
import { CategoryPicker } from "./CategoryPicker";
import type { Transaction, TxType } from "../lib/types";
import { ConfirmDelete, Field, Segmented, Sheet } from "./ui";

interface Props {
  initialType?: TxType;
  existing?: Transaction;
  onClose: () => void;
}

export function TransactionForm({ initialType = "expense", existing, onClose }: Props) {
  const { state, run, refresh, currency: mainCurrency, secondary, fmtIn, conv } = useData();
  const [type, setType] = useState<TxType>(existing?.type ?? initialType);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [date, setDate] = useState(existing?.date ?? todayStr());
  const active = state.accounts.filter((a) => !a.archived);
  // Day-to-day accounts: those in the second currency (e.g. MDL) when one is set up, otherwise all.
  const daily = secondary && active.some((a) => a.currency === secondary.currency) ? active.filter((a) => a.currency === secondary.currency) : active;
  // Income lands on the day-to-day bank account; spending starts there too.
  const incomeAccount = daily.find((a) => a.type === "bank") ?? daily.find((a) => a.type !== "savings");
  // Spending and payments come out of cash by default; income lands in the bank.
  const spendAccount = daily.find((a) => a.type === "cash") ?? daily.find((a) => a.type !== "savings") ?? daily[0];
  const defaultAccount = (initialType === "income" ? incomeAccount : initialType === "expense" ? spendAccount : undefined) ?? active.find((a) => a.type === "bank") ?? active[0];
  const [accountId, setAccountId] = useState(String(existing?.account_id ?? defaultAccount?.id ?? ""));
  const [toAccountId, setToAccountId] = useState(String(existing?.to_account_id ?? ""));
  const [toAmount, setToAmount] = useState(existing?.to_amount != null ? String(existing.to_amount) : "");
  const [categoryId, setCategoryId] = useState(String(existing?.category_id ?? ""));
  const [personId, setPersonId] = useState(String(existing?.person_id ?? ""));
  const [projectId, setProjectId] = useState(String(existing?.project_id ?? ""));
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Income and expenses happen in the day-to-day currency (the second currency, e.g. MDL) when one is set up.
  // Income can land anywhere (bank, cash or savings); expenses come out of bank or cash. Transfers can use any account.
  const dayToDay = secondary && state.accounts.some((a) => !a.archived && a.currency === secondary.currency) ? secondary.currency : null;
  const accounts = state.accounts.filter(
    (a) =>
      (!a.archived || a.id === existing?.account_id || a.id === existing?.to_account_id) &&
      (type === "transfer" || !dayToDay || a.currency === dayToDay || a.id === existing?.account_id) &&
      (type !== "expense" || a.type !== "savings" || a.id === existing?.account_id),
  );
  const people = state.people.filter((p) => !p.archived || p.id === existing?.person_id);
  const projects = state.projects.filter((p) => p.status === "active" || p.id === existing?.project_id);
  const isBillPayment = !!existing?.bill_id;
  // The currency you type in is the currency of the chosen account.
  const currency = state.accounts.find((a) => String(a.id) === accountId)?.currency || mainCurrency;
  const toCurrency = state.accounts.find((a) => String(a.id) === toAccountId)?.currency || currency;
  const crossCurrency = type === "transfer" && toAccountId !== "" && toCurrency !== currency;
  // The "other" currency you may prefer to type in (main or second), converted into the account's currency.
  const otherCurrency = secondary ? (currency === mainCurrency ? secondary.currency : mainCurrency) : null;
  const fmt2 = otherCurrency ? (n: number) => fmtIn(otherCurrency)(conv(n, currency, otherCurrency)) : null;

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
      to_amount: crossCurrency ? toAmount || null : null,
      category_id: type === "transfer" ? null : categoryId || null,
      person_id: type === "transfer" ? null : personId || null,
      project_id: type === "transfer" ? null : projectId || null,
      note,
    };
    // What the saved row will look like, so the screen can update right away.
    const draft: Transaction = {
      id: existing?.id ?? -Date.now(),
      type,
      amount: Number(String(amount).replace(",", ".")) || 0,
      date,
      account_id: Number(accountId),
      to_account_id: type === "transfer" ? Number(toAccountId) || null : null,
      to_amount: crossCurrency ? Number(toAmount) || null : null,
      category_id: type === "transfer" ? null : Number(categoryId) || null,
      person_id: type === "transfer" ? null : Number(personId) || null,
      bill_id: existing?.bill_id ?? null,
      project_id: type === "transfer" ? null : Number(projectId) || null,
      note: note.trim() || null,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
    const sortDesc = (list: Transaction[]) => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const ok = await run(
      () => (existing ? api.put(`/api/transactions/${existing.id}`, body) : api.post("/api/transactions", body)),
      existing ? "Saved" : type === "income" ? "Income added" : type === "expense" ? "Expense added" : "Transfer recorded",
      (s) => ({
        ...s,
        transactions: sortDesc(existing ? s.transactions.map((t) => (t.id === existing.id ? draft : t)) : [draft, ...s.transactions]),
      }),
    );
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!existing) return;
    onClose();
    await run(() => api.del(`/api/transactions/${existing.id}`), "Deleted", (s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== existing.id) }));
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
                if (!existing) {
                  const next = v === "income" ? incomeAccount : v === "expense" ? spendAccount : (active.find((a) => a.type === "bank") ?? active[0]);
                  if (next) setAccountId(String(next.id));
                }
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
        {otherCurrency && !crossCurrency && (
          <Field label={`Or type it in ${otherCurrency}`} hint={`Converted into ${currency} at today's saved rate`}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setAmount(String(Math.round(conv(v, otherCurrency, currency) * 100) / 100));
              }}
            />
          </Field>
        )}
        {crossCurrency && (
          <Field label={`Amount received (${toCurrency})`} hint={`Sent ${fmtIn(currency)(Number(amount) || 0)} from a ${currency} account into a ${toCurrency} account. Enter what actually arrived.`}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={toAmount}
              placeholder={String(Math.round(conv(Number(amount) || 0, currency, toCurrency) * 100) / 100)}
              onChange={(e) => setToAmount(e.target.value)}
            />
          </Field>
        )}

        <div className="grid2">
          <Field label={type === "transfer" ? "From account" : type === "income" ? "Into" : "Paid from"}>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.type === "savings" ? "💰 " : a.type === "cash" ? "💵 " : "🏦 "}
                  {a.name} ({a.currency})
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
                      {a.name} ({a.currency})
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
                <CategoryPicker kind={type} value={categoryId} onChange={setCategoryId} />
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
