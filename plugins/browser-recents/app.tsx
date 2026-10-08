import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import {
  BROWSER_ROOT_SELECTOR,
  browserContentArea,
  navigateBrowserTab,
} from "./browser-dom.js";
import {
  formatVisitedAt,
  linkHost,
  readRecentLinks,
  type RecentLink,
} from "./recents.js";

const PLUGIN_ID = "browser-recents";

interface RecentLinksListProps {
  links: readonly RecentLink[];
  now: number;
  onOpen: (url: string) => void;
}

function RecentLinksList({ links, now, onOpen }: RecentLinksListProps) {
  return (
    <div
      data-bb-plugin={PLUGIN_ID}
      className="absolute inset-0 overflow-y-auto bg-background px-4 pb-6 pt-8"
    >
      <section className="mx-auto w-full max-w-xl">
        <h2 className="px-2 pb-2 text-xs font-normal leading-5 text-subtle-foreground/75">
          Recent links
        </h2>
        <ul aria-label="Recent links" className="flex flex-col gap-px">
          {links.map((link) => {
            const host = linkHost(link.url);
            const primary = link.title ?? host;
            return (
              <li key={link.url}>
                <button
                  type="button"
                  title={link.url}
                  onClick={() => onOpen(link.url)}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:text-sm"
                >
                  <Icon
                    name="Globe"
                    className="size-3.5 shrink-0 text-muted-foreground max-md:pointer-coarse:size-5"
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-foreground">{primary}</span>
                    {primary !== host ? (
                      <span className="truncate font-mono text-muted-foreground [flex-shrink:9999]">
                        {host}
                      </span>
                    ) : null}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
                    {formatVisitedAt(link.visitedAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function BrowserRecentLinks({
  url,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<Element | null>(null);
  const [recent, setRecent] = useState<{
    links: readonly RecentLink[];
    now: number;
  }>({ links: [], now: 0 });
  const isEmpty = url.length === 0;

  useEffect(() => {
    setRoot(markerRef.current?.closest(BROWSER_ROOT_SELECTOR) ?? null);
  }, []);

  useEffect(() => {
    if (!isEmpty) return;
    const refresh = () =>
      setRecent({
        links: readRecentLinks(window.localStorage),
        now: Date.now(),
      });
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [isEmpty]);

  const content = root === null ? null : browserContentArea(root);
  return (
    <>
      <span ref={markerRef} hidden />
      {isEmpty && content !== null && root !== null && recent.links.length > 0
        ? createPortal(
            <RecentLinksList
              links={recent.links}
              now={recent.now}
              onOpen={(next) => void navigateBrowserTab(root, next)}
            />,
            content,
          )
        : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "recent-links",
    title: "Recent links",
    component: BrowserRecentLinks,
  });
});
