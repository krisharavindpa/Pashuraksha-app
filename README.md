
# PashuRaksha

Livestock early-warning & syndromic surveillance system. Farmers/vets submit symptom reports in the field; the backend runs rule-based disease triage and DBSCAN geospatial clustering to flag active outbreak zones.

## Stack

| Layer | Tech |

|---|---|

| Frontend | React + Vite |

| Backend | FastAPI (Python), deployed as a Vercel serverless function |

| Database | Neon (serverless Postgres) |

| ORM | SQLAlchemy |

| Outbreak detection | scikit-learn (DBSCAN, haversine distance) |

| Hosting | Vercel (2 separate projects, same repo) |

## Repo structure

.
├── backend/ # FastAPI app
│ ├── main.py
│ ├── requirements.txt
│ ├── vercel.json
│ └── .env.example
├── pashuraksha-app/ # Vite/React frontend (actual app root)
│ ├── src/
│ ├── public/
│ └── .env.example
└── render.yaml # unused, kept for history — Render deploy was abandoned



## Deployment

Two independent Vercel projects on the same GitHub repo, both auto-deploy on push to `main`:

- **Frontend** — Root Directory: `pashuraksha-app`. Env var: `VITE_API_BASE_URL` (backend URL + `/api/v1`). Baked in at build time — changing it requires a redeploy.

- **Backend** — Root Directory: `backend`. Env var: `DATABASE_URL` (Neon **pooled** connection string — must include `-pooler` in the hostname, or it'll exhaust Neon's connection limit under load).

Backend was originally targeted at Render; abandoned due to a new-account card-verification block. Now runs as a Vercel Python function instead (zero-config FastAPI detection, no persistent disk).

## Local dev

```bash

# backend

cd backend

python3 -m venv venv && source venv/bin/activate

pip install -r requirements.txt

uvicorn main:app --reload   # falls back to local SQLite if DATABASE_URL isn't set

# frontend (separate terminal, from pashuraksha-app/)

npm install

npm run dev

```

## Auth model (important — not real auth)

Every request needs `X-User-ID` and `X-User-Role` headers (`FARMER` / `VET` / `ADMIN`). These are **trusted at face value** — there's no token, session, or verification behind them. Anyone can self-declare `ADMIN`. Fine for a prototype/demo; do not treat as access control if real farmer/vet data goes through this.

Demo logins in the frontend: `vet123` / `farmer123` / `admin123`.

## Data persistence & recovery

- Production data lives in Neon Postgres, not in Vercel — Vercel functions have no persistent disk.

- Neon free tier: 6-hour instant point-in-time restore window. Beyond that, deleted/corrupted data is unrecoverable — `git revert` does **not** undo database changes, only code.

- `DELETE /api/v1/reports` wipes all reports/samples with no confirmation step, gated only by the self-reported `ADMIN` header above — use with care.

- Local SQLite (dev only) is `.gitignore`d and never touches production data.

## Known limitations

- CORS is wildcard-open (`allow_origins=["*"]`) — safe only because no cookies are used.

- `tag_id` uniqueness is enforced at the application level, not a DB constraint — a small race-condition window exists under concurrent submissions.

- Cold starts: Vercel function (sklearn/numpy import) + Neon compute wake-up can stack on the first request after idle time (~3–5s worst case).

