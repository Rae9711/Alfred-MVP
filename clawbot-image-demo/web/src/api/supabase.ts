/**
 * Frontend Supabase client.
 *
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.
 * When not configured, auth is disabled and the app works without login.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";

let supabase: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

export function isAuthEnabled(): boolean {
  return supabase !== null;
}
