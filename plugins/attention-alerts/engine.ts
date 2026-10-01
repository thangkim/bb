import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  ALERTS_CHANGED_CHANNEL,
  ALERTS_RING_CHANNEL,
  soundForKind,
  type Alert,
  type AlertKind,
  type Ring,
} from "./contract.js";
import type { AlertStore } from "./store.js";
import type { AlertSound } from "./sounds.js";
import { failedTitle, finishedTitle } from "./titles.js";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];
type PendingInteraction =
  PluginThreadEventPayloads["interaction.pending"]["interaction"];

export const REPEAT_OPTIONS = [
  "Off",
  "Every minute",
  "Every 2 minutes",
  "Every 3 minutes",
  "Every 5 minutes",
  "Every 10 minutes",
] as const;

const REPEAT_MINUTES: Record<string, number | null> = {
  Off: null,
  "Every minute": 1,
  "Every 2 minutes": 2,
  "Every 3 minutes": 3,
  "Every 5 minutes": 5,
  "Every 10 minutes": 10,
};

export function repeatIntervalMs(option: string): number | null {
  const minutes = REPEAT_MINUTES[option];
  return minutes === undefined || minutes === null ? null : minutes * 60_000;
}

export interface AlertSettings {
  alertOnQuestions: boolean;
  alertOnErrors: boolean;
  alertOnDone: boolean;
  includeChildThreads: boolean;
  sound: boolean;
  volume: number;
  repeat: string;
  repeatAllKinds: boolean;
  macFallback: boolean;
}

export interface AlertEngineArgs {
  bb: BbPluginApi;
  store: AlertStore;
  getSettings(): Promise<AlertSettings>;
  playOnHost(sound: AlertSound, volume: number): Promise<boolean>;
  createId(): string;
  now(): number;
  batchMs: number;
  claimWindowMs: number;
}

const TITLE_MAX_LENGTH = 80;
const BODY_MAX_LENGTH = 180;
const RING_RETENTION_MS = 60_000;
const SOUND_PRIORITY: readonly AlertSound[] = ["attention", "error", "done"];
const STATE_KINDS: readonly AlertKind[] = ["done", "error"];
const ALL_KINDS: readonly AlertKind[] = [
  "question",
  "approval",
  "plan",
  "error",
  "done",
];
const INPUT_KINDS: readonly AlertKind[] = ["question", "approval", "plan"];
const TEST_ALERTS: Record<AlertKind, { title: string; body: string | null }> = {
  question: {
    title: "Test the attention alerts",
    body: "Which sound do you prefer for questions?",
  },
  approval: {
    title: "Test the attention alerts",
    body: "Approve command: bb attention-alerts test",
  },
  plan: {
    title: "Test the attention alerts",
    body: "Review the plan before the agent continues",
  },
  error: {
    title: "Failed to test the attention alerts",
    body: "This is how an error looks",
  },
  done: { title: "Tested the attention alerts", body: null },
};

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function threadTitle(thread: ThreadResponse): string {
  const title = thread.title?.trim() || thread.titleFallback?.trim();
  return title || `Thread ${thread.id.slice(0, 8)}`;
}

function isVisible(thread: ThreadResponse): boolean {
  return (
    thread.deletedAt === null &&
    thread.archivedAt === null &&
    thread.visibility === "visible"
  );
}

export function describeInteraction(interaction: PendingInteraction): {
  kind: AlertKind;
  body: string;
} {
  const payload = interaction.payload;
  if (payload.kind === "user_question") {
    const prompt = firstLine(payload.questions[0]?.prompt ?? "");
    return {
      kind: "question",
      body: prompt || "The agent has a question for you",
    };
  }
  if (payload.kind === "approval") {
    const subject = payload.subject;
    if (subject.kind === "plan") {
      return { kind: "plan", body: "Review the plan before the agent continues" };
    }
    if (subject.kind === "command") {
      return {
        kind: "approval",
        body: `Approve command: ${firstLine(subject.command)}`,
      };
    }
    if (subject.kind === "file_change") {
      return { kind: "approval", body: "Approve file changes" };
    }
    if (subject.kind === "permission_grant") {
      return {
        kind: "approval",
        body: subject.toolName
          ? `Grant permissions to ${subject.toolName}`
          : "Grant additional permissions",
      };
    }
    return { kind: "approval", body: `Approve ${subject.tool}` };
  }
  return { kind: "question", body: payload.title };
}

function pickSound(alerts: readonly Alert[]): AlertSound {
  const sounds = new Set(alerts.map((alert) => soundForKind(alert.kind)));
  return SOUND_PRIORITY.find((sound) => sounds.has(sound)) ?? "done";
}

interface RingState {
  claimed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export function createAlertEngine(args: AlertEngineArgs) {
  const { bb, store } = args;
  const rings = new Map<string, RingState>();
  let batch: { alerts: Alert[]; timer: ReturnType<typeof setTimeout> } | null =
    null;
  let stopped = false;

  function publishChanged(): void {
    bb.realtime.publish(ALERTS_CHANGED_CHANNEL, { count: store.list().length });
  }

  function fireRing(alerts: readonly Alert[], reason: Ring["reason"]): void {
    if (stopped || alerts.length === 0) return;
    const ring: Ring = {
      ringId: args.createId(),
      reason,
      sound: pickSound(alerts),
      alerts: [...alerts],
    };
    const timer = setTimeout(() => {
      void fallbackIfUnclaimed(ring);
    }, args.claimWindowMs);
    timer.unref?.();
    rings.set(ring.ringId, { claimed: false, timer });
    bb.realtime.publish(ALERTS_RING_CHANNEL, ring);
  }

  async function fallbackIfUnclaimed(ring: Ring): Promise<void> {
    const state = rings.get(ring.ringId);
    if (!state) return;
    const forget = setTimeout(
      () => rings.delete(ring.ringId),
      RING_RETENTION_MS,
    );
    forget.unref?.();
    if (state.claimed || stopped) return;
    state.claimed = true;
    if (!ring.alerts.some((alert) => store.get(alert.id) !== null)) return;
    const settings = await args.getSettings();
    if (!settings.sound || !settings.macFallback) return;
    try {
      const played = await args.playOnHost(ring.sound, settings.volume / 100);
      bb.log.info(
        played
          ? "No bb window picked up the alert sound, so the Mac played it"
          : "No bb window picked up the alert sound and the Mac could not play it",
      );
    } catch (error) {
      bb.log.warn(
        `Fallback alert sound failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function queueRing(alert: Alert): void {
    if (stopped) return;
    if (batch) {
      batch.alerts.push(alert);
      return;
    }
    const timer = setTimeout(() => {
      const pending = batch;
      batch = null;
      if (!pending) return;
      const open = pending.alerts.filter((item) => store.get(item.id) !== null);
      fireRing(open, "new");
    }, args.batchMs);
    timer.unref?.();
    batch = { alerts: [alert], timer };
  }

  function addAlert(alert: Omit<Alert, "id" | "createdAt">): Alert | null {
    const created: Alert = { ...alert, id: args.createId(), createdAt: args.now() };
    if (!store.insert(created)) return null;
    queueRing(created);
    return created;
  }

  async function reconcileInteractions(threadId: string): Promise<boolean> {
    const alerts = store.listInteractionAlerts(threadId);
    if (alerts.length === 0) return false;
    const interactions = await bb.sdk.threads.interactions.list({ threadId });
    const pending = new Set(
      interactions
        .filter((interaction) => interaction.status === "pending")
        .map((interaction) => interaction.id),
    );
    let changed = false;
    for (const alert of alerts) {
      if (alert.interactionId !== null && !pending.has(alert.interactionId)) {
        changed = store.remove(alert.id) || changed;
      }
    }
    return changed;
  }

  function alertsForChildThread(
    thread: ThreadResponse,
    settings: AlertSettings,
  ): boolean {
    return thread.parentThreadId === null || settings.includeChildThreads;
  }

  async function onStateAlert(
    thread: ThreadResponse,
    kind: "done" | "error",
    body: string | null,
  ): Promise<void> {
    const removed = store.removeForThread(thread.id, STATE_KINDS);
    let changed = removed.length > 0;
    changed = (await reconcileInteractions(thread.id)) || changed;
    const settings = await args.getSettings();
    const enabled = kind === "done" ? settings.alertOnDone : settings.alertOnErrors;
    if (enabled && isVisible(thread) && alertsForChildThread(thread, settings)) {
      changed =
        addAlert({
          threadId: thread.id,
          projectId: thread.projectId,
          interactionId: null,
          kind,
          title: truncate(
            kind === "done"
              ? finishedTitle(threadTitle(thread))
              : failedTitle(threadTitle(thread)),
            TITLE_MAX_LENGTH,
          ),
          body: body === null ? null : truncate(body, BODY_MAX_LENGTH),
        }) !== null || changed;
    }
    if (changed) publishChanged();
  }

  return {
    async onInteractionPending({
      thread,
      interaction,
    }: PluginThreadEventPayloads["interaction.pending"]): Promise<void> {
      if (interaction.status !== "pending" || !isVisible(thread)) return;
      const settings = await args.getSettings();
      if (!settings.alertOnQuestions) return;
      const described = describeInteraction(interaction);
      const created = addAlert({
        threadId: thread.id,
        projectId: thread.projectId,
        interactionId: interaction.id,
        kind: described.kind,
        title: truncate(threadTitle(thread), TITLE_MAX_LENGTH),
        body: truncate(described.body, BODY_MAX_LENGTH),
      });
      if (created) publishChanged();
    },

    async onThreadIdle({
      thread,
    }: PluginThreadEventPayloads["thread.idle"]): Promise<void> {
      await onStateAlert(thread, "done", null);
    },

    async onThreadFailed({
      thread,
      error,
    }: PluginThreadEventPayloads["thread.failed"]): Promise<void> {
      await onStateAlert(thread, "error", firstLine(error ?? "") || null);
    },

    async onThreadActive({
      thread,
    }: PluginThreadEventPayloads["thread.active"]): Promise<void> {
      const removed = store.removeForThread(thread.id, STATE_KINDS);
      const reconciled = await reconcileInteractions(thread.id);
      if (removed.length > 0 || reconciled) publishChanged();
    },

    async onThreadEvents(threadId: string): Promise<void> {
      if (await reconcileInteractions(threadId)) publishChanged();
    },

    onThreadGone(threadId: string): void {
      if (store.removeAllForThread(threadId).length > 0) publishChanged();
    },

    async reconcileAll(): Promise<void> {
      let changed = false;
      for (const threadId of store.threadIds()) {
        let thread: ThreadResponse;
        try {
          thread = await bb.sdk.threads.get({ threadId });
        } catch {
          changed = store.removeAllForThread(threadId).length > 0 || changed;
          continue;
        }
        if (!isVisible(thread)) {
          changed = store.removeAllForThread(threadId).length > 0 || changed;
          continue;
        }
        if (thread.status === "active" || thread.status === "starting") {
          changed =
            store.removeForThread(threadId, STATE_KINDS).length > 0 || changed;
        }
        changed = (await reconcileInteractions(threadId)) || changed;
      }
      if (changed) publishChanged();
    },

    async remindDue(): Promise<void> {
      const settings = await args.getSettings();
      const intervalMs = repeatIntervalMs(settings.repeat);
      if (intervalMs === null) return;
      const now = args.now();
      const due = store.dueForReminder(
        settings.repeatAllKinds ? ALL_KINDS : INPUT_KINDS,
        now - intervalMs,
      );
      if (due.length === 0) return;
      store.markRung(
        due.map((alert) => alert.id),
        now,
      );
      fireRing(due, "reminder");
    },

    list(): Alert[] {
      return store.list();
    },

    dismiss(id: string): boolean {
      const removed = store.remove(id);
      if (removed) publishChanged();
      return removed;
    },

    dismissAll(): number {
      const count = store.removeAll();
      if (count > 0) publishChanged();
      return count;
    },

    test(kind: AlertKind): Alert {
      const created = addAlert({
        threadId: null,
        projectId: null,
        interactionId: null,
        kind,
        ...TEST_ALERTS[kind],
      });
      if (!created) throw new Error("Could not create the test alert");
      publishChanged();
      return created;
    },

    claim(ringId: string): boolean {
      const state = rings.get(ringId);
      if (!state || state.claimed) return false;
      state.claimed = true;
      return true;
    },

    stop(): void {
      stopped = true;
      if (batch) clearTimeout(batch.timer);
      batch = null;
      for (const state of rings.values()) clearTimeout(state.timer);
      rings.clear();
    },
  };
}

export type AlertEngine = ReturnType<typeof createAlertEngine>;
