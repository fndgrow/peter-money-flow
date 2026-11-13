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

type Tab = "due" | "people" | "history";

export function People() {
  const { state, fmt, locale, run } = useData();
  const today = todayStr();
  const paid = useMemo(() => billPaidMap(state.transactions), [state.transactions]);
  const [tab, setTab] = useState<Tab>("due");
  const [newBill, setNewBill] = useState<{ personId?: number } | null>(null);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [billMenu, setBillMenu] = useState<Bill | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null | "new">(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);

  const open = state.bills.filter((b) => b.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const overdue = open.filter((b) => b.due_date < today);
  const later = open.filter((b) => b.due_date >= today);
  const closed = state.bills.filter((b) => b.status !== "open").sort((a, b) => b.due_date.localeCompare(a.due_date));
  const totalOwed = open.reduce((s, b) => s + billRemaining(b, paid), 0);

  const personStats = useMemo(() => {
    const m = new Map<number, { owed: number; paid: number; count: number }>();
    for (const p of state.people) m.set(p.id, { owed: 0, paid: 0, count: 0 });
    for (const b of state.bills) {
      if (b.person_id === null) continue;
      const s = m.get(b.person_id);
      if (!s) continue;
      if (b.status === "open") s.owed += billRemaining(b, paid);
    }
    for (const t of state.transactions) {
      if (t.person_id === null || t.type !== "expense") continue;
      const s = m.get(t.person_id);
      if (!s) continue;
      s.paid += t.amount;
      s.count += 1;
    }
    return m;
  }, [state, paid]);

  function personName(id: number | null) {
    return id ? state.people.find((p) => p.id === id)?.name : undefined;
  }

  function BillItem({ b }: { b: Bill }) {
    const rem = billRemaining(b, paid);
    const d = daysBetween(today, b.due_date);
    const cat = state.categories.find((c) => c.id === b.category_id);
    return (
      <button className="row-item" onClick={() => setBillMenu(b)}>
        <div className="ic">{cat?.icon ?? "👤"}</div>
        <div className="body">
          <div className="t">{b.title}</div>
          <div className="s">
            {personName(b.person_id) ? `${personName(b.person_id)} · ` : ""}
            {b.status !== "open" ? (
              <span className={b.status === "paid" ? "income" : "muted"}>{b.status === "paid" ? "Paid" : "Cancelled"} · {formatDate(b.due_date, locale)}</span>
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
        <div className="amt">
          {b.status === "open" ? fmt(rem) : fmt(b.amount)}
          {b.status === "open" && rem < b.amount - 0.004 && <span className="sub">of {fmt(b.amount)}</span>}
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
          <button className="btn primary sm" onClick={() => setNewBill({})}>
            + Schedule
          </button>
        </div>

        <div className="seg mb">
          <button className={tab === "due" ? "active" : ""} onClick={() => setTab("due")}>
            To pay
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
                              <span className="sub">owed</span>
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
              <Money value={billMenu.amount} />
            </div>
            <div className="between">
              <span className="muted">Paid so far</span>
              <Money value={paid.get(billMenu.id) ?? 0} />
            </div>
            <div className="between bold">
              <span>Remaining</span>
              <Money value={billRemaining(billMenu, paid)} />
            </div>
            <div className="between">
              <span className="muted">Due</span>
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
                Record a payment
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
            {billMenu.status === "open" ? (
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

      {newBill && <BillForm presetPersonId={newBill.personId} onClose={() => setNewBill(null)} />}
      {editBill && <BillForm existing={editBill} onClose={() => setEditBill(null)} />}
      {paying && <PayBillForm bill={paying} onClose={() => setPaying(null)} />}
      {editPerson && <PersonForm existing={editPerson === "new" ? undefined : editPerson} onClose={() => setEditPerson(null)} />}
      {editTx && <TransactionForm existing={editTx} onClose={() => setEditTx(null)} />}
    </>
  );
}
