export const COMPOSER_SHELL_SELECTOR = "[data-promptbox-shell]";
const COMPOSER_SELECTOR = "[data-follow-up-composer]";
export const FOOTER_VISIBLE_ATTRIBUTE = "data-follow-up-composer-footer-visible";

function pinFooter(composer: Element) {
  if (!composer.hasAttribute(FOOTER_VISIBLE_ATTRIBUTE)) {
    composer.setAttribute(FOOTER_VISIBLE_ATTRIBUTE, "");
  }
}

export function keepComposerFooterVisible(shell: Element): () => void {
  const pinAll = () => shell.querySelectorAll(COMPOSER_SELECTOR).forEach(pinFooter);
  pinAll();
  const observer = new MutationObserver(pinAll);
  observer.observe(shell, {
    subtree: true,
    childList: true,
    attributeFilter: [FOOTER_VISIBLE_ATTRIBUTE],
  });
  return () => observer.disconnect();
}
