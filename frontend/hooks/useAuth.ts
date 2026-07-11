"use client";
// Teacher auth helpers built on the Supabase session.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export interface AuthUser {
  id: string;
  email?: string | null;
}

/** Redirect to /login when there is no Supabase session; returns the user. */
export function useRequireAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    let active = true;

    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      const session = data.session;
      if (!session) {
        const last = sessionStorage.getItem("redirect_to_login_at");
        const now = Date.now();
        if (!last || now - Number(last) > 5000) {
          sessionStorage.setItem("redirect_to_login_at", String(now));
          window.location.replace("/login");
        }
        return;
      }
      setUser({ id: session.user.id, email: session.user.email });
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        const last = sessionStorage.getItem("redirect_to_login_at");
        const now = Date.now();
        if (!last || now - Number(last) > 5000) {
          sessionStorage.setItem("redirect_to_login_at", String(now));
          window.location.replace("/login");
        }
      } else {
        setUser({ id: session.user.id, email: session.user.email });
        setLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/**
 * Remove per-user cached data that must never bleed across accounts on a
 * shared browser: the sidebar identity (name/avatar), the id that owns it, and
 * the AI chat history (keyed by user). Call this whenever the active user
 * changes (login as a different account, signup, logout).
 */
export function clearUserCache() {
  ["cached_user_name", "cached_user_avatar", "cached_user_id"].forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("mjr_chat_"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export async function signOut() {
  try {
    await getSupabase().auth.signOut();
  } catch {}
  // Clear legacy session keys the old app used, just in case.
  ["access_token", "user_id", "remembered_email", "faci_id"].forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
  clearUserCache();
  window.location.href = "/login";
}
