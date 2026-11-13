# My money

A personal finance app for **one user**. One login, one dashboard, one transaction history.
It tracks your salary, other income, personal spending, savings, and payments to people.
Open it through your private link, install it from the browser on your phone or computer,
and the same account syncs your records across devices.

## What it does

| Screen | What it shows |
|---|---|
| **Home** | Available money after setting aside upcoming payments, total money, savings, this month's income / spending / kept, expected salary, upcoming payments, recent transactions. Three quick actions: **Add income**, **Add expense**, **Record payment**. |
| **Transactions** | Add income, expenses and transfers. Browse by month, filter by type, account, category, person, project, or search. Tap any row to edit or delete. |
| **People & Bills** | Who you need to pay, how much and when. Recurring payments, advances and partial payments. Per-person history. Bills not tied to a person (rent, subscriptions) work too. |
| **Accounts & Savings** | Balances for cash, bank and savings accounts. Savings goals with progress and a "per month" estimate. Transfers between accounts. |
| **Reports** | Income vs spending per month, where the money goes by category and by person, 12-month trend, project profit, export to Excel. |
| **Settings** | Your name, currency, number format, salary (amount, payday, account), editable categories, projects, backup / restore, password, install instructions. |

### How the money logic works

- **Salary.** Set the usual amount and payday in Settings. Home shows it as *expected* until you tap **It arrived**, which records the actual amount into the account that received it.
- **Payments to people.** Schedule a payment with a person, amount, due date and whether it repeats. Owe 4,000 and pay 1,500 in advance? It shows **2,500 remaining**. Your balance only drops by what you actually paid. When a recurring payment is fully paid, the next occurrence is scheduled automatically. You can also **skip** an occurrence or cancel it.
- **Spending.** Every expense updates the account balance and the month's spending. A scheduled bill only becomes spending once you record the payment.
- **Savings and transfers.** Moving 500 from bank to savings reduces the bank balance and increases savings. Total money and monthly spending do not change.
- **Side work.** Create a project and tag its income and costs. A project with 5,000 in and 1,500 out shows **3,500 profit**. Your monthly surplus ("Kept") is separate: all income received minus all expenses paid that month.
- **Available** on the home screen = money in cash + bank accounts, minus everything still owed that is due by the end of this month (including overdue).

## Tech

- **Server:** Node 22+/24, Express, SQLite via the built-in `node:sqlite` (no native modules), bcrypt-hashed password, cookie sessions, Excel export with ExcelJS.
- **Client:** React + TypeScript + Vite, installable PWA (service worker, manifest, icons). Works offline in read-only mode with the last synced data.
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
docker build -t money-flow .
docker run -d -p 3000:3000 -v money-flow-data:/data -e COOKIE_SECURE=true money-flow
```

The image stores the database in `/data`. Mount a volume there.

**Plain Node on a VPS:**

```bash
npm ci && npm run build
DATA_DIR=/var/lib/money-flow COOKIE_SECURE=true PORT=3000 node dist/server/index.js
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
