import { useState } from "react";
import { Check, Copy, Download, KeyRound, Monitor, Moon, Plus, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Dialog } from "@/components/ui/overlay";
import { useAppState, type Theme } from "@/hooks/app-state";
import { useTokens, useWrite } from "@/hooks/queries";
import { api, ApiError } from "@/services/api";
import { formatDateTime, relativeTime } from "@/lib/utils";
import type { ApiToken } from "@/types/api";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="secondary" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      } catch {
        toast.error("Clipboard not available — select and copy manually");
      }
    }}>
      {done ? <Check /> : <Copy />} {done ? "Copied" : label}
    </Button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 pr-20 font-mono text-[12px] leading-relaxed">{children}</pre>
      <div className="absolute right-2 top-2"><CopyButton text={children} /></div>
    </div>
  );
}

function TokenStatus({ t }: { t: ApiToken }) {
  if (t.revoked_at) return <Badge value="rejected" text="Revoked" />;
  if (t.expires_at && new Date(t.expires_at) < new Date()) return <Badge value="failed" text="Expired" />;
  return <Badge value="verified" text="Active" />;
}

function Tokens() {
  const q = useTokens();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<ApiToken | null>(null);
  const [err, setErr] = useState<string>();
  const create = useWrite(
    () => api.createToken({ name: name.trim(), scopes: scope === "write" ? ["read", "write"] : ["read"], expires_in_days: days === "0" ? null : Number(days) }),
    { success: "Token created", onSuccess: (t) => { setCreated(t.token); setName(""); } },
  );
  const rev = useWrite((id: number) => api.revokeToken(id), { success: "Token revoked", onSuccess: () => setRevoke(null) });
  return (
    <Card>
      <CardHeader title="API & MCP tokens" sub="Bearer tokens for Claude Code, Codex, scripts. Stored hashed; shown once." action={<Button size="sm" onClick={() => { setCreated(null); setOpen(true); }}><Plus /> New token</Button>} />
      {q.isLoading ? <div className="p-4"><Skeleton className="h-20" /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon={<KeyRound className="size-4" />} title="No tokens yet" description="Create a read/write token for each agent (e.g. 'claude-code-laptop', 'codex-vps')." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Prefix</th><th className="px-4 py-2 font-medium">Scopes</th>
              <th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Expires</th><th className="px-4 py-2 font-medium">Last used</th><th />
            </tr></thead>
            <tbody>
              {q.data.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium">{t.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{t.token_prefix}…</td>
                  <td className="px-4 py-2">{t.scopes.includes("write") ? "Read / Write" : "Read only"}</td>
                  <td className="px-4 py-2"><TokenStatus t={t} /></td>
                  <td className="px-4 py-2 text-muted-foreground">{t.expires_at ? formatDateTime(t.expires_at) : "Never"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{t.last_used_at ? relativeTime(t.last_used_at) : "Never"}</td>
                  <td className="px-4 py-2 text-right">{!t.revoked_at && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoke(t)}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={created ? "Token created" : "New API token"}
        footer={created ? <Button onClick={() => setOpen(false)}>Done</Button> : (
          <><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending} onClick={() => { if (!name.trim()) { setErr("Name is required"); return; } setErr(undefined); create.mutate(undefined); }}>Create token</Button></>
        )}>
        {created ? (
          <div className="space-y-3">
            <p className="text-sm">Copy this token now. It will <strong>not</strong> be shown again.</p>
            <Code>{created}</Code>
            <p className="text-xs text-muted-foreground">Store it in an environment variable such as <code className="font-mono">RESEARCHOS_TOKEN</code>, never in a git repository.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label="Name" required error={err}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-code-macbook" autoFocus />}</Field>
            <Field label="Scope" hint="Names containing 'claude' or 'codex' set the activity source automatically.">
              {(id) => <Select id={id} value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}><option value="write">Read / Write</option><option value="read">Read only</option></Select>}
            </Field>
            <Field label="Expires">
              {(id) => <Select id={id} value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="0">Never</option>
              </Select>}
            </Field>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} title="Revoke token?" destructive confirmLabel="Revoke"
        description={`Agents using “${revoke?.name}” will immediately lose access.`} onConfirm={() => revoke && rev.mutate(revoke.id)} busy={rev.isPending} />
    </Card>
  );
}

function McpSetup() {
  const origin = window.location.origin;
  const [client, setClient] = useState<"claude" | "codex">("claude");
  const claude = `# Claude Code (HTTP transport)
export RESEARCHOS_TOKEN=ros_...   # from "New token" above
claude mcp add --transport http researchos ${origin}/mcp \\
  --header "Authorization: Bearer $RESEARCHOS_TOKEN"
claude mcp list   # should show researchos ✓ connected`;
  const codex = `# OpenAI Codex (~/.codex/config.toml)
[mcp_servers.researchos]
url = "${origin}/mcp"
bearer_token_env_var = "RESEARCHOS_TOKEN"

# then:  export RESEARCHOS_TOKEN=ros_...   and run  codex  →  /mcp`;
  return (
    <Card>
      <CardHeader title="Connect an agent (MCP)" sub={`Streamable HTTP endpoint: ${origin}/mcp`} action={<Segmented ariaLabel="Client" value={client} onChange={setClient} options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex" }]} />} />
      <div className="space-y-2 p-4">
        <Code>{client === "claude" ? claude : codex}</Code>
        <p className="text-xs text-muted-foreground">See <code className="font-mono">docs/mcp-integration.md</code> for project-scoped config, stdio mode and the AGENTS.md / CLAUDE.md templates.</p>
      </div>
    </Card>
  );
}

function Account() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState<string>();
  const m = useWrite(() => api.changePassword(cur, next), { success: "Password changed", onSuccess: () => { setCur(""); setNext(""); } });
  return (
    <Card>
      <CardHeader title="Account" />
      <form className="grid max-w-md gap-3 p-4" onSubmit={(e) => {
        e.preventDefault();
        if (next.length < 10) { setErr("New password must be at least 10 characters"); return; }
        setErr(undefined);
        m.mutate(undefined, { onError: (x) => setErr(x instanceof ApiError ? x.message : "Failed") });
      }}>
        <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label="New password" error={err} hint="At least 10 characters">{(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <div><Button type="submit" disabled={m.isPending || !cur || !next}>Change password</Button></div>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useAppState();
  return (
    <div className="max-w-5xl space-y-4">
      <Tokens />
      <McpSetup />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Account />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Appearance" />
            <div className="p-4">
              <Segmented<Theme> ariaLabel="Theme" value={theme} onChange={setTheme} options={[
                { value: "light", label: <><Sun /> Light</> }, { value: "dark", label: <><Moon /> Dark</> }, { value: "system", label: <><Monitor /> System</> },
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Data" />
            <div className="space-y-2 p-4 text-[13px]">
              <p className="text-muted-foreground">JSON export of all projects, milestones, tasks, experiments, runs and activity (no credentials). For full backups use <code className="font-mono text-xs">scripts/backup.sh</code>.</p>
              <a href={api.exportUrl} download="researchos-export.json"><Button variant="secondary"><Download /> Export JSON</Button></a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
