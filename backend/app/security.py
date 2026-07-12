"""
security.py — Teacher auth (verify Supabase access tokens via JWKS) + bcrypt helpers.
======================================================================================
The teacher panel keeps using Supabase Auth on the frontend (email/password,
Google OAuth, password reset) exactly as before. The frontend sends the
resulting Supabase access token as `Authorization: Bearer <token>`; here we
verify that token's signature against the project's JWKS endpoint (ES256 /
ECC P-256, matching this project's tokens) and resolve the authenticated teacher.

bcrypt helpers are used when the teacher creates/updates facilitator accounts
(whose passwords are bcrypt-hashed, compatible with the old Flask backend).
"""
from typing import Optional
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_db
from .models import Profile

_bearer = HTTPBearer(auto_error=False)

_JWKS_CLIENT: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    global _JWKS_CLIENT
    if _JWKS_CLIENT is None and settings.SUPABASE_URL:
        base = settings.SUPABASE_URL.rstrip("/")
        _JWKS_CLIENT = PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True)
    return _JWKS_CLIENT


# ── bcrypt (facilitator passwords) ──────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ── Supabase token verification ─────────────────────────────────────────────

class CurrentTeacher:
    """The authenticated teacher, resolved from a Supabase access token."""

    def __init__(self, user_id: str, email: Optional[str], profile: Optional[Profile]):
        self.id = user_id
        self.email = email
        self.profile = profile


def _decode_supabase_token(token: str) -> dict:
    try:
        client = _get_jwks_client()
        if client is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server auth is not configured (SUPABASE_URL missing for JWKS).",
            )
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience=settings.SUPABASE_JWT_AUDIENCE,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please log in again."
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token.")


async def get_current_teacher(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentTeacher:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    payload = _decode_supabase_token(creds.credentials)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    try:
        uid = UUID(str(sub))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    profile = (
        await db.execute(select(Profile).where(Profile.id == uid))
    ).scalar_one_or_none()
    return CurrentTeacher(user_id=str(uid), email=payload.get("email"), profile=profile)
