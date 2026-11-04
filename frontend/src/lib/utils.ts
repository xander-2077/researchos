import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { locale, t } from "@/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const LABELS: Record<string, string> = {
  // stages
  ideation: "Ideation", research_design: "Research Design", implementation: "Implementation",
  experimentation: "Experimentation", analysis: "Analysis", writing: "Writing", submission: "Submission",
  revision: "Revision", completed: "Completed", on_hold: "On Hold",
  // health
  on_track: "On Track", at_risk: "At Risk", blocked: "Blocked",
  // priority
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
  // task / milestone / experiment / run status
  todo: "Todo", in_progress: "In Progress", done: "Done", cancelled: "Cancelled", planned: "Planned",
  running: "Running", analyzing: "Analyzing", needs_review: "Needs Review", verified: "Verified",
  failed: "Failed", unverified: "Unverified", rejected: "Rejected",
  // experiment types
  main: "Main", ablation: "Ablation", baseline: "Baseline", sweep: "Sweep", sanity_check: "Sanity check", other: "Other",
  // sources
  manual: "Manual", claude_code: "Claude Code", codex: "Codex", rest_api: "REST API", mcp: "MCP agent", system: "System",
  // deadline kinds
  milestone: "Milestone", task: "Task", archived: "Archived",
  // activity event types
  progress_note: "Progress note", project_created: "Project created", stage_changed: "Stage changed",
  health_changed: "Health changed", project_updated: "Project updated", project_archived: "Project archived",
  project_restored: "Project restored", task_created: "Task created", task_completed: "Task completed",
  task_updated: "Task updated", task_status_changed: "Task status changed", task_deleted: "Task deleted",
  milestone_created: "Milestone created", milestone_completed: "Milestone completed", milestone_updated: "Milestone updated",
  milestone_status_changed: "Milestone status changed", milestone_deleted: "Milestone deleted",
  experiment_created: "Experiment created", experiment_updated: "Experiment updated",
  experiment_status_changed: "Experiment status changed", experiment_deleted: "Experiment deleted",
  run_recorded: "Run recorded", run_updated: "Run updated", run_verified: "Run verified", run_deleted: "Run deleted",
};

export const label = (v: string | null | undefined) => (v ? t(LABELS[v] ?? v.replace(/_/g, " ")) : "—");

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "slate";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  slate: "bg-muted text-foreground/80 border-border",
  blue: "bg-info/10 text-info border-info/25",
  green: "bg-success/10 text-success border-success/25",
  amber: "bg-warning/12 text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))] border-warning/30",
  red: "bg-danger/10 text-danger border-danger/25",
  violet: "bg-primary/10 text-primary border-primary/25",
};

export const TONES: Record<string, Tone> = {
  on_track: "green", at_risk: "amber", blocked: "red",
  critical: "red", high: "amber", medium: "blue", low: "neutral",
  todo: "neutral", in_progress: "blue", done: "green", cancelled: "neutral",
  planned: "neutral", completed: "green",
  running: "blue", analyzing: "violet", needs_review: "amber", verified: "green", failed: "red",
  unverified: "neutral", rejected: "red",
  ideation: "slate", research_design: "slate", implementation: "blue", experimentation: "violet",
  analysis: "violet", writing: "amber", submission: "amber", revision: "amber", on_hold: "neutral",
  manual: "slate", claude_code: "amber", codex: "green", rest_api: "blue", mcp: "violet", system: "neutral",
  submission_kind: "red",
};

export const tone = (v: string | null | undefined): Tone => (v ? TONES[v] ?? "neutral" : "neutral");

// ------------------------------------------------------------- dates (UTC stored, local display)
const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date (local) as YYYY-MM-DD. */
export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a YYYY-MM-DD as a *local* calendar date. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive timestamp bounds for a browser-local calendar day. */
export function localDayStartISO(day: string): string | undefined {
  return day ? parseDate(day).toISOString() : undefined;
}

export function localDayEndISO(day: string): string | undefined {
  if (!day) return undefined;
  const next = parseDate(day);
  next.setDate(next.getDate() + 1); // Calendar addition respects 23/25-hour DST days.
  // Backend timestamp filters are inclusive and store microseconds.
  return new Date(next.getTime() - 1).toISOString().replace(".999Z", ".999999Z");
}

export function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = parseDate(todayISO()).getTime();
  return Math.round((parseDate(s).getTime() - t) / 86400000);
}

export function formatDate(s: string | null | undefined, opts: { withYear?: boolean } = {}): string {
  if (!s) return "—";
  const d = parseDate(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), {
    month: "short", day: "numeric", ...(opts.withYear || !sameYear ? { year: "numeric" } : {}),
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale(), {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return t("just now");
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
  return formatDate(iso.slice(0, 10), { withYear: true });
}

export function dueLabel(s: string | null | undefined): string {
  const n = daysUntil(s);
  if (n === null) return "";
  if (n === 0) return t("today");
  if (n === 1) return t("tomorrow");
  if (n === -1) return t("yesterday");
  return n < 0 ? t("{n}d overdue", { n: -n }) : t("in {n}d", { n });
}

export function formatNumber(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(2);
  return Number(v.toPrecision(digits + (abs >= 1 ? Math.floor(Math.log10(abs)) : 0))).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function startOfWeekISO(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : "";
}
