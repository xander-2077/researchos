import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/hooks/app-state";
import { Portfolio } from "./Overview";
import { t } from "@/i18n";

export default function ProjectsPage() {
  const { openCreate } = useAppState();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{t("All research projects. Archived projects are hidden unless selected.")}</p>
        <Button onClick={() => openCreate({ kind: "project" })}><Plus /> {t("New project")}</Button>
      </div>
      <Portfolio showArchiveFilter />
    </div>
  );
}
