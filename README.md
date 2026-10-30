# PL Metric Daily (team-metrics)

Vercel app: static page (`public/index.html`) + one serverless function (`api/metabase.js`) that proxies Metabase so the API key stays server-side.

## Deploy
1. Push this folder to a GitHub repo and import it in Vercel (Framework preset: **Other**, no build command).
2. Settings → Environment Variables (see `.env.example`):
   - `METABASE_HOST`, `METABASE_API_KEY`
   - `DATABASE_URL` — Neon Postgres (your existing Neon DB is fine; tables are `pmd_users`, `pmd_invites`, `pmd_login_attempts`)
   - `SESSION_SECRET` — long random string
   - `SETUP_CODE` — any secret word, only for creating the first admin
3. Deploy, open the site → **First-time setup**: your name, email, password and the setup code → you're the first admin.
4. Delete `SETUP_CODE` in Vercel and redeploy.

## Users & invite links (same layout as TAG-BOT)
- **Users** tab (admins) or the green **+ Add user** button in the status bar.
- Top row: **Name · Work email · Role** (`member — full access` / `admin — full access + users`) → **Add person** → **Copy link** or **email it**.
  They open the link, set a password, and they're in; after that they sign in with email + password. Links work once and last 7 days.
- Table: person · role (change it from the dropdown) · access · status (**active** / **invited** / **off**) · last sign-in · actions:
  - active → **reset password link**, **turn off** (signs them out right away, can't sign in)
  - off → **turn on**, **delete**
  - invited → **new invite link**, **cancel**
  - Members' access can be narrowed: click their access text → tick Metrics / Queue / Team / Edit targets & dates / Refresh Metabase.
- **Your password**: current + new (10+ characters) → **Change password** (other devices are signed out).
- **Add from the team list** (collapsed at the bottom): tick people from Metabase 46168 and create their links in one go.
- At least one admin always stays; you can't turn yourself off.
- Security: scrypt password hashes, invite links stored only as SHA-256 hashes, signed HttpOnly cookie (30 days) re-checked against the database, 8 wrong tries per 15 minutes. `/api/metabase` only answers signed-in users.
- Locked out with no admin: in Neon run `DELETE FROM pmd_users;`, set `SETUP_CODE` again, redeploy → setup screen.

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

If the API is unavailable the page falls back to labeled demo data; use **Load CSV** to load a Metabase CSV export instead. Add `?demo` to the URL to force demo data. Opened anywhere without the API (local file, Claude artifact), the page goes straight to the demo preview instead of the sign-in screen.

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
- **Director · Oregon + PL** (anyone whose role contains "Director" — Alan) on top.
- **Who's on which team (from 46168):** `@arenaclub.com` emails → **Oregon**; any other email → **PL**. "Director" in the role → Director. An admin can still move anyone (✎ Edit → Team).
  Oregon people are never matched to PL roster names, so an Oregon "Pat Castillo" and a PL "Pat Castillo" stay separate.
- **Oregon Team** from **Metabase 46168** (USER_ID · FULL_NAME · ROLE · EMAIL · LAST_ACTIVITY_PT · TASKS_LAST_14D):
  name, role, "active Xm ago" (green + pulsing dot under 5 minutes, Pacific time, refreshes every minute) and Tasks Last 14 Days.
- **PL Team** — built-in roster (`PL_ROSTER` in index.html, 129 people from the Team Leveling list): Name · Dept · Title · Tier · Reports to,
  with Dept filter pills (Lead, CS, Review, Data, Items, Grading, Recomp, Community) and counts. Search covers name, title, dept, tier and reports-to.
- **Fold teams from the logo:** click a team's logo (top right of each card) to collapse/expand Director, Oregon or PL. Closing PL also closes every group inside it (in all Group by views), so it reopens as a tidy list of group headers — open the ones you want or use expand all. Open teams have a neon-green glowing logo; folded ones show their head-count. Remembered in this browser.
- Selected filter/group pills on the Team tab are neon green.
- **PL grouping:** Group by **Dept** (default) · **Reports to** (each manager with their people, Karl → Marco / Ehm / Peds / Jensen) · **Tier** · **No groups**.
  Click a group header to collapse/expand it, or use collapse all / expand all. Choice and collapsed groups are remembered in this browser. Dept filter pills still work on top.
- The person window opens **read-only**. Admins press **✎ Edit** (bottom of the window, or the ✎ Edit that appears when you hover a row) to change details and skills;
  **Save** keeps it and returns to view, **Cancel** drops the changes and closes the window. The window shows an orange "EDITING" tag while you're editing.
- **Click any name → person window**: details (email, last active, tasks) and their **Skills** grid (68 admin skills, green = has it, red = doesn't).
  Skills show as pills with a soft colour fill: green = on, red = off, dark = not set. Admins click a pill to turn it on/off — it saves right away (no need to press Edit). Click a row name (e.g. GRADING, CARD TYPES) to turn that whole row on/off. Grouped (Grading, Verify grading, Card types, Verify card types, Sets & value, Orders & vault, Items & marketplace, Support & admin) with counts.
  Admins edit name / title / team / dept / tier / reports to / hide, click skills to flip them, or use each group's "all on/off" (plus All on · All off · Clear) → **Save**. Members view only.
  Skills start "not set" (Alan is pre-filled from the admin skills screen) and are saved in Neon. The window always fits the screen (no scrolling) — it scales itself down on smaller screens.
- **1st / 2nd / 3rd Option** (gold / silver / copper pills next to "Skills"): each person can have three saved skill sets.
  - **✎** next to an option → set it up: click skills or whole rows to include them (green ring), Copy current skills / Clear, then **Save option**.
  - Click the option pill → those skills turn on (everything else off) and it's saved; the active option is filled in. Changing a single skill afterwards clears the "active" mark.
  - An option that isn't set up yet has a dashed outline; clicking it starts the setup. Saved in Neon per person.
- **Whole-group options:** every group header on the PL list (Grading, CS… or each manager / tier) has **1st / 2nd / 3rd Option** pills with how many people
  in that group have that option set up. Click one → confirm → everyone in the group switches to **their own** saved option (skills + "active" mark saved);
  people without it are skipped. A green bar shows the result with **⇪ Push N to admin** to write all of their changes to Arena admin in one go.
  The pill fills in when everyone who has it set up is on it.
- **Name search:** type in the Team search box and it fills in the first matching name (the rest is selected, so you can keep typing). A list of matches drops down — ↑/↓ to move, **Enter** or **Tab** to pick, Esc to close. Picking a name shows just that person; **Enter** again opens their window.
- **1st / 2nd / 3rd on every row** (admins): small gold / silver / copper pills next to ✎ Edit, with the skill count once set up. Click one → that person switches to that option (skills saved, then open them and ⇪ Push to write it to admin). Dashed = not set up yet → clicking opens their window in setup mode for that option.
- **Copy skills → save as an option:** after ⧉ Copy skills on anyone, every person window shows **⇩ <Name>’s skills as 1st · 2nd · 3rd** — click one to save the copied ON skills as that option (asks before replacing one that's already set up). While setting up an option, **Paste <Name>’s skills** picks the copied ON skills.
- **⧉ Copy skills / ⇩ Paste** (person window): Copy takes that person's on, off and not-set skills (and puts a readable On / Off list on the clipboard for Slack).
  Open someone else → **Paste from <name>** (shows how many on / off) gives them exactly the same skills and saves right away (in edit mode it waits for Save).
  The copy is remembered in this browser until you copy someone else.
- **Reorder (admins):** drag a row by the ⠿ handle, or type a number in its position box (Enter). Works for Director, Oregon and PL (PL numbers are positions in the full PL list, even when a Dept filter is on). Order is saved for everyone.
- **Edit team** still opens inline editing for everyone at once and the **+ Add** rows.

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

## Push skills to Arena admin
- Person window → **⇪ Push to admin** (admins). It compares the window's skills with what was last written to admin and lists only the changes
  (+ Crop, − Mcp Access…). **Confirm** → one call per skill; each shows ✓ / ✗ with the HTTP status. Failed ones stay in the list for the next push.
- **Live progress:** after **Write N to admin** every skill shows as a chip that spins while it's being written and turns ✓ green or ✗ red (with admin's reply) —
  with a progress bar and "8 of 18 done · writing Review, …". Skills go 4 per request, one request at a time.
- **Completion notification** (bottom right): green "all N skill changes written to Arena admin" (closes itself), or red with what failed (stays until dismissed).
  Group pushes show a progress bar in the green bar and the same notification at the end.
- **Who:** admin user IDs come from **Metabase 46168** (`USER_ID`) for everyone. PL roster people are matched to 46168 by full name, first + last name, or email —
  they stay on the PL list with their roster dept/title/tier/manager and also get their USER_ID, email, last active and tasks (and drop off the Oregon list).
  Anyone 46168 doesn't have can get an ID pasted in ✎ Edit → **Admin user ID** (that override wins).
- **Session:** the server mints its own short-lived admin session through SuperTokens (same as TAG-BOT) — `SUPERTOKENS_*`, `ADMIN_SESSION_USER_ID`.
- **The call** (same as admin's Edit Skills screen): `POST https://admin-api.arenaclub.com/v2/skill/` with `{"userId":"…","kind":"verify_crop","enabled":true}` —
  `enabled:false` turns it off. Skill names are snake_case ("Verify Crop" → `verify_crop`); odd ones can be mapped with `ADMIN_SKILL_NAMES`.
  `GET /api/admin-skills` shows a sample request and any missing settings.
- **Audit log** (Neon `pmd_admin_log`): who, person, user ID, skill, on/off, ok, HTTP status, response. `GET /api/admin-skills?log=1`.
