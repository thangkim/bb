import { useCallback } from "react";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { offerNewThreadRequest } from "@/lib/plugin-new-thread-handlers";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

interface UseCreateThreadInEnvironmentArgs {
  projectId: string;
  environmentId: string;
  sectionId: string | null;
  pinned: boolean;
}

export function useCreateThreadInEnvironment({
  projectId,
  environmentId,
  sectionId,
  pinned,
}: UseCreateThreadInEnvironmentArgs): () => void {
  const navigate = useRouteNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  return useCallback(() => {
    if (
      !pinned &&
      offerNewThreadRequest({
        projectId,
        environmentId,
        ...(sectionId !== null ? { sectionId } : {}),
        focusPrompt: true,
      })
    ) {
      return;
    }
    setRootComposeProjectId(projectId);
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        reuseEnvironmentId: environmentId,
        placement: { sectionId, pinned },
      },
    });
  }, [
    environmentId,
    navigate,
    projectId,
    sectionId,
    pinned,
    setRootComposeProjectId,
  ]);
}
