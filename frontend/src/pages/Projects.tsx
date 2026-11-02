import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/hooks/app-state";
import { Portfolio } from "./Overview";
import { t } from "@/i18n";

export default function ProjectsPage() {
  const { openCreate } = useAppState();
  return (
    <Portfolio showArchiveFilter action={<Button onClick={() => openCreate({ kind: "project" })}><Plus /> {t("New project")}</Button>} />
  );
}
