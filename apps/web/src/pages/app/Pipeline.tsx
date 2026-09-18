import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { IconChevronLeft, IconChevronRight, IconFlame, IconPlus, IconSearch } from "../../components/icons";
import { DealDrawer } from "../../components/DealDrawer";

interface Deal {
  id: string;
  companyId: string;
  stageId: string;
  title: string;
  roundStage: string | null;
  askAmount: number | null;
  priority: number;
  tags: string[];
  source: string;
  updatedAt: string;
  company: { id: string; name: string; domain: string | null; sector: string | null };
  fields: Record<string, string | number | boolean | string[] | null>;
}
interface SavedView {
  id: string;
  name: string;
  query: Record<string, string>;
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
  return (
    <>
      <div className="flex items-start gap-2.5">
        <Avatar name={deal.company.name} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-5 text-paper-900">{deal.company.name}</p>
          <p className="mt-0.5 truncate text-xs font-medium leading-4 text-paper-500">
            {deal.company.sector ?? deal.title}
          </p>
        </div>
        {deal.priority >= 4 && <IconFlame width={13} height={13} className="mt-1 shrink-0 text-orange-600" />}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 pl-[42px]">
        <div className="flex min-w-0 items-center gap-1.5">
          {deal.roundStage && <Badge tone="indigo">{deal.roundStage}</Badge>}
        </div>
        {deal.askAmount !== null && (
          <span className="num shrink-0 text-[13px] font-bold tracking-tight text-paper-900">{money(deal.askAmount)}</span>
        )}
      </div>
    </>
  );
}

function BoardCard({
  deal,
  interactive,
  onOpen,
}: {
  deal: Deal;
  interactive?: boolean;
  onOpen: () => void;
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
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cx(
        "relative cursor-pointer touch-none select-none rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(23,22,19,0.05)] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand-500/40",
        interactive !== false && !isDragging && "hover:-translate-y-px hover:shadow-[0_10px_24px_-10px_rgba(23,22,19,0.22)]",
        isDragging ? "opacity-40 saturate-50" : "opacity-100",
      )}
    >
      {isOver && (
        <span aria-hidden className="absolute inset-x-1 -top-[4px] h-[2px] rounded-full bg-brand-500" />
      )}
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
        "flex w-[288px] shrink-0 flex-col rounded-2xl p-2 transition-colors duration-150",
        active ? "bg-brand-500/[0.05] ring-1 ring-inset ring-brand-500/25" : "bg-paper-900/[0.04]",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 px-2 pb-2 pt-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.color }} />
          <span className="truncate text-[11px] font-bold uppercase tracking-[0.08em] text-paper-700">{stage.name}</span>
          <span className="num shrink-0 text-[11px] font-semibold text-paper-400">{deals.length}</span>
        </span>
        {total > 0 && (
          <span className="num shrink-0 text-[11.5px] font-semibold tabular-nums text-paper-500">{money(total)}</span>
        )}
      </div>
      <div data-vscroll className="min-h-[120px] flex-1 space-y-1.5 overflow-y-auto px-0.5">
        {children}
        {!deals.length && (
          <p className="px-3 pb-6 pt-6 text-center font-serif text-[13px] italic text-paper-400">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}

export default function Pipeline() {
  const [view, setView] = useState<"board" | "table">("board");
  const [q, setQ] = useState("");
  const [, setParams] = useSearchParams();
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [overStageId, setOverStageId] = useState<string | null>(null);
  const lastDrag = useRef(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const openDeal = (id: string) => {
    if (Date.now() - lastDrag.current < 250) return;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("deal", id);
        return p;
      },
      { preventScrollReset: true },
    );
  };

  const pipelinesQ = useQuery({ queryKey: ["pipelines"], queryFn: () => api.get<Pipeline[]>("/pipelines") });
  const pipeline = pipelinesQ.data?.find((p) => p.isDefault) ?? pipelinesQ.data?.[0];

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const viewsQ = useQuery({
    queryKey: ["saved-views"],
    queryFn: () => api.get<SavedView[]>("/views"),
  });
  const saveView = useMutation({
    mutationFn: (name: string) =>
      api.post("/views", { name, query: { ...(q ? { q } : {}), ...(tagFilter ? { tags: tagFilter } : {}) } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["saved-views"] }),
  });
  const deleteView = useMutation({
    mutationFn: (vid: string) => api.delete(`/views/${vid}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["saved-views"] }),
  });
  const dealsQ = useQuery({
    queryKey: ["deals", q, tagFilter],
    queryFn: () =>
      api.get<{ items: Deal[]; total: number }>(
        `/deals?limit=500&archived=false` +
          `${q ? `&q=${encodeURIComponent(q)}` : ""}` +
          `${tagFilter ? `&tags=${encodeURIComponent(tagFilter)}` : ""}`,
      ),
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

  // Optimistically apply the move to the deals cache so the card lands instantly;
  // rolled back if the server rejects the move.
  const move = useMutation({
    mutationFn: (input: { id: string; stageId: string; beforeDealId?: string | null }) =>
      api.post(`/deals/${input.id}/move`, { stageId: input.stageId, beforeDealId: input.beforeDealId ?? null }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const key = ["deals", q];
      const prev = qc.getQueryData<{ items: Deal[]; total: number }>(key);
      if (prev) {
        qc.setQueryData(key, { ...prev, items: reorderDeals(prev.items, input) });
        return { prev };
      }
      return undefined;
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(["deals", q], ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["deals"] }),
  });

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
    clearDrag();
    const overId = e.over?.id == null ? null : String(e.over.id);
    if (!overId || overId === e.active.id) return;

    const active = dealsQ.data?.items.find((d) => d.id === e.active.id);
    if (!active) return;

    if (stageIds.has(overId)) {
      if (overId !== active.stageId)
        move.mutate({ id: active.id, stageId: overId });
      return;
    }
    const target = dealsQ.data?.items.find((d) => d.id === overId);
    if (target)
      move.mutate({ id: active.id, stageId: target.stageId, beforeDealId: target.id });
  };

  const onDragCancel = (_e: DragCancelEvent) => {
    lastDrag.current = Date.now();
    clearDrag();
  };

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const s of pipeline?.stages ?? []) map.set(s.id, []);
    for (const d of dealsQ.data?.items ?? []) map.get(d.stageId)?.push(d);
    return map;
  }, [dealsQ.data, pipeline]);

  const loading = pipelinesQ.isLoading || dealsQ.isLoading;

  const updateScrollHints = useCallback(() => {
    const el = boardRef.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    const el = boardRef.current;
    const track = trackRef.current;
    if (!el) return;
    updateScrollHints();
    el.addEventListener("scroll", updateScrollHints, { passive: true });
    const ro = new ResizeObserver(updateScrollHints);
    ro.observe(el);
    if (track) ro.observe(track);
    return () => {
      el.removeEventListener("scroll", updateScrollHints);
      ro.disconnect();
    };
  }, [updateScrollHints, view, loading]);

  // Mouse wheels only emit deltaY — map it to horizontal board scrolling,
  // except while a hovered column list can still scroll vertically on its own.
  const onBoardWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaX !== 0 || !e.deltaY) return; // trackpad / shift+wheel scroll natively
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return;
    const list = (e.target as HTMLElement).closest("[data-vscroll]");
    if (list && list.scrollHeight > list.clientHeight) {
      const atTop = list.scrollTop <= 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
    }
    el.scrollLeft += e.deltaY;
  };

  const nudgeBoard = (dir: -1 | 1) => {
    const el = boardRef.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.7), behavior: "smooth" });
  };

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
    <div className="-mx-6 -my-5 flex h-[calc(100dvh-76px)] animate-fade-up flex-col px-6 pb-4 pt-5">
      <PageHeader
        title="Pipeline"
        subtitle={
          pipeline
            ? `${pipeline.name} · ${(dealsQ.data?.items.length ?? 0)} active deals`
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
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
              <a
                href={`/api/v1/export/deals?format=csv`}
                className="flex h-8 items-center rounded-md border border-paper-900/[0.14] bg-white px-2.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
                title="Export all deals to CSV"
              >
                ⬇ CSV
              </a>
              <button
                onClick={async () => {
                  const name = window.prompt("Name this view", q || tagFilter || "All deals");
                  if (name?.trim()) saveView.mutate(name.trim());
                }}
                className="flex h-8 items-center rounded-md border border-paper-900/[0.14] bg-white px-2.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
                title="Save current filters as a view"
              >
                ＋ Save view
              </button>
            </label>
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: "Board" },
                { value: "table", label: "Table" },
              ]}
            />
            <Button size="sm" onClick={() => window.dispatchEvent(new Event("copyr:add-company"))}>
              <IconPlus width={13} height={13} /> New deal
            </Button>
          </div>
        }
      />

      {(viewsQ.data ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-500">Views:</span>
          {(viewsQ.data ?? []).map((v) => {
            const active = (v.query.q ?? "") === q && (v.query.tags ?? "") === (tagFilter ?? "");
            return (
              <span key={v.id} className={cx(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                active ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-paper-600 hover:border-slate-300",
              )}>
                <button onClick={() => { setQ(v.query.q ?? ""); setTagFilter(v.query.tags ?? null); }}>
                  {v.name}
                </button>
                <button className="text-paper-400 hover:text-red-500" onClick={() => deleteView.mutate(v.id)}>×</button>
              </span>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="min-h-0 flex-1 overflow-hidden pb-1">
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
          <div className="relative min-h-0 flex-1">
            {!activeDeal && canScroll.left && (
              <>
                <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-paper-100 to-transparent" />
                <button
                  type="button"
                  aria-label="Scroll board left"
                  onClick={() => nudgeBoard(-1)}
                  className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-paper-900/[0.09] bg-white text-paper-600 shadow-[0_4px_14px_-6px_rgba(23,22,19,0.25)] transition-colors hover:bg-paper-900/[0.04]"
                >
                  <IconChevronLeft width={15} height={15} />
                </button>
              </>
            )}
            {!activeDeal && canScroll.right && (
              <>
                <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-paper-100 to-transparent" />
                <button
                  type="button"
                  aria-label="Scroll board right"
                  onClick={() => nudgeBoard(1)}
                  className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-paper-900/[0.09] bg-white text-paper-600 shadow-[0_4px_14px_-6px_rgba(23,22,19,0.25)] transition-colors hover:bg-paper-900/[0.04]"
                >
                  <IconChevronRight width={15} height={15} />
                </button>
              </>
            )}
            <div ref={boardRef} onWheel={onBoardWheel} className="h-full overflow-x-auto overflow-y-hidden pb-1">
              <div ref={trackRef} className="flex h-full min-h-0 w-max min-w-full gap-4 pr-1">
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
                        onOpen={() => openDeal(deal.id)}
                      />
                    ))}
                  </Column>
                ))}
              </div>
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
        <div key="table" className="animate-fade-in min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-paper-900/[0.1] bg-paper-100/95 text-[11px] font-bold uppercase tracking-[0.08em] text-paper-500 backdrop-blur">
                <Th>Company</Th>
                <Th>Round</Th>
                <Th>Ask</Th>
                <Th className="hidden md:table-cell">Sector</Th>
                <Th className="hidden lg:table-cell">Tags</Th>
                <Th>Stage</Th>
                <Th className="hidden sm:table-cell">Source</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-900/[0.05]">
              {(dealsQ.data?.items ?? []).map((deal) => {
                const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
                return (
                  <tr
                    key={deal.id}
                    onClick={() => openDeal(deal.id)}
                    className="cursor-pointer transition-colors hover:bg-paper-900/[0.025]"
                  >
                    <td className="max-w-[280px] px-3 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={deal.company.name} size={28} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-5 text-paper-900">{deal.company.name}</p>
                          {deal.company.domain && <p className="truncate text-xs font-medium leading-4 text-paper-400">{deal.company.domain}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] font-medium text-paper-600">{deal.roundStage ?? "—"}</td>
                    <td className="num whitespace-nowrap px-3 py-3 text-sm font-bold text-paper-900">{money(deal.askAmount)}</td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      {typeof deal.fields["sector"] === "string"
                        ? <Badge tone="indigo">{String(deal.fields["sector"])}</Badge>
                        : <span className="text-paper-400">—</span>}
                    </td>
                    <td className="hidden px-3 py-3 lg:table-cell">
                      {(deal.tags ?? []).length ? (
                        <span className="flex flex-wrap gap-1">
                          {deal.tags.map((t) => (
                            <button key={t} onClick={() => setTagFilter(t)} className="rounded-full bg-paper-200/70 px-1.5 py-0.5 text-[10px] font-medium text-paper-600 transition hover:bg-brand-100 hover:text-brand-700">#{t}</button>
                          ))}
                        </span>
                      ) : <span className="text-paper-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {stage && (
                        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-paper-700">
                          <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
                          {stage.name}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell"><SourceTag source={deal.source} /></td>
                    <td className="num whitespace-nowrap px-3 py-3 text-xs font-medium text-paper-400">{timeAgo(deal.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DealDrawer />
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cx("whitespace-nowrap px-3 py-2.5", className)}>
      {children}
    </th>
  );
}
