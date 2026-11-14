import type { Account, AppState, Bill, Category, Settings, Transaction } from "./types";

/** "Car › Fuel" for a sub-category, "Car" for a top-level one. */
export function catLabel(categories: Category[], c: Category | undefined | null): string {
  if (!c) return "";
  const parent = c.parent_id ? categories.find((p) => p.id === c.parent_id) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Categories of one kind as [parent, children[]] groups, in display order. Archived ones are skipped unless `keepId` matches. */
export function categoryGroups(categories: Category[], kind: "income" | "expense", keepId?: number | null) {
  const ok = (c: Category) => c.kind === kind && (!c.archived || c.id === keepId);
  const parents = categories.filter((c) => ok(c) && c.parent_id === null);
  return parents.map((p) => ({ parent: p, children: categories.filter((c) => ok(c) && c.parent_id === p.id) }));
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthKey(date: string | Date = new Date()): string {
  if (typeof date === "string") return date.slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${key}-${String(last).padStart(2, "0")}`;
}

export function monthLabel(key: string, locale = "en-GB"): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400_000);
}

export function formatDate(date: string, locale = "en-GB", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(date + "T00:00:00").toLocaleDateString(locale, opts);
}

export function makeFormatter(currency = "EUR", locale = "en-GB") {
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  } catch {
    fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
  }
  return (n: number) => fmt.format(Math.round(n * 100) / 100);
}

// ---------- currencies ----------

export interface Conv {
  main: string;
  secondary: string | null;
  /** How many second-currency units one main unit buys (1 EUR = 20 MDL → 20). */
  rate: number;
  /** Convert between the main and the second currency. Unknown currencies count 1:1 with main. */
  conv: (amount: number, from: string, to: string) => number;
}

export function makeConv(settings: Settings): Conv {
  const main = settings.currency || "EUR";
  const secondary = settings.secondary_currency && settings.secondary_currency !== main ? settings.secondary_currency : null;
  const rate = Number(settings.secondary_rate || 0) || 0;
  const toMain = (a: number, c: string) => (c === main ? a : c === secondary && rate > 0 ? a / rate : a);
  const fromMain = (a: number, c: string) => (c === main ? a : c === secondary && rate > 0 ? a * rate : a);
  const conv = (amount: number, from: string, to: string) => (from === to ? amount : fromMain(toMain(amount, from), to));
  return { main, secondary, rate, conv };
}

function accountCurrencyMap(accounts: Account[], main: string): Map<number, string> {
  return new Map(accounts.map((a) => [a.id, a.currency || main]));
}

/** Current balance of every account, in that account's own currency. */
export function accountBalances(accounts: Account[], transactions: Transaction[]): Map<number, number> {
  const bal = new Map<number, number>();
  for (const a of accounts) bal.set(a.id, a.opening_balance);
  for (const t of transactions) {
    if (t.type === "income") bal.set(t.account_id, (bal.get(t.account_id) ?? 0) + t.amount);
    else if (t.type === "expense") bal.set(t.account_id, (bal.get(t.account_id) ?? 0) - t.amount);
    else {
      bal.set(t.account_id, (bal.get(t.account_id) ?? 0) - t.amount);
      if (t.to_account_id !== null) bal.set(t.to_account_id, (bal.get(t.to_account_id) ?? 0) + (t.to_amount ?? t.amount));
    }
  }
  return bal;
}

/** Amount paid toward each bill, in the bill's currency. */
export function billPaidMap(state: AppState): Map<number, number> {
  const c = makeConv(state.settings);
  const accCur = accountCurrencyMap(state.accounts, c.main);
  const billCur = new Map(state.bills.map((b) => [b.id, b.currency || c.main]));
  const paid = new Map<number, number>();
  for (const t of state.transactions) {
    if (t.bill_id === null) continue;
    const amt = c.conv(t.amount, accCur.get(t.account_id) ?? c.main, billCur.get(t.bill_id) ?? c.main);
    paid.set(t.bill_id, (paid.get(t.bill_id) ?? 0) + amt);
  }
  return paid;
}

export function billRemaining(bill: Bill, paid: Map<number, number>): number {
  return Math.max(0, Math.round((bill.amount - (paid.get(bill.id) ?? 0)) * 100) / 100);
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  kept: number;
  toSavings: number;
}

/** Income, spending and what was kept in a month, all in the main currency. */
export function monthSummary(state: AppState, month: string): MonthSummary {
  const c = makeConv(state.settings);
  const accCur = accountCurrencyMap(state.accounts, c.main);
  const savingsIds = new Set(state.accounts.filter((a) => a.type === "savings").map((a) => a.id));
  let income = 0, expense = 0, toSavings = 0;
  for (const t of state.transactions) {
    if (!t.date.startsWith(month)) continue;
    const inMain = c.conv(t.amount, accCur.get(t.account_id) ?? c.main, c.main);
    if (t.type === "income") income += inMain;
    else if (t.type === "expense") expense += inMain;
    else if (t.to_account_id !== null && savingsIds.has(t.to_account_id) && !savingsIds.has(t.account_id)) toSavings += inMain;
  }
  return { month, income, expense, kept: income - expense, toSavings };
}

export interface Overview {
  totalMoney: number;
  spendable: number; // money in cash + bank accounts
  savings: number;
  owedSoon: number; // open bills due by end of this month (incl. overdue)
  owedTotal: number; // all open bills I have to pay
  owedToMe: number; // what other people still owe me
  overdueCount: number;
  available: number; // spendable - owedSoon
  /** Single-pot view: everything you had before this month started (total money minus this month's kept). */
  savedBefore: number;
  month: MonthSummary;
}

/** Everything on the home screen, in the main currency. */
export function overview(state: AppState, today = todayStr()): Overview {
  const c = makeConv(state.settings);
  const active = state.accounts.filter((a) => !a.archived);
  const balances = accountBalances(active, state.transactions);
  let spendable = 0, savings = 0;
  for (const a of active) {
    const b = c.conv(balances.get(a.id) ?? 0, a.currency || c.main, c.main);
    if (a.type === "savings") savings += b;
    else spendable += b;
  }
  const paid = billPaidMap(state);
  const month = monthKey(today);
  const end = monthEnd(month);
  let owedSoon = 0, owedTotal = 0, overdueCount = 0, owedToMe = 0;
  for (const b of state.bills) {
    if (b.status !== "open") continue;
    const rem = c.conv(billRemaining(b, paid), b.currency || c.main, c.main);
    if (b.direction === "in") {
      owedToMe += rem;
      continue;
    }
    owedTotal += rem;
    if (b.due_date <= end) owedSoon += rem;
    if (b.due_date < today && rem > 0) overdueCount += 1;
  }
  const ms = monthSummary(state, month);

  return {
    totalMoney: spendable + savings,
    spendable,
    savings,
    owedSoon,
    owedTotal,
    owedToMe,
    overdueCount,
    available: spendable - owedSoon,
    savedBefore: spendable + savings - ms.kept,
    month: ms,
  };
}

/** Totals per category for a month, in the main currency. */
export function categoryTotals(state: AppState, month: string, type: "income" | "expense"): Map<number | null, number> {
  const c = makeConv(state.settings);
  const accCur = accountCurrencyMap(state.accounts, c.main);
  const out = new Map<number | null, number>();
  for (const t of state.transactions) {
    if (t.type !== type || !t.date.startsWith(month)) continue;
    out.set(t.category_id, (out.get(t.category_id) ?? 0) + c.conv(t.amount, accCur.get(t.account_id) ?? c.main, c.main));
  }
  return out;
}

/** Income, costs and profit of a project, in the main currency. */
export function projectTotals(state: AppState, projectId: number) {
  const c = makeConv(state.settings);
  const accCur = accountCurrencyMap(state.accounts, c.main);
  let income = 0, cost = 0;
  for (const t of state.transactions) {
    if (t.project_id !== projectId) continue;
    const inMain = c.conv(t.amount, accCur.get(t.account_id) ?? c.main, c.main);
    if (t.type === "income") income += inMain;
    else if (t.type === "expense") cost += inMain;
  }
  return { income, cost, profit: income - cost };
}

/** Amount of a transaction expressed in the main currency. */
export function txInMain(state: AppState, t: Transaction): number {
  const c = makeConv(state.settings);
  const cur = state.accounts.find((a) => a.id === t.account_id)?.currency || c.main;
  return c.conv(t.amount, cur, c.main);
}
