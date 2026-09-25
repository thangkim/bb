export const DRAFT_POLICY = {
  firstDelayMs: 3_000,
  minAudioMs: 3_000,
  minNewAudioMs: 2_500,
  intervalGrowth: 1.4,
  maxIntervalMs: 8_000,
  maxRequests: 12,
  maxRecordingMs: 180_000,
  timeoutMs: 4_000,
} as const;

export interface DraftSchedulerDeps {
  now(): number;
  recordedMs(): number;
  request(signal: AbortSignal): Promise<string>;
  onDraft(text: string): void;
}

export interface DraftScheduler {
  start(startedAtMs: number): void;
  halt(): void;
  stop(): void;
  settled(): Promise<void>;
  lastDraft(): string;
}

export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function createDraftScheduler(deps: DraftSchedulerDeps): DraftScheduler {
  let stopped = true;
  let startedAtMs = 0;
  let intervalMs: number = DRAFT_POLICY.firstDelayMs;
  let requestCount = 0;
  let sentRecordedMs = 0;
  let draft = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let abortInFlight: (() => void) | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
  };

  const halt = () => {
    stopped = true;
    clearTimer();
  };

  const stop = () => {
    halt();
    abortInFlight?.();
    abortInFlight = null;
  };

  const send = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(new DOMException("Draft timed out", "TimeoutError")),
      DRAFT_POLICY.timeoutMs,
    );
    abortInFlight = () => controller.abort();
    try {
      const text = await deps.request(controller.signal);
      if (controller.signal.aborted) return false;
      const normalized = normalizeTranscript(text);
      if (normalized.length > 0) {
        draft = normalized;
        deps.onDraft(normalized);
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      abortInFlight = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const elapsedMs = deps.now() - startedAtMs;
    if (
      elapsedMs > DRAFT_POLICY.maxRecordingMs ||
      requestCount >= DRAFT_POLICY.maxRequests
    ) {
      halt();
      return;
    }
    const recordedMs = deps.recordedMs();
    const newAudioMs = recordedMs - sentRecordedMs;
    if (
      elapsedMs < DRAFT_POLICY.minAudioMs ||
      newAudioMs < DRAFT_POLICY.minNewAudioMs
    ) {
      schedule(intervalMs);
      return;
    }
    sentRecordedMs = recordedMs;
    requestCount += 1;
    const request = send();
    const settled = request.then(() => undefined);
    inFlight = settled;
    const succeeded = await request;
    if (inFlight === settled) inFlight = null;
    if (!succeeded) {
      halt();
      return;
    }
    intervalMs = Math.min(
      DRAFT_POLICY.maxIntervalMs,
      Math.round(intervalMs * DRAFT_POLICY.intervalGrowth),
    );
    schedule(intervalMs);
  };

  return {
    start(startedAt) {
      stop();
      stopped = false;
      startedAtMs = startedAt;
      intervalMs = DRAFT_POLICY.firstDelayMs;
      requestCount = 0;
      sentRecordedMs = 0;
      draft = "";
      schedule(DRAFT_POLICY.firstDelayMs);
    },
    halt,
    stop,
    settled: () => inFlight ?? Promise.resolve(),
    lastDraft: () => draft,
  };
}
