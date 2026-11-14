import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { AppState } from "./types";
import { makeConv, makeFormatter } from "./money";

type Auth = { setup: boolean; authed: boolean; email?: string | null };

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

interface Store {
  auth: Auth | null;
  state: AppState | null;
  loading: boolean;
  offline: boolean;
  fmt: (n: number) => string;
  /** Formats the amount in the secondary currency, or null when none is set. */
  fmt2: ((n: number) => string) | null;
  secondary: { currency: string; rate: number } | null;
  /** Formatter for any currency code (cached). */
  fmtIn: (currency: string) => (n: number) => string;
  /** Convert between the main and the second currency. */
  conv: (amount: number, from: string, to: string) => number;
  /** Currencies an account can be kept in: main first, then the second currency if set. */
  currencies: string[];
  locale: string;
  currency: string;
  refresh: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
  /**
   * Run a mutation, then reload state. Shows errors as toasts. Returns true on success.
   * `optimistic` is applied to the local state immediately so the screen updates before the server answers.
   */
  run: (fn: () => Promise<unknown>, successText?: string, optimistic?: (s: AppState) => AppState) => Promise<boolean>;
  /** True while the live-update connection to the server is open. */
  live: boolean;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [live, setLive] = useState(false);
  const toastId = useRef(0);
  const inflight = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2500);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const a = await api.get<Auth>("/api/me");
      setAuth(a);
    } catch (e) {
      // Offline: assume we were signed in so cached data can show.
      if (e instanceof ApiError && e.status === 0) setAuth((prev) => prev ?? { setup: true, authed: true });
      else setAuth({ setup: true, authed: false });
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<AppState>("/api/state");
      setState(s);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth((prev) => ({ setup: prev?.setup ?? true, authed: false }));
      else if (e instanceof ApiError && e.status === 0) setOffline(true);
      else toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // First load: ask "who am I" and fetch the data at the same time instead of one after the other.
  // The data call simply answers 401 when not signed in, which the refresh handler already treats as "not authed".
  useEffect(() => {
    refreshAuth();
    refresh();
  }, [refreshAuth, refresh]);

  // After signing in (or when the first parallel fetch could not run), load the data once.
  useEffect(() => {
    if (auth?.authed && !state && !loading) refresh();
    else if (auth && !auth.authed) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useEffect(() => {
    const on = () => {
      setOffline(false);
      if (auth?.authed) refresh();
    };
    const off = () => setOffline(true);
    const vis = () => {
      if (document.visibilityState === "visible" && auth?.authed) refresh();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    // Warm up the other screens while idle so switching tabs is instant.
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => {
      import("../pages/Dashboard");
      import("../pages/People");
      import("../pages/Accounts");
      import("../pages/Settings");
    });
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [auth, refresh]);

  // Live updates from the server (another device, the month close, a rate refresh).
  useEffect(() => {
    if (!auth?.authed || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("changed", () => {
      // Our own writes refresh themselves; only react to changes made elsewhere.
      if (inflight.current === 0) refresh();
    });
    return () => {
      es.close();
      setLive(false);
    };
  }, [auth?.authed, refresh]);

  const logout = useCallback(async () => {
    await api.post("/api/logout");
    setState(null);
    setAuth({ setup: true, authed: false });
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successText?: string, optimistic?: (s: AppState) => AppState) => {
      if (optimistic) setState((s) => (s ? optimistic(s) : s));
      inflight.current += 1;
      try {
        await fn();
        await refresh();
        if (successText) toast(successText);
        return true;
      } catch (e) {
        if (optimistic) await refresh(); // roll back to what the server has
        toast((e as Error).message || "Something went wrong", "error");
        return false;
      } finally {
        inflight.current -= 1;
      }
    },
    [refresh, toast],
  );

  const currency = state?.settings.currency || "EUR";
  const locale = state?.settings.locale || "en-GB";
  const fmt = useMemo(() => makeFormatter(currency, locale), [currency, locale]);
  const secCurrency = state?.settings.secondary_currency || "";
  const secRate = Number(state?.settings.secondary_rate || 0);
  const secondary = useMemo(
    () => (secCurrency && secRate > 0 && secCurrency !== currency ? { currency: secCurrency, rate: secRate } : null),
    [secCurrency, secRate, currency],
  );
  const fmt2 = useMemo(() => {
    if (!secondary) return null;
    const f = makeFormatter(secondary.currency, locale);
    return (n: number) => f(n * secondary.rate);
  }, [secondary, locale]);
  const fmtIn = useMemo(() => {
    const cache = new Map<string, (n: number) => string>();
    return (cur: string) => {
      let f = cache.get(cur);
      if (!f) {
        f = makeFormatter(cur || currency, locale);
        cache.set(cur, f);
      }
      return f;
    };
  }, [currency, locale]);
  const conv = useMemo(() => makeConv(state?.settings ?? {}).conv, [state?.settings]);
  const currencies = useMemo(() => (secondary ? [currency, secondary.currency] : [currency]), [currency, secondary]);

  const value: Store = {
    auth,
    state,
    loading,
    offline,
    fmt,
    fmt2,
    secondary,
    fmtIn,
    conv,
    currencies,
    locale,
    currency,
    refresh,
    refreshAuth,
    logout,
    toast,
    toasts,
    run,
    live,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

/** Same as useStore but guarantees state is loaded (use inside authed pages). */
export function useData() {
  const s = useStore();
  if (!s.state) throw new Error("state not loaded");
  return { ...s, state: s.state };
}
