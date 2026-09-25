export const THREAD_FIND_MATCH_HIGHLIGHT = "bb-thread-find-match";
export const THREAD_FIND_ACTIVE_HIGHLIGHT = "bb-thread-find-active";

interface TextSegment {
  node: Text;
  start: number;
}

function isRenderedElement(
  element: Element,
  cache: Map<Element, boolean>,
): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const rendered =
    typeof element.checkVisibility === "function"
      ? element.checkVisibility()
      : element.closest("[hidden]") === null;
  cache.set(element, rendered);
  return rendered;
}

function collectTextSegments(
  root: Element,
  isExcluded: (element: Element) => boolean,
): { segments: TextSegment[]; text: string } {
  const segments: TextSegment[] = [];
  const visibility = new Map<Element, boolean>();
  const parts: string[] = [];
  let length = 0;
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || node.data.length === 0) continue;
    const parent = node.parentElement;
    if (parent === null || isExcluded(parent)) continue;
    if (!isRenderedElement(parent, visibility)) continue;
    segments.push({ node, start: length });
    parts.push(node.data);
    length += node.data.length;
  }
  return { segments, text: parts.join("") };
}

function locateOffset(
  segments: readonly TextSegment[],
  offset: number,
  preferEnd: boolean,
): { node: Text; offset: number } | null {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (segment === undefined) return null;
    const end = segment.start + segment.node.data.length;
    const inside = preferEnd
      ? offset > segment.start && offset <= end
      : offset >= segment.start && offset < end;
    if (inside) return { node: segment.node, offset: offset - segment.start };
    if (offset < segment.start || (preferEnd && offset === segment.start)) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return null;
}

function foldCase(value: string): string {
  const folded = value.toLowerCase();
  return folded.length === value.length ? folded : value;
}

export function findTextMatches(
  root: Element,
  query: string,
  isExcluded: (element: Element) => boolean = () => false,
): Range[] {
  if (query.length === 0) return [];
  const { segments, text } = collectTextSegments(root, isExcluded);
  const haystack = foldCase(text);
  const needle = foldCase(query);
  const ranges: Range[] = [];
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + needle.length)
  ) {
    const start = locateOffset(segments, index, false);
    const end = locateOffset(segments, index + needle.length, true);
    if (start === null || end === null) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
  }
  return ranges;
}

function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
  if (typeof Highlight === "undefined") return null;
  return CSS.highlights;
}

export function paintThreadFindHighlights(
  ranges: readonly Range[],
  activeIndex: number,
): void {
  const registry = highlightRegistry();
  if (registry === null) return;
  const active = ranges[activeIndex];
  registry.set(
    THREAD_FIND_MATCH_HIGHLIGHT,
    new Highlight(...ranges.filter((range) => range !== active)),
  );
  if (active === undefined) {
    registry.delete(THREAD_FIND_ACTIVE_HIGHLIGHT);
  } else {
    registry.set(THREAD_FIND_ACTIVE_HIGHLIGHT, new Highlight(active));
  }
}

export function clearThreadFindHighlights(): void {
  const registry = highlightRegistry();
  if (registry === null) return;
  registry.delete(THREAD_FIND_MATCH_HIGHLIGHT);
  registry.delete(THREAD_FIND_ACTIVE_HIGHLIGHT);
}
