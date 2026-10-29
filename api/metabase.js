// Proxies Metabase questions so the API key never reaches the browser.
// Env: METABASE_HOST, METABASE_API_KEY,
//      PL_ORDERS_QUESTION_ID  (All Orders (PL))       -> /api/metabase
//      PL_TODAY_QUESTION_ID   (Team Metrics — Today)  -> /api/metabase?q=today
//
// Uses Metabase's export endpoint (/query/json), which returns ALL rows
// (not the 2,000-row cap of the normal /query endpoint).
// Rows are sent back compact — { cols, data } — so large results stay under
// Vercel's 4.5 MB response limit; the page rebuilds the row objects.
const QUESTIONS = {
  orders: () => process.env.PL_ORDERS_QUESTION_ID || "4999",    // All Orders (PL)
  today: () => process.env.PL_TODAY_QUESTION_ID || "46135",     // Team Metrics — Today (feeds the totals)
};

// Date range → Metabase template-tag variables (Date type) on the question
const RANGE_TAGS = { start: process.env.RANGE_START_TAG || "start_date", end: process.env.RANGE_END_TAG || "end_date" };
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

async function runCard(host, key, id, parameters) {
  const body = new URLSearchParams({ format_rows: "false" });
  if (parameters) body.set("parameters", JSON.stringify(parameters));
  const r = await fetch(`${host}/api/card/${encodeURIComponent(id)}/query/json`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await r.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch {}
  return { ok: r.ok && Array.isArray(rows), status: r.status, rows, text };
}

export default async function handler(req, res) {
  const host = (process.env.METABASE_HOST || "").replace(/\/$/, "");
  const key = process.env.METABASE_API_KEY;
  const which = String(req.query.q || "orders");

  if (!QUESTIONS[which]) return res.status(400).json({ error: `Unknown question "${which}"` });
  const id = QUESTIONS[which]();
  if (!host || !key) return res.status(500).json({ error: "Missing METABASE_HOST or METABASE_API_KEY" });

  const wantRange = which === "today" && isDay(req.query.start) && isDay(req.query.end);
  const params = wantRange ? [
    { type: "date/single", target: ["variable", ["template-tag", RANGE_TAGS.start]], value: req.query.start },
    { type: "date/single", target: ["variable", ["template-tag", RANGE_TAGS.end]], value: req.query.end },
  ] : null;

  try {
    let out = await runCard(host, key, id, params);
    let ranged = !!params;
    if (params && !out.ok) {
      // question has no start_date/end_date variables yet → fall back to all-time totals
      out = await runCard(host, key, id, null);
      ranged = false;
      if (out.ok) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ ...compact(out.rows), question: id, ranged, unsupported: true, fetchedAt: new Date().toISOString() });
      }
    }
    if (!out.ok) return res.status(out.status >= 400 ? out.status : 502).json({ error: `Metabase returned ${out.status}`, detail: String(out.text).slice(0, 500) });
    const rows = out.rows;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ...compact(rows), question: id, ranged, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(502).json({ error: "Could not reach Metabase", detail: String(err) });
  }
}

// One column list + arrays of values (keeps big results under Vercel's 4.5 MB limit)
function compact(rows) {
  const cols = [];
  const seen = new Set();
  for (const row of rows) for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return { count: rows.length, cols, data: rows.map(row => cols.map(c => (c in row ? row[c] : null))) };
}
