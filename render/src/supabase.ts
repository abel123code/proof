import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, supabaseUrl } from "./env.js";

let cached: SupabaseClient | null = null;

/** Server-side Supabase client (service role). Bypasses RLS — server only. */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(supabaseUrl(), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Storage bucket the render service reads recordings from / writes edited MP4s to. */
export const RENDER_BUCKET = "renders";
export const FOOTAGE_BUCKET = "footage";
