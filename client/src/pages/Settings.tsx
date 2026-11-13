import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { categoryGroups } from "../lib/money";
import type { Category, Project } from "../lib/types";
import { CategoryForm, ProjectForm } from "../components/EntityForms";
import { Field, Sheet } from "../components/ui";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "PLN", "CZK", "RON", "MDL", "UAH", "RUB", "TRY", "AED", "ILS", "SEK", "NOK", "DKK", "CAD", "AUD", "JPY", "INR"];

export function Settings() {
  const { state, run, logout, refresh, toast, currency: mainCurrency, auth, refreshAuth } = useData();
  const [emailForm, setEmailForm] = useState(false);
  const s = state.settings;
  const [ownerName, setOwnerName] = useState(s.owner_name ?? "");
  const [currency, setCurrency] = useState(s.currency ?? "EUR");
  const [locale, setLocale] = useState(s.locale ?? "en-GB");
  const [salaryAmount, setSalaryAmount] = useState(s.salary_amount ?? "");
  const [salaryPayday, setSalaryPayday] = useState(s.salary_payday ?? "");
  const [salaryAccount, setSalaryAccount] = useState(s.salary_account_id ?? "");
  const [secCurrency, setSecCurrency] = useState(s.secondary_currency ?? "");
  const [secRate, setSecRate] = useState(s.secondary_rate ?? "");
  const [secDate, setSecDate] = useState(s.secondary_rate_date ?? "");
  const [secManual, setSecManual] = useState(s.secondary_rate_manual === "1");
  const [fetchingRate, setFetchingRate] = useState(false);
  const [editCat, setEditCat] = useState<{ existing?: Category; kind: "income" | "expense"; parentId?: number } | null>(null);
  const [editProject, setEditProject] = useState<Project | null | "new">(null);
  const [pwd, setPwd] = useState(false);
  const [showArchivedCats, setShowArchivedCats] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  async function saveGeneral(e: FormEvent) {
    e.preventDefault();
    await run(() => api.put("/api/settings", { owner_name: ownerName, currency, locale }), "Saved");
  }
  async function saveSalary(e: FormEvent) {
    e.preventDefault();
    await run(
      () => api.put("/api/settings", { salary_amount: salaryAmount, salary_payday: salaryPayday, salary_account_id: salaryAccount }),
      "Salary settings saved",
    );
  }

  async function saveSecondary(e: FormEvent) {
    e.preventDefault();
    await run(
      () =>
        api.put("/api/settings", {
          secondary_currency: secCurrency,
          secondary_rate_manual: secManual ? "1" : "",
          ...(secManual ? { secondary_rate: secCurrency ? secRate : "", secondary_rate_date: secCurrency ? secDate : "" } : {}),
        }),
      secCurrency ? `Amounts will also show in ${secCurrency}` : "Second currency removed",
    );
  }

  async function fetchRate() {
    if (!secCurrency) return;
    setFetchingRate(true);
    try {
      const r = await api.get<{ rate: number; date: string }>(`/api/rates?base=${mainCurrency}&quote=${secCurrency}`);
      setSecRate(String(Math.round(r.rate * 10000) / 10000));
      setSecDate(r.date);
      toast(`1 ${mainCurrency} = ${r.rate.toFixed(4)} ${secCurrency} (${r.date}). Press Save to keep it.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setFetchingRate(false);
    }
  }

  async function restore(file: File) {
    if (!window.confirm("Restoring replaces ALL current data with the backup. Continue?")) return;
    try {
      const data = JSON.parse(await file.text());
      await api.post("/api/restore", data);
      await refresh();
      toast("Backup restored");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

  return (
    <>
      <div className="main">
        <h1 className="mb">Settings</h1>

        {!isStandalone && (
          <div className="card">
            <div className="card-title">
              <h2>Install on this device</h2>
            </div>
            {installEvt ? (
              <button
                className="btn primary block"
                onClick={async () => {
                  await installEvt.prompt();
                  setInstallEvt(null);
                }}
              >
                Install app
              </button>
            ) : (
              <p className="small muted">
                <b>iPhone / iPad:</b> open this page in Safari, tap Share, then “Add to Home Screen”.
                <br />
                <b>Android:</b> open the browser menu and choose “Install app” or “Add to Home screen”.
                <br />
                <b>Computer:</b> in Chrome or Edge, click the install icon at the right end of the address bar.
              </p>
            )}
          </div>
        )}

        <form className="card" onSubmit={saveGeneral}>
          <div className="card-title">
            <h2>General</h2>
          </div>
          <Field label="Your name (for the greeting)">
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={40} placeholder="Peter" />
          </Field>
          <div className="grid2">
            <Field label="Currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Number & date format">
              <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="en-GB">English (UK)</option>
                <option value="en-US">English (US)</option>
                <option value="de-DE">Deutsch</option>
                <option value="fr-FR">Français</option>
                <option value="ro-RO">Română</option>
                <option value="ru-RU">Русский</option>
                <option value="uk-UA">Українська</option>
                <option value="pl-PL">Polski</option>
              </select>
            </Field>
          </div>
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>

        <form className="card" onSubmit={saveSalary}>
          <div className="card-title">
            <h2>My salary</h2>
          </div>
          <p className="small muted mb">The home screen shows the salary as expected until you confirm it arrived. Then the actual amount is added to the account.</p>
          <div className="grid2">
            <Field label={`Usual amount (${state.accounts.find((a) => String(a.id) === salaryAccount)?.currency ?? mainCurrency})`}>
              <input type="number" inputMode="decimal" step="0.01" min="0" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Payday (day of month)">
              <input type="number" min="1" max="31" value={salaryPayday} onChange={(e) => setSalaryPayday(e.target.value)} placeholder="25" />
            </Field>
          </div>
          <Field label="Paid into">
            <select value={salaryAccount} onChange={(e) => setSalaryAccount(e.target.value)}>
              <option value="">Choose at confirmation</option>
              {state.accounts
                .filter((a) => !a.archived && a.type !== "savings")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>

        <form className="card" onSubmit={saveSecondary}>
          <div className="card-title">
            <h2>Second currency</h2>
          </div>
          <p className="small muted mb">
            Totals are shown in <b>{mainCurrency}</b>. Pick a second currency to keep accounts in either one (for example a bank account in MDL and one in EUR) and to see every amount converted, side by side.
          </p>
          <div className="grid2">
            <Field label="Show amounts also in">
              <select value={secCurrency} onChange={(e) => setSecCurrency(e.target.value)}>
                <option value="">Off</option>
                {CURRENCIES.filter((c) => c !== mainCurrency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={secCurrency ? `1 ${mainCurrency} = … ${secCurrency}` : "Exchange rate"}
              hint={secManual ? (secDate ? `Your rate from ${secDate}` : undefined) : s.secondary_rate ? `Updated automatically every day. Current: 1 ${mainCurrency} = ${s.secondary_rate} ${secCurrency} (${s.secondary_rate_date ?? "today"})` : "Fetched automatically once you save."}
            >
              <input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="0"
                value={secManual ? secRate : (s.secondary_rate ?? "")}
                onChange={(e) => setSecRate(e.target.value)}
                disabled={!secCurrency || !secManual}
                placeholder="20.10"
              />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={secManual} onChange={(e) => setSecManual(e.target.checked)} disabled={!secCurrency} /> I want to set the rate myself
          </label>
          <div className="flex wrap">
            <button className="btn primary" type="submit">
              Save
            </button>
            {secManual && (
              <button className="btn" type="button" onClick={fetchRate} disabled={!secCurrency || fetchingRate}>
                {fetchingRate ? "Fetching…" : "Fill in today's rate"}
              </button>
            )}
          </div>
        </form>

        {(["expense", "income"] as const).map((kind) => {
          const groups = categoryGroups(state.categories, kind, showArchivedCats ? -1 : undefined).filter(
            (g) => showArchivedCats || !g.parent.archived,
          );
          const visible = (c: Category) => showArchivedCats || !c.archived;
          return (
            <div className="card" key={kind}>
              <div className="card-title">
                <h2>{kind === "expense" ? "Spending categories" : "Income categories"}</h2>
                <button className="btn sm" onClick={() => setEditCat({ kind })}>
                  + Add
                </button>
              </div>
              <div className="cat-tree">
                {groups.map(({ parent, children }) => (
                  <div key={parent.id} className="cat-row">
                    <button className="chip" style={{ opacity: parent.archived ? 0.5 : 1 }} onClick={() => setEditCat({ existing: parent, kind })}>
                      {parent.icon} {parent.name}
                    </button>
                    {children.filter(visible).map((c) => (
                      <button key={c.id} className="chip sub" style={{ opacity: c.archived ? 0.5 : 1 }} onClick={() => setEditCat({ existing: c, kind })}>
                        {c.icon} {c.name}
                      </button>
                    ))}
                    {kind === "expense" && (
                      <button className="chip ghost" title={`Add a sub-category under ${parent.name}`} onClick={() => setEditCat({ kind, parentId: parent.id })}>
                        +
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <button className="btn ghost sm mb" onClick={() => setShowArchivedCats((v) => !v)}>
          {showArchivedCats ? "Hide" : "Show"} archived categories
        </button>

        <div className="card">
          <div className="card-title">
            <h2>Projects (side work)</h2>
            <button className="btn sm" onClick={() => setEditProject("new")}>
              + Add
            </button>
          </div>
          {state.projects.length === 0 ? (
            <p className="small muted">Create a project, then tag its income and costs when adding transactions. Reports show the profit per project.</p>
          ) : (
            <div className="chips">
              {state.projects.map((p) => (
                <button key={p.id} className="chip" style={{ opacity: p.status === "done" ? 0.6 : 1 }} onClick={() => setEditProject(p)}>
                  📁 {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Data</h2>
          </div>
          <div className="flex wrap">
            <a className="btn" href="/api/export.xlsx" download>
              ⬇ Export to Excel
            </a>
            <a className="btn" href="/api/backup" download>
              ⬇ Download backup
            </a>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              ⬆ Restore backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restore(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Security</h2>
          </div>
          <p className="small muted mb">
            Login email: <b>{auth?.email || "not set"}</b>
          </p>
          <div className="flex wrap">
            <button className="btn" onClick={() => setPwd(true)}>
              Change password
            </button>
            <button className="btn" onClick={() => setEmailForm(true)}>
              Change email
            </button>
            <button className="btn danger" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {editCat && <CategoryForm existing={editCat.existing} kind={editCat.kind} presetParentId={editCat.parentId} onClose={() => setEditCat(null)} />}
      {editProject && <ProjectForm existing={editProject === "new" ? undefined : editProject} onClose={() => setEditProject(null)} />}
      {pwd && <PasswordForm onClose={() => setPwd(false)} />}
      {emailForm && (
        <EmailForm
          current={auth?.email || ""}
          onClose={() => {
            setEmailForm(false);
            refreshAuth();
          }}
        />
      )}
    </>
  );
}

function EmailForm({ current, onClose }: { current: string; onClose: () => void }) {
  const { toast } = useData();
  const [email, setEmail] = useState(current);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/email", { current: password, email });
      try {
        localStorage.setItem("pmf_email", email.trim());
      } catch {
        /* ignore */
      }
      toast("Login email updated");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Sheet title="Change login email" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </Field>
        <Field label="Current password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <div className="form-actions">
          <button className="btn primary" type="submit">
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const { toast } = useData();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("New passwords do not match");
    try {
      await api.post("/api/password", { current, next });
      toast("Password changed");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Sheet title="Change password" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <Field label="Current password">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label="New password">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} autoComplete="new-password" />
        </Field>
        <Field label="Repeat new password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password" />
        </Field>
        <div className="form-actions">
          <button className="btn primary" type="submit">
            Change
          </button>
        </div>
      </form>
    </Sheet>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
