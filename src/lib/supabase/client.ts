"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client for the auth UI (OAuth sign-in, sign-out). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
