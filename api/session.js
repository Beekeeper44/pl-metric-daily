// GET  /api/session                     → { user, needsSetup }
// POST /api/session { action: "login",  email, password }
// POST /api/session { action: "logout" }
// POST /api/session { action: "setup",  name, email, password, code }   (first admin only, needs SETUP_CODE)
// POST /api/session { action: "password", current, password }           (change your own password)
import { q } from "../lib/db.js";
import { send, body } from "../lib/http.js";
import {
  currentUser, setSession, clearSession, userCount, hashPassword, checkPassword, normEmail, validEmail,
  tooManyAttempts, noteFailedAttempt, clearAttempts, publicUser,
} from "../lib/auth.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const n = await userCount();
      if (n === 0) return send(res, 200, { user: null, needsSetup: true, setupEnabled: !!process.env.SETUP_CODE });
      return send(res, 200, { user: publicUser(await currentUser(req)), needsSetup: false });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    const b = await body(req);

    if (b.action === "logout") { clearSession(res); return send(res, 200, { ok: true }); }

    if (b.action === "setup") {
      if ((await userCount()) > 0) return send(res, 409, { error: "Already set up — sign in instead." });
      if (!process.env.SETUP_CODE || b.code !== process.env.SETUP_CODE) return send(res, 403, { error: "Wrong setup code." });
      const email = normEmail(b.email), name = String(b.name || "").trim();
      if (!name || !validEmail(email)) return send(res, 400, { error: "Enter your name and a valid email." });
      if (String(b.password || "").length < 10) return send(res, 400, { error: "Password must be at least 10 characters." });
      const rows = await q("INSERT INTO pmd_users (email, name, role, pass_hash, last_login) VALUES ($1, $2, 'admin', $3, now()) RETURNING id, email, name, role, perms, session_v",
        [email, name, hashPassword(b.password)]);
      setSession(res, rows[0]);
      return send(res, 200, { user: publicUser(rows[0]) });
    }

    if (b.action === "login") {
      const email = normEmail(b.email);
      if (await tooManyAttempts(email)) return send(res, 429, { error: "Too many tries. Wait 15 minutes and try again." });
      const rows = await q("SELECT id, email, name, role, perms, pass_hash, session_v, disabled FROM pmd_users WHERE email = $1", [email]);
      const u = rows[0];
      if (!u) {
        // invited but never opened the link → say so instead of "wrong password"
        const inv = await q("SELECT 1 FROM pmd_invites WHERE email = $1 AND used_at IS NULL", [email]);
        if (inv.length) {
          await noteFailedAttempt(email);
          return send(res, 401, { error: "You haven’t set a password yet. Open the invite link an admin sent you and create one there. No link, or it expired? Ask an admin for a new invite link." });
        }
      }
      if (!u || !checkPassword(b.password, u.pass_hash)) {
        await noteFailedAttempt(email);
        return send(res, 401, { error: "Wrong email or password." });
      }
      if (u.disabled) return send(res, 403, { error: "This account is turned off. Ask an admin to turn it back on." });
      await clearAttempts(email);
      await q("UPDATE pmd_users SET last_login = now() WHERE id = $1", [u.id]);
      setSession(res, u);
      return send(res, 200, { user: publicUser(u) });
    }

    if (b.action === "password") {
      const me = await currentUser(req);
      if (!me) return send(res, 401, { error: "Sign in first." });
      const row = (await q("SELECT pass_hash FROM pmd_users WHERE id = $1", [me.id]))[0];
      if (!row || !checkPassword(b.current, row.pass_hash)) return send(res, 400, { error: "Current password is wrong." });
      if (String(b.password || "").length < 10) return send(res, 400, { error: "New password must be at least 10 characters." });
      // new hash + sign out every other device, keep this one signed in
      const upd = await q("UPDATE pmd_users SET pass_hash = $1, session_v = session_v + 1 WHERE id = $2 RETURNING id, email, name, role, perms, session_v",
        [hashPassword(b.password), me.id]);
      setSession(res, upd[0]);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: "Unknown action" });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
