// In-app documentation. Markdown files from /docs and /templates are bundled at build time
// (Vite `?raw`), so help works offline and always matches the deployed version.
import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Check, Copy, Download, ExternalLink, FileCode2, Network, Rocket, Server, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { t, useI18n } from "@/i18n";
import guideEn from "../../../docs/guide.md?raw";
import guideZh from "../../../docs/guide.zh-CN.md?raw";
import mcpDoc from "../../../docs/mcp-integration.md?raw";
import deploymentDoc from "../../../docs/deployment.md?raw";
import architectureDoc from "../../../docs/architecture.md?raw";
import agentsTpl from "../../../templates/AGENTS.md?raw";
import claudeTpl from "../../../templates/CLAUDE.md?raw";

interface Doc {
  slug: string;
  title: string;
  icon: ReactNode;
  body: (lang: string) => string;
  template?: string; // file name for copy/download
}

const DOCS: Doc[] = [
  { slug: "guide", title: "User guide", icon: <Rocket />, body: (l) => (l === "zh" ? guideZh : guideEn) },
  { slug: "mcp-integration", title: "MCP integration", icon: <Workflow />, body: () => mcpDoc },
  { slug: "deployment", title: "Deployment", icon: <Server />, body: () => deploymentDoc },
  { slug: "architecture", title: "Architecture", icon: <Network />, body: () => architectureDoc },
  { slug: "claude-template", title: "CLAUDE.md template", icon: <FileCode2 />, body: () => claudeTpl, template: "CLAUDE.md" },
  { slug: "agents-template", title: "AGENTS.md template", icon: <FileCode2 />, body: () => agentsTpl, template: "AGENTS.md" },
];

const FILE_TO_SLUG: Record<string, string> = {
  "guide.md": "guide", "guide.zh-cn.md": "guide", "readme.md": "guide", "mcp-integration.md": "mcp-integration",
  "deployment.md": "deployment", "architecture.md": "architecture", "agents.md": "agents-template", "claude.md": "claude-template",
};

/** GitHub-compatible heading slug (so links like deployment.md#5-backup--restore work). */
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function outline(md: string): { level: number; text: string; id: string }[] {
  const out: { level: number; text: string; id: string }[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(##|###) (.+)$/.exec(line);
    if (m) {
      const text = m[2].replace(/`/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/[*_]/g, "");
      out.push({ level: m[1].length, text, id: slugify(text) });
    }
  }
  return out;
}

function resolveHref(href: string): { internal: string } | { external: string } {
  if (/^(https?:|mailto:)/i.test(href)) return { external: href };
  if (href.startsWith("#")) return { internal: href };
  const [path, hash] = href.split("#");
  const file = path.split("/").pop()?.toLowerCase() ?? "";
  const slug = FILE_TO_SLUG[file];
  if (slug) return { internal: `/help/${slug}${hash ? `#${hash}` : ""}` };
  return { external: href };
}

function CopyCode({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("Copy")}
      className="absolute right-2 top-2 inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error(t("Clipboard not available — select and copy manually"));
        }
      }}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? t("Copied") : t("Copy")}
    </button>
  );
}

function heading(level: 1 | 2 | 3 | 4) {
  const Tag = `h${level}` as const;
  return ({ children }: { children?: ReactNode }) => {
    const id = slugify(textOf(children));
    return (
      <Tag id={id} className="group scroll-mt-20">
        {children}
        {level > 1 && <a href={`#${id}`} aria-hidden className="ml-1.5 text-muted-foreground/0 no-underline group-hover:text-muted-foreground">#</a>}
      </Tag>
    );
  };
}

export default function HelpPage() {
  const { doc: slug = "guide" } = useParams();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const doc = DOCS.find((d) => d.slug === slug) ?? DOCS[0];
  const body = doc.body(lang);
  const toc = useMemo(() => outline(body), [body]);

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [slug, hash]);

  const components: Components = useMemo(() => ({
    h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4),
    a: ({ href = "", children }) => {
      const r = resolveHref(href);
      if ("external" in r) return <a href={r.external} target="_blank" rel="noreferrer noopener">{children}<ExternalLink className="ml-0.5 inline size-3" /></a>;
      if (r.internal.startsWith("#")) return <a href={r.internal}>{children}</a>;
      return <Link to={r.internal}>{children}</Link>;
    },
    pre: ({ children }) => {
      const code = Children.toArray(children).map(textOf).join("");
      return <div className="group relative"><pre>{children}</pre><CopyCode text={code.replace(/\n$/, "")} /></div>;
    },
    table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
  }), []);

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success(t("Template copied"));
    } catch {
      toast.error(t("Clipboard not available — select and copy manually"));
    }
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: doc.template });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_200px]">
      <nav aria-label={t("Documentation")} className="lg:sticky lg:top-16 lg:self-start">
        <div className="mb-2 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><BookOpen className="size-3.5" />{t("Documentation")}</div>
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {DOCS.map((d) => (
            <li key={d.slug}>
              <Link
                to={`/help/${d.slug}`}
                aria-current={d.slug === doc.slug ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4",
                  d.slug === doc.slug && "bg-accent font-medium text-foreground",
                )}
              >
                {d.icon}{t(d.title)}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 hidden border-t border-border pt-3 lg:block">
          <a href="/api/docs" target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <ExternalLink className="size-4" />{t("REST API reference")}
          </a>
        </div>
      </nav>

      <Card className="min-w-0 px-5 py-5 sm:px-8">
        {doc.template && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex-1">{t("Copy this file into the root of your research repository and set the project slug.")}</span>
            <Button size="sm" variant="secondary" onClick={copyTemplate}><Copy /> {t("Copy")}</Button>
            <Button size="sm" variant="secondary" onClick={downloadTemplate}><Download /> {doc.template}</Button>
          </div>
        )}
        {lang === "zh" && doc.slug !== "guide" && (
          <p className="mb-4 rounded-md bg-info/10 px-3 py-2 text-xs text-info">
            {t("This reference document is in English. A Chinese quick guide is available:")}{" "}
            <button type="button" className="cursor-pointer underline" onClick={() => navigate("/help/guide")}>{t("User guide")}</button>
          </p>
        )}
        <article className="prose-ros prose-help text-[14px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{body}</ReactMarkdown>
        </article>
      </Card>

      {toc.length > 2 && (
        <aside aria-label={t("On this page")} className="hidden xl:sticky xl:top-16 xl:block xl:self-start">
          <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("On this page")}</div>
          <ul className="space-y-0.5 border-l border-border">
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className={cn("-ml-px block border-l border-transparent py-0.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground", h.level === 3 ? "pl-5" : "pl-3")}>
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
