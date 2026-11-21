import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Field } from "../components/ui";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void; theme?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

/** Cloudflare Turnstile "I am human" checkbox. Renders nothing when no site key is configured. */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
        theme: "auto",
      });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);
  if (!siteKey) return null;
  return <div ref={ref} className="mb" style={{ display: "flex", justifyContent: "center" }} />;
}

export function Login() {
  const { auth, refreshAuth } = useStore();
  const setup = !auth?.setup;
  const siteKey = auth?.turnstileSiteKey || "";
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("pmf_email") || "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== confirm) return setError("Passwords do not match");
    if (siteKey && !turnstile) return setError("Please tick the “I am human” box");
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; twoFactor?: boolean; ticket?: string }>(setup ? "/api/setup" : "/api/login", { email, password, turnstile });
      try {
        localStorage.setItem("pmf_email", email.trim());
      } catch {
        /* private mode */
      }
      if (r.twoFactor && r.ticket) {
        setTicket(r.ticket);
        return;
      }
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
      setTurnstile("");
      window.turnstile?.reset();
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/api/login/2fa", { ticket, code });
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
      if ((err as { status?: number }).status === 401 && /expired/i.test((err as Error).message)) setTicket(null);
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

        {ticket ? (
          <>
            <p className="center muted small mt mb">Enter the 6-digit code from your authenticator app.</p>
            <form onSubmit={submitCode}>
              {error && <div className="form-error">{error}</div>}
              <Field label="Authenticator code" className="amount">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  required
                  placeholder="000000"
                />
              </Field>
              <button className="btn primary block" type="submit" disabled={busy || code.length !== 6}>
                Verify
              </button>
              <button className="btn ghost block mt" type="button" onClick={() => setTicket(null)}>
                Back
              </button>
            </form>
          </>
        ) : (
          <>
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
                  minLength={4}
                  autoComplete={setup ? "new-password" : "current-password"}
                />
              </Field>
              {setup && (
                <Field label="Repeat password">
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={4} autoComplete="new-password" />
                </Field>
              )}
              <Turnstile siteKey={siteKey} onToken={setTurnstile} />
              <button className="btn primary block" type="submit" disabled={busy || (!!siteKey && !turnstile)}>
                {setup ? "Create my account" : "Sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
