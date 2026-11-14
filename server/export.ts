import ExcelJS from "exceljs";
import { db, allSettings } from "./db.js";

/**
 * Excel export: one workbook with a summary page, the full transaction list, and
 * month-by-month tables for categories, income sources, companies and accounts.
 * Amounts are shown in the "report currency": the currency most of your accounts use
 * (so MDL when you live in MDL, even if the app's main currency is EUR).
 */

type Row = Record<string, unknown>;
type Convert = (amount: number, from: string, to: string) => number;

const MONEY = "#,##0.00;[Red]-#,##0.00";
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
const HEAD_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E7FD" } };

function styleHeader(ws: ExcelJS.Worksheet, row = 1) {
  const r = ws.getRow(row);
  r.font = HEAD_FONT;
  r.fill = HEAD_FILL;
  r.alignment = { vertical: "middle" };
  r.height = 20;
}
function freezeAndFilter(ws: ExcelJS.Worksheet, columns: number, headerRow = 1) {
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns } };
}
function totalRow(ws: ExcelJS.Worksheet, values: unknown[]) {
  const r = ws.addRow(values);
  r.font = { bold: true };
  r.fill = TOTAL_FILL;
  return r;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export async function buildWorkbook(convert: Convert, billPaid: (billId: number) => number): Promise<ExcelJS.Workbook> {
  const settings = allSettings();
  const main = settings.currency || "EUR";
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY sort, id").all() as Row[];
  const categories = db.prepare("SELECT * FROM categories ORDER BY kind, sort, id").all() as Row[];
  const people = db.prepare("SELECT * FROM people ORDER BY name").all() as Row[];
  const projects = db.prepare("SELECT * FROM projects ORDER BY name").all() as Row[];
  const bills = db.prepare("SELECT * FROM bills ORDER BY due_date, id").all() as Row[];
  const txs = db.prepare("SELECT * FROM transactions ORDER BY date, id").all() as Row[];

  const accCur = (accountId: unknown) => (accounts.find((a) => a.id === accountId)?.currency as string | null) || main;
  // Report currency: the one most transactions are in.
  const curCount = new Map<string, number>();
  for (const t of txs) curCount.set(accCur(t.account_id), (curCount.get(accCur(t.account_id)) ?? 0) + 1);
  const cur = [...curCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? main;
  const inCur = (amount: number, accountId: unknown) => convert(amount, accCur(accountId), cur);

  const name = (list: Row[], rowId: unknown) => (rowId ? ((list.find((x) => x.id === rowId)?.name as string) ?? "") : "");
  const catLabel = (catId: unknown) => {
    const c = categories.find((x) => x.id === catId);
    if (!c) return "";
    const p = c.parent_id ? categories.find((x) => x.id === c.parent_id) : undefined;
    return p ? `${p.name} › ${c.name}` : (c.name as string);
  };
  const catIcon = (catId: unknown) => ((categories.find((x) => x.id === catId)?.icon as string | null) ?? "");
  const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
  const months = [...new Set(txs.map((t) => (t.date as string).slice(0, 7)))].sort();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const balance = (a: Row) => {
    let bal = a.opening_balance as number;
    for (const t of txs) {
      const amt = t.amount as number;
      if (t.account_id === a.id) bal += t.type === "income" ? amt : -amt;
      if (t.to_account_id === a.id && t.type === "transfer") bal += (t.to_amount as number | null) ?? amt;
    }
    return Math.round(bal * 100) / 100;
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "My money";
  wb.created = new Date();

  // ---------- Summary ----------
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF4F46E5" } } });
  sum.columns = [{ width: 30 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 16 }];
  sum.addRow(["My money"]).font = { bold: true, size: 16 };
  sum.addRow([`Exported ${today}. Amounts in ${cur}${cur !== main ? ` (app currency ${main}, rate ${settings.secondary_rate || "?"} ${cur} per ${main})` : ""}.`]).font = { italic: true, color: { argb: "FF6C707B" } };
  sum.addRow([]);

  let totalMoney = 0, savings = 0;
  sum.addRow(["Accounts", "Type", "Currency", "Balance", `In ${cur}`]);
  styleHeader(sum, sum.rowCount);
  for (const a of accounts.filter((a) => !a.archived)) {
    const bal = balance(a);
    const inC = convert(bal, accCur(a.id), cur);
    totalMoney += inC;
    if (a.type === "savings") savings += inC;
    const r = sum.addRow([a.name, a.type, accCur(a.id), bal, inC]);
    r.getCell(4).numFmt = MONEY;
    r.getCell(5).numFmt = MONEY;
  }
  totalRow(sum, ["Total money", "", "", "", totalMoney]).getCell(5).numFmt = MONEY;
  totalRow(sum, ["Of which savings", "", "", "", savings]).getCell(5).numFmt = MONEY;
  totalRow(sum, ["Current (cash + bank)", "", "", "", totalMoney - savings]).getCell(5).numFmt = MONEY;
  sum.addRow([]);

  const monthStats = (m: string) => {
    let income = 0, expense = 0;
    for (const t of txs) {
      if (!(t.date as string).startsWith(m)) continue;
      if (t.type === "income") income += inCur(t.amount as number, t.account_id);
      else if (t.type === "expense") expense += inCur(t.amount as number, t.account_id);
    }
    return { income, expense, kept: income - expense };
  };
  const tm = monthStats(thisMonth);
  const all = { income: 0, expense: 0 };
  for (const t of txs) {
    if (t.type === "income") all.income += inCur(t.amount as number, t.account_id);
    else if (t.type === "expense") all.expense += inCur(t.amount as number, t.account_id);
  }
  sum.addRow(["", "", "", monthLabel(thisMonth), "All time"]);
  styleHeader(sum, sum.rowCount);
  for (const [label, a, b] of [
    ["Income", tm.income, all.income],
    ["Spending", tm.expense, all.expense],
    ["Kept", tm.kept, all.income - all.expense],
  ] as [string, number, number][]) {
    const r = sum.addRow([label, "", "", a, b]);
    r.getCell(4).numFmt = MONEY;
    r.getCell(5).numFmt = MONEY;
    if (label === "Kept") r.font = { bold: true };
  }
  sum.addRow([]);

  const open = bills.filter((b) => b.status === "open");
  let owed = 0;
  for (const b of open) owed += convert(Math.max(0, (b.amount as number) - billPaid(b.id as number)), (b.currency as string | null) || main, cur);
  sum.addRow(["Open payments to people", "", "", open.length, owed]);
  styleHeader(sum, sum.rowCount);
  sum.getRow(sum.rowCount).getCell(5).numFmt = MONEY;
  sum.addRow([]);

  const byCompany = new Map<string, number>();
  for (const t of txs) if (t.type === "income" && t.project_id) byCompany.set(name(projects, t.project_id), (byCompany.get(name(projects, t.project_id)) ?? 0) + inCur(t.amount as number, t.account_id));
  sum.addRow(["Income by company (all time)", "", "", "", cur]);
  styleHeader(sum, sum.rowCount);
  for (const [n, v] of [...byCompany.entries()].sort((a, b) => b[1] - a[1])) sum.addRow([n, "", "", "", v]).getCell(5).numFmt = MONEY;
  sum.addRow([]);

  const byTop = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== "expense") continue;
    const c = categories.find((x) => x.id === t.category_id);
    const top = c ? (c.parent_id ? categories.find((x) => x.id === c.parent_id) : c) : undefined;
    const label = top ? `${(top.icon as string) ?? ""} ${top.name}`.trim() : "Uncategorised";
    byTop.set(label, (byTop.get(label) ?? 0) + inCur(t.amount as number, t.account_id));
  }
  sum.addRow(["Spending by category (all time)", "", "", "Share", cur]);
  styleHeader(sum, sum.rowCount);
  for (const [n, v] of [...byTop.entries()].sort((a, b) => b[1] - a[1])) {
    const r = sum.addRow([n, "", "", all.expense ? v / all.expense : 0, v]);
    r.getCell(4).numFmt = "0.0%";
    r.getCell(5).numFmt = MONEY;
  }

  // ---------- Transactions ----------
  const ws = wb.addWorksheet("Transactions");
  ws.columns = [
    { header: "Date", key: "date", width: 12, style: { numFmt: "yyyy-mm-dd" } },
    { header: "Type", key: "type", width: 10 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: MONEY } },
    { header: "Currency", key: "currency", width: 9 },
    { header: `In ${cur}`, key: "incur", width: 14, style: { numFmt: MONEY } },
    { header: "Account", key: "account", width: 16 },
    { header: "To account", key: "to", width: 16 },
    { header: "Category", key: "category", width: 26 },
    { header: "Person", key: "person", width: 16 },
    { header: "Company / project", key: "project", width: 18 },
    { header: "Note", key: "note", width: 44 },
  ];
  for (const t of txs) {
    const sign = t.type === "expense" ? -1 : 1;
    const r = ws.addRow({
      date: toDate(t.date as string),
      type: t.type === "income" ? "Income" : t.type === "expense" ? "Expense" : "Transfer",
      amount: sign * (t.amount as number),
      currency: accCur(t.account_id),
      incur: t.type === "transfer" ? null : sign * inCur(t.amount as number, t.account_id),
      account: name(accounts, t.account_id),
      to: name(accounts, t.to_account_id),
      category: `${catIcon(t.category_id)} ${catLabel(t.category_id)}`.trim(),
      person: name(people, t.person_id),
      project: name(projects, t.project_id),
      note: t.note ?? "",
    });
    if (t.type === "income") r.getCell("amount").font = { color: { argb: "FF15803D" } };
    if (t.type === "transfer") r.getCell("amount").font = { color: { argb: "FF6C707B" } };
  }
  styleHeader(ws);
  freezeAndFilter(ws, 11);

  // ---------- Monthly ----------
  const ms = wb.addWorksheet("Monthly");
  ms.columns = [
    { header: "Month", key: "month", width: 12 },
    { header: `Income (${cur})`, key: "income", width: 16, style: { numFmt: MONEY } },
    { header: `Spending (${cur})`, key: "expense", width: 16, style: { numFmt: MONEY } },
    { header: `Kept (${cur})`, key: "kept", width: 16, style: { numFmt: MONEY } },
    { header: "Kept %", key: "pct", width: 10, style: { numFmt: "0%" } },
    { header: `To savings (${cur})`, key: "sav", width: 18, style: { numFmt: MONEY } },
  ];
  const savingsIds = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
  let ti = 0, te = 0, ts = 0;
  for (const m of months) {
    const s = monthStats(m);
    let sav = 0;
    for (const t of txs) {
      if (t.type === "transfer" && (t.date as string).startsWith(m) && savingsIds.has(t.to_account_id) && !savingsIds.has(t.account_id)) sav += inCur(t.amount as number, t.account_id);
    }
    ti += s.income; te += s.expense; ts += sav;
    ms.addRow({ month: monthLabel(m), income: s.income, expense: s.expense, kept: s.kept, pct: s.income ? s.kept / s.income : 0, sav });
  }
  const mt = totalRow(ms, ["Total", ti, te, ti - te, ti ? (ti - te) / ti : 0, ts]);
  [2, 3, 4, 6].forEach((i) => (mt.getCell(i).numFmt = MONEY));
  mt.getCell(5).numFmt = "0%";
  styleHeader(ms);
  freezeAndFilter(ms, 6);

  // ---------- Category × month matrices ----------
  const matrix = (title: string, kind: "income" | "expense", keyOf: (t: Row) => string) => {
    const sheet = wb.addWorksheet(title);
    const table = new Map<string, Map<string, number>>();
    for (const t of txs) {
      if (t.type !== kind) continue;
      const k = keyOf(t);
      const m = (t.date as string).slice(0, 7);
      const row = table.get(k) ?? new Map<string, number>();
      row.set(m, (row.get(m) ?? 0) + inCur(t.amount as number, t.account_id));
      table.set(k, row);
    }
    const rows = [...table.entries()].map(([k, m]) => ({ k, m, total: [...m.values()].reduce((s, v) => s + v, 0) })).sort((a, b) => b.total - a.total);
    sheet.columns = [{ width: 28 }, { width: 14 }, ...months.map(() => ({ width: 11 }))];
    sheet.addRow([title.replace(/ \(.*\)$/, ""), `Total (${cur})`, ...months.map(monthLabel)]);
    styleHeader(sheet);
    for (const r of rows) {
      const row = sheet.addRow([r.k, r.total, ...months.map((m) => r.m.get(m) ?? null)]);
      for (let i = 2; i <= months.length + 2; i++) row.getCell(i).numFmt = MONEY;
    }
    const tr = totalRow(sheet, ["Total", rows.reduce((s, r) => s + r.total, 0), ...months.map((m) => rows.reduce((s, r) => s + (r.m.get(m) ?? 0), 0))]);
    for (let i = 2; i <= months.length + 2; i++) tr.getCell(i).numFmt = MONEY;
    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  };
  matrix("Spending by category", "expense", (t) => `${catIcon(t.category_id)} ${catLabel(t.category_id) || "Uncategorised"}`.trim());
  matrix("Income by source", "income", (t) => `${catIcon(t.category_id)} ${catLabel(t.category_id) || "Uncategorised"}`.trim());
  matrix("Income by company", "income", (t) => name(projects, t.project_id) || "No company");
  matrix("Spending by account", "expense", (t) => name(accounts, t.account_id) || "?");
  matrix("Paid to people", "expense", (t) => name(people, t.person_id) || "Nobody in particular");

  // ---------- Payments to people (bills) ----------
  const bs = wb.addWorksheet("Payments");
  bs.columns = [
    { header: "Due date", key: "due", width: 12, style: { numFmt: "yyyy-mm-dd" } },
    { header: "Who pays", key: "direction", width: 12 },
    { header: "Title", key: "title", width: 24 },
    { header: "Person", key: "person", width: 16 },
    { header: "Category", key: "category", width: 22 },
    { header: "Currency", key: "currency", width: 9 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: MONEY } },
    { header: "Paid", key: "paid", width: 14, style: { numFmt: MONEY } },
    { header: "Remaining", key: "remaining", width: 14, style: { numFmt: MONEY } },
    { header: "Repeat", key: "recurrence", width: 10 },
    { header: "Status", key: "status", width: 10 },
    { header: "Note", key: "note", width: 30 },
  ];
  for (const b of bills) {
    const paid = billPaid(b.id as number);
    bs.addRow({
      due: toDate(b.due_date as string),
      direction: b.direction === "in" ? "They pay me" : "I pay",
      title: b.title,
      person: name(people, b.person_id),
      category: catLabel(b.category_id),
      currency: (b.currency as string | null) || main,
      amount: b.amount,
      paid,
      remaining: Math.max(0, (b.amount as number) - paid),
      recurrence: b.recurrence,
      status: b.status,
      note: b.note ?? "",
    });
  }
  styleHeader(bs);
  freezeAndFilter(bs, 12);

  // ---------- Accounts ----------
  const as = wb.addWorksheet("Accounts");
  as.columns = [
    { header: "Account", key: "name", width: 20 },
    { header: "Type", key: "type", width: 10 },
    { header: "Currency", key: "currency", width: 9 },
    { header: "Opening balance", key: "opening", width: 16, style: { numFmt: MONEY } },
    { header: "Balance", key: "balance", width: 16, style: { numFmt: MONEY } },
    { header: `In ${cur}`, key: "incur", width: 16, style: { numFmt: MONEY } },
    { header: "Archived", key: "archived", width: 10 },
  ];
  for (const a of accounts) {
    const bal = balance(a);
    as.addRow({ name: a.name, type: a.type, currency: accCur(a.id), opening: a.opening_balance, balance: bal, incur: convert(bal, accCur(a.id), cur), archived: a.archived ? "yes" : "" });
  }
  styleHeader(as);

  return wb;
}
