"use client";
// Supabase browser client — used ONLY for auth (email/password, Google OAuth,
// password reset). All data goes through the FastAPI backend. The anon key is
// public by design (same one the old static app shipped).

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://njzvuwkepaasnsvuujgx.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qenZ1d2tlcGFhc25zdnV1amd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1OTk5MTgsImV4cCI6MjA5MzE3NTkxOH0.tFh2d3ZIZYMWk-7HHckCbkwbTJ7uQ9onGeTaaUlkeH0";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return _client;
}
