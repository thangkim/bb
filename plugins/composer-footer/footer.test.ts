// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  FOOTER_VISIBLE_ATTRIBUTE,
  keepComposerFooterVisible,
} from "./footer.js";

function renderShell() {
  const shell = document.createElement("div");
  shell.setAttribute("data-promptbox-shell", "");
  const composer = document.createElement("div");
  composer.setAttribute("data-follow-up-composer", "");
  shell.append(composer);
  document.body.append(shell);
  return { shell, composer };
}

function flushMutations() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("keepComposerFooterVisible", () => {
  it("marks the composer footer visible immediately", () => {
    const { shell, composer } = renderShell();
    const stop = keepComposerFooterVisible(shell);
    expect(composer.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)).toBe(true);
    stop();
  });

  it("restores the marker when the host removes it", async () => {
    const { shell, composer } = renderShell();
    const stop = keepComposerFooterVisible(shell);
    composer.removeAttribute(FOOTER_VISIBLE_ATTRIBUTE);
    await flushMutations();
    expect(composer.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)).toBe(true);
    stop();
  });

  it("marks a composer mounted after the observer starts", async () => {
    const { shell, composer } = renderShell();
    composer.remove();
    const stop = keepComposerFooterVisible(shell);
    const remounted = document.createElement("div");
    remounted.setAttribute("data-follow-up-composer", "");
    shell.append(remounted);
    await flushMutations();
    expect(remounted.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)).toBe(true);
    stop();
  });

  it("marks a composer nested inside a newly mounted subtree", async () => {
    const { shell, composer } = renderShell();
    composer.remove();
    const stop = keepComposerFooterVisible(shell);
    const wrapper = document.createElement("section");
    const nested = document.createElement("div");
    nested.setAttribute("data-follow-up-composer", "");
    wrapper.append(nested);
    shell.append(wrapper);
    await flushMutations();
    expect(nested.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)).toBe(true);
    stop();
  });

  it("stops restoring the marker after cleanup", async () => {
    const { shell, composer } = renderShell();
    const stop = keepComposerFooterVisible(shell);
    stop();
    composer.removeAttribute(FOOTER_VISIBLE_ATTRIBUTE);
    await flushMutations();
    expect(composer.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)).toBe(false);
  });
});
