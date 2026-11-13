import { Router } from "express";
import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import { db, allSettings, setSetting, nowIso } from "./db.js";
import {
  hasUser,
  createUser,
  changePassword,
  verifyPassword,
  issueSession,
  clearSession,
  isAuthed,
  requireAuth,
  loginLimiter,
  noteFailedLogin,
  clearFailedLogins,
} from "./auth.js";

export const api = Router();

// ---------- helpers ----------

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function num(v: unknown, field: string, opts: { min?: number; allowNull?: boolean } = {}): number | null {
  if (v === null || v === undefined || v === "") {
    if (opts.allowNull) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${field} must be at least ${opts.min}`);
  return Math.round(n * 100) / 100;
}

function id(v: unknown, field: string, allowNull = false): number | null {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0") {
    if (allowNull) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${field} is invalid`);
  return n;
}

function str(v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | null {
  if (v === null || v === undefined) {
    if (opts.required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const s = String(v).trim();
  if (!s) {
    if (opts.required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (opts.max && s.length > opts.max) throw new HttpError(400, `${field} is too long`);
  return s;
}

function dateStr(v: unknown, field: string, required = true): string | null {
  if (v === null || v === undefined || v === "") {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

function oneOf<T extends string>(v: unknown, field: string, values: readonly T[], fallback?: T): T {
  if ((v === null || v === undefined || v === "") && fallback !== undefined) return fallback;
  if (!values.includes(v as T)) throw new HttpError(400, `${field} must be one of ${values.join(", ")}`);
  return v as T;
}

function exists(table: string, rowId: number | null, label: string) {
  if (rowId === null) return;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(rowId);
  if (!row) throw new HttpError(400, `${label} not found`);
}

function wrap(fn: (req: Request, res: Response) => unknown) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: unknown) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: "Something went wrong" });
    }
  };
}

function addRecurrence(date: string, recurrence: string): string {
  const d = new Date(date + "T00:00:00Z");
  if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === "monthly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else if (recurrence === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function categoryKind(categoryId: number | null): string | null {
  if (categoryId === null) return null;
  const row = db.prepare("SELECT kind FROM categories WHERE id = ?").get(categoryId) as { kind: string } | undefined;
  if (!row) throw new HttpError(400, "Category not found");
  return row.kind;
}

function systemCategory(system: string): number | null {
  const row = db.prepare("SELECT id FROM categories WHERE system = ?").get(system) as { id: number } | undefined;
  return row ? row.id : null;
}

function billPaid(billId: number): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM transactions WHERE bill_id = ?").get(billId) as {
    paid: number;
  };
  return row.paid;
}

/** After a payment is added/removed: close or reopen the bill, spawn next recurrence when fully paid. */
function syncBillStatus(billId: number) {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId) as Record<string, unknown> | undefined;
  if (!bill) return;
  const paid = billPaid(billId);
  const amount = bill.amount as number;
  const status = bill.status as string;
  if (status === "cancelled") return;
  if (paid >= amount - 0.004 && status === "open") {
    db.prepare("UPDATE bills SET status = 'paid' WHERE id = ?").run(billId);
    const recurrence = bill.recurrence as string;
    if (recurrence !== "none") {
      db.prepare(
        `INSERT INTO bills (title, person_id, category_id, amount, due_date, recurrence, status, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      ).run(
        bill.title as string,
        bill.person_id as number | null,
        bill.category_id as number | null,
        amount,
        addRecurrence(bill.due_date as string, recurrence),
        recurrence,
        bill.note as string | null,
        nowIso(),
      );
    }
  } else if (paid < amount - 0.004 && status === "paid") {
    db.prepare("UPDATE bills SET status = 'open' WHERE id = ?").run(billId);
  }
}

// ---------- auth ----------

api.get("/me", (req, res) => {
  res.json({ setup: hasUser(), authed: isAuthed(req) });
});

api.post(
  "/setup",
  wrap((req, res) => {
    if (hasUser()) throw new HttpError(400, "Already set up");
    const password = str(req.body?.password, "Password", { required: true }) as string;
    if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
    createUser(password);
    issueSession(res);
    res.json({ ok: true });
  }),
);

api.post(
  "/login",
  loginLimiter,
  wrap((req, res) => {
    const password = String(req.body?.password ?? "");
    if (!verifyPassword(password)) {
      noteFailedLogin(req);
      throw new HttpError(401, "Wrong password");
    }
    clearFailedLogins(req);
    issueSession(res);
    res.json({ ok: true });
  }),
);

api.post("/logout", (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

api.post(
  "/password",
  requireAuth,
  wrap((req, res) => {
    const current = String(req.body?.current ?? "");
    const next = str(req.body?.next, "New password", { required: true }) as string;
    if (!verifyPassword(current)) throw new HttpError(400, "Current password is wrong");
    if (next.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
    changePassword(next);
    issueSession(res);
    res.json({ ok: true });
  }),
);

// Everything below requires a session.
api.use(requireAuth);

// ---------- state ----------

api.get("/state", (_req, res) => {
  res.json({
    settings: allSettings(),
    accounts: db.prepare("SELECT * FROM accounts ORDER BY sort, id").all(),
    categories: db.prepare("SELECT * FROM categories ORDER BY kind, sort, id").all(),
    people: db.prepare("SELECT * FROM people ORDER BY name COLLATE NOCASE").all(),
    projects: db.prepare("SELECT * FROM projects ORDER BY status, name COLLATE NOCASE").all(),
    bills: db.prepare("SELECT * FROM bills ORDER BY due_date, id").all(),
    goals: db.prepare("SELECT * FROM goals ORDER BY id").all(),
    transactions: db.prepare("SELECT * FROM transactions ORDER BY date DESC, id DESC").all(),
  });
});

// ---------- settings ----------

const SETTING_KEYS = [
  "currency",
  "locale",
  "salary_amount",
  "salary_payday",
  "salary_account_id",
  "owner_name",
] as const;

api.put(
  "/settings",
  wrap((req, res) => {
    const body = req.body ?? {};
    for (const key of SETTING_KEYS) {
      if (!(key in body)) continue;
      let value = body[key];
      if (key === "salary_amount" && value !== "" && value !== null) value = num(value, "Salary amount", { min: 0 });
      if (key === "salary_payday" && value !== "" && value !== null) {
        const d = Number(value);
        if (!Number.isInteger(d) || d < 1 || d > 31) throw new HttpError(400, "Payday must be 1-31");
      }
      if (key === "salary_account_id" && value !== "" && value !== null) exists("accounts", id(value, "Account"), "Account");
      setSetting(key, value === null || value === undefined ? null : String(value));
    }
    res.json(allSettings());
  }),
);

// ---------- accounts ----------

api.post(
  "/accounts",
  wrap((req, res) => {
    const name = str(req.body?.name, "Name", { required: true, max: 60 });
    const type = oneOf(req.body?.type, "Type", ["cash", "bank", "savings"] as const);
    const opening = num(req.body?.opening_balance, "Opening balance") ?? 0;
    const r = db
      .prepare("INSERT INTO accounts (name, type, opening_balance, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM accounts))")
      .run(name, type, opening);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/accounts/:id",
  wrap((req, res) => {
    const accId = id(req.params.id, "Account") as number;
    exists("accounts", accId, "Account");
    const name = str(req.body?.name, "Name", { required: true, max: 60 });
    const type = oneOf(req.body?.type, "Type", ["cash", "bank", "savings"] as const);
    const opening = num(req.body?.opening_balance, "Opening balance") ?? 0;
    const archived = req.body?.archived ? 1 : 0;
    db.prepare("UPDATE accounts SET name = ?, type = ?, opening_balance = ?, archived = ? WHERE id = ?").run(
      name,
      type,
      opening,
      archived,
      accId,
    );
    res.json({ ok: true });
  }),
);

api.delete(
  "/accounts/:id",
  wrap((req, res) => {
    const accId = id(req.params.id, "Account") as number;
    const used = db
      .prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?")
      .get(accId, accId) as { n: number };
    if (used.n > 0) throw new HttpError(400, "This account has transactions. Archive it instead.");
    db.prepare("DELETE FROM accounts WHERE id = ?").run(accId);
    res.json({ ok: true });
  }),
);

// ---------- categories ----------

api.post(
  "/categories",
  wrap((req, res) => {
    const name = str(req.body?.name, "Name", { required: true, max: 60 });
    const kind = oneOf(req.body?.kind, "Kind", ["income", "expense"] as const);
    const icon = str(req.body?.icon, "Icon", { max: 8 });
    const r = db
      .prepare(
        "INSERT INTO categories (name, kind, icon, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM categories WHERE kind = ?))",
      )
      .run(name, kind, icon, kind);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/categories/:id",
  wrap((req, res) => {
    const catId = id(req.params.id, "Category") as number;
    exists("categories", catId, "Category");
    const name = str(req.body?.name, "Name", { required: true, max: 60 });
    const icon = str(req.body?.icon, "Icon", { max: 8 });
    const archived = req.body?.archived ? 1 : 0;
    db.prepare("UPDATE categories SET name = ?, icon = ?, archived = ? WHERE id = ?").run(name, icon, archived, catId);
    res.json({ ok: true });
  }),
);

api.delete(
  "/categories/:id",
  wrap((req, res) => {
    const catId = id(req.params.id, "Category") as number;
    const row = db.prepare("SELECT system FROM categories WHERE id = ?").get(catId) as { system: string | null } | undefined;
    if (!row) throw new HttpError(404, "Category not found");
    if (row.system) throw new HttpError(400, "This category is used by the app and cannot be deleted. You can rename it.");
    const used = db
      .prepare("SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?) + (SELECT COUNT(*) FROM bills WHERE category_id = ?) AS n")
      .get(catId, catId) as { n: number };
    if (used.n > 0) throw new HttpError(400, "This category is in use. Archive it instead.");
    db.prepare("DELETE FROM categories WHERE id = ?").run(catId);
    res.json({ ok: true });
  }),
);

// ---------- people ----------

api.post(
  "/people",
  wrap((req, res) => {
    const name = str(req.body?.name, "Name", { required: true, max: 80 });
    const note = str(req.body?.note, "Note", { max: 500 });
    const r = db.prepare("INSERT INTO people (name, note) VALUES (?, ?)").run(name, note);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/people/:id",
  wrap((req, res) => {
    const pid = id(req.params.id, "Person") as number;
    exists("people", pid, "Person");
    const name = str(req.body?.name, "Name", { required: true, max: 80 });
    const note = str(req.body?.note, "Note", { max: 500 });
    const archived = req.body?.archived ? 1 : 0;
    db.prepare("UPDATE people SET name = ?, note = ?, archived = ? WHERE id = ?").run(name, note, archived, pid);
    res.json({ ok: true });
  }),
);

api.delete(
  "/people/:id",
  wrap((req, res) => {
    const pid = id(req.params.id, "Person") as number;
    const used = db
      .prepare("SELECT (SELECT COUNT(*) FROM transactions WHERE person_id = ?) + (SELECT COUNT(*) FROM bills WHERE person_id = ?) AS n")
      .get(pid, pid) as { n: number };
    if (used.n > 0) throw new HttpError(400, "This person has payments. Archive them instead.");
    db.prepare("DELETE FROM people WHERE id = ?").run(pid);
    res.json({ ok: true });
  }),
);

// ---------- projects ----------

api.post(
  "/projects",
  wrap((req, res) => {
    const name = str(req.body?.name, "Name", { required: true, max: 80 });
    const note = str(req.body?.note, "Note", { max: 500 });
    const r = db.prepare("INSERT INTO projects (name, note) VALUES (?, ?)").run(name, note);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/projects/:id",
  wrap((req, res) => {
    const pid = id(req.params.id, "Project") as number;
    exists("projects", pid, "Project");
    const name = str(req.body?.name, "Name", { required: true, max: 80 });
    const note = str(req.body?.note, "Note", { max: 500 });
    const status = oneOf(req.body?.status, "Status", ["active", "done"] as const, "active");
    db.prepare("UPDATE projects SET name = ?, note = ?, status = ? WHERE id = ?").run(name, note, status, pid);
    res.json({ ok: true });
  }),
);

api.delete(
  "/projects/:id",
  wrap((req, res) => {
    const pid = id(req.params.id, "Project") as number;
    db.prepare("DELETE FROM projects WHERE id = ?").run(pid);
    res.json({ ok: true });
  }),
);

// ---------- goals ----------

api.post(
  "/goals",
  wrap((req, res) => {
    const name = str(req.body?.name, "Name", { required: true, max: 80 });
    const target = num(req.body?.target_amount, "Target amount", { min: 0.01 });
    const accountId = id(req.body?.account_id, "Account", true);
    exists("accounts", accountId, "Account");
    const targetDate = dateStr(req.body?.target_date, "Target date", false);
    const note = str(req.body?.note, "Note", { max: 500 });
    const r = db
      .prepare("INSERT INTO goals (name, target_amount, account_id, target_date, note) VALUES (?, ?, ?, ?, ?)")
      .run(name, target, accountId, targetDate, note);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/goals/:id",
  wrap((req, res) => {
    const gid = id(req.params.id, "Goal") as number;
    exists("goals", gid, "Goal");
    const name = str(req.body?.name, "Name", { required: true, max: 80 });
    const target = num(req.body?.target_amount, "Target amount", { min: 0.01 });
    const accountId = id(req.body?.account_id, "Account", true);
    exists("accounts", accountId, "Account");
    const targetDate = dateStr(req.body?.target_date, "Target date", false);
    const note = str(req.body?.note, "Note", { max: 500 });
    db.prepare("UPDATE goals SET name = ?, target_amount = ?, account_id = ?, target_date = ?, note = ? WHERE id = ?").run(
      name,
      target,
      accountId,
      targetDate,
      note,
      gid,
    );
    res.json({ ok: true });
  }),
);

api.delete(
  "/goals/:id",
  wrap((req, res) => {
    db.prepare("DELETE FROM goals WHERE id = ?").run(id(req.params.id, "Goal") as number);
    res.json({ ok: true });
  }),
);

// ---------- bills (payments to people & scheduled bills) ----------

function readBill(body: Record<string, unknown>) {
  const title = str(body.title, "Title", { required: true, max: 120 }) as string;
  const personId = id(body.person_id, "Person", true);
  exists("people", personId, "Person");
  let categoryId = id(body.category_id, "Category", true);
  if (categoryId !== null && categoryKind(categoryId) !== "expense") throw new HttpError(400, "Category must be an expense category");
  if (categoryId === null) categoryId = systemCategory("people");
  const amount = num(body.amount, "Amount", { min: 0.01 }) as number;
  const dueDate = dateStr(body.due_date, "Due date") as string;
  const recurrence = oneOf(body.recurrence, "Repeat", ["none", "weekly", "monthly", "yearly"] as const, "none");
  const note = str(body.note, "Note", { max: 500 });
  return { title, personId, categoryId, amount, dueDate, recurrence, note };
}

api.post(
  "/bills",
  wrap((req, res) => {
    const b = readBill(req.body ?? {});
    const r = db
      .prepare(
        `INSERT INTO bills (title, person_id, category_id, amount, due_date, recurrence, status, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(b.title, b.personId, b.categoryId, b.amount, b.dueDate, b.recurrence, b.note, nowIso());
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/bills/:id",
  wrap((req, res) => {
    const bid = id(req.params.id, "Bill") as number;
    exists("bills", bid, "Bill");
    const b = readBill(req.body ?? {});
    db.prepare(
      "UPDATE bills SET title = ?, person_id = ?, category_id = ?, amount = ?, due_date = ?, recurrence = ?, note = ? WHERE id = ?",
    ).run(b.title, b.personId, b.categoryId, b.amount, b.dueDate, b.recurrence, b.note, bid);
    syncBillStatus(bid);
    res.json({ ok: true });
  }),
);

api.post(
  "/bills/:id/status",
  wrap((req, res) => {
    const bid = id(req.params.id, "Bill") as number;
    exists("bills", bid, "Bill");
    const status = oneOf(req.body?.status, "Status", ["open", "cancelled"] as const);
    db.prepare("UPDATE bills SET status = ? WHERE id = ?").run(status, bid);
    if (status === "open") syncBillStatus(bid);
    res.json({ ok: true });
  }),
);

api.post(
  "/bills/:id/skip",
  wrap((req, res) => {
    // Skip this occurrence of a recurring bill: cancel it and create the next one.
    const bid = id(req.params.id, "Bill") as number;
    const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(bid) as Record<string, unknown> | undefined;
    if (!bill) throw new HttpError(404, "Bill not found");
    if (bill.recurrence === "none") throw new HttpError(400, "This payment does not repeat");
    db.prepare("UPDATE bills SET status = 'cancelled' WHERE id = ?").run(bid);
    db.prepare(
      `INSERT INTO bills (title, person_id, category_id, amount, due_date, recurrence, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(
      bill.title as string,
      bill.person_id as number | null,
      bill.category_id as number | null,
      bill.amount as number,
      addRecurrence(bill.due_date as string, bill.recurrence as string),
      bill.recurrence as string,
      bill.note as string | null,
      nowIso(),
    );
    res.json({ ok: true });
  }),
);

api.delete(
  "/bills/:id",
  wrap((req, res) => {
    const bid = id(req.params.id, "Bill") as number;
    db.prepare("UPDATE transactions SET bill_id = NULL WHERE bill_id = ?").run(bid);
    db.prepare("DELETE FROM bills WHERE id = ?").run(bid);
    res.json({ ok: true });
  }),
);

/** Record a (partial) payment toward a bill. Creates the expense transaction. */
api.post(
  "/bills/:id/payments",
  wrap((req, res) => {
    const bid = id(req.params.id, "Bill") as number;
    const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(bid) as Record<string, unknown> | undefined;
    if (!bill) throw new HttpError(404, "Bill not found");
    if (bill.status === "cancelled") throw new HttpError(400, "This payment was cancelled");
    const amount = num(req.body?.amount, "Amount", { min: 0.01 }) as number;
    const accountId = id(req.body?.account_id, "Account") as number;
    exists("accounts", accountId, "Account");
    const date = dateStr(req.body?.date, "Date") as string;
    const note = str(req.body?.note, "Note", { max: 500 });
    const categoryId = (bill.category_id as number | null) ?? systemCategory("people");
    const r = db
      .prepare(
        `INSERT INTO transactions (type, amount, date, account_id, category_id, person_id, bill_id, note, created_at)
         VALUES ('expense', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(amount, date, accountId, categoryId, bill.person_id as number | null, bid, note ?? (bill.title as string), nowIso());
    syncBillStatus(bid);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

// ---------- transactions ----------

function readTransaction(body: Record<string, unknown>) {
  const type = oneOf(body.type, "Type", ["income", "expense", "transfer"] as const);
  const amount = num(body.amount, "Amount", { min: 0.01 }) as number;
  const date = dateStr(body.date, "Date") as string;
  const accountId = id(body.account_id, "Account") as number;
  exists("accounts", accountId, "Account");
  let toAccountId: number | null = null;
  let categoryId: number | null = null;
  let personId: number | null = null;
  let projectId: number | null = null;
  if (type === "transfer") {
    toAccountId = id(body.to_account_id, "Destination account") as number;
    exists("accounts", toAccountId, "Destination account");
    if (toAccountId === accountId) throw new HttpError(400, "Choose two different accounts");
  } else {
    categoryId = id(body.category_id, "Category", true);
    const kind = categoryKind(categoryId);
    if (kind && kind !== type) throw new HttpError(400, `Category must be an ${type} category`);
    personId = id(body.person_id, "Person", true);
    exists("people", personId, "Person");
    projectId = id(body.project_id, "Project", true);
    exists("projects", projectId, "Project");
  }
  const note = str(body.note, "Note", { max: 500 });
  return { type, amount, date, accountId, toAccountId, categoryId, personId, projectId, note };
}

api.post(
  "/transactions",
  wrap((req, res) => {
    const t = readTransaction(req.body ?? {});
    const r = db
      .prepare(
        `INSERT INTO transactions (type, amount, date, account_id, to_account_id, category_id, person_id, project_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.type, t.amount, t.date, t.accountId, t.toAccountId, t.categoryId, t.personId, t.projectId, t.note, nowIso());
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

api.put(
  "/transactions/:id",
  wrap((req, res) => {
    const tid = id(req.params.id, "Transaction") as number;
    const existing = db.prepare("SELECT bill_id FROM transactions WHERE id = ?").get(tid) as { bill_id: number | null } | undefined;
    if (!existing) throw new HttpError(404, "Transaction not found");
    const t = readTransaction(req.body ?? {});
    if (existing.bill_id && t.type !== "expense") throw new HttpError(400, "A bill payment must stay an expense");
    db.prepare(
      `UPDATE transactions SET type = ?, amount = ?, date = ?, account_id = ?, to_account_id = ?, category_id = ?, person_id = ?, project_id = ?, note = ?
       WHERE id = ?`,
    ).run(t.type, t.amount, t.date, t.accountId, t.toAccountId, t.categoryId, t.personId, t.projectId, t.note, tid);
    if (existing.bill_id) syncBillStatus(existing.bill_id);
    res.json({ ok: true });
  }),
);

api.delete(
  "/transactions/:id",
  wrap((req, res) => {
    const tid = id(req.params.id, "Transaction") as number;
    const existing = db.prepare("SELECT bill_id FROM transactions WHERE id = ?").get(tid) as { bill_id: number | null } | undefined;
    if (!existing) throw new HttpError(404, "Transaction not found");
    db.prepare("DELETE FROM transactions WHERE id = ?").run(tid);
    if (existing.bill_id) syncBillStatus(existing.bill_id);
    res.json({ ok: true });
  }),
);

/** Confirm this month's salary arrived: creates the income transaction. */
api.post(
  "/salary/confirm",
  wrap((req, res) => {
    const amount = num(req.body?.amount, "Amount", { min: 0.01 }) as number;
    const date = dateStr(req.body?.date, "Date") as string;
    const accountId = id(req.body?.account_id, "Account") as number;
    exists("accounts", accountId, "Account");
    const categoryId = systemCategory("salary");
    const r = db
      .prepare(
        `INSERT INTO transactions (type, amount, date, account_id, category_id, note, created_at)
         VALUES ('income', ?, ?, ?, ?, 'Salary', ?)`,
      )
      .run(amount, date, accountId, categoryId, nowIso());
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

// ---------- backup / restore ----------

const TABLES = ["settings", "accounts", "categories", "people", "projects", "bills", "goals", "transactions"] as const;

api.get("/backup", (_req, res) => {
  const out: Record<string, unknown> = { version: 1, exported_at: nowIso() };
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  res.setHeader("Content-Disposition", `attachment; filename="money-flow-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
});

api.post(
  "/restore",
  wrap((req, res) => {
    const data = req.body as Record<string, unknown>;
    if (!data || data.version !== 1) throw new HttpError(400, "Not a valid backup file");
    db.exec("BEGIN");
    try {
      db.exec("PRAGMA foreign_keys = OFF");
      for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        const rows = (data[t] as Record<string, unknown>[]) || [];
        for (const row of rows) {
          const cols = Object.keys(row);
          db.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
            ...cols.map((c) => row[c] as string | number | null),
          );
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    res.json({ ok: true });
  }),
);

// ---------- Excel export ----------

api.get(
  "/export.xlsx",
  wrap(async (req, res) => {
    const settings = allSettings();
    const currency = settings.currency || "EUR";
    const accounts = db.prepare("SELECT * FROM accounts").all() as Record<string, unknown>[];
    const categories = db.prepare("SELECT * FROM categories").all() as Record<string, unknown>[];
    const people = db.prepare("SELECT * FROM people").all() as Record<string, unknown>[];
    const projects = db.prepare("SELECT * FROM projects").all() as Record<string, unknown>[];
    const bills = db.prepare("SELECT * FROM bills ORDER BY due_date").all() as Record<string, unknown>[];
    const txs = db.prepare("SELECT * FROM transactions ORDER BY date, id").all() as Record<string, unknown>[];
    const name = (list: Record<string, unknown>[], rowId: unknown) =>
      rowId ? ((list.find((x) => x.id === rowId)?.name as string) ?? "") : "";

    const wb = new ExcelJS.Workbook();
    wb.creator = "Peter Money Flow";
    const money = `#,##0.00 "${currency}"`;

    const ws = wb.addWorksheet("Transactions");
    ws.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Type", key: "type", width: 10 },
      { header: "Amount", key: "amount", width: 14, style: { numFmt: money } },
      { header: "Account", key: "account", width: 18 },
      { header: "To account", key: "to", width: 18 },
      { header: "Category", key: "category", width: 20 },
      { header: "Person", key: "person", width: 18 },
      { header: "Project", key: "project", width: 18 },
      { header: "Note", key: "note", width: 40 },
    ];
    for (const t of txs) {
      ws.addRow({
        date: t.date,
        type: t.type,
        amount: t.type === "expense" ? -(t.amount as number) : (t.amount as number),
        account: name(accounts, t.account_id),
        to: name(accounts, t.to_account_id),
        category: name(categories, t.category_id),
        person: name(people, t.person_id),
        project: name(projects, t.project_id),
        note: t.note ?? "",
      });
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "I1" };

    const months = new Map<string, { income: number; expense: number }>();
    for (const t of txs) {
      if (t.type === "transfer") continue;
      const m = (t.date as string).slice(0, 7);
      const e = months.get(m) ?? { income: 0, expense: 0 };
      if (t.type === "income") e.income += t.amount as number;
      else e.expense += t.amount as number;
      months.set(m, e);
    }
    const ms = wb.addWorksheet("Monthly summary");
    ms.columns = [
      { header: "Month", key: "month", width: 12 },
      { header: "Income", key: "income", width: 14, style: { numFmt: money } },
      { header: "Spending", key: "expense", width: 14, style: { numFmt: money } },
      { header: "Kept", key: "kept", width: 14, style: { numFmt: money } },
    ];
    [...months.entries()].sort().forEach(([m, v]) => ms.addRow({ month: m, income: v.income, expense: v.expense, kept: v.income - v.expense }));
    ms.getRow(1).font = { bold: true };

    const cs = wb.addWorksheet("By category");
    cs.columns = [
      { header: "Month", key: "month", width: 12 },
      { header: "Kind", key: "kind", width: 10 },
      { header: "Category", key: "category", width: 22 },
      { header: "Amount", key: "amount", width: 14, style: { numFmt: money } },
    ];
    const byCat = new Map<string, number>();
    for (const t of txs) {
      if (t.type === "transfer") continue;
      const key = `${(t.date as string).slice(0, 7)}|${t.type}|${name(categories, t.category_id) || "Uncategorised"}`;
      byCat.set(key, (byCat.get(key) ?? 0) + (t.amount as number));
    }
    [...byCat.entries()].sort().forEach(([k, v]) => {
      const [month, kind, category] = k.split("|");
      cs.addRow({ month, kind, category, amount: v });
    });
    cs.getRow(1).font = { bold: true };

    const bs = wb.addWorksheet("Payments to people");
    bs.columns = [
      { header: "Due date", key: "due", width: 12 },
      { header: "Title", key: "title", width: 24 },
      { header: "Person", key: "person", width: 18 },
      { header: "Category", key: "category", width: 18 },
      { header: "Amount", key: "amount", width: 14, style: { numFmt: money } },
      { header: "Paid", key: "paid", width: 14, style: { numFmt: money } },
      { header: "Remaining", key: "remaining", width: 14, style: { numFmt: money } },
      { header: "Repeat", key: "recurrence", width: 10 },
      { header: "Status", key: "status", width: 10 },
    ];
    for (const b of bills) {
      const paid = billPaid(b.id as number);
      bs.addRow({
        due: b.due_date,
        title: b.title,
        person: name(people, b.person_id),
        category: name(categories, b.category_id),
        amount: b.amount,
        paid,
        remaining: Math.max(0, (b.amount as number) - paid),
        recurrence: b.recurrence,
        status: b.status,
      });
    }
    bs.getRow(1).font = { bold: true };

    const as = wb.addWorksheet("Accounts");
    as.columns = [
      { header: "Account", key: "name", width: 20 },
      { header: "Type", key: "type", width: 10 },
      { header: "Opening balance", key: "opening", width: 16, style: { numFmt: money } },
      { header: "Balance", key: "balance", width: 16, style: { numFmt: money } },
    ];
    for (const a of accounts) {
      let bal = a.opening_balance as number;
      for (const t of txs) {
        const amt = t.amount as number;
        if (t.account_id === a.id) {
          if (t.type === "income") bal += amt;
          else bal -= amt;
        }
        if (t.to_account_id === a.id && t.type === "transfer") bal += amt;
      }
      as.addRow({ name: a.name, type: a.type, opening: a.opening_balance, balance: bal });
    }
    as.getRow(1).font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="money-flow-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }),
);
