import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  alertKindSchema,
  attentionAlertsHostContract,
  attentionAlertsRpcContract,
  type Alert,
} from "./contract.js";
import { createAlertEngine, REPEAT_OPTIONS } from "./engine.js";
import { createAlertStore } from "./store.js";

export { attentionAlertsRpcContract } from "./contract.js";

interface AttentionAlertsPluginOptions {
  batchMs?: number;
  claimWindowMs?: number;
  tickMs?: number;
  reconcileEveryTicks?: number;
  createId?: () => string;
  now?: () => number;
}

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const KIND_LABELS: Record<Alert["kind"], string> = {
  question: "Question",
  approval: "Approval",
  plan: "Plan review",
  error: "Error",
  done: "Done",
};

function formatAlerts(alerts: readonly Alert[]): string {
  if (alerts.length === 0) return "No open alerts";
  return [
    "ID\tKind\tThread\tTitle\tMessage\tCreated",
    ...alerts.map((alert) =>
      [
        alert.id,
        KIND_LABELS[alert.kind],
        alert.threadId ?? "-",
        alert.title,
        alert.body,
        new Date(alert.createdAt).toISOString(),
      ].join("\t"),
    ),
  ].join("\n");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export function createAttentionAlertsPlugin(
  options: AttentionAlertsPluginOptions = {},
) {
  return async function attentionAlertsPlugin(bb: BbPluginApi): Promise<void> {
    const settings = bb.settings.define({
      alertOnQuestions: {
        type: "boolean",
        label: "Questions, approvals and plan reviews",
        description: "Alert when an agent is waiting for your answer.",
        default: true,
      },
      alertOnErrors: {
        type: "boolean",
        label: "Errors",
        description: "Alert when a thread stops on an error.",
        default: true,
      },
      alertOnDone: {
        type: "boolean",
        label: "Finished tasks",
        description: "Alert when an agent finishes its turn.",
        default: true,
      },
      includeChildThreads: {
        type: "boolean",
        label: "Sub-agent threads finishing or failing",
        description:
          "Also alert when a thread started by another thread finishes or fails. Their questions always alert.",
        default: false,
      },
      sound: {
        type: "boolean",
        label: "Play a sound",
        description: "Play a sound for each new alert, even when bb is in the background.",
        default: true,
      },
      volume: {
        type: "number",
        label: "Volume",
        description: "Sound volume from 0 to 100.",
        default: 80,
        experimental_schema: z.number().int().min(0).max(100),
      },
      repeat: {
        type: "select",
        label: "Repeat the sound while waiting",
        description:
          "How often to replay the sound while a question, approval or plan review is still waiting for you.",
        options: [...REPEAT_OPTIONS],
        default: "Every 5 minutes",
      },
      repeatAllKinds: {
        type: "boolean",
        label: "Also repeat for errors and finished tasks",
        description: "Keep replaying the sound until every alert is handled.",
        default: false,
      },
      systemNotifications: {
        type: "boolean",
        label: "System notifications",
        description:
          "Also post a system notification for each alert, so it shows in Notification Center while bb is in the background.",
        default: true,
      },
      macFallback: {
        type: "boolean",
        label: "Play on this Mac when no bb window is open",
        description:
          "When no bb window or tab picks up an alert within a few seconds, play the sound through the machine running bb.",
        default: true,
      },
      clearFinishedOnOpen: {
        type: "boolean",
        label: "Clear finished and error alerts when you open the thread",
        description:
          "Questions, approvals and plan reviews stay until you answer them.",
        default: true,
      },
    });

    const store = createAlertStore(bb);
    const host = bb.hosts.experimental_client({
      contract: attentionAlertsHostContract,
    });
    const tickMs = options.tickMs ?? 10_000;
    const reconcileEveryTicks = options.reconcileEveryTicks ?? 6;

    const engine = createAlertEngine({
      bb,
      store,
      getSettings: () => settings.get(),
      async playOnHost(sound, volume) {
        const hostId = (await bb.sdk.system.config()).primaryHostId;
        if (hostId === null) return false;
        const result = await host.call(
          "playSound",
          { sound, volume },
          { hostId },
        );
        return result.played;
      },
      createId: options.createId ?? randomUUID,
      now: options.now ?? Date.now,
      batchMs: options.batchMs ?? 400,
      claimWindowMs: options.claimWindowMs ?? 2_500,
    });
    bb.onDispose(() => engine.stop());

    function logged(label: string, work: () => Promise<void> | void) {
      return async () => {
        try {
          await work();
        } catch (error) {
          bb.log.warn(
            `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
    }

    bb.rpc.register(attentionAlertsRpcContract, {
      "alerts.list": () => ({ alerts: engine.list() }),
      "alerts.dismiss": ({ id }) => ({ dismissed: engine.dismiss(id) }),
      "alerts.dismissAll": () => ({ dismissed: engine.dismissAll() }),
      "alerts.test": ({ kind }) => ({ id: engine.test(kind).id }),
      "rings.claim": ({ ringId }) => ({ claimed: engine.claim(ringId) }),
    });

    bb.events.on("interaction.pending", (payload) =>
      logged("Question alert", () => engine.onInteractionPending(payload))(),
    );
    bb.events.on("thread.idle", (payload) =>
      logged("Finished alert", () => engine.onThreadIdle(payload))(),
    );
    bb.events.on("thread.failed", (payload) =>
      logged("Error alert", () => engine.onThreadFailed(payload))(),
    );
    bb.events.on("thread.active", (payload) =>
      logged("Alert cleanup", () => engine.onThreadActive(payload))(),
    );
    bb.events.on("experimental_thread.events", ({ thread }) =>
      logged("Alert cleanup", () => engine.onThreadEvents(thread.id))(),
    );
    bb.events.on("thread.archived", ({ thread }) =>
      logged("Alert cleanup", () => engine.onThreadGone(thread.id))(),
    );
    bb.events.on("thread.deleted", ({ thread }) =>
      logged("Alert cleanup", () => engine.onThreadGone(thread.id))(),
    );

    bb.background.service("reminders", {
      async start(signal) {
        await logged("Alert reconcile", () => engine.reconcileAll())();
        let ticks = 0;
        while (!signal.aborted) {
          await sleep(tickMs, signal);
          if (signal.aborted) break;
          ticks += 1;
          if (ticks % reconcileEveryTicks === 0) {
            await logged("Alert reconcile", () => engine.reconcileAll())();
          }
          await logged("Alert reminder", () => engine.remindDue())();
        }
      },
    });

    bb.cli.register(
      defineCli({
        name: "attention-alerts",
        summary: "List, dismiss, and test attention alerts",
        description:
          "Alerts stay open until you answer the agent, open a finished thread, or dismiss them.",
        commands: {
          list: cliCommand({
            summary: "List open alerts, newest first",
            options: { json: JSON_OPTION },
            async run(input) {
              const alerts = engine.list();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ alerts })
                  : formatAlerts(alerts),
              };
            },
          }),
          dismiss: cliCommand({
            summary: "Dismiss one alert",
            positionals: [
              {
                name: "id",
                description: "Alert id, as `bb attention-alerts list` prints it",
                required: true,
              },
            ],
            options: { json: JSON_OPTION },
            async run(input) {
              const id = input.positionals.id;
              if (!engine.dismiss(id)) {
                throw new PluginCliError(`Alert not found: ${id}`, {
                  code: "alert_not_found",
                  hint: "Run `bb attention-alerts list` for the open alert ids.",
                });
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ id, dismissed: true })
                  : `Dismissed alert ${id}`,
              };
            },
          }),
          clear: cliCommand({
            summary: "Dismiss every open alert",
            options: { json: JSON_OPTION },
            async run(input) {
              const dismissed = engine.dismissAll();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ dismissed })
                  : `Dismissed ${dismissed} alert${dismissed === 1 ? "" : "s"}`,
              };
            },
          }),
          test: cliCommand({
            summary: "Raise a test alert with its sound",
            positionals: [
              {
                name: "kind",
                description:
                  "question, approval, plan, error, or done (default: question)",
                required: false,
              },
            ],
            options: { json: JSON_OPTION },
            async run(input) {
              const kind = alertKindSchema.safeParse(
                input.positionals.kind ?? "question",
              );
              if (!kind.success) {
                throw new PluginCliError(
                  "Use question, approval, plan, error, or done",
                  { code: "invalid_kind" },
                );
              }
              const alert = engine.test(kind.data);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ alert })
                  : `Raised test ${KIND_LABELS[alert.kind].toLowerCase()} alert ${alert.id}`,
              };
            },
          }),
        },
      }),
    );
  };
}

export default createAttentionAlertsPlugin();
