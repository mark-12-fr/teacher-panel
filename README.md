# 🎓 AcadTrack — Teacher Management Portal

**A Modern, AI-Powered Academic Management System**

AcadTrack is a full-stack academic management platform built by **MJR Vertext** to streamline classroom management, attendance tracking, student performance analytics, and facilitator coordination for educators. It was presented at the **Innovex 2026 International Conference** in Indonesia.

**Developed by:** Mark Frizas, Rutz Cabrera, Jean Rose Banay — MJR Vertext

---

## 🎯 Purpose

Traditional classroom management relies on paper-based grade books, manual attendance sheets, and disconnected spreadsheets. AcadTrack replaces these fragmented workflows with a unified digital platform that:

- Centralizes student records, attendance, grades, and section management
- Eliminates duplicate data entry between teachers and facilitators
- Provides real-time analytics for data-driven instructional decisions
- Reduces paper waste and enables mobile access from any device
- Supports both teachers (full control) and facilitators (scoped access)

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **Section Management** | Create, edit, and manage class sections with student rosters |
| **Attendance Tracking** | Daily attendance per section with date-lock to prevent retroactive edits |
| **Class Record** | Score entry for Written Work, Performance Tasks, and Quarterly Exams with auto-computed totals |
| **Performance Analytics** | Visual dashboards with charts for student performance trends |
| **Grading System** | Configurable grade weights per subject (WW, PT, QE) with automatic computation |
| **Facilitator Management** | Create and assign facilitators with section-scoped access |
| **AI Assistant** | Embedded AI (Groq + Gemini) for answering queries about records and trends |
| **Photo-to-AI Grading** | Upload a photo of a completed activity; AI extracts scores automatically |
| **Push Notifications** | Web Push alerts when facilitators submit attendance or scores |
| **Real-Time Sync** | Live database sync between teacher and facilitator panels |
| **Responsive Design** | Mobile-first PWA installable on any device |
| **Dark Mode** | Light/dark theme synced across devices |

---

## 🛠️ Tech Stack & Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Frontend (Vercel)                        │
│  React 18 · Next.js 14 · TypeScript · Tailwind CSS          │
│  Lucide Icons · Chart.js · Service Worker (PWA)            │
└─────────────────────┬──────────────────────────────────────┘
                      │ HTTPS / JWT Bearer Token
                      ▼
┌────────────────────────────────────────────────────────────┐
│                    Backend (Render)                         │
│  FastAPI · Python 3.12 · Uvicorn · SQLAlchemy 2 (async)    │
│  asyncpg · PyJWT · bcrypt · httpx · python-multipart       │
│  Groq SDK · Google Generative AI · pywebpush (VAPID)       │
└─────────────────────┬──────────────────────────────────────┘
                      │ asyncpg connection pool
                      ▼
┌────────────────────────────────────────────────────────────┐
│                    Database (Supabase)                      │
│  PostgreSQL 15 · Row-Level Security · Real-time Subscriptions
│  Supabase Auth (email/password, Google OAuth)              │
└────────────────────────────────────────────────────────────┘
```

**Frontend:** React 18 + Next.js 14 (App Router) with TypeScript. Served as a PWA via Vercel with automatic SSL and global CDN.

**Backend:** FastAPI with async SQLAlchemy. PyJWT verifies Supabase-issued tokens server-side. Uses NullPool + statement cache disabled for Render's transaction pooler compatibility.

**Database:** Supabase PostgreSQL with the server-side transaction pooler (port 6543, scheme `postgresql+asyncpg://`). The same database powers both teacher and facilitator panels.

**AI:** Two-provider fallback — Groq (fast, primary) and Gemini (accurate, fallback). Powers the AI assistant chat and photo-to-score extraction.

**Deployment:**
| Layer | Platform | Config |
|-------|----------|--------|
| Frontend | Vercel | `rootDirectory: frontend`, auto-detects Next.js |
| Backend | Render | `render.yaml` Blueprint → `uvicorn app.main:app` |
| Database | Supabase | Managed PostgreSQL with connection pooler |

---

## 📁 Project Structure

```
teacher-panel/
├── frontend/          # Next.js 14 (React + TypeScript)
│   ├── app/           # App Router pages
│   ├── components/    # Shared React components
│   ├── hooks/         # Custom React hooks
│   └── lib/           # API client, config, utilities
├── backend/           # FastAPI (Python)
│   └── app/
│       ├── routers/   # API route handlers
│       ├── models.py  # SQLAlchemy models
│       └── main.py    # FastAPI app entry point
├── docs/              # Deployment documentation
├── render.yaml        # Render Blueprint config
└── vercel.json        # Vercel deployment config
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Python 3.12+
- Supabase account & project keys

### Installation

```bash
# 1) Clone
git clone https://github.com/mark-12-fr/teacher-panel.git
cd teacher-panel

# 2) Backend
cd backend
python -m venv .venv
.venv\Scripts\activate    # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
cp .env.example .env      # fill in DATABASE_URL + SUPABASE_JWT_SECRET
uvicorn app.main:app --reload --port 5001

# 3) Frontend (new terminal)
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE=http://127.0.0.1:5001
npm run dev
```

Open `http://localhost:3000` — sign in with your Supabase Auth credentials.

---

## 🌐 Live Deployment

| Property | URL |
|----------|-----|
| Frontend | [https://www.acadtrack.asia](https://www.acadtrack.asia) |
| API Docs | [https://teacher-panel-hej2.onrender.com/docs](https://teacher-panel-hej2.onrender.com/docs) |
| Health | [https://teacher-panel-hej2.onrender.com/api/ping](https://teacher-panel-hej2.onrender.com/api/ping) |

---

## 👥 Team

**MJR Vertext** — presented at Innovex 2026, Indonesia

| Member | Role |
|--------|------|
| Mark Frizas | Full-Stack Developer |
| Rutz Cabrera | Frontend Developer |
| Jean Rose Banay | Backend Developer |

---

## 📄 License

MIT
