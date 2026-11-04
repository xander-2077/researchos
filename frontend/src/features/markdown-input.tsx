import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/services/api";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

const MAX_BYTES = 10_000_000;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

const imagesOf = (list: FileList | null | undefined) => Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

/** Markdown textarea that can take images: button, paste or drop → upload → `![alt](url)` at the caret. */
export function MarkdownInput({ id, value, onChange, onUploadStateChange, rows = 3, placeholder, className, "aria-label": ariaLabel }: {
  id?: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; className?: string; "aria-label"?: string;
  onUploadStateChange?: (uploading: boolean) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const touched = useRef(false); // caret position is meaningless until the user has focused the field
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const active = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const notify = useRef(onUploadStateChange);
  notify.current = onUploadStateChange;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      notify.current?.(false);
    };
  }, []);

  const insert = (snippet: string) => {
    const el = ref.current;
    const cur = latest.current;
    const at = el && touched.current ? Math.min(el.selectionEnd, cur.length) : cur.length;
    const before = cur.slice(0, at);
    const after = cur.slice(at);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const trail = after.startsWith("\n") ? "" : "\n";
    const next = before + lead + snippet + trail + after;
    latest.current = next;
    onChange(next);
    const caret = (before + lead + snippet + trail).length;
    requestAnimationFrame(() => {
      if (!el?.isConnected || !active.current) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      touched.current = true;
    });
  };

  const upload = async (files: File[]) => {
    const accepted = files.filter((f) => {
      if (f.size > MAX_BYTES) {
        toast.error(t("{name} is larger than 10 MB", { name: f.name || "image" }));
        return false;
      }
      return true;
    });
    if (!accepted.length) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(controllers.current.size);
    notify.current?.(true);
    try {
      for (const f of accepted) {
        if (controller.signal.aborted) break;
        try {
          const res = await api.uploadImage(f, controller.signal);
          if (!active.current || controller.signal.aborted) break;
          const alt = (f.name || "image").replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "") || "image";
          insert(`![${alt}](${res.url})`);
        } catch (err) {
          if (active.current && !controller.signal.aborted) toast.error(t(err instanceof ApiError ? err.message : "Upload failed"));
        }
      }
    } finally {
      controllers.current.delete(controller);
      if (active.current && !controller.signal.aborted) {
        setBusy(controllers.current.size);
        notify.current?.(controllers.current.size > 0);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imagesOf(e.clipboardData?.files);
    if (!files.length) return;
    e.preventDefault();
    touched.current = true;
    void upload(files);
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    setOver(false);
    const files = imagesOf(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    void upload(files);
  };

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        ref={ref} id={id} aria-label={ariaLabel} value={value} rows={rows} placeholder={placeholder}
        className={cn(over && "border-primary ring-2 ring-ring", className)}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { touched.current = true; }}
        onPaste={onPaste}
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      />
      <div className="flex justify-end">
        <button type="button" disabled={busy > 0} onClick={() => fileRef.current?.click()}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {busy ? t("Uploading…") : t("Insert image")}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden data-testid="image-file-input"
          onChange={(e) => { const files = imagesOf(e.target.files); e.target.value = ""; void upload(files); }} />
      </div>
    </div>
  );
}
