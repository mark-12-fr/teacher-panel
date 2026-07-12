"""config.py — Settings loaded from env vars (pydantic v1 friendly)."""
import os
from dotenv import load_dotenv

load_dotenv()


def _sanitize_db_url(raw: str) -> str:
    """Make a pasted DATABASE_URL robust to the two most common mistakes.

    Supabase shows its connection string as
    ``postgresql://postgres.<ref>:[YOUR-PASSWORD]@...pooler...:6543/postgres``.
    Operators frequently (a) leave the driver as plain ``postgresql://`` — but
    async SQLAlchemy needs the ``asyncpg`` dialect — and (b) paste the password
    still wrapped in the ``[ ]`` placeholder brackets (or with stray
    whitespace/newlines), which then get sent to Postgres verbatim and fail
    auth, so the API boots but every query errors and no data loads.

    This normalizes the driver and strips a single pair of wrapping brackets
    (and surrounding whitespace) from the password. It only rewrites what it
    recognizes; anything already correct is returned unchanged, and IPv6 host
    brackets (which live after ``@``) are never touched.
    """
    url = (raw or "").strip()
    if not url:
        return url
    # 1) Driver — async SQLAlchemy requires the asyncpg dialect.
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    # 2) Password — strip whitespace and a single wrapping [ ] pair.
    sep = url.find("://")
    if sep != -1 and "@" in url:
        scheme, rest = url[: sep + 3], url[sep + 3:]
        at = rest.rfind("@")  # last @ separates userinfo from host:port
        userinfo, host = rest[:at], rest[at + 1:]
        if ":" in userinfo:
            user, pw = userinfo.split(":", 1)  # username has no ':'
            pw = pw.strip()
            if len(pw) >= 2 and pw[0] == "[" and pw[-1] == "]":
                pw = pw[1:-1]
            userinfo = f"{user}:{pw}"
        url = f"{scheme}{userinfo}@{host}"
    return url


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
        self.DATABASE_URL = _sanitize_db_url(os.getenv("DATABASE_URL", ""))
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
