import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Plus, UserRound, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Dialog, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from "@/components/ui/overlay";
import { useAuth } from "@/hooks/auth";
import { useAppState } from "@/hooks/app-state";
import { useMemberCandidates, useMembers, useUsers, useWrite } from "@/hooks/queries";
import { api } from "@/services/api";
import { formatDateTime } from "@/lib/utils";
import type { Invitation, ManagedUser, Project, ProjectMember } from "@/types/api";
import { t } from "@/i18n";

function Pagination({ offset, total, onChange }: { offset: number; total: number; onChange: (offset: number) => void }) {
  if (total <= 50) return null;
  return <div className="flex justify-end gap-2 border-t border-border p-3">
    <Button size="sm" variant="secondary" disabled={!offset} onClick={() => onChange(Math.max(0, offset - 50))}>{t("Previous")}</Button>
    <Button size="sm" variant="secondary" disabled={offset + 50 >= total} onClick={() => onChange(offset + 50)}>{t("Next")}</Button>
  </div>;
}

export function UserManagement() {
  const { me } = useAuth();
  const [offset, setOffset] = useState(0);
  const q = useUsers(offset);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("member");
  const [invitation, setInvitation] = useState<Invitation>();
  const [copied, setCopied] = useState(false);
  const [change, setChange] = useState<{ user: ManagedUser; field: "is_active" | "is_admin" }>();
  const [remove, setRemove] = useState<ManagedUser>();
  const del = useWrite(() => api.deleteUser(remove!.id), {
    success: "User deleted", onSuccess: () => { setRemove(undefined); setOffset(0); },
  });
  const showInvitation = (r: Invitation) => { setInvitation(r); setCopied(false); setOpen(true); };
  const create = useWrite(() => api.createUser(username.trim(), role === "admin"), { success: "User invited", onSuccess: showInvitation });
  const renew = useWrite((id: number) => api.renewInvitation(id), { success: "Invitation renewed", onSuccess: showInvitation });
  const update = useWrite(() => api.updateUser(change!.user.id, { [change!.field]: !change!.user[change!.field] }), {
    success: "User updated", onSuccess: () => setChange(undefined),
  });
  const link = invitation ? `${window.location.origin}${invitation.invitation_path}` : "";
  return <Card>
    <CardHeader title="User management" sub="Create a user and share an invitation link. Users choose their own password." action={
      <Button size="sm" onClick={() => { setInvitation(undefined); setUsername(""); setRole("member"); setOpen(true); }}><Plus /> {t("New user")}</Button>
    } />
    {q.isLoading ? <Skeleton className="m-4 h-20" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">
        <thead><tr className="border-b border-border text-left text-muted-foreground">{["Username", "Role", "Status", "Actions"].map((h) => <th key={h} className="px-4 py-2 font-medium">{t(h)}</th>)}</tr></thead>
        <tbody>{q.data?.items.map((u) => <tr key={u.id} className="border-b border-border last:border-0">
          <td className="px-4 py-3 font-medium">{u.username}</td>
          <td className="px-4 py-3">{t(u.is_admin ? "Administrator" : "Member")}</td>
          <td className="px-4 py-3">{t(!u.is_active ? "Disabled" : u.registered ? "Active" : "Awaiting registration")}</td>
          <td className="flex flex-wrap gap-2 px-4 py-2">
            {!u.registered && u.is_active && <Button size="sm" variant="secondary" disabled={renew.isPending} onClick={() => renew.mutate(u.id)}>{t("New invitation link")}</Button>}
            {u.id !== me?.user_id && <>
              <Button size="sm" variant="ghost" onClick={() => setChange({ user: u, field: "is_admin" })}>{t(u.is_admin ? "Make member" : "Make administrator")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setChange({ user: u, field: "is_active" })}>{t(u.is_active ? "Disable" : "Enable")}</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemove(u)}>{t("Delete user")}</Button>
            </>}
          </td>
        </tr>)}</tbody>
      </table><Pagination offset={offset} total={q.data?.total ?? 0} onChange={setOffset} /></div>
    )}
    <Dialog open={open} onOpenChange={setOpen} title={invitation ? "Share invitation" : "New user"} footer={invitation ? <Button onClick={() => setOpen(false)}>{t("Done")}</Button> : undefined}>
      {invitation ? <div className="space-y-3 text-sm">
        <p>{t("Share this link with the user to set a password. It can be used once.")}</p>
        <p className="text-muted-foreground">{t("Expires")}: {formatDateTime(invitation.expires_at)}</p>
        <Input aria-label={t("Invitation link")} value={link} readOnly onFocus={(e) => e.target.select()} />
        <Button variant="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
        }}>{t(copied ? "Copied" : "Copy link")}</Button>
        <p className="text-xs text-muted-foreground">{t("The link is only shown now. Generate a new invitation if needed; the previous link will stop working.")}</p>
      </div> : <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
        <Field label="Username" required>{(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={64} required autoFocus />}</Field>
        <Field label="Role">{(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">{t("Member")}</option><option value="admin">{t("Administrator")}</option>
        </Select>}</Field>
        <Button type="submit" disabled={create.isPending || !username.trim()}>{t("Create invitation")}</Button>
      </form>}
    </Dialog>
    <ConfirmDialog open={!!change} onOpenChange={(v) => !v && setChange(undefined)} title="Update user?"
      description={change ? t("Update access for {name}? Disabling a user signs them out and revokes their tokens.", { name: change.user.username }) : ""}
      onConfirm={() => update.mutate(undefined)} busy={update.isPending} />
    <ConfirmDialog open={!!remove} onOpenChange={(v) => !v && setRemove(undefined)} title="Delete user?" destructive confirmLabel="Delete user"
      description={t("Permanently delete {name}? Their account, invitations and tokens will be removed. Projects and images will transfer to you; research data and activity will be preserved.", { name: remove?.username ?? "" })}
      onConfirm={() => del.mutate(undefined)} busy={del.isPending} />
  </Card>;
}

export function ProjectMembers({ project }: { project: Project }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { projectFilter, setProjectFilter } = useAppState();
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [offset, setOffset] = useState(0);
  const q = useMembers(project.id, offset);
  const [username, setUsername] = useState("");
  const [remove, setRemove] = useState<ProjectMember>();
  const canManage = me?.is_admin || me?.user_id === project.owner_id;
  const candidates = useMemberCandidates(project.id, !!canManage);
  const selected = candidates.data?.items.some((u) => u.username === username) ? username : "";
  const add = useWrite(() => api.addMember(project.id, username.trim()), { success: "Member added", onSuccess: () => setUsername("") });
  const del = useWrite(() => api.removeMember(project.id, remove!.user_id), { success: "Member removed", onSuccess: () => setRemove(undefined) });
  const leave = useWrite(() => api.leaveProject(project.id), {
    success: "Project left",
    onSuccess: () => {
      if (projectFilter === project.id) setProjectFilter(null);
      navigate("/projects");
    },
  });
  return <Card>
    <CardHeader title="Project members" sub="Members can manage this project's tasks, experiments, notes and progress." />
    {canManage && <form className="flex max-w-lg items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
      <Field label="Username">{(id) => <DropdownMenu>
        <DropdownTrigger asChild><Button id={id} variant="secondary" className="min-w-48 justify-start" disabled={candidates.isLoading || candidates.isError || !candidates.data?.items.length}>
          <UserRound /> {selected || t(candidates.isLoading ? "Loading…" : !candidates.data?.items.length ? "No available users" : "Select member")}<ChevronDown className="ml-auto" />
        </Button></DropdownTrigger>
        <DropdownContent align="start" className="max-h-64 overflow-y-auto">
          {candidates.data?.items.map((u) => <DropdownItem key={u.user_id} onSelect={() => setUsername(u.username)}><UserRound /> {u.username}</DropdownItem>)}
        </DropdownContent>
      </DropdownMenu>}</Field>
      <Button type="submit" disabled={add.isPending || !selected || candidates.isFetching}><UserPlus /> {t("Add member")}</Button>
    </form>}
    {canManage && candidates.isError && <ErrorState error={candidates.error} onRetry={() => candidates.refetch()} />}
    {q.isLoading ? <Skeleton className="m-4 h-20" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <>
      <ul className="divide-y divide-border">{q.data?.items.map((u) => <li key={u.user_id} className="flex items-center justify-between px-4 py-3 text-sm">
        <span className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" />{u.username} <span className="ml-2 text-xs text-muted-foreground">{t(u.is_owner ? "Owner" : "Member")}{!u.is_active && ` · ${t("Disabled")}`}</span></span>
        {!u.is_owner && (u.user_id === me?.user_id
          ? <Button size="sm" variant="ghost" onClick={() => setLeaveConfirm(true)} disabled={leave.isPending}><LogOut /> {t("Leave project")}</Button>
          : canManage && <Button size="sm" variant="ghost" onClick={() => setRemove(u)}>{t("Remove")}</Button>)}
      </li>)}</ul>
      <Pagination offset={offset} total={q.data?.total ?? 0} onChange={setOffset} />
    </>}
    <ConfirmDialog open={!!remove} onOpenChange={(v) => !v && setRemove(undefined)} title="Remove member?" destructive
      description={t("{name} will lose access to this project.", { name: remove?.username ?? "" })}
      onConfirm={() => del.mutate(undefined)} busy={del.isPending} />
    <ConfirmDialog open={leaveConfirm} onOpenChange={setLeaveConfirm} title="Leave project?" destructive confirmLabel="Leave project"
      description="You will lose access to this project. An existing member manager must add you again to rejoin."
      onConfirm={() => leave.mutate(undefined)} busy={leave.isPending} />
  </Card>;
}
