// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../shared/contract.js";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ATTACHMENT_PREVIEW_TAB } from "../../shared/preview-tab.js";
import { AttachmentPreviewTab, AttachmentsGrid } from "./attachments.js";

function renderGrid(ui: ReactElement) {
  return renderSlot({ component: () => ui }, {});
}

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
    const screen = renderGrid(
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

    const screen = renderGrid(
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

    const screen = renderGrid(
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
    const screen = renderGrid(
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

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the load failure inside the viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gone", { status: 404 })),
    );
    const screen = renderGrid(
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
    const screen = renderGrid(
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

describe("Markdown preview panel tab", () => {
  const markdownFile = imageAttachment({
    id: "01JFILE00000000000000000A1",
    fileName: "report.md",
    mime: "text/markdown",
    sizeBytes: 2048,
    isImage: false,
  });

  it("opens a markdown card in the page's Preview tab when the panel accepts it", () => {
    const slot = renderSlot(
      { component: AttachmentsGrid },
      {
        attachments: [markdownFile],
        onRemove: vi.fn().mockResolvedValue(undefined),
        onError: vi.fn(),
      },
      { experimental_openFixedTab: () => true },
    );

    fireEvent.click(slot.getByRole("button", { name: "Open report.md" }));

    expect(slot.inspection.experimental_fixedTabOpenCalls).toEqual([
      {
        surface: { kind: "current" },
        panelId: "tasks",
        tabId: "preview",
        target: {
          attachmentId: "01JFILE00000000000000000A1",
          fileName: "report.md",
          sizeBytes: 2048,
        },
      },
    ]);
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("falls back to the dialog where the surface has no Preview tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("# Hi")));
    const slot = renderSlot(
      { component: AttachmentsGrid },
      {
        attachments: [markdownFile],
        onRemove: vi.fn().mockResolvedValue(undefined),
        onError: vi.fn(),
      },
      { experimental_openFixedTab: () => false },
    );

    fireEvent.click(slot.getByRole("button", { name: "Open report.md" }));

    expect(await slot.findByRole("dialog", { name: "report.md" })).toBeTruthy();
  });

  it("renders the targeted file and clears back to the empty state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("# Findings\n\nForum needs"));
    vi.stubGlobal("fetch", fetchMock);
    const slot = renderSlot(
      { component: AttachmentPreviewTab },
      {},
      {
        experimental_fixedTabTarget: {
          panelId: ATTACHMENT_PREVIEW_TAB.panelId,
          tabId: ATTACHMENT_PREVIEW_TAB.id,
          target: {
            attachmentId: "01JFILE00000000000000000A1",
            fileName: "report.md",
            sizeBytes: 2048,
          },
        },
      },
    );

    await waitFor(() =>
      expect(slot.getByTestId("bb-markdown").textContent).toContain(
        "Forum needs",
      ),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "attachmentId=01JFILE00000000000000000A1",
    );
    expect(slot.queryByRole("dialog")).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Close file" }));

    expect(await slot.findByText("No file open")).toBeTruthy();
  });

  it("rejects malformed targets", () => {
    const { validate } = ATTACHMENT_PREVIEW_TAB.experimental_target;
    expect(validate({ attachmentId: "", fileName: "a.md", sizeBytes: 1 })).toBe(
      false,
    );
    expect(validate({ attachmentId: "x", fileName: "a.md" })).toBe(false);
    expect(validate(["x"])).toBe(false);
    expect(
      validate({ attachmentId: "x", fileName: "a.md", sizeBytes: 1 }),
    ).toBe(true);
  });
});
