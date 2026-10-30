import { useEffect, useState } from "react";
import {
  Markdown,
  definePluginApp,
  useRpc,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import type { fileLinkRpcContract } from "./server.js";

type Resolution =
  | { status: "loading" }
  | { status: "workspace" }
  | { status: "found"; absolutePath: string; content: string; others: string[] }
  | { status: "missing"; tried: string[] }
  | { status: "error"; message: string };

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 text-xs text-muted-foreground">{children}</div>
  );
}

function FileLinkFallbackOpener({
  path,
  source,
  Original,
}: PluginFileOpenerProps) {
  const rpc = useRpc<typeof fileLinkRpcContract>();
  const { kind, threadId, environmentId, projectId } = source;
  const hostId = source.experimental_hostId;
  const requestKey = `${kind}|${threadId}|${environmentId}|${projectId}|${hostId}|${path}`;
  const [settled, setSettled] = useState<{
    key: string;
    resolution: Resolution;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (resolution: Resolution) => {
      if (!cancelled) setSettled({ key: requestKey, resolution });
    };
    rpc
      .call("resolveFile", {
        source: {
          kind,
          threadId,
          environmentId,
          projectId,
          ...(hostId === undefined ? {} : { experimental_hostId: hostId }),
        },
        path,
      })
      .then(settle)
      .catch((error: unknown) => {
        settle({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, kind, threadId, environmentId, projectId, hostId, path, requestKey]);

  const resolution: Resolution =
    settled !== null && settled.key === requestKey
      ? settled.resolution
      : { status: "loading" };

  switch (resolution.status) {
    case "loading":
      return <Notice>Finding {path}…</Notice>;
    case "workspace":
      return <Original />;
    case "error":
      return <Notice>Could not open {path}: {resolution.message}</Notice>;
    case "missing":
      return (
        <Notice>
          <p>Could not find {path}. Looked in:</p>
          <ul className="mt-1 list-disc pl-4">
            {resolution.tried.map((candidate) => (
              <li key={candidate}>{candidate}</li>
            ))}
          </ul>
        </Notice>
      );
    case "found":
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <div className="truncate" title={resolution.absolutePath}>
              {resolution.absolutePath}
            </div>
            {resolution.others.length > 0 ? (
              <div
                className="truncate"
                title={resolution.others.join("\n")}
              >
                Also found in {resolution.others.length} other{" "}
                {resolution.others.length === 1 ? "place" : "places"}
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <Markdown content={resolution.content} />
          </div>
        </div>
      );
  }
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "file-link-fallback",
    title: "Markdown (find file)",
    extensions: ["md", "mdx", "markdown"],
    component: FileLinkFallbackOpener,
  });
});
