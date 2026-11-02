import { useNavigate } from "react-router-dom";
import { useAppState } from "@/hooks/app-state";
import { ExperimentFormDialog, MilestoneFormDialog, ProgressFormDialog, ProjectFormDialog, TaskFormDialog } from "./forms";
import type { Task } from "@/types/api";

/** Renders the "create" dialog requested from anywhere via useAppState().openCreate. */
export function CreateDialogHost() {
  const { create, closeCreate } = useAppState();
  const navigate = useNavigate();
  const onOpenChange = (o: boolean) => !o && closeCreate();
  const kind = create?.kind;
  return (
    <>
      <ProjectFormDialog open={kind === "project"} onOpenChange={onOpenChange} onSaved={(p) => navigate(`/projects/${p.slug}`)} />
      <TaskFormDialog open={kind === "task"} onOpenChange={onOpenChange} projectId={create?.projectId} defaults={create?.defaults as Partial<Task> | undefined} />
      <ExperimentFormDialog open={kind === "experiment"} onOpenChange={onOpenChange} projectId={create?.projectId} onSaved={(e) => navigate(`/experiments/${e.id}`)} />
      <ProgressFormDialog open={kind === "progress"} onOpenChange={onOpenChange} projectId={create?.projectId} />
      {create?.projectId && <MilestoneFormDialog open={kind === "milestone"} onOpenChange={onOpenChange} projectId={create.projectId} />}
    </>
  );
}
