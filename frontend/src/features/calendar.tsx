import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, ErrorState, Skeleton } from "@/components/ui/misc";
import { DeadlineList } from "@/features/common";
import { useDeadlines } from "@/hooks/queries";
import { cn, isoDate, todayISO } from "@/lib/utils";
import { locale, t } from "@/i18n";
import type { DeadlineItem } from "@/types/api";

const DOT: Record<string, string> = { submission: "bg-danger", milestone: "bg-primary", task: "bg-muted-foreground/60" };
const PILL: Record<string, string> = {
  submission: "bg-danger/10 text-danger",
  milestone: "bg-primary/10 text-primary",
  task: "bg-muted text-foreground/80",
};

/** Month grid (Monday first) of open deadlines: submissions, milestones and task due dates. */
export function MonthCalendar({ kinds, projectId }: { kinds: string; projectId?: number | null }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);
  const start = isoDate(days[0]);
  const end = isoDate(days[41]);
  const q = useDeadlines({ start, end, kinds, project_id: projectId ?? undefined, limit: 500 });

  const byDay = useMemo(() => {
    const m = new Map<string, DeadlineItem[]>();
    for (const d of q.data ?? []) m.set(d.due_date, [...(m.get(d.due_date) ?? []), d]);
    return m;
  }, [q.data]);

  const today = todayISO();
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale(), { weekday: "short" });
    return days.slice(0, 7).map((d) => fmt.format(d));
  }, [days]);
  const title = month.toLocaleDateString(locale(), { year: "numeric", month: "long" });
  const shift = (n: number) => {
    setSelected(null);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };
  const selectedItems = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <h3 className="text-[14px] font-semibold" aria-live="polite">{title}</h3>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={t("Previous month")} onClick={() => shift(-1)}><ChevronLeft /></Button>
            <Button variant="secondary" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today); }}>{t("Today")}</Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("Next month")} onClick={() => shift(1)}><ChevronRight /></Button>
          </div>
        </div>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <div className="relative">
            {q.isLoading && <Skeleton className="absolute inset-0 z-10 opacity-60" />}
            <div className="grid grid-cols-7 border-b border-border text-center text-[11px] text-muted-foreground">
              {weekdays.map((w) => <div key={w} className="py-1.5">{w}</div>)}
            </div>
            <div className="grid grid-cols-7" role="grid" aria-label={title}>
              {days.map((d) => {
                const iso = isoDate(d);
                const items = byDay.get(iso) ?? [];
                const inMonth = d.getMonth() === month.getMonth();
                const isToday = iso === today;
                return (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    aria-selected={selected === iso}
                    aria-label={`${d.toLocaleDateString(locale(), { month: "long", day: "numeric" })}${items.length ? ` · ${t("{n} item(s)", { n: items.length })}` : ""}`}
                    onClick={() => setSelected(selected === iso ? null : iso)}
                    className={cn(
                      "flex min-h-14 cursor-pointer flex-col gap-1 border-b border-r border-border p-1 text-left align-top transition-colors hover:bg-accent/50 sm:min-h-24 sm:p-1.5 [&:nth-child(7n)]:border-r-0",
                      !inMonth && "bg-muted/30 text-muted-foreground",
                      selected === iso && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    <span className={cn("inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums", isToday && "bg-primary font-semibold text-primary-foreground")}>
                      {d.getDate()}
                    </span>
                    {/* phones: dots; larger screens: titles */}
                    <span className="flex flex-wrap gap-0.5 sm:hidden">
                      {items.slice(0, 6).map((it) => <span key={`${it.kind}-${it.id}`} className={cn("size-1.5 rounded-full", DOT[it.kind])} />)}
                    </span>
                    <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                      {items.slice(0, 3).map((it) => (
                        <span key={`${it.kind}-${it.id}`} title={`${it.title} · ${it.project_title}`} className={cn("truncate rounded px-1 py-px text-[11px] leading-4", PILL[it.kind])}>
                          {it.title}
                        </span>
                      ))}
                      {items.length > 3 && <span className="px-1 text-[11px] text-muted-foreground">{t("+{n} more", { n: items.length - 3 })}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-4 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-danger" /> {t("Submission")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> {t("Milestone")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-muted-foreground/60" /> {t("Task")}</span>
          <span className="ml-auto">{t("Click a day to see its items")}</span>
        </div>
      </Card>
      {selected && (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="text-[13px] font-semibold">{new Date(`${selected}T00:00`).toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" })}</h3>
            <Link to="/tasks" className="text-xs text-primary hover:underline">{t("Tasks")}</Link>
          </div>
          <div className="px-4 py-1">
            {selectedItems.length ? <DeadlineList items={selectedItems} /> : <p className="py-3 text-xs text-muted-foreground">{t("Nothing due on this day")}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
