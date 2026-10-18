// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../shared/contract.js";
import { AttachmentsGrid } from "./attachments.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function imageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "01JIMAGE0000000000000000AA",
    projectId: null,
    taskId: "01JTASK00000000000000000AA",
    commentId: null,
    fileName: "diagram.png",
    mime: "image/png",
    sizeBytes: 1024,
    isImage: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("AttachmentsGrid layout", () => {
  it("groups file cards before image previews regardless of input order", () => {
    const screen = render(
      <AttachmentsGrid
        attachments={[
          imageAttachment({ id: "01JIMAGE0000000000000000A1" }),
          imageAttachment({
            id: "01JFILE00000000000000000A1",
            fileName: "notes.md",
            mime: "text/markdown",
            isImage: false,
          }),
          imageAttachment({ id: "01JIMAGE0000000000000000A2" }),
        ]}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onError={vi.fn()}
      />,
    );
    const fileCard = screen.getByText("notes.md");
    const image = screen.getAllByAltText("diagram.png")[0]!;
    expect(
      fileCard.compareDocumentPosition(image) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("AttachmentsGrid removal", () => {
  it("calls the typed removal callback after confirmation", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const attachment = imageAttachment();

    const screen = render(
      <AttachmentsGrid
        attachments={[attachment]}
        onRemove={onRemove}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove diagram.png"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(attachment));
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces the server error and does not report a removal on failure", async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error("blob is busy"));
    const onError = vi.fn();

    const screen = render(
      <AttachmentsGrid
        attachments={[imageAttachment()]}
        onRemove={onRemove}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove diagram.png"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("blob is busy"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("AttachmentsGrid file preview", () => {
  const markdownFile = imageAttachment({
    id: "01JFILE00000000000000000A1",
    fileName: "report.md",
    mime: "application/octet-stream",
    isImage: false,
  });

  it("opens a markdown file in the in-app viewer instead of downloading it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("# Findings\n\nForum needs"));
    vi.stubGlobal("fetch", fetchMock);
    const screen = render(
      <AttachmentsGrid
        attachments={[markdownFile]}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open report.md" }));

    const dialog = await screen.findByRole("dialog", { name: "report.md" });
    await waitFor(() => expect(dialog.textContent).toContain("Forum needs"));
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "attachmentId=01JFILE00000000000000000A1",
    );
    expect(
      screen
        .getAllByLabelText("Download report.md")[0]
        ?.getAttribute("download"),
    ).toBe("report.md");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the load failure inside the viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gone", { status: 404 })),
    );
    const screen = render(
      <AttachmentsGrid
        attachments={[markdownFile]}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open report.md" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "HTTP 404",
    );
  });

  it("keeps other file types as downloads", () => {
    const screen = render(
      <AttachmentsGrid
        attachments={[
          imageAttachment({
            fileName: "data.csv",
            mime: "text/csv",
            isImage: false,
          }),
        ]}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onError={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open data.csv" })).toBeNull();
    expect(
      screen.getByText("data.csv").closest("a")?.getAttribute("download"),
    ).toBe("data.csv");
  });
});
