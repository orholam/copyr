/**
 * Visual workflow builder — dotted board, drag-from-palette + click-to-add,
 * reorderable nodes. Maps onto existing WHEN / IF / THEN model (no schema change).
 *
 * Fixes applied vs original "beyond terrible" version:
 * - Palette chips support click-to-add (drag is optional, not required).
 * - Reorder uses a proper grab handle (larger hit area) + whole-card also draggable
 *   via handle only so inputs remain interactive; sensors handle pointer + touch.
 * - Pointer/Touch/Keyboard sensors with sane activation constraints to avoid
 *   accidental drags while typing/selecting text.
 * - Collision detection uses pointerWithin → rectIntersection and prioritizes
 *   sortable cards so dropping "between" cards inserts there, not always appends.
 * - Palette drops onto an existing card insert at that index; dropping on the
 *   blank canvas or explicit drop zone appends.
 * - DragOverlay is portaled to document.body (ancestors have transforms that
 *   otherwise rebase fixed positioning — same fix as Pipeline.tsx).
 * - Drop zones highlight while dragging a palette item; non-target zones mute.
 * - CSS.Translate (not Transform) to avoid scale artifacts; transitions preserved.
 */
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Spinner, cx } from "../../components/ui";

export interface CondDraft {
  id: string;
  field: string;
  op: string;
  value: string;
}

export interface ActionDraft {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowDraft {
  name: string;
  description: string;
  triggerEvent: string;
  conditions: CondDraft[];
  actions: ActionDraft[];
}

export const TRIGGER_OPTIONS = [
  "deal.created",
  "deal.stage_changed",
  "deal.updated",
  "company.created",
  "company.updated",
  "email.processed",
  "email.needs_review",
  "document.parsed",
  "extraction.completed",
  "note.added",
  "portfolio_update.created",
  "agent_run.completed",
] as const;

export const ACTION_OPTIONS = [
  "add_note",
  "move_deal",
  "set_deal_fields",
  "set_company_fields",
  "create_portfolio_update",
  "run_agent",
] as const;

const OPS = ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "exists"] as const;

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function prettyEvent(t: string): string {
  return t.replace(/_/g, " ");
}

/** Soft dotted plane — used as the entire editor surface. */
export const DOTTED_BG =
  "bg-[radial-gradient(circle,_rgba(23,22,19,0.13)_1px,_transparent_1px)] [background-size:18px_18px] bg-paper-50";

const nodeInput =
  "h-8 rounded-md border border-paper-900/[0.12] bg-white/90 px-2 text-[12.5px] text-paper-900 outline-none transition placeholder:text-paper-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15";

type PaletteKind = "condition" | `action:${string}`;

function PaletteChip({
  id,
  label,
  tone,
  onAdd,
}: {
  id: string;
  label: string;
  tone: "if" | "then";
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${id}` });
  return (
    <div
      ref={setNodeRef}
      {...(attributes as unknown as Record<string, unknown>)}
      {...(listeners as unknown as Record<string, unknown>)}
      className={cx("relative flex", isDragging && "opacity-40")}
      style={{ touchAction: "none" }}
    >
      <button
        type="button"
        onClick={onAdd}
        title="Click to add — or drag into the canvas"
        className={cx(
          "flex w-full items-center justify-between gap-1 rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition active:scale-[0.98]",
          tone === "if"
            ? "bg-amber-500/10 text-amber-900 hover:bg-amber-500/15"
            : "bg-emerald-500/10 text-emerald-900 hover:bg-emerald-500/15",
        )}
      >
        <span>{label}</span>
        <span
          className={cx(
            "shrink-0 cursor-grab rounded px-1 text-[11px] leading-none touch-none select-none active:cursor-grabbing",
            tone === "if" ? "text-amber-700/60" : "text-emerald-700/60",
          )}
          aria-hidden
        >
          ⋮⋮
        </span>
      </button>
    </div>
  );
}

function CanvasDropZone({
  id,
  label,
  active,
  muted,
  onClick,
}: {
  id: string;
  label: string;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const highlighted = isOver || active;
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "flex h-8 items-center justify-center gap-2 rounded-md border border-dashed text-[11px] font-medium transition",
        highlighted
          ? "border-brand-500 bg-brand-500/10 text-brand-800"
          : muted
            ? "border-paper-900/10 bg-white/20 text-paper-300"
            : "border-paper-900/15 bg-white/40 text-paper-400",
      )}
    >
      <span>{label}</span>
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-paper-700 shadow-sm ring-1 ring-paper-900/10 hover:bg-paper-50"
        >
          + Add
        </button>
      )}
    </div>
  );
}

function NodeShell({
  tone,
  title,
  dragHandle,
  onRemove,
  children,
  style,
  setRef,
  attributes,
  listeners,
  isDragging,
  isOver,
}: {
  tone: "when" | "if" | "then";
  title: string;
  dragHandle?: boolean;
  onRemove?: () => void;
  children: ReactNode;
  style?: React.CSSProperties;
  setRef?: (node: HTMLElement | null) => void;
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  isDragging?: boolean;
  isOver?: boolean;
}) {
  const accents = {
    when: "border-l-brand-500",
    if: "border-l-amber-500",
    then: "border-l-emerald-500",
  };
  const chips = {
    when: "text-brand-700",
    if: "text-amber-800",
    then: "text-emerald-800",
  };
  return (
    <div
      ref={setRef}
      style={style}
      className={cx(
        "rounded-lg border border-paper-900/[0.1] border-l-[3px] bg-white/95 p-2.5 shadow-sm backdrop-blur-sm transition",
        accents[tone],
        isDragging && "z-10 opacity-60 shadow-lg ring-2 ring-brand-400/20",
        isOver && "ring-2 ring-brand-400/25",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {dragHandle && (
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-[10px] leading-none text-paper-300 hover:bg-paper-100 hover:text-paper-600 active:cursor-grabbing"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        )}
        <span className={cx("font-mono text-[9px] font-bold uppercase tracking-wider", chips[tone])}>
          {title}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-paper-300 hover:bg-red-50 hover:text-red-600"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SortableCondition({
  cond,
  onChange,
  onRemove,
}: {
  cond: CondDraft;
  onChange: (patch: Partial<CondDraft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: cond.id,
  });
  return (
    <NodeShell
      tone="if"
      title="if"
      dragHandle
      onRemove={onRemove}
      setRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition } as React.CSSProperties}
      attributes={attributes as never}
      listeners={listeners as never}
      isDragging={isDragging}
      isOver={isOver as boolean}
    >
      <div className="flex flex-wrap gap-1.5">
        <input
          className={`${nodeInput} min-w-[9rem] flex-1`}
          placeholder="field e.g. output.recommendation"
          value={cond.field}
          onChange={(e) => onChange({ field: e.target.value })}
        />
        <select
          className={`${nodeInput} w-20`}
          value={cond.op}
          onChange={(e) => onChange({ op: e.target.value })}
        >
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {cond.op !== "exists" && (
          <input
            className={`${nodeInput} w-24`}
            placeholder="value"
            value={cond.value}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        )}
      </div>
    </NodeShell>
  );
}

function SortableAction({
  action,
  onChange,
  onRemove,
}: {
  action: ActionDraft;
  onChange: (patch: Partial<ActionDraft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: action.id,
  });
  const cfg = action.config;
  return (
    <NodeShell
      tone="then"
      title="then"
      dragHandle
      onRemove={onRemove}
      setRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition } as React.CSSProperties}
      attributes={attributes as never}
      listeners={listeners as never}
      isDragging={isDragging}
      isOver={isOver as boolean}
    >
      <div className="flex flex-wrap gap-1.5">
        <select
          className={`${nodeInput} w-40`}
          value={action.type}
          onChange={(e) => onChange({ type: e.target.value, config: {} })}
        >
          {ACTION_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {prettyEvent(t)}
            </option>
          ))}
        </select>
        {action.type === "add_note" && (
          <input
            className={`${nodeInput} min-w-0 flex-1`}
            placeholder="note — {{company.name}} works"
            value={String(cfg.body ?? "")}
            onChange={(e) => onChange({ config: { ...cfg, body: e.target.value } })}
          />
        )}
        {action.type === "move_deal" && (
          <input
            className={`${nodeInput} min-w-0 flex-1`}
            placeholder="stage e.g. Initial Review"
            value={String(cfg.stageName ?? "")}
            onChange={(e) => onChange({ config: { ...cfg, stageName: e.target.value } })}
          />
        )}
        {action.type === "run_agent" && (
          <input
            className={`${nodeInput} min-w-0 flex-1`}
            placeholder="agent e.g. Thesis Screener"
            value={String(cfg.agentName ?? "")}
            onChange={(e) => onChange({ config: { ...cfg, agentName: e.target.value } })}
          />
        )}
        {(action.type === "set_deal_fields" || action.type === "set_company_fields") && (
          <input
            className={`${nodeInput} min-w-0 flex-1`}
            placeholder="key=value, …"
            value={String(cfg.fieldsText ?? "")}
            onChange={(e) => onChange({ config: { ...cfg, fieldsText: e.target.value } })}
          />
        )}
        {action.type === "create_portfolio_update" && (
          <input
            className={`${nodeInput} min-w-0 flex-1`}
            placeholder="title"
            value={String(cfg.title ?? "")}
            onChange={(e) => onChange({ config: { ...cfg, title: e.target.value } })}
          />
        )}
      </div>
    </NodeShell>
  );
}

function Connector() {
  return (
    <div className="flex h-4 justify-center" aria-hidden>
      <svg width="10" height="16" viewBox="0 0 10 16" className="overflow-visible">
        <path
          d="M5 0 v12"
          stroke="rgba(23,22,19,0.22)"
          strokeWidth="1.25"
          strokeDasharray="2.5 2.5"
          fill="none"
        />
        <path d="M2.5 10 L5 14 L7.5 10" fill="rgba(23,22,19,0.28)" />
      </svg>
    </div>
  );
}

export function WorkflowBuilder({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  isEdit,
}: {
  draft: WorkflowDraft;
  onChange: (next: WorkflowDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  isEdit?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activePalette, setActivePalette] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const condIds = useMemo(() => draft.conditions.map((c) => c.id), [draft.conditions]);
  const actionIds = useMemo(() => draft.actions.map((a) => a.id), [draft.actions]);

  const set = (patch: Partial<WorkflowDraft>) => onChange({ ...draft, ...patch });

  const addConditionAt = (index?: number) => {
    const next = { id: uid("cond"), field: "", op: "eq", value: "" };
    if (index == null || index < 0 || index > draft.conditions.length) {
      set({ conditions: [...draft.conditions, next] });
    } else {
      const copy = [...draft.conditions];
      copy.splice(index, 0, next);
      set({ conditions: copy });
    }
  };

  const addActionAt = (type = "add_note", index?: number) => {
    const next = { id: uid("act"), type, config: type === "add_note" ? { body: "" } : {} };
    if (index == null || index < 0 || index > draft.actions.length) {
      set({ actions: [...draft.actions, next] });
    } else {
      const copy = [...draft.actions];
      copy.splice(index, 0, next);
      set({ actions: copy });
    }
  };

  const collisionDetection: CollisionDetection = useMemo(() => {
    return (args) => {
      const pointerHits = pointerWithin(args);
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      if (!hits.length) return [];
      // When dragging a palette item, prefer the sortable card under pointer so
      // we can insert at that position. Otherwise closestCenter via fallback.
      if (pointerHits.length > 0) {
        const sortableHit = hits.find((h) => {
          const id = String(h.id);
          return id.startsWith("cond-") || id.startsWith("act-");
        });
        if (sortableHit) return [sortableHit];
      }
      // Fall back to closestCenter behavior
      return closestCenter(args);
    };
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("palette:")) setActivePalette(id.slice("palette:".length));
    else setActivePalette(null);
  };

  const onDragOver = (e: DragOverEvent) => {
    setOverId(e.over ? String(e.over.id) : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActivePalette(null);
    setOverId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overStr = String(over.id);

    if (activeId.startsWith("palette:")) {
      const kind = activeId.slice("palette:".length) as PaletteKind;
      if (kind === "condition") {
        // Insert before the hovered condition, or append if dropped on canvas/drop zone
        if (overStr.startsWith("cond-")) {
          const idx = condIds.indexOf(overStr);
          addConditionAt(idx >= 0 ? idx : undefined);
        } else if (overStr.startsWith("act-")) {
          // Dropped condition onto action list — still add to conditions (append)
          addConditionAt();
        } else {
          addConditionAt();
        }
      }
      if (kind.startsWith("action:")) {
        const type = kind.slice("action:".length);
        if (overStr.startsWith("act-")) {
          const idx = actionIds.indexOf(overStr);
          addActionAt(type, idx >= 0 ? idx : undefined);
        } else if (overStr.startsWith("cond-")) {
          addActionAt(type);
        } else {
          addActionAt(type);
        }
      }
      return;
    }

    // Sortable reorder — only within same list
    if (condIds.includes(activeId) && condIds.includes(overStr) && activeId !== overStr) {
      set({ conditions: arrayMove(draft.conditions, condIds.indexOf(activeId), condIds.indexOf(overStr)) });
      return;
    }
    if (actionIds.includes(activeId) && actionIds.includes(overStr) && activeId !== overStr) {
      set({ actions: arrayMove(draft.actions, actionIds.indexOf(activeId), actionIds.indexOf(overStr)) });
    }
  };

  const onDragCancel = () => {
    setActivePalette(null);
    setOverId(null);
  };

  const paletteDragging = activePalette != null;
  const paletteIsCondition = activePalette === "condition";
  const paletteIsAction = activePalette != null && activePalette.startsWith("action:");

  const { setNodeRef: setCanvasRef, isOver: canvasOver } = useDroppable({ id: "flow-canvas" });

  const overlayLabel =
    activePalette === "condition"
      ? "Condition"
      : activePalette
        ? prettyEvent(activePalette.replace(/^action:/, ""))
        : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {/* Entire editor = dotted plane. Chrome floats on top. */}
      <div className={cx("relative flex min-h-0 flex-1 flex-col overflow-hidden", DOTTED_BG)}>
        {/* Top chrome */}
        <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-paper-900/[0.06] bg-white/70 px-3 py-2 backdrop-blur-md">
          <input
            className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold tracking-tight text-paper-900 outline-none placeholder:font-medium placeholder:text-paper-400"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Untitled workflow"
          />
          <input
            className="hidden min-w-0 flex-[0.8] bg-transparent text-[12px] text-paper-500 outline-none placeholder:text-paper-400 sm:block"
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Optional description"
          />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!draft.name.trim() || draft.actions.length === 0 || saving}
            onClick={onSave}
          >
            {saving ? <Spinner /> : isEdit ? "Save" : "Create"}
          </Button>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* Palette — sits on the dots, no nested frame */}
          <aside className="relative z-10 flex w-[156px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-paper-900/[0.06] bg-white/55 p-2 backdrop-blur-md">
            <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper-400">
              Drag in <span className="font-normal normal-case tracking-normal text-paper-400/80">· or click</span>
            </p>
            <div className="space-y-1">
              <p className="px-0.5 text-[10px] font-medium text-amber-700/70">If</p>
              <PaletteChip
                id="condition"
                label="Condition"
                tone="if"
                onAdd={() => addConditionAt()}
              />
            </div>
            <div className="space-y-1">
              <p className="px-0.5 text-[10px] font-medium text-emerald-700/70">Then</p>
              {ACTION_OPTIONS.map((t) => (
                <PaletteChip
                  key={t}
                  id={`action:${t}`}
                  label={prettyEvent(t)}
                  tone="then"
                  onAdd={() => addActionAt(t)}
                />
              ))}
            </div>
            <p className="mt-1 px-0.5 text-[10px] leading-tight text-paper-400">
              Tip: click to add instantly; drag to place between steps.
            </p>
          </aside>

          {/* Flow */}
          <div
            ref={setCanvasRef}
            className={cx(
              "relative min-w-0 flex-1 overflow-auto px-4 py-4 transition",
              (canvasOver || paletteDragging) && "bg-brand-500/[0.03]",
            )}
          >
            <div className="mx-auto flex w-full max-w-md flex-col">
              <NodeShell tone="when" title="when">
                <select
                  className={`${nodeInput} w-full capitalize`}
                  value={draft.triggerEvent}
                  onChange={(e) => set({ triggerEvent: e.target.value })}
                >
                  {TRIGGER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {prettyEvent(t)}
                    </option>
                  ))}
                </select>
              </NodeShell>

              <Connector />
              <CanvasDropZone
                id="drop-conditions"
                label={paletteIsAction ? "Conditions — drop action to append below" : "Drop condition here"}
                active={paletteDragging && (paletteIsCondition || overId === "drop-conditions")}
                muted={paletteIsAction}
                onClick={() => addConditionAt()}
              />

              <SortableContext items={condIds} strategy={verticalListSortingStrategy}>
                <div className="mt-2 space-y-0">
                  {draft.conditions.map((c, i) => (
                    <div key={c.id}>
                      {i === 0 && paletteIsCondition && overId === c.id && (
                        <div className="mb-1 h-1 rounded-full bg-brand-500/60" aria-hidden />
                      )}
                      {i > 0 && <Connector />}
                      {i > 0 && paletteIsCondition && overId === c.id && (
                        <div className="mx-2 mb-1 h-1 rounded-full bg-brand-500/60" aria-hidden />
                      )}
                      <SortableCondition
                        cond={c}
                        onChange={(patch) =>
                          set({
                            conditions: draft.conditions.map((x) =>
                              x.id === c.id ? { ...x, ...patch } : x,
                            ),
                          })
                        }
                        onRemove={() =>
                          set({ conditions: draft.conditions.filter((x) => x.id !== c.id) })
                        }
                      />
                    </div>
                  ))}
                </div>
              </SortableContext>

              {draft.conditions.length === 0 && !paletteDragging && (
                <p className="mt-1 text-center text-[10px] text-paper-400">
                  No gates — every matching event runs · click or drag a Condition
                </p>
              )}

              <Connector />
              <CanvasDropZone
                id="drop-actions"
                label={paletteIsCondition ? "Actions — drop condition above" : "Drop action here"}
                active={paletteDragging && (paletteIsAction || overId === "drop-actions")}
                muted={paletteIsCondition}
                onClick={() => addActionAt("add_note")}
              />

              <SortableContext items={actionIds} strategy={verticalListSortingStrategy}>
                <div className="mt-2 space-y-0">
                  {draft.actions.map((a, i) => (
                    <div key={a.id}>
                      {i === 0 && paletteIsAction && overId === a.id && (
                        <div className="mb-1 h-1 rounded-full bg-emerald-500/60" aria-hidden />
                      )}
                      {i > 0 && <Connector />}
                      {i > 0 && paletteIsAction && overId === a.id && (
                        <div className="mx-2 mb-1 h-1 rounded-full bg-emerald-500/60" aria-hidden />
                      )}
                      <SortableAction
                        action={a}
                        onChange={(patch) =>
                          set({
                            actions: draft.actions.map((x) =>
                              x.id === a.id ? { ...x, ...patch } : x,
                            ),
                          })
                        }
                        onRemove={() =>
                          set({ actions: draft.actions.filter((x) => x.id !== a.id) })
                        }
                      />
                    </div>
                  ))}
                </div>
              </SortableContext>

              {draft.actions.length === 0 && (
                <p className="mt-2 text-center text-[11px] text-amber-700">
                  Drop or click at least one action
                </p>
              )}
              <div className="mt-3 flex justify-center gap-2">
                <Button size="xs" variant="outline" onClick={() => addConditionAt()}>
                  + Condition
                </Button>
                <Button size="xs" variant="outline" onClick={() => addActionAt("add_note")}>
                  + Action
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay dropAnimation={null}>
            {overlayLabel ? (
              <div className="rounded-md border border-paper-900/15 bg-white px-2.5 py-1.5 text-xs font-medium shadow-xl">
                {overlayLabel}
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

/** Compact dotted preview for workflow list cards. */
export function WorkflowMiniCanvas({
  triggerEvent,
  conditionCount,
  actionLabels,
}: {
  triggerEvent: string;
  conditionCount: number;
  actionLabels: string[];
}) {
  return (
    <div className={cx("mt-2.5 overflow-hidden rounded-md px-2.5 py-2", DOTTED_BG)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-brand-200/80 bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-brand-800">
          when {prettyEvent(triggerEvent)}
        </span>
        {conditionCount > 0 && (
          <>
            <span className="text-paper-300">→</span>
            <span className="rounded border border-amber-200/80 bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
              if ×{conditionCount}
            </span>
          </>
        )}
        {actionLabels.slice(0, 3).map((label) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="text-paper-300">→</span>
            <span className="rounded border border-emerald-200/80 bg-white/90 px-1.5 py-0.5 text-[11px] font-medium capitalize text-emerald-900">
              {prettyEvent(label)}
            </span>
          </span>
        ))}
        {actionLabels.length > 3 && (
          <span className="text-[11px] text-paper-400">+{actionLabels.length - 3}</span>
        )}
      </div>
    </div>
  );
}
