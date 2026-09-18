import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ThemeToggle, useTheme } from "../lib/theme";

/**
 * Auth screens matching Roulette's structure (email + Google OAuth buttons).
 * Actual auth is deferred to the Supabase milestone; these pages collect the
 * same inputs and explain dev-mode behavior.
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
  const [notice] = useState<string | null>(null);
  return (
    <div className="flex min-h-screen flex-col bg-paper-100">
      <header className="border-b border-paper-900/[0.08] bg-paper-100/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Copyr home">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-900 font-serif text-base font-semibold leading-none text-paper-50">C</span>
            <span className="font-serif text-xl tracking-tight text-paper-900">Copyr</span>
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
          {notice && <p className="mt-3 text-center text-xs text-paper-500">{notice}</p>}
        </div>
      </main>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-paper-900/[0.16] bg-white px-3 py-2.5 text-sm text-paper-900 outline-none transition placeholder:text-paper-400 hover:border-paper-900/[0.28] focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/10";

const primaryBtn =
  "btn-ink w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-paper-50";

function GoogleButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => alert("Google OAuth activates with the Supabase auth milestone.")}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-paper-900/15 bg-white px-4 py-2.5 text-sm font-medium text-paper-800 transition hover:border-paper-900/30 hover:bg-paper-50"
    >
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.7-.2-2.5H12v4.8h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9H1.3v3.1C3.3 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.3 14.4c-.3-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4V6.5H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.5l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.1C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.5l4 3.1c1-2.8 3.6-4.8 6.7-4.8z"/></svg>
      {label}
    </button>
  );
}

export function SignIn() {
  const navigate = useNavigate();
  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Welcome back! Please enter your details"
      footer={
        <>
          Do not have an account yet?{" "}
          <Link to="/auth/sign-up" className="font-medium text-brand-700 hover:underline">Sign up</Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Dev-mode: any credentials enter the seeded demo workspace.
          navigate("/app");
        }}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Email</span>
          <input required type="email" placeholder="you@firm.vc" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-paper-700">Password</span>
          <input required type="password" placeholder="••••••••" className={input} />
        </label>
        <div className="text-right">
          <Link to="/auth/reset" className="text-xs font-medium text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <button type="submit" className={primaryBtn}>
          Sign in with Email
        </button>
        <div className="flex items-center gap-3 text-xs text-paper-400">
          <span className="h-px flex-1 bg-paper-200" /> or continue with <span className="h-px flex-1 bg-paper-200" />
        </div>
        <GoogleButton label="Sign in with Google" />
      </form>
    </AuthLayout>
  );
}

export function SignUp() {
  return (
    <AuthLayout
      title="Create an account"
      subtitle="Fill the form below to create an account."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/sign-in" className="font-medium text-brand-700 hover:underline">Sign in</Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          alert("Account creation activates with the Supabase auth milestone — explore the demo workspace meanwhile.");
        }}
      >
        <input required placeholder="Full name" className={input} />
        <input required type="email" placeholder="Work email" className={input} />
        <input placeholder="Firm / company name" className={input} />
        <input required type="password" placeholder="Password" className={input} />
        <input required type="password" placeholder="Please repeat your new password to confirm it" className={input} />
        <button type="submit" className={primaryBtn}>
          Sign up with Email
        </button>
        <div className="flex items-center gap-3 text-xs text-paper-400">
          <span className="h-px flex-1 bg-paper-200" /> or continue with <span className="h-px flex-1 bg-paper-200" />
        </div>
        <GoogleButton label="Sign in with Google" />
      </form>
    </AuthLayout>
  );
}

export function PasswordReset() {
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={<Link to="/auth/sign-in" className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          alert("Password reset emails activate with the Supabase auth milestone.");
        }}
      >
        <input required type="email" placeholder="you@firm.vc" className={input} />
        <button type="submit" className={primaryBtn}>
          Send reset link
        </button>
      </form>
    </AuthLayout>
  );
}
