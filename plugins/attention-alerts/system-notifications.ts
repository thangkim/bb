import type { Alert } from "./contract.js";

export type ClientKind = "desktop" | "web" | "native";

export function clientKind(): ClientKind {
  if ("bbDesktop" in window) return "desktop";
  if (
    "bb" in window &&
    typeof window.bb === "object" &&
    window.bb !== null &&
    "native" in window.bb
  ) {
    return "native";
  }
  return "web";
}

export function notificationPermission():
  | NotificationPermission
  | "unsupported" {
  return typeof Notification === "undefined" || !window.isSecureContext
    ? "unsupported"
    : Notification.permission;
}

export const KIND_LABELS: Record<Alert["kind"], string> = {
  question: "Question",
  approval: "Needs approval",
  plan: "Plan review",
  error: "Failed",
  done: "Done",
};

export function createSystemNotifications(onOpen: (alert: Alert) => void) {
  const shown = new Map<string, Notification>();

  function isMacDesktop(): boolean {
    return (
      "bbDesktop" in window &&
      typeof window.bbDesktop === "object" &&
      window.bbDesktop !== null &&
      "platform" in window.bbDesktop &&
      window.bbDesktop.platform === "macos"
    );
  }

  return {
    show(alert: Alert): void {
      if (notificationPermission() !== "granted" || shown.has(alert.id)) return;
      const notification = new Notification(alert.title, {
        ...(alert.body === null ? {} : { body: alert.body }),
        tag: `bb-attention-${alert.id}`,
        requireInteraction: true,
        silent: true,
        ...(isMacDesktop()
          ? {}
          : { icon: new URL("/icon-192.png", window.location.origin).href }),
      });
      shown.set(alert.id, notification);
      notification.onclose = () => shown.delete(alert.id);
      notification.onclick = () => {
        window.focus();
        onOpen(alert);
        notification.close();
      };
    },
    retain(openIds: ReadonlySet<string>): void {
      for (const [id, notification] of shown) {
        if (!openIds.has(id)) {
          notification.close();
          shown.delete(id);
        }
      }
    },
    dispose(): void {
      for (const notification of shown.values()) notification.close();
      shown.clear();
    },
  };
}
