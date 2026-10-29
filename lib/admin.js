// Arena admin API — same approach as TAG-BOT: the server mints its own short-lived admin
// session through SuperTokens, then calls the admin API. One call per skill; the request shape
// comes from env so it can be matched exactly to what admin's Edit Skills screen sends.
//
// Env:
//   ADMIN_API_URL                https://admin-api.arenaclub.com
//   ADMIN_ORIGIN                 https://admin.arenaclub.com
//   SUPERTOKENS_CONNECTION_URI   SuperTokens core
//   SUPERTOKENS_API_KEY
//   ADMIN_SESSION_USER_ID        user the session is minted for (Alan for now; a bot user later)
//   ADMIN_SESSION_TENANT_ID      default "public"
//   ADMIN_AUTH                   "cookie" (sAccessToken cookie, default) or "bearer"
//   The skill call (taken from admin's own Edit Skills request — these are the defaults):
//     POST https://admin-api.arenaclub.com/v2/skill/   {"userId":"…","kind":"verify_crop","enabled":true|false}
//   ADMIN_SKILL_METHOD           default POST
//   ADMIN_SKILL_PATH             default /v2/skill/
//   ADMIN_SKILL_BODY             default {"userId":"{userId}","kind":"{skill}","enabled":{enabled}}
//   ADMIN_SKILL_NAME_STYLE       snake (verify_crop, default) | kebab | camel | upper | label
//   ADMIN_SKILL_NAMES            optional JSON map for odd ones, e.g. {"Tcg Card Type":"tcg_card_type"}
//   SKILLS_WRITE_CONCURRENCY     default 4


export function skillName(label) {
  let map = {};
  try { map = JSON.parse(process.env.ADMIN_SKILL_NAMES || "{}"); } catch {}
  if (map[label]) return map[label];
  const words = String(label).trim().split(/\s+/);
  switch ((process.env.ADMIN_SKILL_NAME_STYLE || "snake").toLowerCase()) {
    case "kebab": return words.join("-").toLowerCase();
    case "camel": return words.map((w, i) => i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join("");
    case "upper": return words.join("_").toUpperCase();
    case "label": return label;
    default: return words.join("_").toLowerCase();
  }
}

export function configured() {
  const need = ["SUPERTOKENS_CONNECTION_URI", "SUPERTOKENS_API_KEY", "ADMIN_SESSION_USER_ID"];
  return need.filter(k => !process.env[k]);
}

const fill = (tpl, vars, json = false) => String(tpl).replace(/\{(\w+)\}/g, (_, k) =>
  k in vars ? (json && typeof vars[k] === "string" ? JSON.stringify(vars[k]).slice(1, -1) : String(vars[k])) : `{${k}}`);

export function buildRequest(userId, label, enabled) {
  const vars = { userId: encodeURIComponent(userId), skill: skillName(label), label, enabled };
  const base = (process.env.ADMIN_API_URL || "https://admin-api.arenaclub.com").replace(/\/$/, "");
  const method = (process.env.ADMIN_SKILL_METHOD || "POST").toUpperCase();
  const url = base + fill(process.env.ADMIN_SKILL_PATH || "/v2/skill/", { ...vars, skill: encodeURIComponent(vars.skill) });
  const tpl = process.env.ADMIN_SKILL_BODY || '{"userId":"{userId}","kind":"{skill}","enabled":{enabled}}';
  const body = tpl ? fill(tpl, { ...vars, userId }, true) : undefined;
  return { method, url, body };
}

// --- SuperTokens session (cached until shortly before it expires) ---
let cached = null;
async function accessToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const core = process.env.SUPERTOKENS_CONNECTION_URI.replace(/\/$/, "");
  const tenant = process.env.ADMIN_SESSION_TENANT_ID || "public";
  const path = tenant === "public" ? "/recipe/session" : `/${tenant}/recipe/session`;
  const r = await fetch(core + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": process.env.SUPERTOKENS_API_KEY, rid: "session" },
    body: JSON.stringify({ userId: process.env.ADMIN_SESSION_USER_ID, userDataInJWT: {}, userDataInDatabase: {}, enableAntiCsrf: false, useDynamicSigningKey: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== "OK" || !j.accessToken?.token) throw new Error(`SuperTokens session failed (${r.status} ${j.status || ""})`);
  cached = { token: j.accessToken.token, exp: Number(j.accessToken.expiry) || Date.now() + 10 * 60_000 };
  return cached.token;
}

export async function send(reqSpec) {
  const token = await accessToken();
  const headers = { Accept: "application/json", Origin: process.env.ADMIN_ORIGIN || "https://admin.arenaclub.com" };
  if (reqSpec.body !== undefined) headers["Content-Type"] = "application/json";
  if ((process.env.ADMIN_AUTH || "cookie") === "bearer") headers.Authorization = `Bearer ${token}`;
  else { headers.Cookie = `sAccessToken=${token}`; headers["st-auth-mode"] = "cookie"; }
  const r = await fetch(reqSpec.url, { method: reqSpec.method, headers, body: reqSpec.body });
  const text = await r.text();
  return { ok: r.ok, status: r.status, detail: text.slice(0, 300) };
}
