# PashuRaksha

Livestock early-warning & syndromic surveillance system. Farmers/vets submit symptom reports in the field; the backend runs rule-based disease triage and DBSCAN geospatial clustering to flag active outbreak zones, and the frontend renders them on a zoomable choropleth of India.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + Tailwind v4 |
| Map | d3-geo + topojson-client over a bundled India TopoJSON |
| Backend | FastAPI (Python), deployed as a Vercel serverless function |
| Database | Neon (serverless Postgres) |
| ORM | SQLAlchemy |
| Outbreak detection | scikit-learn (DBSCAN, haversine distance) |
| Mobile | Installable PWA (vite-plugin-pwa / Workbox) |
| Hosting | Vercel (2 separate projects, same repo) |

## Repo structure

```
.
├── backend/
│   ├── main.py                  # FastAPI app, triage, clustering, analytics
│   ├── livestock_registry.py    # the dummy Pashu Aadhaar registry (generated)
│   ├── requirements.txt
│   └── vercel.json
├── pashuraksha-app/             # Vite/React frontend (actual app root)
│   ├── vite.config.js           # build + PWA/Workbox config
│   ├── public/
│   │   ├── maps/india.json      # 36 states + 723 districts, one TopoJSON
│   │   ├── icon.svg             # app icon source
│   │   └── icons/               # rasterised PWA icons
│   └── src/
│       ├── App.jsx              # login + role-aware dashboard shell
│       ├── api.js, constants.js
│       ├── index.css            # design system (see "Design" below)
│       └── components/
│           ├── MapExplorer.jsx  # choropleth, spread bubbles, state zoom
│           ├── Level.jsx        # headline stat cards (also the map's switch)
│           ├── StateTable.jsx   # state → district expandable table
│           ├── Timeseries.jsx   # daily/cumulative trend cards
│           ├── SubmitReportPanel.jsx
│           ├── Panels.jsx       # reports / clusters / lab / admin
│           ├── PwaPrompts.jsx   # install + update-available bars
│           ├── Navbar.jsx, Modal.jsx
├── scripts/reset-demo.sh        # restore demo data to a known-good state
└── .claude/launch.json          # `npm run dev` preview config
```

## Design

The dashboard is modelled on [incovid19.org](https://www.incovid19.org/) (the
covid19india.org tracker). Ported deliberately:

- **Statistic palette** — `#ff073a` reported, `#007bff` active, `#fd7e14` critical,
  `#28a745` resolved, `#6c757d` mortality, `#4b1eaa`/`#9673b9` samples.
- **Alpha ramp** — tints at `0.0627 / 0.125 / 0.188 / 0.313` alpha, muted text at `0.6`.
- **Two-surface dark theme** — `#161625` ground, `#1e1e30` cards, `#f6f6f7` text.
- **Stat cards as the control surface** — clicking a card re-colours the map,
  legend and table sort in one action, rather than a separate dropdown.
- **Choropleth inversion** — the map is authored light-first and the whole
  `#chart` group is flipped with `invert(1) hue-rotate(180deg)` in dark mode, so
  one colour ramp serves both themes.

Typography substitutes **Archivo** for incovid19's licensed `archia`.

### Map

`public/maps/india.json` carries `states` (36) and `districts` (723) in a single
TopoJSON. The country view draws states; clicking one refits the Mercator
projection to that state's bounds and re-renders from its districts — a
projection refit rather than an SVG transform, so borders stay crisp at zoom.
Active DBSCAN clusters are drawn on top as dashed orange rings at their true
centroid, in both map modes.

Boundaries are illustrative and carry no political claim.

## The Pashu Aadhaar registry

`backend/livestock_registry.py` generates a deterministic dummy registry:

| | |
|---|---|
| Animals | **2,267** |
| Owners | **251** |
| States | **21** |
| Districts | **239** |
| Largest holding | 26 (`amrit_dairy_farm`, the one permitted large holder) |
| Every other holding | ≤ 20 |

Districts are weighted toward the high-livestock states of the 20th Livestock
Census. Each district's coordinates are its **pole of inaccessibility** — the
interior point furthest from any boundary — computed from that district's real
polygon in `india.json`, and the random scatter applied to homesteads and
animals is bounded by that point's boundary clearance. The result is that all
2,267 animals verifiably fall inside the district *and* state their record
names, so a report never lands in the wrong district or in the sea.

Import-time assertions enforce: 12-digit format, no duplicate tags, at most one
owner above 20 animals, and one display name per owner id.

The eleven original demo owners (`farmer_01`, `ravi_kumar`, …) and their exact
tag numbers are preserved, so anything previously written down still works.

### Auto-fill and ownership gating

Typing a complete 12-digit number into the report form triggers
`GET /api/v1/livestock/{pashu_aadhaar}`, which resolves to one of four states:

| Case | Behaviour |
|---|---|
| Registered to you | Green banner, village/district/state/GPS filled and locked |
| Registered to someone else | **403** — red banner, location block hidden, submit disabled |
| Not in the registry | Amber banner, manual location entry allowed |
| Not 12 digits | 400 before any lookup |

A `FARMER` may only look up and file against animals in their own name. Vets and
admins may look up any animal, and the response flags that it isn't theirs.

## Installing on a phone (PWA)

The frontend is a Progressive Web App, so it installs to a phone home screen
and runs fullscreen with no browser chrome — no app store, no native build.

**Android / Chrome** — open the deployed URL; an "Install PashuRaksha" bar
appears at the bottom. Or use ⋮ → *Install app*.

**iOS / Safari** — open the deployed URL, tap **Share**, then
**Add to Home Screen**. (iOS has no programmatic install, so the app shows the
instruction instead of a button.)

Once installed it launches from its own icon, keeps the dark/light theme, and
tints the status bar to match.

### What works offline

`vite-plugin-pwa` (Workbox) precaches the app shell **and `maps/india.json`**,
so the outbreak map renders on a phone with no signal — the map is the primary
screen and a blank one would defeat the point of offline support.

| Request | Strategy | Why |
|---|---|---|
| App shell, JS/CSS, icons, `india.json` | Precache | Must render cold with no network |
| `/api/v1/*` | NetworkFirst, 6s timeout | A dashboard showing yesterday's clusters as current is worse than showing nothing. Cache is a dead-link fallback; the short timeout stops a flaky rural link hanging on a spinner |
| Google Fonts | StaleWhileRevalidate / CacheFirst | Only cross-origin request; avoids falling back to system sans offline |

Reports submitted while offline still go to the existing localStorage queue and
sync on reconnect — that path predates the PWA and is unchanged.

Updates use `registerType: 'prompt'`, not `autoUpdate`: a new service worker
shows a "new version ready — Reload" toast instead of reloading immediately,
which would discard a half-filled report out from under a farmer in the field.

### Icons

`public/icon.svg` is the source — the same concentric ring the map draws over a
detected cluster. `public/icons/` holds the rasterised sizes. To regenerate
after editing the SVG (macOS, no extra tooling needed):

```bash
qlmanage -t -s 512 -o /tmp/icongen pashuraksha-app/public/icon.svg && sips -Z 192 /tmp/icongen/icon.svg.png --out pashuraksha-app/public/icons/icon-192.png
```

The maskable variant is a separate full-bleed square (`icon-maskable-512.png`) —
declaring the rounded icon as maskable gets it cropped twice and looks clipped.

## Deployment

Two independent Vercel projects on the same GitHub repo, both auto-deploy on push to `main`:

- **Frontend** — Root Directory: `pashuraksha-app`. Env var: `VITE_API_BASE_URL` (backend URL + `/api/v1`). Baked in at build time — changing it requires a redeploy.
- **Backend** — Root Directory: `backend`. Env vars: `DATABASE_URL` (Neon **pooled** connection string — must include `-pooler` in the hostname, or it'll exhaust Neon's connection limit under load) and optionally `CORS_ALLOW_ORIGINS` (comma-separated) to allow extra origins such as Vercel deploy-preview URLs.

  The allowlist already covers the production frontend plus `localhost:5173` (dev) and `localhost:4173` (`npm run preview` — needed to exercise the installed-PWA build locally).

## Local dev

```bash
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload
```

```bash
cd pashuraksha-app && npm install && npm run dev
```

The backend falls back to local SQLite if `DATABASE_URL` isn't set. Seed the
dashboard from **Admin Tools → Seed demo data** (or
`POST /api/v1/admin/seed-demo?count=700&hotspots=14`).

Demo logins: `vet123` / `farmer123` / `admin123`, with any user id.

## Auth model (important — not real auth)

Every request needs `X-User-ID` and `X-User-Role` headers (`FARMER` / `VET` / `ADMIN`). These are **trusted at face value** — there's no token, session, or verification behind them. Anyone can self-declare `ADMIN`. Fine for a prototype/demo; do not treat as access control if real farmer/vet data goes through this.

The ownership gating above is enforced on the server, but only against that
self-declared identity, so it is a correctness feature, not a security boundary.

## Demo data generation

`POST /api/v1/admin/seed-demo` does **not** scatter reports uniformly. With
~2,300 animals across 239 districts a uniform draw puts one or two cases in each
district and DBSCAN finds nothing. Instead ~70% of the volume is concentrated
into randomly chosen epicentre districts, each running a single
disease-consistent symptom set, with the rest scattered nationally as background
noise — dense correlated pockets against a thin diffuse baseline, which is the
shape a real outbreak has. A 700-report seed reliably yields ~11 clusters.

## Resetting demo data

After a mishap, an "Clear all", or any time the dashboards come up empty:

```bash
./scripts/reset-demo.sh --api https://pashuraksha-backend.vercel.app/api/v1
```

Omit `--api` to target `http://localhost:8000/api/v1`. It prompts before
destroying anything — type `reset` to confirm, or pass `--yes` to skip the
prompt (CI). Needs only `curl` and `python3`.

It runs four steps, all against the public API — no database access needed:

1. **Delete** every report and lab sample.
2. **Seed** 700 backdated reports over 30 days across 14 epicentre districts.
3. **Run cluster detection** — this is the step people forget. Seeding alone
   leaves the map with no outbreak rings, because `cluster_id` is only stamped
   onto reports when `/analytics/clusters` runs.
4. **File one case for `ravi_kumar`** so the farmer-facing "My Reports" tab
   isn't empty. If the random seed already gave his animals a case, that step
   reports it and moves on.

Then it verifies non-zero totals and a multi-state spread, and fails loudly if
either is wrong.

### What it does not touch

The **Pashu Aadhaar registry**. It is never deleted by any endpoint, and the
backend re-seeds it from `livestock_registry.py` on every startup. If
`registry-stats` ever reports 0 animals, the fix is a backend restart (redeploy,
or any change that cold-starts the function) — not this script, which refuses to
run against an empty registry rather than producing meaningless data.

### Reproducibility

The dataset is pinned to `seed=42`, so a reset produces the same epicentres,
the same totals and the same clusters every time. That only holds because the
seeder orders its registry query by primary key — an unordered query returns
rows in database-dependent order, and the same seed then picked different
epicentres on SQLite and on Neon. If you change `--seed` or `--count`, expect a
different (but equally repeatable) dataset.

Report timestamps are backdated relative to *now*, so the 30-day timeseries
always ends today rather than at some fixed past date.

## Data persistence & recovery

- Production data lives in Neon Postgres, not in Vercel — Vercel functions have no persistent disk.
- Neon free tier: 6-hour instant point-in-time restore window. Beyond that, deleted/corrupted data is unrecoverable — `git revert` does **not** undo database changes, only code.
- `DELETE /api/v1/reports` wipes all reports/samples, gated only by the self-reported `ADMIN` header above. The frontend puts a typed confirmation and a modal in front of it; the API does not. Recovery is `./scripts/reset-demo.sh` — see [Resetting demo data](#resetting-demo-data).
- The livestock registry re-seeds itself on startup, so clearing reports never destroys it.
- Local SQLite (dev only) is `.gitignore`d and never touches production data.

## Known limitations

- `tag_id` uniqueness is enforced at the application level, not a DB constraint — a small race-condition window exists under concurrent submissions.
- `GET /api/v1/analytics/clusters` mutates the database (it writes `cluster_id` back onto reports). A GET with side effects is wrong, but it's what the frontend and the map currently depend on.
- Cold starts: the Vercel function imports sklearn/numpy and seeds ~2,300 registry rows on first boot (~15s worst case, warm ~0.7s). Subsequent boots find the registry already present and skip the insert.
- Voice symptom input is a stub — the button opens a "will be implemented" notice.
- `GET /api/v1/reports` returns every report unpaginated; the frontend paginates client-side at 40 rows.

## Attribution

District/state boundaries in `public/maps/india.json` come from the
covid19india.org project's map assets (Census 2011 administrative boundaries).
The dashboard's visual language is adapted from the same project.
