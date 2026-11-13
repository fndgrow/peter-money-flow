import type { Account, AppState, Bill, Transaction } from "./types";

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

/** Current balance of every account (opening balance + all transactions). */
export function accountBalances(accounts: Account[], transactions: Transaction[]): Map<number, number> {
  const bal = new Map<number, number>();
  for (const a of accounts) bal.set(a.id, a.opening_balance);
  for (const t of transactions) {
    if (t.type === "income") bal.set(t.account_id, (bal.get(t.account_id) ?? 0) + t.amount);
    else if (t.type === "expense") bal.set(t.account_id, (bal.get(t.account_id) ?? 0) - t.amount);
    else {
      bal.set(t.account_id, (bal.get(t.account_id) ?? 0) - t.amount);
      if (t.to_account_id !== null) bal.set(t.to_account_id, (bal.get(t.to_account_id) ?? 0) + t.amount);
    }
  }
  return bal;
}

export function billPaidMap(transactions: Transaction[]): Map<number, number> {
  const paid = new Map<number, number>();
  for (const t of transactions) {
    if (t.bill_id !== null) paid.set(t.bill_id, (paid.get(t.bill_id) ?? 0) + t.amount);
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

export function monthSummary(transactions: Transaction[], accounts: Account[], month: string): MonthSummary {
  const savingsIds = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
  let income = 0, expense = 0, toSavings = 0;
  for (const t of transactions) {
    if (!t.date.startsWith(month)) continue;
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
    else if (t.to_account_id !== null && savingsIds.has(t.to_account_id) && !savingsIds.has(t.account_id)) toSavings += t.amount;
  }
  return { month, income, expense, kept: income - expense, toSavings };
}

export interface Overview {
  totalMoney: number;
  spendable: number; // money in cash + bank accounts
  savings: number;
  owedSoon: number; // open bills due by end of this month (incl. overdue)
  owedTotal: number; // all open bills
  overdueCount: number;
  available: number; // spendable - owedSoon
  month: MonthSummary;
  salary: { expected: number; payday: number; accountId: number | null; received: boolean; receivedAmount: number } | null;
}

export function overview(state: AppState, today = todayStr()): Overview {
  const active = state.accounts.filter((a) => !a.archived);
  const balances = accountBalances(active, state.transactions);
  let spendable = 0, savings = 0;
  for (const a of active) {
    const b = balances.get(a.id) ?? 0;
    if (a.type === "savings") savings += b;
    else spendable += b;
  }
  const paid = billPaidMap(state.transactions);
  const month = monthKey(today);
  const end = monthEnd(month);
  let owedSoon = 0, owedTotal = 0, overdueCount = 0;
  for (const b of state.bills) {
    if (b.status !== "open") continue;
    const rem = billRemaining(b, paid);
    owedTotal += rem;
    if (b.due_date <= end) owedSoon += rem;
    if (b.due_date < today && rem > 0) overdueCount += 1;
  }
  const ms = monthSummary(state.transactions, active, month);

  let salary: Overview["salary"] = null;
  const expected = Number(state.settings.salary_amount || 0);
  if (expected > 0) {
    const salaryCat = state.categories.find((c) => c.system === "salary");
    const received = state.transactions.filter(
      (t) => t.type === "income" && t.date.startsWith(month) && salaryCat && t.category_id === salaryCat.id,
    );
    salary = {
      expected,
      payday: Number(state.settings.salary_payday || 25),
      accountId: state.settings.salary_account_id ? Number(state.settings.salary_account_id) : null,
      received: received.length > 0,
      receivedAmount: received.reduce((s, t) => s + t.amount, 0),
    };
  }

  return {
    totalMoney: spendable + savings,
    spendable,
    savings,
    owedSoon,
    owedTotal,
    overdueCount,
    available: spendable - owedSoon,
    month: ms,
    salary,
  };
}

export function categoryTotals(transactions: Transaction[], month: string, type: "income" | "expense"): Map<number | null, number> {
  const out = new Map<number | null, number>();
  for (const t of transactions) {
    if (t.type !== type || !t.date.startsWith(month)) continue;
    out.set(t.category_id, (out.get(t.category_id) ?? 0) + t.amount);
  }
  return out;
}

export function projectTotals(transactions: Transaction[], projectId: number) {
  let income = 0, cost = 0;
  for (const t of transactions) {
    if (t.project_id !== projectId) continue;
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") cost += t.amount;
  }
  return { income, cost, profit: income - cost };
}
