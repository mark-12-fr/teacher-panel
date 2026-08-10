"""
database.py — Async SQLAlchemy engine + session for Supabase Postgres.
=====================================================================
Connects to the SAME Supabase Postgres database the legacy app used, so no
data migration is needed. The engine is configured to work through the
Supabase connection pooler (Supavisor / PgBouncer in transaction mode):

  * `statement_cache_size=0` disables asyncpg's own prepared-statement cache
  * `prepared_statement_cache_size=0` disables the SQLAlchemy dialect's own
    per-connection prepared-statement cache — without this, a pooled
    connection whose backend Supavisor recycled still re-executes a cached
    prepared statement and dies with InvalidSQLStatementNameError (500s)
  * a per-statement unique name avoids "prepared statement already exists"
    errors when the pooler hands the connection to a different backend
  * a real (QueuePool) pool reuses warm connections — with NullPool every
    request paid a full new-connection setup (TLS + pooler session + SQLAlchemy
    dialect init queries) against the pooler, ~2.5s per request
  * `pool_recycle` stays under the pooler's idle timeout so we never check
    out a session the pooler already dropped
"""
from uuid import uuid4

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _make_engine():
    if not settings.DATABASE_URL:
        # Defer the hard failure until first use so tooling (OpenAPI export,
        # imports, tests) can run without a live database.
        return None
    return create_async_engine(
        settings.DATABASE_URL,
        pool_size=4,
        max_overflow=6,
        pool_timeout=30,
        pool_recycle=60,
        connect_args={
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
        },
    )


engine = _make_engine()

SessionLocal = (
    async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    if engine is not None
    else None
)


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields a scoped async database session."""
    if SessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL is not configured. Set it in the environment "
            "(see backend/.env.example)."
        )
    async with SessionLocal() as session:
        yield session
