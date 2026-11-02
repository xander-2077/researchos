// Project icon library: a curated set of research / robotics / data icons (lucide) plus a colour
// palette. Projects store only the icon key and a #rrggbb colour, so the set can grow freely.
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Accessibility, Atom, Axis3d, Binary, BookOpen, Bot, Boxes, Brain, BrainCircuit, Camera, Car, ChartColumn, ChartLine,
  ChartNetwork, ChartScatter, Check, CircuitBoard, Code, Cog, Compass, Cpu, Cuboid, Database, Dna, Drone, Eye, FileText,
  FlaskConical, FlaskRound, Flame, FolderKanban, Footprints, Gamepad2, Gauge, GitBranch, Globe, Goal, GraduationCap, Hand,
  HeartPulse, Joystick, Layers, Leaf, Library, Lightbulb, Magnet, Map, Microscope, Mountain, Network, NotebookPen,
  Newspaper, Orbit, PenTool, PersonStanding, Presentation, Puzzle, Radar, Rocket, Rotate3d, Satellite, ScanEye, Search,
  Server, Shapes, Sigma, Sparkles, Target, Telescope, Terminal, TestTubes, Trophy, Volleyball, Waves, Zap,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

type Icon = ComponentType<LucideProps>;

export const ICON_GROUPS: { label: string; icons: [string, Icon][] }[] = [
  { label: "Science", icons: [
    ["flask-conical", FlaskConical], ["flask-round", FlaskRound], ["test-tubes", TestTubes], ["microscope", Microscope],
    ["atom", Atom], ["dna", Dna], ["brain", Brain], ["brain-circuit", BrainCircuit], ["telescope", Telescope],
    ["orbit", Orbit], ["magnet", Magnet], ["sigma", Sigma],
  ] },
  { label: "Robotics", icons: [
    ["bot", Bot], ["person-standing", PersonStanding], ["accessibility", Accessibility], ["hand", Hand],
    ["footprints", Footprints], ["joystick", Joystick], ["cog", Cog], ["gauge", Gauge], ["cpu", Cpu],
    ["circuit-board", CircuitBoard], ["drone", Drone], ["car", Car], ["rocket", Rocket], ["satellite", Satellite], ["radar", Radar],
  ] },
  { label: "Data & code", icons: [
    ["database", Database], ["server", Server], ["network", Network], ["chart-line", ChartLine], ["chart-scatter", ChartScatter],
    ["chart-network", ChartNetwork], ["chart-column", ChartColumn], ["binary", Binary], ["code", Code], ["terminal", Terminal],
    ["git-branch", GitBranch], ["layers", Layers],
  ] },
  { label: "Vision & 3D", icons: [
    ["camera", Camera], ["eye", Eye], ["scan-eye", ScanEye], ["cuboid", Cuboid], ["axis-3d", Axis3d], ["rotate-3d", Rotate3d],
    ["shapes", Shapes], ["boxes", Boxes], ["map", Map], ["compass", Compass], ["globe", Globe],
  ] },
  { label: "Writing", icons: [
    ["book-open", BookOpen], ["graduation-cap", GraduationCap], ["notebook-pen", NotebookPen], ["file-text", FileText],
    ["newspaper", Newspaper], ["pen-tool", PenTool], ["presentation", Presentation], ["library", Library], ["lightbulb", Lightbulb],
  ] },
  { label: "Other", icons: [
    ["folder-kanban", FolderKanban], ["target", Target], ["trophy", Trophy], ["goal", Goal], ["volleyball", Volleyball],
    ["gamepad-2", Gamepad2], ["puzzle", Puzzle], ["sparkles", Sparkles], ["zap", Zap], ["leaf", Leaf], ["heart-pulse", HeartPulse],
    ["waves", Waves], ["mountain", Mountain], ["flame", Flame],
  ] },
];

const ICONS: Record<string, Icon> = Object.fromEntries(ICON_GROUPS.flatMap((g) => g.icons));
export const ICON_KEYS = Object.keys(ICONS);
export const DEFAULT_ICON = "folder-kanban";

export const PALETTE: { name: string; value: string }[] = [
  { name: "Blue", value: "#3e63dd" }, { name: "Indigo", value: "#6e56cf" }, { name: "Purple", value: "#8e4ec6" },
  { name: "Pink", value: "#d6409f" }, { name: "Red", value: "#e5484d" }, { name: "Orange", value: "#ef5f00" },
  { name: "Amber", value: "#ad7f00" }, { name: "Green", value: "#30a46c" }, { name: "Teal", value: "#12a594" },
  { name: "Cyan", value: "#0797b9" }, { name: "Slate", value: "#687076" },
];

const SIZES = {
  xs: "size-5 rounded [&_svg]:size-3",
  sm: "size-6 rounded-md [&_svg]:size-3.5",
  md: "size-8 rounded-md [&_svg]:size-4",
  lg: "size-10 rounded-lg [&_svg]:size-5",
};
export type IconSize = keyof typeof SIZES;

/** The coloured icon tile shown in front of a project's name. */
export function ProjectIcon({ icon, color, size = "md", className }: { icon?: string | null; color?: string | null; size?: IconSize; className?: string }) {
  const Glyph = ICONS[icon || ""] ?? ICONS[DEFAULT_ICON];
  const c = color || "";
  return (
    <span
      aria-hidden
      data-icon={ICONS[icon || ""] ? icon : DEFAULT_ICON}
      className={cn("inline-flex shrink-0 items-center justify-center", !c && "bg-muted text-muted-foreground", SIZES[size], className)}
      style={c ? { color: c, backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)` } : undefined}
    >
      <Glyph strokeWidth={1.8} />
    </span>
  );
}

/** Button showing the current icon; opens a popover with colour swatches and a searchable icon grid. */
export function IconPicker({ icon, color, onChange, size = "md", label = "Change icon", align = "left" }: {
  icon: string; color: string; onChange: (v: { icon: string; color: string }) => void; size?: IconSize; label?: string; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [open]);
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return ICON_GROUPS.map((g) => ({ ...g, icons: g.icons.filter(([k]) => !term || k.includes(term)) })).filter((g) => g.icons.length);
  }, [q]);
  const current = ICONS[icon] ? icon : DEFAULT_ICON;
  return (
    <div ref={root} className="relative inline-flex">
      <button type="button" aria-label={t(label)} title={t(label)} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        className="cursor-pointer rounded-md outline-offset-2 transition-opacity hover:opacity-80">
        <ProjectIcon icon={icon} color={color} size={size} />
      </button>
      {open && (
        <div role="dialog" aria-label={t("Project icon")}
          className={cn("absolute top-full z-50 mt-1.5 w-[300px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 shadow-[0_8px_30px_rgb(0_0_0/0.12)]", align === "right" ? "right-0" : "left-0")}>
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">{t("Colour")}</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[{ name: "Default", value: "" }, ...PALETTE].map((c) => (
              <button key={c.name} type="button" aria-label={t(c.name)} title={t(c.name)} aria-pressed={color === c.value}
                onClick={() => onChange({ icon: current, color: c.value })}
                className={cn("flex size-6 cursor-pointer items-center justify-center rounded-full border border-border", color === c.value && "ring-2 ring-ring ring-offset-1 ring-offset-card")}
                style={{ backgroundColor: c.value || "var(--muted)" }}>
                {color === c.value && <Check className={cn("size-3.5", c.value ? "text-white" : "text-foreground")} />}
              </button>
            ))}
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search icons…")} aria-label={t("Search icons…")} autoFocus
              className="h-8 w-full rounded-md border border-input bg-card pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="mb-1 text-[11px] text-muted-foreground">{t(g.label)}</div>
                <div className="grid grid-cols-8 gap-1">
                  {g.icons.map(([k, Glyph]) => (
                    <button key={k} type="button" title={k} aria-label={k} aria-pressed={current === k}
                      onClick={() => { onChange({ icon: k, color }); setOpen(false); }}
                      className={cn("flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
                        current === k && "bg-primary/10 text-primary")}
                      style={current === k && color ? { color } : undefined}>
                      <Glyph className="size-4" strokeWidth={1.8} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <p className="py-4 text-center text-xs text-muted-foreground">{t("No icons match")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
