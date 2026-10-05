import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import {
  DEFAULT_THREAD_CREATION_PLACEMENT,
  readThreadCreationPlacement,
  type ThreadCreationPlacement,
} from "./thread-creation-placement";
import {
  atom,
  useAtom,
  useAtomValue,
  useSetAtom,
  type PrimitiveAtom,
  type SetStateAction,
  type WritableAtom,
} from "jotai";
import { atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { createTabScopedStorage } from "./browser-storage";
import { findPane } from "./split-layout/ops";
import { splitLayoutAtom } from "./split-layout/atoms";

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

const rootComposeProjectIdAtom = atomWithStorage<string>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  PERSONAL_PROJECT_ID,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

const rootComposeReuseEnvironmentAtom = atomWithStorage<string | null>(
  "bb.root-compose.reuse-environment",
  null,
  createTabScopedStorage<string | null>({
    parse: (storedValue) =>
      storedValue !== null &&
      parseEnvironmentValue(storedValue)?.type === "reuse"
        ? storedValue
        : null,
    serialize: (value) => value ?? "",
  }),
  { getOnInit: true },
);

const rootComposeStoredPlacementAtom = atomWithStorage<ThreadCreationPlacement>(
  "bb.root-compose.placement",
  DEFAULT_THREAD_CREATION_PLACEMENT,
  createTabScopedStorage<ThreadCreationPlacement>({
    parse: (storedValue, initialValue) => {
      if (storedValue === null) return initialValue;
      try {
        return (
          readThreadCreationPlacement({ placement: JSON.parse(storedValue) }) ??
          initialValue
        );
      } catch {
        return initialValue;
      }
    },
    serialize: JSON.stringify,
  }),
  { getOnInit: true },
);

type PlacementAtom = WritableAtom<
  ThreadCreationPlacement,
  [ThreadCreationPlacement],
  void
>;

function skipUnchangedPlacement(stored: PlacementAtom): PlacementAtom {
  return atom(
    (get) => get(stored),
    (get, set, next: ThreadCreationPlacement) => {
      const current = get(stored);
      if (
        current.sectionId === next.sectionId &&
        current.pinned === next.pinned
      )
        return;
      set(stored, next);
    },
  );
}

const rootComposePlacementAtom = skipUnchangedPlacement(
  rootComposeStoredPlacementAtom,
);

const scopedPlacementAtoms = new Map<string, PlacementAtom>();

function placementAtomFor(composeId: string | undefined): PlacementAtom {
  if (composeId === undefined) return rootComposePlacementAtom;
  let scoped = scopedPlacementAtoms.get(composeId);
  if (scoped === undefined) {
    scoped = skipUnchangedPlacement(atom(DEFAULT_THREAD_CREATION_PLACEMENT));
    scopedPlacementAtoms.set(composeId, scoped);
  }
  return scoped;
}

type ValueAtom<T> = WritableAtom<T, [SetStateAction<T>], void>;

function composeScoped<T>(defaultAtom: ValueAtom<T>, fallback: T) {
  const scoped = new Map<string, PrimitiveAtom<T>>();
  return (composeId: string | undefined, initialValue: T = fallback) => {
    if (composeId === undefined) return defaultAtom;
    let scopedAtom = scoped.get(composeId);
    if (scopedAtom === undefined) {
      scopedAtom = atom(initialValue);
      scoped.set(composeId, scopedAtom);
    }
    return scopedAtom;
  };
}

export const rootComposeProjectIdAtomFor = composeScoped(
  rootComposeProjectIdAtom,
  PERSONAL_PROJECT_ID,
);
const reuseEnvironmentAtomFor = composeScoped(
  rootComposeReuseEnvironmentAtom,
  null,
);

const focusedComposerAtom = atom((get) => {
  const layout = get(splitLayoutAtom);
  const focused =
    layout === null
      ? undefined
      : findPane(layout.root, layout.focusedPaneId)?.content;
  return focused?.kind === "new-thread" ? focused : undefined;
});
const focusedComposeIdAtom = atom((get) => get(focusedComposerAtom)?.composeId);
const focusedSeedProjectIdAtom = atom(
  (get) => get(focusedComposerAtom)?.seed?.projectId,
);

function useComposeScope() {
  const pane = useOptionalPaneContext();
  const isCompactViewport = useIsCompactViewport();
  const focusedComposeId = useAtomValue(focusedComposeIdAtom);
  const focusedSeedProjectId = useAtomValue(focusedSeedProjectIdAtom);
  if (pane !== null) {
    return {
      composeId: pane.composeId,
      seedProjectId: pane.composeSeed?.projectId,
    };
  }
  return isCompactViewport
    ? { composeId: undefined, seedProjectId: undefined }
    : { composeId: focusedComposeId, seedProjectId: focusedSeedProjectId };
}

function useScopedProjectIdAtom() {
  const { composeId, seedProjectId } = useComposeScope();
  return rootComposeProjectIdAtomFor(composeId, seedProjectId);
}

export function useRootComposeProjectId() {
  return useAtom(useScopedProjectIdAtom());
}

export function useSetRootComposeProjectId() {
  return useSetAtom(useScopedProjectIdAtom());
}

export function useRootComposeReuseEnvironment() {
  return useAtom(reuseEnvironmentAtomFor(useComposeScope().composeId));
}

export function useRootComposePlacement() {
  return useAtom(placementAtomFor(useComposeScope().composeId));
}
