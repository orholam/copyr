import { useEffect, useState } from "react";
import { NavLink, useOutlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cx, Avatar } from "../../components/ui";
import { ThemeToggle, useTheme } from "../../lib/theme";
import {
  IconGrid,
  IconPipeline,
  IconInbox,
  IconFolder,
  IconChart,
  IconSettings,
  IconSearch,
  IconPlus,
  IconSpark,
  IconDoc,
  IconBot,
  IconLayers,
} from "../../components/icons";
import { CommandPalette, type SearchFilter } from "../../components/CommandPalette";
import { useRealtime } from "../../lib/sse";
import { api, getWorkspaceSlug, rememberWorkspaceSlug } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import AddCompanyModal from "./AddCompanyModal";

const NAV = [
  {
    section: "Workspace",
    items: [
      { to: "/app", label: "Assistant", icon: IconSpark, exact: true },
      { to: "/app/dashboard", label: "Dashboard", icon: IconGrid },
      { to: "/app/pipeline", label: "Pipeline", icon: IconPipeline },
      { to: "/app/inbox", label: "Inbox", icon: IconInbox },
      { to: "/app/diligence", label: "Diligence", icon: IconDoc },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { to: "/app/portfolio", label: "Portfolio", icon: IconFolder },
      { to: "/app/analytics", label: "Analytics", icon: IconChart },
    ],
  },
  {
    section: "Automation",
    items: [
      { to: "/app/workflows", label: "Workflows", icon: IconLayers },
      { to: "/app/automations", label: "Agents", icon: IconBot },
      { to: "/app/command-center", label: "Command Center", icon: IconChart },
    ],
  },
];

interface Me {
  workspace: { id: string; name: string; slug: string; plan: string; aiCreditsBalance: number; members: Array<{ id: string; name: string; title?: string | null; role: string }> };
  actor: { userId: string | null; source: string };
}

export default function AppShell() {
  const outlet = useOutlet();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const isAssistantRoute = location.pathname === "/app";
  const isWorkflowsRoute = location.pathname === "/app/workflows";
  const isFullBleed = isAssistantRoute || isWorkflowsRoute;
  const [showAdd, setShowAdd] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteFilter, setPaletteFilter] = useState<SearchFilter>("all");
  const { dark, toggle } = useTheme();

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/me"),
    staleTime: 2 * 60_000,
  });
  const ws = meQ.data?.workspace;
  const self = ws?.members.find((m) => m.id === meQ.data?.actor.userId);
  const owner = ws?.members.find((m) => m.role === "owner");
  const credits = ws?.aiCreditsBalance ?? 0;
  const creditPct = Math.max(3, Math.min(100, Math.round((credits / 500) * 100)));
  const display = self ?? owner;
  const liveSlug = getWorkspaceSlug() ?? ws?.slug;

  useRealtime(liveSlug ?? "");

  useEffect(() => {
    if (ws?.slug) rememberWorkspaceSlug(ws.slug);
  }, [ws?.slug]);

  // Warm the board cache so Pipeline doesn't cold-start every visit.
  useEffect(() => {
    if (!ws?.id) return;
    void qc.prefetchQuery({
      queryKey: ["pipelines"],
      queryFn: () => api.get("/pipelines"),
      staleTime: 5 * 60_000,
    });
    void qc.prefetchQuery({
      queryKey: ["deals", "", null],
      queryFn: () => api.get("/deals?limit=500&archived=false"),
      staleTime: 60_000,
    });
  }, [ws?.id, qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteFilter("all");
        setShowPalette((s) => !s);
      }
    };
    const onAdd = () => setShowAdd(true);
    const onSearch = (e: Event) => {
      const filter = (e as CustomEvent<{ filter?: SearchFilter }>).detail?.filter;
      setPaletteFilter(filter ?? "all");
      setShowPalette(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("copyr:add-company", onAdd);
    window.addEventListener("copyr:search", onSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copyr:add-company", onAdd);
      window.removeEventListener("copyr:search", onSearch);
    };
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper-100 text-paper-900">
      <aside className="z-10 flex h-full w-[220px] shrink-0 flex-col border-r border-paper-900/[0.08] bg-white">
        <div className="flex items-center gap-2.5 px-3 py-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper-900 font-serif text-base font-semibold leading-none text-paper-50">
            V
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-4 tracking-tight text-paper-900">
              {ws?.name ?? "Workspace"}
            </div>
            <div className="truncate text-[10px] font-medium uppercase tracking-wider leading-[13px] text-paper-400">
              {ws?.plan ?? "workspace"} plan
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowAdd(true)}
          className="btn-ink mx-2.5 mt-1 flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium text-paper-50 active:scale-[0.98]"
        >
          <IconPlus width={14} height={14} /> Add company
        </button>

        <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-paper-400">
                {group.section}
              </p>
              <div className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    className={({ isActive }) =>
                      cx(
                        "group flex h-[28px] items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors",
                        isActive
                          ? "bg-paper-900/[0.06] text-paper-900"
                          : "text-paper-600 hover:bg-paper-900/[0.04] hover:text-paper-900",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden
                          className={cx(
                            "absolute -left-2.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-paper-900 transition-opacity duration-200",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <item.icon
                          width={15}
                          height={15}
                          className={
                            isActive
                              ? "text-paper-900"
                              : "text-paper-400 transition-colors duration-150 group-hover:text-paper-600"
                          }
                        />
                        <span className="truncate">{item.label}</span>
                        {item.label === "Inbox" && <InboxBadge />}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-2.5 border-t border-paper-900/[0.07] p-2.5">
          <NavLink
            to="/app/settings"
            className={({ isActive }) =>
              cx(
                "flex h-[28px] items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors",
                location.pathname === "/app/settings" || isActive
                  ? "bg-paper-900/[0.06] text-paper-900"
                  : "text-paper-600 hover:bg-paper-900/[0.04] hover:text-paper-900",
              )
            }
          >
            <IconSettings width={15} height={15} className="text-paper-400" />
            Settings
          </NavLink>

          <div className="rounded-lg border border-paper-900/[0.09] bg-paper-50 p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 font-medium text-paper-600">
                <IconSpark width={11} height={11} className="text-brand-600" /> AI credits
              </span>
              <span className="num font-semibold text-paper-900">{credits.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-900/[0.08]">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-700"
                style={{ width: `${creditPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
            <Avatar name={display?.name ?? user?.email ?? "You"} size={24} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium leading-4 text-paper-900">
                {display?.name ?? user?.email ?? "—"}
              </p>
              <p className="truncate text-[10px] leading-[13px] text-paper-500">
                {display?.title ?? display?.role ?? "member"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void signOut().then(() => navigate("/auth/sign-in"));
              }}
              className="shrink-0 text-[10px] font-medium text-paper-500 hover:text-paper-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="relative z-0 flex min-w-0 flex-1 flex-col">
        <div className="glass sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-paper-900/[0.08] px-3.5">
          <button
            onClick={() => {
              setPaletteFilter("all");
              setShowPalette(true);
            }}
            className="flex h-7 w-60 items-center gap-2 rounded-md border border-paper-900/[0.13] bg-white px-2.5 text-xs text-paper-400 transition hover:border-paper-900/30 hover:text-paper-600"
          >
            <IconSearch width={12} height={12} />
            <span className="flex-1 text-left">Search…</span>
            <span className="kbd">⌘K</span>
          </button>
          <div className="flex-1" />
          <ThemeToggle dark={dark} onToggle={toggle} />
          {isAssistantRoute && (
            <span className="hidden items-center gap-1.5 text-xs text-paper-500 md:flex">
              <IconSpark width={11} height={11} className="text-brand-600" />
              Assistant
            </span>
          )}
          <span className="hidden items-center gap-1.5 text-xs text-paper-500 md:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
        </div>

        {/* Assistant + Workflows are immersive full-bleed surfaces */}
        {isFullBleed ? (
          <div className="min-h-0 flex-1">{outlet}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1720px] px-5 py-4">{outlet}</div>
          </div>
        )}

      </main>

      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} initialFilter={paletteFilter} />
      {showAdd && <AddCompanyModal onClose={() => setShowAdd(false)} onCreated={() => setShowAdd(false)} />}
    </div>
  );
}

function InboxBadge() {
  const { data } = useQuery({
    queryKey: ["emails", "badge"],
    queryFn: () =>
      api.get<{ total: number }>("/emails?status=queued&limit=1"),
    refetchInterval: 10_000,
  });
  const n = data?.total ?? 0;
  if (!n) return null;
  return (
    <span className="num ml-auto rounded-full bg-brand-50 px-1.5 text-[10.5px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
      {n > 99 ? "99+" : n}
    </span>
  );
}
