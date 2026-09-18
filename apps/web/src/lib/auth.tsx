import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { isDevAuthBypass, supabase, supabaseConfigured } from "./supabase";
import { setAccessToken } from "./api";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  configured: boolean;
  devBypass: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const devBypass = isDevAuthBypass();
  const [loading, setLoading] = useState(!devBypass && supabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (devBypass || !supabase) {
      setAccessToken(null);
      setLoading(false);
      return;
    }
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setAccessToken(data.session?.access_token ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAccessToken(next?.access_token ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [devBypass]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      configured: supabaseConfigured,
      devBypass,
      signOut: async () => {
        setAccessToken(null);
        if (supabase) await supabase.auth.signOut();
      },
    }),
    [loading, session, devBypass],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.devBypass) return <>{children}</>;
  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Restoring session…
      </div>
    );
  }
  if (!auth.session) {
    return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
