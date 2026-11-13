# My money

A personal finance app for **one user**. One login, one dashboard, one transaction history.
It tracks your salary, other income, personal spending, savings, and payments to people.
Open it through your private link, install it from the browser on your phone or computer,
and the same account syncs your records across devices.

## Intent

The app answers three questions the moment you open it on your phone:

1. **What do I have today?** Total money across cash, bank and savings.
2. **What do I still owe?** Scheduled payments to people and bills, with partial payments taken into account.
3. **How much have I kept this month?** Income received minus expenses paid.

It is deliberately small. There is no sign-up, no multi-user, no bank integration.
You record what happens with your money, and the app keeps the picture clear.
"Pay my people" means *tracking* what you owe and what you have paid to other people.
They appear in your payment list and do not need accounts. You pay them through your bank or in cash and record it here.

## Screens

| Screen | What it shows |
|---|---|
| **Home** | Available money after setting aside upcoming payments, total money, savings, this month's income / spending / kept, expected salary, upcoming payments, recent transactions. Three quick actions: **Add income**, **Add expense**, **Record payment**. |
| **Transactions** | Add income, expenses and transfers. Browse by month, filter by type, account, category, person, project, or search. Tap any row to edit or delete. |
| **People & Bills** | Who you need to pay, how much and when. Recurring payments, advances and partial payments. Per-person history. Bills not tied to a person (rent, subscriptions) work too. |
| **Accounts & Savings** | Balances for cash, bank and savings accounts. Savings goals with progress and a "per month" estimate. Transfers between accounts. |
| **Reports** | Income vs spending per month, where the money goes by category and by person, 12-month trend, project profit, export to Excel. |
| **Settings** | Your name, currency, number format, salary (amount, payday, account), editable categories, projects, backup / restore, password, install instructions. |

## How the app works

### The three building blocks

- **Accounts** hold money. Each has a type: cash, bank or savings. An account has an opening balance; everything after that comes from transactions. The balance is never stored, it is always computed, so nothing can drift out of sync.
- **Transactions** move money. There are exactly three kinds:
  - *Income* adds money to an account (salary, bonus, freelance, gifts...).
  - *Expense* removes money from an account. It has a spending category and optionally a person and a project.
  - *Transfer* moves money between two of your accounts. It changes neither your total money nor your monthly spending.
- **Bills** are promises, not money. A bill is something you will pay: to a person, or a recurring cost like rent. It has an amount, a due date and an optional repeat rule. A bill affects nothing until you record a payment against it.

### Money flows

**Salary.** Set the usual amount and payday in Settings. Home shows it as *expected* until you tap **It arrived**, which records an income transaction with the actual amount into the account that received it. Until then it is not counted anywhere.

**Payments to people.** Schedule a payment with a person, amount, due date and whether it repeats. Each payment you record creates an expense transaction linked to the bill. Owe 4,000 and pay 1,500 in advance? The bill shows **2,500 remaining**, and your account balance dropped by 1,500 only. When the remaining amount reaches zero the bill is marked paid. If it repeats, the next occurrence is created automatically (same amount, next week / month / year). You can also **skip** one occurrence or **cancel** a bill.

A bill carries a spending category. Paying someone to fix your car goes under **Car** in the reports, while the person's name stays in the payment history.

**Personal spending.** Enter amount, category and account. The transaction lowers the balance and raises this month's spending.

**Savings and transfers.** Moving 500 from bank to savings lowers the bank balance and raises the savings balance. Total money and monthly spending stay the same. Savings goals are linked to a savings account; the goal's progress is simply that account's balance.

**Side work.** Create a project and tag its income and costs. A project with 5,000 in and 1,500 out shows **3,500 profit**. Your monthly surplus ("Kept") is a separate figure: all income received minus all expenses paid that month, regardless of project.

### The numbers on the home screen

| Figure | How it is computed |
|---|---|
| Total money | Sum of all active account balances |
| In savings | Sum of balances of savings accounts |
| Owed this month | Remaining amount of open bills due by the end of this month, including overdue ones |
| **Available** | Cash + bank balances, minus *Owed this month* |
| Income / Spending | Income and expense transactions dated this month (transfers excluded) |
| Kept | Income minus Spending |

### Login and sync

There is one password, chosen on the first visit. Sessions last 90 days and are stored server-side, so you stay signed in on each device. All data lives on the server in one SQLite file, so every device sees the same records. The app shell and the last loaded data are cached, so it opens offline in read-only mode; changes need a connection.

## Project structure

```
.
├── server/                 Node + Express API (TypeScript)
│   ├── index.ts            starts the server, serves the built client, security headers
│   ├── db.ts               opens SQLite (node:sqlite), creates tables, seeds default categories/accounts
│   ├── auth.ts             password hashing (bcrypt), session cookies, login rate limit
│   └── routes.ts           all /api endpoints: auth, state, CRUD, bill payments, salary, backup, Excel export
├── client/                 React + Vite PWA (TypeScript)
│   ├── index.html
│   ├── vite.config.ts      Vite + PWA manifest and service worker config
│   ├── public/icons/       generated app icons
│   └── src/
│       ├── main.tsx        app entry, service worker registration
│       ├── App.tsx         auth gate, navigation, routes
│       ├── styles.css      design tokens, light/dark theme, layout, components
│       ├── lib/
│       │   ├── types.ts    shared data types (Account, Transaction, Bill, ...)
│       │   ├── api.ts      small fetch wrapper
│       │   ├── store.tsx   global state: auth, loaded data, refresh, toasts, offline flag
│       │   └── money.ts    all calculations: balances, month summary, overview, bill remaining
│       ├── components/
│       │   ├── ui.tsx              Sheet (bottom modal), Field, Progress, Toasts, icons
│       │   ├── TransactionForm.tsx add / edit income, expense, transfer
│       │   ├── BillForms.tsx       schedule a bill, record a payment, confirm salary
│       │   └── EntityForms.tsx     account, category, person, project, goal forms
│       └── pages/
│           ├── Login.tsx, Home.tsx, Transactions.tsx, People.tsx,
│           └── Accounts.tsx, Reports.tsx, Settings.tsx
├── scripts/make-icons.mjs  generates the PNG icons without any image library
├── data/                   SQLite database (created at first run, git-ignored)
├── Dockerfile              production image, database on /data
└── package.json            one package: scripts for dev, build, start
```

### Data model

| Table | Purpose |
|---|---|
| `user` | the single password hash |
| `sessions` | login tokens with expiry |
| `settings` | key/value: currency, locale, salary amount / payday / account, owner name |
| `accounts` | name, type (cash / bank / savings), opening balance, archived flag |
| `categories` | name, kind (income / expense), icon; two are marked `system` (salary, payments to people) and cannot be deleted |
| `people` | people you pay |
| `projects` | side work, for profit tracking |
| `bills` | scheduled payments: title, person, category, amount, due date, recurrence, status (open / paid / cancelled) |
| `goals` | savings goals linked to an account |
| `transactions` | every money movement: type, amount, date, account, to-account, category, person, bill, project, note |

### API overview

All endpoints are under `/api` and, except setup/login, require the session cookie.

| Endpoint | Purpose |
|---|---|
| `GET /me`, `POST /setup`, `POST /login`, `POST /logout`, `POST /password` | authentication |
| `GET /state` | everything in one call (settings, accounts, categories, people, projects, bills, goals, transactions) |
| `PUT /settings` | update settings |
| `POST/PUT/DELETE /accounts`, `/categories`, `/people`, `/projects`, `/goals`, `/bills`, `/transactions` | CRUD |
| `POST /bills/:id/payments` | record a (partial) payment; creates the expense and updates the bill |
| `POST /bills/:id/skip`, `POST /bills/:id/status` | skip one occurrence; cancel or reopen |
| `POST /salary/confirm` | record this month's salary |
| `GET /export.xlsx` | Excel workbook: transactions, monthly summary, by category, payments to people, accounts |
| `GET /backup`, `POST /restore` | full JSON backup and restore |

The client loads `/state` once, computes every figure locally (see `client/src/lib/money.ts`), and reloads it after each change. With one user and a few thousand transactions this is fast and keeps the logic in one place.

## Tech

- **Server:** Node 22+/24, Express, SQLite via the built-in `node:sqlite` (no native modules), bcrypt-hashed password, cookie sessions, Excel export with ExcelJS.
- **Client:** React + TypeScript + Vite, installable PWA (service worker, manifest, icons). Light and dark theme follow the system. Phone-first layout with a bottom tab bar; sidebar on wide screens.
- **Data:** a single SQLite file in `DATA_DIR` (default `./data`). Back it up from Settings or just copy the file.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first visit asks you to choose a password.

Production build and run:

```bash
npm run build
npm start          # http://localhost:3000
```

Environment variables (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where the SQLite file lives. Put it on a persistent volume in production. |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS (recommended; required for a reliable PWA install). |

## Deploy (your private link)

Any host that runs Node 22+ and gives you a persistent disk works. Two easy options:

**Docker** (Fly.io, Railway, Render, a VPS with Caddy or Nginx in front):

```bash
docker build -t my-money .
docker run -d -p 3000:3000 -v my-money-data:/data -e COOKIE_SECURE=true my-money
```

The image stores the database in `/data`. Mount a volume there.

**Plain Node on a VPS:**

```bash
npm ci && npm run build
DATA_DIR=/var/lib/my-money COOKIE_SECURE=true PORT=3000 node dist/server/index.js
```

Put it behind HTTPS (Caddy does this automatically) and keep the URL to yourself.
The app has no sign-up page: the first visitor sets the password, so deploy and set yours right away.

## Install on your phone or computer

- **iPhone / iPad:** open the link in Safari, tap Share, then *Add to Home Screen*.
- **Android:** open the link in Chrome, menu, *Install app*.
- **Windows / macOS:** in Chrome or Edge, click the install icon at the right end of the address bar.

Settings also shows an **Install app** button when the browser supports it.

## Ideas for later

- Bank import (CSV from your bank) to avoid typing transactions.
- Budgets per category with alerts.
- Push reminders before a payment is due.
- A direct **Pay** button (needs a bank or payment integration).
