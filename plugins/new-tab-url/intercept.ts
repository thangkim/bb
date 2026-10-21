import { parseTypedUrl } from "./url.js";

export const NEW_TAB_INPUT_SELECTOR =
  '[data-panel-new-tab-page] input[role="combobox"]';

export interface UrlOpener {
  marker: Element;
  open: (url: string) => boolean;
}

export function depthOfCommonAncestor(a: Node, b: Node): number {
  const ancestors = new Set<Node>();
  for (let node: Node | null = a; node !== null; node = node.parentNode) {
    ancestors.add(node);
  }
  for (let node: Node | null = b; node !== null; node = node.parentNode) {
    if (!ancestors.has(node)) continue;
    let depth = 0;
    for (let up = node.parentNode; up !== null; up = up.parentNode) depth += 1;
    return depth;
  }
  return -1;
}

export function pickOpener(
  openers: Iterable<UrlOpener>,
  input: Node,
): UrlOpener | null {
  let best: UrlOpener | null = null;
  let bestDepth = -1;
  for (const opener of openers) {
    const depth = depthOfCommonAncestor(opener.marker, input);
    if (depth > bestDepth) {
      best = opener;
      bestDepth = depth;
    }
  }
  return best;
}

export function readNewTabUrlEnter(event: KeyboardEvent): {
  input: HTMLInputElement;
  url: string;
} | null {
  if (event.key !== "Enter" || event.isComposing || event.defaultPrevented) {
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return null;
  if (!input.matches(NEW_TAB_INPUT_SELECTOR)) return null;
  const url = parseTypedUrl(input.value);
  return url === null ? null : { input, url };
}
