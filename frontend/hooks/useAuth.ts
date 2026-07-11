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

export async function signOut() {
  try {
    await getSupabase().auth.signOut();
  } catch {}
  // Clear legacy keys the old app used, just in case.
  ["access_token", "user_id", "remembered_email"].forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
  window.location.href = "/login";
}
