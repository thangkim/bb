export const BROWSER_ROOT_SELECTOR = "[data-app-browser]";
const ADDRESS_INPUT_SELECTOR = 'input[aria-label^="Address and search bar"]';

export function browserContentArea(root: Element): HTMLElement | null {
  const content = root.lastElementChild;
  if (!(content instanceof HTMLElement)) return null;
  if (content.querySelector(ADDRESS_INPUT_SELECTOR) !== null) return null;
  return content;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function navigateBrowserTab(
  root: Element,
  url: string,
): Promise<boolean> {
  const input = root.querySelector(ADDRESS_INPUT_SELECTOR);
  if (!(input instanceof HTMLInputElement) || input.form === null) return false;
  const form = input.form;
  input.focus({ preventScroll: true });
  await nextFrame();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setValue === undefined) return false;
  setValue.call(input, url);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextFrame();
  if (!input.isConnected || input.value !== url) return false;
  form.requestSubmit();
  return true;
}
