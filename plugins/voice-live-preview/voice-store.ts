import { toast } from "sonner";
import type { DraftPolicy } from "./draft-scheduler.js";
import { downloadRecording, startMicrophoneRecording } from "./recorder.js";
import {
  createVoiceSession,
  type VoiceSession,
  type VoiceSessionDeps,
} from "./voice-session.js";

export interface VoiceClients {
  transcribe(
    audio: Blob,
    prompt: string | undefined,
    signal: AbortSignal,
  ): Promise<string>;
  draftPolicy(): Promise<DraftPolicy>;
}

const RELEASE_GRACE_MS = 1_000;

const sessions = new Map<string, VoiceSession>();
const retainCounts = new Map<string, number>();
let clients: VoiceClients | null = null;
let sessionDeps: Omit<VoiceSessionDeps, "transcribe" | "draftPolicy"> = {
  startRecording: startMicrophoneRecording,
  download: downloadRecording,
  notify: {
    error: (title, options) => toast.error(title, options),
    warning: (title, options) => toast.warning(title, options),
  },
  now: () => Date.now(),
};

function requireClients(): VoiceClients {
  if (clients === null) throw new Error("Voice input is not ready");
  return clients;
}

export function provideVoiceClients(next: VoiceClients): void {
  clients = next;
}

export function hasVoiceClients(): boolean {
  return clients !== null;
}

export function voiceSessionFor(composerKey: string): VoiceSession {
  const existing = sessions.get(composerKey);
  if (existing !== undefined) return existing;
  const session = createVoiceSession({
    ...sessionDeps,
    transcribe: (audio, prompt, signal) =>
      requireClients().transcribe(audio, prompt, signal),
    draftPolicy: () => requireClients().draftPolicy(),
  });
  sessions.set(composerKey, session);
  return session;
}

export function retainVoiceSession(composerKey: string): () => void {
  retainCounts.set(composerKey, (retainCounts.get(composerKey) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (retainCounts.get(composerKey) ?? 1) - 1;
    if (remaining > 0) {
      retainCounts.set(composerKey, remaining);
      return;
    }
    retainCounts.delete(composerKey);
    setTimeout(() => {
      if (retainCounts.has(composerKey)) return;
      const session = sessions.get(composerKey);
      if (session === undefined) return;
      const { phase } = session.getState();
      if (phase === "recording") void session.stop();
      else if (phase === "starting") session.cancel();
    }, RELEASE_GRACE_MS);
  };
}

export function cancelActiveVoiceSessions(): boolean {
  let cancelled = false;
  for (const session of sessions.values()) {
    if (session.cancel()) cancelled = true;
  }
  return cancelled;
}

export function disposeVoiceSessions(): void {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  retainCounts.clear();
}

export function configureVoiceSessions(
  next: Partial<Omit<VoiceSessionDeps, "transcribe" | "draftPolicy">>,
): void {
  sessionDeps = { ...sessionDeps, ...next };
}
