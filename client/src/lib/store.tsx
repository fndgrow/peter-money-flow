import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { AppState } from "./types";
import { makeFormatter } from "./money";

type Auth = { setup: boolean; authed: boolean };

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
  locale: string;
  currency: string;
  refresh: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
  /** Run a mutation, then reload state. Shows errors as toasts. Returns true on success. */
  run: (fn: () => Promise<unknown>, successText?: string) => Promise<boolean>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

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
      if (e instanceof ApiError && e.status === 401) setAuth({ setup: true, authed: false });
      else if (e instanceof ApiError && e.status === 0) setOffline(true);
      else toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (auth?.authed) refresh();
    else if (auth) setLoading(false);
  }, [auth, refresh]);

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
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [auth, refresh]);

  const logout = useCallback(async () => {
    await api.post("/api/logout");
    setState(null);
    setAuth({ setup: true, authed: false });
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successText?: string) => {
      try {
        await fn();
        await refresh();
        if (successText) toast(successText);
        return true;
      } catch (e) {
        toast((e as Error).message || "Something went wrong", "error");
        return false;
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
    return (n: number) => f(n / secondary.rate);
  }, [secondary, locale]);

  const value: Store = { auth, state, loading, offline, fmt, fmt2, secondary, locale, currency, refresh, refreshAuth, logout, toast, toasts, run };
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
