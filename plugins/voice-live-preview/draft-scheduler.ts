export interface DraftPolicy {
  readonly firstDelayMs: number;
  readonly minAudioMs: number;
  readonly minNewAudioMs: number;
  readonly intervalGrowth: number;
  readonly maxIntervalMs: number;
  readonly maxRequests: number;
  readonly maxRecordingMs: number;
  readonly timeoutMs: number;
  readonly maxFailures: number;
  readonly intervalFromSend: boolean;
}

export const CLOUD_DRAFT_POLICY: DraftPolicy = {
  firstDelayMs: 3_000,
  minAudioMs: 3_000,
  minNewAudioMs: 2_500,
  intervalGrowth: 1.4,
  maxIntervalMs: 8_000,
  maxRequests: 12,
  maxRecordingMs: 180_000,
  timeoutMs: 4_000,
  maxFailures: 1,
  intervalFromSend: false,
};

export const LOCAL_DRAFT_POLICY: DraftPolicy = {
  firstDelayMs: 1_000,
  minAudioMs: 1_000,
  minNewAudioMs: 600,
  intervalGrowth: 1,
  maxIntervalMs: 1_000,
  maxRequests: 1_200,
  maxRecordingMs: 600_000,
  timeoutMs: 8_000,
  maxFailures: 3,
  intervalFromSend: true,
};

export interface DraftSchedulerDeps {
  policy: DraftPolicy;
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
  const { policy } = deps;
  let stopped = true;
  let startedAtMs = 0;
  let intervalMs: number = policy.firstDelayMs;
  let requestCount = 0;
  let consecutiveFailures = 0;
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
      policy.timeoutMs,
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
      elapsedMs > policy.maxRecordingMs ||
      requestCount >= policy.maxRequests
    ) {
      halt();
      return;
    }
    const recordedMs = deps.recordedMs();
    const newAudioMs = recordedMs - sentRecordedMs;
    if (elapsedMs < policy.minAudioMs || newAudioMs < policy.minNewAudioMs) {
      schedule(intervalMs);
      return;
    }
    sentRecordedMs = recordedMs;
    requestCount += 1;
    const sentAtMs = deps.now();
    const nextDelay = () =>
      policy.intervalFromSend
        ? Math.max(0, intervalMs - (deps.now() - sentAtMs))
        : intervalMs;
    const request = send();
    const settled = request.then(() => undefined);
    inFlight = settled;
    const succeeded = await request;
    if (inFlight === settled) inFlight = null;
    if (!succeeded) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= policy.maxFailures) {
        halt();
        return;
      }
      schedule(nextDelay());
      return;
    }
    consecutiveFailures = 0;
    intervalMs = Math.min(
      policy.maxIntervalMs,
      Math.round(intervalMs * policy.intervalGrowth),
    );
    schedule(nextDelay());
  };

  return {
    start(startedAt) {
      stop();
      stopped = false;
      startedAtMs = startedAt;
      intervalMs = policy.firstDelayMs;
      requestCount = 0;
      consecutiveFailures = 0;
      sentRecordedMs = 0;
      draft = "";
      schedule(policy.firstDelayMs);
    },
    halt,
    stop,
    settled: () => inFlight ?? Promise.resolve(),
    lastDraft: () => draft,
  };
}
