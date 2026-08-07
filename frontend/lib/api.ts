"use client";
// Authenticated API client for the Teacher backend. Attaches the current
// Supabase access token as a Bearer token; on 401 it bounces to /login.

import { API_BASE } from "./config";
import { getSupabase } from "./supabase";

export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: any;
  auth?: boolean; // default true
}

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, auth = true, headers: extra, ...rest } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(extra as any) };
  if (auth) {
    const token = await accessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      const last = sessionStorage.getItem("redirect_to_login_at");
      const now = Date.now();
      if (!last || now - Number(last) > 5000) {
        sessionStorage.setItem("redirect_to_login_at", String(now));
        window.location.replace("/login");
      }
    }
    const message = (payload && (payload.detail || payload.error)) || `Request failed (${res.status})`;
    throw new ApiError(String(message), res.status, payload);
  }
  return payload as T;
}

export const apiGet = <T = any>(p: string, o: ApiOptions = {}) => api<T>(p, { ...o, method: "GET" });
export const apiPost = <T = any>(p: string, b?: any, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "POST", body: b });
export const apiPatch = <T = any>(p: string, b?: any, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "PATCH", body: b });
export const apiDelete = <T = any>(p: string, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "DELETE" });

// ── Stale-while-revalidate data cache ────────────────────────────────────
// Returns the last-known snapshot of a GET instantly (repeat visits to the
// heavy detail pages feel near-instant) while the network refreshes the copy
// in the background for the next load. Pass key=null to bypass caching
// (realtime-triggered reloads must read fresh). Every write must call
// invalidateCached(key) so the next load re-reads from the API.
const CACHE_PREFIX = "data_cache_";

function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, val: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(val));
  } catch {
    // localStorage full or unavailable
  }
}

export function cachedGet<T = any>(key: string | null, path: string, opts?: ApiOptions): Promise<T> {
  if (key !== null) {
    const cached = readCache<T>(key);
    if (cached !== undefined) {
      apiGet<T>(path, opts)
        .then((fresh) => writeCache(key, fresh))
        .catch(() => {});
      return Promise.resolve(cached);
    }
  }
  return apiGet<T>(path, opts).then((fresh) => {
    if (key !== null) writeCache(key, fresh);
    return fresh;
  });
}

export function invalidateCached(key?: string) {
  try {
    if (key) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
