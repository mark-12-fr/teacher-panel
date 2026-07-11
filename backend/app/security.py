"""
security.py — Teacher auth (verify Supabase access tokens) + bcrypt helpers.
==========================================================================
The teacher panel keeps using Supabase Auth on the frontend (email/password,
Google OAuth, password reset) exactly as before. The frontend sends the
resulting Supabase access token as `Authorization: Bearer <token>`; here we
verify that token's signature with the project's JWT secret (HS256, matching
this project's tokens) and resolve the authenticated teacher.

bcrypt helpers are used when the teacher creates/updates facilitator accounts
(whose passwords are bcrypt-hashed, compatible with the old Flask backend).
"""
from typing import Optional
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_db
from .models import Profile

_bearer = HTTPBearer(auto_error=False)


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


_jwks_client: Optional["jwt.PyJWKClient"] = None


def _jwks() -> Optional["jwt.PyJWKClient"]:
    """Cached JWKS client for verifying asymmetric (ES256/RS256) Supabase tokens.

    Newer Supabase projects sign user access tokens with rotating asymmetric
    keys published at /auth/v1/.well-known/jwks.json, rather than the legacy
    HS256 shared secret. We support both."""
    global _jwks_client
    if _jwks_client is None and settings.SUPABASE_URL:
        base = settings.SUPABASE_URL.rstrip("/")
        _jwks_client = jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _decode_supabase_token(token: str) -> dict:
    try:
        alg = (jwt.get_unverified_header(token) or {}).get("alg", "HS256")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token.")

    try:
        if alg == "HS256":
            if not settings.SUPABASE_JWT_SECRET:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Server auth is not configured (SUPABASE_JWT_SECRET missing).",
                )
            key = settings.SUPABASE_JWT_SECRET
        else:
            client = _jwks()
            if client is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Server auth is not configured (SUPABASE_URL missing for JWKS).",
                )
            key = client.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=[alg],
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
