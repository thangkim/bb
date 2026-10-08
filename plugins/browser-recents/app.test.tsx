// @vitest-environment jsdom
import { useState, type FormEvent } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserRecentLinks } from "./app.js";

vi.mock("@bb/shared-ui/icon", () => ({ Icon: () => null }));

function FakeBrowserTab({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [currentUrl, setCurrentUrl] = useState("");
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCurrentUrl(draft);
    setIsEditing(false);
    onNavigate(draft);
  };
  return (
    <div data-app-browser="">
      <div role="region" aria-label="Browser navigation">
        <form onSubmit={submit}>
          <input
            aria-label="Address and search bar"
            value={isEditing ? draft : currentUrl}
            onFocus={() => {
              setDraft(currentUrl);
              setIsEditing(true);
            }}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        <BrowserRecentLinks
          threadId="thr_a"
          tabId="tab_a"
          url={currentUrl}
          isCompactViewport={false}
          experimental_page={null}
        />
      </div>
      <div data-testid="content" />
    </div>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("BrowserRecentLinks", () => {
  it("lists recent links in an empty tab and opens one in that tab", async () => {
    window.localStorage.setItem(
      "bb.thread.browserHistory-thr_other-1",
      JSON.stringify([
        { url: "https://docs.dev/guide", title: "Guide", visitedAt: 2 },
        { url: "https://news.dev/", title: null, visitedAt: 1 },
      ]),
    );
    const onNavigate = vi.fn();
    render(<FakeBrowserTab onNavigate={onNavigate} />);

    const content = screen.getByTestId("content");
    const guide = await screen.findByRole("button", { name: /Guide/ });
    expect(content.contains(guide)).toBe(true);
    expect(screen.getByRole("button", { name: /news\.dev/ })).toBeTruthy();

    await act(async () => guide.click());

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith("https://docs.dev/guide"),
    );
    expect(screen.queryByRole("list", { name: "Recent links" })).toBeNull();
  });

  it("renders nothing when no thread has browsing history", async () => {
    render(<FakeBrowserTab onNavigate={() => undefined} />);
    await act(async () => undefined);
    expect(screen.getByTestId("content").childElementCount).toBe(0);
  });
});
