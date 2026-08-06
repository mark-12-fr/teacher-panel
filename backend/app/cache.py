"""
cache.py — Redis cache layer for the teacher panel.
===================================================
Fail-open: Redis being down or unreachable never breaks the API — every read
returns None and every write is silently skipped. The app keeps working, just
without caching.

Usage:
    await init_redis(url)       # on startup
    val = await cache_get(key)
    await cache_set(key, val, ttl=60)
    await cache_invalidate("tp:{teacher_id}:*")

Cache keys are namespaced as ``tp:{teacher_id}:{prefix}:{suffix}``.
"""
from __future__ import annotations

import json
from typing import Any, Optional

try:
    from redis import asyncio as aioredis
except ImportError:  # fail-open: no Redis package, app runs without caching
    aioredis = None

_redis: Optional[aioredis.Redis] = None


async def init_redis(url: str) -> None:
    """Connect to Redis. No-op if *url* is empty or unreachable."""
    global _redis
    if not url:
        _redis = None
        return
    try:
        client = aioredis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        await client.ping()
        _redis = client
    except Exception:
        _redis = None


async def close_redis() -> None:
    """Disconnect from Redis."""
    global _redis
    if _redis is not None:
        try:
            await _redis.close()
        except Exception:
            pass
        _redis = None


async def cache_get(key: str) -> Optional[Any]:
    """Return deserialized value or None (miss / Redis down)."""
    if _redis is None:
        return None
    try:
        data = await _redis.get(key)
        return json.loads(data) if data else None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    """Serialize and store with TTL (seconds). Fail-open on error."""
    if _redis is None:
        return
    try:
        await _redis.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass


async def cache_invalidate(pattern: str) -> None:
    """Delete every key matching *pattern* (e.g. ``tp:{uid}:*``). Fail-open."""
    if _redis is None:
        return
    try:
        cursor = 0
        while True:
            cursor, keys = await _redis.scan(cursor=cursor, match=pattern, count=100)
            if keys:
                await _redis.delete(*keys)
            if cursor == 0:
                break
    except Exception:
        pass


def cache_key(prefix: str, teacher_id: str, *suffixes: str) -> str:
    """Build a namespaced cache key.

    ``cache_key("sections", "abc", "list")`` → ``"tp:abc:sections:list"``
    """
    return "tp:" + ":".join([teacher_id, prefix] + list(suffixes))
