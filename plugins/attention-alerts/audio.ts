import { renderSound, type AlertSound } from "./sounds.js";

const RESUME_TIMEOUT_MS = 400;

export interface AlertAudio {
  ready(): Promise<boolean>;
  play(sound: AlertSound, volume: number): Promise<boolean>;
  dispose(): void;
}

function resumeWithin(context: AudioContext, ms: number): Promise<void> {
  return Promise.race([
    context.resume().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

export function createAlertAudio(): AlertAudio {
  let context: AudioContext | null = null;
  const buffers = new Map<AlertSound, AudioBuffer>();
  const unlockEvents = ["pointerdown", "keydown", "touchend"] as const;

  function ensureContext(): AudioContext | null {
    if (context) return context;
    if (typeof AudioContext === "undefined") return null;
    context = new AudioContext();
    return context;
  }

  function unlock(): void {
    const current = ensureContext();
    if (current && current.state !== "running") {
      void current.resume().catch(() => undefined);
    }
  }

  for (const event of unlockEvents) {
    window.addEventListener(event, unlock, { capture: true, passive: true });
  }

  async function ready(): Promise<boolean> {
    const current = ensureContext();
    if (!current) return false;
    if (current.state !== "running") await resumeWithin(current, RESUME_TIMEOUT_MS);
    return current.state === "running";
  }

  function bufferFor(current: AudioContext, sound: AlertSound): AudioBuffer {
    const cached = buffers.get(sound);
    if (cached) return cached;
    const samples = renderSound(sound, current.sampleRate);
    const buffer = current.createBuffer(1, samples.length, current.sampleRate);
    buffer.copyToChannel(samples, 0);
    buffers.set(sound, buffer);
    return buffer;
  }

  return {
    ready,
    async play(sound, volume) {
      if (!(await ready()) || !context) return false;
      const source = context.createBufferSource();
      source.buffer = bufferFor(context, sound);
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(gain).connect(context.destination);
      source.start();
      return true;
    },
    dispose() {
      for (const event of unlockEvents) {
        window.removeEventListener(event, unlock, { capture: true });
      }
      void context?.close().catch(() => undefined);
      context = null;
      buffers.clear();
    },
  };
}
