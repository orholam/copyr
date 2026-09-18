import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

/** True when the SPA was built with venlabs-demo (or any) Supabase Auth credentials. */
export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Fake "any password enters /app" is available only on the Vite dev server
 * when `VITE_DEV_AUTH=true`. Production builds (`vite build`) never enable it.
 */
export function isDevAuthBypass(): boolean {
  return import.meta.env.DEV === true && import.meta.env.VITE_DEV_AUTH === "true";
}

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
