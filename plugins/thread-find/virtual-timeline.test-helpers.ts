export interface VirtualTimelineRow {
  id: string;
  html: string;
}

export interface VirtualTimeline {
  threadWindow: HTMLElement;
  scroller: HTMLElement;
  list: HTMLElement;
  mountedIds: () => string[];
  restore: () => void;
}

interface VirtualTimelineOptions {
  rows: readonly VirtualTimelineRow[];
  rowHeight?: number;
  viewportHeight?: number;
  overscan?: number;
  initialScrollTop?: number;
}

export function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 400,
    width: 400,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

export function mountVirtualTimeline({
  rows,
  rowHeight = 100,
  viewportHeight = 300,
  overscan = 1,
  initialScrollTop,
}: VirtualTimelineOptions): VirtualTimeline {
  const totalHeight = rows.length * rowHeight;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div id="thread" data-thread-window="">
      <div id="scroller" style="overflow-y: auto">
        <div data-timeline-row-list="top-level"><div data-timeline-items=""></div></div>
      </div>
      <div data-scroll-footer=""><textarea id="composer"></textarea></div>
    </div>`,
  );
  const threadWindow = document.getElementById("thread");
  const scroller = document.getElementById("scroller");
  const list = document.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const items = document.querySelector<HTMLElement>("[data-timeline-items]");
  if (
    threadWindow === null ||
    scroller === null ||
    list === null ||
    items === null
  ) {
    throw new Error("virtual timeline did not mount");
  }
  let scrollTop = initialScrollTop ?? maxScrollTop;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.min(maxScrollTop, Math.max(0, value));
    },
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: viewportHeight,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: totalHeight,
  });
  scroller.getBoundingClientRect = () => rect(0, viewportHeight);
  items.getBoundingClientRect = () => rect(-scrollTop, totalHeight);

  const render = () => {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const last = Math.min(
      rows.length - 1,
      Math.floor((scrollTop + viewportHeight) / rowHeight) + overscan,
    );
    const indexes = new Set<number>();
    for (let index = first; index <= last; index += 1) indexes.add(index);
    indexes.add(rows.length - 1);
    const elements = [...indexes]
      .sort((left, right) => left - right)
      .flatMap((index) => {
        const row = rows[index];
        if (row === undefined) return [];
        const element = document.createElement("div");
        element.setAttribute("data-timeline-row-id", row.id);
        element.setAttribute("data-timeline-window-key", row.id);
        element.setAttribute("data-index", String(index));
        element.innerHTML = row.html;
        element.getBoundingClientRect = () =>
          rect(index * rowHeight - scrollTop, rowHeight);
        return [element];
      });
    items.replaceChildren(...elements);
  };
  render();
  scroller.addEventListener("scroll", render);

  const originalRangeRect: Range["getBoundingClientRect"] | undefined =
    Range.prototype.getBoundingClientRect;
  Range.prototype.getBoundingClientRect = function rangeRect(this: Range) {
    const row = this.startContainer.parentElement?.closest(
      "[data-timeline-row-id]",
    );
    return row instanceof HTMLElement
      ? rect(row.getBoundingClientRect().top + 10, 20)
      : rect(0, 0);
  };

  return {
    threadWindow,
    scroller,
    list,
    mountedIds: () =>
      Array.from(items.children).map(
        (child) => child.getAttribute("data-timeline-row-id") ?? "",
      ),
    restore: () => {
      if (originalRangeRect === undefined) {
        Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
      } else {
        Range.prototype.getBoundingClientRect = originalRangeRect;
      }
    },
  };
}
