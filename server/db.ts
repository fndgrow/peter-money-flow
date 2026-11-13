import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, "money-flow.sqlite");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash','bank','savings')),
  opening_balance REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  icon TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  system TEXT
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done')),
  note TEXT
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','weekly','monthly','yearly')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  target_date TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_bill ON transactions(bill_id);
`);

// ---- migrations for databases created by earlier versions ----
function addColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("accounts", "currency", "TEXT"); // currency the account is kept in
addColumn("bills", "currency", "TEXT"); // currency the bill is owed in
addColumn("transactions", "to_amount", "REAL"); // amount received on a transfer between currencies
addColumn("categories", "parent_id", "INTEGER REFERENCES categories(id) ON DELETE SET NULL"); // one level of sub-categories
addColumn("user", "email", "TEXT"); // login email (required at sign-in once set)

/** Older rows have no currency: assume the main currency. Safe to run on every start. */
export function fillCurrencies() {
  const main = getSetting("currency") || "EUR";
  db.prepare("UPDATE accounts SET currency = ? WHERE currency IS NULL OR currency = ''").run(main);
  db.prepare("UPDATE bills SET currency = ? WHERE currency IS NULL OR currency = ''").run(main);
}

/** One-time rename of the first-version income categories to the final names. */
export function migrateIncomeCategories() {
  if (getSetting("migrated_income_v2")) return;
  const byName = (name: string) =>
    db.prepare("SELECT id FROM categories WHERE kind = 'income' AND name = ?").get(name) as { id: number } | undefined;
  const rename = (from: string, to: string) =>
    db.prepare("UPDATE categories SET name = ? WHERE kind = 'income' AND name = ?").run(to, from);
  rename("My salary", "Company");
  rename("Freelance / project", "Freelance/project");
  rename("Side income", "Extra income");
  for (const old of ["Rent received", "Other income"]) {
    const row = byName(old);
    if (!row) continue;
    const used = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?").get(row.id) as { n: number };
    if (used.n === 0) db.prepare("DELETE FROM categories WHERE id = ?").run(row.id);
    else db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(row.id);
  }
  // Fixed order: Company, Bonus, Freelance/project, Gift, Extra income.
  ["Company", "Bonus", "Freelance/project", "Gift", "Extra income"].forEach((name, i) =>
    db.prepare("UPDATE categories SET sort = ? WHERE kind = 'income' AND name = ?").run(i, name),
  );
  setSetting("migrated_income_v2", "1");
}

/** One-time reshuffle of the first-version expense categories into the organised list with sub-categories. */
export function migrateExpenseCategories() {
  if (getSetting("migrated_expense_v2")) return;
  const find = (name: string) =>
    db.prepare("SELECT id FROM categories WHERE kind = 'expense' AND name = ? AND parent_id IS NULL").get(name) as { id: number } | undefined;
  const rename = (from: string, to: string) => {
    if (find(from) && !find(to)) db.prepare("UPDATE categories SET name = ? WHERE kind = 'expense' AND name = ?").run(to, from);
  };
  rename("Housing", "Home");
  rename("Groceries", "Food");
  rename("Transport", "Transportation");
  rename("Donations", "For God");
  // Categories that are no longer in the list: fold into the closest new one if used, otherwise remove.
  const fold = (old: string, into: string) => {
    const o = find(old);
    if (!o) return;
    const target = find(into);
    if (target) {
      db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ?").run(target.id, o.id);
      db.prepare("UPDATE bills SET category_id = ? WHERE category_id = ?").run(target.id, o.id);
    }
    db.prepare("DELETE FROM categories WHERE id = ?").run(o.id);
  };
  fold("Utilities", "Home");
  fold("Eating out", "Food");
  // Add what is missing, with icons and the fixed order.
  const ins = db.prepare("INSERT INTO categories (name, kind, icon, sort, system, parent_id) VALUES (?, 'expense', ?, ?, ?, ?)");
  DEFAULT_EXPENSE.forEach(([name, icon, system, children], i) => {
    let row = find(name);
    if (!row) {
      row = { id: Number(ins.run(name, icon, i, system, null).lastInsertRowid) };
    } else {
      db.prepare("UPDATE categories SET icon = ?, sort = ?, archived = 0 WHERE id = ?").run(icon, i, row.id);
    }
    (children ?? []).forEach(([cn, ci], j) => {
      const existing = db.prepare("SELECT id FROM categories WHERE kind = 'expense' AND name = ? AND parent_id = ?").get(cn, row!.id);
      if (!existing) ins.run(cn, ci, j, null, row!.id);
    });
  });
  setSetting("migrated_expense_v2", "1");
}

const DEFAULT_INCOME: [string, string, string | null][] = [
  ["Company", "💼", "salary"],
  ["Bonus", "🎉", null],
  ["Freelance/project", "🧑‍💻", null],
  ["Gift", "🎁", null],
  ["Extra income", "🪙", null],
];

/** Expense categories: [name, icon, system, children]. */
type ExpenseDef = [string, string, string | null, [string, string][]?];
const DEFAULT_EXPENSE: ExpenseDef[] = [
  ["Home", "🏠", null],
  ["Food", "🍽️", null],
  ["Groceries", "🛒", null],
  ["Shopping", "🛍️", null],
  ["Transportation", "🚌", null, [["Minibus", "🚐"], ["Trolleybus", "🚎"]]],
  ["Car", "🚗", null, [["Fuel", "⛽"], ["Repairs", "🔧"]]],
  ["Family", "👨‍👩‍👧", null],
  ["Friends", "🧑‍🤝‍🧑", null],
  ["Health", "🩺", null],
  ["Haircut", "💇", null],
  ["Entertainment", "🎬", null],
  ["Education", "📚", null],
  ["Hobbies", "🎨", null],
  ["Fishing", "🎣", null],
  ["Bath or sauna", "🧖", null],
  ["Swimming pool", "🏊", null],
  ["Subscriptions", "📺", null, [["Personal", "👤"], ["For the company", "🏢"]]],
  ["Travel", "✈️", null],
  ["For God", "🙏", null],
  ["Payments to people", "🤝", "people"],
  ["Other", "📦", null],
];

function insertExpenseTree(defs: ExpenseDef[], startSort = 0) {
  const ins = db.prepare("INSERT INTO categories (name, kind, icon, sort, system, parent_id) VALUES (?, 'expense', ?, ?, ?, ?)");
  defs.forEach(([name, icon, system, children], i) => {
    const parentId = Number(ins.run(name, icon, startSort + i, system, null).lastInsertRowid);
    (children ?? []).forEach(([cn, ci], j) => ins.run(cn, ci, j, null, parentId));
  });
}

export function seedDefaults() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
  if (count.n > 0) return;
  const ins = db.prepare("INSERT INTO categories (name, kind, icon, sort, system) VALUES (?, ?, ?, ?, ?)");
  DEFAULT_INCOME.forEach(([name, icon, system], i) => ins.run(name, "income", icon, i, system));
  insertExpenseTree(DEFAULT_EXPENSE);
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('migrated_expense_v2', '1')").run();
  const acc = db.prepare("INSERT INTO accounts (name, type, opening_balance, sort, currency) VALUES (?, ?, 0, ?, 'EUR')");
  acc.run("Cash", "cash", 0);
  acc.run("Bank account", "bank", 1);
  acc.run("Savings", "savings", 2);
  const set = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  set.run("currency", "EUR");
  set.run("locale", "en-GB");
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  } else {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, String(value));
  }
}

export function allSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function nowIso() {
  return new Date().toISOString();
}
