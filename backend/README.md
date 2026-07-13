# AcadTrack Teacher API (FastAPI)

The FastAPI backend for the Teacher panel. Replaces the old Flask backend
and Vercel serverless functions. Talks to the **same Supabase Postgres**
database — no data migration.

Built by **MJR Vertext** (Mark Frizas, Rutz Cabrera, Jean Rose Banay).

```
Next.js (frontend/)  →  FastAPI (backend/)  →  Supabase PostgreSQL
```

## Auth
Supabase Auth on the frontend (email/password, Google OAuth). The frontend sends
the Supabase access token as `Authorization: Bearer <token>`; the backend
verifies it with the project's JWT secret (HS256) and scopes every request to
that teacher (`profiles.id` = `sections.teacher_id` = ...).

## Run locally
```bash
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # set DATABASE_URL, SUPABASE_JWT_SECRET
uvicorn app.main:app --reload --port 5001
```
Docs: http://127.0.0.1:5001/docs

## Endpoints (all under `/api`, teacher-scoped)
- `GET/PATCH /me` — profile (name, avatar, theme)
- `GET/POST /schedules`, `DELETE /schedules/{id}`
- `GET/POST /notices`, `DELETE /notices/{id}`
- `GET/POST /notes`, `DELETE /notes/{id}`
- `GET/POST /sections`, `GET/PATCH/DELETE /sections/{id}`
- `GET/POST /sections/{id}/students`, `POST /sections/{id}/students/bulk`, `PATCH/DELETE /students/{id}`
- `GET/POST /subjects`, `PATCH/DELETE /subjects/{id}` (grade weights)
- `GET/POST /facilitators`, `PATCH/DELETE /facilitators/{id}` (bcrypt passwords)
- `GET/POST /sections/{id}/attendance` (delete+insert per date)
- `GET/POST /sections/{id}/class-records` (bulk upsert)
- `POST /ai-evaluate` — AI assistant (Groq primary, Gemini fallback)
- `GET /push/vapid-public-key`, `POST /push/subscribe`

## Deploy
Render (same service the Flask app used). Start command:
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
