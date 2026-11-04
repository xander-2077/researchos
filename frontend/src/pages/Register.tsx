import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorState, Spinner } from "@/components/ui/misc";
import { useAuth } from "@/hooks/auth";
import { useInvitation, useWrite } from "@/hooks/queries";
import { ApiError } from "@/services/api";
import { t } from "@/i18n";

export default function RegisterPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get("invite") ?? "";
  const invitation = useInvitation(token);
  const { register } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string>();
  const create = useWrite(() => register(token, password), { onSuccess: () => navigate("/", { replace: true }) });
  return <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-8">
    <div className="w-full max-w-sm rounded-xl border border-border bg-card p-7 shadow-sm">
      <h1 className="mb-4 text-lg font-semibold">{t("Create your account")}</h1>
      {!token ? <p>{t("Invitation is invalid or expired")}</p> : invitation.isLoading ? <Spinner /> : invitation.isError ? <ErrorState error={invitation.error} /> : (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (password.length < 10) { setError("Password must be at least 10 characters"); return; }
          if (password !== repeat) { setError("Passwords do not match"); return; }
          setError(undefined);
          create.mutate(undefined, { onError: (err) => setError(err instanceof ApiError ? err.message : "Request failed") });
        }}>
          <Field label="Username">{(id) => <Input id={id} value={invitation.data?.username ?? ""} readOnly autoComplete="username" />}</Field>
          <Field label="Password" hint="At least 10 characters">{(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={1024} required />}</Field>
          <Field label="Repeat password" error={error}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} maxLength={1024} required />}</Field>
          <Button type="submit" className="w-full" disabled={create.isPending}>{t("Create account")}</Button>
        </form>
      )}
      <Link to="/login" className="mt-4 block text-sm text-primary hover:underline">{t("Back to sign in")}</Link>
    </div>
  </div>;
}
