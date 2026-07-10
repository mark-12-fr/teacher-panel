# AcadTrack Teacher API (FastAPI)

The FastAPI backend for the React/Next.js Teacher panel. It replaces the old
Flask backend and the Vercel serverless functions, and talks to the **same
Supabase Postgres** database — no data migration.

```
Next.js (web/)  →  FastAPI (backend/)  →  Supabase PostgreSQL
```

## Auth
The teacher panel keeps using **Supabase Auth** on the frontend (email/password,
Google OAuth, password reset) exactly as before. The frontend sends the Supabase
access token as `Authorization: Bearer <token>`; the backend verifies it with the
project's **JWT secret** (HS256) and scopes every request to that teacher
(`profiles.id` = `sections.teacher_id` = `subjects.teacher_id` = …).

## Run locally
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
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
- `GET/POST /sections`, `GET/PATCH/DELETE /sections/{id}` (delete cascades students/records/attendance)
- `GET/POST /sections/{id}/students`, `POST /sections/{id}/students/bulk`, `PATCH/DELETE /students/{id}`
- `GET/POST /subjects`, `PATCH/DELETE /subjects/{id}` (grade weights)
- `GET/POST /facilitators`, `PATCH/DELETE /facilitators/{id}` (bcrypt passwords)
- `GET/POST /sections/{id}/attendance` (delete+insert per date)
- `GET/POST /sections/{id}/class-records` (bulk upsert)
- `POST /ai-evaluate` — AI assistant (Groq primary, Gemini fallback)
- `GET /push/vapid-public-key`, `POST /push/subscribe`

## Verification
Full end-to-end suite run green against a real Postgres instance: Supabase-JWT
auth (401/valid), profile upsert, sections + students CRUD, subjects, bcrypt
facilitators (+ duplicate 409), schedules/notices/notes, attendance
delete-insert, records upsert with field validation, cross-teacher ownership
isolation (403), and cascade delete.

## Deploy
Render (same service the Flask app used). Start command:
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set env vars from `.env.example`.
