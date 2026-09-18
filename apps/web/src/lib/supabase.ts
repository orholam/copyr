import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** True when the SPA has the public Auth credentials (never a service-role key). */
export const supabaseConfigured = Boolean(url && anon);

/**
 * Production builds always require a real session. Vite `dev` may open the
 * seeded demo workspace when Supabase env is unset.
 */
export function isAuthRequired(): boolean {
  return import.meta.env.PROD || supabaseConfigured;
}

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type { Session, User };
