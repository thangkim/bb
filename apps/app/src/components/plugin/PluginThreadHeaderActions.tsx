import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";

export function PluginThreadHeaderActions({
  threadId,
  projectId,
  placement = "actions",
}: {
  threadId: string;
  projectId: string;
  placement?: "actions" | "title";
}) {
  const { threadHeaderActions } = usePluginSlots();
  const isCompactViewport = useIsCompactViewport();
  const slots = threadHeaderActions.filter(
    (slot) => (slot.placement ?? "actions") === placement,
  );

  if (slots.length === 0) return null;

  return (
    <>
      {slots.map((slot) => {
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
            pluginId={slot.pluginId}
            slotKind="threadHeaderAction"
            slotId={slot.id}
            instanceId={threadId}
            crashFallback={null}
          >
            <span
              role="group"
              aria-label={slot.title}
              className={cn(
                "flex max-h-7 max-w-64 items-center",
                placement === "title" ? "min-w-0" : "shrink-0",
              )}
            >
              <Component
                threadId={threadId}
                projectId={projectId}
                isCompactViewport={isCompactViewport}
              />
            </span>
          </PluginSlotMount>
        );
      })}
    </>
  );
}
