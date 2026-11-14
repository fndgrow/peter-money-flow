import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/store";
import { billPaidMap, billRemaining, daysBetween, formatDate, todayStr } from "../lib/money";
import type { Bill, Person } from "../lib/types";
import { BillForm, PayBillForm } from "../components/BillForms";
import { PersonForm } from "../components/EntityForms";
import { Empty, Money, Progress, Sheet } from "../components/ui";
import { TxRow } from "./Transactions";
import { TransactionForm } from "../components/TransactionForm";
import type { Transaction } from "../lib/types";

type Tab = "due" | "owed" | "people" | "history";

export function People() {
  const { state, fmt, fmtIn, conv, currency, locale, run } = useData();
  const today = todayStr();
  const paid = useMemo(() => billPaidMap(state), [state]);
  const accCur = (accountId: number) => state.accounts.find((a) => a.id === accountId)?.currency || currency;
  const [tab, setTab] = useState<Tab>("due");
  const [newBill, setNewBill] = useState<{ personId?: number; direction?: "out" | "in" } | null>(null);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [billMenu, setBillMenu] = useState<Bill | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null | "new">(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);

  const openAll = state.bills.filter((b) => b.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const open = openAll.filter((b) => b.direction !== "in"); // what I have to pay
  const owedIn = openAll.filter((b) => b.direction === "in"); // what people owe me
  const overdue = open.filter((b) => b.due_date < today);
  const later = open.filter((b) => b.due_date >= today);
  const closed = state.bills.filter((b) => b.status !== "open").sort((a, b) => b.due_date.localeCompare(a.due_date));
  const totalOwed = open.reduce((s, b) => s + conv(billRemaining(b, paid), b.currency, currency), 0);
  const totalOwedToMe = owedIn.reduce((s, b) => s + conv(billRemaining(b, paid), b.currency, currency), 0);

  const personStats = useMemo(() => {
    const m = new Map<number, { owed: number; owesMe: number; paid: number; count: number }>();
    for (const p of state.people) m.set(p.id, { owed: 0, owesMe: 0, paid: 0, count: 0 });
    for (const b of state.bills) {
      if (b.person_id === null) continue;
      const s = m.get(b.person_id);
      if (!s) continue;
      if (b.status === "open") {
        if (b.direction === "in") s.owesMe += conv(billRemaining(b, paid), b.currency, currency);
        else s.owed += conv(billRemaining(b, paid), b.currency, currency);
      }
    }
    for (const t of state.transactions) {
      if (t.person_id === null || t.type !== "expense") continue;
      const s = m.get(t.person_id);
      if (!s) continue;
      s.paid += conv(t.amount, accCur(t.account_id), currency);
      s.count += 1;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, paid, currency]);

  function personName(id: number | null) {
    return id ? state.people.find((p) => p.id === id)?.name : undefined;
  }
  /** Who the record is with: the person, or the company when it is a company that owes me. */
  function whoName(b: Bill) {
    return personName(b.person_id) ?? (b.project_id ? state.projects.find((p) => p.id === b.project_id)?.name : undefined);
  }

  function BillItem({ b }: { b: Bill }) {
    const rem = billRemaining(b, paid);
    const d = daysBetween(today, b.due_date);
    const cat = state.categories.find((c) => c.id === b.category_id);
    return (
      <button className="row-item" onClick={() => setBillMenu(b)}>
        <div className="ic">{b.direction === "in" ? (b.project_id ? "🏢" : "🤝") : (cat?.icon ?? "👤")}</div>
        <div className="body">
          <div className="t">{b.title}</div>
          <div className="s">
            {whoName(b) ? `${whoName(b)} · ` : ""}
            {b.status !== "open" ? (
              <span className={b.status === "paid" ? "income" : "muted"}>
                {b.status === "paid" ? (b.direction === "in" ? "Received" : "Paid") : "Cancelled"} · {formatDate(b.due_date, locale)}
              </span>
            ) : b.direction === "in" ? (
              d < 0 ? <span className="warn bold">{-d}d late</span> : `expected ${formatDate(b.due_date, locale)}`
            ) : d < 0 ? (
              <span className="expense bold">{-d}d overdue</span>
            ) : d === 0 ? (
              <span className="warn bold">Due today</span>
            ) : (
              `Due ${formatDate(b.due_date, locale)}`
            )}
            {b.recurrence !== "none" ? ` · ${b.recurrence}` : ""}
          </div>
          {b.status === "open" && rem < b.amount - 0.004 && (
            <div className="mt" style={{ marginTop: 6 }}>
              <Progress value={b.amount - rem} max={b.amount} good />
            </div>
          )}
        </div>
        <div className={`amt ${b.direction === "in" ? "income" : ""}`}>
          {b.status === "open" ? fmtIn(b.currency)(rem) : fmtIn(b.currency)(b.amount)}
          {b.status === "open" && rem < b.amount - 0.004 && <span className="sub">of {fmtIn(b.currency)(b.amount)}</span>}
        </div>
      </button>
    );
  }

  const personBills = person ? state.bills.filter((b) => b.person_id === person.id).sort((a, b) => b.due_date.localeCompare(a.due_date)) : [];
  const personTxs = person ? state.transactions.filter((t) => t.person_id === person.id) : [];

  return (
    <>
      <div className="main">
        <div className="between mb">
          <h1>People & Bills</h1>
          {tab === "owed" ? (
            <button className="btn primary sm" onClick={() => setNewBill({ direction: "in" })}>
              + They owe me
            </button>
          ) : (
            <button className="btn primary sm" onClick={() => setNewBill({})}>
              + Schedule
            </button>
          )}
        </div>

        <div className="seg mb">
          <button className={tab === "due" ? "active" : ""} onClick={() => setTab("due")}>
            To pay
          </button>
          <button className={tab === "owed" ? "active in" : ""} onClick={() => setTab("owed")}>
            Owed to me
          </button>
          <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>
            People
          </button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            History
          </button>
        </div>

        {tab === "due" && (
          <>
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="stat">
                <div className="k">Still owed</div>
                <div className="v">{fmt(totalOwed)}</div>
              </div>
              <div className="stat">
                <div className="k">Overdue</div>
                <div className={`v ${overdue.length ? "expense" : ""}`}>{overdue.length}</div>
              </div>
            </div>
            {overdue.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <h2 className="expense">Overdue</h2>
                </div>
                <div className="list">
                  {overdue.map((b) => (
                    <BillItem key={b.id} b={b} />
                  ))}
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-title">
                <h2>Upcoming</h2>
              </div>
              {later.length === 0 ? (
                <Empty>Nothing scheduled. Tap “+ Schedule” to add a payment you owe someone, or a recurring bill.</Empty>
              ) : (
                <div className="list">
                  {later.map((b) => (
                    <BillItem key={b.id} b={b} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === "owed" && (
          <>
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="stat">
                <div className="k">Owed to me</div>
                <div className="v income">{fmt(totalOwedToMe)}</div>
              </div>
              <div className="stat">
                <div className="k">Open</div>
                <div className="v">{owedIn.length}</div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">
                <h2>Waiting to be paid</h2>
              </div>
              {owedIn.length === 0 ? (
                <Empty>Nobody owes you anything right now. Tap “+ They owe me” when you did a service and haven't been paid yet.</Empty>
              ) : (
                <div className="list">
                  {owedIn.map((b) => (
                    <BillItem key={b.id} b={b} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === "people" && (
          <div className="card">
            <div className="card-title">
              <h2>People you pay</h2>
              <button className="btn sm" onClick={() => setEditPerson("new")}>
                + Person
              </button>
            </div>
            {state.people.filter((p) => !p.archived).length === 0 ? (
              <Empty>No people yet. They are added automatically when you schedule a payment, or add one here.</Empty>
            ) : (
              <div className="list">
                {state.people
                  .filter((p) => !p.archived)
                  .map((p) => {
                    const s = personStats.get(p.id)!;
                    return (
                      <button key={p.id} className="row-item" onClick={() => setPerson(p)}>
                        <div className="ic">{p.name.slice(0, 1).toUpperCase()}</div>
                        <div className="body">
                          <div className="t">{p.name}</div>
                          <div className="s">
                            {fmt(s.paid)} paid · {s.count} payment{s.count === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="amt">
                          {s.owed > 0 ? (
                            <>
                              <span className="warn">{fmt(s.owed)}</span>
                              <span className="sub">I owe</span>
                            </>
                          ) : s.owesMe > 0 ? (
                            <>
                              <span className="income">{fmt(s.owesMe)}</span>
                              <span className="sub">owes me</span>
                            </>
                          ) : (
                            <span className="pill good">Settled</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="card">
            <div className="card-title">
              <h2>Paid & cancelled</h2>
            </div>
            {closed.length === 0 ? (
              <Empty>Paid bills will appear here.</Empty>
            ) : (
              <div className="list">
                {closed.map((b) => (
                  <BillItem key={b.id} b={b} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {billMenu && (
        <Sheet title={billMenu.title} onClose={() => setBillMenu(null)}>
          <div className="card flat">
            <div className="between">
              <span className="muted">Amount</span>
              <Money value={billMenu.amount} currency={billMenu.currency} />
            </div>
            <div className="between">
              <span className="muted">{billMenu.direction === "in" ? "Received so far" : "Paid so far"}</span>
              <Money value={paid.get(billMenu.id) ?? 0} currency={billMenu.currency} />
            </div>
            <div className="between bold">
              <span>{billMenu.direction === "in" ? "Still owed to me" : "Remaining"}</span>
              <Money value={billRemaining(billMenu, paid)} currency={billMenu.currency} />
            </div>
            <div className="between">
              <span className="muted">{billMenu.direction === "in" ? "Expected by" : "Due"}</span>
              <span>{formatDate(billMenu.due_date, locale, { day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
            {billMenu.note && <div className="small muted mt">{billMenu.note}</div>}
          </div>
          {state.transactions.filter((t) => t.bill_id === billMenu.id).length > 0 && (
            <div className="card flat">
              <div className="tiny muted bold mb">PAYMENTS</div>
              <div className="list">
                {state.transactions
                  .filter((t) => t.bill_id === billMenu.id)
                  .map((t) => (
                    <TxRow
                      key={t.id}
                      t={t}
                      onClick={() => {
                        setBillMenu(null);
                        setEditTx(t);
                      }}
                    />
                  ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {billMenu.status === "open" && (
              <button
                className="btn primary"
                onClick={() => {
                  const b = billMenu;
                  setBillMenu(null);
                  setPaying(b);
                }}
              >
                {billMenu.direction === "in" ? "They paid me" : "Record a payment"}
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                const b = billMenu;
                setBillMenu(null);
                setEditBill(b);
              }}
            >
              Edit
            </button>
            {billMenu.status === "open" && billMenu.recurrence !== "none" && (
              <button
                className="btn"
                onClick={async () => {
                  const b = billMenu;
                  setBillMenu(null);
                  await run(() => api.post(`/api/bills/${b.id}/skip`), "Skipped. Next one scheduled.");
                }}
              >
                Skip this time
              </button>
            )}
            {billMenu.direction === "in" ? (
              <button
                className="btn danger"
                onClick={async () => {
                  const b = billMenu;
                  if (!window.confirm(`Delete "${b.title}"? Anything already received stays in your income.`)) return;
                  setBillMenu(null);
                  await run(() => api.del(`/api/bills/${b.id}`), "Deleted");
                }}
              >
                Delete
              </button>
            ) : billMenu.status === "open" ? (
              <button
                className="btn danger"
                onClick={async () => {
                  const b = billMenu;
                  setBillMenu(null);
                  await run(() => api.post(`/api/bills/${b.id}/status`, { status: "cancelled" }), "Cancelled");
                }}
              >
                Cancel this payment
              </button>
            ) : billMenu.status === "cancelled" ? (
              <button
                className="btn"
                onClick={async () => {
                  const b = billMenu;
                  setBillMenu(null);
                  await run(() => api.post(`/api/bills/${b.id}/status`, { status: "open" }), "Reopened");
                }}
              >
                Reopen
              </button>
            ) : null}
          </div>
        </Sheet>
      )}

      {person && (
        <Sheet title={person.name} onClose={() => setPerson(null)}>
          {person.note && <div className="banner accent">{person.note}</div>}
          <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="stat">
              <div className="k">Still owed</div>
              <div className="v warn">{fmt(personStats.get(person.id)?.owed ?? 0)}</div>
            </div>
            <div className="stat">
              <div className="k">Paid in total</div>
              <div className="v">{fmt(personStats.get(person.id)?.paid ?? 0)}</div>
            </div>
          </div>
          <div className="flex mb">
            <button
              className="btn primary grow"
              onClick={() => {
                const p = person;
                setPerson(null);
                setNewBill({ personId: p.id });
              }}
            >
              + Schedule payment
            </button>
            <button
              className="btn"
              onClick={() => {
                const p = person;
                setPerson(null);
                setEditPerson(p);
              }}
            >
              Edit
            </button>
          </div>
          {personBills.length > 0 && (
            <div className="card flat">
              <div className="tiny muted bold mb">SCHEDULED</div>
              <div className="list">
                {personBills.map((b) => (
                  <BillItem key={b.id} b={b} />
                ))}
              </div>
            </div>
          )}
          <div className="card flat">
            <div className="tiny muted bold mb">PAYMENT HISTORY</div>
            {personTxs.length === 0 ? (
              <Empty>No payments recorded yet.</Empty>
            ) : (
              <div className="list">
                {personTxs.map((t) => (
                  <TxRow
                    key={t.id}
                    t={t}
                    onClick={() => {
                      setPerson(null);
                      setEditTx(t);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </Sheet>
      )}

      {newBill && <BillForm presetPersonId={newBill.personId} direction={newBill.direction} onClose={() => setNewBill(null)} />}
      {editBill && <BillForm existing={editBill} onClose={() => setEditBill(null)} />}
      {paying && <PayBillForm bill={paying} onClose={() => setPaying(null)} />}
      {editPerson && <PersonForm existing={editPerson === "new" ? undefined : editPerson} onClose={() => setEditPerson(null)} />}
      {editTx && <TransactionForm existing={editTx} onClose={() => setEditTx(null)} />}
    </>
  );
}
