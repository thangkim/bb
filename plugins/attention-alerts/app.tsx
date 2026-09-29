import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import {
  ALERTS_CHANGED_CHANNEL,
  ALERTS_RING_CHANNEL,
  ringSchema,
  soundForKind,
  type Alert,
  type attentionAlertsRpcContract,
} from "./contract.js";
import { createAlertAudio, type AlertAudio } from "./audio.js";
import type { AlertSound } from "./sounds.js";
import {
  alertHeadline,
  clientKind,
  createSystemNotifications,
  notificationPermission,
} from "./system-notifications.js";

const WEB_CLAIM_DELAY_MS = 300;
const COLLAPSED_LIMIT = 3;
const SOUND_PRIORITY: readonly AlertSound[] = ["attention", "error", "done"];

interface ClientSettings {
  sound: boolean;
  volume: number;
  systemNotifications: boolean;
  clearFinishedOnOpen: boolean;
}

function readSettings(
  values: Record<string, unknown> | null | undefined,
): ClientSettings {
  const volume = values?.volume;
  return {
    sound: values?.sound !== false,
    volume: typeof volume === "number" ? volume : 80,
    systemNotifications: values?.systemNotifications !== false,
    clearFinishedOnOpen: values?.clearFinishedOnOpen !== false,
  };
}

function isStateAlert(alert: Alert): boolean {
  return alert.kind === "done" || alert.kind === "error";
}

function pickSound(alerts: readonly Alert[]): AlertSound {
  const sounds = new Set(alerts.map((alert) => soundForKind(alert.kind)));
  return SOUND_PRIORITY.find((sound) => sounds.has(sound)) ?? "done";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relativeTime(createdAt: number, now: number): string {
  const minutes = Math.floor((now - createdAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const KIND_ICONS: Record<Alert["kind"], string> = {
  question: "CircleQuestion",
  approval: "AlertTriangle",
  plan: "FileText",
  error: "AlertCircle",
  done: "CircleCheck",
};

const KIND_TONES: Record<Alert["kind"], string> = {
  question: "text-primary",
  approval: "text-primary",
  plan: "text-primary",
  error: "text-destructive",
  done: "text-muted-foreground",
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function AlertCard({
  alert,
  now,
  onOpen,
  onDismiss,
}: {
  alert: Alert;
  now: number;
  onOpen(alert: Alert): void;
  onDismiss(alert: Alert): void;
}) {
  return (
    <li
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      data-alert-kind={alert.kind}
    >
      <Icon
        name={KIND_ICONS[alert.kind]}
        fallback="Info"
        aria-hidden
        className={`mt-0.5 size-4 shrink-0 ${KIND_TONES[alert.kind]}`}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={alert.threadId === null}
        onClick={() => onOpen(alert)}
      >
        <span className="block truncate text-sm font-medium">
          {alertHeadline(alert)}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
          {alert.body}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {relativeTime(alert.createdAt, now)}
        </span>
      </button>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={`Dismiss ${alertHeadline(alert)}`}
        onClick={() => onDismiss(alert)}
      >
        <Icon name="X" aria-hidden className="size-4" />
      </button>
    </li>
  );
}

function AttentionOverlay() {
  const rpc = useRpc<typeof attentionAlertsRpcContract>();
  const navigate = useBbNavigate();
  const context = useBbContext();
  const { values } = useSettings();
  const connection = useRealtimeConnectionState();
  const settings = readSettings(values);
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);
  const [expanded, setExpanded] = useState(false);
  const now = useNow(30_000);

  const settingsRef = useRef(settings);
  const threadIdRef = useRef(context.threadId);
  const audioRef = useRef<AlertAudio | null>(null);
  const notificationsRef = useRef<ReturnType<
    typeof createSystemNotifications
  > | null>(null);
  const openRef = useRef<(alert: Alert) => void>(() => undefined);

  const open = useCallback(
    (alert: Alert) => {
      window.focus();
      if (alert.threadId !== null) navigate.toThread(alert.threadId);
    },
    [navigate],
  );

  useEffect(() => {
    settingsRef.current = settings;
    threadIdRef.current = context.threadId;
    openRef.current = open;
  });

  useEffect(() => {
    const audio = createAlertAudio();
    const notifications = createSystemNotifications((alert) =>
      openRef.current(alert),
    );
    audioRef.current = audio;
    notificationsRef.current = notifications;
    return () => {
      audioRef.current = null;
      notificationsRef.current = null;
      audio.dispose();
      notifications.dispose();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("alerts.list", {});
      setAlerts(result.alerts);
      notificationsRef.current?.retain(
        new Set(result.alerts.map((alert) => alert.id)),
      );
    } catch {
      return;
    }
  }, [rpc]);

  const dismiss = useCallback(
    async (alert: Alert) => {
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
      try {
        await rpc.call("alerts.dismiss", { id: alert.id });
      } finally {
        void refresh();
      }
    },
    [refresh, rpc],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const previousConnection = useRef(connection);
  useEffect(() => {
    if (previousConnection.current !== "connected" && connection === "connected") {
      void refresh();
    }
    previousConnection.current = connection;
  }, [connection, refresh]);

  useRealtime(ALERTS_CHANGED_CHANNEL, () => {
    void refresh();
  });

  useRealtime(ALERTS_RING_CHANNEL, (payload) => {
    void (async () => {
      const parsed = ringSchema.safeParse(payload);
      const kind = clientKind();
      if (!parsed.success || kind === "native") return;
      const ring = parsed.data;
      const current = settingsRef.current;
      const viewing = threadIdRef.current;
      let pending = ring.alerts;
      if (current.clearFinishedOnOpen && viewing !== null && document.hasFocus()) {
        const seen = pending.filter(
          (alert) => isStateAlert(alert) && alert.threadId === viewing,
        );
        for (const alert of seen) {
          await rpc.call("alerts.dismiss", { id: alert.id }).catch(() => undefined);
        }
        pending = pending.filter((alert) => !seen.includes(alert));
      }
      if (pending.length === 0) return;
      if (current.sound && !(await audioRef.current?.ready())) return;
      if (kind === "web") await delay(WEB_CLAIM_DELAY_MS);
      const { claimed } = await rpc.call("rings.claim", { ringId: ring.ringId });
      if (!claimed) return;
      if (current.sound) {
        await audioRef.current?.play(pickSound(pending), current.volume / 100);
      }
      if (
        ring.reason === "new" &&
        current.systemNotifications &&
        !document.hasFocus()
      ) {
        for (const alert of pending) notificationsRef.current?.show(alert);
      }
    })().catch(() => undefined);
  });

  useEffect(() => {
    if (!settings.clearFinishedOnOpen) return;
    const clearViewed = () => {
      const viewing = threadIdRef.current;
      if (viewing === null || !document.hasFocus()) return;
      for (const alert of alerts) {
        if (isStateAlert(alert) && alert.threadId === viewing) {
          void dismiss(alert);
        }
      }
    };
    clearViewed();
    window.addEventListener("focus", clearViewed);
    return () => window.removeEventListener("focus", clearViewed);
  }, [alerts, context.threadId, dismiss, settings.clearFinishedOnOpen]);

  if (alerts.length === 0) return null;
  const visible = expanded ? alerts : alerts.slice(0, COLLAPSED_LIMIT);
  const hidden = alerts.length - visible.length;

  return (
    <section
      aria-label="Attention alerts"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-96"
    >
      <div className="pointer-events-auto flex items-center justify-between rounded-lg border border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
        <span role="status">
          {alerts.length === 1
            ? "1 alert needs you"
            : `${alerts.length} alerts need you`}
        </span>
        <span className="flex items-center gap-3">
          {alerts.length > COLLAPSED_LIMIT ? (
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : `Show all`}
            </button>
          ) : null}
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => {
              setAlerts([]);
              void rpc
                .call("alerts.dismissAll", {})
                .finally(() => void refresh());
            }}
          >
            Dismiss all
          </button>
        </span>
      </div>
      <ol
        className={`flex flex-col gap-2 ${expanded ? "pointer-events-auto max-h-[70vh] overflow-y-auto" : ""}`}
      >
        {visible.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            now={now}
            onOpen={open}
            onDismiss={(item) => void dismiss(item)}
          />
        ))}
      </ol>
      {hidden > 0 ? (
        <button
          type="button"
          className="pointer-events-auto self-end rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          +{hidden} more
        </button>
      ) : null}
    </section>
  );
}

function AttentionSettings() {
  const rpc = useRpc<typeof attentionAlertsRpcContract>();
  const { values } = useSettings();
  const settings = readSettings(values);
  const kind = clientKind();
  const [permission, setPermission] = useState(notificationPermission);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<AlertAudio | null>(null);

  useEffect(() => {
    const audio = createAlertAudio();
    audioRef.current = audio;
    const refreshPermission = () => setPermission(notificationPermission());
    window.addEventListener("focus", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      audioRef.current = null;
      audio.dispose();
    };
  }, []);

  if (kind === "native") return null;

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const permissionText =
    permission === "unsupported"
      ? "System notifications are unavailable here. Use the desktop app, or a browser over HTTPS or localhost."
      : permission === "denied"
        ? "System notifications are blocked. Allow them in your browser or system settings, then come back."
        : permission === "granted"
          ? "System notifications are allowed on this device."
          : "Allow system notifications so alerts reach you while bb is in the background.";

  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-medium">
        {kind === "desktop" ? "This desktop app" : "This browser"}
      </h3>
      <p className="text-muted-foreground" role="status">
        {permissionText}
      </p>
      <div className="flex flex-wrap gap-2">
        {permission === "default" ? (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await Notification.requestPermission();
                setPermission(next);
                return next === "granted"
                  ? "System notifications allowed."
                  : "System notifications were not allowed.";
              })
            }
          >
            Allow system notifications
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const played = await audioRef.current?.play(
                "attention",
                settings.volume / 100,
              );
              return played
                ? "Sound played on this device."
                : "This device could not play sound yet. Click anywhere in bb, then try again.";
            })
          }
        >
          Play test sound
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await rpc.call("alerts.test", { kind: "question" });
              return "Test alert raised. To try it with bb in the background, run `sleep 5; bb attention-alerts test` in a terminal and switch to another app.";
            })
          }
        >
          Raise test alert
        </button>
      </div>
      {message ? (
        <p className="text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        On macOS, set bb’s notification style to Alerts in System Settings →
        Notifications so notifications stay on screen until you act on them.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "alerts",
    component: AttentionOverlay,
  });
  app.slots.settingsSection({ id: "device", component: AttentionSettings });
});
