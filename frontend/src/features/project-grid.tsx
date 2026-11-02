import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { ProjectCard } from "./common";
import { useWrite } from "@/hooks/queries";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/api";
import { t } from "@/i18n";

interface Drag {
  id: number;
  x: number;
  y: number;
  offX: number;
  offY: number;
  width: number;
  height: number;
}

const move = <T,>(arr: T[], from: number, to: number) => {
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

/**
 * Project cards in a grid that can be reordered by drag and drop (mouse: drag the card;
 * touch/pen: drag the grip; keyboard: focus the grip and use the arrow keys).
 * The order is saved with POST /projects/reorder and is shared by every view.
 */
export function SortableProjectGrid({ projects }: { projects: Project[] }) {
  const serverIds = projects.map((p) => p.id);
  const [local, setLocal] = useState<number[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const save = useWrite((ids: number[]) => api.reorderProjects(ids), { success: "Order saved" });

  // Drop the local override once the server reflects it (or the set of projects changed).
  const serverKey = serverIds.join(",");
  useEffect(() => {
    if (!drag && local && local.join(",") === serverKey) setLocal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const ids = local && local.length === serverIds.length && serverIds.every((i) => local.includes(i)) ? local : serverIds;
  const byId = new Map(projects.map((p) => [p.id, p]));

  const commit = (next: number[]) => {
    if (next.join(",") === serverKey) { setLocal(null); return; }
    setLocal(next);
    save.mutate(next, { onError: () => setLocal(null) });
  };

  const start = (e: ReactPointerEvent<HTMLElement>, id: number, fromHandle: boolean) => {
    if (e.button !== 0) return;
    if (e.pointerType !== "mouse" && !fromHandle) return; // touch scrolls unless the grip is used
    const card = (e.currentTarget.closest("[data-sort-id]") as HTMLElement | null) ?? e.currentTarget;
    const rect = card.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    let active = fromHandle && e.pointerType !== "mouse";
    let order = [...ids];
    const base = { id, offX: sx - rect.left, offY: sy - rect.top, width: rect.width, height: rect.height };
    if (active) { e.preventDefault(); setDrag({ ...base, x: sx, y: sy }); }

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        active = true;
      }
      ev.preventDefault();
      setDrag({ ...base, x: ev.clientX, y: ev.clientY });
      const over = document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-sort-id]");
      const overId = over ? Number(over.dataset.sortId) : null;
      if (overId !== null && overId !== id) {
        order = move(order, order.indexOf(id), order.indexOf(overId));
        setLocal(order);
      }
    };
    const finish = (cancelled: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDrag(null);
      if (!active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (cancelled) setLocal(null);
      else commit(order);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: number) => {
    const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const from = ids.indexOf(id);
    const to = Math.max(0, Math.min(ids.length - 1, from + delta));
    if (to !== from) commit(move(ids, from, to));
  };

  const dragged = drag ? byId.get(drag.id) : undefined;
  return (
    <>
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", drag && "select-none")} data-testid="project-grid">
        {ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <div
              key={id}
              data-sort-id={id}
              onPointerDown={(e) => start(e, id, false)}
              onClickCapture={(e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}
              className={cn("min-w-0 transition-opacity", drag?.id === id && "opacity-35")}
            >
              <ProjectCard
                p={p}
                handle={
                  <button
                    type="button"
                    aria-label={t("Reorder {title}", { title: p.title })}
                    title={t("Drag to reorder (or focus and use the arrow keys)")}
                    onPointerDown={(e) => { e.stopPropagation(); start(e, id, true); }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onKeyDown={(e) => onKey(e, id)}
                    className="-mr-1.5 -mt-0.5 cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 opacity-100 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100"
                  >
                    <GripVertical className="size-4" />
                  </button>
                }
              />
            </div>
          );
        })}
      </div>
      {drag && dragged && (
        <div aria-hidden className="pointer-events-none fixed z-50 rotate-[0.6deg] opacity-95 shadow-[0_12px_32px_rgb(0_0_0/0.18)]"
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width, height: drag.height }}>
          <ProjectCard p={dragged} className="border-primary/50" />
        </div>
      )}
    </>
  );
}
