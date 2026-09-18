import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle, useTheme } from "../lib/theme";
import {
  IconArrowUpRight,
  IconBot,
  IconCheck,
  IconDoc,
  IconLink,
  IconSpark,
  IconTrendUp,
} from "../components/icons";

/* ---------------------------------- shared --------------------------------- */

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-paper-500">
      {children}
    </p>
  );
}

function ArrowLink({ to = "#features", children }: { to?: string; children: ReactNode }) {
  const cls =
    "group inline-flex items-center gap-1 text-sm font-medium text-paper-900 underline-offset-4 hover:underline";
  return to.startsWith("/") ? (
    <Link to={to} className={cls}>
      {children}
      <IconArrowUpRight width={14} height={14} className="text-paper-500 transition-colors group-hover:text-paper-900" />
    </Link>
  ) : (
    <a href={to} className={cls}>
      {children}
      <IconArrowUpRight width={14} height={14} className="text-paper-500 transition-colors group-hover:text-paper-900" />
    </a>
  );
}

const btnDark =
  "inline-flex h-11 items-center justify-center rounded-lg bg-paper-900 px-6 text-sm font-medium text-paper-50 transition hover:bg-paper-800";
const btnGhost =
  "inline-flex h-11 items-center justify-center rounded-lg border border-paper-900/15 bg-white/60 px-6 text-sm font-medium text-paper-900 transition hover:border-paper-900/30 hover:bg-white";

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-md font-serif text-base font-semibold ${
          light ? "bg-paper-50 text-paper-900" : "bg-paper-900 text-paper-50"
        }`}
      >
        C
      </span>
      <span className={`font-serif text-xl tracking-tight ${light ? "text-paper-50" : "text-paper-900"}`}>
        Copyr
      </span>
    </span>
  );
}

/* ----------------------------------- nav ----------------------------------- */

function Nav() {
  const [open, setOpen] = useState(false);
  const { dark, toggle } = useTheme();
  const links = [
    ["How it works", "#how"],
    ["Features", "#features"],
    ["Agents", "#agents"],
    ["Pricing", "#pricing"],
    ["FAQ", "#faq"],
  ] as const;
  return (
    <header className="sticky top-0 z-40 border-b border-paper-900/[0.08] bg-paper-100/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="Copyr home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href} className="text-sm text-paper-600 transition hover:text-paper-900">
              {label}
            </a>
          ))}
          <Link to="/blog" className="text-sm text-paper-600 transition hover:text-paper-900">
            Blog
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggle dark={dark} onToggle={toggle} />
          <Link to="/auth/sign-in" className="hidden text-sm font-medium text-paper-700 transition hover:text-paper-900 sm:block">
            Sign in
          </Link>
          <Link
            to="/auth/sign-up"
            className="inline-flex h-9 items-center rounded-lg bg-paper-900 px-4 text-sm font-medium text-paper-50 transition hover:bg-paper-800"
          >
            Get started
          </Link>
          <button
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-paper-900/10 text-paper-700 md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M18 6 6 18M6 6l12 12" /> : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="animate-fade-in border-t border-paper-900/[0.08] bg-paper-100 px-4 py-3 md:hidden">
          {[...links, ["Blog", "/blog"] as const].map(([label, href]) =>
            href.startsWith("/") ? (
              <Link key={href} to={href} onClick={() => setOpen(false)} className="block py-2.5 text-sm text-paper-700">
                {label}
              </Link>
            ) : (
              <a key={href} href={href} onClick={() => setOpen(false)} className="block py-2.5 text-sm text-paper-700">
                {label}
              </a>
            ),
          )}
        </nav>
      )}
    </header>
  );
}

/* ------------------------------- hero visuals ------------------------------ */

type DealCard = [name: string, meta: string];

function KanbanCol({ stage, count, deals }: { stage: string; count: number; deals: DealCard[] }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-paper-100 p-2 ring-1 ring-paper-900/[0.18]">
      <p className="flex items-center justify-between px-1 pb-2 text-[11px] font-bold uppercase tracking-wider text-paper-800">
        {stage}
        <span className="num rounded-full bg-white px-1.5 text-[10px] font-semibold text-paper-800 ring-1 ring-paper-900/[0.2]">{count}</span>
      </p>
      <div className="space-y-1.5">
        {deals.map(([name, meta]) => (
          <div key={name} className="rounded-md border border-paper-900/25 bg-white px-2.5 py-2 shadow-[0_1px_3px_rgba(23,22,19,0.1)]">
            <p className="truncate text-xs font-semibold text-paper-900">{name}</p>
            <p className="num mt-0.5 truncate text-[11px] font-medium text-paper-700">{meta}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxRail() {
  const rows: Array<[string, string, "processed" | "processing" | "queued"]> = [
    ["QuantumAI — Series A deck", "Sarah Chen", "processed"],
    ["Follow-up: BioTech opp.", "Mike Johnson", "processing"],
    ["Intro to FinTech startup", "Emily Park", "queued"],
  ];
  const dot = { processed: "bg-emerald-500", processing: "bg-amber-500", queued: "bg-paper-400" } as const;
  return (
    <div className="hidden w-[236px] shrink-0 border-l border-paper-900/[0.15] bg-white lg:block">
      <p className="border-b border-paper-900/[0.12] px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-paper-800">
        AI inbox
      </p>
      <div className="space-y-1 p-2.5">
        {rows.map(([subj, from, status]) => (
          <div key={subj} className="rounded-md border border-paper-900/[0.16] bg-paper-50 px-2.5 py-2">
            <p className="truncate text-xs font-semibold text-paper-900">{subj}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-paper-700">
              <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
              {from} · {status}
            </p>
          </div>
        ))}
      </div>
      <div className="mx-2.5 mb-2.5 rounded-md border border-brand-300 bg-brand-50 p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-brand-800">Extracted</p>
        <dl className="mt-1.5 space-y-1 text-[11px]">
          <div className="flex justify-between"><dt className="font-medium text-paper-700">Ask</dt><dd className="num font-semibold text-paper-900">$8M</dd></div>
          <div className="flex justify-between"><dt className="font-medium text-paper-700">ARR</dt><dd className="num font-semibold text-paper-900">$1.4M</dd></div>
          <div className="flex justify-between"><dt className="font-medium text-paper-700">Sector</dt><dd className="font-semibold text-paper-900">Robotics</dd></div>
        </dl>
      </div>
    </div>
  );
}

function HeroMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-paper-900/[0.18] bg-white shadow-[0_1px_2px_rgba(23,22,19,0.06),0_32px_64px_-32px_rgba(23,22,19,0.35)]">
      <div className="flex items-center gap-3 border-b border-paper-900/[0.12] bg-paper-50 px-4 py-2.5">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-paper-400" />
          <i className="h-2.5 w-2.5 rounded-full bg-paper-400" />
          <i className="h-2.5 w-2.5 rounded-full bg-paper-400" />
        </span>
        <span className="mx-auto flex items-center gap-1.5 rounded-md border border-paper-900/[0.18] bg-white px-3 py-1 text-xs font-medium text-paper-700">
          copyr.dev/app/pipeline
        </span>
        <span className="w-10" />
      </div>
      <div className="flex">
        <div className="grid flex-1 grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-4">
          <KanbanCol
            stage="Intake"
            count={4}
            deals={[
              ["Nimbus Robotics", "$8M · Series A"],
              ["DataFlow", "$3M · Seed"],
              ["SecureNet", "$4.5M · Seed"],
              ["Braid", "$2M · Pre-seed"],
            ]}
          />
          <KanbanCol
            stage="Diligence"
            count={2}
            deals={[
              ["CloudScale", "$8M · Series A"],
              ["QuantumLeap", "$15M · Series B"],
            ]}
          />
          <KanbanCol
            stage="Committed"
            count={2}
            deals={[
              ["Reactiv", "$5M · Series A"],
              ["RouteSense", "$6M · Series A"],
            ]}
          />
        </div>
        <InboxRail />
      </div>
    </div>
  );
}

/* ----------------------------------- hero ---------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="hero-grid pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          maskImage: "radial-gradient(70% 55% at 50% 0%, black 20%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(70% 55% at 50% 0%, black 20%, transparent 80%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 pt-20 sm:px-6 md:pt-28">
        <Reveal className="text-center">
          <Link
            to="/changelog"
            className="inline-flex items-center gap-2 rounded-full border border-paper-900/10 bg-white/70 py-1.5 pl-3 pr-3.5 text-xs font-medium text-paper-700 transition hover:border-paper-900/25 hover:text-paper-900"
          >
            <span className="rounded-full bg-paper-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-paper-50">New</span>
            MCP agents now operate your CRM — 105 tools live
            <IconArrowUpRight width={12} height={12} />
          </Link>
          <h1 className="mx-auto mt-7 max-w-4xl font-serif text-[44px] leading-[1.04] tracking-tight text-paper-900 sm:text-6xl md:text-7xl">
            Deal flow that <em className="italic text-brand-700">runs itself.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-paper-600">
            Forward an email, paste a DocSend link, or drop a hundred PDFs. Copyr triages every pitch,
            extracts every field into your schema, files permanent decks, and keeps the pipeline current —
            no manual data entry, no expired links.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth/sign-up" className={btnDark}>Start free trial</Link>
            <Link to="/app" className={btnGhost}>Open live demo →</Link>
          </div>
          <p className="mt-4 text-xs text-paper-500">No credit card · 30-day trial · MCP server included</p>
        </Reveal>
        <Reveal delay={150} className="mt-14 md:mt-20">
          <HeroMock />
        </Reveal>
      </div>
    </section>
  );
}

function ChipMarquee() {
  const chips = [
    "Convert DocSend links", "Parse pitch decks", "Extract company data", "Auto-fill CRM fields",
    "Track communications", "Forward emails", "Draft investment memos", "Manage pipeline",
    "Custom attributes", "Team collaboration",
  ];
  const row = [...chips, ...chips];
  return (
    <div className="mt-16 border-y border-paper-900/[0.08] bg-white/40 py-4 md:mt-24">
      <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className="animate-marquee flex w-max gap-3">
          {row.map((c, i) => (
            <span
              key={i}
              className="whitespace-nowrap rounded-full border border-paper-900/[0.09] bg-paper-50 px-4 py-1.5 text-sm text-paper-600"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- stats ---------------------------------- */

function StatsBand() {
  const stats: Array<[string, string]> = [
    ["<2 min", "from a forwarded email to a fully populated deal"],
    ["12 hrs", "saved per analyst, every single week"],
    ["100+", "pitch decks parsed from one bulk drop"],
    ["105", "tools exposed to AI agents over MCP"],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([big, small], i) => (
          <Reveal key={big} delay={i * 80}>
            <p className="num border-t border-paper-900/15 pt-5 font-serif text-4xl tracking-tight text-paper-900 md:text-5xl">
              {big}
            </p>
            <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-paper-600">{small}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------- platform -------------------------------- */

function Platform() {
  return (
    <section id="platform" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6">
      <Reveal>
        <Eyebrow>Platform</Eyebrow>
        <h2 className="mt-3 max-w-2xl font-serif text-4xl leading-[1.08] tracking-tight text-paper-900 md:text-5xl">
          One platform for the entire deal lifecycle
        </h2>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {[
          {
            title: "For solo & emerging GPs",
            body: "Operational leverage is the fund. Copyr ingests and triages like a team of three — every deck read, every field filled, every follow-up tracked — so one person covers what used to take four.",
          },
          {
            title: "For investment teams",
            body: "A shared source of truth: custom stages and fields, notes with @mentions, workspace roles, and a complete audit trail that records who changed what — human or AI.",
          },
        ].map((card, i) => (
          <Reveal key={card.title} delay={i * 100}>
            <div className="flex h-full flex-col rounded-2xl border border-paper-900/10 bg-white/60 p-8 transition hover:border-paper-900/20 hover:bg-white md:p-10">
              <h3 className="font-serif text-2xl tracking-tight text-paper-900">{card.title}</h3>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-paper-600">{card.body}</p>
              <div className="mt-6">
                <ArrowLink>Explore the platform</ArrowLink>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------- how it works ------------------------------ */

function HowItWorks() {
  const steps: Array<[string, string]> = [
    ["Email received", "A founder forwards a pitch — or you paste any deck link."],
    ["AI review & extract", "Decks become permanent PDFs; AI reads them and fills your custom fields."],
    ["Deal created", "Company + deal land in your intake stage, fully populated."],
    ["Pipeline updated", "Drag through stages; every change is logged on the timeline."],
  ];
  return (
    <section id="how" className="scroll-mt-20 border-y border-paper-900/[0.08] bg-white/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <Reveal>
          <Eyebrow>In action</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-serif text-4xl leading-[1.08] tracking-tight text-paper-900 md:text-5xl">
            From inbox to investment, without the busywork
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <Reveal key={title} delay={i * 90}>
              <p className="num border-t border-paper-900/15 pt-5 font-serif text-3xl italic text-paper-400">
                {String(i + 1).padStart(2, "0")}
              </p>
              <p className="mt-3 text-[15px] font-semibold text-paper-900">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-paper-600">{body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- feature mocks ---------------------------- */

const mockShell =
  "overflow-hidden rounded-xl border border-paper-900/[0.22] bg-white shadow-[0_1px_2px_rgba(23,22,19,0.06),0_24px_48px_-28px_rgba(23,22,19,0.3)]";

function MockCaption({ children }: { children: ReactNode }) {
  return (
    <p className="border-b border-paper-900/[0.12] bg-paper-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-paper-800">
      {children}
    </p>
  );
}

function StatusPill({ status }: { status: "processed" | "processing" | "queued" }) {
  const styles = {
    processed: "border-emerald-300 bg-emerald-50 text-emerald-800",
    processing: "border-amber-300 bg-amber-50 text-amber-800",
    queued: "border-paper-900/25 bg-paper-100 text-paper-700",
  } as const;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${styles[status]}`}>
      {status}
    </span>
  );
}

function InboxMock() {
  const rows: Array<[string, string, "processed" | "processing" | "queued"]> = [
    ["Pitch deck — QuantumAI Series A", "Sarah Chen · attachments (2)", "processed"],
    ["Follow-up: BioTech opportunity", "Mike Johnson", "processing"],
    ["Intro to FinTech startup", "Emily Park · forwarded", "queued"],
  ];
  return (
    <div className={mockShell}>
      <MockCaption>Inbox · deal@harbor.vc</MockCaption>
      <div className="divide-y divide-paper-900/[0.1]">
        {rows.map(([subj, from, status]) => (
          <div key={subj} className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-paper-900">{subj}</p>
              <p className="truncate text-[13px] font-medium text-paper-700">{from}</p>
            </div>
            <StatusPill status={status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkMock() {
  return (
    <div className={mockShell}>
      <MockCaption>Link conversion</MockCaption>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2.5 rounded-lg border border-paper-900/25 bg-paper-50 px-3 py-2.5">
          <IconLink width={15} height={15} className="shrink-0 text-paper-600" />
          <span className="truncate font-mono text-xs font-medium text-paper-800">docsend.com/view/k7fq2/nimbus-series-a</span>
        </div>
        <div className="flex items-center gap-3 pl-3">
          <span className="h-6 w-px bg-paper-900/25" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-paper-700">converting…</span>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-3">
          <IconDoc width={18} height={18} className="shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-paper-900">nimbus-series-a.pdf</p>
            <p className="text-[13px] font-medium text-emerald-800">Permanent copy · parsed ✓ · extracted ✓</p>
          </div>
          <IconCheck width={15} height={15} className="shrink-0 text-emerald-600" />
        </div>
        <p className="pl-1 text-[13px] font-medium text-paper-700">+99 PDFs queued — bulk drops parse overnight</p>
      </div>
    </div>
  );
}

function ExtractMock() {
  const fields: Array<[string, string]> = [
    ["Company", "Nimbus Robotics"], ["Stage", "Series A"], ["Sector", "Robotics"],
    ["Geography", "SF Bay Area"], ["Ask", "$8M"], ["ARR", "$1.4M"],
    ["Growth", "+180% YoY"], ["Team size", "14"],
  ];
  return (
    <div className={mockShell}>
      <MockCaption>
        <span className="inline-flex items-center gap-1.5">
          <IconSpark width={11} height={11} className="text-brand-600" />
          AI extraction · confidence 96%
        </span>
      </MockCaption>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5">
        {fields.map(([k, v]) => (
          <div key={k}>
            <dt className="flex items-center gap-1 text-[11px] font-bold text-paper-600">
              {k}
              <IconCheck width={10} height={10} strokeWidth={3} className="text-emerald-500" />
            </dt>
            <dd className="num mt-0.5 text-sm font-semibold text-paper-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MemoMock() {
  const sections: Array<[string, string]> = [
    ["What they do", "Autonomous mobile robots for warehouse fulfilment. $1.4M ARR growing 180%."],
    ["Why it fits", "Robotics infrastructure at the seed-to-A frontier — squarely on thesis."],
    ["Key risks", "Hardware margins; two larger competitors shipping faster."],
    ["Next steps", "Partner intro call · reference two customers · revisit unit economics."],
  ];
  return (
    <div className={mockShell}>
      <MockCaption>Investment memo · generated</MockCaption>
      <div className="p-5">
        <p className="font-serif text-lg italic tracking-tight text-paper-900">Thesis memo — Nimbus Robotics</p>
        <dl className="mt-4 space-y-3.5">
          {sections.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-brand-800">{k}</dt>
              <dd className="mt-0.5 text-[13px] font-medium leading-relaxed text-paper-800">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function AnalyticsMock() {
  const bars = [34, 52, 44, 66, 58, 84, 92];
  const stats: Array<[string, string]> = [
    ["Active deals", "24"], ["Pipeline", "$61M"], ["New founders", "12"], ["Conversion", "18%"],
  ];
  return (
    <div className={mockShell}>
      <MockCaption>Analytics overview</MockCaption>
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k}>
              <p className="num font-serif text-2xl font-medium tracking-tight text-paper-900">{v}</p>
              <p className="mt-0.5 text-xs font-semibold text-paper-700">{k}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            <div
              key={i}
              style={{ height: `${h}%` }}
              className={`flex-1 rounded-t-sm ${i === bars.length - 1 ? "bg-brand-600" : "bg-paper-400"}`}
            />
          ))}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-paper-700">
          <IconTrendUp width={12} height={12} className="text-emerald-600" />
          Weekly pipeline movement from the activity log
        </p>
      </div>
    </div>
  );
}

function TableMock() {
  const rows: Array<[string, string, string, string, string]> = [
    ["Nimbus Robotics", "Series A", "$8M", "$1.4M", "Robotics"],
    ["DataFlow", "Seed", "$3M", "$600K", "Data infra"],
    ["Braid", "Pre-seed", "$2M", "$140K", "DevTools"],
    ["CloudScale", "Series A", "$8M", "$2.1M", "Infra"],
  ];
  const pill: Record<string, string> = {
    "Pre-seed": "border-paper-900/30 bg-paper-100 text-paper-800",
    Seed: "border-sky-300 bg-sky-50 text-sky-800",
    "Series A": "border-brand-300 bg-brand-50 text-brand-800",
  };
  return (
    <div className={mockShell}>
      <MockCaption>Pipeline · table view</MockCaption>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-paper-900/[0.15] text-[11px] font-bold uppercase tracking-wider text-paper-700">
            <th className="px-4 py-2.5">Company</th>
            <th className="px-4 py-2.5">Stage</th>
            <th className="px-4 py-2.5">Ask</th>
            <th className="hidden px-4 py-2.5 sm:table-cell">ARR</th>
            <th className="hidden px-4 py-2.5 sm:table-cell">Sector</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-900/[0.1]">
          {rows.map(([co, stage, ask, arr, sector]) => (
            <tr key={co} className="font-medium text-paper-800 transition hover:bg-paper-50">
              <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-paper-900">{co}</td>
              <td className="px-4 py-2.5">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill[stage]}`}>{stage}</span>
              </td>
              <td className="num whitespace-nowrap px-4 py-2.5">{ask}</td>
              <td className="num hidden whitespace-nowrap px-4 py-2.5 sm:table-cell">{arr}</td>
              <td className="hidden whitespace-nowrap px-4 py-2.5 sm:table-cell">{sector}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelMock() {
  const rows: Array<[string, string[], string, boolean?]> = [
    ["Nimbus Robotics", ["SC", "MP"], "Sarah & Mike · last touch 2d ago"],
    ["FinStart", ["AK"], "Alex · 12 emails · quiet 3 weeks", true],
    ["DataAI", ["You"], "You · 3 emails · today"],
  ];
  return (
    <div className={mockShell}>
      <MockCaption>Relationship intelligence</MockCaption>
      <div className="divide-y divide-paper-900/[0.1]">
        {rows.map(([co, initials, note, warn]) => (
          <div key={co} className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex -space-x-1.5">
                {initials.map((ini) => (
                  <i
                    key={ini}
                    className={`num flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold not-italic ring-2 ring-white ${
                      ini === "You" ? "bg-brand-200 text-brand-800" : "bg-paper-300 text-paper-800"
                    }`}
                  >
                    {ini}
                  </i>
                ))}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-paper-900">{co}</p>
                <p className={`truncate text-[13px] font-medium ${warn ? "text-amber-700" : "text-paper-700"}`}>{note}</p>
              </div>
            </div>
            {warn && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">nudge</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PortMock() {
  const entries: Array<[string, string, "milestone" | "metric" | "hiring" | "funding"]> = [
    ["Reactiv", "ARR crossed $5M — ahead of plan", "milestone"],
    ["Braid", "New CTO joined from Google", "hiring"],
    ["RouteSense", "Q4 update: NRR at 128%", "metric"],
    ["QuantumLeap", "Series B extension closed", "funding"],
  ];
  const tag = {
    milestone: "border-emerald-300 bg-emerald-50 text-emerald-800",
    metric: "border-brand-300 bg-brand-50 text-brand-800",
    hiring: "border-violet-400/40 bg-violet-400/15 text-violet-500",
    funding: "border-amber-300 bg-amber-50 text-amber-800",
  } as const;
  return (
    <div className={mockShell}>
      <MockCaption>Portfolio timelines</MockCaption>
      <div className="relative space-y-0 p-5 before:absolute before:bottom-6 before:left-[24px] before:top-8 before:w-px before:bg-paper-900/25">
        {entries.map(([co, what, kind]) => (
          <div key={`${co}-${kind}`} className="relative flex items-start gap-4 py-2.5">
            <span className="relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-paper-700 ring-1 ring-paper-900/25" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-paper-900">
                {co}{" "}
                <span className={`ml-1 inline-block translate-y-[-1px] rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${tag[kind]}`}>
                  {kind}
                </span>
              </p>
              <p className="truncate text-[13px] font-medium text-paper-700">{what}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- features -------------------------------- */

interface FeatureRowProps {
  n: string;
  title: string;
  desc: string;
  points?: string[];
  visual: ReactNode;
  flip?: boolean;
}

function FeatureRow({ n, title, desc, points, visual, flip }: FeatureRowProps) {
  return (
    <div className="grid items-center gap-8 border-t border-paper-900/10 py-12 md:grid-cols-2 md:gap-14 md:py-16">
      <Reveal className={flip ? "md:order-2" : ""}>
        <p className="num font-serif text-sm italic text-paper-400">{n}</p>
        <h3 className="mt-2 font-serif text-3xl leading-tight tracking-tight text-paper-900 md:text-4xl">{title}</h3>
        <p className="mt-4 text-[15px] leading-relaxed text-paper-600">{desc}</p>
        {points && (
          <ul className="mt-5 space-y-2.5">
            {points.map((pt) => (
              <li key={pt} className="flex items-start gap-2.5 text-sm text-paper-700">
                <IconCheck width={15} height={15} strokeWidth={2.4} className="mt-0.5 shrink-0 text-emerald-600" />
                {pt}
              </li>
            ))}
          </ul>
        )}
      </Reveal>
      <Reveal delay={120} className={flip ? "md:order-1" : ""}>
        {visual}
      </Reveal>
    </div>
  );
}

function ActHeader({ index, title, blurb }: { index: string; title: string; blurb: string }) {
  return (
    <Reveal>
      <div className="grid gap-4 pt-14 md:grid-cols-[auto_1fr_auto] md:items-baseline md:gap-10">
        <p className="num font-serif text-sm italic text-paper-400">Act {index}</p>
        <h3 className="font-serif text-3xl leading-tight tracking-tight text-paper-900 md:text-4xl">{title}</h3>
        <p className="max-w-xs text-sm leading-relaxed text-paper-500">{blurb}</p>
      </div>
    </Reveal>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
      <Reveal className="pt-20 md:pt-28">
        <Eyebrow>Everything, in detail</Eyebrow>
        <h2 className="mt-3 max-w-2xl font-serif text-4xl leading-[1.08] tracking-tight text-paper-900 md:text-5xl">
          Built to handle your entire deal flow
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-paper-600">
          Eight capabilities, one system of record. Every inbound channel becomes structured data;
          every action lands on an auditable timeline.
        </p>
      </Reveal>

      <ActHeader index="01" title="Capture everything" blurb="Every inbound channel becomes a structured record — automatically." />
      <FeatureRow
        n="01"
        title="An inbox that triages itself"
        desc="Forward pitch emails to your Copyr address — or pipe inbound via webhook. Every message is deduped, its company detected, and a deal created with attachments filed."
        points={[
          "Plain forwarding or SES-compatible webhooks",
          "Duplicate emails collapse automatically",
          "Live statuses: queued → processing → processed",
        ]}
        visual={<InboxMock />}
      />
      <FeatureRow
        n="02"
        title="Decks become permanent files"
        desc="Paste a DocSend, Pitch, Google Drive or Canva link and Copyr produces a permanent PDF attached to the company record. Drop up to a hundred PDFs at once — they parse while you sleep."
        points={[
          "Links never expire again — the material is yours",
          "Bulk upload with automatic parsing",
          "Public intake forms & browser capture endpoint",
        ]}
        visual={<LinkMock />}
        flip
      />

      <ActHeader index="02" title="Understand instantly" blurb="Your custom fields become AI extraction targets — every deck comes back comparable." />
      <FeatureRow
        n="03"
        title="Extraction against your schema"
        desc="Define the fields your fund cares about once — sector, geography, ARR, growth, check size, conviction. AI reads every deck and email and fills them, turning a pile of decks into a dataset."
        points={[
          "Eight field types incl. currency & multi-select",
          "Structured output, validated by contracts",
          "Deterministic offline mode for testing",
        ]}
        visual={<ExtractMock />}
      />
      <FeatureRow
        n="04"
        title="Investment memos in one click"
        desc="Generate a structured thesis memo from extracted data — what they do, why it fits your thesis, key risks, next steps. The first draft is done before the partner call starts."
        visual={<MemoMock />}
        flip
      />
      <FeatureRow
        n="05"
        title="Analytics that write themselves"
        desc="Active deals, pipeline value, new founders, conversion rates — computed from your activity log rather than hand-maintained dashboards, with weekly trends as your team works."
        visual={<AnalyticsMock />}
      />

      <ActHeader index="03" title="Move deals as a team" blurb="One live source of truth, from sourcing through close." />
      <FeatureRow
        n="06"
        title="Kanban & table views"
        desc="Drag deals through custom stages on the board, or sort, filter and search across every field in the table. Changes stream to everyone in real time."
        points={[
          "Fractional-index ordering — no renumber lag",
          "SSE live updates across the team",
          "Tags, saved filters & CSV/JSON export",
        ]}
        visual={<TableMock />}
        flip
      />
      <FeatureRow
        n="07"
        title="Relationship intelligence"
        desc="Copyr builds a graph from your correspondence: who on the team has talked to which company, how often, and when they went quiet — warm paths surface before cold outreach does."
        visual={<RelMock />}
      />
      <FeatureRow
        n="08"
        title="Portfolio timelines"
        desc="Inbound portfolio updates are classified — milestone, metric, hiring, funding, news — and streamed into per-company timelines automatically. Your portfolio's pulse, in one feed."
        visual={<PortMock />}
        flip
      />
    </section>
  );
}

/* ----------------------------------- agents -------------------------------- */

const MCP_TOOLS = [
  "list_deals", "create_deal", "move_deal", "ingest_email", "search_companies",
  "set_field_values", "analytics_overview", "add_note", "upload_document",
  "create_review_table", "ask_knowledge", "run_agent", "remember",
];

function AgentsSection() {
  return (
    <section id="agents" className="mt-20 scroll-mt-20 bg-paper-900 md:mt-28">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-paper-400">Agent-native</p>
            <h2 className="mt-3 font-serif text-4xl leading-[1.08] tracking-tight text-paper-50 md:text-5xl">
              Operated by agents, not just humans.
            </h2>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-paper-400">
              The UI is just one client of the Copyr core. A full MCP server exposes everything it can do —
              so Claude, GPT or your own agents triage the inbox, move deals and draft reviews with the same
              tools your team uses.
            </p>
            <ul className="mt-7 space-y-2.5 text-sm text-paper-300">
                {[
                  "105 tools over stdio or streamable HTTP at /mcp — full create/read/update/delete on every entity",
                  "Resources like copyr://deals/{id}, prompts like company-deep-dive",
                  "Admin surfaces: API keys, intake forms, webhooks, share links",
                  "REST /api/v1 with OpenAPI spec & Zapier-compatible webhooks",
                  "Workspace-scoped API keys for every agent",
                ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <IconCheck width={15} height={15} strokeWidth={2.4} className="mt-0.5 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={140}>
            <div className="flex h-full flex-col gap-5">
              <div className="flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                <p className="border-b border-white/10 px-4 py-2.5 font-mono text-[11px] text-paper-400 dark:text-paper-600">
                  claude_desktop_config.json
                </p>
                <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-paper-200 dark:text-paper-800">
{`{
  "mcpServers": {
    "copyr": {
      "command": "pnpm",
      "args": ["--filter @copyr/mcp", "run", "stdio"],
      "env": {
        "COPYR_WORKSPACE_SLUG": "harbor-ventures"
      }
    }
  }
}`}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2">
                {MCP_TOOLS.map((tool) => (
                  <code key={tool} className="rounded-md border border-white/15 bg-white/[0.06] px-2.5 py-1 font-mono text-[11px] text-paper-300">
                    {tool}()
                  </code>
                ))}
                <span className="rounded-md px-2 py-1 font-mono text-[11px] text-paper-500">+92 more…</span>
              </div>
            </div>
          </Reveal>
        </div>
        <Reveal delay={200}>
          <div className="mt-14 flex items-center gap-4 border-t border-white/10 pt-8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-paper-300 dark:text-paper-700">
              <IconBot width={18} height={18} />
            </span>
            <p className="text-sm leading-relaxed text-paper-400">
              Point any MCP client at Copyr and watch it work the pipeline end to end —
              the seeded demo firm responds to agents exactly like production.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------- sharing & security -------------------------- */

function SecuritySection() {
  const controls = [
    "Workspace-level data isolation",
    "Encryption in transit & at rest",
    "Private files behind signed URLs",
    "Audit trail of every change",
    "Scoped, revocable API keys",
    "Export everything — CSV & JSON",
  ];
  return (
    <section id="security" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 md:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <Eyebrow>Sharing & security</Eyebrow>
          <h2 className="mt-3 font-serif text-4xl leading-[1.08] tracking-tight text-paper-900 md:text-5xl">
            Share anything.<br />Leak nothing.
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-paper-600">
            Share a single company externally with selective attributes, an optional password and expiry —
            then watch the access log in real time. Underneath, each firm's data lives in an isolated
            workspace with private object storage and a complete audit history.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className={mockShell}>
            <MockCaption>Share link · Nimbus Robotics</MockCaption>
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-2 rounded-lg border border-paper-900/25 bg-paper-50 px-3 py-2.5">
                <IconLink width={14} height={14} className="shrink-0 text-paper-600" />
                <span className="truncate font-mono text-xs font-medium text-paper-900">copyr.dev/s/nimbus-7fk2</span>
                <span className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-700">live</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["Password", "on"], ["Expires", "14 days"], ["Attributes", "6 / 18"]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-paper-900/[0.18] bg-white px-2 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-paper-600">{k}</p>
                    <p className="num mt-0.5 text-[13px] font-bold text-paper-900">{v}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-paper-900/[0.15] bg-paper-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-paper-700">Access log</p>
                <div className="mt-2 space-y-1.5 text-[13px] font-medium text-paper-900">
                  <p className="flex justify-between"><span>Viewed · anonymous</span><span className="num text-paper-600">Tue 09:41 · Berlin</span></p>
                  <p className="flex justify-between"><span>Viewed · anonymous</span><span className="num text-paper-600">Mon 17:02 · London</span></p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
      <Reveal delay={160}>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {controls.map((c) => (
            <div key={c} className="flex items-center gap-2.5 rounded-lg border border-paper-900/[0.14] bg-white px-4 py-3.5 text-sm font-medium text-paper-800">
              <IconCheck width={15} height={15} strokeWidth={2.4} className="shrink-0 text-emerald-600" />
              {c}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------------------------- quotes --------------------------------- */

function Quotes() {
  const quotes: Array<[string, string, string]> = [
    [
      "We pointed our deal email at Copyr on a Friday. By Monday the entire pipeline existed — nobody typed a single field.",
      "General Partner",
      "$40M early-stage fund",
    ],
    [
      "The MCP server is the unlock. Our Monday pipeline review is drafted by an agent before coffee.",
      "Principal",
      "Multi-stage fund",
    ],
  ];
  return (
    <section className="border-y border-paper-900/[0.08] bg-white/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
        <div className="grid gap-14 md:grid-cols-2 md:gap-10">
          {quotes.map(([quote, role, org], i) => (
            <Reveal key={role} delay={i * 120}>
              <blockquote className="flex h-full flex-col border-l-2 border-paper-900/15 pl-6">
                <p className="font-serif text-2xl leading-snug tracking-tight text-paper-900">“{quote}”</p>
                <footer className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-paper-500">
                  {role} · {org}
                </footer>
              </blockquote>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------- pricing -------------------------------- */

function Pricing() {
  const plans = [
    {
      name: "Monthly",
      price: "$50",
      per: "per user / month",
      features: [
        "Unlimited deal ingestion",
        "500 AI credits / user / month",
        "Email forwarding & automation",
        "Link conversion (DocSend, Pitch…)",
        "Custom fields & stages",
        "Team collaboration",
      ],
      cta: "Get started",
      highlight: false,
    },
    {
      name: "Yearly",
      price: "$500",
      per: "per user / year · save 16%",
      features: [
        "Everything in Monthly",
        "Two months free",
        "Priority support access",
        "Early access to new features",
        "Onboarding session",
      ],
      cta: "Get started",
      highlight: true,
    },
    {
      name: "Custom",
      price: "Talk to us",
      per: "firms of 15+ users",
      features: ["Bulk discounts", "SSO & audit hooks", "Custom onboarding", "Dedicated support"],
      cta: "Contact sales",
      highlight: false,
    },
  ];
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 md:py-28">
      <Reveal className="text-center">
        <Eyebrow>Pricing</Eyebrow>
        <h2 className="mx-auto mt-3 max-w-xl font-serif text-4xl leading-[1.08] tracking-tight text-paper-900 md:text-5xl">
          Simple, flexible plans
        </h2>
        <p className="mt-4 text-[15px] text-paper-600">All plans include a 30-day free trial.</p>
      </Reveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {plans.map((plan, i) => (
          <Reveal key={plan.name} delay={i * 90}>
            <div
              className={
                plan.highlight
                  ? "flex h-full flex-col rounded-2xl bg-paper-900 p-8 text-paper-50"
                  : "flex h-full flex-col rounded-2xl border border-paper-900/10 bg-white/60 p-8 transition hover:border-paper-900/25"
              }
            >
              <div className="flex items-center justify-between">
                <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${plan.highlight ? "text-paper-400" : "text-paper-500"}`}>
                  {plan.name}
                </p>
                {plan.highlight && (
                  <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-paper-100">
                    Best value
                  </span>
                )}
              </div>
              <p className="num mt-5 font-serif text-5xl tracking-tight">{plan.price}</p>
              <p className={`mt-1.5 text-xs ${plan.highlight ? "text-paper-400" : "text-paper-500"}`}>{plan.per}</p>
              <ul className={`mt-7 flex-1 space-y-2.5 text-sm ${plan.highlight ? "text-paper-200" : "text-paper-700"}`}>
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <IconCheck width={14} height={14} strokeWidth={2.4} className={`mt-0.5 shrink-0 ${plan.highlight ? "text-emerald-400" : "text-emerald-600"}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth/sign-up"
                className={`mt-8 inline-flex h-11 items-center justify-center rounded-lg text-sm font-medium transition ${
                  plan.highlight
                    ? "bg-paper-50 text-paper-900 hover:bg-white"
                    : "border border-paper-900/15 bg-transparent text-paper-900 hover:border-paper-900/30 hover:bg-white"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------ faq ---------------------------------- */

function Faq() {
  const faqs: Array<[string, string]> = [
    ["How does the email integration work?", "Forward pitch emails to your Copyr address (or connect via webhook). Every inbound email is deduped, triaged by AI, and turned into a fully populated deal — attachments included."],
    ["Does it work with DocSend links?", "Yes. Paste any DocSend, Pitch, Google Drive or Canva link and Copyr produces a permanent PDF copy attached to the company record, so the material is yours even after the link expires."],
    ["What can the AI extract?", "Anything you define: sector, geography, team size, ARR, growth, check size, conviction — your custom fields become extraction targets automatically."],
    ["How do AI credits work?", "Every plan includes 500 AI credits per user per month. Extraction, triage, classification and memo generation draw down the balance; top-ups are available pay-as-you-go."],
    ["Can AI agents operate my CRM?", "That's the point. Copyr ships with a full MCP server — 105 tools covering everything the UI can do and more — so Claude, GPT or your own agents can run triage, updates, diligence vaults and reviews."],
    ["Is my data secure?", "Each firm's data lives in an isolated workspace. Files are stored privately behind signed URLs, every change is audited, and you can export everything at any time."],
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20 border-t border-paper-900/[0.08]">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 md:py-28">
        <Reveal className="text-center">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-3 font-serif text-4xl leading-[1.08] tracking-tight text-paper-900 md:text-5xl">
            Frequently asked questions
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-12 border-t border-paper-900/10">
            {faqs.map(([q, a], i) => (
              <div key={q} className="border-b border-paper-900/10">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left text-[15px] font-medium text-paper-900 transition hover:text-brand-700"
                >
                  {q}
                  <span className={`num shrink-0 font-serif text-xl text-paper-400 transition-transform duration-200 ${open === i ? "rotate-45" : ""}`}>
                    +
                  </span>
                </button>
                {open === i && (
                  <p className="animate-fade-in -mt-1 pb-5 pr-10 text-sm leading-relaxed text-paper-600">{a}</p>
                )}
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------- final CTA ------------------------------- */

function FinalCta() {
  return (
    <section className="border-t border-paper-900/[0.08]">
      <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 md:py-32">
        <Reveal>
          <h2 className="font-serif text-5xl leading-[1.05] tracking-tight text-paper-900 md:text-6xl">
            Bring order to your <em className="italic text-brand-700">deal flow.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-paper-600">
            Connect your inbox and forward your first pitch — the demo workspace shows the entire
            flow in under five minutes.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth/sign-up" className={btnDark}>Start free trial</Link>
            <Link to="/app" className={btnGhost}>Open live demo →</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------- footer --------------------------------- */

function Footer() {
  const cols: Array<[string, Array<[string, string]>]> = [
    ["Resources", [["Blog", "/blog"], ["Changelog", "/changelog"]]],
    ["Company", [["About", "/about"], ["Pricing", "#pricing"], ["Contact", "mailto:support@copyr.dev"]]],
    ["Legal", [["Privacy policy", "/privacy-policy"], ["Terms of service", "/terms-of-service"], ["Cookie policy", "/cookie-policy"]]],
  ];
  return (
    <footer className="border-t border-paper-900/[0.08] bg-white/40">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-paper-500">
              The AI-native deal flow CRM for venture capital.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-4">
            {cols.map(([heading, links]) => (
              <div key={heading}>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper-500">{heading}</p>
                <ul className="space-y-2">
                  {links.map(([label, href]) => {
                    const cls = "text-paper-600 transition hover:text-paper-900";
                    return (
                      <li key={label}>
                        {href.startsWith("/") ? (
                          <Link to={href} className={cls}>{label}</Link>
                        ) : (
                          <a href={href} className={cls}>{label}</a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper-500">For agents</p>
              <ul className="space-y-2 text-paper-600">
                <li><code className="rounded-md border border-paper-900/10 bg-white px-1.5 py-0.5 font-mono text-xs">mcp://copyr</code></li>
                <li><Link to="/app/settings" className="transition hover:text-paper-900">API keys</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-12 border-t border-paper-900/[0.08] pt-6 text-xs text-paper-400">
          © 2026 Copyr. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/* ----------------------------------- page ---------------------------------- */

export default function Landing() {
  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      document.documentElement.style.scrollBehavior = "";
    };
  }, []);
  return (
    <div className="min-h-screen bg-paper-100 text-paper-800 antialiased">
      <Nav />
      <main>
        <Hero />
        <ChipMarquee />
        <StatsBand />
        <Platform />
        <HowItWorks />
        <Features />
        <AgentsSection />
        <SecuritySection />
        <Quotes />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
