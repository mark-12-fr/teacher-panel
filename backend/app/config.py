"""config.py — Settings loaded from env vars (pydantic v1 friendly)."""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    DATABASE_URL: str = ""
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_JWT_AUDIENCE: str = "authenticated"
    SUPABASE_URL: str = ""
    CORS_ORIGINS: list[str] | None = None
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@acadtrack.app"

    def __init__(self) -> None:
        self.DATABASE_URL = os.getenv("DATABASE_URL", "")
        self.SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
        self.SUPABASE_JWT_AUDIENCE = os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated")
        self.SUPABASE_URL = os.getenv("SUPABASE_URL", "")
        raw_cors = os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        )
        self.CORS_ORIGINS = [o.strip() for o in raw_cors.split(",") if o.strip()]
        self.GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
        self.GROQ_MODEL = os.getenv("GROQ_MODEL", "")
        self.GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
        self.GEMINI_MODEL = os.getenv("GEMINI_MODEL", "")
        self.VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
        self.VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
        self.VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@acadtrack.app")


settings = Settings()
