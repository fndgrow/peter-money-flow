import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db, nowIso } from "./db.js";

const COOKIE = "pmf_session";
/** A sign-in lasts this long on a device; afterwards password (+ human check + code) again. */
const SESSION_HOURS = 24;

export function hasUser(): boolean {
  const row = db.prepare("SELECT id FROM user WHERE id = 1").get();
  return !!row;
}

export function createUser(password: string, email: string) {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO user (id, password_hash, created_at, email) VALUES (1, ?, ?, ?)").run(hash, nowIso(), email);
}

export function userEmail(): string | null {
  const row = db.prepare("SELECT email FROM user WHERE id = 1").get() as { email: string | null } | undefined;
  return row?.email ?? null;
}

export function setUserEmail(email: string) {
  db.prepare("UPDATE user SET email = ? WHERE id = 1").run(email);
}

export function normalizeEmail(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/** True when the given email matches the stored one (or none is stored yet). */
export function emailMatches(email: string): boolean {
  const stored = userEmail();
  return !stored || stored.toLowerCase() === email;
}

export function changePassword(password: string) {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE user SET password_hash = ? WHERE id = 1").run(hash);
  db.prepare("DELETE FROM sessions").run();
}

export function verifyPassword(password: string): boolean {
  const row = db.prepare("SELECT password_hash FROM user WHERE id = 1").get() as
    | { password_hash: string }
    | undefined;
  if (!row) return false;
  return bcrypt.compareSync(password, row.password_hash);
}

export function issueSession(res: Response) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  db.prepare("INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)").run(
    token,
    nowIso(),
    expires.toISOString(),
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    expires,
    path: "/",
  });
}

/** Sign out every other device: keeps only the session making the request. */
export function clearOtherSessions(req: Request): number {
  const token = req.cookies?.[COOKIE] ?? "";
  const r = db.prepare("DELETE FROM sessions WHERE token != ?").run(token);
  return Number(r.changes);
}

/** How many devices are currently signed in (unexpired sessions). */
export function activeSessionCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?").get(nowIso()) as { n: number };
  return row.n;
}

export function clearSession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie(COOKIE, { path: "/" });
}

export function isAuthed(req: Request): boolean {
  const token = req.cookies?.[COOKIE];
  if (!token) return false;
  const row = db.prepare("SELECT expires_at FROM sessions WHERE token = ?").get(token) as
    | { expires_at: string }
    | undefined;
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return false;
  }
  return true;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "Not signed in" });
}

// ---------- two-factor (TOTP) ----------

export function totpSecret(): string | null {
  const row = db.prepare("SELECT totp_secret FROM user WHERE id = 1").get() as { totp_secret: string | null } | undefined;
  return row?.totp_secret ?? null;
}
export function totpPending(): string | null {
  const row = db.prepare("SELECT totp_pending FROM user WHERE id = 1").get() as { totp_pending: string | null } | undefined;
  return row?.totp_pending ?? null;
}
export function setTotpPending(secret: string | null) {
  db.prepare("UPDATE user SET totp_pending = ? WHERE id = 1").run(secret);
}
export function enableTotp(secret: string) {
  db.prepare("UPDATE user SET totp_secret = ?, totp_pending = NULL WHERE id = 1").run(secret);
}
export function disableTotp() {
  db.prepare("UPDATE user SET totp_secret = NULL, totp_pending = NULL WHERE id = 1").run();
}

/** After a correct password, the browser gets a short-lived ticket it must redeem with a 2FA code. */
const pendingLogins = new Map<string, number>();
export function issuePendingLogin(): string {
  const t = crypto.randomBytes(24).toString("hex");
  pendingLogins.set(t, Date.now() + 5 * 60_000);
  return t;
}
export function redeemPendingLogin(t: string): boolean {
  const exp = pendingLogins.get(t);
  if (!exp) return false;
  if (exp < Date.now()) {
    pendingLogins.delete(t);
    return false;
  }
  return true;
}
export function finishPendingLogin(t: string) {
  pendingLogins.delete(t);
}

// ---------- Cloudflare Turnstile ("I am human" checkbox) ----------

export const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || "";
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || "";
export const turnstileEnabled = !!(TURNSTILE_SITE_KEY && TURNSTILE_SECRET);

export async function verifyTurnstile(token: unknown, ip: string | undefined): Promise<boolean> {
  if (!turnstileEnabled) return true;
  if (!token || typeof token !== "string") return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const data = (await r.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

// Simple in-memory limiter for password attempts.
const attempts = new Map<string, { count: number; until: number }>();

export function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || "unknown";
  const a = attempts.get(ip);
  if (a && a.until > Date.now() && a.count >= 8) {
    return res.status(429).json({ error: "Too many attempts. Try again in 10 minutes." });
  }
  next();
}

export function noteFailedLogin(req: Request) {
  const ip = req.ip || "unknown";
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + 10 * 60_000 });
  else a.count += 1;
}

export function clearFailedLogins(req: Request) {
  attempts.delete(req.ip || "unknown");
}
