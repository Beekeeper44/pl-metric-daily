// Passwords (scrypt), invite tokens (stored as SHA-256), signed HttpOnly session cookie.
import crypto from "node:crypto";
import { q } from "./db.js";

const COOKIE = "pmd_session";
const DAYS = 30;
export const ROLES = ["admin", "member"];
// What a Member can be allowed to do. Admins can do everything, including managing users.
export const PERMS = ["metrics", "queue", "team", "targets", "refresh"];
export const DEFAULT_PERMS = ["metrics", "queue", "team", "targets", "refresh"];   // "member — full access"
export const cleanPerms = list => [...new Set((Array.isArray(list) ? list : String(list || "").split(",")).map(x => String(x).trim()).filter(x => PERMS.includes(x)))];
export const permsOf = u => u.role === "admin" ? [...PERMS, "users"] : (u.perms ? cleanPerms(u.perms) : DEFAULT_PERMS);

export const normEmail = e => String(e || "").trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function checkPassword(pw, stored) {
  const [kind, s, h] = String(stored || "").split("$");
  if (kind !== "scrypt" || !s || !h) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(s, "base64"), 64);
  const want = Buffer.from(h, "base64");
  return want.length === hash.length && crypto.timingSafeEqual(want, hash);
}

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const tokenHash = t => crypto.createHash("sha256").update(String(t)).digest("hex");

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not set (use a long random string)");
  return s;
}
const sign = data => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function setSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, v: user.session_v, exp: Date.now() + DAYS * 864e5 })).toString("base64url");
  const value = `${payload}.${sign(payload)}`;
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
function readCookie(req) {
  const raw = req.headers.cookie || "";
  const m = raw.split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  return m ? m.slice(COOKIE.length + 1) : "";
}

// Returns the signed-in user (re-checked against the database) or null
export async function currentUser(req) {
  const value = readCookie(req);
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  const rows = await q("SELECT id, email, name, role, perms, session_v, disabled FROM pmd_users WHERE id = $1", [data.uid]);
  const u = rows[0];
  if (!u || u.disabled || u.session_v !== data.v) return null;     // turned off → signed out     // removed, or password reset → signed out
  return u;
}

export async function userCount() {
  const r = await q("SELECT COUNT(*)::int AS n FROM pmd_users");
  return r[0].n;
}

// 8 wrong tries per address per 15 minutes
export async function tooManyAttempts(email) {
  const r = await q("SELECT COUNT(*)::int AS n FROM pmd_login_attempts WHERE email = $1 AND at > now() - interval '15 minutes'", [email]);
  return r[0].n >= 8;
}
export const noteFailedAttempt = email => q("INSERT INTO pmd_login_attempts (email) VALUES ($1)", [email]);
export const clearAttempts = email => q("DELETE FROM pmd_login_attempts WHERE email = $1 OR at < now() - interval '1 day'", [email]);

export const publicUser = u => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, perms: permsOf(u) });
