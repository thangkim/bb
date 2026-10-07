import { useEffect, useRef } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { COMPOSER_SHELL_SELECTOR, keepComposerFooterVisible } from "./footer.js";

function ComposerFooterPin() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const shell = markerRef.current?.closest(COMPOSER_SHELL_SELECTOR);
    if (!shell) return;
    return keepComposerFooterVisible(shell);
  }, []);

  return <span ref={markerRef} hidden />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "pinned-footer",
    scopes: ["thread"],
    banners: [
      {
        id: "footer-pin",
        chrome: "bare",
        component: ComposerFooterPin,
      },
    ],
  });
});
