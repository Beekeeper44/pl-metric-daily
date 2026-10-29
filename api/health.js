// GET /api/health — which settings are present (never their values) and whether the database answers.
import { q } from "../lib/db.js";

export default async function handler(req, res) {
  const has = k => !!(process.env[k] && String(process.env[k]).trim());
  const out = {
    api: true,
    METABASE_HOST: has("METABASE_HOST"),
    METABASE_API_KEY: has("METABASE_API_KEY"),
    DATABASE_URL: has("DATABASE_URL"),
    SESSION_SECRET: has("SESSION_SECRET") && String(process.env.SESSION_SECRET).length >= 16,
    SETUP_CODE: has("SETUP_CODE"),
    database: false,
    users: null,
  };
  if (out.DATABASE_URL) {
    try { out.users = (await q("SELECT COUNT(*)::int AS n FROM pmd_users"))[0].n; out.database = true; }
    catch (e) { out.databaseError = String(e.message || e).slice(0, 200); }
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(out);
}
