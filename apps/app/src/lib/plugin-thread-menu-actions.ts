import { useMemo, useSyncExternalStore } from "react";
import type {
  ExperimentalThreadMenuAction,
  ExperimentalThreadMenuActionContext,
} from "@get-bb/plugin-sdk";
import {
  EMPTY_PLUGIN_SLOT_SNAPSHOT,
  getPluginSlotSnapshot,
  subscribePluginSlots,
  type ExperimentalThreadMenuActionSlot,
} from "./plugin-slots";

export function runPluginThreadMenuAction(
  slot: ExperimentalThreadMenuActionSlot,
  context: ExperimentalThreadMenuActionContext,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${slot.pluginId}] threadMenuAction "${slot.id}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = slot.run(context);
    if (result instanceof Promise) {
      result.catch(warn);
    }
  } catch (error) {
    warn(error);
  }
}

export function useThreadMenuActions(): readonly ExperimentalThreadMenuAction[] {
  const slots = useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().experimentalThreadMenuActions,
    () => EMPTY_PLUGIN_SLOT_SNAPSHOT.experimentalThreadMenuActions,
  );
  return useMemo(
    () =>
      slots.map((slot) => ({
        key: `${slot.pluginId}:${slot.id}`,
        title: slot.title,
        ...(slot.icon !== undefined ? { icon: slot.icon } : {}),
        run: (context: ExperimentalThreadMenuActionContext) => {
          runPluginThreadMenuAction(slot, context);
        },
      })),
    [slots],
  );
}
