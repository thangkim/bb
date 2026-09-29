export const STARTUP_TIMEOUT_MS = 120_000;
export const READY_POLL_MS = 200;
const READY_PROBE_TIMEOUT_MS = 1_000;

export type ServerRole = "transcribe" | "language";

export interface WhisperServerChild {
  kill(): void;
  onExit(listener: () => void): void;
  stderrTail(): string;
}

export interface ServerSpec {
  readonly serverPath: string;
  readonly modelPath: string;
  readonly extraArgs: readonly string[];
}

export interface ServerPoolDependencies {
  spawnServer(serverPath: string, args: readonly string[]): WhisperServerChild;
  freePort(): Promise<number>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): number;
  delay(ms: number): Promise<void>;
}

interface RunningServer {
  readonly key: string;
  readonly ready: Promise<number>;
  isReady(): boolean;
  stop(): void;
}

export interface ServerPool {
  ensure(role: ServerRole, spec: ServerSpec): Promise<number>;
  isReady(role: ServerRole, spec: ServerSpec): boolean;
  stopAll(): void;
}

function specKey(spec: ServerSpec): string {
  return [spec.serverPath, spec.modelPath, ...spec.extraArgs].join("\0");
}

export function createServerPool(deps: ServerPoolDependencies): ServerPool {
  const running = new Map<ServerRole, RunningServer>();

  async function waitUntilReady(
    port: number,
    child: WhisperServerChild,
    hasExited: () => boolean,
  ): Promise<void> {
    const deadline = deps.now() + STARTUP_TIMEOUT_MS;
    while (deps.now() < deadline) {
      if (hasExited()) {
        const tail = child.stderrTail();
        throw new Error(
          tail.length > 0
            ? `whisper-server exited while loading the model: ${tail}`
            : "whisper-server exited while loading the model",
        );
      }
      const probe = await deps
        .fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(READY_PROBE_TIMEOUT_MS),
        })
        .then((response) => response.ok)
        .catch(() => false);
      if (probe && !hasExited()) return;
      await deps.delay(READY_POLL_MS);
    }
    throw new Error("whisper-server did not finish loading the model in time");
  }

  function start(role: ServerRole, spec: ServerSpec): RunningServer {
    let child: WhisperServerChild | null = null;
    let exited = false;
    let stopped = false;
    let ready = false;
    const server: RunningServer = {
      key: specKey(spec),
      ready: (async () => {
        const port = await deps.freePort();
        if (stopped) throw new Error("whisper-server was stopped");
        const spawned = deps.spawnServer(spec.serverPath, [
          "-m",
          spec.modelPath,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          ...spec.extraArgs,
        ]);
        child = spawned;
        spawned.onExit(() => {
          exited = true;
          if (running.get(role) === server) running.delete(role);
        });
        try {
          await waitUntilReady(port, spawned, () => exited);
        } catch (error) {
          spawned.kill();
          throw error;
        }
        ready = true;
        return port;
      })(),
      isReady: () => ready && !exited,
      stop() {
        stopped = true;
        child?.kill();
      },
    };
    server.ready.catch(() => {
      if (running.get(role) === server) running.delete(role);
    });
    return server;
  }

  return {
    ensure(role, spec) {
      const existing = running.get(role);
      if (existing !== undefined && existing.key !== specKey(spec)) {
        existing.stop();
        running.delete(role);
      }
      let server = running.get(role);
      if (server === undefined) {
        server = start(role, spec);
        running.set(role, server);
      }
      return server.ready;
    },
    isReady(role, spec) {
      const server = running.get(role);
      return (
        server !== undefined && server.key === specKey(spec) && server.isReady()
      );
    },
    stopAll() {
      const servers = [...running.values()];
      running.clear();
      for (const server of servers) server.stop();
    },
  };
}
