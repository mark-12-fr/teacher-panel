"""
config.py — Settings for the AcadTrack Teacher API.
==================================================
All secrets come from environment variables (or a local `.env`). See
`.env.example`. Teacher auth verifies Supabase-issued access tokens, so the
Supabase JWT secret is required in addition to the database URL.
"""
from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # ── Database (same Supabase Postgres) ───────────────────────────────────
    DATABASE_URL: str = Field(default="")

    # ── Supabase Auth ───────────────────────────────────────────────────────
    # The project's JWT secret (Supabase → Project Settings → API → JWT Secret).
    # Used to verify the access tokens the frontend gets from Supabase Auth.
    SUPABASE_JWT_SECRET: str = Field(default="")
    SUPABASE_JWT_AUDIENCE: str = Field(default="authenticated")
    SUPABASE_URL: str = Field(default="")

    # ── CORS ────────────────────────────────────────────────────────────────
    CORS_ORIGINS: List[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    # ── AI providers (AI assistant + fallback) ──────────────────────────────
    GROQ_API_KEY: str = Field(default="")
    GROQ_MODEL: str = Field(default="")
    GEMINI_API_KEY: str = Field(default="")
    GEMINI_MODEL: str = Field(default="")

    # ── Web Push (VAPID) ────────────────────────────────────────────────────
    VAPID_PUBLIC_KEY: str = Field(default="")
    VAPID_PRIVATE_KEY: str = Field(default="")
    VAPID_SUBJECT: str = Field(default="mailto:admin@acadtrack.app")

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value):
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
