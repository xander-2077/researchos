import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn, label as labelOf } from "@/lib/utils";
import { t, tn } from "@/i18n";

const fieldBase =
  "w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/70 transition-colors hover:border-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/60 disabled:opacity-60 aria-invalid:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, placeholder, ...p }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-8", className)} placeholder={placeholder && t(placeholder)} {...p} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, placeholder, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-[72px] py-1.5 leading-relaxed", className)} placeholder={placeholder && t(placeholder)} {...p} />
));
Textarea.displayName = "Textarea";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: readonly string[];
  placeholder?: string;
  /** Map values to visible labels; defaults to the global LABELS map. */
  labeler?: (v: string) => string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, labeler = labelOf, children, ...p }, ref) => (
    <div className={cn("relative", className)}>
      <select ref={ref} className={cn(fieldBase, "h-8 appearance-none pr-7 cursor-pointer")} {...p}>
        {placeholder !== undefined && <option value="">{t(placeholder)}</option>}
        {options?.map((o) => (
          <option key={o} value={o}>
            {labeler(o)}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
);
Select.displayName = "Select";

export function Field({
  label, error, hint, children, className, required,
}: { label: string; error?: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string; required?: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {t(label)}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-danger" role="alert">{t(error)}</p> : hint ? <p className="text-xs text-muted-foreground">{tn(hint)}</p> : null}
    </div>
  );
}
