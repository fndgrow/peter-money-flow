import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "./lib/store";
import { Icons, Toasts } from "./components/ui";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Transactions } from "./pages/Transactions";
import { People } from "./pages/People";
import { Accounts } from "./pages/Accounts";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";

const NAV = [
  { to: "/", label: "Home", icon: Icons.home },
  { to: "/transactions", label: "Transactions", icon: Icons.list },
  { to: "/people", label: "People", icon: Icons.people },
  { to: "/accounts", label: "Accounts", icon: Icons.wallet },
  { to: "/reports", label: "Reports", icon: Icons.chart },
];

export default function App() {
  const { auth, state, loading, offline } = useStore();

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
          <button className="btn primary mt" onClick={() => location.reload()}>
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
          <span className="dot" style={{ width: 10, height: 10, borderRadius: 5, background: "var(--accent)", display: "inline-block" }} /> Money Flow
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
        {offline && <div className="banner" style={{ margin: "12px 16px 0", maxWidth: 688 }}>Offline. Showing your last synced data. Changes need a connection.</div>}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/people" element={<People />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Toasts />
    </div>
  );
}
