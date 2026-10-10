export const COMPOSER_SHELL_SELECTOR = "[data-promptbox-shell]";
const COMPOSER_SELECTOR = "[data-follow-up-composer]";
export const FOOTER_VISIBLE_ATTRIBUTE = "data-follow-up-composer-footer-visible";

function pinFooter(composer: Element) {
  if (!composer.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)) {
    composer.setAttribute(FOOTER_VISIBLE_ATTRIBUTE, "");
  }
}

function pinWithin(node: Node) {
  if (!(node instanceof Element)) return;
  if (node.matches(COMPOSER_SELECTOR)) pinFooter(node);
  node.querySelectorAll(COMPOSER_SELECTOR).forEach(pinFooter);
}

function pinChanged(records: MutationRecord[]) {
  for (const record of records) {
    if (record.type === "attributes") {
      if (record.target instanceof Element && record.target.matches(COMPOSER_SELECTOR)) {
        pinFooter(record.target);
      }
      continue;
    }
    record.addedNodes.forEach(pinWithin);
  }
}

export function keepComposerFooterVisible(shell: Element): () => void {
  shell.querySelectorAll(COMPOSER_SELECTOR).forEach(pinFooter);
  const observer = new MutationObserver(pinChanged);
  observer.observe(shell, {
    subtree: true,
    childList: true,
    attributeFilter: [FOOTER_VISIBLE_ATTRIBUTE],
  });
  return () => observer.disconnect();
}
