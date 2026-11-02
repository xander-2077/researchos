// Pure scheduling helpers for the Gantt view (no React, no DOM).
import { isoDate, parseDate } from "@/lib/utils";
import type { Task } from "@/types/api";

export const DAY_MS = 86_400_000;

/** Whole days from a to b (both YYYY-MM-DD), DST-safe. */
export function diffDays(a: string, b: string): number {
  const x = parseDate(a), y = parseDate(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / DAY_MS);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export interface Span {
  /** inclusive first and last day */
  start: string;
  end: string;
  /** false when only one of start/due is known (rendered as a one-day bar) */
  complete: boolean;
}

/** The bar a task occupies, or null when it has no dates at all. */
export function taskSpan(t: Pick<Task, "start_date" | "due_date">): Span | null {
  const { start_date: s, due_date: e } = t;
  if (s && e) return { start: s <= e ? s : e, end: s <= e ? e : s, complete: true };
  if (e) return { start: e, end: e, complete: false };
  if (s) return { start: s, end: s, complete: false };
  return null;
}

/** Finish-to-start: the successor must not begin before the prerequisite's last day. */
export function violatesDependency(pre: Span, succ: Span): boolean {
  return succ.start < pre.end;
}

export function shiftSpan(span: Span, mode: "move" | "start" | "end", delta: number): Span {
  if (mode === "move") return { ...span, start: addDays(span.start, delta), end: addDays(span.end, delta) };
  if (mode === "start") {
    const start = addDays(span.start, delta);
    return { ...span, start: start > span.end ? span.end : start, complete: true };
  }
  const end = addDays(span.end, delta);
  return { ...span, end: end < span.start ? span.start : end, complete: true };
}

export type Zoom = "day" | "week" | "month";
export const PX_PER_DAY: Record<Zoom, number> = { day: 32, week: 14, month: 5 };

export interface Range { start: string; days: number }

/** Visible window: covers every span plus today, with padding, clamped to a sane size. */
export function computeRange(spans: Span[], today: string, extra: string[] = []): Range {
  const all = [today, ...extra, ...spans.flatMap((s) => [s.start, s.end])].sort();
  let lo = addDays(all[0], -7), hi = addDays(all[all.length - 1], 21);
  if (diffDays(lo, today) > 120) lo = addDays(today, -120);
  if (diffDays(today, hi) > 540) hi = addDays(today, 540);
  if (diffDays(lo, hi) < 45) hi = addDays(lo, 45);
  return { start: lo, days: diffDays(lo, hi) + 1 };
}

export function xOf(date: string, range: Range, px: number): number {
  return diffDays(range.start, date) * px;
}
