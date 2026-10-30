// Neon Postgres (DATABASE_URL). Tables are created on first use.
import { neon } from "@neondatabase/serverless";

let client;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}
// sql`...` is not used anywhere; every query goes through q(text, params)
export async function q(text, params = []) {
  await ready();
  const c = db();
  return c.query ? c.query(text, params) : c(text, params);
}

let schema;
function ready() {
  if (!schema) schema = (async () => {
    const c = db();
    const run = (t) => (c.query ? c.query(t, []) : c(t, []));
    await run(`CREATE TABLE IF NOT EXISTS pmd_users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      role        TEXT NOT NULL DEFAULT 'admin',
      pass_hash   TEXT NOT NULL,
      session_v   INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login  TIMESTAMPTZ
    )`);
    await run(`CREATE TABLE IF NOT EXISTS pmd_invites (
      id          SERIAL PRIMARY KEY,
      email       TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      role        TEXT NOT NULL DEFAULT 'admin',
      token_hash  TEXT UNIQUE NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await run(`ALTER TABLE pmd_users   ADD COLUMN IF NOT EXISTS perms TEXT NOT NULL DEFAULT ''`);
    await run(`ALTER TABLE pmd_invites ADD COLUMN IF NOT EXISTS perms TEXT NOT NULL DEFAULT ''`);
    await run(`ALTER TABLE pmd_users   ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false`);
    // Team tab: admin edits on top of Metabase 46168 (team, role title, name, hidden) + people added by hand
    await run(`CREATE TABLE IF NOT EXISTS pmd_team (
      key         TEXT PRIMARY KEY,
      name        TEXT,
      role        TEXT,
      email       TEXT,
      team        TEXT,
      hidden      BOOLEAN NOT NULL DEFAULT false,
      manual      BOOLEAN NOT NULL DEFAULT false,
      updated_by  TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS dept TEXT`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS tier TEXT`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS reports_to TEXT`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS sort INTEGER`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS skills TEXT`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS presets TEXT`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS admin_user_id TEXT`);
    await run(`ALTER TABLE pmd_team ADD COLUMN IF NOT EXISTS pushed TEXT`);
    await run(`CREATE TABLE IF NOT EXISTS pmd_admin_log (
      id          SERIAL PRIMARY KEY,
      at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      by_email    TEXT,
      person_key  TEXT,
      user_id     TEXT,
      skill       TEXT,
      enabled     BOOLEAN,
      dry_run     BOOLEAN NOT NULL DEFAULT true,
      ok          BOOLEAN,
      http_status INTEGER,
      detail      TEXT
    )`);
    // shared page settings (tile targets + date range) — one JSON row, same for everyone
    await run(`CREATE TABLE IF NOT EXISTS pmd_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_by  TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await run(`CREATE TABLE IF NOT EXISTS pmd_login_attempts (
      email TEXT NOT NULL,
      at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  })().catch(e => { schema = null; throw e; });
  return schema;
}
