import { Suspense, lazy, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useStore } from "./lib/store";
import { Icons, Toasts } from "./components/ui";
import { TransactionForm } from "./components/TransactionForm";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Transactions } from "./pages/Transactions";
// Less-used screens load on demand so the first paint stays small.
const People = lazy(() => import("./pages/People").then((m) => ({ default: m.People })));
const Accounts = lazy(() => import("./pages/Accounts").then((m) => ({ default: m.Accounts })));
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

const NAV = [
  { to: "/", label: "Home", icon: Icons.home },
  { to: "/people", label: "People", icon: Icons.people },
  { to: "/accounts", label: "Accounts", icon: Icons.wallet },
  { to: "/dashboard", label: "Dashboard", icon: Icons.chart },
];

export default function App() {
  const { auth, state, loading, offline, live } = useStore();
  const [quickAdd, setQuickAdd] = useState(false);
  const location = useLocation();

  if (!auth || (auth.authed && loading && !state)) {
    return <div className="spinner" />;
  }
  if (!auth.authed) {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }
  if (!state) {
    return (
      <div className="auth">
        <div className="card center">
          <h2>Can't reach the server</h2>
          <p className="muted small mt">You're offline and there is no saved copy of your data yet. Connect and try again.</p>
          <button className="btn primary mt" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <span className="dot" style={{ width: 10, height: 10, borderRadius: 5, background: "var(--accent)", display: "inline-block" }} /> My money
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.icon}
            <span>{n.label}</span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")} style={{ marginTop: "auto" }}>
          {Icons.gear}
          <span>Settings</span>
        </NavLink>
      </nav>
      <div className="content">
        {!offline && (
          <div className={`sync ${live ? "" : "off"}`} title={live ? "Live: changes from other devices appear automatically" : "Reconnecting…"}>
            <span className="dot" /> {live ? "live" : "…"}
          </div>
        )}
        {offline && <div className="banner" style={{ margin: "12px 16px 0", maxWidth: 688 }}>Offline. Showing your last synced data. Changes need a connection.</div>}
        <Suspense fallback={<div className="spinner" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/people" element={<People />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      {location.pathname !== "/" && (
        <button className="fab" aria-label="Add expense or income" onClick={() => setQuickAdd(true)}>
          +
        </button>
      )}
      {quickAdd && <TransactionForm initialType="expense" onClose={() => setQuickAdd(false)} />}
      <Toasts />
    </div>
  );
}
