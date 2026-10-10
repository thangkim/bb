// @vitest-environment jsdom
import { act, cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeProject } from "../test-fixtures.js";
import { PANELS_CHANGED_EVENT } from "./projects-tab.js";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const app = await loadPluginApp(() => import("../app"));
const overlay = app.appOverlays.find(
  (registration) => registration.id === "sidebar-projects-tab",
)!;

const LAUNCH = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Launch",
  prefix: "LCH",
  status: "in_progress",
});

function renderOverlay() {
  return renderSlot(
    overlay,
    {},
    {
      rpc: {
        listProjects: () => ({ projects: [LAUNCH] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        listLabels: () => ({ labels: [] }),
        listProjectThreadsBatch: () => ({ projectThreads: [] }),
        listThreadLinks: () => ({ tasks: [], projects: [] }),
        sidebarSummary: () => ({ projects: [] }),
      },
    },
  );
}

function addPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.setAttribute("data-sidebar-tab-panel", "projects");
  document.body.append(panel);
  return panel;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("sidebar Projects tab", () => {
  it("renders nothing until a sidebar Projects panel exists", () => {
    const slot = renderOverlay();
    expect(slot.container.textContent).toBe("");
  });

  it("fills a panel that appears later with the topbar, filters, and list in order", async () => {
    renderOverlay();
    const panel = addPanel();
    act(() => {
      window.dispatchEvent(new Event(PANELS_CHANGED_EVENT));
    });
    const root = panel.firstElementChild as HTMLElement;
    expect(root.dataset.bbPluginRoot).toBe("");
    expect(root.dataset.bbPlugin).toBeTruthy();
    await within(panel).findByText("Launch");
    const topbar = within(panel).getByText("All projects");
    const filter = within(panel).getByRole("button", { name: /Status/ });
    const row = within(panel).getByText("Launch");
    expect(
      topbar.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      filter.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fills a panel that already exists and leaves when it goes away", async () => {
    const panel = addPanel();
    renderOverlay();
    await within(panel).findByText("Launch");
    act(() => {
      panel.remove();
      window.dispatchEvent(new Event(PANELS_CHANGED_EVENT));
    });
    await waitFor(() => expect(panel.textContent).toBe(""));
  });
});
