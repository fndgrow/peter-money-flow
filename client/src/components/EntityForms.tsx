import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import type { Account, AccountType, Category, Goal, Person, Project } from "../lib/types";
import { ConfirmDelete, Field, Sheet } from "./ui";

export function AccountForm({ existing, onClose }: { existing?: Account; onClose: () => void }) {
  const { run } = useData();
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<AccountType>(existing?.type ?? "bank");
  const [opening, setOpening] = useState(existing ? String(existing.opening_balance) : "0");
  const [archived, setArchived] = useState(!!existing?.archived);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, type, opening_balance: opening, archived };
    const ok = await run(() => (existing ? api.put(`/api/accounts/${existing.id}`, body) : api.post("/api/accounts", body)), "Saved");
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/accounts/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit account" : "New account"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus placeholder="e.g. Main bank, Wallet, Emergency fund" />
        </Field>
        <div className="grid2">
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              <option value="bank">Bank account</option>
              <option value="cash">Cash</option>
              <option value="savings">Savings</option>
            </select>
          </Field>
          <Field label="Opening balance" hint="Balance before the first transaction you record.">
            <input type="number" inputMode="decimal" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} required />
          </Field>
        </div>
        {existing && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived (hidden from totals and forms)
          </label>
        )}
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function CategoryForm({ existing, kind, onClose }: { existing?: Category; kind: "income" | "expense"; onClose: () => void }) {
  const { run } = useData();
  const [name, setName] = useState(existing?.name ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? "");
  const [archived, setArchived] = useState(!!existing?.archived);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, icon, kind, archived };
    const ok = await run(() => (existing ? api.put(`/api/categories/${existing.id}`, body) : api.post("/api/categories", body)), "Saved");
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/categories/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit category" : `New ${kind} category`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid2" style={{ gridTemplateColumns: "80px 1fr" }}>
          <Field label="Icon">
            <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} placeholder="🙂" style={{ textAlign: "center" }} />
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          </Field>
        </div>
        {existing && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived (hidden when adding new transactions)
          </label>
        )}
        {existing?.system && <div className="banner accent">The app uses this category automatically. You can rename it but not delete it.</div>}
        <div className="form-actions">
          {existing && !existing.system && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function PersonForm({ existing, onClose }: { existing?: Person; onClose: () => void }) {
  const { run } = useData();
  const [name, setName] = useState(existing?.name ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [archived, setArchived] = useState(!!existing?.archived);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, note, archived };
    const ok = await run(() => (existing ? api.put(`/api/people/${existing.id}`, body) : api.post("/api/people", body)), "Saved");
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/people/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit person" : "New person"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
        </Field>
        <Field label="Note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Bank details, what they usually do for you…" />
        </Field>
        {existing && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived (hidden from lists)
          </label>
        )}
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function ProjectForm({ existing, onClose }: { existing?: Project; onClose: () => void }) {
  const { run } = useData();
  const [name, setName] = useState(existing?.name ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [status, setStatus] = useState<"active" | "done">(existing?.status ?? "active");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, note, status };
    const ok = await run(() => (existing ? api.put(`/api/projects/${existing.id}`, body) : api.post("/api/projects", body)), "Saved");
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/projects/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit project" : "New project"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name" hint="Tag income and costs with a project to see its profit.">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus placeholder="e.g. Website for Anna" />
        </Field>
        {existing && (
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "done")}>
              <option value="active">Active</option>
              <option value="done">Done</option>
            </select>
          </Field>
        )}
        <Field label="Note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function GoalForm({ existing, onClose }: { existing?: Goal; onClose: () => void }) {
  const { state, run } = useData();
  const savings = state.accounts.filter((a) => !a.archived && a.type === "savings");
  const [name, setName] = useState(existing?.name ?? "");
  const [target, setTarget] = useState(existing ? String(existing.target_amount) : "");
  const [accountId, setAccountId] = useState(String(existing?.account_id ?? savings[0]?.id ?? ""));
  const [targetDate, setTargetDate] = useState(existing?.target_date ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, target_amount: target, account_id: accountId || null, target_date: targetDate || null, note };
    const ok = await run(() => (existing ? api.put(`/api/goals/${existing.id}`, body) : api.post("/api/goals", body)), "Saved");
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!existing) return;
    const ok = await run(() => api.del(`/api/goals/${existing.id}`), "Deleted");
    if (ok) onClose();
  }

  return (
    <Sheet title={existing ? "Edit goal" : "New savings goal"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Goal">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus placeholder="e.g. Emergency fund, Holiday" />
        </Field>
        <div className="grid2">
          <Field label="Target amount">
            <input type="number" inputMode="decimal" step="0.01" min="0" value={target} onChange={(e) => setTarget(e.target.value)} required />
          </Field>
          <Field label="By (optional)">
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Tracked in account" hint="Progress is the balance of this savings account.">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Not linked</option>
            {state.accounts
              .filter((a) => !a.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <div className="form-actions">
          {existing && <ConfirmDelete onConfirm={remove} />}
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
