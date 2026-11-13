import { useMemo, useState } from "react";
import { useData } from "../lib/store";
import { billPaidMap, billRemaining, formatDate } from "../lib/money";
import type { Bill, TxType } from "../lib/types";
import { TransactionForm } from "./TransactionForm";
import { BillForm, PayBillForm } from "./BillForms";
import { Money, Sheet } from "./ui";

/**
 * The floating "+" button, shown on every screen. It opens a small menu:
 * expense, income, transfer, or record a payment to someone.
 */
export function QuickAdd() {
  const { state, locale } = useData();
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState<TxType | null>(null);
  const [pickBill, setPickBill] = useState(false);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [newBill, setNewBill] = useState(false);
  const paid = useMemo(() => billPaidMap(state), [state]);
  const openBills = useMemo(
    () => state.bills.filter((b) => b.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [state.bills],
  );

  function personName(id: number | null) {
    return id ? state.people.find((p) => p.id === id)?.name : undefined;
  }
  function choose(what: TxType | "pay") {
    setMenu(false);
    if (what === "pay") {
      if (openBills.length) setPickBill(true);
      else setNewBill(true);
    } else setAdding(what);
  }

  const options: { key: TxType | "pay"; icon: string; label: string; hint: string; cls: string }[] = [
    { key: "expense", icon: "－", label: "Expense", hint: "Money you spent", cls: "out" },
    { key: "income", icon: "＋", label: "Income", hint: "Money you received", cls: "in" },
    { key: "transfer", icon: "⇄", label: "Transfer", hint: "Between your accounts", cls: "" },
    { key: "pay", icon: "✓", label: "Record payment", hint: "Pay someone you owe", cls: "pay" },
  ];

  return (
    <>
      <button className="fab" aria-label="Add" onClick={() => setMenu(true)}>
        +
      </button>
      {menu && (
        <Sheet title="Add" onClose={() => setMenu(false)}>
          <div className="list quick-menu">
            {options.map((o) => (
              <button key={o.key} className={`row-item ${o.cls}`} onClick={() => choose(o.key)}>
                <div className="ic">{o.icon}</div>
                <div className="body">
                  <div className="t">{o.label}</div>
                  <div className="s">{o.hint}</div>
                </div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {adding && <TransactionForm initialType={adding} onClose={() => setAdding(null)} />}
      {paying && <PayBillForm bill={paying} onClose={() => setPaying(null)} />}
      {newBill && <BillForm onClose={() => setNewBill(false)} />}
      {pickBill && (
        <Sheet title="Which payment?" onClose={() => setPickBill(false)}>
          <div className="list">
            {openBills.map((b) => (
              <button
                key={b.id}
                className="row-item"
                onClick={() => {
                  setPickBill(false);
                  setPaying(b);
                }}
              >
                <div className="ic">👤</div>
                <div className="body">
                  <div className="t">{b.title}</div>
                  <div className="s">
                    {personName(b.person_id) ? `${personName(b.person_id)} · ` : ""}due {formatDate(b.due_date, locale)}
                  </div>
                </div>
                <div className="amt">
                  <Money value={billRemaining(b, paid)} currency={b.currency} />
                </div>
              </button>
            ))}
          </div>
          <button
            className="btn mt"
            style={{ width: "100%" }}
            onClick={() => {
              setPickBill(false);
              setNewBill(true);
            }}
          >
            Schedule a new payment
          </button>
        </Sheet>
      )}
    </>
  );
}
