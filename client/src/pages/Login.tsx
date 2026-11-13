import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Field } from "../components/ui";

export function Login() {
  const { auth, refreshAuth } = useStore();
  const setup = !auth?.setup;
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("pmf_email") || "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== confirm) return setError("Passwords do not match");
    setBusy(true);
    try {
      await api.post(setup ? "/api/setup" : "/api/login", { email, password });
      try {
        localStorage.setItem("pmf_email", email.trim());
      } catch {
        /* private mode */
      }
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="card">
        <div className="logo">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20V12M10 20V6M16 20v-9" />
            <path d="M3 9l7-4 6 3 5-4" />
          </svg>
        </div>
        <h1 className="center">My money</h1>
        <p className="center muted small mt mb">
          {setup ? "Welcome. Choose your login email and a password. There is only one account: yours." : "Sign in to continue."}
        </p>
        <form onSubmit={submit}>
          {error && <div className="form-error">{error}</div>}
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} required autoComplete="username" inputMode="email" />
          </Field>
          <Field label={setup ? "Choose a password" : "Password"}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={!!email}
              required
              minLength={6}
              autoComplete={setup ? "new-password" : "current-password"}
            />
          </Field>
          {setup && (
            <Field label="Repeat password">
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password" />
            </Field>
          )}
          <button className="btn primary block" type="submit" disabled={busy}>
            {setup ? "Create my account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
