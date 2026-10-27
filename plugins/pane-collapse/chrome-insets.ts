export const CHROME_OBSTACLE_SELECTOR = [
  '[data-testid="app-window-title-bar"] > *',
  '[data-testid="app-desktop-sidebar-trigger"]',
  '[data-testid="app-sidebar-trigger-overlay"]',
].join(", ");

export const BASE_BAR_INSET = 8;
export const BASE_BAR_HEIGHT = 36;
const OBSTACLE_GAP = 8;

export interface ChromeInsets {
  left: number;
  right: number;
  height: number;
}

export function chromeInsets(
  bar: DOMRect,
  obstacles: readonly DOMRect[],
): ChromeInsets {
  const barCenter = bar.left + bar.width / 2;
  let left = BASE_BAR_INSET;
  let right = BASE_BAR_INSET;
  let height = BASE_BAR_HEIGHT;
  for (const rect of obstacles) {
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom <= bar.top || rect.top >= bar.top + BASE_BAR_HEIGHT) {
      continue;
    }
    height = Math.max(height, 2 * ((rect.top + rect.bottom) / 2 - bar.top));
    if (rect.left + rect.width / 2 < barCenter) {
      left = Math.max(left, rect.right + OBSTACLE_GAP - bar.left);
    } else {
      right = Math.max(right, bar.right - rect.left + OBSTACLE_GAP);
    }
  }
  return { left, right, height };
}

export function installChromeInsets(bar: HTMLElement): () => void {
  let observed: Element[] = [];
  const resizeObserver = new ResizeObserver(measure);
  function measure() {
    const obstacles = [...document.querySelectorAll(CHROME_OBSTACLE_SELECTOR)];
    const insets = chromeInsets(
      bar.getBoundingClientRect(),
      obstacles.map((obstacle) => obstacle.getBoundingClientRect()),
    );
    bar.style.paddingLeft = `${insets.left}px`;
    bar.style.paddingRight = `${insets.right}px`;
    bar.style.height = `${insets.height}px`;
    if (
      obstacles.length !== observed.length ||
      obstacles.some((obstacle, index) => obstacle !== observed[index])
    ) {
      for (const stale of observed) resizeObserver.unobserve(stale);
      observed = obstacles;
      for (const obstacle of observed) resizeObserver.observe(obstacle);
    }
  }
  resizeObserver.observe(bar);
  window.addEventListener("resize", measure);
  measure();
  return () => {
    resizeObserver.disconnect();
    window.removeEventListener("resize", measure);
  };
}
