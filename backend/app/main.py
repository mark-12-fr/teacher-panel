"""
main.py — AcadTrack Teacher API (FastAPI).
=========================================
Replaces the Flask backend + Vercel functions for the teacher panel. Talks to
the same Supabase Postgres. Teacher auth verifies Supabase access tokens.

Run locally:
    uvicorn app.main:app --reload --port 5001
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import ai, dashboard, facilitators, grading, push, records, sections

app = FastAPI(
    title="AcadTrack Teacher API",
    version="1.0.0",
    description="Backend for the AcadTrack Teacher panel (Next.js frontend).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "https://teacher-panel-phi.vercel.app",
        "https://acadtrack.asia", "https://www.acadtrack.asia",
        "https://teacher-panel-mjrvertex-7104s-projects.vercel.app",
    ],
    allow_origin_regex=r"https?://([a-z0-9-]+\.)*(vercel\.app|acadtrack\.asia|localhost)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (dashboard, sections, grading, facilitators, records, ai, push):
    app.include_router(r.router)


@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {"status": "ok", "service": "AcadTrack Teacher API"}


@app.api_route("/api/ping", methods=["GET", "HEAD"])
async def ping():
    # HEAD too: uptime monitors commonly probe with HEAD (lighter than GET),
    # and Render's own health check may as well — a GET-only route 405s those.
    return {"ok": True}
