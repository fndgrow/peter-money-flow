export type AccountType = "cash" | "bank" | "savings";
export type TxType = "income" | "expense" | "transfer";
export type Recurrence = "none" | "weekly" | "monthly" | "yearly";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  opening_balance: number;
  archived: number;
  sort: number;
  /** Currency this account is kept in, e.g. "MDL" or "EUR". */
  currency: string;
}

export interface Category {
  id: number;
  name: string;
  kind: "income" | "expense";
  icon: string | null;
  archived: number;
  sort: number;
  system: string | null;
  /** Top-level category this one belongs to (one level of nesting), or null. */
  parent_id: number | null;
}

export interface Person {
  id: number;
  name: string;
  note: string | null;
  archived: number;
}

export interface Project {
  id: number;
  name: string;
  status: "active" | "done";
  note: string | null;
}

export interface Bill {
  id: number;
  title: string;
  person_id: number | null;
  category_id: number | null;
  amount: number;
  due_date: string;
  recurrence: Recurrence;
  status: "open" | "paid" | "cancelled";
  note: string | null;
  created_at: string;
  /** Currency the bill is owed in. */
  currency: string;
}

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  account_id: number | null;
  target_date: string | null;
  note: string | null;
}

export interface Transaction {
  id: number;
  type: TxType;
  amount: number;
  date: string;
  account_id: number;
  to_account_id: number | null;
  /** On a transfer between currencies: the amount received in the destination account's currency. */
  to_amount: number | null;
  category_id: number | null;
  person_id: number | null;
  bill_id: number | null;
  project_id: number | null;
  note: string | null;
  created_at: string;
}

export interface Settings {
  currency?: string;
  locale?: string;
  salary_amount?: string;
  salary_payday?: string;
  salary_account_id?: string;
  owner_name?: string;
  secondary_currency?: string;
  /** How many second-currency units one main unit buys (1 EUR = 20 MDL → "20"). */
  secondary_rate?: string;
  secondary_rate_date?: string;
  /** "1" when the user types the rate by hand instead of the automatic daily update. */
  secondary_rate_manual?: string;
}

export interface AppState {
  settings: Settings;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  projects: Project[];
  bills: Bill[];
  goals: Goal[];
  transactions: Transaction[];
}
