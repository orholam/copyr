import { useEffect, useRef, useState } from "react";
import { NavLink, useOutlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

interface OrgOption {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface Me {
  workspace: { id: string; name: string; slug: string; plan: string; aiCreditsBalance: number; members: Array<{ id: string; name: string; title?: string | null; role: string }> };
  actor: { userId: string | null; source: string };
  organizations?: OrgOption[];
}

export default function AppShell() {
  const outlet = useOutlet();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const isAssistantRoute = location.pathname === "/app";
  const isWorkflowsRoute = location.pathname === "/app/workflows";
  const isPipelineRoute = location.pathname === "/app/pipeline";
  const isFullBleed = isAssistantRoute || isWorkflowsRoute || isPipelineRoute;
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
  const organizations = meQ.data?.organizations ?? [];

  const createOrg = useMutation({
    mutationFn: (name: string) => api.post<{ slug: string }>("/organizations", { name }),
    onSuccess: async (created) => {
      rememberWorkspaceSlug(created.slug);
      await qc.invalidateQueries();
    },
  });

  function switchOrg(slug: string) {
    if (!slug || slug === ws?.slug) return;
    rememberWorkspaceSlug(slug);
    void qc.invalidateQueries();
  }

  useRealtime(liveSlug ?? "");

  useEffect(() => {
    if (ws?.slug) rememberWorkspaceSlug(ws.slug);
  }, [ws?.slug]);

  // Warm the pipeline after the assistant history, and only warm companies
  // once the browser is idle. Doing it immediately floods the API and makes
  // coming back to a conversation wait behind dozens of company requests.
  useEffect(() => {
    if (!ws?.id) return;
    let cancelled = false;
    let idleId = 0;
    let timer = 0;
    void qc.prefetchQuery({
      queryKey: ["conversations"],
      queryFn: () => api.get("/assistant/conversations"),
      staleTime: 5 * 60_000,
    });
    const warmCompanies = () => {
      if (cancelled) return;
      void (async () => {
        await qc.prefetchQuery({
          queryKey: ["pipelines"],
          queryFn: () => api.get("/pipelines"),
          staleTime: 5 * 60_000,
        });
        const deals = await qc.fetchQuery({
          queryKey: ["deals", "", null],
          queryFn: () => api.get<{ items: Array<{ id: string; companyId?: string }> }>("/deals?limit=500&archived=false"),
          staleTime: 60_000,
        });
        const ids = [...new Set((deals.items ?? []).map((d) => d.companyId || d.id))];
        let cursor = 0;
        const warm = async () => {
          while (!cancelled && cursor < ids.length) {
            const id = ids[cursor++];
            if (!id) return;
            await Promise.all([
              qc.prefetchQuery({
                queryKey: ["company", id],
                queryFn: () => api.get(`/companies/${id}`),
                staleTime: 60_000,
              }),
              qc.prefetchQuery({
                queryKey: ["notes", id],
                queryFn: () => api.get(`/notes?companyId=${id}`),
                staleTime: 60_000,
              }),
              qc.prefetchQuery({
                queryKey: ["activity", id],
                queryFn: () => api.get(`/activity?companyId=${id}&limit=30`),
                staleTime: 60_000,
              }),
              qc.prefetchQuery({
                queryKey: ["documents", id],
                queryFn: () => api.get(`/documents?companyId=${id}`),
                staleTime: 60_000,
              }),
              qc.prefetchQuery({
                queryKey: ["contacts", id],
                queryFn: () => api.get(`/companies/${id}/contacts`),
                staleTime: 60_000,
              }),
            ]);
          }
        };
        await Promise.all(Array.from({ length: 2 }, () => warm()));
      })();
    };
    const start = () => {
      if (cancelled) return;
      warmCompanies();
    };
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(start, { timeout: 4_000 });
    } else {
      timer = window.setTimeout(start, 2_000);
    }
    return () => {
      cancelled = true;
      if (idleId) window.cancelIdleCallback(idleId);
      if (timer) window.clearTimeout(timer);
    };
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
        <OrgSwitcher
          workspaceName={ws?.name ?? "Workspace"}
          plan={ws?.plan ?? "workspace"}
          currentSlug={ws?.slug ?? ""}
          organizations={organizations}
          creating={createOrg.isPending}
          error={createOrg.isError ? (createOrg.error as Error).message : null}
          onSwitch={switchOrg}
          onCreate={(name) => createOrg.mutateAsync(name)}
        />

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
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{outlet}</div>
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

function orgMark(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return letter || "•";
}

function OrgSwitcher({
  workspaceName,
  plan,
  currentSlug,
  organizations,
  creating,
  error,
  onSwitch,
  onCreate,
}: {
  workspaceName: string;
  plan: string;
  currentSlug: string;
  organizations: OrgOption[];
  creating: boolean;
  error: string | null;
  onSwitch: (slug: string) => void;
  onCreate: (name: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setNaming(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const orgs =
    organizations.length > 0
      ? organizations
      : [{ id: "current", name: workspaceName, slug: currentSlug, role: "" }];

  return (
    <div ref={rootRef} className="relative px-2 pt-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-paper-900/[0.04]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper-900 text-[13px] font-semibold leading-none text-paper-50">
          {orgMark(workspaceName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-4 tracking-tight text-paper-900">
            {workspaceName}
          </span>
          <span className="block truncate text-[10px] font-medium uppercase tracking-wider leading-[13px] text-paper-400">
            {plan} plan
          </span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cx("shrink-0 text-paper-400 transition", open && "rotate-180")}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-2 right-2 top-[calc(100%+2px)] z-30 overflow-hidden rounded-lg border border-paper-900/[0.1] bg-paper-50 p-1 shadow-pop"
        >
          <ul className="max-h-56 overflow-y-auto">
            {orgs.map((org) => {
              const current = org.slug === currentSlug;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSwitch(org.slug);
                      setOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left",
                      current ? "bg-paper-900/[0.05]" : "hover:bg-paper-900/[0.04]",
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-paper-200 text-[11px] font-semibold text-paper-800">
                      {orgMark(org.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium leading-4 text-paper-900">{org.name}</span>
                      {org.role && (
                        <span className="block truncate text-[10px] capitalize leading-3 text-paper-500">{org.role}</span>
                      )}
                    </span>
                    {current && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-paper-700" aria-hidden>
                        <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-1 h-px bg-paper-900/[0.08]" />

          {naming ? (
            <form
              className="px-1 pb-1 pt-0.5"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = name.trim();
                if (!trimmed || creating) return;
                void onCreate(trimmed)
                  .then(() => {
                    setName("");
                    setNaming(false);
                    setOpen(false);
                  })
                  .catch(() => undefined);
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Organization name"
                aria-label="Organization name"
                className="h-8 w-full rounded-md border border-paper-900/[0.14] bg-white px-2 text-[13px] text-paper-900 outline-none placeholder:text-paper-400 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/10"
              />
              {error && <p className="mt-1 text-[11px] leading-4 text-red-600">{error}</p>}
              <div className="mt-1.5 flex justify-end gap-1">
                <button
                  type="button"
                  className="h-7 rounded-md px-2 text-[12px] font-medium text-paper-600 hover:bg-paper-900/[0.04] hover:text-paper-900"
                  onClick={() => {
                    setNaming(false);
                    setName("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !name.trim()}
                  className="btn-ink h-7 rounded-md px-2.5 text-[12px] font-medium text-paper-50 disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12.5px] font-medium text-paper-700 hover:bg-paper-900/[0.04]"
              onClick={() => setNaming(true)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-paper-900/25 text-paper-500">
                <IconPlus width={12} height={12} />
              </span>
              New organization
            </button>
          )}
        </div>
      )}
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
