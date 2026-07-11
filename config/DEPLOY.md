# Deploying AcadTrack Teacher (React/Next.js → FastAPI → Supabase)

The app is two deployables plus the existing database:

```
frontend/  →  Next.js frontend   →  Vercel
backend/   →  FastAPI API        →  Render
              (both talk to the SAME Supabase Postgres — no data migration)
```

> **Current state:** the Vercel project is still building the repo **root** (the
> old static HTML). After the two steps below, the live site serves the new
> React app and calls the FastAPI backend.

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
- **Runtime:** Python 3.11
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
| `CORS_ORIGINS` | Your frontend origins, comma-separated: `https://acadtrack.asia,https://www.acadtrack.asia` |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | Optional — enables the AI assistant's advisory replies |
| `VAPID_*` | Optional — Web Push |

> The engine is already pooler-safe (`NullPool`, `statement_cache_size=0`), so the
> Transaction pooler works out of the box. Verify with
> `https://<your-service>.onrender.com/api/ping` → `{"ok": true}`, and browse the
> interactive docs at `/docs`.

---

## 2) Frontend → Vercel

The Vercel project currently builds the repo root. Point it at `frontend/`:

1. Vercel → project **teacher-panel** → **Settings → Build & Deployment**.
2. Set **Root Directory** to **`frontend`** → **Save**. Vercel now auto-detects Next.js.
3. **Settings → Environment Variables** → add:
   - `NEXT_PUBLIC_API_BASE` = your Render URL (e.g. `https://teacher-panel-api.onrender.com`)
   - *(optional)* `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Deployments → Redeploy** (or push a commit).

Your domains (`acadtrack.asia`, `www.acadtrack.asia`) now serve the React app.

---

## 3) Verify end-to-end
- Open `https://acadtrack.asia` → the new React login should load.
- Sign in → the dashboard, sections, class record, attendance, performance,
  grading, facilitators, and the AI assistant should all work against the API.
- If API calls fail with a CORS error, double-check `CORS_ORIGINS` on Render
  matches the exact frontend origin (scheme + host, no trailing slash).

## 4) (Optional) Clean up the legacy static app
Once the React app is confirmed live, the old root files
(`*.html`, `ai-assistant.js`, `grading.js`, the root `vercel.json`, etc.) can be
removed so the repo cleanly reflects the React/FastAPI stack. They remain in git
history. Ask and this can be done as a separate PR.
