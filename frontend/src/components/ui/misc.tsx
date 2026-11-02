import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { cn, label, tone, TONE_CLASSES } from "@/lib/utils";
import { Button } from "./button";
import { ApiError } from "@/services/api";
import { t, tn } from "@/i18n";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card text-card-foreground", className)} {...p} />;
}

export function CardHeader({ title, action, className, sub }: { title: ReactNode; action?: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 border-b border-border px-4 py-2.5", className)}>
      <div className="min-w-0">
        <h3 className="truncate text-[13px] font-semibold">{tn(title)}</h3>
        {sub && <p className="text-xs text-muted-foreground">{tn(sub)}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ value, text, className, dot }: { value?: string | null; text?: ReactNode; className?: string; dot?: boolean }) {
  const t = tone(value);
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium", TONE_CLASSES[t], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {text !== undefined ? tn(text) : label(value)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} />;
}

export function EmptyState({ title, description, action, icon, className }: {
  title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-4" />}
      </div>
      <p className="text-sm font-medium">{t(title)}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{tn(description)}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = t(error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong");
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <div className="flex size-9 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="size-4" />
      </div>
      <p className="text-sm font-medium">{t("Couldn’t load data")}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{msg}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t("Retry")}
        </Button>
      )}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {value !== null && (
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex h-8 items-center rounded-md border border-border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-full items-center gap-1 rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors cursor-pointer [&_svg]:size-3.5",
            value === o.value && "bg-card text-foreground shadow-xs",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
