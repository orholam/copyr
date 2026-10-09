import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api } from "../../lib/api";
import {
  Avatar, Badge, Button, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton, cx, money, timeAgo,
} from "../../components/ui";
import { IconFlame, IconPlus, IconSearch } from "../../components/icons";
interface Participant {
  id: string;
  name: string;
  firm: string | null;
  email: string | null;
  occurredAt: string | null;
}
interface Deal {
  id: string;
  companyId: string;
  stageId: string;
  title: string;
  roundStage: string | null;
  roundLabel: string | null;
  askAmount: number | null;
  firmInvested: boolean | null;
  syndicateStatus: "queued" | "presented" | null;
  submittedAt: string | null;
  submittedBy: Participant | null;
  upvoters: Participant[];
  priority: number;
  tags: string[];
  source: string;
  /** Fractional key. Byte order, not dictionary order: "Zz" is before "a0". */
  position: string;
  updatedAt: string;
  company: { id: string; name: string; domain: string | null; sector: string | null; description?: string | null; logoUrl?: string | null };
  fields: Record<string, string | number | boolean | string[] | null>;
}
interface Stage {
  id: string;
  name: string;
  color: string;
  kind: "active" | "won" | "lost";
  position: number;
}
interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

const SOURCE_TAG: Record<string, [string, string]> = {
  email: ["EML", "border-violet-200 bg-violet-50 text-violet-700"],
  upload: ["PDF", "border-sky-200 bg-sky-50 text-sky-700"],
  link: ["LINK", "border-amber-200 bg-amber-50 text-amber-700"],
  form: ["FORM", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  manual: ["MAN", "border-paper-900/[0.14] bg-transparent text-paper-500"],
  agent: ["AI", "border-brand-200 bg-brand-50 text-brand-700"],
};

/**
 * Stage order, then the fractional key compared as raw bytes.
 * Postgres' default collation sorts "Zz" after "a0", which drops a prepended
 * company into the middle of the table.
 */
function compareDeals(a: Deal, b: Deal, stageIndex: Map<string, number>): number {
  const sa = stageIndex.get(a.stageId) ?? Number.MAX_SAFE_INTEGER;
  const sb = stageIndex.get(b.stageId) ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return 0;
}

/** Server orders deals by stage position, then deal position — splice to match. */
function reorderDeals(
  items: Deal[],
  move: { id: string; stageId: string; beforeDealId?: string | null },
): Deal[] {
  const moving = items.find((d) => d.id === move.id);
  if (!moving) return items;
  const rest = items.filter((d) => d.id !== move.id);
  const moved = { ...moving, stageId: move.stageId };

  let index: number;
  if (move.beforeDealId != null) {
    index = rest.findIndex((d) => d.id === move.beforeDealId);
    if (index === -1) index = rest.length;
  } else {
    index = rest.length;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (rest[i]!.stageId === move.stageId) {
        index = i + 1;
        break;
      }
    }
  }
  const next = [...rest];
  next.splice(index, 0, moved);
  return next;
}

function SourceTag({ source }: { source: string }) {
  const [label, cls] = SOURCE_TAG[source] ?? ["•", "border-paper-900/[0.14] bg-transparent text-paper-500"];
  return (
    <span className={cx("rounded-full border px-2 py-px font-mono text-[10px] font-bold leading-[15px] tracking-wide", cls)}>{label}</span>
  );
}

function CardBody({ deal }: { deal: Deal }) {
  const votes = deal.upvoters?.length ?? 0;
  const subtitle = deal.company.domain ?? deal.company.sector ?? null;
  const round = deal.roundLabel || deal.roundStage;
  const ask = deal.askAmount !== null && !deal.roundLabel ? money(deal.askAmount) : null;
  const detail = [
    round,
    deal.syndicateStatus === "presented" ? "Presented" : deal.syndicateStatus === "queued" ? "Queued" : null,
    deal.firmInvested ? "Invested" : null,
    votes > 0 ? `${votes} vote${votes === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div className="flex items-start gap-2.5">
        <Avatar name={deal.company.name} domain={deal.company.domain} logoUrl={deal.company.logoUrl} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-5 text-paper-900">{deal.company.name}</p>
          {subtitle && <p className="mt-0.5 truncate text-xs font-medium leading-4 text-paper-500">{subtitle}</p>}
        </div>
        {deal.priority >= 4 && <IconFlame width={13} height={13} className="mt-1 shrink-0 text-orange-600" />}
      </div>
      {(detail || ask) && (
        <div className="mt-2 flex items-center gap-2 pl-[42px]">
          <p className="min-w-0 flex-1 truncate text-[12px] leading-4 text-paper-600" title={detail}>
            {detail}
          </p>
          {ask && <span className="num shrink-0 text-[13px] font-bold tracking-tight text-paper-900">{ask}</span>}
        </div>
      )}
    </>
  );
}

function BoardCard({
  deal,
  interactive,
  onOpen,
  onDelete,
}: {
  deal: Deal;
  interactive?: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: deal.id, disabled: isDragging });
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      data-deal-card={deal.id}
      data-company-id={deal.companyId}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cx(
        "group relative cursor-pointer touch-none select-none rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(23,22,19,0.05)] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand-500/40",
        interactive !== false && !isDragging && "hover:-translate-y-px hover:shadow-[0_10px_24px_-10px_rgba(23,22,19,0.22)]",
        isDragging ? "invisible" : "opacity-100",
      )}
    >
      {isOver && (
        <span aria-hidden className="absolute inset-x-1 -top-[4px] h-[2px] rounded-full bg-brand-500" />
      )}
      <button
        type="button"
        aria-label={`Delete ${deal.company.name}`}
        title="Delete deal"
        className="absolute right-1.5 top-1.5 hidden h-6 items-center rounded-md px-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 group-hover:inline-flex"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        Delete
      </button>
      <CardBody deal={deal} />
    </div>
  );
}

function Column({
  stage,
  deals,
  active,
  children,
}: {
  stage: Stage;
  deals: Deal[];
  active?: boolean;
  children?: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  const total = deals.reduce((acc, d) => acc + (d.askAmount ?? 0), 0);
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "flex min-h-full w-[288px] shrink-0 flex-col rounded-2xl p-2 transition-colors duration-150",
        active ? "bg-brand-500/[0.05] ring-1 ring-inset ring-brand-500/25" : "bg-paper-900/[0.04]",
      )}
    >
      <div
        className="sticky top-0 z-[1] -mx-2 flex items-baseline justify-between gap-2 px-4 pb-2 pt-1.5"
        style={{
          background: active
            ? "color-mix(in srgb, #5e6ad2 6%, rgb(var(--paper-100)))"
            : "color-mix(in srgb, rgb(var(--paper-900) / 0.04), rgb(var(--paper-100)))",
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.color }} />
          <span className="truncate text-[11px] font-bold uppercase tracking-[0.08em] text-paper-700">{stage.name}</span>
          <span className="num shrink-0 text-[11px] font-semibold text-paper-400">{deals.length}</span>
        </span>
        {total > 0 && (
          <span className="num shrink-0 text-[11.5px] font-semibold tabular-nums text-paper-500">{money(total)}</span>
        )}
      </div>
      <div className="min-h-[120px] space-y-1.5 px-0.5 pb-2">
        {children}
        {!deals.length && (
          <p className="px-3 pb-6 pt-6 text-center font-serif text-[13px] italic text-paper-400">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}

export default function Pipeline() {
  const [view, setView] = useState<"board" | "table">("table");
  const [q, setQ] = useState("");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [overStageId, setOverStageId] = useState<string | null>(null);
  /** Local pending moves — applied immediately on drop so UI never waits on async cache work. */
  const [pendingMoves, setPendingMoves] = useState<
    Record<string, { stageId: string; beforeDealId?: string | null }>
  >({});
  const lastDrag = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const openRecord = (companyId: string) => {
    if (Date.now() - lastDrag.current < 250) return;
    navigate(`/app/companies/${companyId}`);
  };

  useEffect(() => {
    const legacyDeal = params.get("deal");
    if (legacyDeal) navigate(`/app/companies/${legacyDeal}`, { replace: true });
  }, [params, navigate]);

  useEffect(() => {
    const showNewest = () => listRef.current?.scrollTo({ top: 0, left: 0 });
    window.addEventListener("copyr:company-created", showNewest);
    return () => window.removeEventListener("copyr:company-created", showNewest);
  }, []);

  const pipelinesQ = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => api.get<Pipeline[]>("/pipelines"),
    staleTime: 5 * 60_000,
  });
  const pipeline = pipelinesQ.data?.find((p) => p.isDefault) ?? pipelinesQ.data?.[0];

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [syndicate, setSyndicate] = useState<"all" | "queued" | "presented" | "invested">("all");
  const dealsKey = ["deals", q, tagFilter] as const;
  const dealsQ = useQuery({
    queryKey: dealsKey,
    queryFn: () =>
      api.get<{ items: Deal[]; total: number }>(
        `/deals?limit=500&archived=false` +
          `${q ? `&q=${encodeURIComponent(q)}` : ""}` +
          `${tagFilter ? `&tags=${encodeURIComponent(tagFilter)}` : ""}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const stageIds = useMemo(() => new Set((pipeline?.stages ?? []).map((s) => s.id)), [pipeline]);

  // Pointer-based targeting; a hovered deal card wins over its containing column
  // so cards can be dropped into a precise spot instead of always appending.
  const collisionDetection: CollisionDetection = useMemo(() => {
    return (args) => {
      const withinPointer = pointerWithin(args);
      const hits = withinPointer.length > 0 ? withinPointer : rectIntersection(args);
      if (!hits.length) return hits;
      const cardHit = hits.find((h) => !stageIds.has(String(h.id)));
      return [cardHit ?? hits[0]!];
    };
  }, [stageIds]);

  // Optimistically apply the move so the card lands instantly; roll back only if
  // the server rejects. Cache write is synchronous — never await before it.
  const move = useMutation({
    mutationFn: (input: { id: string; stageId: string; beforeDealId?: string | null }) =>
      api.post(`/deals/${input.id}/move`, { stageId: input.stageId, beforeDealId: input.beforeDealId ?? null }),
    onMutate: (input) => {
      const snapshots = qc.getQueriesData<{ items: Deal[]; total: number }>({ queryKey: ["deals"] });
      qc.setQueriesData<{ items: Deal[]; total: number }>({ queryKey: ["deals"] }, (old) => {
        if (!old?.items) return old;
        return { ...old, items: reorderDeals(old.items, input) };
      });
      // Cancel stale refetches after the optimistic write so they can't race ahead of paint.
      void qc.cancelQueries({ queryKey: ["deals"] });
      return { snapshots, id: input.id };
    },
    onError: (_err, _input, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        if (data) qc.setQueryData(key, data);
      }
      if (ctx?.id) {
        setPendingMoves((prev) => {
          const next = { ...prev };
          delete next[ctx.id];
          return next;
        });
      }
    },
    onSuccess: (_data, input) => {
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[input.id];
        return next;
      });
    },
    // Soft reconcile in the background — do not clear optimistic UI.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["deals"] });
      void qc.invalidateQueries({ queryKey: ["deal"] });
    },
  });

  const removeDeal = useMutation({
    mutationFn: (companyId: string) => api.delete(`/companies/${companyId}`),
    onMutate: async (companyId) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const snapshots = qc.getQueriesData<{ items: Deal[]; total: number }>({ queryKey: ["deals"] });
      qc.setQueriesData<{ items: Deal[]; total: number }>({ queryKey: ["deals"] }, (old) => {
        if (!old?.items) return old;
        const items = old.items.filter((d) => d.companyId !== companyId && d.id !== companyId);
        return { ...old, items, total: Math.max(0, old.total - (old.items.length - items.length)) };
      });
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        if (data) qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });

  const patchDeal = useMutation({
    mutationFn: (input: { id: string; patch: DealPatch }) => api.patch(`/deals/${input.id}`, input.patch),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const snapshots = qc.getQueriesData<{ items: Deal[]; total: number }>({ queryKey: ["deals"] });
      qc.setQueriesData<{ items: Deal[]; total: number }>({ queryKey: ["deals"] }, (old) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((d) =>
            d.id === input.id ? { ...d, ...input.patch, updatedAt: new Date().toISOString() } : d,
          ),
        };
      });
      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        if (data) qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["deals"] });
      void qc.invalidateQueries({ queryKey: ["deal"] });
    },
  });

  const askDelete = (deal: Deal) => {
    const ok = window.confirm(`Delete ${deal.company.name}? This removes the company and its deal from the pipeline.`);
    if (ok) removeDeal.mutate(deal.companyId);
  };

  const onDragStart = (e: DragStartEvent) => {
    lastDrag.current = Date.now();
    setActiveDeal(dealsQ.data?.items.find((d) => d.id === e.active.id) ?? null);
  };

  const stageForTarget = (id: string): string | null => {
    if (stageIds.has(id)) return id;
    return dealsQ.data?.items.find((d) => d.id === id)?.stageId ?? null;
  };

  const onDragOver = (e: DragOverEvent) => {
    setOverStageId(e.over ? stageForTarget(String(e.over.id)) : null);
  };

  const clearDrag = () => {
    setActiveDeal(null);
    setOverStageId(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    lastDrag.current = Date.now();
    const overId = e.over?.id == null ? null : String(e.over.id);
    const active = dealsQ.data?.items.find((d) => d.id === e.active.id) ?? activeDeal;

    let nextMove: { id: string; stageId: string; beforeDealId?: string | null } | null = null;
    if (active && overId && overId !== active.id) {
      if (stageIds.has(overId)) {
        if (overId !== active.stageId) nextMove = { id: active.id, stageId: overId };
      } else {
        const target = dealsQ.data?.items.find((d) => d.id === overId);
        if (target) nextMove = { id: active.id, stageId: target.stageId, beforeDealId: target.id };
      }
    }

    // Paint the destination column in the same frame as dropping the overlay.
    if (nextMove) {
      setPendingMoves((prev) => ({ ...prev, [nextMove!.id]: { stageId: nextMove!.stageId, beforeDealId: nextMove!.beforeDealId } }));
      move.mutate(nextMove);
    }
    clearDrag();
  };

  const onDragCancel = (_e: DragCancelEvent) => {
    lastDrag.current = Date.now();
    clearDrag();
  };

  const stageIndex = useMemo(
    () => new Map((pipeline?.stages ?? []).map((s, i) => [s.id, i])),
    [pipeline],
  );

  const boardDeals = useMemo(() => {
    let items = [...(dealsQ.data?.items ?? [])].sort((a, b) => compareDeals(a, b, stageIndex));
    for (const [id, mv] of Object.entries(pendingMoves)) {
      items = reorderDeals(items, { id, stageId: mv.stageId, beforeDealId: mv.beforeDealId });
    }
    if (syndicate === "invested") items = items.filter((d) => d.firmInvested === true);
    else if (syndicate !== "all") items = items.filter((d) => d.syndicateStatus === syndicate);
    return items;
  }, [dealsQ.data, pendingMoves, syndicate, stageIndex]);

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const s of pipeline?.stages ?? []) map.set(s.id, []);
    for (const d of boardDeals) map.get(d.stageId)?.push(d);
    return map;
  }, [boardDeals, pipeline]);

  const loading = (pipelinesQ.isLoading && !pipelinesQ.data) || (dealsQ.isLoading && !dealsQ.data);

  if (pipelinesQ.isError || dealsQ.isError) {
    const err = pipelinesQ.error ?? dealsQ.error;
    return (
      <div className="animate-fade-up pt-8">
        <h1 className="mb-5 font-serif text-[21px] font-semibold tracking-tight text-paper-900">Pipeline</h1>
        <ErrorState error={err} onRetry={() => { void pipelinesQ.refetch(); void dealsQ.refetch(); }} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 animate-fade-up flex-col overflow-hidden px-6 py-5">
      <PageHeader
        title="Pipeline"
        subtitle={
          pipeline
            ? `${pipeline.name} · ${(dealsQ.data?.items.length ?? 0)} active deals`
            : undefined
        }
        actions={
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            <label className="relative">
              <IconSearch width={13} height={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter deals…"
                className="h-8 w-52 rounded-md border border-paper-900/[0.14] bg-white pl-8 pr-2.5 text-[13px] text-paper-900 outline-none transition placeholder:text-paper-400 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/10"
              />
              {tagFilter && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="flex h-8 items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 text-xs font-medium text-brand-700"
                >
                  #{tagFilter} ×
                </button>
              )}
            </label>
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "table", label: "Table" },
                { value: "board", label: "Board" },
              ]}
            />
            <Link
              to="/app/workflows"
              className="flex h-8 items-center gap-1.5 rounded-md border border-paper-900/[0.14] bg-white px-2.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
              title="When → if → then rules (screens, stage moves)"
            >
              Workflows
            </Link>
            <Link
              to="/app/automations"
              className="flex h-8 items-center gap-1.5 rounded-md border border-paper-900/[0.14] bg-white px-2.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
              title="Thesis screener and other judgment agents"
            >
              Agents
            </Link>
            <Button size="sm" onClick={() => window.dispatchEvent(new Event("copyr:add-company"))}>
              <IconPlus width={13} height={13} /> New company
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(
          [
            ["all", "All"],
            ["queued", "In queue"],
            ["presented", "Presented"],
            ["invested", "Firm invested"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSyndicate(value)}
            className={cx(
              "h-7 rounded-full border px-2.5 text-[11px] font-semibold transition",
              syndicate === value
                ? "border-paper-900 bg-paper-900 text-white"
                : "border-paper-900/[0.12] bg-white text-paper-600 hover:border-paper-900/30",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div ref={listRef} className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-[288px] shrink-0 space-y-1.5 rounded-2xl bg-paper-900/[0.04] p-2">
                <Skeleton className="mx-2 mb-1 mt-2 h-3 w-24" />
                <Skeleton className="h-[78px] rounded-xl" />
                <Skeleton className="h-[78px] rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      ) : !dealsQ.data?.items.length ? (
        q ? (
          <EmptyState
            icon={<IconSearch width={16} height={16} />}
            title={`No deals match “${q}”`}
            hint="Try a different search, or clear the filter to see the full pipeline."
            action={<Button variant="outline" size="sm" onClick={() => setQ("")}>Clear filter</Button>}
          />
        ) : (
          <EmptyState
            icon={<IconPlus width={16} height={16} />}
            title="No deals yet"
            hint="Add your first company via link, upload or manually — or just forward a pitch email."
            action={<Button size="sm" onClick={() => window.dispatchEvent(new Event("copyr:add-company"))}>Add company</Button>}
          />
        )
      ) : view === "board" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div ref={listRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto">
            <div className="flex min-h-full w-max min-w-full items-stretch gap-4 pb-2">
                {pipeline?.stages.map((stage) => (
                  <Column
                    key={stage.id}
                    stage={stage}
                    deals={byStage.get(stage.id) ?? []}
                    active={overStageId === stage.id}
                  >
                    {(byStage.get(stage.id) ?? []).map((deal) => (
                      <BoardCard
                        key={deal.id}
                        deal={deal}
                        interactive={!activeDeal}
                        onOpen={() => openRecord(deal.companyId)}
                        onDelete={() => askDelete(deal)}
                      />
                    ))}
                  </Column>
                ))}
            </div>
          </div>
          {/* Portal to body: ancestors of the board (e.g. animate-fade-up) keep a
              transform, which would re-base the overlay's fixed positioning and
              offset it from the cursor. Context still flows through the portal. */}
          {createPortal(
            <DragOverlay dropAnimation={null}>
              {activeDeal && (
                <div className="w-[268px] cursor-grabbing rounded-xl bg-white p-3 shadow-[0_12px_32px_-10px_rgba(23,22,19,0.3)] ring-1 ring-paper-900/[0.08]">
                  <CardBody deal={activeDeal} />
                </div>
              )}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      ) : (
        <div ref={listRef} key="table" className="animate-fade-in min-h-0 min-w-0 flex-1 overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="sticky top-0 z-10 bg-paper-100/95 text-[11px] font-bold uppercase tracking-[0.08em] text-paper-500 backdrop-blur">
                <Th>Company</Th>
                <Th>Round</Th>
                <Th>Ask</Th>
                <Th>Syndicate</Th>
                <Th className="hidden md:table-cell">Votes</Th>
                <Th className="hidden lg:table-cell">Submitted by</Th>
                <Th>Stage</Th>
                <Th className="hidden sm:table-cell">Source</Th>
                <Th>Updated</Th>
                <Th><span className="sr-only">Delete</span></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-900/[0.05]">
              {boardDeals.map((deal) => {
                const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
                return (
                  <tr
                    key={deal.id}
                    onClick={() => openRecord(deal.companyId)}
                    className="cursor-pointer transition-colors hover:bg-paper-900/[0.025]"
                  >
                    <td className="max-w-[280px] px-3 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={deal.company.name} domain={deal.company.domain} logoUrl={deal.company.logoUrl} size={28} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-5 text-paper-900">
                            {deal.company.name}
                          </p>
                          {deal.company.domain && <p className="truncate text-xs font-medium leading-4 text-paper-400">{deal.company.domain}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[220px] px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <QuietText
                        value={deal.roundLabel || deal.roundStage || ""}
                        display={
                          <span className="line-clamp-2">{deal.roundLabel || deal.roundStage || "—"}</span>
                        }
                        fill
                        className="text-[13px] font-medium leading-5 text-paper-800"
                        commit={(raw) => {
                          const next = raw.trim() || null;
                          const current = deal.roundLabel || deal.roundStage || null;
                          if (next !== current) patchDeal.mutate({ id: deal.id, patch: { roundLabel: next } });
                        }}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <QuietText
                        value={deal.askAmount == null ? "" : moneyDraft(deal.askAmount)}
                        display={<span className="num text-sm font-bold text-paper-900">{money(deal.askAmount)}</span>}
                        className="num text-sm font-bold text-paper-900"
                        commit={(raw) => {
                          const next = parseMoneyInput(raw);
                          if (next === undefined) return false;
                          if (next !== deal.askAmount) patchDeal.mutate({ id: deal.id, patch: { askAmount: next } });
                        }}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <SyndicateCell
                        deal={deal}
                        onChange={(patch) => patchDeal.mutate({ id: deal.id, patch })}
                      />
                    </td>
                    <td className="num hidden px-3 py-3 text-[13px] font-semibold text-paper-700 md:table-cell">
                      {deal.upvoters?.length ? deal.upvoters.length : "—"}
                    </td>
                    <td className="hidden max-w-[200px] px-3 py-3 lg:table-cell">
                      {deal.submittedBy ? (
                        <span className="block truncate text-[13px] text-paper-700">
                          {deal.submittedBy.name}
                          {deal.submittedBy.firm ? <span className="text-paper-400"> · {deal.submittedBy.firm}</span> : null}
                        </span>
                      ) : (
                        <span className="text-paper-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <StageCell
                        stage={stage}
                        stages={pipeline?.stages ?? []}
                        onChange={(stageId) => {
                          if (stageId !== deal.stageId) patchDeal.mutate({ id: deal.id, patch: { stageId } });
                        }}
                      />
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell"><SourceTag source={deal.source} /></td>
                    <td className="num whitespace-nowrap px-3 py-3 text-xs font-medium text-paper-400">{timeAgo(deal.updatedAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-red-700 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          askDelete(deal);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

type DealPatch = {
  stageId?: string;
  roundLabel?: string | null;
  askAmount?: number | null;
  firmInvested?: boolean | null;
  syndicateStatus?: "queued" | "presented" | null;
};

function moneyDraft(n: number): string {
  const compact = money(n);
  return parseMoneyInput(compact) === n ? compact : `$${n.toLocaleString("en-US")}`;
}

function parseMoneyInput(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t || t === "—" || t === "-" || /^n\/?a$/i.test(t)) return null;
  const m = t.replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] ?? 1 : 1;
  return n * mult;
}

/** Reads as table text. Click reveals a caret in the same type, not a form field. */
function QuietText({
  value,
  display,
  className,
  fill,
  commit,
}: {
  value: string;
  display?: ReactNode;
  className?: string;
  /** Stretch to the cell so wrapped text can clamp. */
  fill?: boolean;
  commit: (raw: string) => boolean | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const finish = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setInvalid(false);
      setDraft(value);
      return;
    }
    const ok = commit(draft);
    if (ok === false) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cx(
          fill ? "block w-full" : "inline-block max-w-full",
          "rounded-sm px-1 py-0.5 -mx-1 text-left outline-none transition-colors hover:bg-paper-900/[0.045] focus-visible:bg-paper-900/[0.045]",
          !display && !value && "text-paper-400",
          className,
        )}
      >
        {display ?? (value || "—")}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-invalid={invalid || undefined}
      placeholder="—"
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelRef.current = true;
          setEditing(false);
        }
      }}
      style={{ width: `${Math.min(36, Math.max(4, draft.length + 1))}ch` }}
      className={cx(
        "max-w-full bg-transparent px-1 py-0.5 -mx-1 font-[inherit] text-inherit outline-none ring-0 placeholder:text-paper-300",
        invalid && "decoration-red-500 underline decoration-1 underline-offset-4",
        className,
      )}
    />
  );
}

function QuietMenu({
  label,
  children,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const width = menuRef.current?.offsetWidth ?? 200;
      const height = menuRef.current?.offsetHeight ?? 180;
      const left = Math.min(r.left, window.innerWidth - width - 8);
      const below = r.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
      setPos({ top, left: Math.max(8, left) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 6, left: r.left });
          setOpen((v) => !v);
        }}
        className="rounded-md px-1 py-0.5 -mx-1 text-left outline-none transition-colors hover:bg-paper-900/[0.045] focus-visible:bg-paper-900/[0.045]"
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0 }}
            className="fixed z-50 max-h-[min(320px,70vh)] min-w-[168px] overflow-auto rounded-lg bg-white p-1 shadow-[0_12px_32px_-12px_rgba(23,22,19,0.35)] ring-1 ring-paper-900/[0.08]"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuRow({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] text-paper-800",
        active ? "bg-paper-100" : "hover:bg-paper-100",
      )}
    >
      <span className="min-w-0">{children}</span>
      {active && <span className="text-[11px] text-paper-400">✓</span>}
    </button>
  );
}

function SyndicateCell({
  deal,
  onChange,
}: {
  deal: Deal;
  onChange: (patch: DealPatch) => void;
}) {
  return (
    <QuietMenu
      label={
        <span className="flex items-center gap-1">
          {deal.syndicateStatus ? (
            <Badge tone={deal.syndicateStatus === "presented" ? "green" : "amber"}>
              {deal.syndicateStatus === "presented" ? "Presented" : "In queue"}
            </Badge>
          ) : (
            <span className="text-[13px] text-paper-400">—</span>
          )}
          {deal.firmInvested && <Badge tone="indigo">Invested</Badge>}
        </span>
      }
    >
      {(close) => (
        <>
          <MenuRow
            active={deal.syndicateStatus === "queued"}
            onClick={() => {
              onChange({ syndicateStatus: "queued" });
              close();
            }}
          >
            In queue
          </MenuRow>
          <MenuRow
            active={deal.syndicateStatus === "presented"}
            onClick={() => {
              onChange({ syndicateStatus: "presented" });
              close();
            }}
          >
            Presented
          </MenuRow>
          <MenuRow
            active={!deal.syndicateStatus}
            onClick={() => {
              onChange({ syndicateStatus: null });
              close();
            }}
          >
            Not marked
          </MenuRow>
          <div className="my-1 h-px bg-paper-900/[0.08]" />
          <MenuRow active={deal.firmInvested === true} onClick={() => onChange({ firmInvested: deal.firmInvested === true ? null : true })}>
            Invested
          </MenuRow>
        </>
      )}
    </QuietMenu>
  );
}

function StageCell({
  stage,
  stages,
  onChange,
}: {
  stage: Stage | undefined;
  stages: Stage[];
  onChange: (stageId: string) => void;
}) {
  return (
    <QuietMenu
      label={
        stage ? (
          <span className="inline-flex items-center gap-2 text-[13px] font-medium text-paper-700">
            <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
            {stage.name}
          </span>
        ) : (
          <span className="text-[13px] text-paper-400">—</span>
        )
      }
    >
      {(close) =>
        stages.map((s) => (
          <MenuRow
            key={s.id}
            active={s.id === stage?.id}
            onClick={() => {
              onChange(s.id);
              close();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          </MenuRow>
        ))
      }
    </QuietMenu>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cx("whitespace-nowrap px-3 py-2.5", className)}>
      {children}
    </th>
  );
}
