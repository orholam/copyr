import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { IconX } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── monogram avatar with deterministic hue ───────────────────────── */

const HUES = [222, 254, 268, 290, 330, 14, 34, 92, 152, 174];

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = HUES[h % HUES.length] ?? 220;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.36),
        background: `hsl(${hue} 38% 88%)`,
        color: `hsl(${hue} 32% 30%)`,
        boxShadow: "inset 0 0 0 1px rgba(23,22,19,.08)",
      }}
    >
      {initials}
    </span>
  );
}

/* ── buttons ───────────────────────────────────────────────────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "subtle";
  size?: "xs" | "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  return (
    <button
      className={cx(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brand-500/35 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        size === "xs"
          ? "h-6 px-2 text-[12px]"
          : size === "sm"
            ? "h-7 px-2.5 text-[12.5px]"
            : "h-8 px-3 text-[13px]",
        variant === "primary" && "btn-ink text-paper-50",
        variant === "outline" &&
          "border border-paper-900/[0.15] bg-white text-paper-800 shadow-card hover:border-paper-900/30 hover:bg-paper-50 hover:shadow-[0_3px_10px_-4px_rgba(23,22,19,0.25)]",
        variant === "ghost" && "text-paper-600 hover:bg-paper-900/[0.05] hover:text-paper-900",
        variant === "subtle" && "bg-brand-50 text-brand-700 hover:bg-brand-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  );
}

/* ── tags, chips, deltas ─────────────────────────────────────────── */

const badgeTones: Record<string, string> = {
  slate: "border-paper-900/[0.16] bg-white text-paper-600",
  indigo: "border-brand-300 bg-brand-50 text-brand-800",
  green: "border-emerald-300 bg-emerald-50 text-emerald-800",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  red: "border-red-300 bg-red-50 text-red-700",
  purple: "border-violet-300 bg-violet-50 text-violet-700",
};

export function Badge({
  tone = "slate",
  children,
  className,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium leading-4 capitalize",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function DeltaChip({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cx(
        "num inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[11px] font-medium",
        up
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-600",
      )}
    >
      {up ? "↑" : "↓"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

/* ── modal ─────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
  size = "md",
  bodyClassName,
  bare,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** @deprecated prefer size="lg" */
  wide?: boolean;
  size?: "md" | "lg" | "canvas";
  bodyClassName?: string;
  /** Skip title chrome — child owns the chrome (used by full-bleed canvas editors). */
  bare?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  const resolved = size === "md" && wide ? "lg" : size;
  // Portal to body: pages keep a lingering transform (animate-fade-up), which
  // would otherwise become the containing block for this fixed overlay.
  return createPortal(
    <div
      className={cx(
        "animate-fade-in fixed inset-0 z-50 flex justify-center bg-paper-900/30 backdrop-blur-[2px] dark:bg-black/60",
        resolved === "canvas"
          ? "items-center justify-center p-4 sm:p-6"
          : "items-start overflow-y-auto p-4 pt-[11vh]",
      )}
      onMouseDown={onClose}
    >
      <div
        className={cx(
          "animate-pop flex w-full flex-col overflow-hidden border border-paper-900/[0.13] bg-white shadow-pop",
          resolved === "canvas"
            ? "h-[min(640px,88dvh)] max-w-[560px] rounded-xl"
            : resolved === "lg"
              ? "max-h-[85dvh] max-w-[620px] rounded-xl"
              : "max-h-[85dvh] max-w-md rounded-xl",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!bare && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-paper-900/[0.08] bg-paper-100/60 px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold leading-5 tracking-tight text-paper-900">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-paper-500">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded-md p-1 text-paper-400 transition hover:bg-paper-900/[0.06] hover:text-paper-900"
            >
              <IconX width={14} height={14} />
            </button>
          </div>
        )}
        <div
          className={cx(
            "min-h-0 flex-1",
            resolved === "canvas" ? "flex flex-col overflow-hidden p-0" : "overflow-y-auto p-4",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── form fields ───────────────────────────────────────────────────── */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-paper-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-paper-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-paper-900/[0.16] bg-white px-2.5 py-1.5 text-[13px] text-paper-900 outline-none transition-all duration-150 placeholder:text-paper-400 hover:border-paper-900/[0.28] focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/10";

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, "appearance-none pr-7", className)} {...props} />;
}

/* ── misc ──────────────────────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-paper-900/15 border-t-brand-600",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton h-3.5", className)} />;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-paper-900/[0.09] bg-paper-200/70 p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-95",
            value === o.value
              ? "bg-white text-paper-900 shadow-card"
              : "text-paper-600 hover:text-paper-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-serif text-[21px] font-semibold leading-6 tracking-tight text-paper-900">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-paper-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-paper-900/[0.18] py-16 text-center">
      {icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-paper-100 text-paper-500 ring-1 ring-paper-900/[0.07]">
          {icon}
        </div>
      )}
      <p className="font-serif text-base font-semibold tracking-tight text-paper-900">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs leading-relaxed text-paper-600">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const offline = error instanceof TypeError;
  const message = offline
    ? "Can't reach the API at /api — is the server running? (`pnpm db:up && pnpm --filter @copyr/api dev`)"
    : ((error as Error)?.message ?? "Something went wrong");
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-300 bg-red-50/40 py-14 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-red-100 text-red-600">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      </div>
      <p className="font-serif text-base font-semibold tracking-tight text-paper-900">{offline ? "Connection lost" : "Something broke"}</p>
      <p className="mt-1 max-w-md break-words px-6 text-xs leading-relaxed text-paper-600">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Panel({
  title,
  desc,
  icon,
  children,
  actions,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-paper-900/[0.07] bg-paper-100/60 px-3.5 py-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-paper-600">
          {icon && <span className="text-paper-400">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          {desc && <span className="truncate text-xs text-paper-500 normal-case tracking-normal">{desc}</span>}
          {actions}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
