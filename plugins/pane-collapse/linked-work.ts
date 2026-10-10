import { useEffect, useState } from "react";

export const LINKED_WORK_SELECTOR = "[data-linked-work-kind]";

export interface PaneLinkedWork {
  kind: "task" | "project";
  label: string;
  color: string | null;
}

export function readLinkedWork(pane: ParentNode): PaneLinkedWork | null {
  const element = pane.querySelector<HTMLElement>(LINKED_WORK_SELECTOR);
  if (element === null) return null;
  const { linkedWorkKind: kind, linkedWorkLabel: label } = element.dataset;
  if (kind !== "task" && kind !== "project") return null;
  if (label === undefined || label === "") return null;
  return { kind, label, color: element.dataset.linkedWorkColor ?? null };
}

function sameLinkedWork(
  left: PaneLinkedWork | null,
  right: PaneLinkedWork | null,
): boolean {
  return (
    left?.kind === right?.kind &&
    left?.label === right?.label &&
    left?.color === right?.color
  );
}

export function usePaneLinkedWork(pane: HTMLElement): PaneLinkedWork | null {
  const [work, setWork] = useState(() => readLinkedWork(pane));
  useEffect(() => {
    const update = () =>
      setWork((current) => {
        const next = readLinkedWork(pane);
        return sameLinkedWork(current, next) ? current : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(pane, {
      subtree: true,
      childList: true,
      attributeFilter: [
        "data-linked-work-kind",
        "data-linked-work-label",
        "data-linked-work-color",
      ],
    });
    return () => observer.disconnect();
  }, [pane]);
  return work;
}
