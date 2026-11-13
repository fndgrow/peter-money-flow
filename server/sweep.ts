import { db, allSettings, setSetting, nowIso } from "./db.js";
import { broadcastChange } from "./events.js";

/**
 * Month close: what was kept in a month (income − spending) moves from the day-to-day
 * account into savings; a shortfall is covered from savings. One transfer per month.
 */

function rates() {
  const s = allSettings();
  return { main: s.currency || "EUR", secondary: s.secondary_currency || null, rate: Number(s.secondary_rate || 0) || 0 };
}

function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const r = rates();
  const toMain = (a: number, c: string) => (c === r.main ? a : c === r.secondary && r.rate > 0 ? a / r.rate : a);
  const fromMain = (a: number, c: string) => (c === r.main ? a : c === r.secondary && r.rate > 0 ? a * r.rate : a);
  return Math.round(fromMain(toMain(amount, from), to) * 100) / 100;
}

interface AccountRow {
  id: number;
  name: string;
  type: string;
  currency: string | null;
  opening_balance: number;
  archived: number;
}

function account(id: number): AccountRow | undefined {
  return db.prepare("SELECT id, name, type, currency, opening_balance, archived FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
}

export function accountBalance(id: number): number {
  const a = account(id);
  if (!a) return 0;
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' AND account_id = ? THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN type = 'expense' AND account_id = ? THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN type = 'transfer' AND account_id = ? THEN amount ELSE 0 END), 0)
       + COALESCE(SUM(CASE WHEN type = 'transfer' AND to_account_id = ? THEN COALESCE(to_amount, amount) ELSE 0 END), 0) AS delta
       FROM transactions`,
    )
    .get(id, id, id, id) as { delta: number };
  return Math.round((a.opening_balance + row.delta) * 100) / 100;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

export function sweepConfig() {
  const s = allSettings();
  const from = s.sweep_from_account_id ? account(Number(s.sweep_from_account_id)) : undefined;
  const to = s.sweep_to_account_id ? account(Number(s.sweep_to_account_id)) : undefined;
  return { enabled: s.sweep_enabled === "1" && !!from && !!to && from.id !== to.id, from, to, last: s.sweep_last || null };
}

export interface SweepPreview {
  month: string;
  enabled: boolean;
  done: boolean;
  income: number;
  expense: number;
  kept: number;
  /** Amount that would move (positive: to savings, negative: from savings), in the day-to-day account's currency. */
  amount: number;
  currency: string;
  capped: boolean;
  note: string;
}

/** Compute what the month close would do for `month`, without doing it. */
export function previewSweep(month: string): SweepPreview {
  const cfg = sweepConfig();
  const main = rates().main;
  const cur = cfg.from?.currency || main;
  const rows = db
    .prepare(
      `SELECT t.type, t.amount, a.currency FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.type IN ('income','expense') AND t.date >= ? AND t.date <= ?`,
    )
    .all(`${month}-01`, monthEnd(month)) as { type: string; amount: number; currency: string | null }[];
  let income = 0, expense = 0;
  for (const r of rows) {
    const v = convert(r.amount, r.currency || main, cur);
    if (r.type === "income") income += v;
    else expense += v;
  }
  const kept = Math.round((income - expense) * 100) / 100;
  const done = !!db.prepare("SELECT id FROM transactions WHERE note = ? LIMIT 1").get(sweepNote(month));
  let amount = kept, capped = false, note = "";
  if (cfg.enabled && cfg.from && cfg.to) {
    if (kept > 0) {
      // Money can come from any day-to-day account in the same currency (bank first, then cash).
      const bal = currentAccounts(cfg.from).reduce((s, a) => s + Math.max(0, accountBalance(a.id)), 0);
      if (bal < kept) {
        amount = Math.max(0, Math.round(bal * 100) / 100);
        capped = true;
        note = `Only ${amount} ${cur} is in your current accounts, so that is the most that can move.`;
      }
    } else if (kept < 0) {
      const savCur = cfg.to.currency || main;
      const savBal = accountBalance(cfg.to.id);
      const need = convert(-kept, cur, savCur);
      if (savBal < need) {
        amount = -convert(Math.max(0, savBal), savCur, cur);
        capped = true;
        note = `${cfg.to.name} only has ${savBal} ${savCur}, so only that much can come back.`;
      }
    }
  }
  return { month, enabled: cfg.enabled, done, income, expense, kept, amount: Math.round(amount * 100) / 100, currency: cur, capped, note };
}

export function sweepNote(month: string) {
  return `Month close ${month}`;
}

/** The "current status" accounts: the configured one first, then the other non-savings accounts in the same currency. */
function currentAccounts(from: AccountRow): AccountRow[] {
  const others = db
    .prepare("SELECT id, name, type, currency, opening_balance, archived FROM accounts WHERE archived = 0 AND type != 'savings' AND id != ? AND COALESCE(currency,'') = COALESCE(?, '') ORDER BY type = 'bank' DESC, id")
    .all(from.id, from.currency) as unknown as AccountRow[];
  return [from, ...others];
}

/** Perform the month close for `month`. Returns the created transaction id, or null when nothing to do. */
export function runSweep(month: string): { id: number | null; preview: SweepPreview } {
  const p = previewSweep(month);
  const cfg = sweepConfig();
  if (!p.enabled || p.done || !cfg.from || !cfg.to) return { id: null, preview: p };
  if (Math.abs(p.amount) < 0.01) {
    setSetting("sweep_last", month);
    return { id: null, preview: p };
  }
  const main = rates().main;
  const fromCur = cfg.from.currency || main;
  const toCur = cfg.to.currency || main;
  const date = monthEnd(month);
  let r;
  if (p.amount > 0) {
    // current accounts → savings, taking from the configured account first, then the others.
    let left = p.amount;
    let lastId: number | bigint = 0;
    for (const a of currentAccounts(cfg.from)) {
      if (left < 0.01) break;
      const take = Math.min(left, Math.max(0, accountBalance(a.id)));
      if (take < 0.01) continue;
      const amt = Math.round(take * 100) / 100;
      lastId = db
        .prepare(
          `INSERT INTO transactions (type, amount, date, account_id, to_account_id, to_amount, note, created_at)
           VALUES ('transfer', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(amt, date, a.id, cfg.to.id, fromCur === toCur ? null : convert(amt, fromCur, toCur), sweepNote(month), nowIso()).lastInsertRowid;
      left -= amt;
    }
    r = { lastInsertRowid: lastId };
  } else {
    // savings → bank, amount expressed in the savings currency, arriving as |p.amount| in the bank currency
    const fromSavings = convert(-p.amount, fromCur, toCur);
    r = db
      .prepare(
        `INSERT INTO transactions (type, amount, date, account_id, to_account_id, to_amount, note, created_at)
         VALUES ('transfer', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(fromSavings, date, cfg.to.id, cfg.from.id, fromCur === toCur ? null : -p.amount, sweepNote(month), nowIso());
  }
  setSetting("sweep_last", month);
  return { id: Number(r.lastInsertRowid), preview: { ...p, done: true } };
}

function previousMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** Close the previous month automatically once the new month has started. */
export function autoSweep() {
  try {
    const cfg = sweepConfig();
    if (!cfg.enabled) return;
    const month = previousMonth();
    const sinceEnabled = allSettings().sweep_enabled_since || "";
    // Never close months from before the rule was switched on.
    if (sinceEnabled && month < sinceEnabled) return;
    const p = previewSweep(month);
    if (p.done) return;
    const r = runSweep(month);
    if (r.id) {
      console.log(`Month close ${month}: moved ${r.preview.amount} ${r.preview.currency} ${r.preview.amount > 0 ? "to" : "from"} savings`);
      broadcastChange();
    }
  } catch (e) {
    console.warn("Month close failed:", (e as Error).message);
  }
}

export function startSweepScheduler() {
  setTimeout(autoSweep, 10_000);
  setInterval(autoSweep, 6 * 60 * 60_000).unref();
}
