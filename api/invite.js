// GET  /api/invite?token=…              → { email, name, role }  (checks the link)
// POST /api/invite { token, name, password }  → creates the account (or resets the password) and signs in
import { q } from "../lib/db.js";
import { send, body } from "../lib/http.js";
import { tokenHash, hashPassword, setSession, publicUser } from "../lib/auth.js";

async function findInvite(token) {
  if (!token) return null;
  const rows = await q("SELECT * FROM pmd_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()", [tokenHash(token)]);
  return rows[0] || null;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const inv = await findInvite(String(req.query.token || ""));
      if (!inv) return send(res, 404, { error: "This link has expired or was already used. Ask an admin for a new one." });
      const existing = await q("SELECT id FROM pmd_users WHERE email = $1", [inv.email]);
      return send(res, 200, { email: inv.email, name: inv.name, role: inv.role, reset: existing.length > 0 });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    const b = await body(req);
    const inv = await findInvite(String(b.token || ""));
    if (!inv) return send(res, 404, { error: "This link has expired or was already used. Ask an admin for a new one." });
    const name = String(b.name || inv.name || "").trim();
    if (!name) return send(res, 400, { error: "Enter your name." });
    if (String(b.password || "").length < 10) return send(res, 400, { error: "Password must be at least 10 characters." });

    const prior = (await q("SELECT disabled FROM pmd_users WHERE email = $1", [inv.email]))[0];
    if (prior && prior.disabled) return send(res, 403, { error: "This account is turned off. Ask an admin to turn it back on." });
    const pass = hashPassword(b.password);
    // new person → create; existing person (new link / forgot password) → reset password, sign out other sessions
    // role/permissions only apply to new people; a reset link keeps what an admin already set
    const rows = await q(`INSERT INTO pmd_users (email, name, role, perms, pass_hash, last_login) VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, pass_hash = EXCLUDED.pass_hash, last_login = now(), session_v = pmd_users.session_v + 1
      RETURNING id, email, name, role, perms, session_v`, [inv.email, name, inv.role, inv.perms || "", pass]);
    await q("UPDATE pmd_invites SET used_at = now() WHERE id = $1", [inv.id]);
    setSession(res, rows[0]);
    return send(res, 200, { user: publicUser(rows[0]) });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
