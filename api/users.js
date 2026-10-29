// Admins only.
// GET  /api/users                                   → { users, invites }
// POST /api/users { action: "invite", name, email, role }   → { link }
// POST /api/users { action: "link",   email }               → { link }   (new link; also used for forgotten passwords)
// POST /api/users { action: "role",   id, role }
// POST /api/users { action: "remove", id }
// POST /api/users { action: "cancel", inviteId }
// POST /api/users { action: "perms",  id, perms: ["metrics","queue","team","targets","refresh"] }   (Members)
// POST /api/users { action: "off" | "on", id }   (turn an account off / back on; off signs them out right away)
import { q } from "../lib/db.js";
import { send, body, origin } from "../lib/http.js";
import { currentUser, newToken, tokenHash, normEmail, validEmail, ROLES, PERMS, DEFAULT_PERMS, cleanPerms, permsOf } from "../lib/auth.js";

const LINK_DAYS = 7;

async function makeLink(req, email, name, role, by, perms = "") {
  const token = newToken();
  await q("DELETE FROM pmd_invites WHERE email = $1 AND used_at IS NULL", [email]);   // newest link replaces older ones
  await q(`INSERT INTO pmd_invites (email, name, role, perms, token_hash, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, now() + interval '${LINK_DAYS} days', $6)`, [email, name, role, perms, tokenHash(token), by]);
  return `${origin(req)}/?invite=${token}`;
}
const adminCount = async () => (await q("SELECT COUNT(*)::int AS n FROM pmd_users WHERE role = 'admin' AND disabled = false"))[0].n;

export default async function handler(req, res) {
  try {
    const me = await currentUser(req);
    if (!me) return send(res, 401, { error: "Sign in first." });
    if (me.role !== "admin") return send(res, 403, { error: "Admins only." });

    if (req.method === "GET") {
      const users = (await q("SELECT id, email, name, role, perms, disabled, created_at, last_login FROM pmd_users ORDER BY name, email"))
        .map(u => ({ ...u, perms: permsOf(u) }));
      const invites = await q(`SELECT id, email, name, role, perms, expires_at, created_by, created_at FROM pmd_invites
        WHERE used_at IS NULL AND expires_at > now() AND email NOT IN (SELECT email FROM pmd_users) ORDER BY created_at DESC`);
      return send(res, 200, { users, invites, me: me.id, permsList: PERMS, defaultPerms: DEFAULT_PERMS });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    const b = await body(req);

    if (b.action === "invite") {
      const email = normEmail(b.email), name = String(b.name || "").trim();
      const role = ROLES.includes(b.role) ? b.role : "admin";
      if (!validEmail(email)) return send(res, 400, { error: "Enter a valid email." });
      const exists = await q("SELECT id FROM pmd_users WHERE email = $1", [email]);
      if (exists.length) return send(res, 409, { error: "That person already has an account — use New link instead." });
      const perms = role === "admin" ? "" : cleanPerms(b.perms ?? DEFAULT_PERMS).join(",");
      return send(res, 200, { link: await makeLink(req, email, name, role, me.email, perms), days: LINK_DAYS });
    }
    if (b.action === "perms") {
      const target = (await q("SELECT id, role FROM pmd_users WHERE id = $1", [b.id]))[0];
      if (!target) return send(res, 404, { error: "Not found." });
      if (target.role === "admin") return send(res, 400, { error: "Admins can do everything — make them a Member first." });
      await q("UPDATE pmd_users SET perms = $1 WHERE id = $2", [cleanPerms(b.perms).join(",") || "none", b.id]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "link") {
      const email = normEmail(b.email);
      const u = (await q("SELECT email, name, role, perms FROM pmd_users WHERE email = $1", [email]))[0]
        || (await q("SELECT email, name, role, perms FROM pmd_invites WHERE email = $1 ORDER BY created_at DESC LIMIT 1", [email]))[0];
      if (!u) return send(res, 404, { error: "No one with that email." });
      return send(res, 200, { link: await makeLink(req, u.email, u.name, u.role, me.email, u.perms || ""), days: LINK_DAYS });
    }
    if (b.action === "role") {
      if (!ROLES.includes(b.role)) return send(res, 400, { error: "Unknown role." });
      const target = (await q("SELECT id, role FROM pmd_users WHERE id = $1", [b.id]))[0];
      if (!target) return send(res, 404, { error: "Not found." });
      if (target.role === "admin" && b.role !== "admin" && (await adminCount()) <= 1) return send(res, 409, { error: "Keep at least one admin." });
      await q("UPDATE pmd_users SET role = $1 WHERE id = $2", [b.role, b.id]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "remove") {
      const target = (await q("SELECT id, email, role FROM pmd_users WHERE id = $1", [b.id]))[0];
      if (!target) return send(res, 404, { error: "Not found." });
      if (target.role === "admin" && (await adminCount()) <= 1) return send(res, 409, { error: "Keep at least one admin." });
      await q("DELETE FROM pmd_invites WHERE email = $1", [target.email]);
      await q("DELETE FROM pmd_users WHERE id = $1", [b.id]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "off" || b.action === "on") {
      const target = (await q("SELECT id, role, disabled FROM pmd_users WHERE id = $1", [b.id]))[0];
      if (!target) return send(res, 404, { error: "Not found." });
      if (b.action === "off") {
        if (target.id === me.id) return send(res, 400, { error: "You can’t turn yourself off." });
        if (target.role === "admin" && !target.disabled && (await adminCount()) <= 1) return send(res, 409, { error: "Keep at least one admin." });
        await q("UPDATE pmd_users SET disabled = true, session_v = session_v + 1 WHERE id = $1", [b.id]);
      } else {
        await q("UPDATE pmd_users SET disabled = false WHERE id = $1", [b.id]);
      }
      return send(res, 200, { ok: true });
    }
    if (b.action === "cancel") {
      await q("DELETE FROM pmd_invites WHERE id = $1 AND used_at IS NULL", [b.inviteId]);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "Unknown action" });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
