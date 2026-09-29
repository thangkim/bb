import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  LocalWhisperHostDependencies,
  WhisperServerChild,
} from "./host.js";

const STDERR_TAIL_CHARS = 600;
const FFMPEG_TIMEOUT_MS = 20_000;

function appendTail(tail: string, chunk: Buffer): string {
  const next = tail + chunk.toString("utf8");
  return next.length > STDERR_TAIL_CHARS
    ? next.slice(next.length - STDERR_TAIL_CHARS)
    : next;
}

function lastLines(text: string): string {
  return text.trim().split("\n").slice(-3).join(" ").trim();
}

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const child of liveChildren) child.kill("SIGTERM");
  });
}

function spawnServer(
  serverPath: string,
  args: readonly string[],
): WhisperServerChild {
  installExitHook();
  const child = spawn(serverPath, [...args], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  liveChildren.add(child);
  let tail = "";
  let exited = false;
  const exitListeners: Array<() => void> = [];
  const markExited = () => {
    if (exited) return;
    exited = true;
    liveChildren.delete(child);
    for (const listener of exitListeners) listener();
  };
  child.stderr?.on("data", (chunk: Buffer) => {
    tail = appendTail(tail, chunk);
  });
  child.once("exit", markExited);
  child.once("error", (error) => {
    tail = appendTail(tail, Buffer.from(error.message));
    markExited();
  });
  return {
    kill() {
      if (!exited) child.kill("SIGTERM");
    },
    onExit(listener) {
      if (exited) listener();
      else exitListeners.push(listener);
    },
    stderrTail: () => lastLines(tail),
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(
            new Error("Could not reserve a local port for whisper-server"),
          );
        }
      });
    });
  });
}

function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      signal: AbortSignal.any([signal, AbortSignal.timeout(FFMPEG_TIMEOUT_MS)]),
    });
    let tail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      tail = appendTail(tail, chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const detail = lastLines(tail);
        reject(
          new Error(
            detail.length > 0
              ? `ffmpeg could not read the recording: ${detail}`
              : `ffmpeg exited with code ${String(code)}`,
          ),
        );
      }
    });
  });
}

async function convertToPcm({
  ffmpegPath,
  audio,
  tempDir,
  signal,
}: {
  ffmpegPath: string;
  audio: Uint8Array;
  tempDir: string;
  signal: AbortSignal;
}): Promise<Uint8Array<ArrayBuffer>> {
  await mkdir(tempDir, { recursive: true });
  const id = randomUUID();
  const inputPath = path.join(tempDir, `${id}.input`);
  const outputPath = path.join(tempDir, `${id}.pcm`);
  try {
    await writeFile(inputPath, audio);
    await runFfmpeg(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "s16le",
        outputPath,
      ],
      signal,
    );
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await Promise.all([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true }),
    ]);
  }
}

const MIN_MODEL_BYTES = 50 * 1024 * 1024;

async function downloadFile(
  url: string,
  destination: string,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ),
      createWriteStream(partial),
      { signal },
    );
    const { size } = await stat(partial);
    if (size < MIN_MODEL_BYTES) {
      throw new Error(`downloaded model is only ${size} bytes`);
    }
    await rename(partial, destination);
  } finally {
    await rm(partial, { force: true });
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function createHostRuntime(): LocalWhisperHostDependencies {
  return {
    discovery: {
      homeDir: homedir(),
      pathEnv: process.env.PATH ?? "",
      arch: process.arch,
      isExecutable,
      isFile,
    },
    spawnServer,
    freePort,
    fetch: (url, init) => fetch(url, init),
    convertToPcm,
    downloadFile,
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    schedule(ms, callback) {
      const timer = setTimeout(callback, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
  };
}
