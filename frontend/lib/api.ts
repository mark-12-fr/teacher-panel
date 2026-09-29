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
  /**
   * Extra attempts for an idempotent GET/HEAD that fails transiently (network
   * blip, timeout, 502/503/504 while the API restarts). Default 3, 0 disables.
   * Writes are NEVER retried automatically — a lost response could double-apply.
   */
  retries?: number;
  /** Per-attempt timeout for GET/HEAD in ms (default 30s, 0 disables). */
  timeoutMs?: number;
}

// Backoff between GET retries (with a little jitter): ~7s in total, enough to
// ride out a Railway restart / cold start without the teacher touching reload.
const RETRY_DELAYS_MS = [800, 2000, 4500];
// Gateway statuses that mean "the API is momentarily unavailable", not "your
// request is wrong". 4xx and plain 500s are real answers and are never retried.
const TRANSIENT_STATUS = new Set([502, 503, 504]);
const DEFAULT_GET_TIMEOUT_MS = 30000;

export const isTransientStatus = (status: number) => TRANSIENT_STATUS.has(status);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const withJitter = (ms: number) => ms + Math.round(Math.random() * ms * 0.25);
// Offline is not transient: fail fast so the stale-snapshot / offline-queue
// fallbacks kick in immediately instead of after ~7s of pointless retrying.
const isOfflineNow = () => typeof navigator !== "undefined" && navigator.onLine === false;

// Single-flight access-token lookup. On first open the shell warmup, the page's
// own fetches, the notification poll, push setup and the theme handler can all
// call api() within the same instant; each used to await a separate
// auth.getSession() (which itself can trigger a refresh round-trip on a cold
// session). Sharing one in-flight promise means the startup burst pays for
// exactly one session read instead of N.
let _tokenLookup: Promise<string | null> | null = null;
function accessToken(): Promise<string | null> {
  if (_tokenLookup === null) {
    _tokenLookup = getSupabase()
      .auth.getSession()
      .then(({ data }) => data.session?.access_token || null)
      .catch(() => null)
      .finally(() => {
        // Reset once resolved so a later batch re-reads — supabase-js
        // auto-refreshes near expiry, and the next call should see that.
        _tokenLookup = null;
      });
  }
  return _tokenLookup;
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, auth = true, headers: extra, retries, timeoutMs, ...rest } = options;
  const method = String(rest.method || "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxRetries = idempotent ? Math.max(0, Math.min(retries ?? RETRY_DELAYS_MS.length, RETRY_DELAYS_MS.length)) : 0;
  const attemptTimeout = idempotent ? (timeoutMs ?? DEFAULT_GET_TIMEOUT_MS) : 0;
  const callerSignal = rest.signal;

  // Only declare a JSON media type when there IS a body. Sending
  // Content-Type: application/json on body-less requests (GET/DELETE) marks
  // them as non-simple, which is an extra reason for the browser to CORS
  // preflight (OPTIONS) them — a whole extra round-trip per request.
  const headers: Record<string, string> = { ...(extra as any) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await accessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const payloadBody = body !== undefined ? JSON.stringify(body) : undefined;

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < maxRetries && !isOfflineNow();
    // Bound each GET attempt so a hung connection turns into a retry instead of
    // a page that spins forever. Skipped when the caller supplied its own signal.
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (attemptTimeout > 0 && !callerSignal) {
      controller = new AbortController();
      timer = setTimeout(() => controller!.abort(), attemptTimeout);
    }
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers,
        body: payloadBody,
        signal: controller ? controller.signal : callerSignal,
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
        // The API is restarting / overloaded: wait a moment and ask again.
        if (canRetry && TRANSIENT_STATUS.has(res.status)) {
          await sleep(withJitter(RETRY_DELAYS_MS[attempt]));
          continue;
        }
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
    } catch (err) {
      // A real answer from the server (4xx/5xx) or a caller-initiated abort is final.
      if (err instanceof ApiError || callerSignal?.aborted) throw err;
      // Otherwise it is a network-level failure (fetch rejected, body cut off,
      // or our own timeout aborted it): transient, so retry while we can.
      if (canRetry) {
        await sleep(withJitter(RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
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
// Entries carry a TTL: once expired the cache is skipped entirely, so stale
// facilitator-submitted data can never linger past ~20s — a reload always
// shows the latest scores even without realtime.
const CACHE_PREFIX = "data_cache_";
const CACHE_TTL_MS = 20000;

interface CacheEntry<T> {
  ts: number;
  v: T;
}

function readCache<T>(key: string): CacheEntry<T> | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && "ts" in parsed && "v" in parsed ? (parsed as CacheEntry<T>) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, val: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), v: val }));
  } catch {
    // localStorage full or unavailable
  }
}

export async function cachedGet<T = any>(key: string | null, path: string, opts?: ApiOptions): Promise<T> {
  if (key !== null) {
    const cached = readCache<T>(key);
    if (cached !== undefined && Date.now() - cached.ts < CACHE_TTL_MS) {
      apiGet<T>(path, opts)
        .then((fresh) => writeCache(key, fresh))
        .catch(() => {});
      return cached.v;
    }
  }
  try {
    const fresh = await apiGet<T>(path, opts);
    if (key !== null) writeCache(key, fresh);
    return fresh;
  } catch (err) {
    // Offline / network failure: serve the last snapshot of ANY age so the page
    // still renders cached data instead of an error screen (like the faci panel).
    // A real HTTP error (the server DID respond — 4xx/5xx, incl. the 401 →
    // /login redirect) is an ApiError and is rethrown so genuine failures still
    // surface. Network-level failures (fetch rejected) AND gateway-unavailable
    // statuses (502/503/504 — the API is restarting, after api() already retried
    // it) fall back to the last snapshot, so the page keeps showing data.
    if (key !== null && (!(err instanceof ApiError) || isTransientStatus(err.status))) {
      const stale = readCache<T>(key);
      if (stale !== undefined) return stale.v;
    }
    throw err;
  }
}

export function invalidateCached(key?: string) {
  try {
    if (key) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return;
    }
    // No key = "clear everything": both the stale-while-revalidate data cache
    // (data_cache_*) AND the list/dashboard caches (list_cache_*, dash_cache_*)
    // used by useCachedData — so section-list badges (e.g. the quarter tag)
    // refresh after a bulk quarter/semester change instead of lingering stale.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith("list_cache_") || k.startsWith("dash_cache_"))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
