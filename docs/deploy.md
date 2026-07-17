# Deploying AcadTrack Teacher (React/Next.js → FastAPI → Supabase)

The app is two deployables plus the existing database:

```
frontend/  →  Next.js frontend   →  Vercel
backend/   →  FastAPI API        →  Render
              (both talk to the SAME Supabase Postgres — no data migration)
```

Built by **MJR Vertext** (Mark Frizas, Rutz Cabrera, Jean Rose Banay). Presented at Innovex 2026, Indonesia.

---

## 1) Backend → Render

The repo ships a `render.yaml` Blueprint (at repo root) that already points at `backend/`.

**Option A — Blueprint (recommended):**
1. Render Dashboard → **New +** → **Blueprint** → pick this repo.
2. Render reads `render.yaml` and creates the **teacher-panel-api** web service.
3. Fill in the secret env vars it prompts for (marked `sync: false`) — see below.
4. **Create** → wait for the first deploy, then note the URL, e.g.
   `https://teacher-panel-api.onrender.com`.

**Option B — Manual web service:**
- New + → **Web Service** → this repo
- **Root Directory:** `backend`
- **Runtime:** Python 3.12
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Health Check Path:** `/api/ping`

### Backend environment variables (Render → Environment)
| Key | Value / where to find it |
| --- | --- |
| `DATABASE_URL` | Supabase → Settings → Database → **Transaction pooler** URI, port `6543`, then change the scheme to **`postgresql+asyncpg://`** (e.g. `postgresql+asyncpg://postgres.njzvuwkepaasnsvuujgx:PASSWORD@aws-0-<region>.pooler.supabase.com:6543/postgres`) |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → **JWT Secret** |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |
| `SUPABASE_URL` | `https://njzvuwkepaasnsvuujgx.supabase.co` |
| `CORS_ORIGINS` | Frontend origins, comma-separated: `https://acadtrack.asia,https://www.acadtrack.asia` |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | Optional — enables the AI assistant's advisory replies |
| `VAPID_*` | Optional — Web Push |

> The engine is already pooler-safe (`NullPool`, `statement_cache_size=0`), so the
> Transaction pooler works out of the box. Verify with
> `https://<your-service>.onrender.com/api/ping` → `{"ok": true}`, and browse the
> interactive docs at `/docs`.

### Backend → Railway (alternative to Render)

The repo ships `backend/railway.json` (start command + `/api/ping` health check)
and `backend/.python-version` (3.12.9). The one setting that matters is the
**Root Directory** — it MUST point at `backend/`, otherwise Nixpacks looks for
`requirements.txt` in the wrong place and the build fails with
`Could not open requirements file: .../backend/requirements.txt`.

1. Railway → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Open the service → **Settings → Source** → set **Root Directory** to
   **`backend`** → **Save**. (This is the fix for the failed build.)
3. **Settings → Build** → leave the Build/Install command **empty** so Nixpacks
   auto-detects `requirements.txt` (do NOT set `pip install -r backend/requirements.txt`
   here — with Root Directory already at `backend/` that would double the path).
4. `backend/railway.json` supplies the start command
   (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`) and health check — nothing
   to type.
5. **Variables** → add the same env vars as the Render table above
   (`DATABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, `CORS_ORIGINS`, etc.).
   Railway injects `PORT` automatically.
6. **Deploy** → verify at `https://<your-service>.up.railway.app/api/ping` → `{"ok": true}`.

---

## 2) Frontend → Vercel

Point Vercel at `frontend/`:

1. Vercel → project **teacher-panel** → **Settings → Build & Deployment**.
2. Set **Root Directory** to **`frontend`** → **Save**. Vercel auto-detects Next.js.
3. **Settings → Environment Variables** → add:
   - `NEXT_PUBLIC_API_BASE` = your Render URL (e.g. `https://teacher-panel-hej2.onrender.com`)
4. **Deployments → Redeploy** (or push a commit).

Your domains (`acadtrack.asia`, `www.acadtrack.asia`) now serve the React app.

---

## 3) Verify end-to-end
- Open `https://acadtrack.asia` → the React login should load.
- Sign in → dashboard, sections, class record, attendance, performance,
  grading, facilitators, and AI assistant all work against the API.
- If API calls fail with a CORS error, double-check `CORS_ORIGINS` on Render
  matches the exact frontend origin.

## 4) (Optional) Clean up legacy static app
Once the React app is live, old root files (`*.html`, `ai-assistant.js`, etc.)
can be removed. They remain in git history.
