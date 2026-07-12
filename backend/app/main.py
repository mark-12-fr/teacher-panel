"""
main.py — AcadTrack Teacher API (FastAPI).
=========================================
Replaces the Flask backend + Vercel functions for the teacher panel. Talks to
the same Supabase Postgres. Teacher auth verifies Supabase access tokens.

Run locally:
    uvicorn app.main:app --reload --port 5001
"""
from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from .config import settings
from .routers import ai, dashboard, facilitators, grading, push, records, sections

app = FastAPI(
    title="AcadTrack Teacher API",
    version="1.0.0",
    description="Backend for the AcadTrack Teacher panel (Next.js frontend).",
)

# Force CORS headers on every response (bypass any middleware issues)
ALLOWED_ORIGINS = [
    "https://teacher-panel-phi.vercel.app",
    "https://acadtrack.asia",
    "https://www.acadtrack.asia",
    "https://teacher-panel-mjrvertex-7104s-projects.vercel.app",
]

class ForceCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        origin = request.headers.get("origin", "")
        # Handle preflight OPTIONS immediately — return 200 with CORS headers
        if request.method == "OPTIONS":
            if origin not in ALLOWED_ORIGINS:
                return Response(status_code=200)
            response = Response(status_code=200)
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "*"
            response.headers["Access-Control-Allow-Headers"] = "*"
            return response
        # Add CORS headers after the inner handler (even if it errors out)
        if origin not in ALLOWED_ORIGINS:
            return await call_next(request)
        try:
            response = await call_next(request)
        except Exception as e:
            response = JSONResponse({"detail": str(e)}, status_code=500)
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

app.add_middleware(ForceCORSMiddleware)

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
