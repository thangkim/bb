import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { errorMessage } from "../../shared/errors.js";
import { useProjects, useTasksQuery, useTasksRpc } from "../../shell/data.js";
import { BbProjectLinkPicker } from "../manage/bb-project-link.js";

export function LinkBeforeStartContent({
  projectId,
  mode = "start",
  onLinked,
  onError,
}: {
  projectId: string;
  mode?: "start" | "change";
  onLinked: () => void;
  onError: (message: string) => void;
}) {
  const rpc = useTasksRpc();
  const bbProjects = useTasksQuery(
    async (query) => (await query.call("listBbProjects")).bbProjects,
    [],
  );
  const projects = useProjects();
  const currentLink =
    projects.data?.find((project) => project.id === projectId)
      ?.linkedBbProjectId ?? null;
  const [selection, setSelection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "change") setSelection(currentLink);
  }, [mode, currentLink]);

  const save = async () => {
    if (selection === null || saving) return;
    setSaving(true);
    try {
      await rpc.call("updateProject", {
        projectId,
        linkedBbProjectId: selection,
      });
      onLinked();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PopoverContent
      align="start"
      className="w-64 p-3"
      data-link-before-start={projectId}
    >
      <p className="mb-2 text-xs text-muted-foreground">
        {mode === "change"
          ? "Pick the bb project folder new threads for this project run in."
          : "Pick the bb project new threads should run in."}
      </p>
      <BbProjectLinkPicker
        value={selection}
        onChange={setSelection}
        bbProjects={bbProjects.data ?? []}
      />
      {bbProjects.error !== null ? (
        <p className="mt-2 text-xs text-destructive">{bbProjects.error}</p>
      ) : null}
      <div className="mt-2.5 flex justify-end">
        <Button
          size="sm"
          className="h-7"
          disabled={
            selection === null ||
            saving ||
            (mode === "change" && selection === currentLink)
          }
          onClick={() => void save()}
        >
          {mode === "change" ? "Save" : "Link and start"}
        </Button>
      </div>
    </PopoverContent>
  );
}
