import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { errorMessage } from "../../shared/errors.js";
import { useTasksQuery, useTasksRpc } from "../../shell/data.js";
import { BbProjectLinkPicker } from "../manage/bb-project-link.js";

export function LinkBeforeStartContent({
  projectId,
  onLinked,
  onError,
}: {
  projectId: string;
  onLinked: () => void;
  onError: (message: string) => void;
}) {
  const rpc = useTasksRpc();
  const bbProjects = useTasksQuery(
    async (query) => (await query.call("listBbProjects")).bbProjects,
    [],
  );
  const [selection, setSelection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        Pick the bb project new threads should run in.
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
          disabled={selection === null || saving}
          onClick={() => void save()}
        >
          Link and start
        </Button>
      </div>
    </PopoverContent>
  );
}
