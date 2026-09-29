import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AlertSound } from "./sounds.js";

export const alertKindSchema = z.enum([
  "question",
  "approval",
  "plan",
  "error",
  "done",
]);
export type AlertKind = z.infer<typeof alertKindSchema>;

export const alertSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1).nullable(),
    projectId: z.string().min(1).nullable(),
    interactionId: z.string().min(1).nullable(),
    kind: alertKindSchema,
    title: z.string(),
    body: z.string(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type Alert = z.infer<typeof alertSchema>;

export const ringReasonSchema = z.enum(["new", "reminder"]);
export const alertSoundSchema = z.enum(["attention", "error", "done"]);

export const ringSchema = z
  .object({
    ringId: z.string().min(1),
    reason: ringReasonSchema,
    sound: alertSoundSchema,
    alerts: z.array(alertSchema),
  })
  .strict();
export type Ring = z.infer<typeof ringSchema>;

export const ALERTS_CHANGED_CHANNEL = "alerts.changed";
export const ALERTS_RING_CHANNEL = "alerts.ring";

export function soundForKind(kind: AlertKind): AlertSound {
  if (kind === "error") return "error";
  if (kind === "done") return "done";
  return "attention";
}

export function needsInput(kind: AlertKind): boolean {
  return kind === "question" || kind === "approval" || kind === "plan";
}

const emptyInputSchema = z.object({}).strict();

export const attentionAlertsRpcContract = defineRpcContract({
  "alerts.list": {
    input: emptyInputSchema,
    output: z.object({ alerts: z.array(alertSchema) }).strict(),
  },
  "alerts.dismiss": {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ dismissed: z.boolean() }).strict(),
  },
  "alerts.dismissAll": {
    input: emptyInputSchema,
    output: z.object({ dismissed: z.number().int().nonnegative() }).strict(),
  },
  "alerts.test": {
    input: z.object({ kind: alertKindSchema }).strict(),
    output: z.object({ id: z.string().min(1) }).strict(),
  },
  "rings.claim": {
    input: z.object({ ringId: z.string().min(1) }).strict(),
    output: z.object({ claimed: z.boolean() }).strict(),
  },
});

export const attentionAlertsHostContract = defineRpcContract({
  playSound: {
    input: z
      .object({
        sound: alertSoundSchema,
        volume: z.number().min(0).max(1),
      })
      .strict(),
    output: z.object({ played: z.boolean() }).strict(),
  },
});
