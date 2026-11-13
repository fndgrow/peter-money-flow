import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db, nowIso } from "./db.js";

const COOKIE = "pmf_session";
const SESSION_DAYS = 90;

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
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
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
