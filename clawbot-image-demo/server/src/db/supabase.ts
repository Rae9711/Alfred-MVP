/**
 * Supabase client module.
 *
 * Initializes a Supabase client when SUPABASE_URL and SUPABASE_KEY are set.
 * When not configured, all exports gracefully return null/false so the app
 * falls back to in-memory storage.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").trim();
const SUPABASE_KEY = (process.env.SUPABASE_KEY ?? "").trim();

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("[supabase] connected to", SUPABASE_URL);
} else {
  console.log("[supabase] not configured — using in-memory storage");
}

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

export function isSupabaseEnabled(): boolean {
  return supabase !== null;
}
