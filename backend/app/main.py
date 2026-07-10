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
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (dashboard, sections, grading, facilitators, records, ai, push):
    app.include_router(r.router)


@app.get("/")
async def root():
    return {"status": "ok", "service": "AcadTrack Teacher API"}


@app.get("/api/ping")
async def ping():
    return {"ok": True}
