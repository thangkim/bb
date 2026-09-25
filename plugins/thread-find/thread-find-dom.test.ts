// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  resolveFindShortcutTarget,
  resolveThreadWindow,
  revealRange,
} from "./thread-find-dom";

const ROW_LIST = '<div data-timeline-row-list="top-level"><p>text</p></div>';

function mount(html: string): void {
  document.body.innerHTML = html;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
}

function findKey(
  target: Element,
  init: KeyboardEventInit = { ctrlKey: true },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function defineNumber(element: HTMLElement, name: string, value: number) {
  Object.defineProperty(element, name, { configurable: true, value });
}

function rect(top: number, height: number): DOMRect {
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

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolveThreadWindow", () => {
  it("prefers the thread window that contains focus, including a side chat", () => {
    mount(`
      <div id="main" data-thread-window="">${ROW_LIST}</div>
      <div id="side" data-thread-window="" data-surface-tone="sidebar">
        ${ROW_LIST}<textarea id="side-input"></textarea>
      </div>`);

    expect(resolveThreadWindow(document, byId("side-input"))).toBe(
      byId("side"),
    );
    expect(resolveThreadWindow(document, document.body)).toBe(byId("main"));
  });

  it("picks the main thread window of the focused split pane", () => {
    mount(`
      <div data-split-pane-id="a" data-focused="false">
        <div id="a" data-thread-window="">${ROW_LIST}</div>
      </div>
      <div data-split-pane-id="b" data-focused="true">
        <div data-split-pane-id="b">
          <div id="b" data-thread-window="">${ROW_LIST}</div>
        </div>
      </div>`);

    expect(resolveThreadWindow(document, document.body)).toBe(byId("b"));
  });

  it("finds nothing when the focused pane is not a thread", () => {
    mount(`
      <div data-split-pane-id="a" data-focused="false">
        <div data-thread-window="">${ROW_LIST}</div>
      </div>
      <div data-split-pane-id="b" data-focused="true"><main></main></div>`);

    expect(resolveThreadWindow(document, document.body)).toBeNull();
  });

  it("skips hidden panes and windows without a timeline", () => {
    mount(`
      <div aria-hidden="true"><div data-thread-window="">${ROW_LIST}</div></div>
      <div data-thread-window=""><p>loading</p></div>`);

    expect(resolveThreadWindow(document, document.body)).toBeNull();
  });
});

describe("resolveFindShortcutTarget", () => {
  it("claims Mod+F for a thread and leaves other chords alone", () => {
    mount(
      `<div id="main" data-thread-window="">${ROW_LIST}<button id="row"></button></div>`,
    );
    const row = byId("row");

    expect(resolveFindShortcutTarget(findKey(row), document, false)).toEqual({
      kind: "thread",
      threadWindow: byId("main"),
    });
    expect(
      resolveFindShortcutTarget(
        findKey(row, { metaKey: true }),
        document,
        true,
      ),
    ).toEqual({ kind: "thread", threadWindow: byId("main") });
    expect(
      resolveFindShortcutTarget(
        findKey(row, { metaKey: true }),
        document,
        false,
      ),
    ).toBeNull();
    expect(
      resolveFindShortcutTarget(
        findKey(row, { ctrlKey: true, shiftKey: true }),
        document,
        false,
      ),
    ).toBeNull();
  });

  it("leaves Mod+F to the in-app browser, terminal, and open modals", () => {
    mount(`
      <div data-thread-window="">${ROW_LIST}</div>
      <div data-app-browser=""><input id="browser" /></div>
      <div data-app-terminal=""><textarea id="terminal"></textarea></div>`);

    expect(
      resolveFindShortcutTarget(findKey(byId("browser")), document, false),
    ).toBeNull();
    expect(
      resolveFindShortcutTarget(findKey(byId("terminal")), document, false),
    ).toBeNull();

    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="dialog" data-state="open"></div>',
    );
    expect(
      resolveFindShortcutTarget(findKey(document.body), document, false),
    ).toBeNull();
  });

  it("falls through to native find when no thread is in view", () => {
    mount("<main><input id='field' /></main>");

    expect(
      resolveFindShortcutTarget(findKey(byId("field")), document, false),
    ).toBeNull();
  });

  it("recognizes Mod+F pressed inside the find bar", () => {
    mount('<div data-thread-find=""><input id="query" /></div>');

    expect(
      resolveFindShortcutTarget(findKey(byId("query")), document, false),
    ).toEqual({ kind: "find-bar" });
  });

  it("ignores events another handler already consumed", () => {
    mount(`<div data-thread-window="">${ROW_LIST}</div>`);
    const event = findKey(document.body);
    event.preventDefault();

    expect(resolveFindShortcutTarget(event, document, false)).toBeNull();
  });
});

describe("revealRange", () => {
  function mountScroller(matchTop: number) {
    mount(`
      <div id="window" data-thread-window="">
        <div id="scroller" style="overflow-y: auto">
          <div data-timeline-row-list="top-level"><p id="match">needle</p></div>
          <div id="footer" data-scroll-footer=""></div>
        </div>
      </div>`);
    const scroller = byId("scroller");
    defineNumber(scroller, "clientHeight", 400);
    defineNumber(scroller, "scrollHeight", 4_000);
    scroller.getBoundingClientRect = () => rect(0, 400);
    byId("footer").getBoundingClientRect = () => rect(300, 100);
    const range = document.createRange();
    range.selectNodeContents(byId("match"));
    range.getBoundingClientRect = () => rect(matchTop - scroller.scrollTop, 20);
    const events: string[] = [];
    scroller.addEventListener("wheel", (event) =>
      events.push(`wheel:${Math.sign(event.deltaY)}`),
    );
    scroller.addEventListener("scroll", () => events.push("scroll"));
    return { events, range, scroller };
  }

  it("marks user scroll intent before centering a match above the view", () => {
    const { events, range, scroller } = mountScroller(1_000);
    scroller.scrollTop = 2_000;

    revealRange(range, byId("window"));

    expect(scroller.scrollTop).toBe(860);
    expect(events).toEqual(["wheel:-1", "scroll"]);
  });

  it("treats the region under the sticky footer as hidden", () => {
    const { events, range, scroller } = mountScroller(320);

    revealRange(range, byId("window"));

    expect(scroller.scrollTop).toBe(180);
    expect(events).toEqual(["wheel:1", "scroll"]);
  });

  it("leaves a fully visible match where it is", () => {
    const { events, range, scroller } = mountScroller(100);

    revealRange(range, byId("window"));

    expect(scroller.scrollTop).toBe(0);
    expect(events).toEqual([]);
  });
});
