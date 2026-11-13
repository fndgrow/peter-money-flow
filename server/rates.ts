import { allSettings, setSetting } from "./db.js";

/** How many units of `quote` one unit of `base` buys today (base=EUR, quote=MDL → about 20). */
export async function fetchRate(base: string, quote: string): Promise<{ rate: number; date: string }> {
  const r = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(8000) });
  const data = (await r.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
  const rate = data.rates?.[quote];
  if (data.result !== "success" || !rate) throw new Error(`No rate for ${base} to ${quote}`);
  return { rate, date: new Date(data.time_last_update_utc || Date.now()).toISOString().slice(0, 10) };
}

/** Refresh the stored second-currency rate unless the user switched to a manual rate. */
export async function refreshStoredRate(): Promise<void> {
  const s = allSettings();
  const main = s.currency || "EUR";
  const secondary = s.secondary_currency;
  if (!secondary || secondary === main || s.secondary_rate_manual === "1") return;
  try {
    const { rate, date } = await fetchRate(main, secondary);
    setSetting("secondary_rate", String(Math.round(rate * 10000) / 10000));
    setSetting("secondary_rate_date", date);
    console.log(`Exchange rate updated: 1 ${main} = ${rate} ${secondary} (${date})`);
  } catch (e) {
    console.warn("Exchange rate refresh failed:", (e as Error).message);
  }
}

/** Refresh shortly after start-up, then every 6 hours. */
export function startRateUpdater() {
  setTimeout(refreshStoredRate, 5_000);
  setInterval(refreshStoredRate, 6 * 60 * 60_000).unref();
}
