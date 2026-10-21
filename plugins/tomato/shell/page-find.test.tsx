// @vitest-environment jsdom
import { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageFind, ownsFindShortcut } from "./page-find.js";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

function Harness() {
  const rootRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <main ref={rootRef} tabIndex={-1} data-testid="tomato">
        <div ref={anchorRef}>
          <p>Pulse Gym demo data</p>
          <p>Gym dashboards</p>
        </div>
      </main>
      <aside data-testid="thread">
        <textarea aria-label="prompt" />
      </aside>
      <PageFind rootRef={rootRef} anchorRef={anchorRef} />
    </div>
  );
}

function pressFind(target: Element) {
  return fireEvent.keyDown(target, { key: "f", ctrlKey: true });
}

describe("PageFind", () => {
  it("opens on Cmd+F inside Tomato and claims the shortcut", async () => {
    render(<Harness />);

    const notPrevented = pressFind(screen.getByTestId("tomato"));

    expect(notPrevented).toBe(false);
    expect(await screen.findByRole("search")).toBeTruthy();
  });

  it("leaves Cmd+F alone when focus is outside Tomato", () => {
    render(<Harness />);

    const notPrevented = pressFind(screen.getByLabelText("prompt"));

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("counts matches, steps through them, and closes on Escape", async () => {
    render(<Harness />);
    pressFind(screen.getByTestId("tomato"));
    const input = await screen.findByLabelText("Find in Tomato");

    fireEvent.change(input, { target: { value: "gym" } });
    expect(await screen.findByText("1/2")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("2/2")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("1/2")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(await screen.findByText("2/2")).toBeTruthy();

    fireEvent.change(input, { target: { value: "zzz" } });
    expect(await screen.findByText("No results")).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(screen.queryByRole("search")).toBeNull();
  });
});

describe("ownsFindShortcut", () => {
  it("claims an idle shortcut only while its pane is focused", () => {
    const pane = document.createElement("div");
    pane.setAttribute("data-split-pane-id", "p1");
    const root = document.createElement("main");
    pane.append(root);
    document.body.append(pane);
    const event = { target: document.body } as unknown as KeyboardEvent;

    pane.setAttribute("data-focused", "false");
    expect(ownsFindShortcut(event, root)).toBe(false);
    pane.setAttribute("data-focused", "true");
    expect(ownsFindShortcut(event, root)).toBe(true);
    pane.remove();
  });
});
