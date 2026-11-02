import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useAuth } from "@/hooks/auth";
import { ApiError } from "@/services/api";
import { LANGS, t, useI18n } from "@/i18n";

export default function LoginPage({ setupRequired }: { setupRequired?: boolean }) {
  const { login } = useAuth();
  const { lang, setLang } = useI18n();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(t("Enter username and password"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await login(username, password);
    } catch (err) {
      setError(t(err instanceof ApiError ? err.message : "Login failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-lg font-semibold tracking-tight">ResearchOS</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-7 shadow-[0_4px_24px_rgb(0_0_0/0.035)]">
          {setupRequired ? (
            <div className="space-y-3 text-[13px]">
              <h1 className="text-lg font-semibold tracking-tight">{t("Create the admin account")}</h1>
              <p className="text-muted-foreground">{t("No admin user exists yet. For security this is done on the server, not in the browser:")}</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{`# Docker
docker compose exec researchos python -m app.cli set-password

# or set RESEARCHOS_ADMIN_PASSWORD in .env and restart`}</pre>
              <Button variant="secondary" onClick={() => window.location.reload()}>{t("I’ve done this — reload")}</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <h1 className="text-lg font-semibold tracking-tight">{t("Sign in")}</h1>
              <Field label="Username">{(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />}</Field>
              <Field label="Password" error={error}>{(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />}</Field>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">{t("Self-hosted research portfolio · REST · MCP")}</p>
        <div className="mt-3 flex justify-center gap-3 text-xs">
          {LANGS.map((l) => (
            <button key={l.value} type="button" onClick={() => setLang(l.value)} className={lang === l.value ? "font-semibold text-foreground" : "cursor-pointer text-muted-foreground hover:text-foreground"}>{l.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
