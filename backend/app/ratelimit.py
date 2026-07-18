"""
ratelimit.py — lightweight, fail-open rate limiting (SlowAPI).
==============================================================
The teacher panel logs in through Supabase on the frontend (Supabase already
rate-limits its own auth), so there is no /login here to brute-force. What this
guards is the data + AI API: it stops a single client from hammering the Render
dyno (DoS / accidental request storms) and curbs abuse of the paid Groq/Gemini
AI endpoint.

Design goals — this must NOT cause false errors for real teachers:
  • Per-user buckets. Authenticated requests are keyed by the token's ``sub``
    claim, read WITHOUT verifying the signature — used only to pick a bucket,
    never for authorization (the endpoint still verifies the token properly).
    So teachers behind one shared school NAT never share a bucket; only
    pre-auth / anonymous requests fall back to per-IP.
  • Real client IP behind the proxy (X-Forwarded-For) for that fallback, so it
    isn't keyed to "the proxy" (which would lump everyone together).
  • Fail-open: ``swallow_errors=True`` means any internal limiter hiccup lets
    the request through instead of 500-ing it.
  • Generous limits a normal teacher will never reach.

Storage is in-memory, which is correct for the single free-tier instance.
(If the API is ever scaled to multiple instances, point SlowAPI at Redis via
``storage_uri`` so the buckets are shared.)
"""
from __future__ import annotations

import jwt
from slowapi import Limiter
from starlette.requests import Request


def _client_ip(request: Request) -> str:
    """Real client IP. The host puts it first in X-Forwarded-For;
    ``request.client.host`` alone would be the proxy, lumping all users together."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    client = request.client
    return client.host if client else "unknown"


def _rate_limit_key(request: Request) -> str:
    """Prefer a per-teacher bucket; fall back to per-IP for anonymous calls.

    The ``sub`` claim is read with signature/expiry/audience verification OFF —
    this value only selects a rate-limit bucket, so a forged token can at worst
    throttle itself. Real authorization still happens in the endpoint's
    ``get_current_teacher`` dependency. Any decode problem falls back to IP.
    """
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        try:
            claims = jwt.decode(
                token,
                options={
                    "verify_signature": False,
                    "verify_aud": False,
                    "verify_exp": False,
                },
            )
            sub = claims.get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:  # noqa: BLE001 — bucketing only; never block on this
            pass
    return f"ip:{_client_ip(request)}"


# ``default_limits`` is the broad DoS guard applied to every route by
# SlowAPIMiddleware (see main.py). ``swallow_errors`` fails open; the
# RateLimit-* response headers let a client see its remaining budget.
limiter = Limiter(
    key_func=_rate_limit_key,
    default_limits=["300/minute"],
    swallow_errors=True,
    headers_enabled=True,
)

# Tighter budget for the one expensive route — /api/ai-evaluate calls the paid
# Groq/Gemini APIs. Applied as an explicit decorator on that endpoint. A real
# teacher chatting with the assistant never approaches 20 questions/minute.
AI_RATE_LIMIT = "20/minute"
