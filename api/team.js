// Team edits shared by everyone (Neon).
// GET  /api/team                                   → { people: [...] }   (signed-in people)
// POST /api/team { action: "save", key, name, role, email, team, hidden }   (admins)
// POST /api/team { action: "add",  name, role, email, team }                (admins) → new hand-added person
// POST /api/team { action: "delete", key }   (admins; hand-added people only — Metabase people are hidden instead)
// POST /api/team { action: "remove", keys: [...] }  (admins; hand-added → deleted, Metabase people → hidden)
// POST /api/team { action: "restore", keys: [...] } (admins; un-hide)
// POST /api/team { action: "reset",  key }   (admins; drop edits so Metabase values show again — keeps order + skills)
// POST /api/team { action: "order",  keys: [...] }   (admins; saves the on-screen order of one team, 1..n)
// POST /api/team { action: "skills", key, skills: { "Crop": true, "Edge": false, … } }   (admins)
// POST /api/team { action: "presets", key, presets: { opts: { "1": [...], "2": [...], "3": [...] }, active: "1" } }   (admins)
import crypto from "node:crypto";
import { q } from "../lib/db.js";
import { send, body } from "../lib/http.js";
import { currentUser } from "../lib/auth.js";

const TEAMS = ["director", "oregon", "pl"];
const clip = (v, n = 120) => (v == null ? null : String(v).trim().slice(0, n) || null);

export default async function handler(req, res) {
  try {
    const me = await currentUser(req);
    if (!me) return send(res, 401, { error: "Sign in first." });
    if (req.method === "GET") {
      const people = await q("SELECT key, name, role, email, team, dept, tier, reports_to, hidden, manual, sort, skills, presets, admin_user_id, pushed, updated_by, updated_at FROM pmd_team ORDER BY name");
      return send(res, 200, { people });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    if (me.role !== "admin") return send(res, 403, { error: "Admins only." });
    const b = await body(req);
    const team = TEAMS.includes(b.team) ? b.team : null;

    if (b.action === "save") {
      if (!b.key) return send(res, 400, { error: "Missing key" });
      await q(`INSERT INTO pmd_team (key, name, role, email, team, dept, tier, reports_to, hidden, updated_by, updated_at, admin_user_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
               ON CONFLICT (key) DO UPDATE SET name = $2, role = $3, email = COALESCE($4, pmd_team.email), team = $5,
                 dept = $6, tier = $7, reports_to = $8, hidden = $9, updated_by = $10, updated_at = now(),
                 admin_user_id = COALESCE($11, pmd_team.admin_user_id)`,
        [String(b.key).slice(0, 200), clip(b.name), clip(b.role), clip(b.email), team, clip(b.dept, 40), clip(b.tier, 40), clip(b.reports_to), !!b.hidden, me.email,
         b.admin_user_id === undefined ? null : clip(b.admin_user_id, 80)]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "add") {
      const name = clip(b.name);
      if (!name) return send(res, 400, { error: "Enter a name." });
      const key = "manual:" + crypto.randomUUID();
      await q(`INSERT INTO pmd_team (key, name, role, email, team, dept, tier, reports_to, manual, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
        [key, name, clip(b.role), clip(b.email), team || "pl", clip(b.dept, 40), clip(b.tier, 40), clip(b.reports_to), me.email]);
      return send(res, 200, { ok: true, key });
    }
    if (b.action === "delete") {
      await q("DELETE FROM pmd_team WHERE key = $1 AND manual = true", [b.key]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "remove" || b.action === "restore") {
      const keys = (Array.isArray(b.keys) ? b.keys : []).slice(0, 500).map(k => String(k).slice(0, 200));
      if (!keys.length) return send(res, 400, { error: "No one selected." });
      let deleted = 0, hidden = 0;
      for (const k of keys) {
        if (b.action === "restore") { await q("UPDATE pmd_team SET hidden = false, updated_by = $2, updated_at = now() WHERE key = $1", [k, me.email]); continue; }
        const r = await q("DELETE FROM pmd_team WHERE key = $1 AND manual = true RETURNING key", [k]);
        if (r.length) { deleted++; continue; }
        await q(`INSERT INTO pmd_team (key, hidden, updated_by) VALUES ($1, true, $2)
                 ON CONFLICT (key) DO UPDATE SET hidden = true, updated_by = $2, updated_at = now()`, [k, me.email]);
        hidden++;
      }
      return send(res, 200, { ok: true, deleted, hidden });
    }
    if (b.action === "reset") {
      await q(`UPDATE pmd_team SET name = NULL, role = NULL, team = NULL, dept = NULL, tier = NULL, reports_to = NULL, hidden = false,
               updated_by = $2, updated_at = now() WHERE key = $1 AND manual = false`, [b.key, me.email]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "order") {
      const keys = (Array.isArray(b.keys) ? b.keys : []).slice(0, 500).map(k => String(k).slice(0, 200));
      for (let i = 0; i < keys.length; i++) {
        await q(`INSERT INTO pmd_team (key, sort, updated_by) VALUES ($1, $2, $3)
                 ON CONFLICT (key) DO UPDATE SET sort = $2, updated_by = $3, updated_at = now()`, [keys[i], i + 1, me.email]);
      }
      return send(res, 200, { ok: true });
    }
    if (b.action === "presets") {
      if (!b.key) return send(res, 400, { error: "Missing key" });
      const src = b.presets || {}, opts = {};
      for (const n of ["1", "2", "3"]) opts[n] = (Array.isArray(src.opts?.[n]) ? src.opts[n] : []).map(x => String(x).slice(0, 60)).slice(0, 200);
      const active = ["1", "2", "3"].includes(String(src.active)) ? String(src.active) : null;
      await q(`INSERT INTO pmd_team (key, presets, updated_by) VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET presets = $2, updated_by = $3, updated_at = now()`, [String(b.key).slice(0, 200), JSON.stringify({ opts, active }), me.email]);
      return send(res, 200, { ok: true });
    }
    if (b.action === "skills") {
      if (!b.key) return send(res, 400, { error: "Missing key" });
      const clean = {};
      for (const [k, v] of Object.entries(b.skills || {})) if (typeof v === "boolean") clean[String(k).slice(0, 60)] = v;
      await q(`INSERT INTO pmd_team (key, skills, updated_by) VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET skills = $2, updated_by = $3, updated_at = now()`, [String(b.key).slice(0, 200), JSON.stringify(clean), me.email]);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "Unknown action" });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
