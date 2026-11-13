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
}

export interface Category {
  id: number;
  name: string;
  kind: "income" | "expense";
  icon: string | null;
  archived: number;
  sort: number;
  system: string | null;
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
  /** How many units of the main currency one unit of the secondary currency is worth. */
  secondary_rate?: string;
  secondary_rate_date?: string;
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
