import { Router } from "express";
import type { Request, Response } from "express";
import { buildWorkbook } from "./export.js";
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
  userEmail,
  setUserEmail,
  normalizeEmail,
  emailMatches,
} from "./auth.js";

import { fetchRate, refreshStoredRate } from "./rates.js";
import { previewSweep, runSweep, sweepNote } from "./sweep.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// ---------- currencies ----------

function currencyCode(v: unknown, field: string, fallback: string): string {
  if (v === null || v === undefined || v === "") return fallback;
  const s = String(v).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) throw new HttpError(400, `${field} must be a 3-letter currency code`);
  return s;
}

/** Main currency, optional second currency and the rate: how many second-currency units one main unit buys (1 EUR = 20 MDL → 20). */
function rates() {
  const s = allSettings();
  return { main: s.currency || "EUR", secondary: s.secondary_currency || null, rate: Number(s.secondary_rate || 0) || 0 };
}

/** Convert between the main and the second currency. Unknown currencies are treated 1:1 with main. */
function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const r = rates();
  const toMain = (a: number, c: string) => (c === r.main ? a : c === r.secondary && r.rate > 0 ? a / r.rate : a);
  const fromMain = (a: number, c: string) => (c === r.main ? a : c === r.secondary && r.rate > 0 ? a * r.rate : a);
  return Math.round(fromMain(toMain(amount, from), to) * 100) / 100;
}

function accountCurrency(accountId: number): string {
  const row = db.prepare("SELECT currency FROM accounts WHERE id = ?").get(accountId) as { currency: string | null } | undefined;
  return row?.currency || rates().main;
}

/** Amount paid toward a bill, expressed in the bill's currency. */
function billPaid(billId: number): number {
  const bill = db.prepare("SELECT currency FROM bills WHERE id = ?").get(billId) as { currency: string | null } | undefined;
  const billCur = bill?.currency || rates().main;
  const rows = db
    .prepare("SELECT t.amount, a.currency FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.bill_id = ?")
    .all(billId) as { amount: number; currency: string | null }[];
  let paid = 0;
  for (const r of rows) paid += convert(r.amount, r.currency || rates().main, billCur);
  return Math.round(paid * 100) / 100;
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
        `INSERT INTO bills (title, person_id, category_id, amount, due_date, recurrence, status, note, created_at, currency, direction)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      ).run(
        bill.title as string,
        bill.person_id as number | null,
        bill.category_id as number | null,
        amount,
        addRecurrence(bill.due_date as string, recurrence),
        recurrence,
        bill.note as string | null,
        nowIso(),
        (bill.currency as string | null) || rates().main,
        (bill.direction as string) || "out",
      );
    }
  } else if (paid < amount - 0.004 && status === "paid") {
    db.prepare("UPDATE bills SET status = 'open' WHERE id = ?").run(billId);
  }
}

// ---------- auth ----------

api.get("/me", (req, res) => {
  const authed = isAuthed(req);
  res.json({ setup: hasUser(), authed, email: authed ? userEmail() : undefined });
});

api.post(
  "/setup",
  wrap((req, res) => {
    if (hasUser()) throw new HttpError(400, "Already set up");
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address");
    const password = str(req.body?.password, "Password", { required: true }) as string;
    if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
    createUser(password, email);
    issueSession(res);
    res.json({ ok: true });
  }),
);

api.post(
  "/login",
  loginLimiter,
  wrap((req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? "");
    if (!emailMatches(email) || !verifyPassword(password)) {
      noteFailedLogin(req);
      throw new HttpError(401, "Wrong email or password");
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

api.post(
  "/email",
  requireAuth,
  wrap((req, res) => {
    const current = String(req.body?.current ?? "");
    const email = normalizeEmail(req.body?.email);
    if (!verifyPassword(current)) throw new HttpError(400, "Current password is wrong");
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address");
    setUserEmail(email);
    res.json({ ok: true, email });
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
  "owner_name",
  "secondary_currency",
  "secondary_rate",
  "secondary_rate_date",
  "secondary_rate_manual",
  "sweep_enabled",
  "sweep_from_account_id",
  "sweep_to_account_id",
  "savings_mode",
] as const;

api.put(
  "/settings",
  wrap(async (req, res) => {
    const body = req.body ?? {};
    for (const key of SETTING_KEYS) {
      if (!(key in body)) continue;
      let value = body[key];
      if (key === "secondary_rate" && value !== "" && value !== null) {
        const r = Number(String(value).replace(",", "."));
        if (!Number.isFinite(r) || r <= 0) throw new HttpError(400, "Rate must be a positive number");
        value = r;
      }
      if (key === "secondary_currency" && value) value = String(value).toUpperCase().slice(0, 3);
      if ((key === "sweep_from_account_id" || key === "sweep_to_account_id") && value !== "" && value !== null) exists("accounts", id(value, "Account"), "Account");
      if (key === "savings_mode") value = oneOf(value, "Savings mode", ["rolling", "accounts"] as const, "accounts");
      if (key === "sweep_enabled") {
        const on = value === "1" || value === true;
        value = on ? "1" : "";
        // Remember when the rule was switched on so earlier months are never closed retroactively.
        if (on && !allSettings().sweep_enabled) setSetting("sweep_enabled_since", new Date().toISOString().slice(0, 7));
      }
      setSetting(key, value === null || value === undefined ? null : String(value));
    }
    // A new second currency (or switching back to automatic) gets today's rate straight away.
    if ("secondary_currency" in body || "secondary_rate_manual" in body) await refreshStoredRate();
    res.json(allSettings());
  }),
);

/** Today's exchange rate: how many units of `quote` one unit of `base` buys (base=EUR, quote=MDL → about 20). */
api.get(
  "/rates",
  wrap(async (req, res) => {
    const base = String(req.query.base || "").toUpperCase();
    const quote = String(req.query.quote || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) throw new HttpError(400, "Give two currency codes");
    let result: { rate: number; date: string };
    try {
      result = await fetchRate(base, quote);
    } catch (e) {
      throw new HttpError(502, (e as Error).message.startsWith("No rate") ? (e as Error).message : "Could not reach the exchange rate service");
    }
    res.json({ base, quote, ...result });
  }),
);

// ---------- accounts ----------

api.post(
  "/accounts",
  wrap((req, res) => {
    const name = str(req.body?.name, "Name", { required: true, max: 60 });
    const type = oneOf(req.body?.type, "Type", ["cash", "bank", "savings"] as const);
    const opening = num(req.body?.opening_balance, "Opening balance") ?? 0;
    const currency = currencyCode(req.body?.currency, "Currency", rates().main);
    const r = db
      .prepare(
        "INSERT INTO accounts (name, type, opening_balance, sort, currency) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM accounts), ?)",
      )
      .run(name, type, opening, currency);
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
    const currency = currencyCode(req.body?.currency, "Currency", accountCurrency(accId));
    if (currency !== accountCurrency(accId)) {
      const used = db
        .prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?")
        .get(accId, accId) as { n: number };
      if (used.n > 0) throw new HttpError(400, "This account already has transactions, so its currency cannot change. Create a new account instead.");
    }
    db.prepare("UPDATE accounts SET name = ?, type = ?, opening_balance = ?, archived = ?, currency = ? WHERE id = ?").run(
      name,
      type,
      opening,
      archived,
      currency,
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
    const parentId = parentCategory(req.body?.parent_id, kind, null);
    const r = db
      .prepare(
        "INSERT INTO categories (name, kind, icon, sort, parent_id) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM categories WHERE kind = ?), ?)",
      )
      .run(name, kind, icon, kind, parentId);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

/** Validate a parent category: same kind, top level, not itself. */
function parentCategory(v: unknown, kind: string, selfId: number | null): number | null {
  const parentId = id(v, "Parent category", true);
  if (parentId === null) return null;
  if (parentId === selfId) throw new HttpError(400, "A category cannot be its own parent");
  const p = db.prepare("SELECT kind, parent_id FROM categories WHERE id = ?").get(parentId) as { kind: string; parent_id: number | null } | undefined;
  if (!p) throw new HttpError(400, "Parent category not found");
  if (p.kind !== kind) throw new HttpError(400, "Parent must be the same kind of category");
  if (p.parent_id !== null) throw new HttpError(400, "Only one level of sub-categories is supported");
  return parentId;
}

api.put(
  "/categories/:id",
  wrap((req, res) => {
    const catId = id(req.params.id, "Category") as number;
    const cur = db.prepare("SELECT kind FROM categories WHERE id = ?").get(catId) as { kind: string } | undefined;
    if (!cur) throw new HttpError(404, "Category not found");
    const name = str(req.body?.name, "Name", { required: true, max: 60 });
    const icon = str(req.body?.icon, "Icon", { max: 8 });
    const archived = req.body?.archived ? 1 : 0;
    const parentId = parentCategory(req.body?.parent_id, cur.kind, catId);
    if (parentId !== null) {
      const kids = db.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").get(catId) as { n: number };
      if (kids.n > 0) throw new HttpError(400, "This category has sub-categories, so it cannot become a sub-category itself");
    }
    db.prepare("UPDATE categories SET name = ?, icon = ?, archived = ?, parent_id = ? WHERE id = ?").run(name, icon, archived, parentId, catId);
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
    const kids = db.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").get(catId) as { n: number };
    if (kids.n > 0) throw new HttpError(400, "Delete or move its sub-categories first.");
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
  // "out": I owe someone (an expense when paid). "in": someone owes me (an income when they pay).
  const direction = oneOf(body.direction, "Direction", ["out", "in"] as const, "out");
  const kind = direction === "in" ? "income" : "expense";
  let categoryId = id(body.category_id, "Category", true);
  if (categoryId !== null && categoryKind(categoryId) !== kind) throw new HttpError(400, `Category must be an ${kind} category`);
  if (categoryId === null) categoryId = systemCategory(direction === "in" ? "people_in" : "people");
  const amount = num(body.amount, "Amount", { min: 0.01 }) as number;
  const dueDate = dateStr(body.due_date, "Due date") as string;
  const recurrence = oneOf(body.recurrence, "Repeat", ["none", "weekly", "monthly", "yearly"] as const, "none");
  const note = str(body.note, "Note", { max: 500 });
  const currency = currencyCode(body.currency, "Currency", rates().main);
  return { title, personId, categoryId, amount, dueDate, recurrence, note, currency, direction };
}

api.post(
  "/bills",
  wrap((req, res) => {
    const b = readBill(req.body ?? {});
    const r = db
      .prepare(
        `INSERT INTO bills (title, person_id, category_id, amount, due_date, recurrence, status, note, created_at, currency, direction)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(b.title, b.personId, b.categoryId, b.amount, b.dueDate, b.recurrence, b.note, nowIso(), b.currency, b.direction);
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
      "UPDATE bills SET title = ?, person_id = ?, category_id = ?, amount = ?, due_date = ?, recurrence = ?, note = ?, currency = ?, direction = ? WHERE id = ?",
    ).run(b.title, b.personId, b.categoryId, b.amount, b.dueDate, b.recurrence, b.note, b.currency, b.direction, bid);
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
      `INSERT INTO bills (title, person_id, category_id, amount, due_date, recurrence, status, note, created_at, currency, direction)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    ).run(
      bill.title as string,
      bill.person_id as number | null,
      bill.category_id as number | null,
      bill.amount as number,
      addRecurrence(bill.due_date as string, bill.recurrence as string),
      bill.recurrence as string,
      bill.note as string | null,
      nowIso(),
      (bill.currency as string | null) || rates().main,
      (bill.direction as string) || "out",
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
    // Money I owe goes out as an expense; money owed to me comes in as income.
    const incoming = bill.direction === "in";
    const categoryId = (bill.category_id as number | null) ?? systemCategory(incoming ? "people_in" : "people");
    const r = db
      .prepare(
        `INSERT INTO transactions (type, amount, date, account_id, category_id, person_id, bill_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(incoming ? "income" : "expense", amount, date, accountId, categoryId, bill.person_id as number | null, bid, note ?? (bill.title as string), nowIso());
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
  // Transfer between accounts in different currencies: the amount received on the other side.
  let toAmount: number | null = null;
  if (type === "transfer" && toAccountId !== null) {
    const fromCur = accountCurrency(accountId);
    const toCur = accountCurrency(toAccountId);
    if (fromCur !== toCur) {
      toAmount = num(body.to_amount, "Amount received", { min: 0.01, allowNull: true });
      if (toAmount === null) toAmount = convert(amount, fromCur, toCur);
    }
  }
  return { type, amount, date, accountId, toAccountId, toAmount, categoryId, personId, projectId, note };
}

api.post(
  "/transactions",
  wrap((req, res) => {
    const t = readTransaction(req.body ?? {});
    const r = db
      .prepare(
        `INSERT INTO transactions (type, amount, date, account_id, to_account_id, to_amount, category_id, person_id, project_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.type, t.amount, t.date, t.accountId, t.toAccountId, t.toAmount, t.categoryId, t.personId, t.projectId, t.note, nowIso());
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
      `UPDATE transactions SET type = ?, amount = ?, date = ?, account_id = ?, to_account_id = ?, to_amount = ?, category_id = ?, person_id = ?, project_id = ?, note = ?
       WHERE id = ?`,
    ).run(t.type, t.amount, t.date, t.accountId, t.toAccountId, t.toAmount, t.categoryId, t.personId, t.projectId, t.note, tid);
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

// ---------- month close (savings sweep) ----------

api.get(
  "/sweep/preview",
  wrap((req, res) => {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "month must be YYYY-MM");
    res.json(previewSweep(month));
  }),
);

api.post(
  "/sweep/run",
  wrap((req, res) => {
    const month = String(req.body?.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "month must be YYYY-MM");
    if (month > new Date().toISOString().slice(0, 7)) throw new HttpError(400, "That month has not started yet");
    const r = runSweep(month);
    if (!r.preview.enabled) throw new HttpError(400, "Set up the month-close rule in Settings first");
    res.json(r);
  }),
);

api.post(
  "/sweep/undo",
  wrap((req, res) => {
    const month = String(req.body?.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "month must be YYYY-MM");
    const r = db.prepare("DELETE FROM transactions WHERE note = ? AND type = 'transfer'").run(sweepNote(month));
    if (allSettings().sweep_last === month) setSetting("sweep_last", null);
    res.json({ removed: Number(r.changes) });
  }),
);

// ---------- backup / restore ----------

const TABLES = ["settings", "accounts", "categories", "people", "projects", "bills", "goals", "transactions"] as const;

api.get("/backup", (_req, res) => {
  const out: Record<string, unknown> = { version: 1, exported_at: nowIso() };
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="my-money-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(out, null, 2));
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
        // Only real columns of the table are accepted; anything else in the file is ignored.
        const allowed = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => allowed.has(c));
          if (cols.length === 0) continue;
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
  wrap(async (_req, res) => {
    const wb = await buildWorkbook(convert, billPaid);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="my-money-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }),
);
