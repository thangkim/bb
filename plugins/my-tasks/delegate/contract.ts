import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "../shared/contract";

const threadIdSchema = z.string().startsWith("thr_");

export const delegationRpcContract = defineRpcContract({
  delegate: {
    input: z
      .object({
        taskId: idSchema,
        presetId: idSchema,
        extraInstructions: z.string().optional(),
      })
      .strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  delegateProject: {
    input: z
      .object({
        projectId: idSchema,
        presetId: idSchema,
        extraInstructions: z.string().optional(),
      })
      .strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  taskThreadsAttach: {
    input: z.object({ taskId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  taskThreadsDetach: {
    input: z.object({ taskId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  projectThreadsAttach: {
    input: z.object({ projectId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  projectThreadsCompose: {
    input: z.object({ projectId: idSchema }).strict(),
    output: z.object({ bbProjectId: z.string().startsWith("proj_") }).strict(),
  },
  taskThreadsCompose: {
    input: z.object({ taskId: idSchema }).strict(),
    output: z.object({ bbProjectId: z.string().startsWith("proj_") }).strict(),
  },
  threadSplitAttach: {
    input: z
      .object({
        sourceThreadId: threadIdSchema,
        threadId: threadIdSchema,
        paneAgeMs: z.number().int().nonnegative(),
      })
      .strict(),
    output: z
      .object({
        taskIds: z.array(idSchema),
        projectIds: z.array(idSchema),
      })
      .strict(),
  },
  projectThreadsDetach: {
    input: z.object({ projectId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
});

export type DelegationRpcContract = typeof delegationRpcContract;
