// Push skills from the Team tab to Arena admin. Admins only.
// GET  /api/admin-skills                       → { dryRun, missing: [...env not set], sample }
// GET  /api/admin-skills?log=1[&key=…]         → last 100 writes (audit log)
// POST /api/admin-skills { key, userId, changes: [{ skill, enabled }], confirm: true }
//      → writes each change (or, in dry-run, shows the exact requests it would send)
import { q } from "../lib/db.js";
import { send as reply, body } from "../lib/http.js";
import { currentUser } from "../lib/auth.js";
import { dryRun, configured, buildRequest, send, skillName } from "../lib/admin.js";

export default async function handler(req, res) {
  try {
    const me = await currentUser(req);
    if (!me) return reply(res, 401, { error: "Sign in first." });
    if (me.role !== "admin") return reply(res, 403, { error: "Admins only." });

    if (req.method === "GET") {
      if (req.query.log) {
        const rows = req.query.key
          ? await q("SELECT * FROM pmd_admin_log WHERE person_key = $1 ORDER BY id DESC LIMIT 100", [req.query.key])
          : await q("SELECT * FROM pmd_admin_log ORDER BY id DESC LIMIT 100");
        return reply(res, 200, { rows });
      }
      return reply(res, 200, { dryRun: dryRun(), missing: configured(), sample: buildRequest("USER_ID", "Verify Crop", true), sampleName: skillName("Verify Crop") });
    }
    if (req.method !== "POST") return reply(res, 405, { error: "Method not allowed" });

    const b = await body(req);
    const userId = String(b.userId || "").trim();
    const changes = (Array.isArray(b.changes) ? b.changes : []).filter(c => c && typeof c.enabled === "boolean").slice(0, 100);
    if (!userId) return reply(res, 400, { error: "This person has no admin user ID yet — add it in their window (Edit → Admin user ID)." });
    if (!changes.length) return reply(res, 400, { error: "Nothing to push." });
    if (!b.confirm) return reply(res, 400, { error: "Confirm first." });

    const dry = dryRun();
    const missing = configured();
    if (!dry && missing.length) return reply(res, 500, { error: `Admin API isn't set up: ${missing.join(", ")}` });

    const results = [];
    const limit = Math.max(1, Math.min(8, Number(process.env.SKILLS_WRITE_CONCURRENCY) || 4));
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, changes.length) }, async () => {
      while (i < changes.length) {
        const c = changes[i++];
        const spec = buildRequest(userId, c.skill, c.enabled);
        let out;
        if (dry) out = { ok: true, status: 0, detail: `DRY RUN ${spec.method} ${spec.url}${spec.body ? " " + spec.body : ""}` };
        else { try { out = await send(spec); } catch (e) { out = { ok: false, status: 0, detail: String(e.message || e) }; } }
        results.push({ skill: c.skill, enabled: c.enabled, ...out, request: spec });
        await q(`INSERT INTO pmd_admin_log (by_email, person_key, user_id, skill, enabled, dry_run, ok, http_status, detail)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [me.email, b.key || null, userId, c.skill, c.enabled, dry, out.ok, out.status, out.detail]);
      }
    }));

    // remember what admin now has (only real, successful writes)
    if (!dry && b.key) {
      const row = (await q("SELECT pushed FROM pmd_team WHERE key = $1", [b.key]))[0];
      let pushed = {}; try { pushed = JSON.parse(row?.pushed || "{}"); } catch {}
      results.filter(r => r.ok).forEach(r => { pushed[r.skill] = r.enabled; });
      await q(`INSERT INTO pmd_team (key, pushed, updated_by) VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET pushed = $2, updated_by = $3, updated_at = now()`, [b.key, JSON.stringify(pushed), me.email]);
    }
    const order = new Map(changes.map((c, n) => [c.skill, n]));
    results.sort((a, z) => order.get(a.skill) - order.get(z.skill));
    return reply(res, 200, { dryRun: dry, ok: results.every(r => r.ok), results });
  } catch (err) {
    return reply(res, 500, { error: String(err.message || err) });
  }
}
