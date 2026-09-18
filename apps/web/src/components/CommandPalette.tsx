import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Avatar, cx } from "./ui";

interface SearchResults {
  companies: Array<{ id: string; name: string; sector: string | null; status: string }>;
  deals: Array<{ id: string; title: string; companyId: string; companyName: string; stageName: string | null }>;
  conversations?: Array<{ id: string; title: string; lastMessageAt: string }>;
}

export type SearchFilter = "all" | "companies" | "deals" | "conversations";

const FILTERS: Array<{ key: SearchFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "companies", label: "Companies" },
  { key: "deals", label: "Deals" },
  { key: "conversations", label: "Conversations" },
];

export function CommandPalette({
  open,
  onClose,
  initialFilter = "all",
}: {
  open: boolean;
  onClose: () => void;
  initialFilter?: SearchFilter;
}) {
  const nav = useNavigate();
  const [filter, setFilter] = useState<SearchFilter>(initialFilter);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setFilter(initialFilter);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, initialFilter]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length > 0,
    staleTime: 5_000,
  });

  /** Recent threads — shown immediately when the Conversations pill is active. */
  const recentThreadsQ = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<Array<{ id: string; title: string; lastMessageAt: string }>>("/assistant/conversations"),
    enabled: open && filter === "conversations",
    staleTime: 10_000,
  });

  const items = useMemo(() => {
    type Item = { key: string; group: string; label: string; hint?: string; run: () => void };
    const out: Item[] = [];
    if (!q.trim()) {
      const dests: Array<[string, string]> = [
        ["Dashboard", "/app"],
        ["Pipeline", "/app/pipeline"],
        ["Inbox", "/app/inbox"],
        ["Portfolio", "/app/portfolio"],
        ["Analytics", "/app/analytics"],
        ["Settings", "/app/settings"],
      ];
      if (filter === "all")
        for (const [label, to] of dests)
          out.push({ key: `go-${to}`, group: "Navigate", label, run: () => nav(to) });
      if (filter === "all" || filter === "conversations")
        for (const c of recentThreadsQ.data ?? [])
          out.push({
            key: `conv-${c.id}`,
            group: "Conversations",
            label: c.title,
            run: () => nav(`/app?c=${c.id}`),
          });
      return out;
    }
    if (filter === "all" || filter === "companies")
      for (const c of data?.companies ?? [])
        out.push({
          key: `c-${c.id}`,
          group: "Companies",
          label: c.name,
          hint: [c.sector, c.status].filter(Boolean).join(" · "),
          run: () => nav(`/app/companies/${c.id}`),
        });
    if (filter === "all" || filter === "deals")
      for (const d of data?.deals ?? [])
        out.push({
          key: `d-${d.id}`,
          group: "Deals",
          label: d.companyName,
          hint: [d.title !== d.companyName ? d.title : null, d.stageName]
            .filter(Boolean)
            .join(" · "),
          run: () => nav(`/app/pipeline?deal=${d.id}`),
        });
    if (filter === "all" || filter === "conversations")
      for (const c of data?.conversations ?? [])
        out.push({
          key: `conv-${c.id}`,
          group: "Conversations",
          label: c.title,
          run: () => nav(`/app?c=${c.id}`),
        });
    return out;
  }, [data, recentThreadsQ.data, q, filter, nav]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const it of items) {
      if (!m.has(it.group)) m.set(it.group, []);
      m.get(it.group)!.push(it);
    }
    return [...m.entries()];
  }, [items]);
  const flat = grouped.flatMap(([, arr]) => arr);

  useEffect(() => setCursor(0), [q, filter]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      flat[cursor]?.run();
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let idx = -1;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-paper-900/25 p-4 pt-[13vh] backdrop-blur-[2px] dark:bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="animate-fade-up w-full max-w-[560px] overflow-hidden rounded-xl border border-paper-900/[0.11] bg-white shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-paper-900/[0.09] px-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-paper-600">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              filter === "conversations"
                ? "Search conversations…"
                : "Search companies, deals, or jump anywhere…"
            }
            className="h-11 flex-1 bg-transparent text-[13px] text-paper-900 outline-none placeholder:text-paper-500"
          />
          {isFetching && (
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-paper-900/[0.18] border-t-brand-400" />
          )}
          <span className="kbd">esc</span>
        </div>
        <div className="flex items-center gap-1 border-b border-paper-900/[0.07] px-3 py-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                filter === f.key
                  ? "border-paper-900 bg-paper-900 text-paper-50"
                  : "border-paper-900/[0.14] text-paper-500 hover:border-paper-900/30 hover:text-paper-800",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {!flat.length && (
            <p className="px-3 py-8 text-center text-xs text-paper-500">
              {q || filter !== "conversations" ? "No matches." : "No conversations yet."}
            </p>
          )}
          {grouped.map(([group, arr]) => (
            <div key={group} className="mb-1">
              <p className="px-3 pb-0.5 pt-2 text-[11px] font-medium text-paper-400">
                {group}
              </p>
              {arr.map((it) => {
                idx += 1;
                const active = idx === cursor;
                return (
                  <button
                    key={it.key}
                    onClick={() => {
                      it.run();
                      onClose();
                    }}
                    onMouseEnter={() => setCursor(Math.max(flat.indexOf(it), 0))}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100",
                      active ? "bg-paper-200/70 text-paper-900" : "text-paper-700",
                    )}
                  >
                    {group !== "Navigate" && <Avatar name={it.label} size={20} />}
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && <span className="max-w-[45%] truncate text-xs text-paper-500">{it.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
