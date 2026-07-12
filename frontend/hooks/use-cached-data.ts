"use client";
import { useEffect, useRef, useState } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

function getCache<T>(key: string): { data: T; age: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    return { data: entry.data, age: Date.now() - entry.timestamp };
  } catch {
    return null;
  }
}

function setCache<T>(key: string, data: T) {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable
  }
}

export function clearCache(key?: string) {
  if (key) {
    localStorage.removeItem(key);
  } else {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("dash_cache_")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }
}

export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { ttl?: number }
) {
  const { ttl = DEFAULT_TTL } = options ?? {};
  const [data, setData] = useState<T | null>(() => {
    const cached = getCache<T>(key);
    if (cached) return cached.data;
    return null;
  });
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);

  const refresh = async () => {
    const id = ++fetchIdRef.current;
    try {
      setError(null);
      const result = await fetcher();
      if (!mountedRef.current || id !== fetchIdRef.current) return;
      setData(result);
      setCache(key, result);
      setLoading(false);
    } catch (e) {
      if (!mountedRef.current || id !== fetchIdRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      // Only set loading=false if we have no stale data to show
      if (!data) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    // If no cached data, must fetch (loading stays true)
    if (!data) {
      refresh();
    } else {
      // We have cached data, check age and background-refresh if stale
      const cached = getCache<T>(key);
      if (cached && cached.age > ttl) {
        refresh();
      }
      setLoading(false);
    }
    return () => {
      mountedRef.current = false;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, refresh };
}
