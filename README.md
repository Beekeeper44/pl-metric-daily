# PL Metric Daily (team-metrics)

Vercel app: static page (`public/index.html`) + one serverless function (`api/metabase.js`) that proxies Metabase so the API key stays server-side.

## Deploy
1. Push this folder to a GitHub repo (or run `vercel` from it).
2. In Vercel → New Project → import the repo. Framework preset: **Other**. No build command, output = `public` (default for static files).
3. Settings → Environment Variables: `METABASE_HOST`, `METABASE_API_KEY` (see `.env.example`). Question IDs default to 4999 and 46135.
4. Deploy. The page loads live data from `/api/metabase` (All Orders (PL)) and `/api/metabase?q=today` (totals). If the API fails it shows labeled demo data; `?demo` forces demo.

Pass-off tracker fed by the Metabase question **All Orders (PL)**.

## Vercel env
- `METABASE_HOST` – https://arena-club.metabaseapp.com
- `METABASE_API_KEY`
- `PL_ORDERS_QUESTION_ID` – optional; defaults to **4999** (All Orders (PL), https://arena-club.metabaseapp.com/question/4999)
- `PL_TODAY_QUESTION_ID` – optional; defaults to **46135** (https://arena-club.metabaseapp.com/question/46135), which feeds the totals. SQL reference in `sql/team-metrics-today.sql`.

## Rules (edit `RULES` / `CONFIG` at the top of the script in public/index.html)
- Arena Club = FULL_NAME of "Arena Club", "arenaclub" or "AC". Everything else = customer.
- GRADED = slabs, RAW = raw.
- An order is complete when EV is done ($ column) or it has the ✅. Change with `RULES.completeWhen` ("either", "check", "ev"). Not complete = in the queue.
- Targets: type them on the page (each tile and the total). Defaults: AC slabs 5,000 · AC raw 800 · Customer raw 400 · Customer slabs blank. Total target = sum of the tile targets (not editable). Targets and dates are saved in this browser.

If the API is unavailable the page falls back to labeled demo data; use **Load CSV** to load a Metabase CSV export instead. Add `?demo` to the URL to force demo data.

## Tile sources (first available wins)
1. Metabase **46135** — rows of METRIC · CURRENT_TOTAL:
   - AC Slabs Released (Pending Slabbing) = `slab_packs_pregraded` · AC Raw Released (Pending Assembly) = `slab_packs_raw` · AC Raw EV Completed = `slab_packs_raw_ev_completed`
   - Customer Raw Released (Pending Assembly) = `customers_raw` · Customer Slabs Released (Pending Slabbing) = `customers_pregraded`
   - `total_cards` is shown next to the total. (The older OWNER/TYPE/SOURCE/CARDS shape is still understood.)
2. All Orders (PL) *_today columns
3. Cards on done ($ or ✅) orders
- Only tiles with a target count toward the total.

## Queues
- **Needs Review** = status `pending_review` (pending_release never needs review). Raw / pre-graded × AC / customer via the segment cards.
- **Needs Estimated Value** = Arena Club orders without the ✅. Customers never go to the EV queue.
- **All Open** = orders that aren't done ($ or ✅).

## Teams (logo bottom right of each tile)
- **Oregon Team** (Arena Club logo): AC Raw Released, Customer Raw Released
- **Both teams** (both logos): AC Pre-Graded Released, Customer Pre-Graded Released
- **PL Team** (PL logo): AC Raw EV Completed (`slab_packs_raw_ev_completed`), Customer Raw Completed (`customers_raw_reviewed`; falls back to `cust_raw_today` from All Orders (PL))
Logos are embedded in index.html; copies are in public/.

## Tile status
- **Completed** (green) — target met, or no target
- **On Track · N to go** (yellow) — short, but ahead of the pace the start/end dates call for
- **Behind · N** (red) — short and behind that pace (N = cards behind pace)
- **Short · N** (red) — short, no dates set

## Views
Tabs at the top: **Metrics** (total + team tiles) and **Queue**. Bookmark with `#metrics` or `#queue`.
Clicking a tile or "Show in Queue" opens the Queue view filtered.

## Fit to screen
The Metrics view scales itself to fill the monitor exactly (no scrolling, no empty space): it shrinks on small screens and grows on big monitors (0.6×–1.8×, at 90% of full-screen size — `FIT.scale` in the script). The Queue view scales to the same size (limited so the table always fits the width) and scrolls up/down.

## All rows
- The API uses Metabase's export endpoint (`/api/card/:id/query/json`), which returns every row — not the 2,000-row cap of the normal query endpoint.
- Rows are sent compact (`{ cols, data, count }`) to stay under Vercel's 4.5 MB response limit (~12k orders ≈ 1.8 MB).
- The status bar shows how many rows came back from 4999 and 46135. **Queue → All Rows** lists every row returned.

## Tabs
**Metrics · Queue · Team** — all three use the same size (the Metrics fit-to-screen scale); a table only shrinks if it would otherwise scroll sideways.

## Team tab
Oregon Team and PL Team rosters: name, role/station, done today, daily target, with a progress bar and team totals. Add/remove people inline. Saved in this browser (localStorage) — not shared between computers yet.

## Refresh Metabase
The **Refresh Metabase** button re-runs both questions (All Orders (PL) 4999 + totals 46135) — also while demo data is showing. Auto-refresh runs every 5 minutes. If a refresh fails after live data has loaded, the last live data stays on screen with a "Last refresh failed" note.

## Date range (calendar)
- Picking a start/end date updates the page instantly (duration, pace, statuses).
- When both dates are set, the page re-runs **46135** for that range and the tiles show the range's numbers ("Metabase range Oct 1 – Oct 31" under the total).
- For this to work, 46135 needs two **Date** variables named `start_date` and `end_date` in its SQL, e.g.
  ```sql
  WHERE 1=1
    [[AND <event date column> >= {{start_date}}]]
    [[AND <event date column> <  DATEADD('day', 1, {{end_date}})]]
  ```
  Without them, the page keeps the all-time totals and says "46135 has no date filter yet". (Names can be changed with `RANGE_START_TAG` / `RANGE_END_TAG`.)
