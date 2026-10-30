// Shared tile targets + date range (everyone sees the same; saved in Neon).
// GET  /api/settings                                   → { targets: { key: number|null }, start, end, updatedBy, updatedAt }
// POST /api/settings { set: { key: number|null }, reset: [key], start, end }   (needs "Edit targets & dates")
//      merged on the server, so two people changing different tiles don't overwrite each other
import { q } from "../lib/db.js";
import { send, body } from "../lib/http.js";
import { currentUser, permsOf } from "../lib/auth.js";

const KEY = "shared";
const day = v => (v === "" || v === null ? "" : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : undefined);
async function read() {
  const r = (await q("SELECT value, updated_by, updated_at FROM pmd_settings WHERE key = $1", [KEY]))[0];
  let v = {}; try { v = JSON.parse(r?.value || "{}"); } catch {}
  return { targets: v.targets || {}, start: v.start ?? null, end: v.end ?? null, updatedBy: r?.updated_by || null, updatedAt: r?.updated_at || null };
}

export default async function handler(req, res) {
  try {
    const me = await currentUser(req);
    if (!me) return send(res, 401, { error: "Sign in first." });
    if (req.method === "GET") return send(res, 200, await read());
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    if (!permsOf(me).includes("targets")) return send(res, 403, { error: "You can’t edit targets and dates." });
    const b = await body(req), cur = await read();
    const targets = { ...cur.targets };
    Object.entries(b.set && typeof b.set === "object" ? b.set : {}).slice(0, 50).forEach(([k, v]) => {
      targets[String(k).slice(0, 60)] = v === null || v === "" ? null : Math.max(0, Math.round(Number(v))) || 0;
    });
    (Array.isArray(b.reset) ? b.reset : []).forEach(k => delete targets[k]);
    const start = day(b.start) !== undefined && "start" in b ? day(b.start) : cur.start;
    const end = day(b.end) !== undefined && "end" in b ? day(b.end) : cur.end;
    await q(`INSERT INTO pmd_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
      [KEY, JSON.stringify({ targets, start, end }), me.email]);
    return send(res, 200, await read());
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
