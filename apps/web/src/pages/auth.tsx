import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ThemeToggle, useTheme } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { isAuthRequired, supabase, supabaseConfigured } from "../lib/supabase";

/**
 * Email + password Auth against Supabase (venlabs-demo). Google / social
 * providers are intentionally not offered.
 *
 * Colors use inverted paper tokens (not `text-white` / slate) so dark mode
 * keeps the same contrast as the rest of the product.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { dark, toggle } = useTheme();
  return (
    <div className="flex min-h-screen flex-col bg-paper-100">
      <header className="border-b border-paper-900/[0.08] bg-paper-100/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="VentureLabs home">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-900 font-serif text-base font-semibold leading-none text-paper-50">V</span>
            <span className="font-serif text-xl tracking-tight text-paper-900">VentureLabs</span>
          </Link>
          <ThemeToggle dark={dark} onToggle={toggle} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-paper-900/[0.09] bg-white p-8 shadow-card">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-paper-900">{title}</h1>
            <p className="mt-1.5 text-sm text-paper-600">{subtitle}</p>
            <div className="mt-6">{children}</div>
            {footer && <div className="mt-6 border-t border-paper-900/[0.08] pt-4 text-center text-xs text-paper-500">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-paper-900/[0.16] bg-white px-3 py-2.5 text-sm text-paper-900 outline-none transition placeholder:text-paper-400 hover:border-paper-900/[0.28] focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/10";

const primaryBtn =
  "btn-ink w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-paper-50 disabled:cursor-not-allowed disabled:opacity-60";

function ConfigBanner() {
  if (supabaseConfigured) return null;
  return (
    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Auth is not configured. Set <code className="font-mono">VITE_SUPABASE_URL</code> and{" "}
      <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> (legacy anon JWT from the
      venlabs-demo API settings) and rebuild the SPA.
      {!import.meta.env.PROD && (
        <>
          {" "}
          <Link to="/app" className="font-medium underline">
            Open the local demo workspace
          </Link>
        </>
      )}
    </p>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      {message}
    </p>
  );
}

function emailRedirectTo(path: string): string {
  return `${window.location.origin}${path}`;
}

export function SignIn() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!loading && session) return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supabase) {
      setError("Supabase Auth is not configured for this build.");
      return;
    }
    setPending(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate("/app");
  }

  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Welcome back — email and password only"
      footer={
        <>
          Do not have an account yet?{" "}
          <Link to="/auth/sign-up" className="font-medium text-brand-700 hover:underline">Sign up</Link>
        </>
      }
    >
      <ConfigBanner />
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <FieldError message={error} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Email</span>
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="you@firm.vc"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Password</span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            placeholder="••••••••"
            className={input}
          />
        </label>
        <div className="text-right">
          <Link to="/auth/reset" className="text-xs font-medium text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <button type="submit" disabled={pending || !supabaseConfigured} className={primaryBtn}>
          {pending ? "Signing in…" : "Sign in with Email"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function SignUp() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [firm, setFirm] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!loading && session) return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!supabase) {
      setError("Supabase Auth is not configured for this build.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setPending(true);
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: emailRedirectTo("/auth/callback"),
        data: {
          full_name: name,
          firm_name: firm,
        },
      },
    });
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (!data.session) {
      setNotice("Check your email to confirm your account, then sign in.");
      return;
    }
    navigate("/app");
  }

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Email and password — we'll create your workspace on first sign-in."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/sign-in" className="font-medium text-brand-700 hover:underline">Sign in</Link>
        </>
      }
    >
      <ConfigBanner />
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <FieldError message={error} />
        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {notice}
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Full name</span>
          <input required placeholder="Ada Lovelace" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Work email</span>
          <input required type="email" placeholder="you@firm.vc" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Firm / company name</span>
          <input placeholder="Harbor Ventures" autoComplete="organization" value={firm} onChange={(e) => setFirm(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Password</span>
          <input required type="password" placeholder="••••••••" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Confirm password</span>
          <input required type="password" placeholder="Repeat password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
        </label>
        <button type="submit" disabled={pending || !supabaseConfigured} className={primaryBtn}>
          {pending ? "Creating account…" : "Sign up with Email"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function PasswordReset() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const recovering = Boolean(session);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!supabase) {
      setError("Supabase Auth is not configured for this build.");
      return;
    }
    setPending(true);
    if (recovering) {
      if (password !== confirm) {
        setPending(false);
        setError("Passwords do not match.");
        return;
      }
      const { error: err } = await supabase.auth.updateUser({ password });
      setPending(false);
      if (err) {
        setError(err.message);
        return;
      }
      setNotice("Password updated. You can continue to the app.");
      return;
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: emailRedirectTo("/auth/reset"),
    });
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNotice("If that email is registered, a reset link is on its way.");
  }

  return (
    <AuthLayout
      title={recovering ? "Choose a new password" : "Reset your password"}
      subtitle={recovering ? "Enter a new password for your account." : "Enter your email and we'll send you a reset link."}
      footer={<Link to="/auth/sign-in" className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}
    >
      <ConfigBanner />
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <FieldError message={error} />
        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {notice}{" "}
            {recovering && (
              <Link to="/app" className="font-medium underline">
                Open app
              </Link>
            )}
          </p>
        )}
        {recovering ? (
          <>
            <input required type="password" placeholder="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            <input required type="password" placeholder="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
          </>
        ) : (
          <input required type="email" placeholder="you@firm.vc" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        )}
        <button type="submit" disabled={pending || !supabaseConfigured} className={primaryBtn}>
          {pending ? "Please wait…" : recovering ? "Update password" : "Send reset link"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      navigate("/auth/sign-in", { replace: true });
      return;
    }
    let cancelled = false;
    void supabase.auth.getSession().then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      navigate(data.session ? "/app" : "/auth/sign-in", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <AuthLayout title="Signing you in" subtitle="Finishing email confirmation…">
      <FieldError message={error} />
      {!error && <p className="text-sm text-paper-500">One moment.</p>}
    </AuthLayout>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (!isAuthRequired()) return <>{children}</>;
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-paper-100 text-sm text-paper-600">
        Loading session…
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
