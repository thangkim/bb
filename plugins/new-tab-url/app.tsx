import { useEffect, useRef } from "react";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { pickOpener, readNewTabUrlEnter, type UrlOpener } from "./intercept.js";

const openers = new Set<UrlOpener>();

export function mountNewTabUrl(signal: AbortSignal): () => void {
  if (signal.aborted) return () => {};
  const onKeyDown = (event: KeyboardEvent) => {
    const typed = readNewTabUrlEnter(event);
    if (typed === null) return;
    const opener = pickOpener(openers, typed.input);
    if (opener === null || !opener.open(typed.url)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const dispose = () => {
    signal.removeEventListener("abort", dispose);
    window.removeEventListener("keydown", onKeyDown, true);
  };
  window.addEventListener("keydown", onKeyDown, true);
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}

export function NewTabUrlOpener() {
  const markerRef = useRef<HTMLSpanElement>(null);
  const { openUrl } = useBbNavigate();

  useEffect(() => {
    const marker = markerRef.current;
    if (marker === null) return;
    const opener: UrlOpener = { marker, open: openUrl };
    openers.add(opener);
    return () => {
      openers.delete(opener);
    };
  }, [openUrl]);

  return <span ref={markerRef} hidden />;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "new-tab-url",
    mount: ({ signal }) => mountNewTabUrl(signal),
  });
  app.composer.customize({
    id: "new-tab-url",
    scopes: ["thread", "new-thread"],
    banners: [
      {
        id: "new-tab-url-opener",
        chrome: "bare",
        component: NewTabUrlOpener,
      },
    ],
  });
});
