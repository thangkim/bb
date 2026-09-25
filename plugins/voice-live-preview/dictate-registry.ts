export interface DictateTarget {
  root(): Element | null;
  toggle(): void;
}

interface RegisteredTarget {
  target: DictateTarget;
  registeredAt: number;
  focusedAt: number;
}

const targets = new Set<RegisteredTarget>();
let sequence = 0;

export function registerDictateTarget(target: DictateTarget): {
  markFocused(): void;
  unregister(): void;
} {
  sequence += 1;
  const entry: RegisteredTarget = {
    target,
    registeredAt: sequence,
    focusedAt: 0,
  };
  targets.add(entry);
  return {
    markFocused() {
      sequence += 1;
      entry.focusedAt = sequence;
    },
    unregister() {
      targets.delete(entry);
    },
  };
}

export function hasDictateTarget(): boolean {
  return targets.size > 0;
}

export function resolveDictateTarget(
  activeElement: Element | null,
): DictateTarget | null {
  let best: RegisteredTarget | null = null;
  for (const entry of targets) {
    const root = entry.target.root();
    if (activeElement !== null && root?.contains(activeElement)) {
      return entry.target;
    }
    if (
      best === null ||
      entry.focusedAt > best.focusedAt ||
      (entry.focusedAt === best.focusedAt &&
        entry.registeredAt > best.registeredAt)
    ) {
      best = entry;
    }
  }
  return best?.target ?? null;
}

export function runDictate(): boolean {
  const target = resolveDictateTarget(document.activeElement);
  if (target === null) return false;
  target.toggle();
  return true;
}
