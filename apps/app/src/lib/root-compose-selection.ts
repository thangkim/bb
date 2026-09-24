import { atom, useAtom, useSetAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ForkThreadCreateSeed } from "@bb/client-core";
import { DEFAULT_COMPOSE_ID } from "./split-layout";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { createTabScopedStorage } from "./browser-storage";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";

function parseStoredProjectId(
  storedValue: string | null,
  initialValue: string,
): string {
  return storedValue && storedValue.length > 0 ? storedValue : initialValue;
}

const rootComposeProjectIdStorage = createTabScopedStorage<string>(
  {
    parse: parseStoredProjectId,
    serialize: (value) => value,
  },
  { persistInitialValue: true },
);

export const defaultRootComposeProjectIdAtom = atomWithStorage<string>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  PERSONAL_PROJECT_ID,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

const rootComposeProjectIdAtomFamily = atomFamily((composeId: string) =>
  composeId === DEFAULT_COMPOSE_ID
    ? defaultRootComposeProjectIdAtom
    : atom<string>(PERSONAL_PROJECT_ID),
);

const rootComposeReuseEnvironmentAtomFamily = atomFamily((_composeId: string) =>
  atom<string | null>(null),
);

const rootComposeSectionIdAtomFamily = atomFamily((_composeId: string) =>
  atom<string | null>(null),
);

const rootComposeForkSeedAtomFamily = atomFamily((_composeId: string) =>
  atom<ForkThreadCreateSeed | null>(null),
);

export function useComposeScopeId(): string {
  return useOptionalPaneContext()?.composeId ?? DEFAULT_COMPOSE_ID;
}

export function useRootComposeProjectId() {
  return useAtom(rootComposeProjectIdAtomFamily(useComposeScopeId()));
}

export function useSetRootComposeProjectId() {
  return useSetAtom(rootComposeProjectIdAtomFamily(useComposeScopeId()));
}

export function useRootComposeReuseEnvironment() {
  return useAtom(rootComposeReuseEnvironmentAtomFamily(useComposeScopeId()));
}

export function useRootComposeSectionId() {
  return useAtom(rootComposeSectionIdAtomFamily(useComposeScopeId()));
}

export function useRootComposeForkSeed() {
  return useAtom(rootComposeForkSeedAtomFamily(useComposeScopeId()));
}
