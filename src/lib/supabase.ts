import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service-role key.
 * NEVER import this into client components - it bypasses RLS.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
