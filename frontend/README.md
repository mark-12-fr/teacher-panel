# AcadTrack Teacher — Frontend (Next.js)

React/Next.js frontend for the Teacher panel. Uses **Supabase Auth** for sign-in
(email/password, Google OAuth, OTP password reset) and calls the FastAPI backend
(`../backend`) for all data.

Built by **MJR Vertext** — presented at Innovex 2026, Indonesia.

```
Next.js (frontend/)  →  FastAPI (backend/)  →  Supabase PostgreSQL
                       └─ Supabase Auth (login only)
```

## Stack
- React 18 + Next.js 14 (App Router) + TypeScript
- Tailwind CSS, Lucide Icons, Chart.js
- PWA: manifest + service worker

## Run locally
```bash
cd frontend
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_BASE
npm run dev                        # http://localhost:3000
```

## Config
- `NEXT_PUBLIC_API_BASE` — FastAPI backend URL.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase Auth
  (public). Default to the AcadTrack project when unset.
