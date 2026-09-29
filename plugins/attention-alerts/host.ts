import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { attentionAlertsHostContract } from "./contract.js";
import {
  encodeWav,
  renderSound,
  soundDurationSeconds,
  type AlertSound,
} from "./sounds.js";

const AFPLAY_COMMAND = "/usr/bin/afplay";
const PLAYBACK_GRACE_MS = 3_000;

export interface SoundPlayerDependencies {
  readonly platform: NodeJS.Platform;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  run(
    command: string,
    args: readonly string[],
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<boolean>;
}

function runProcess(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    const finish = (played: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(played);
    };
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

export function createAttentionAlertsHostEntry(deps: SoundPlayerDependencies) {
  const written = new Map<string, Promise<string>>();

  function soundFile(tempDir: string, sound: AlertSound): Promise<string> {
    const key = `${tempDir}:${sound}`;
    const existing = written.get(key);
    if (existing) return existing;
    const path = join(tempDir, `attention-${sound}.wav`);
    const pending = deps
      .mkdir(tempDir)
      .then(() => deps.writeFile(path, encodeWav(renderSound(sound))))
      .then(() => path);
    pending.catch(() => written.delete(key));
    written.set(key, pending);
    return pending;
  }

  return experimental_defineHostEntry({
    contract: attentionAlertsHostContract,
    handlers: {
      async playSound({ sound, volume }, context) {
        if (deps.platform !== "darwin") return { played: false };
        const path = await soundFile(
          context.experimental_paths.tempDir,
          sound,
        );
        const played = await deps.run(
          AFPLAY_COMMAND,
          ["-v", volume.toFixed(2), path],
          soundDurationSeconds(sound) * 1_000 + PLAYBACK_GRACE_MS,
          context.signal,
        );
        return { played };
      },
    },
  });
}

export default createAttentionAlertsHostEntry({
  platform: process.platform,
  writeFile: (path, data) => writeFile(path, data),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  run: runProcess,
});
