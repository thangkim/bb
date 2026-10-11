import type { BbNavigate } from "@get-bb/plugin-sdk/app";

export const COMPOSE_ROUTE = "/";

let composeAnchor: HTMLAnchorElement | null = null;

function attachComposeAnchor(node: HTMLAnchorElement | null) {
  if (node === null) return;
  composeAnchor = node;
  return () => {
    if (composeAnchor === node) composeAnchor = null;
  };
}

export function ComposeAnchor() {
  return (
    <a
      ref={attachComposeAnchor}
      href={COMPOSE_ROUTE}
      hidden
      aria-hidden="true"
      tabIndex={-1}
      data-my-tasks-compose-anchor=""
    />
  );
}

export function splitComposerRight(anchor: HTMLAnchorElement | null): boolean {
  if (anchor === null || !anchor.isConnected) return false;
  const view = anchor.ownerDocument.defaultView;
  let handled = false;
  const settle = (event: Event) => {
    if (event.target !== anchor) return;
    handled = event.defaultPrevented;
    event.preventDefault();
  };
  view?.addEventListener("click", settle);
  try {
    anchor.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        metaKey: true,
      }),
    );
  } finally {
    view?.removeEventListener("click", settle);
  }
  return handled;
}

export function openComposerBeside(
  navigate: BbNavigate,
  projectId: string | null,
): boolean {
  const split = splitComposerRight(composeAnchor);
  navigate.toCompose({
    ...(projectId === null ? {} : { projectId }),
    focusPrompt: true,
  });
  return split;
}
