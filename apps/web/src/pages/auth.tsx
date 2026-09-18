import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ThemeToggle, useTheme } from "../lib/theme";
import { isDevAuthBypass, supabase, supabaseConfigured } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/**
 * Email/password (+ optional Google) against the live Supabase Auth project.
 * The old "any password enters /app" path is only on `vite` when VITE_DEV_AUTH=true.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { dark, toggle } = useTheme();
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-900 font-serif text-base font-semibold leading-none text-paper-50">C</span>
            <span className="font-serif font-semibold tracking-tight text-slate-900 dark:text-white">Copyr</span>
          </Link>
          <ThemeToggle dark={dark} onToggle={toggle} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            <div className="mt-6">{children}</div>
            {footer && <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-brand-900";

function ConfigMissing() {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      Supabase Auth is not configured in this build. Set{" "}
      <code className="font-mono">VITE_SUPABASE_URL</code> and{" "}
      <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> on Vercel (or a local{" "}
      <code className="font-mono">apps/web/.env</code>) and redeploy.
    </p>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      {message}
    </p>
  );
}

async function googleOAuth(): Promise<string | null> {
  if (isDevAuthBypass()) return "Google OAuth is disabled in VITE_DEV_AUTH bypass mode.";
  if (!supabase) return "Supabase Auth is not configured.";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/app` },
  });
  return error?.message ?? null;
}

function GoogleButton({ label, onError }: { label: string; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void googleOAuth()
          .then((msg) => {
            if (msg) onError(msg);
          })
          .finally(() => setBusy(false));
      }}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.7-.2-2.5H12v4.8h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9H1.3v3.1C3.3 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.3 14.4c-.3-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4V6.5H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.5l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.1C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.5l4 3.1c1-2.8 3.6-4.8 6.7-4.8z"/></svg>
      {busy ? "Redirecting…" : label}
    </button>
  );
}

export function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isDevAuthBypass()) {
      navigate("/app");
      return;
    }
    if (!supabase) {
      setError("Supabase Auth is not configured in this build.");
      return;
    }
    setBusy(true);
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    navigate("/app");
  }

  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Welcome back! Please enter your details"
      footer={
        <>
          Do not have an account yet?{" "}
          <Link to="/auth/sign-up" className="font-medium text-brand-600 hover:underline">Sign up</Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        {!supabaseConfigured && !isDevAuthBypass() && <ConfigMissing />}
        <FieldError message={error} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
          <input required type="email" autoComplete="email" placeholder="you@firm.vc" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Password</span>
          <input required type="password" autoComplete="current-password" placeholder="••••••••" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="text-right">
          <Link to="/auth/reset" className="text-xs font-medium text-brand-600 hover:underline">Forgot password?</Link>
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in with Email"}
        </button>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> or continue with <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>
        <GoogleButton label="Sign in with Google" onError={setError} />
      </form>
    </AuthLayout>
  );
}

export function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [firm, setFirm] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (isDevAuthBypass()) {
      navigate("/app");
      return;
    }
    if (!supabase) {
      setError("Supabase Auth is not configured in this build.");
      return;
    }
    setBusy(true);
    const { data, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name.trim(), firm_name: firm.trim() },
        emailRedirectTo: `${window.location.origin}/app`,
      },
    });
    setBusy(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    if (!data.session) {
      setNotice("Check your email to confirm the account, then sign in.");
      return;
    }
    navigate("/app");
  }

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Fill the form below to create an account."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/sign-in" className="font-medium text-brand-600 hover:underline">Sign in</Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        {!supabaseConfigured && !isDevAuthBypass() && <ConfigMissing />}
        <FieldError message={error} />
        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            {notice}
          </p>
        )}
        <input required placeholder="Full name" autoComplete="name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
        <input required type="email" placeholder="Work email" autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Firm / company name" autoComplete="organization" className={input} value={firm} onChange={(e) => setFirm(e.target.value)} />
        <input required type="password" placeholder="Password" autoComplete="new-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
        <input required type="password" placeholder="Please repeat your new password to confirm it" autoComplete="new-password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Creating account…" : "Sign up with Email"}
        </button>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> or continue with <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>
        <GoogleButton label="Sign in with Google" onError={setError} />
      </form>
    </AuthLayout>
  );
}

export function PasswordReset() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (isDevAuthBypass()) {
      setNotice("Password reset is skipped in VITE_DEV_AUTH bypass mode.");
      return;
    }
    if (!supabase) {
      setError("Supabase Auth is not configured in this build.");
      return;
    }
    setBusy(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setNotice("If that email is registered, a reset link is on its way.");
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={<Link to="/auth/sign-in" className="font-medium text-brand-600 hover:underline">Back to sign in</Link>}
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        {!supabaseConfigured && !isDevAuthBypass() && <ConfigMissing />}
        <FieldError message={error} />
        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            {notice}
          </p>
        )}
        <input required type="email" placeholder="you@firm.vc" autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function UpdatePassword() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!supabase) {
      setError("Supabase Auth is not configured in this build.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    navigate("/app");
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={loading ? "Checking the recovery session…" : "Enter a new password for this account."}
      footer={<Link to="/auth/sign-in" className="font-medium text-brand-600 hover:underline">Back to sign in</Link>}
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <FieldError message={error} />
        {!session && !loading && (
          <p className="text-xs text-slate-500">Open this page from the email link so we can restore your recovery session.</p>
        )}
        <input required type="password" placeholder="New password" autoComplete="new-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
        <input required type="password" placeholder="Confirm new password" autoComplete="new-password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" disabled={busy || loading} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </AuthLayout>
  );
}
