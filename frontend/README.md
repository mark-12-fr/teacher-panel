# AcadTrack Teacher — Web (Next.js)

React/Next.js frontend for the Teacher panel. Uses **Supabase Auth** for sign-in
(email/password, Google OAuth, OTP password reset) exactly as the original, and
calls the FastAPI backend (`../backend`) for all data.

```
Next.js (web/)  →  FastAPI (../backend)  →  Supabase PostgreSQL
                 └─ Supabase Auth (login only)
```

## Run locally
```bash
cd web
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_BASE + Supabase anon key
npm run dev                        # http://localhost:3000
```

## Status
- ✅ Foundation: Supabase auth client, API client (Bearer token), theme
  (light/dark + cross-device sync), no-flash theme, layout.
- ✅ `/` landing (home) and `/login` (email/password, Google, OTP reset).
- ⏳ In progress: `/sign`, `/dashboard`, and the section management pages
  (sections/attendance/records/performance list+detail), grading-system,
  facilitators, AI assistant, and static pages.

## Config
- `NEXT_PUBLIC_API_BASE` — FastAPI backend URL.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase Auth
  (public). Default to the AcadTrack project when unset.
